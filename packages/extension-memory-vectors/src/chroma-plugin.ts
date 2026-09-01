import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MEMORY_VECTOR_INDEX_SERVICE } from '@doppelganger/doppelganger-memory'
import { createChromaMemoryVectorIndex, type ChromaConfig } from './chroma.ts'

export type ChromaVectorPluginConfig = Omit<ChromaConfig, 'client' | 'fetch'>

export const ChromaVectorPluginConfigSchema: Schema<ChromaVectorPluginConfig> = Schema.object({
  endpoint: Schema.string().min(1).max(2_048).required(),
  dimensions: Schema.natural().min(1).max(65_536).required(),
  namespace: Schema.string().min(1).max(256),
  tenant: Schema.string().min(1).max(256),
  database: Schema.string().min(1).max(256),
  collection: Schema.string().min(1).max(256),
  tokenEnv: Schema.string().pattern(/^[A-Z_][A-Z0-9_]*$/),
  generationId: Schema.string().min(1).max(256),
  configFingerprint: Schema.string().pattern(/^[a-f0-9]{64}$/),
  sanitizedTarget: Schema.string().min(1).max(512),
})

/** Loader-compatible Chroma vector-index entry point. Chroma always targets a server. */
export const ChromaVectorPlugin: Plugin<ChromaVectorPluginConfig> = {
  name: 'doppelganger-memory-vectors-chroma',
  Config: ChromaVectorPluginConfigSchema as unknown as NonNullable<Plugin<ChromaVectorPluginConfig>['Config']>,
  provide: MEMORY_VECTOR_INDEX_SERVICE,
  async apply(ctx: Context, config: ChromaVectorPluginConfig) {
    const index = await createChromaMemoryVectorIndex(config)
    ctx.provide(MEMORY_VECTOR_INDEX_SERVICE, index)
    ctx.effect(() => async () => { await index.close() }, 'doppelgangerMemoryVectors.chroma.close')
  },
}

export default ChromaVectorPlugin
