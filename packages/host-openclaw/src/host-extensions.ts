import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createActorIdentityHostExtension,
  createHostExtensionCatalog,
  createRuntimeHostExtension,
  readHostExtensionModule,
  type HostExtensionDefinition,
  type HostExtensionPlan,
  type HostExtensionSelection,
  type HostExtensionSelectionInput,
  type HostExtensionSessionContext,
  type HostSessionFacts,
} from '@doppelganger/doppelganger-host-extensions'
import {
  canonicalJson,
  cloneJsonValue,
  isJsonObjectPrototype,
  type JsonValue,
  type RuntimeHostBinding,
  type RuntimeHostCapabilities,
} from '@doppelganger/doppelganger-protocols'

export const OPENCLAW_HOST_EXTENSION_ARTIFACT_VERSION = 1 as const

const JSON_LIMITS = Object.freeze({ maximumBytes: 1024 * 1024, maximumDepth: 32 })

export interface OpenClawHostSessionFacts extends HostSessionFacts {
  readonly hostKind: 'openclaw'
  readonly agentId: string
  readonly sessionKey: string
  readonly sessionId: string
  readonly workspaceRoot: string
}

export interface OpenClawHostExtensionConfiguration {
  readonly modules?: readonly string[]
  readonly enabled?: readonly HostExtensionSelectionInput[]
}

export interface PreparedOpenClawHostExtensionModule {
  readonly id: string
  readonly file: string
}

export interface PreparedOpenClawHostExtensions {
  readonly version: typeof OPENCLAW_HOST_EXTENSION_ARTIFACT_VERSION
  readonly modules: readonly PreparedOpenClawHostExtensionModule[]
  readonly availableIds: readonly string[]
  readonly defaultSelection: readonly HostExtensionSelection[]
  readonly fingerprint: string
}

export interface PreparedOpenClawHostExtensionBuild {
  readonly prepared: PreparedOpenClawHostExtensions
  readonly sourceFiles: readonly string[]
  readonly importedModules: readonly unknown[]
}

export interface OpenClawHostExtensionPlanInput {
  readonly selections?: readonly HostExtensionSelectionInput[]
  readonly binding: RuntimeHostBinding
  readonly capabilities: RuntimeHostCapabilities
  resolveActor(context: HostExtensionSessionContext<OpenClawHostSessionFacts>): unknown
}

export interface OpenClawHostExtensionRuntime {
  readonly prepared: PreparedOpenClawHostExtensions
  plan(input: OpenClawHostExtensionPlanInput): HostExtensionPlan<OpenClawHostSessionFacts>
}

export interface OpenClawActorRoute {
  readonly agentId: string
  readonly sessionKey: string
  readonly workspaceRoot: string
  readonly actorId: string
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  if (!isJsonObjectPrototype(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`)
  return value as Readonly<Record<string, unknown>>
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value.trim()
}

function exactKeys(value: Readonly<Record<string, unknown>>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional])
  const unsupported = Object.keys(value).filter(key => !allowed.has(key)).sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  const missing = required.filter(key => !(key in value))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

function moduleSpecifier(input: unknown, cwd: string): string {
  const specifier = nonEmpty(input, 'OpenClaw Host Extension module')
  if (specifier.startsWith('.') || specifier.startsWith('/')) return pathToFileURL(resolve(cwd, specifier)).href
  if (specifier.startsWith('file:')) return new URL(specifier).href
  return import.meta.resolve(specifier, pathToFileURL(resolve(cwd, 'package.json')).href)
}

async function importModules(specifiers: readonly string[]): Promise<unknown[]> {
  const modules: unknown[] = []
  for (const specifier of specifiers) {
    // Module specifiers are trusted preparation inputs and cannot be statically imported.
    modules.push(await import(specifier))
  }
  return modules
}

function standardDefinitions(
  binding: RuntimeHostBinding,
  capabilities: RuntimeHostCapabilities,
  resolveActor: (context: HostExtensionSessionContext<OpenClawHostSessionFacts>) => unknown,
): HostExtensionDefinition<OpenClawHostSessionFacts>[] {
  return [
    createActorIdentityHostExtension<OpenClawHostSessionFacts>({ hostKind: 'openclaw', actorId: resolveActor }),
    createRuntimeHostExtension<OpenClawHostSessionFacts>({ hostKind: 'openclaw', binding: () => binding, capabilities: () => capabilities }),
  ]
}

const inertBinding: RuntimeHostBinding = Object.freeze({ attach() {}, detach() {}, toolCatalogChanged() {} })
const inertCapabilities: RuntimeHostCapabilities = Object.freeze({
  protocolVersion: 2,
  context: Object.freeze({ delivery: 'per-turn' }),
  tools: Object.freeze({ delivery: 'session-start', requiredApproval: true, cancellation: true }),
  lifecycle: Object.freeze({ events: Object.freeze([]) }),
})

function artifactFingerprint(input: Omit<PreparedOpenClawHostExtensions, 'fingerprint'>): string {
  return createHash('sha256').update(canonicalJson(input as unknown as JsonValue)).digest('hex')
}

function standardPreparedHostExtensions(): PreparedOpenClawHostExtensions {
  const catalog = createHostExtensionCatalog('openclaw', standardDefinitions(inertBinding, inertCapabilities, () => undefined))
  const plan = catalog.plan([{ id: 'actor' }, { id: 'runtime-host' }])
  const withoutFingerprint = Object.freeze({
    version: OPENCLAW_HOST_EXTENSION_ARTIFACT_VERSION,
    modules: Object.freeze([]),
    availableIds: catalog.ids,
    defaultSelection: plan.selections,
  })
  return Object.freeze({ ...withoutFingerprint, fingerprint: artifactFingerprint(withoutFingerprint) })
}

export function createStandardOpenClawHostExtensionRuntime(): OpenClawHostExtensionRuntime {
  return createOpenClawHostExtensionRuntime(standardPreparedHostExtensions(), [])
}

export function createOpenClawActorResolver(
  routes: readonly OpenClawActorRoute[],
): (facts: OpenClawHostSessionFacts) => string | undefined {
  const actors = new Map(routes.map(route => [
    `${route.agentId}\u0000${route.sessionKey}\u0000${resolve(route.workspaceRoot)}`,
    route.actorId,
  ]))
  return facts => actors.get(`${facts.agentId}\u0000${facts.sessionKey}\u0000${facts.workspaceRoot}`)
}

export async function prepareOpenClawHostExtensions(
  input: OpenClawHostExtensionConfiguration | undefined,
  cwd: string,
): Promise<PreparedOpenClawHostExtensionBuild> {
  const sourceSpecifiers = Object.freeze((input?.modules ?? []).map(specifier => moduleSpecifier(specifier, cwd)))
  if (new Set(sourceSpecifiers).size !== sourceSpecifiers.length) {
    throw new TypeError('OpenClaw Host Extension modules contain duplicate resolved specifiers')
  }
  const importedModules = Object.freeze(await importModules(sourceSpecifiers))
  const customDefinitions = importedModules.map(module => readHostExtensionModule<OpenClawHostSessionFacts>(module))
  const catalog = createHostExtensionCatalog('openclaw', [
    ...standardDefinitions(inertBinding, inertCapabilities, () => undefined),
    ...customDefinitions,
  ])
  const plan = catalog.plan(input?.enabled ?? [{ id: 'actor' }, { id: 'runtime-host' }])
  const modules = Object.freeze(customDefinitions.map((definition, index) => Object.freeze({
    id: definition.id,
    file: `./host-extensions/${String(index).padStart(3, '0')}-${definition.id}.js`,
  })))
  const withoutFingerprint = Object.freeze({
    version: OPENCLAW_HOST_EXTENSION_ARTIFACT_VERSION,
    modules,
    availableIds: catalog.ids,
    defaultSelection: plan.selections,
  })
  const prepared = Object.freeze({ ...withoutFingerprint, fingerprint: artifactFingerprint(withoutFingerprint) })
  return Object.freeze({
    prepared,
    sourceFiles: Object.freeze(sourceSpecifiers.map(specifier => fileURLToPath(specifier))),
    importedModules,
  })
}

function selection(value: unknown, label: string): HostExtensionSelection {
  const record = object(value, label)
  exactKeys(record, ['id', 'config'], [], label)
  return Object.freeze({
    id: nonEmpty(record.id, `${label}.id`),
    config: cloneJsonValue<JsonValue>(record.config, `${label}.config`, JSON_LIMITS),
  })
}

export function validatePreparedOpenClawHostExtensions(input: unknown): PreparedOpenClawHostExtensions {
  const value = object(cloneJsonValue<JsonValue>(input, 'prepared OpenClaw Host Extensions', JSON_LIMITS), 'prepared OpenClaw Host Extensions')
  exactKeys(value, ['version', 'modules', 'availableIds', 'defaultSelection', 'fingerprint'], [], 'prepared OpenClaw Host Extensions')
  if (value.version !== OPENCLAW_HOST_EXTENSION_ARTIFACT_VERSION) {
    throw new TypeError(`unsupported prepared OpenClaw Host Extension version ${String(value.version)}`)
  }
  if (!Array.isArray(value.modules)) throw new TypeError('prepared OpenClaw Host Extensions.modules must be an array')
  const moduleIds = new Set<string>()
  const moduleFiles = new Set<string>()
  const modules = Object.freeze(value.modules.map((candidate, index): PreparedOpenClawHostExtensionModule => {
    const module = object(candidate, `prepared OpenClaw Host Extensions.modules[${index}]`)
    exactKeys(module, ['id', 'file'], [], `prepared OpenClaw Host Extensions.modules[${index}]`)
    const id = nonEmpty(module.id, `prepared OpenClaw Host Extensions.modules[${index}].id`)
    const file = nonEmpty(module.file, `prepared OpenClaw Host Extensions.modules[${index}].file`)
    if (!/^\.\/host-extensions\/[0-9]{3}-[a-z][a-z0-9-]*\.js$/u.test(file)) {
      throw new TypeError(`prepared OpenClaw Host Extensions.modules[${index}].file is invalid`)
    }
    if (moduleIds.has(id)) throw new TypeError(`prepared OpenClaw Host Extensions contains duplicate module id "${id}"`)
    if (moduleFiles.has(file)) throw new TypeError(`prepared OpenClaw Host Extensions contains duplicate module file "${file}"`)
    moduleIds.add(id)
    moduleFiles.add(file)
    return Object.freeze({ id, file })
  }))
  if (!Array.isArray(value.availableIds)) throw new TypeError('prepared OpenClaw Host Extensions.availableIds must be an array')
  const availableIds = Object.freeze(value.availableIds.map((id, index) => nonEmpty(id, `prepared OpenClaw Host Extensions.availableIds[${index}]`)))
  if (new Set(availableIds).size !== availableIds.length) throw new TypeError('prepared OpenClaw Host Extensions.availableIds must not contain duplicates')
  if (!Array.isArray(value.defaultSelection)) throw new TypeError('prepared OpenClaw Host Extensions.defaultSelection must be an array')
  const defaultSelection = Object.freeze(value.defaultSelection.map((item, index) => selection(item, `prepared OpenClaw Host Extensions.defaultSelection[${index}]`)))
  const fingerprint = nonEmpty(value.fingerprint, 'prepared OpenClaw Host Extensions.fingerprint')
  const withoutFingerprint = { version: OPENCLAW_HOST_EXTENSION_ARTIFACT_VERSION, modules, availableIds, defaultSelection }
  const expected = artifactFingerprint(withoutFingerprint)
  if (fingerprint !== expected) throw new TypeError('prepared OpenClaw Host Extension fingerprint mismatch')
  return Object.freeze({ ...withoutFingerprint, fingerprint })
}

export function createOpenClawHostExtensionRuntime(
  input: unknown,
  importedModules: readonly unknown[],
): OpenClawHostExtensionRuntime {
  const prepared = validatePreparedOpenClawHostExtensions(input)
  if (importedModules.length !== prepared.modules.length) {
    throw new TypeError('prepared OpenClaw Host Extension module count does not match imported modules')
  }
  const customDefinitions = Object.freeze(importedModules.map((module, index) => {
    const definition = readHostExtensionModule<OpenClawHostSessionFacts>(module)
    const expected = prepared.modules[index]!
    if (definition.id !== expected.id) {
      throw new TypeError(`prepared OpenClaw Host Extension module ${expected.file} exports id "${definition.id}" instead of "${expected.id}"`)
    }
    return definition
  }))
  return Object.freeze({
    prepared,
    plan(input: OpenClawHostExtensionPlanInput) {
      const catalog = createHostExtensionCatalog('openclaw', [
        ...standardDefinitions(input.binding, input.capabilities, input.resolveActor),
        ...customDefinitions,
      ])
      if (JSON.stringify(catalog.ids) !== JSON.stringify(prepared.availableIds)) {
        throw new TypeError('prepared OpenClaw Host Extension available IDs do not match imported definitions')
      }
      if (input.selections === undefined) return catalog.restore(prepared.defaultSelection)
      try {
        return catalog.plan(input.selections)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('unknown Host Extension id ')) {
          throw new TypeError(`${error.message}; regenerate the artifact and restart the OpenClaw plugin`, { cause: error })
        }
        throw error
      }
    },
  })
}
