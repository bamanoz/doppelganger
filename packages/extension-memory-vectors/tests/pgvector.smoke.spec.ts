import { afterAll, describe, expect, it } from 'vitest'
import { createPgVectorMemoryVectorIndex } from '../src/pgvector.ts'

const dsnEnv = 'DOPPELGANGER_TEST_PGVECTOR_DSN'
const enabled = typeof process.env[dsnEnv] === 'string' && process.env[dsnEnv]!.length > 0
const describePgVector = enabled ? describe : describe.skip
const namespace = `smoke.${process.pid}.${Date.now()}`
const identity = { generationId: 'generation.smoke', recordId: 'record.smoke', revisionId: 'revision.smoke' }

describePgVector('pgvector real service smoke', () => {
  let index: Awaited<ReturnType<typeof createPgVectorMemoryVectorIndex>> | undefined

  afterAll(async () => {
    await index?.close()
  })

  it('creates, upserts, filters, searches, deletes, and closes', async () => {
    index = await createPgVectorMemoryVectorIndex({
      dsnEnv,
      dimensions: 3,
      namespace,
      sanitizedTarget: 'environment-gated PostgreSQL pgvector service',
      hnsw: {},
    })
    await index.upsert([{
      ...identity,
      instanceId: 'instance.smoke',
      actorId: 'actor.smoke',
      scopeKind: 'relationship',
      kind: 'fact',
      subjectKey: 'smoke.subject',
      status: 'active',
      vector: new Float32Array([1, 0, 0]),
    }])
    expect(await index.search({
      generationId: identity.generationId,
      vector: new Float32Array([1, 0, 0]),
      filter: { instanceId: 'instance.smoke', actorId: 'actor.smoke', scopeKind: 'relationship' },
      limit: 1,
    })).toMatchObject([{ ...identity, score: 1 }])
    expect((await index.maintenance('build-index')).outcome).toMatch(/ran|noop/u)
    await index.delete([identity])
    expect(await index.search({
      generationId: identity.generationId,
      vector: new Float32Array([1, 0, 0]),
      filter: { instanceId: 'instance.smoke', actorId: 'actor.smoke' },
      limit: 1,
    })).toEqual([])
    expect((await index.maintenance('cleanup-generation')).outcome).toBe('ran')
  })
})
