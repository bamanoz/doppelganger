import { isAbsolute } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import { cloneJsonValue, isJsonObjectPrototype, type JsonValue } from '@doppelganger/doppelganger-protocols'
import {
  HOST_EXTENSION_API_VERSION,
  type HostExtensionCatalog,
  type HostExtensionDefinition,
  type HostExtensionEntry,
  type HostExtensionFactory,
  type HostExtensionModule,
  type HostExtensionPlan,
  type HostExtensionSelection,
  type HostExtensionSelectionInput,
  type HostExtensionSessionContext,
  type HostSessionFacts,
} from './contracts.ts'

const HOST_EXTENSION_JSON_LIMITS = Object.freeze({ maximumBytes: 65_536, maximumDepth: 16 })
const definedHostExtensions = new WeakSet<object>()
const HOST_EXTENSION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u

function nonEmpty(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value.trim()
}

function extensionId(value: unknown, label = 'Host Extension id'): string {
  const id = nonEmpty(label, value)
  if (!HOST_EXTENSION_ID.test(id)) throw new TypeError(`${label} must be lowercase kebab-case`)
  return id
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  if (!isJsonObjectPrototype(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`)
  return value as Readonly<Record<string, unknown>>
}

function facts(value: unknown): HostSessionFacts {
  const cloned = cloneJsonValue<JsonValue>(value, 'Host Extension session facts', HOST_EXTENSION_JSON_LIMITS)
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new TypeError('Host Extension session facts must be an object')
  }
  return cloned as HostSessionFacts
}

function sessionContext<Facts extends HostSessionFacts>(
  input: HostExtensionSessionContext<Facts>,
  expectedHostKind: string,
): HostExtensionSessionContext<Facts> {
  const sessionId = nonEmpty('Host Extension sessionId', input.sessionId)
  const runtimePresetId = nonEmpty('Host Extension runtimePresetId', input.runtimePresetId)
  const workspaceRoot = input.workspaceRoot === undefined ? undefined : nonEmpty('Host Extension workspaceRoot', input.workspaceRoot)
  if (workspaceRoot !== undefined && !isAbsolute(workspaceRoot)) {
    throw new TypeError('Host Extension workspaceRoot must be absolute')
  }
  const clonedFacts = facts(input.facts) as Facts
  const actualHostKind = extensionId(clonedFacts.hostKind, 'Host Extension session facts.hostKind')
  if (actualHostKind !== expectedHostKind) {
    throw new TypeError(`Host Extension session facts target host "${actualHostKind}" instead of "${expectedHostKind}"`)
  }
  return Object.freeze({
    sessionId,
    runtimePresetId,
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    facts: clonedFacts,
  })
}

function pluginObject(plugin: Plugin, label: string): object {
  if ((typeof plugin !== 'object' || plugin === null) && typeof plugin !== 'function') {
    throw new TypeError(`${label}.plugin must be a Cordis plugin`)
  }
  return plugin
}

function entry(input: HostExtensionEntry, label: string): HostExtensionEntry {
  const plugin = pluginObject(input.plugin, label) as Plugin
  if (input.isolate === undefined) return Object.freeze({ plugin })
  const isolate = object(input.isolate, `${label}.isolate`)
  const normalized: Record<string, 'session'> = Object.create(null)
  for (const [service, realm] of Object.entries(isolate)) {
    const name = nonEmpty(`${label}.isolate service`, service)
    if (realm !== 'session') throw new TypeError(`${label}.isolate.${name} must equal "session"`)
    normalized[name] = 'session'
  }
  return Object.freeze({ plugin, isolate: Object.freeze(normalized) })
}

export function defineHostExtension<Facts extends HostSessionFacts>(
  input: HostExtensionDefinition<Facts>,
): HostExtensionDefinition<Facts> {
  if (definedHostExtensions.has(input)) return input
  if (input.apiVersion !== HOST_EXTENSION_API_VERSION) {
    throw new TypeError(`unsupported Host Extension API version ${String(input.apiVersion)}`)
  }
  const hostKind = extensionId(input.hostKind, 'Host Extension hostKind')
  const id = extensionId(input.id)
  const title = input.title === undefined ? undefined : nonEmpty(`Host Extension ${id} title`, input.title)
  if (typeof input.normalizeConfig !== 'function') throw new TypeError(`Host Extension ${id} normalizeConfig must be a function`)
  if (typeof input.createFactory !== 'function') throw new TypeError(`Host Extension ${id} createFactory must be a function`)
  const normalizeConfig = input.normalizeConfig.bind(input)
  const createFactory = input.createFactory.bind(input)
  const definition = Object.freeze({
    apiVersion: HOST_EXTENSION_API_VERSION,
    hostKind,
    id,
    ...(title === undefined ? {} : { title }),
    normalizeConfig,
    createFactory,
  })
  definedHostExtensions.add(definition)
  return definition
}

export function defineHostExtensionModule<Facts extends HostSessionFacts>(
  definition: HostExtensionDefinition<Facts>,
): HostExtensionModule<Facts> {
  return Object.freeze({ hostExtension: defineHostExtension(definition) })
}

export function readHostExtensionModule<Facts extends HostSessionFacts>(input: unknown): HostExtensionDefinition<Facts> {
  const module = object(input, 'Host Extension module')
  if (!('hostExtension' in module)) throw new TypeError('Host Extension module must export hostExtension')
  return defineHostExtension(module.hostExtension as HostExtensionDefinition<Facts>)
}

export function createHostExtensionCatalog<Facts extends HostSessionFacts>(
  hostKindInput: string,
  input: readonly HostExtensionDefinition<Facts>[],
): HostExtensionCatalog<Facts> {
  const hostKind = extensionId(hostKindInput, 'Host Extension catalog hostKind')
  const definitions = input.map(definition => defineHostExtension(definition)).sort((left, right) => left.id.localeCompare(right.id))
  const byId = new Map<string, HostExtensionDefinition<Facts>>()
  for (const definition of definitions) {
    if (definition.hostKind !== hostKind) {
      throw new TypeError(`Host Extension ${definition.id} targets host "${definition.hostKind}" instead of "${hostKind}"`)
    }
    if (byId.has(definition.id)) throw new TypeError(`duplicate available Host Extension id "${definition.id}"`)
    byId.set(definition.id, definition)
  }
  const frozenDefinitions = Object.freeze(definitions)
  const ids = Object.freeze(definitions.map(definition => definition.id))

  const buildPlan = (
    inputSelections: readonly HostExtensionSelectionInput[] | readonly HostExtensionSelection[],
    normalized: boolean,
  ): HostExtensionPlan<Facts> => {
    if (!Array.isArray(inputSelections)) throw new TypeError('Host Extension selection must be an array')
    const selectedIds = new Set<string>()
    const selections: HostExtensionSelection[] = []
    const factories: HostExtensionFactory<Facts>[] = []
    for (let index = 0; index < inputSelections.length; index += 1) {
      const selection = object(inputSelections[index], `Host Extension selection[${index}]`)
      const id = extensionId(selection.id, `Host Extension selection[${index}].id`)
      if (selectedIds.has(id)) throw new TypeError(`duplicate selected Host Extension id "${id}"`)
      selectedIds.add(id)
      const definition = byId.get(id)
      if (definition === undefined) throw new TypeError(`unknown Host Extension id "${id}"`)
      const candidateConfig = normalized ? selection.config : definition.normalizeConfig(selection.config)
      const config = cloneJsonValue<JsonValue>(candidateConfig, `Host Extension ${id} config`, HOST_EXTENSION_JSON_LIMITS)
      const factory = definition.createFactory(config)
      if (typeof factory !== 'function') throw new TypeError(`Host Extension ${id} createFactory must return a function`)
      selections.push(Object.freeze({ id, config }))
      factories.push(factory)
    }
    const frozenSelections = Object.freeze(selections)
    const usedPlugins = new WeakSet<object>()
    return Object.freeze({
      hostKind,
      selections: frozenSelections,
      instantiate(inputContext: HostExtensionSessionContext<Facts>) {
        const context = sessionContext(inputContext, hostKind)
        const entries = factories.map((factory, index) => {
          const selection = frozenSelections[index]!
          const created = entry(factory(context), `Host Extension ${selection.id}`)
          const plugin = pluginObject(created.plugin, `Host Extension ${selection.id}`)
          if (usedPlugins.has(plugin)) {
            throw new Error(`Host Extension ${selection.id} reused a plugin object across Runtime Sessions`)
          }
          usedPlugins.add(plugin)
          return Object.freeze({ id: selection.id, ...created })
        })
        return Object.freeze({ entries: Object.freeze(entries) })
      },
    })
  }

  const plan = (inputSelections: readonly HostExtensionSelectionInput[]) => buildPlan(inputSelections, false)
  const restore = (inputSelections: readonly HostExtensionSelection[]) => buildPlan(inputSelections, true)

  return Object.freeze({ hostKind, definitions: frozenDefinitions, ids, plan, restore })

}
