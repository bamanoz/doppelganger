import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MEMORY_EMBEDDER_SERVICE } from '@doppelganger/doppelganger-memory'
import { LocalMemoryEmbedder, type LocalEmbeddingConfig } from './embedder.ts'

export type LocalEmbeddingPluginConfig = LocalEmbeddingConfig

export const LocalEmbeddingPluginConfigSchema: Schema<LocalEmbeddingPluginConfig> = Schema.object({
  model: Schema.union(['embeddinggemma-300m', 'all-MiniLM-L6-v2']),
  cacheDir: Schema.string().min(1).max(4_096),
  offline: Schema.boolean(),
  device: Schema.union(['cpu', 'coreml', 'cuda', 'webgpu']),
  batchSize: Schema.natural().min(1).max(128),
  maximumCharacters: Schema.natural().min(1).max(1_000_000),
  acquisitionTimeoutMs: Schema.natural().min(1).max(600_000),
})

export const LocalEmbeddingPlugin: Plugin<LocalEmbeddingPluginConfig> = {
  name: 'doppelganger-embedding-local',
  Config: LocalEmbeddingPluginConfigSchema as unknown as NonNullable<Plugin<LocalEmbeddingPluginConfig>['Config']>,
  provide: MEMORY_EMBEDDER_SERVICE,
  apply(ctx: Context, config: LocalEmbeddingPluginConfig = {}) {
    const embedder = new LocalMemoryEmbedder(config)
    ctx.provide(MEMORY_EMBEDDER_SERVICE, embedder)
    ctx.effect(() => async () => {
      await embedder.close()
    }, 'doppelgangerEmbeddingLocal.close')
  },
}

export default LocalEmbeddingPlugin
