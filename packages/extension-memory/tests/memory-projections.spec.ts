import { afterEach, describe, expect, it } from 'vitest'
import {
  memoryProjectionOwner,
  memorySemanticGenerationId,
  type MemoryEmbedderIdentity,
  type MemoryProjectionOwner,
  type MemoryVectorIndexIdentity,
} from '../src/index.ts'
import {
  createMemoryBackendFixture,
  type MemoryBackendFixture,
  type MemoryBackendKind,
  type MemoryBackendSession,
} from './memory-backend-fixture.ts'

const timestamp = '2026-08-29T00:00:00.000Z'
const leaseUntil = '2026-08-29T00:01:00.000Z'
const transitionUntil = '2026-08-29T00:10:00.000Z'
const backends: MemoryBackendFixture[] = []

const embedder: MemoryEmbedderIdentity = Object.freeze({
  provider: 'projection-test',
  modelId: 'projection-model',
  revision: '1',
  artifactDigest: `sha256:${'a'.repeat(64)}`,
  pooling: 'mean',
  projection: 'none',
  dimensions: 3,
  normalized: true,
  distanceMetric: 'cosine',
})
const vectorIndex: MemoryVectorIndexIdentity = Object.freeze({
  backend: 'sqlite_exact',
  namespace: 'projection-test',
  sanitizedTarget: 'memory',
  configFingerprint: 'b'.repeat(64),
  dimensions: 3,
  distanceMetric: 'cosine',
})
const generationId = memorySemanticGenerationId('aiden', embedder, vectorIndex)

interface ProjectionFixture {
  readonly session: MemoryBackendSession
  readonly owner: MemoryProjectionOwner
}

interface ProjectionRow extends Record<string, unknown> {
  readonly id: string
  readonly generation_id: string
  readonly record_id: string
  readonly revision_id: string
  readonly vector_backend: string
  readonly vector_target_id: string
  readonly state: string
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map(backend => backend.close()))
})

async function rows(session: MemoryBackendSession, table: 'memory_vector_projection_work' | 'memory_vector_deletions'): Promise<readonly ProjectionRow[]> {
  return session.database.read(async em => await em.execute(
    `SELECT id, generation_id, record_id, revision_id, vector_backend, vector_target_id, state FROM ${table} ORDER BY created_at, id`,
    [],
    'all',
  ) as readonly ProjectionRow[])
}

async function count(session: MemoryBackendSession, table: string): Promise<number> {
  const result = await session.database.read(async em => await em.execute<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`, [], 'get'))
  return Number(result.count)
}

async function fixture(kind: MemoryBackendKind = 'sqlite', withGeneration = true): Promise<ProjectionFixture> {
  const backend = await createMemoryBackendFixture(kind)
  backends.push(backend)
  const session = await backend.createSession({
    actorId: 'local-user',
    instanceId: 'aiden',
    sessionId: 'projection-session',
    projectId: 'project-one',
    now: () => new Date(timestamp),
  })
  const owner = memoryProjectionOwner('aiden', generationId, embedder, vectorIndex)
  if (withGeneration) {
    const transition = await session.context.doppelgangerMemory.projectionStore.prepareGeneration(
      owner,
      JSON.stringify(embedder),
      JSON.stringify(vectorIndex),
      timestamp,
      transitionUntil,
    )
    expect(transition).toBeDefined()
    expect(await session.context.doppelgangerMemory.projectionStore.activateGeneration(owner, transition!, timestamp)).toBe(true)
  }
  return { session, owner }
}

describe('memory vector projection lifecycle', () => {
  it('commits canonical and lexical memory without semantic projection work', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const { session } = await fixture(kind, false)
      const record = await session.memory.remember({
        operationId: `remember-without-generation-${kind}`,
        subjectKey: 'project.runtime.transport',
        kind: 'fact',
        content: 'The runtime uses framed JSON-RPC.',
      })
      expect(await session.memory.get(record.id)).toMatchObject({ id: record.id })
      expect(await session.memory.search({ query: 'framed JSON-RPC', tokenBudget: 100 })).toEqual([
        expect.objectContaining({ record: expect.objectContaining({ id: record.id }) }),
      ])
      expect(await rows(session, 'memory_vector_projection_work')).toEqual([])
      expect(await rows(session, 'memory_vector_deletions')).toEqual([])
    }
  })

  it('enqueues active revisions transactionally and deduplicates command replay', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const { session, owner } = await fixture(kind)
      const request = {
        operationId: `remember-one-${kind}`,
        subjectKey: 'project.runtime.transport',
        kind: 'fact' as const,
        content: 'The runtime uses framed JSON-RPC.',
      }
      const record = await session.memory.remember(request)
      expect(await rows(session, 'memory_vector_projection_work')).toEqual([
        expect.objectContaining({
          generation_id: owner.generationId,
          record_id: record.id,
          revision_id: record.revision.id,
          vector_backend: owner.vectorBackend,
          vector_target_id: owner.vectorTargetId,
          state: 'pending',
        }),
      ])
      expect((await session.memory.remember(request)).id).toBe(record.id)
      expect(await rows(session, 'memory_vector_projection_work')).toHaveLength(1)
    }
  })

  it('converges a stale queued revision to deletion and the current upsert', async () => {
    const { session, owner } = await fixture()
    const initial = await session.memory.remember({
      operationId: 'remember-corrected',
      subjectKey: 'project.database.engine',
      kind: 'decision',
      content: 'The project uses an old database.',
    })
    const stale = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, leaseUntil, timestamp)
    expect(stale).toMatchObject({ recordId: initial.id, revisionId: initial.revision.id })
    const corrected = await session.memory.correct({
      operationId: 'correct-database',
      id: initial.id,
      expectedRevisionId: initial.revision.id,
      content: 'The project uses SQLite.',
    })

    expect(await session.context.doppelgangerMemory.projectionStore.source(owner, stale!, timestamp)).toBeUndefined()
    expect(await rows(session, 'memory_vector_deletions')).toEqual([
      expect.objectContaining({
        generation_id: owner.generationId,
        record_id: initial.id,
        revision_id: initial.revision.id,
        vector_target_id: owner.vectorTargetId,
        state: 'pending',
      }),
    ])
    const current = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, leaseUntil, timestamp)
    const source = await session.context.doppelgangerMemory.projectionStore.source(owner, current!, timestamp)
    expect(source).toMatchObject({
      recordId: corrected.id,
      revisionId: corrected.revision.id,
      content: 'The project uses SQLite.',
      status: 'active',
    })
    expect(await session.context.doppelgangerMemory.projectionStore.acknowledgeUpsert(owner, current!, timestamp)).toBe(true)
    expect(await rows(session, 'memory_vector_projection_work')).toHaveLength(0)
  })

  it('turns expired and rejected projection state into opaque routed deletion work', async () => {
    const { session, owner } = await fixture()
    const expired = await session.memory.remember({
      operationId: 'remember-expired',
      subjectKey: 'project.expired.fact',
      kind: 'fact',
      content: 'This fact has expired.',
      expiresAt: '2026-08-28T00:00:00.000Z',
    })
    const expiredLease = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, leaseUntil, timestamp)
    expect(await session.context.doppelgangerMemory.projectionStore.source(owner, expiredLease!, timestamp)).toBeUndefined()
    expect(await rows(session, 'memory_vector_deletions')).toContainEqual(expect.objectContaining({
      record_id: expired.id,
      revision_id: expired.revision.id,
      vector_target_id: owner.vectorTargetId,
    }))

    const candidate = await session.memory.propose({
      operationId: 'candidate-one',
      subjectKey: 'project.candidate.fact',
      kind: 'fact',
      content: 'Review this candidate.',
    })
    await session.database.write({ instanceId: owner.instanceId }, async em => {
      await em.execute(`
        INSERT INTO memory_semantic_indexed_revisions(store_id, instance_id, generation_id, record_id, revision_id, indexed_at)
        SELECT id, ?, ?, ?, ?, ? FROM memory_store
      `, [owner.instanceId, owner.generationId, candidate.id, candidate.revision.id, timestamp], 'run')
    })
    await session.memory.reject({ operationId: 'reject-one', candidateId: candidate.id })
    expect(await session.database.read(async em => await em.execute(
      'SELECT 1 AS found FROM memory_semantic_indexed_revisions WHERE record_id = ?',
      [candidate.id],
      'get',
    ))).toBeUndefined()
    expect(await rows(session, 'memory_vector_deletions')).toContainEqual(expect.objectContaining({
      record_id: candidate.id,
      revision_id: candidate.revision.id,
      vector_target_id: owner.vectorTargetId,
    }))
  })

  it('rolls back a canonical mutation when its transactional outbox write fails', async () => {
    const { session, owner } = await fixture()
    await session.database.write({ instanceId: owner.instanceId }, async em => {
      await em.execute(`CREATE TRIGGER fail_projection_insert BEFORE INSERT ON memory_vector_projection_work BEGIN SELECT RAISE(ABORT, 'projection write failed'); END`, [], 'run')
    })
    await expect(session.memory.remember({
      operationId: 'rolled-back',
      subjectKey: 'project.rollback.fact',
      kind: 'fact',
      content: 'This entire mutation must roll back.',
    })).rejects.toMatchObject({ code: 'MEMORY_STORAGE_FAILED' })
    for (const table of ['memory_records', 'memory_revisions', 'memory_evidence', 'memory_fts', 'memory_operations']) {
      expect(await count(session, table)).toBe(0)
    }
  })

  it('hard-deletes content immediately and retains only retryable vector identities', async () => {
    const { session, owner } = await fixture()
    const record = await session.memory.remember({
      operationId: 'remember-deleted',
      subjectKey: 'project.deleted.fact',
      kind: 'fact',
      content: 'Delete this protected content.',
    })
    const lease = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, leaseUntil, timestamp)
    expect(await session.context.doppelgangerMemory.projectionStore.acknowledgeUpsert(owner, lease!, timestamp)).toBe(true)
    await session.database.write({ instanceId: owner.instanceId }, async em => {
      await em.execute(`
        INSERT INTO memory_embedding_cache(embedder_fingerprint, record_id, revision_id, content_digest, dimensions, vector, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [owner.embedderFingerprint, record.id, record.revision.id, 'digest', 2, Buffer.from([1, 2]), timestamp], 'run')
    })

    expect(await session.memory.forget({ operationId: 'forget-deleted', id: record.id })).toBe(true)
    expect(await session.memory.get(record.id)).toBeUndefined()
    expect(await session.memory.search({ query: 'protected content', tokenBudget: 100 })).toEqual([])
    for (const table of ['memory_records', 'memory_revisions', 'memory_fts', 'memory_embedding_cache', 'memory_semantic_indexed_revisions']) {
      expect(await count(session, table)).toBe(0)
    }
    const pending = await rows(session, 'memory_vector_deletions')
    expect(pending).toEqual([
      expect.objectContaining({
        generation_id: owner.generationId,
        record_id: record.id,
        revision_id: record.revision.id,
        vector_backend: owner.vectorBackend,
        vector_target_id: owner.vectorTargetId,
        state: 'pending',
      }),
    ])
    expect(JSON.stringify(pending)).not.toContain('protected content')
    const deletion = await session.context.doppelgangerMemory.projectionStore.claim('delete', owner, 10, leaseUntil, timestamp)
    expect(await session.context.doppelgangerMemory.projectionStore.acknowledgeDeletion(owner, deletion!, timestamp)).toBe(true)
    expect(await rows(session, 'memory_vector_deletions')).toHaveLength(0)
  })

  it('revalidates canonical projection acknowledgments after external work', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const { session, owner } = await fixture(kind)
      const store = session.memory.projectionStore
      const record = await session.memory.remember({
        operationId: 'acknowledgment-source', subjectKey: 'project.acknowledgment',
        kind: 'fact', content: 'The original projection source.',
      })
      const lease = await store.claim('upsert', owner, 10, leaseUntil, timestamp)
      expect(await store.source(owner, lease!, timestamp)).toMatchObject({ revisionId: record.revision.id })
      const corrected = await session.memory.correct({
        operationId: 'acknowledgment-correction', id: record.id,
        expectedRevisionId: record.revision.id, content: 'The corrected projection source.',
      })
      expect(await store.acknowledgeUpsert(owner, lease!, timestamp)).toBe(false)
      expect(await store.indexed(owner)).toEqual([])
      expect(await rows(session, 'memory_vector_deletions')).toContainEqual(expect.objectContaining({
        record_id: record.id, revision_id: record.revision.id, vector_target_id: owner.vectorTargetId,
      }))
      const current = await store.claim('upsert', owner, 10, leaseUntil, timestamp)
      expect(await store.source(owner, current!, timestamp)).toMatchObject({ revisionId: corrected.revision.id })
      expect(await store.acknowledgeUpsert(owner, current!, timestamp)).toBe(true)
    }
  })

  it('fences stale post-I/O acknowledgments with unique expiring lease tokens', async () => {
    const { session, owner } = await fixture()
    const record = await session.memory.remember({
      operationId: 'lease-record',
      subjectKey: 'lease.record',
      kind: 'fact',
      content: 'Lease source.',
    })
    const first = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, leaseUntil, timestamp)
    await session.context.doppelgangerMemory.projectionStore.recoverLeases(owner, '2026-08-29T00:00:30.000Z')
    expect(await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, '2026-08-29T00:02:00.000Z', '2026-08-29T00:00:30.000Z')).toBeUndefined()
    await session.context.doppelgangerMemory.projectionStore.recoverLeases(owner, '2026-08-29T00:01:00.000Z')
    const second = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, '2026-08-29T00:03:00.000Z', '2026-08-29T00:01:00.000Z')
    expect(second).toMatchObject({ recordId: record.id, revisionId: record.revision.id })
    expect(second?.leaseToken).not.toBe(first?.leaseToken)
    expect(await session.context.doppelgangerMemory.projectionStore.acknowledgeUpsert(owner, first!, '2026-08-29T00:01:01.000Z')).toBe(false)
    expect(await session.context.doppelgangerMemory.projectionStore.acknowledgeUpsert(owner, second!, '2026-08-29T00:01:01.000Z')).toBe(true)
  })

  it('routes identifier-only deletion debt to the original backend target after source loss', async () => {
    const { session, owner } = await fixture()
    const record = await session.memory.remember({
      operationId: 'routed-delete-record',
      subjectKey: 'routed.delete',
      kind: 'fact',
      content: 'This content must disappear before vector deletion.',
    })
    const upsert = await session.context.doppelgangerMemory.projectionStore.claim('upsert', owner, 10, leaseUntil, timestamp)
    expect(await session.context.doppelgangerMemory.projectionStore.acknowledgeUpsert(owner, upsert!, timestamp)).toBe(true)
    expect(await session.memory.forget({ operationId: 'routed-delete-forget', id: record.id })).toBe(true)

    const otherTarget = Object.freeze({ ...owner, vectorTargetId: 'f'.repeat(64) })
    expect(await session.context.doppelgangerMemory.projectionStore.claim('delete', otherTarget, 10, leaseUntil, timestamp)).toBeUndefined()
    const routed = await session.context.doppelgangerMemory.projectionStore.claim('delete', owner, 10, leaseUntil, timestamp)
    expect(routed).toMatchObject({ generationId: owner.generationId, recordId: record.id, revisionId: record.revision.id })
    expect(JSON.stringify(routed)).not.toContain('This content must disappear')
  })

  it('serializes generation transition recovery and rejects stale rebuild acknowledgments', async () => {
    const { session, owner } = await fixture('sqlite', false)
    const store = session.context.doppelgangerMemory.projectionStore
    const record = await session.memory.remember({ operationId: 'rebuild-record', subjectKey: 'project.rebuild', kind: 'fact', content: 'The original rebuild source.' })
    const transition = await store.prepareGeneration(owner, JSON.stringify(embedder), JSON.stringify(vectorIndex), timestamp, leaseUntil)
    expect(transition).toBeDefined()
    expect(await store.prepareGeneration(owner, JSON.stringify(embedder), JSON.stringify(vectorIndex), '2026-08-29T00:00:30.000Z', '2026-08-29T00:02:00.000Z')).toBeUndefined()
    const page = await store.rebuildPage(owner, transition!, undefined, 10, timestamp)
    await session.memory.correct({ operationId: 'correct-rebuild', id: record.id, expectedRevisionId: record.revision.id, content: 'The corrected rebuild source.' })
    await expect(store.markRebuildPage(owner, transition!, page, '2026-08-29T00:00:30.000Z', '2026-08-29T00:02:00.000Z')).rejects.toThrow('changed before acknowledgment')
    expect(await store.indexed(owner)).toEqual([])

    const recovered = await store.prepareGeneration(owner, JSON.stringify(embedder), JSON.stringify(vectorIndex), leaseUntil, '2026-08-29T00:03:00.000Z')
    expect(recovered?.generationRevision).toBe((transition?.generationRevision ?? 0) + 1)
    expect(recovered?.transitionToken).not.toBe(transition?.transitionToken)
    expect(await store.activateGeneration(owner, transition!, '2026-08-29T00:01:01.000Z')).toBe(false)
    expect(await store.generation(owner)).toMatchObject({ state: 'building', generationRevision: recovered?.generationRevision })
  })
  it('allows only one concurrent activation from the same durable active-generation revision', async () => {
    const { session, owner: firstOwner } = await fixture('sqlite', false)
    const secondEmbedder = Object.freeze({ ...embedder, revision: '2' })
    const secondOwner = memoryProjectionOwner(
      'aiden',
      memorySemanticGenerationId('aiden', secondEmbedder, vectorIndex),
      secondEmbedder,
      vectorIndex,
    )
    const store = session.context.doppelgangerMemory.projectionStore
    const [first, second] = await Promise.all([
      store.prepareGeneration(firstOwner, JSON.stringify(embedder), JSON.stringify(vectorIndex), timestamp, transitionUntil),
      store.prepareGeneration(secondOwner, JSON.stringify(secondEmbedder), JSON.stringify(vectorIndex), timestamp, transitionUntil),
    ])
    expect(first?.activeGenerationRevision).toBe(0)
    expect(second?.activeGenerationRevision).toBe(0)
    const activated = await Promise.all([
      store.activateGeneration(firstOwner, first!, timestamp),
      store.activateGeneration(secondOwner, second!, timestamp),
    ])
    expect(activated.filter(Boolean)).toHaveLength(1)
    const active = await store.activeGeneration('aiden')
    expect([firstOwner.generationId, secondOwner.generationId]).toContain(active?.generationId)
    expect(active?.generationRevision).toBe(1)
    const inactiveOwner = active?.generationId === firstOwner.generationId ? secondOwner : firstOwner
    expect(await store.generation(inactiveOwner)).toMatchObject({ state: 'building' })
  })

  it('rebuilds only temporally eligible active revisions', async () => {
    const { session, owner } = await fixture('sqlite', false)
    const expired = await session.memory.remember({ operationId: 'rebuild-expired', subjectKey: 'rebuild.expired', kind: 'fact', content: 'Expired.', expiresAt: '2026-08-28T00:00:00.000Z' })
    const future = await session.memory.remember({ operationId: 'rebuild-future', subjectKey: 'rebuild.future', kind: 'fact', content: 'Future.', validFrom: '2026-08-30T00:00:00.000Z' })
    const current = await session.memory.remember({ operationId: 'rebuild-current', subjectKey: 'rebuild.current', kind: 'fact', content: 'Current.' })
    const store = session.context.doppelgangerMemory.projectionStore
    const transition = await store.prepareGeneration(owner, JSON.stringify(embedder), JSON.stringify(vectorIndex), timestamp, transitionUntil)
    const page = await store.rebuildPage(owner, transition!, undefined, 10, timestamp)
    expect(page.map(source => source.recordId)).toEqual([current.id])
    expect(page.map(source => source.recordId)).not.toContain(expired.id)
    expect(page.map(source => source.recordId)).not.toContain(future.id)
    const renewed = await store.markRebuildPage(owner, transition!, page, timestamp, transitionUntil)
    expect(await store.activateGeneration(owner, renewed!, timestamp)).toBe(true)
  })

})
