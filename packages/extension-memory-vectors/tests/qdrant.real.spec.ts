import { describe, expect, it } from 'vitest'
import { createQdrantMemoryVectorIndex } from '../src/qdrant.ts'

const url = process.env.QDRANT_URL
const apiKeyEnv = process.env.QDRANT_API_KEY === undefined ? undefined : 'QDRANT_API_KEY'
const smoke = url === undefined ? describe.skip : describe

smoke('Qdrant real service smoke', () => {
  it('creates, upserts, filters, deletes, and tears down through the official client', async () => {
    const index = await createQdrantMemoryVectorIndex({
      url: url!, dimensions: 3, namespace: `smoke_${Date.now()}`, cleanupOnClose: true,
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    })
    const value = {
      generationId: 'generation.smoke', recordId: 'record.smoke', revisionId: 'revision.smoke',
      instanceId: 'instance.smoke', actorId: 'actor.smoke', scopeKind: 'relationship' as const,
      kind: 'fact' as const, subjectKey: 'subject.smoke', status: 'active' as const,
      vector: new Float32Array([1, 0, 0]),
    }
    try {
      await index.upsert([value])
      expect(await index.search({ generationId: value.generationId, vector: value.vector, filter: { instanceId: value.instanceId, actorId: value.actorId }, limit: 1 })).toMatchObject([{ recordId: value.recordId }])
      await index.delete([value])
      expect(await index.search({ generationId: value.generationId, vector: value.vector, filter: { instanceId: value.instanceId, actorId: value.actorId }, limit: 1 })).toHaveLength(0)
    } finally {
      await index.close()
    }
  })
})
