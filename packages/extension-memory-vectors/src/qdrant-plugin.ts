import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MEMORY_VECTOR_INDEX_SERVICE } from '@doppelganger/doppelganger-memory'
import { createQdrantMemoryVectorIndex, type QdrantConfig } from './qdrant.ts'

export type QdrantVectorPluginConfig = Omit<QdrantConfig, 'client' | 'clientFactory' | 'endpoint' | 'url'> & {
  readonly url: string
}

export const QdrantVectorPluginConfigSchema: Schema<QdrantVectorPluginConfig> = Schema.object({
  url: Schema.string().min(1).max(2_048).required(),
  dimensions: Schema.natural().min(1).max(65_536).required(),
  namespace: Schema.string().min(1).max(256),
  apiKeyEnv: Schema.string().pattern(/^[A-Z_][A-Z0-9_]*$/),
  generationId: Schema.string().min(1).max(256),
  collectionName: Schema.string().min(1).max(255),
  configFingerprint: Schema.string().pattern(/^[a-f0-9]{64}$/),
  sanitizedTarget: Schema.string().min(1).max(512),
  cleanupOnClose: Schema.boolean(),
})

/** Loader-compatible Qdrant vector-index entry point. */
export const QdrantVectorPlugin: Plugin<QdrantVectorPluginConfig> = {
  name: 'doppelganger-memory-vectors-qdrant',
  Config: QdrantVectorPluginConfigSchema as unknown as NonNullable<Plugin<QdrantVectorPluginConfig>['Config']>,
  provide: MEMORY_VECTOR_INDEX_SERVICE,
  async apply(ctx: Context, config: QdrantVectorPluginConfig) {
    const index = await createQdrantMemoryVectorIndex(config)
    ctx.provide(MEMORY_VECTOR_INDEX_SERVICE, index)
    ctx.effect(() => async () => { await index.close() }, 'doppelgangerMemoryVectors.qdrant.close')
  },
}

export default QdrantVectorPlugin
