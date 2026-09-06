import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { activateMemoryRepository } from './persistence/provider.ts'
import type { PostgresqlMemoryConfig } from './persistence/config.ts'

export type PostgresqlMemoryPluginConfig = Omit<PostgresqlMemoryConfig, 'kind'>
export const PostgresqlMemoryPluginConfigSchema: Schema<PostgresqlMemoryPluginConfig> = Schema.object({
  connectionStringEnv: Schema.string().min(1).max(256).required(),
  schema: Schema.string().min(1).max(63).required(),
  poolSize: Schema.natural().min(1).max(64),
  connectionTimeoutMs: Schema.natural().min(1).max(120_000),
  statementTimeoutMs: Schema.natural().min(1).max(600_000),
  lockTimeoutMs: Schema.natural().min(1).max(120_000),
})

export const PostgresqlMemoryPlugin: Plugin<PostgresqlMemoryPluginConfig> = {
  name: 'doppelganger-memory-postgresql',
  Config: PostgresqlMemoryPluginConfigSchema as unknown as NonNullable<Plugin<PostgresqlMemoryPluginConfig>['Config']>,
  provide: 'doppelgangerMemoryRepository',
  inject: ['doppelgangerActor'],
  async apply(ctx: Context, config: PostgresqlMemoryPluginConfig) {
    if (config === null || typeof config !== 'object' || Array.isArray(config) || 'kind' in config) throw new TypeError('invalid PostgreSQL memory provider configuration')
    await activateMemoryRepository(ctx, { ...config, kind: 'postgresql' })
  },
}

export default PostgresqlMemoryPlugin
