import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MemoryProtocolPlugin } from './protocol.ts'
import { MemoryService, type MemoryServiceConfig } from './service.ts'

export type MemoryPluginConfig = Omit<MemoryServiceConfig, 'now' | 'id'>
const MEMORY_PLUGIN_CONFIG_KEYS = new Set([
  'namespace',
  'automaticPromotionDistinctSessions',
  'lexicalTopK',
  'semanticTopK',
  'semanticQueryMaximumCharacters',
  'semanticTimeoutMs',
])

function validateConfig(config: MemoryPluginConfig): void {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('memory config must be an object')
  }
  for (const key of Object.keys(config)) {
    if (!MEMORY_PLUGIN_CONFIG_KEYS.has(key)) throw new TypeError(`memory.${key} is not supported`)
  }
}


export const MemoryPluginConfigSchema: Schema<MemoryPluginConfig> = Schema.object({
  namespace: Schema.string().min(1).max(256),
  automaticPromotionDistinctSessions: Schema.natural().min(2).max(100),
  lexicalTopK: Schema.natural().min(1).max(10_000),
  semanticTopK: Schema.natural().min(1).max(10_000),
  semanticQueryMaximumCharacters: Schema.natural().min(1).max(1_000_000),
  semanticTimeoutMs: Schema.natural().min(1).max(120_000),
})

export const MemoryPlugin: Plugin<MemoryPluginConfig> = {
  name: 'doppelganger-memory',
  Config: MemoryPluginConfigSchema as unknown as NonNullable<Plugin<MemoryPluginConfig>['Config']>,
  provide: 'doppelgangerMemory',
  inject: [
    'doppelgangerActor',
    'doppelgangerPersona',
    'doppelgangerContext',
    'doppelgangerTools',
    'doppelgangerInstanceSqlite',
  ],
  async apply(ctx: Context, config: MemoryPluginConfig = {}) {
    validateConfig(config)
    await ctx.plugin(MemoryService, config).await()
    await ctx.plugin(MemoryProtocolPlugin).await()
  },
}

export default MemoryPlugin
