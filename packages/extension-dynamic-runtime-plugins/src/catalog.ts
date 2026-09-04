import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, ToolDescriptor } from '@doppelganger/doppelganger-protocols'
import type { NormalizedDynamicRuntimePluginsConfig } from './config.ts'
import { RuntimePluginError, inputRecord, requiredString } from './errors.ts'
import { GENERATED_RUNTIME_PLUGIN_CATALOG } from './catalog.generated.ts'

export const APPROVED_SERVICE_NAMES: ReadonlySet<string> = Object.freeze(new Set(
  GENERATED_RUNTIME_PLUGIN_CATALOG.services.map(service => service.name),
))
export const APPROVED_EVENT_NAMES: ReadonlySet<string> = Object.freeze(new Set(
  GENERATED_RUNTIME_PLUGIN_CATALOG.events.map(event => event.name),
))

function jsonClone(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value))
}

function bounded(value: JsonValue, maximum: number): JsonValue {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maximum) {
    throw new RuntimePluginError('INSPECTION_LIMIT_EXCEEDED', `inspection output exceeds ${maximum} bytes`)
  }
  return value
}

function providers() {
  return [
    { provider: 'Builtin', description: 'Evaluator globals and guarded Context facade.', methods: [{ name: 'get', input: { name: 'string' }, output: 'Builtin contract' }] },
    { provider: 'Event', description: 'Approved lifecycle-safe Cordis events.', methods: [{ name: 'get', input: { name: 'string' }, output: 'Event contract' }] },
    { provider: 'Service', description: 'Approved guarded Runtime Session services.', methods: [{ name: 'get', input: { name: 'string' }, output: 'Service contract with live availability' }] },
    { provider: 'Tool', description: 'Current source-free portable tool descriptors.', methods: [{ name: 'get', input: { name: 'string' }, output: 'Portable tool descriptor' }] },
  ].map(provider => Object.freeze(provider))
}

export function inspectList(config: NormalizedDynamicRuntimePluginsConfig): JsonValue {
  return bounded(jsonClone(Object.freeze({ providers: Object.freeze(providers()) })), config.maximumInspectionBytes)
}

function toolView(descriptor: ToolDescriptor): JsonValue {
  return jsonClone(Object.freeze({
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    available: descriptor.available,
    ...(descriptor.approval === undefined ? {} : {
      approval: {
        policy: descriptor.approval.policy,
        ...(descriptor.approval.reason === undefined ? {} : { reason: descriptor.approval.reason }),
      },
    }),
  }))
}

export function inspectQuery(
  ctx: Context,
  input: JsonValue,
  config: NormalizedDynamicRuntimePluginsConfig,
): JsonValue {
  const record = inputRecord(input, ['provider', 'method', 'name'])
  const provider = requiredString(record, 'provider', 32)
  const method = requiredString(record, 'method', 64)
  const name = requiredString(record, 'name', 256)
  if (!['Builtin', 'Event', 'Service', 'Tool'].includes(provider) || method !== 'get') {
    throw new RuntimePluginError('INSPECT_NOT_FOUND', `uncatalogued inspection ${provider}.${method}`)
  }

  let result: JsonValue
  if (provider === 'Builtin') {
    const builtin = GENERATED_RUNTIME_PLUGIN_CATALOG.builtins.find(candidate => candidate.name === name)
    if (builtin === undefined) throw new RuntimePluginError('INSPECT_NOT_FOUND', `builtin "${name}" is not catalogued`)
    result = jsonClone(builtin)
  } else if (provider === 'Event') {
    const event = GENERATED_RUNTIME_PLUGIN_CATALOG.events.find(candidate => candidate.name === name)
    if (event === undefined) throw new RuntimePluginError('INSPECT_NOT_FOUND', `event "${name}" is not catalogued`)
    result = jsonClone(event)
  } else if (provider === 'Service') {
    const service = GENERATED_RUNTIME_PLUGIN_CATALOG.services.find(candidate => candidate.name === name)
    if (service === undefined) throw new RuntimePluginError('INSPECT_NOT_FOUND', `service "${name}" is not catalogued`)
    const referencedTypes = Object.fromEntries(service.referencedTypes.map(type => [
      type,
      GENERATED_RUNTIME_PLUGIN_CATALOG.referencedTypes[type as keyof typeof GENERATED_RUNTIME_PLUGIN_CATALOG.referencedTypes],
    ]))
    result = jsonClone({
      name: service.name,
      purpose: service.purpose,
      source: service.source,
      methods: service.methods,
      properties: service.properties,
      available: ctx.get(name) !== undefined,
      referencedTypes,
    })
  } else {
    const tools = ctx.doppelgangerTools.snapshot().tools
    const descriptor = tools.find(candidate => candidate.name === name)
    if (descriptor === undefined) throw new RuntimePluginError('INSPECT_NOT_FOUND', `tool "${name}" is not currently registered`)
    result = toolView(descriptor)
  }
  return bounded(result, config.maximumInspectionBytes)
}
