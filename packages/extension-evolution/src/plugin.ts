import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { EvolutionProtocolPlugin } from './protocol.ts'
import { EvolutionService, type EvolutionServiceConfig } from './service.ts'

export type EvolutionPluginConfig = Omit<EvolutionServiceConfig, 'now' | 'id'>
const CONFIG_KEYS = new Set([
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`evolution.${key} is not supported`)
  }
}

export const EvolutionPluginConfigSchema: Schema<EvolutionPluginConfig> = Schema.object({
  namespace: Schema.string().min(1).max(256),
  remindersEnabled: Schema.boolean(),
  reminderCooldownDays: Schema.natural().min(7).max(3650),
  projectLockTimeoutMs: Schema.natural().min(100).max(60_000),
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
    await ctx.plugin(EvolutionService, config).await()
    await ctx.plugin(EvolutionProtocolPlugin).await()
  },
}

export default EvolutionPlugin
