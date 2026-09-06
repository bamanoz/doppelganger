import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { activateMemoryRepository } from './persistence/provider.ts'
import type { SqliteMemoryConfig } from './persistence/config.ts'

export type SqliteMemoryPluginConfig = Omit<SqliteMemoryConfig, 'kind'>
export const SqliteMemoryPluginConfigSchema: Schema<SqliteMemoryPluginConfig> = Schema.object({
  home: Schema.string().min(1).max(4_096).required(),
  namespace: Schema.string().min(1).max(128),
  busyTimeoutMs: Schema.natural().min(0).max(120_000),
})

export const SqliteMemoryPlugin: Plugin<SqliteMemoryPluginConfig> = {
  name: 'doppelganger-memory-sqlite',
  Config: SqliteMemoryPluginConfigSchema as unknown as NonNullable<Plugin<SqliteMemoryPluginConfig>['Config']>,
  provide: 'doppelgangerMemoryRepository',
  inject: ['doppelgangerActor'],
  async apply(ctx: Context, config: SqliteMemoryPluginConfig) {
    if (config === null || typeof config !== 'object' || Array.isArray(config) || 'kind' in config) throw new TypeError('invalid SQLite memory provider configuration')
    await activateMemoryRepository(ctx, { ...config, kind: 'sqlite' })
  },
}

export default SqliteMemoryPlugin
