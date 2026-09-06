import { normalize, resolve } from 'node:path'
import type { RuntimePresetRosterConfig, RuntimePresetRoot } from '@doppelganger/doppelganger-runtime-presets'
import type { HostExtensionSelectionInput } from '@doppelganger/doppelganger-host-extensions'
import { cloneJsonValue, type JsonValue } from '@doppelganger/doppelganger-protocols'

export const DEFAULT_OPENCLAW_WARMUP_TIMEOUT_MS = 10_000
export const DEFAULT_OPENCLAW_CONTEXT_TOKEN_BUDGET = 8_192

export interface OpenClawActorBinding {
  readonly agentId: string
  readonly sessionKey: string
  readonly workspaceRoot: string
  readonly actorId: string
}

export interface OpenClawOptions {
  readonly roster: RuntimePresetRosterConfig
  readonly runtimePreset?: string
  readonly warmupTimeoutMs: number
  readonly contextTokenBudget: number
  readonly actors: readonly OpenClawActorBinding[]
  readonly hostExtensions?: readonly HostExtensionSelectionInput[]
}

export const OPENCLAW_CONFIG_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze({
    roster: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({
        home: Object.freeze({ type: 'string', minLength: 1 }),
        defaultRuntimePreset: Object.freeze({
          anyOf: Object.freeze([
            Object.freeze({ type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' }),
            Object.freeze({ type: 'null' }),
          ]),
        }),
        roots: Object.freeze({
          type: 'array',
          items: Object.freeze({
            type: 'object',
            additionalProperties: false,
            required: Object.freeze(['path', 'trust']),
            properties: Object.freeze({
              path: Object.freeze({ type: 'string', minLength: 1 }),
              trust: Object.freeze({ enum: Object.freeze(['system', 'user']) }),
            }),
          }),
        }),
        includeShippedRoot: Object.freeze({ type: 'boolean' }),
        includeUserRoot: Object.freeze({ type: 'boolean' }),
      }),
    }),
    runtimePreset: Object.freeze({
      type: 'string',
      pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
    }),
    warmupTimeoutMs: Object.freeze({
      type: 'integer',
      minimum: 100,
      maximum: 120_000,
      default: DEFAULT_OPENCLAW_WARMUP_TIMEOUT_MS,
    }),
    contextTokenBudget: Object.freeze({
      type: 'integer',
      minimum: 0,
      maximum: 1_000_000,
      default: DEFAULT_OPENCLAW_CONTEXT_TOKEN_BUDGET,
    }),
    hostExtensions: Object.freeze({
      type: 'array',
      maxItems: 1_000,
      items: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze(['id']),
        properties: Object.freeze({
          id: Object.freeze({ type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' }),
          config: Object.freeze({}),
        }),
      }),
    }),
    actors: Object.freeze({
      type: 'array',
      maxItems: 10_000,
      default: Object.freeze([]),
      items: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze(['agentId', 'sessionKey', 'workspaceRoot', 'actorId']),
        properties: Object.freeze({
          agentId: Object.freeze({ type: 'string', minLength: 1, maxLength: 512 }),
          sessionKey: Object.freeze({ type: 'string', minLength: 1, maxLength: 2_048 }),
          workspaceRoot: Object.freeze({ type: 'string', minLength: 1 }),
          actorId: Object.freeze({ type: 'string', minLength: 1, maxLength: 1_024 }),
        }),
      }),
    }),
  }),
})

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key)).sort()
  if (unexpected.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unexpected.join(', ')}`)
}

function nonEmpty(value: unknown, label: string, maximum = Number.POSITIVE_INFINITY): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
  const normalized = value.trim()
  if (normalized.length > maximum) throw new TypeError(`${label} must contain at most ${maximum} characters`)
  return normalized
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} must be a safe integer from ${minimum} through ${maximum}`)
  }
  return value as number
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

function normalizeRoot(value: unknown, index: number): RuntimePresetRoot {
  const root = object(value, `OpenClaw options.roster.roots[${index}]`)
  exactKeys(root, ['path', 'trust'], `OpenClaw options.roster.roots[${index}]`)
  const path = normalize(resolve(nonEmpty(root.path, `OpenClaw options.roster.roots[${index}].path`)))
  if (root.trust !== 'system' && root.trust !== 'user') {
    throw new TypeError(`OpenClaw options.roster.roots[${index}].trust must be "system" or "user"`)
  }
  return Object.freeze({ path, trust: root.trust })
}

function normalizeRoster(value: unknown): RuntimePresetRosterConfig {
  if (value === undefined) return Object.freeze({ defaultRuntimePreset: null })
  const roster = object(value, 'OpenClaw options.roster')
  exactKeys(
    roster,
    ['home', 'defaultRuntimePreset', 'roots', 'includeShippedRoot', 'includeUserRoot'],
    'OpenClaw options.roster',
  )
  let defaultRuntimePreset: string | null = null
  if (roster.defaultRuntimePreset !== undefined) {
    if (roster.defaultRuntimePreset === null) defaultRuntimePreset = null
    else defaultRuntimePreset = nonEmpty(roster.defaultRuntimePreset, 'OpenClaw options.roster.defaultRuntimePreset')
  }
  const roots = roster.roots === undefined
    ? undefined
    : (() => {
        if (!Array.isArray(roster.roots)) throw new TypeError('OpenClaw options.roster.roots must be an array')
        return Object.freeze(roster.roots.map(normalizeRoot))
      })()
  const home = roster.home === undefined
    ? undefined
    : normalize(resolve(nonEmpty(roster.home, 'OpenClaw options.roster.home')))
  const includeShippedRoot = optionalBoolean(roster.includeShippedRoot, 'OpenClaw options.roster.includeShippedRoot')
  const includeUserRoot = optionalBoolean(roster.includeUserRoot, 'OpenClaw options.roster.includeUserRoot')
  return Object.freeze({
    defaultRuntimePreset,
    ...(home === undefined ? {} : { home }),
    ...(roots === undefined ? {} : { roots }),
    ...(includeShippedRoot === undefined ? {} : { includeShippedRoot }),
    ...(includeUserRoot === undefined ? {} : { includeUserRoot }),
  })
}

function normalizeActor(value: unknown, index: number): OpenClawActorBinding {
  const actor = object(value, `OpenClaw options.actors[${index}]`)
  exactKeys(actor, ['agentId', 'sessionKey', 'workspaceRoot', 'actorId'], `OpenClaw options.actors[${index}]`)
  return Object.freeze({
    agentId: nonEmpty(actor.agentId, `OpenClaw options.actors[${index}].agentId`, 512),
    sessionKey: nonEmpty(actor.sessionKey, `OpenClaw options.actors[${index}].sessionKey`, 2_048),
    workspaceRoot: normalize(resolve(nonEmpty(actor.workspaceRoot, `OpenClaw options.actors[${index}].workspaceRoot`))),
    actorId: nonEmpty(actor.actorId, `OpenClaw options.actors[${index}].actorId`, 1_024),
  })
}
function normalizeHostExtensions(value: unknown): readonly HostExtensionSelectionInput[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError('OpenClaw options.hostExtensions must be an array')
  const ids = new Set<string>()
  return Object.freeze(value.map((candidate, index) => {
    const extension = object(candidate, `OpenClaw options.hostExtensions[${index}]`)
    exactKeys(extension, ['id', 'config'], `OpenClaw options.hostExtensions[${index}]`)
    const id = nonEmpty(extension.id, `OpenClaw options.hostExtensions[${index}].id`)
    if (ids.has(id)) throw new TypeError(`OpenClaw options.hostExtensions contains duplicate id ${JSON.stringify(id)}`)
    ids.add(id)
    const config = extension.config === undefined
      ? undefined
      : cloneJsonValue<JsonValue>(extension.config, `OpenClaw options.hostExtensions[${index}].config`, {
          maximumBytes: 65_536,
          maximumDepth: 16,
        })
    return Object.freeze({ id, ...(config === undefined ? {} : { config }) })
  }))
}


export function normalizeOpenClawOptions(input: unknown): OpenClawOptions {
  const root = input === undefined ? {} : object(input, 'OpenClaw options')
  exactKeys(root, ['roster', 'runtimePreset', 'warmupTimeoutMs', 'contextTokenBudget', 'actors', 'hostExtensions'], 'OpenClaw options')
  const runtimePreset = root.runtimePreset === undefined
    ? undefined
    : nonEmpty(root.runtimePreset, 'OpenClaw options.runtimePreset')
  const warmupTimeoutMs = root.warmupTimeoutMs === undefined
    ? DEFAULT_OPENCLAW_WARMUP_TIMEOUT_MS
    : boundedInteger(root.warmupTimeoutMs, 'OpenClaw options.warmupTimeoutMs', 100, 120_000)
  const contextTokenBudget = root.contextTokenBudget === undefined
    ? DEFAULT_OPENCLAW_CONTEXT_TOKEN_BUDGET
    : boundedInteger(root.contextTokenBudget, 'OpenClaw options.contextTokenBudget', 0, 1_000_000)
  if (root.actors !== undefined && !Array.isArray(root.actors)) {
    throw new TypeError('OpenClaw options.actors must be an array')
  }
  const actors = Object.freeze((root.actors ?? []).map(normalizeActor))
  const routes = new Set<string>()
  for (const actor of actors) {
    const key = `${actor.agentId}\u0000${actor.sessionKey}`
    if (routes.has(key)) throw new TypeError(`OpenClaw options.actors contains duplicate route ${JSON.stringify(actor.sessionKey)}`)
    routes.add(key)
  }
  const hostExtensions = normalizeHostExtensions(root.hostExtensions)
  return Object.freeze({
    roster: normalizeRoster(root.roster),
    ...(runtimePreset === undefined ? {} : { runtimePreset }),
    warmupTimeoutMs,
    contextTokenBudget,
    actors,
    ...(hostExtensions === undefined ? {} : { hostExtensions }),
  })
}
