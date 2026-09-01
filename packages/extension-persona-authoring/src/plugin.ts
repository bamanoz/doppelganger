import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { PersonaActivation, PersonaAssetReloadEvent, PersonaAssetRevision } from '@doppelganger/doppelganger-persona'
import {
  ToolInvocationError,
  type JsonValue,
  type ToolRegistry,
} from '@doppelganger/doppelganger-protocols'
import {
  encodeReplacement,
  inspectPersonaAsset,
  personaAssetRevision,
  readPersonaAssetFile,
  replacePersonaAsset,
  type InspectedPersonaAsset,
  type PersonaAssetFile,
} from './asset.ts'
import { acquirePersonaAssetLock } from './lock.ts'

export type PersonaLogicalTarget = 'identity' | `trait:${string}`

export interface PersonaAuthoringConfig {
  readonly writableTargets: readonly `trait:${string}`[]
  readonly maximumAssetBytes?: number
  readonly hmrTimeoutMs?: number
  readonly lockTimeoutMs?: number
}

export interface NormalizedPersonaAuthoringConfig {
  readonly writableTargets: readonly `trait:${string}`[]
  readonly maximumAssetBytes: number
  readonly hmrTimeoutMs: number
  readonly lockTimeoutMs: number
}

interface PersonaTarget {
  readonly target: PersonaLogicalTarget
  readonly filename: string
  readonly writable: boolean
}

const DEFAULT_MAXIMUM_ASSET_BYTES = 64 * 1_024
const MAXIMUM_ASSET_BYTES = 1_024 * 1_024
const DEFAULT_HMR_TIMEOUT_MS = 3_000
const DEFAULT_LOCK_TIMEOUT_MS = 3_000
const MAXIMUM_WAIT_MS = 60_000
const MAXIMUM_RATIONALE_LENGTH = 2_048
const MAXIMUM_EVIDENCE_IDS = 16
const MAXIMUM_EVIDENCE_ID_LENGTH = 256
const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/

function inputObject(input: JsonValue, allowed: readonly string[]): Readonly<Record<string, JsonValue>> {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new ToolInvocationError('INVALID_INPUT', 'tool input must be an object')
  }
  const record = input as Readonly<Record<string, JsonValue>>
  const unknown = Object.keys(record).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new ToolInvocationError('INVALID_INPUT', `unsupported input field "${unknown[0]}"`)
  return record
}

function boundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${field} must be an integer between 1 and ${maximum}`)
  }
  return value as number
}

function writableTarget(value: unknown, index: number): `trait:${string}` {
  if (typeof value !== 'string' || value !== value.trim() || !value.startsWith('trait:')) {
    throw new TypeError(`writableTargets[${index}] must be a logical trait target`)
  }
  const name = value.slice('trait:'.length)
  if (name.length === 0 || name.length > 128 || name === '.' || name === '..'
    || /[\\/*?[\]{}!]/.test(name)) {
    throw new TypeError(`writableTargets[${index}] must be a safe logical trait target`)
  }
  return value as `trait:${string}`
}

export function normalizePersonaAuthoringConfig(input: unknown): NormalizedPersonaAuthoringConfig {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new TypeError('Persona Authoring config must be an object')
  }
  const config = input as Readonly<Record<string, unknown>>
  const allowed = ['writableTargets', 'maximumAssetBytes', 'hmrTimeoutMs', 'lockTimeoutMs']
  const unknown = Object.keys(config).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new TypeError(`Persona Authoring config contains unknown field "${unknown[0]}"`)
  if (!Array.isArray(config.writableTargets)) throw new TypeError('writableTargets must be an array')
  const targets = config.writableTargets.map(writableTarget)
  if (new Set(targets).size !== targets.length) throw new TypeError('writableTargets must be unique')
  return Object.freeze({
    writableTargets: Object.freeze(targets),
    maximumAssetBytes: boundedInteger(
      config.maximumAssetBytes,
      'maximumAssetBytes',
      DEFAULT_MAXIMUM_ASSET_BYTES,
      MAXIMUM_ASSET_BYTES,
    ),
    hmrTimeoutMs: boundedInteger(config.hmrTimeoutMs, 'hmrTimeoutMs', DEFAULT_HMR_TIMEOUT_MS, MAXIMUM_WAIT_MS),
    lockTimeoutMs: boundedInteger(config.lockTimeoutMs, 'lockTimeoutMs', DEFAULT_LOCK_TIMEOUT_MS, MAXIMUM_WAIT_MS),
  })
}

function activeTargets(persona: PersonaActivation, writableTargets: readonly `trait:${string}`[]): Map<string, PersonaTarget> {
  const targets = new Map<string, PersonaTarget>()
  if (persona.identity !== undefined) {
    targets.set('identity', Object.freeze({ target: 'identity', filename: persona.identity.path, writable: false }))
  }
  const traitCounts = new Map<string, number>()
  for (const trait of persona.traits) {
    const name = trait.name.trim()
    const target = `trait:${name}` as const
    traitCounts.set(target, (traitCounts.get(target) ?? 0) + 1)
    if (!targets.has(target)) {
      targets.set(target, Object.freeze({
        target,
        filename: trait.path,
        writable: writableTargets.includes(target),
      }))
    }
  }
  for (const target of writableTargets) {
    const count = traitCounts.get(target) ?? 0
    if (count !== 1) throw new TypeError(`writable target "${target}" must select exactly one active Persona trait`)
  }
  return targets
}

function logicalTarget(input: JsonValue): PersonaLogicalTarget {
  if (typeof input !== 'string' || (input !== 'identity' && !input.startsWith('trait:'))) {
    throw new ToolInvocationError('PERSONA_TARGET_UNKNOWN', 'Persona target is unknown')
  }
  return input as PersonaLogicalTarget
}

function selectedTarget(targets: Map<string, PersonaTarget>, input: JsonValue): PersonaTarget {
  const target = logicalTarget(input)
  const selected = targets.get(target)
  if (selected === undefined) throw new ToolInvocationError('PERSONA_TARGET_UNKNOWN', 'Persona target is unknown')
  return selected
}

interface ReloadWaiter {
  readonly promise: Promise<PersonaAssetReloadEvent | undefined>
  cancel(): void
}

interface PersonaReloadObserver {
  wait(url: string, revision: PersonaAssetRevision, timeoutMs: number): ReloadWaiter
  dispose(): void
}

function createPersonaReloadObserver(ctx: Context): PersonaReloadObserver {
  const pending = new Set<{
    readonly url: string
    readonly revision: PersonaAssetRevision
    finish(event: PersonaAssetReloadEvent | undefined): void
  }>()
  const remove = ctx.root.on('doppelganger/persona-asset-reloaded', event => {
    for (const waiter of [...pending]) {
      if (event.url === waiter.url && event.revision === waiter.revision) waiter.finish(event)
    }
  }, { global: true })
  return Object.freeze({
    wait(url: string, revision: PersonaAssetRevision, timeoutMs: number): ReloadWaiter {
      const { promise, resolve } = Promise.withResolvers<PersonaAssetReloadEvent | undefined>()
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const waiter = {
        url,
        revision,
        finish(event: PersonaAssetReloadEvent | undefined) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          pending.delete(waiter)
          resolve(event)
        },
      }
      pending.add(waiter)
      timer = setTimeout(() => waiter.finish(undefined), timeoutMs)
      return Object.freeze({ promise, cancel: () => waiter.finish(undefined) })
    },
    dispose() {
      remove()
      for (const waiter of [...pending]) waiter.finish(undefined)
    },
  })
}

async function restorePrevious(
  observer: PersonaReloadObserver,
  target: PersonaTarget,
  previous: InspectedPersonaAsset,
  candidateRevision: PersonaAssetRevision,
  config: NormalizedPersonaAuthoringConfig,
): Promise<void> {
  let current: PersonaAssetFile
  try {
    current = await readPersonaAssetFile(target.filename, config.maximumAssetBytes)
  } catch {
    throw new ToolInvocationError('PERSONA_ROLLBACK_UNCONFIRMED', 'Persona rollback could not inspect the candidate', {
      target: target.target,
      candidateRevision,
      restoredRevision: previous.revision,
    })
  }
  if (current.revision !== candidateRevision) {
    throw new ToolInvocationError('PERSONA_ROLLBACK_UNCONFIRMED', 'Persona asset changed before rollback', {
      target: target.target,
      candidateRevision,
      restoredRevision: previous.revision,
      observedRevision: current.revision,
    })
  }
  const waiter = observer.wait(previous.url, previous.revision, config.hmrTimeoutMs)
  try {
    await replacePersonaAsset(target.filename, previous.bytes, previous.mode)
    const event = await waiter.promise
    if (event?.outcome !== 'success') {
      let observedRevision: PersonaAssetRevision | undefined
      try {
        observedRevision = (await readPersonaAssetFile(target.filename, config.maximumAssetBytes)).revision
      } catch {
        observedRevision = undefined
      }
      throw new ToolInvocationError('PERSONA_ROLLBACK_UNCONFIRMED', 'Persona rollback was not confirmed by HMR', {
        target: target.target,
        candidateRevision,
        restoredRevision: previous.revision,
        ...(observedRevision === undefined ? {} : { observedRevision }),
      })
    }
  } finally {
    waiter.cancel()
  }
}

interface PersonaReviseInput {
  readonly target: PersonaLogicalTarget
  readonly expectedRevision: PersonaAssetRevision
  readonly replacement: string
  readonly rationale: string
  readonly evidenceIds: readonly string[]
}

function reviseInput(input: JsonValue): PersonaReviseInput {
  const record = inputObject(input, ['target', 'expectedRevision', 'replacement', 'rationale', 'evidenceIds'])
  const target = logicalTarget(record.target ?? null)
  if (typeof record.expectedRevision !== 'string' || !REVISION_PATTERN.test(record.expectedRevision)) {
    throw new ToolInvocationError('INVALID_INPUT', 'expectedRevision must be a lowercase SHA-256 revision')
  }
  if (typeof record.replacement !== 'string') throw new ToolInvocationError('INVALID_INPUT', 'replacement must be a string')
  if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0
    || record.rationale.length > MAXIMUM_RATIONALE_LENGTH) {
    throw new ToolInvocationError('INVALID_INPUT', `rationale must contain 1-${MAXIMUM_RATIONALE_LENGTH} characters`)
  }
  const rawEvidence = record.evidenceIds ?? []
  if (!Array.isArray(rawEvidence) || rawEvidence.length > MAXIMUM_EVIDENCE_IDS
    || rawEvidence.some(value => typeof value !== 'string' || value.trim().length === 0
      || value.length > MAXIMUM_EVIDENCE_ID_LENGTH)) {
    throw new ToolInvocationError(
      'INVALID_INPUT',
      `evidenceIds must contain at most ${MAXIMUM_EVIDENCE_IDS} non-empty bounded strings`,
    )
  }
  return Object.freeze({
    target,
    expectedRevision: record.expectedRevision as PersonaAssetRevision,
    replacement: record.replacement,
    rationale: record.rationale.trim(),
    evidenceIds: Object.freeze(rawEvidence as string[]),
  })
}

async function revisePersona(
  observer: PersonaReloadObserver,
  target: PersonaTarget,
  input: PersonaReviseInput,
  config: NormalizedPersonaAuthoringConfig,
): Promise<JsonValue> {
  if (!target.writable) throw new ToolInvocationError('PERSONA_TARGET_READ_ONLY', 'Persona target is read-only')
  const replacementBytes = encodeReplacement(input.replacement, config.maximumAssetBytes)
  const replacementRevision = personaAssetRevision(replacementBytes)
  const lock = await acquirePersonaAssetLock(target.filename, config.lockTimeoutMs)
  try {
    const current = await inspectPersonaAsset(target.filename, config.maximumAssetBytes)
    if (current.revision === replacementRevision) {
      return Object.freeze({ status: 'already-current', target: target.target, revision: replacementRevision })
    }
    if (current.revision !== input.expectedRevision) {
      throw new ToolInvocationError('PERSONA_REVISION_CONFLICT', 'Persona asset revision changed', {
        target: target.target,
        currentRevision: current.revision,
      })
    }

    const waiter = observer.wait(current.url, replacementRevision, config.hmrTimeoutMs)
    let candidateEvent: PersonaAssetReloadEvent | undefined
    try {
      await replacePersonaAsset(target.filename, replacementBytes, current.mode)
      candidateEvent = await waiter.promise
    } finally {
      waiter.cancel()
    }
    if (candidateEvent?.outcome === 'success') {
      return Object.freeze({ status: 'applied', target: target.target, revision: replacementRevision })
    }

    await restorePrevious(observer, target, current, replacementRevision, config)
    if (candidateEvent?.outcome === 'failed') {
      throw new ToolInvocationError('PERSONA_REVISION_REJECTED', 'Persona rejected the replacement', {
        target: target.target,
        candidateRevision: replacementRevision,
        restoredRevision: current.revision,
      })
    }
    throw new ToolInvocationError('PERSONA_HMR_TIMEOUT', 'Persona replacement was not confirmed before timeout', {
      target: target.target,
      candidateRevision: replacementRevision,
      restoredRevision: current.revision,
    })
  } finally {
    await lock.release()
  }
}

const inspectSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({ target: Object.freeze({ type: 'string' }) }),
  required: Object.freeze(['target']),
  additionalProperties: false,
})

const reviseSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    target: Object.freeze({ type: 'string' }),
    expectedRevision: Object.freeze({ type: 'string', pattern: '^sha256:[0-9a-f]{64}$' }),
    replacement: Object.freeze({ type: 'string' }),
    rationale: Object.freeze({ type: 'string', minLength: 1, maxLength: MAXIMUM_RATIONALE_LENGTH }),
    evidenceIds: Object.freeze({
      type: 'array',
      maxItems: MAXIMUM_EVIDENCE_IDS,
      items: Object.freeze({ type: 'string', minLength: 1, maxLength: MAXIMUM_EVIDENCE_ID_LENGTH }),
    }),
  }),
  required: Object.freeze(['target', 'expectedRevision', 'replacement', 'rationale']),
  additionalProperties: false,
})

function registerTools(
  ctx: Context,
  tools: ToolRegistry,
  targets: Map<string, PersonaTarget>,
  config: NormalizedPersonaAuthoringConfig,
): void {
  const observer = createPersonaReloadObserver(ctx)
  let mutationQueue = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  tools.register({
    name: 'persona.inspect',
    description: 'Inspect one active Persona asset by logical target',
    inputSchema: inspectSchema,
    async invoke(input) {
      const record = inputObject(input, ['target'])
      const target = selectedTarget(targets, record.target ?? null)
      const asset = await inspectPersonaAsset(target.filename, config.maximumAssetBytes)
      return Object.freeze({
        target: target.target,
        writable: target.writable,
        content: asset.content,
        revision: asset.revision,
      })
    },
  })

  tools.register({
    name: 'persona.revise',
    description: 'Replace one configured writable Persona trait using exact revision compare-and-swap',
    inputSchema: reviseSchema,
    approval: Object.freeze({
      policy: 'required',
      reason: 'This changes active Persona instructions.',
    }),
    invoke(input) {
      const command = reviseInput(input)
      const target = selectedTarget(targets, command.target)
      return enqueue(() => revisePersona(observer, target, command, config))
    },
  })

  ctx.effect(() => async () => {
    try {
      await mutationQueue
    } finally {
      observer.dispose()
    }
  }, 'personaAuthoring.drainMutations')
}

export const PersonaAuthoringPlugin: Plugin<PersonaAuthoringConfig> = {
  name: 'doppelganger-persona-authoring',
  inject: ['doppelgangerPersona', 'doppelgangerTools'],
  async apply(ctx: Context, input: PersonaAuthoringConfig) {
    const config = normalizePersonaAuthoringConfig(input)
    const targets = activeTargets(ctx.doppelgangerPersona, config.writableTargets)
    for (const target of targets.values()) {
      if (target.writable) await inspectPersonaAsset(target.filename, config.maximumAssetBytes)
    }
    registerTools(ctx, ctx.doppelgangerTools, targets, config)
  },
}

export default PersonaAuthoringPlugin
