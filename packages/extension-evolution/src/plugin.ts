import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { STRUCTURED_INFERENCE_SERVICE } from '@doppelganger/doppelganger-protocols'
import { EvolutionProtocolPlugin } from './protocol.ts'
import { EvolutionService, type EvolutionServiceConfig } from './service.ts'
import {
  createEvolutionSignalCapturePlugin,
  isEvolutionSignalConfigKey,
  normalizeEvolutionSignalConfig,
  type EvolutionSignalConfigInput,
} from './signals.ts'

export type EvolutionPluginConfig = Omit<EvolutionServiceConfig, 'now' | 'id'> & EvolutionSignalConfigInput

const SERVICE_CONFIG_KEYS = new Set([
  'namespace',
  'remindersEnabled',
  'reminderCooldownDays',
  'projectLockTimeoutMs',
])

function validateConfig(config: EvolutionPluginConfig): void {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('evolution config must be an object')
  }
  for (const key of Object.keys(config)) {
    if (!SERVICE_CONFIG_KEYS.has(key) && !isEvolutionSignalConfigKey(key)) {
      throw new TypeError(`evolution.${key} is not supported`)
    }
  }
}

function serviceConfig(config: EvolutionPluginConfig): EvolutionServiceConfig {
  return Object.freeze({
    ...(config.namespace === undefined ? {} : { namespace: config.namespace }),
    ...(config.remindersEnabled === undefined ? {} : { remindersEnabled: config.remindersEnabled }),
    ...(config.reminderCooldownDays === undefined ? {} : { reminderCooldownDays: config.reminderCooldownDays }),
    ...(config.projectLockTimeoutMs === undefined ? {} : { projectLockTimeoutMs: config.projectLockTimeoutMs }),
  })
}

export const EvolutionPluginConfigSchema: Schema<EvolutionPluginConfig> = Schema.object({
  namespace: Schema.string().min(1).max(256),
  remindersEnabled: Schema.boolean().default(true),
  reminderCooldownDays: Schema.natural().min(7).max(3650).default(7),
  projectLockTimeoutMs: Schema.natural().min(100).max(60_000).default(2_000),
  proactiveSignalsEnabled: Schema.boolean().default(true),
  signalInferenceEnabled: Schema.boolean().default(false),
  signalMaxInputCharacters: Schema.natural().min(1).max(64_000).default(8_000),
  signalMaxOutputCharacters: Schema.natural().min(1).max(64_000).default(8_000),
  signalMaxToolOutcomesPerTurn: Schema.natural().max(128).default(16),
  signalQueueCapacity: Schema.natural().min(1).max(1_024).default(32),
  signalInferenceTimeoutMs: Schema.natural().min(100).max(600_000).default(30_000),
  signalRetentionDays: Schema.natural().min(7).max(3_650).default(90),
  signalMaxStoredOccurrences: Schema.natural().min(1).max(100_000).default(5_000),
  capabilityPromotionMinTurns: Schema.natural().min(3).max(100).default(3),
  personaPromotionMinSessions: Schema.natural().min(3).max(100).default(3),
  signalPromotionScore: Schema.natural().min(4).max(10).default(6),
})

export const EvolutionPlugin: Plugin<EvolutionPluginConfig> = {
  name: 'doppelganger-evolution',
  Config: EvolutionPluginConfigSchema as unknown as NonNullable<Plugin<EvolutionPluginConfig>['Config']>,
  provide: 'doppelgangerEvolution',
  inject: [
    'doppelgangerRuntimeSession',
    'doppelgangerActor',
    'doppelgangerPersona',
    'doppelgangerInstanceSqlite',
    'doppelgangerContext',
    'doppelgangerTools',
  ],
  async apply(ctx: Context, config: EvolutionPluginConfig = {}) {
    validateConfig(config)
    const signals = normalizeEvolutionSignalConfig(config)
    if (signals.signalInferenceEnabled && ctx.get(STRUCTURED_INFERENCE_SERVICE) === undefined) {
      throw new Error('Evolution signal inference requires doppelgangerInference in the same Runtime Session realm')
    }
    await ctx.plugin(EvolutionService, serviceConfig(config)).await()
    await ctx.plugin(EvolutionProtocolPlugin).await()
    if (signals.proactiveSignalsEnabled) {
      await ctx.plugin(createEvolutionSignalCapturePlugin(signals)).await()
    }
  },
}

export default EvolutionPlugin
