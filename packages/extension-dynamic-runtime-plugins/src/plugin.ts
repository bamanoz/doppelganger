import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@doppelganger/doppelganger-protocols'
import { inspectList, inspectQuery } from './catalog.ts'
import {
  DynamicRuntimePluginsConfigSchema,
  normalizeDynamicRuntimePluginsConfig,
  type DynamicRuntimePluginsConfig,
} from './config.ts'
import {
  inputRecord,
  optionalString,
  requiredExactString,
  requiredString,
  RuntimePluginError,
} from './errors.ts'
import { DynamicRuntimePluginRegistry } from './registry.ts'
import {
  defineSchema,
  inspectListSchema,
  inspectQuerySchema,
  inspectSelfSchema,
  pluginIdentitySchema,
  runSchema,
} from './schemas.ts'
import type { RuntimePluginMode } from './types.ts'

const RUN_APPROVAL_REASON = 'This exact runtime-plugin.run call evaluates the supplied pluginId, packageId, mode, name, purpose, and sourceDigest as generated JavaScript with process-level authority comparable to granting shell access. node:vm shapes the API but is not a security sandbox.'
function sameConfig(
  left: ReturnType<typeof normalizeDynamicRuntimePluginsConfig>,
  right: ReturnType<typeof normalizeDynamicRuntimePluginsConfig>,
): boolean {
  return left.vmTimeoutMs === right.vmTimeoutMs
    && left.maximumSourceBytes === right.maximumSourceBytes
    && left.maximumNameLength === right.maximumNameLength
    && left.maximumPurposeLength === right.maximumPurposeLength
    && left.maximumPlugins === right.maximumPlugins
    && left.maximumPackagesPerPlugin === right.maximumPackagesPerPlugin
    && left.maximumTotalSourceBytes === right.maximumTotalSourceBytes
    && left.maximumInspectionBytes === right.maximumInspectionBytes
    && left.maximumDiagnosticMessageLength === right.maximumDiagnosticMessageLength
    && left.maximumDiagnosticStackLength === right.maximumDiagnosticStackLength
}


function definitions(
  ctx: Context,
  registry: DynamicRuntimePluginRegistry,
  config: ReturnType<typeof normalizeDynamicRuntimePluginsConfig>,
): readonly ToolDefinition[] {
  return Object.freeze([
    {
      name: 'runtime-plugin.inspect-list',
      description: 'List the source-verified generated runtime capability providers and query methods',
      inputSchema: inspectListSchema,
      invoke(input, _context) {
        inputRecord(input, [])
        return inspectList(config)
      },
    },
    {
      name: 'runtime-plugin.inspect-query',
      description: 'Query one exact approved Service, Event, Builtin, or current Tool contract without invoking it',
      inputSchema: inspectQuerySchema,
      invoke: (input, _context) => inspectQuery(ctx, input, config),
    },
    {
      name: 'runtime-plugin.inspect-self',
      description: 'Inspect session-owned temporary Plugins, immutable Packages, pointers, source, and bounded diagnostics progressively',
      inputSchema: inspectSelfSchema,
      invoke(input, _context) {
        const record = inputRecord(input, ['pluginId', 'packageId'])
        const pluginId = optionalString(record, 'pluginId', 128)
        const packageId = optionalString(record, 'packageId', 128)
        return registry.inspect(pluginId, packageId)
      },
    },
    {
      name: 'runtime-plugin.define',
      description: 'Define one immutable bounded plain-JavaScript Package without evaluating or activating it',
      inputSchema: defineSchema(config.maximumNameLength, config.maximumPurposeLength, config.maximumSourceBytes),
      invoke(input, _context) {
        const record = inputRecord(input, ['pluginId', 'idPrefix', 'name', 'purpose', 'source'])
        const pluginId = optionalString(record, 'pluginId', 128)
        const idPrefix = optionalString(record, 'idPrefix', 32)
        if ((pluginId === undefined) === (idPrefix === undefined)) {
          throw new RuntimePluginError('INVALID_INPUT', 'define requires exactly one of pluginId or idPrefix')
        }
        return registry.define({
          plugin: pluginId === undefined
            ? { kind: 'new', idPrefix: idPrefix! }
            : { kind: 'existing', pluginId },
          name: requiredString(record, 'name', config.maximumNameLength),
          purpose: requiredString(record, 'purpose', config.maximumPurposeLength),
          source: requiredExactString(record, 'source'),
        })
      },
    },
    {
      name: 'runtime-plugin.run',
      description: 'After native one-shot approval, evaluate and activate one exact immutable generated Package',
      inputSchema: runSchema(config.maximumNameLength, config.maximumPurposeLength),
      approval: Object.freeze({ policy: 'required', reason: RUN_APPROVAL_REASON }),
      invoke(input, _context) {
        const record = inputRecord(input, ['pluginId', 'packageId', 'mode', 'name', 'purpose', 'sourceDigest'])
        const mode = requiredString(record, 'mode', 6)
        if (mode !== 'run' && mode !== 'update') throw new RuntimePluginError('INVALID_INPUT', 'mode must be "run" or "update"')
        return registry.run({
          pluginId: requiredString(record, 'pluginId', 128),
          packageId: requiredString(record, 'packageId', 128),
          mode: mode as RuntimePluginMode,
          name: requiredString(record, 'name', config.maximumNameLength),
          purpose: requiredString(record, 'purpose', config.maximumPurposeLength),
          sourceDigest: requiredString(record, 'sourceDigest', 71),
        })
      },
    },
    {
      name: 'runtime-plugin.stop',
      description: 'Idempotently stop one temporary Plugin while retaining immutable Packages and version pointers',
      inputSchema: pluginIdentitySchema,
      invoke(input, _context) {
        const record = inputRecord(input, ['pluginId'])
        return registry.stop(requiredString(record, 'pluginId', 128))
      },
    },
    {
      name: 'runtime-plugin.undefine',
      description: 'Stop and permanently remove one temporary Plugin and every Package from the current Runtime Session',
      inputSchema: pluginIdentitySchema,
      invoke(input, _context) {
        const record = inputRecord(input, ['pluginId'])
        return registry.undefine(requiredString(record, 'pluginId', 128))
      },
    },
  ] satisfies readonly ToolDefinition[])
}

export const DynamicRuntimePluginsPlugin: Plugin<DynamicRuntimePluginsConfig> = {
  name: 'doppelganger-dynamic-runtime-plugins',
  Config: DynamicRuntimePluginsConfigSchema as NonNullable<Plugin<DynamicRuntimePluginsConfig>['Config']>,
  inject: ['doppelgangerRuntimeSession', 'doppelgangerTools'],
  async apply(ctx: Context, input: DynamicRuntimePluginsConfig = {}) {
    const config = normalizeDynamicRuntimePluginsConfig(input)
    ctx.on('internal/update', (nextInput, _noSave, next) => {
      const nextConfig = normalizeDynamicRuntimePluginsConfig(nextInput)
      if (sameConfig(config, nextConfig)) return
      return next()
    })
    const group = ctx.plugin({ name: 'doppelganger-dynamic-runtime-plugin-runs', apply() {} })
    await group.await()
    const registry = new DynamicRuntimePluginRegistry(group, config)
    for (const definition of definitions(ctx, registry, config)) ctx.doppelgangerTools.register(definition)
    ctx.effect(() => () => registry.dispose(), 'dynamicRuntimePlugins.dispose')
  },
}

export default DynamicRuntimePluginsPlugin
