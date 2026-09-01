import { describe, expect, it } from 'vitest'
import { createChromaMemoryVectorIndex } from '../src/chroma.ts'

const endpoint = process.env.CHROMA_SMOKE_URL
const tokenEnv = process.env.CHROMA_SMOKE_TOKEN_ENV

describe.skipIf(endpoint === undefined)('Chroma production HTTP smoke', () => {
  it('creates, writes, filters, deletes, and cleans a server collection', async () => {
    const config = {
      endpoint: endpoint!, dimensions: 3,
      ...(process.env.CHROMA_SMOKE_TENANT === undefined ? {} : { tenant: process.env.CHROMA_SMOKE_TENANT }),
      ...(process.env.CHROMA_SMOKE_DATABASE === undefined ? {} : { database: process.env.CHROMA_SMOKE_DATABASE }),
      collection: `doppelganger-smoke-${Date.now()}`,
      ...(tokenEnv === undefined ? {} : { tokenEnv }),
      generationId: 'generation.smoke',
    }
    const index = await createChromaMemoryVectorIndex(config)
    try {
      const value = {
        generationId: 'generation.smoke', recordId: 'record.smoke', revisionId: 'revision.smoke',
        instanceId: 'instance.smoke', actorId: 'actor.smoke', scopeKind: 'relationship' as const,
        kind: 'fact' as const, subjectKey: 'subject.smoke', status: 'active' as const,
        vector: new Float32Array([1, 0, 0]),
      }
      await index.upsert([value])
      expect(await index.search({ generationId: value.generationId, vector: value.vector, filter: { instanceId: value.instanceId, actorId: value.actorId, scopeKind: 'relationship' }, limit: 1 })).toMatchObject([{ recordId: value.recordId }])
      await index.delete([value])
      expect(await index.search({ generationId: value.generationId, vector: value.vector, filter: { instanceId: value.instanceId, actorId: value.actorId }, limit: 1 })).toHaveLength(0)
    } finally {
      await index.maintenance('cleanup-generation')
      await index.close()
    }
  }, 30_000)
})
