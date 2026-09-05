import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MEMORY_VECTOR_INDEX_SERVICE } from '@doppelganger/doppelganger-memory'
import { createPgVectorMemoryVectorIndex, type PgVectorConfig } from './pgvector.ts'

export type PgVectorPluginConfig = Omit<PgVectorConfig, 'environment' | 'runtimeLoader'>

const PgVectorHnswConfigSchema = Schema.object({
  m: Schema.natural().min(1).max(100),
  efConstruction: Schema.natural().min(1).max(1_000),
})

export const PgVectorPluginConfigSchema: Schema<PgVectorPluginConfig> = Schema.object({
  dsnEnv: Schema.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).required(),
  dimensions: Schema.natural().min(1).max(65_536).required(),
  namespace: Schema.string().min(1).max(256),
  sanitizedTarget: Schema.string().min(1).max(512),
  configFingerprint: Schema.string().pattern(/^[a-f0-9]{64}$/),
  connectionTimeoutMs: Schema.natural().min(1).max(300_000),
  poolSize: Schema.natural().min(1).max(100),
  hnsw: PgVectorHnswConfigSchema,
})

export const PgVectorPlugin: Plugin<PgVectorPluginConfig> = {
  name: 'doppelganger-memory-vectors-pgvector',
  Config: PgVectorPluginConfigSchema as unknown as NonNullable<Plugin<PgVectorPluginConfig>['Config']>,
  provide: MEMORY_VECTOR_INDEX_SERVICE,
  async apply(ctx: Context, config: PgVectorPluginConfig) {
    const logger = ctx.logger('doppelganger-memory-vectors-pgvector')
    logger.info('component.activation.started')
    const index = await createPgVectorMemoryVectorIndex(config)
    ctx.provide(MEMORY_VECTOR_INDEX_SERVICE, index)
    logger.info('component.active')
    ctx.effect(() => async () => {
      logger.info('component.disposal.started')
      await index.close()
      logger.info('component.disposal.completed')
    }, 'doppelgangerMemoryVectors.pgvector.close')
  },
}

export default PgVectorPlugin
