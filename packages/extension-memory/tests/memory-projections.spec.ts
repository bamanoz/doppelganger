import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService, type InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { MemoryService } from '../src/index.ts'

const temporaryRoots: string[] = []
const now = '2026-08-29T00:00:00.000Z'

interface Fixture {
  readonly context: Context
  readonly database: InstanceSqliteDatabase
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(withGeneration = true): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-projections-'))
  temporaryRoots.push(home)
  const context = new Context()
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'aiden',
    sessionId: 'projection-session',
    projectId: 'project-one',
    projectRoot: join(home, 'project-one'),
  }))
  await context.plugin(createActorIdentityPlugin('local-user'))
  await context.plugin(InstanceSqliteService, { home })
  await context.plugin(MemoryService, { now: () => new Date(now) })
  const database = (context.doppelgangerMemory as unknown as { database: InstanceSqliteDatabase }).database
  if (withGeneration) database.exec(`
    INSERT INTO memory_semantic_generations VALUES (
      'generation-one', 'aiden', '{}', '{}', 'active', '${now}', '${now}', '${now}', NULL
    );
    INSERT INTO memory_semantic_active_generation VALUES ('aiden', 'generation-one', '${now}');
  `)
  return { context, database }
}

function work(database: InstanceSqliteDatabase) {
  return database.prepare(`
    SELECT id, generation_id, record_id, revision_id, state
    FROM memory_vector_projection_work ORDER BY created_at, id
  `).all()
}

function deletions(database: InstanceSqliteDatabase) {
  return database.prepare(`
    SELECT id, generation_id, record_id, revision_id, state
    FROM memory_vector_deletions ORDER BY created_at, id
  `).all()
}

describe('memory vector projection lifecycle', () => {
  it('commits canonical and lexical memory without semantic projection work', async () => {
    const { context, database } = await fixture(false)
    const record = context.doppelgangerMemory.remember({
      operationId: 'remember-without-semantic-generation',
      subjectKey: 'project.runtime.transport',
      kind: 'fact',
      content: 'The runtime uses framed JSON-RPC.',
    })

    expect(context.doppelgangerMemory.get(record.id)).toMatchObject({ id: record.id })
    expect(database.prepare('SELECT COUNT(*) AS count FROM memory_fts').get()).toEqual({ count: 1 })
    expect(work(database)).toEqual([])
    expect(deletions(database)).toEqual([])
    await context.fiber.dispose()
  })

  it('enqueues active revisions transactionally and deduplicates command replay', async () => {
    const { context, database } = await fixture()
    const record = context.doppelgangerMemory.remember({
      operationId: 'remember-one',
      subjectKey: 'project.runtime.transport',
      kind: 'fact',
      content: 'The runtime uses framed JSON-RPC.',
    })
    expect(work(database)).toEqual([
      expect.objectContaining({
        generation_id: 'generation-one',
        record_id: record.id,
        revision_id: record.revision.id,
        state: 'pending',
      }),
    ])

    context.doppelgangerMemory.remember({
      operationId: 'remember-one',
      subjectKey: 'project.runtime.transport',
      kind: 'fact',
      content: 'The runtime uses framed JSON-RPC.',
    })
    expect(work(database)).toHaveLength(1)
    await context.fiber.dispose()
  })

  it('converges a stale queued revision to deletion and the current upsert', async () => {
    const { context, database } = await fixture()
    const initial = context.doppelgangerMemory.remember({
      operationId: 'remember-corrected',
      subjectKey: 'project.database.engine',
      kind: 'decision',
      content: 'The project uses an old database.',
    })
    const staleWorkId = String(work(database)[0]?.id)
    const corrected = context.doppelgangerMemory.correct({
      operationId: 'correct-database',
      id: initial.id,
      expectedRevisionId: initial.revision.id,
      content: 'The project uses SQLite.',
    })

    expect(context.doppelgangerMemory.projectionStore.source(staleWorkId, now)).toBeUndefined()
    expect(deletions(database)).toEqual([
      expect.objectContaining({ record_id: initial.id, revision_id: initial.revision.id, state: 'pending' }),
    ])
    const currentWork = work(database)
    expect(currentWork).toHaveLength(1)
    expect(currentWork[0]).toEqual(expect.objectContaining({
      record_id: corrected.id,
      revision_id: corrected.revision.id,
    }))
    const source = context.doppelgangerMemory.projectionStore.source(String(currentWork[0]?.id), now)
    expect(source).toMatchObject({
      recordId: corrected.id,
      revisionId: corrected.revision.id,
      content: 'The project uses SQLite.',
      status: 'active',
    })
    expect(context.doppelgangerMemory.projectionStore.acknowledgeUpsert(String(currentWork[0]?.id), now)).toBe(true)
    expect(work(database)).toHaveLength(0)
    await context.fiber.dispose()
  })

  it('turns expired and rejected projection state into opaque deletion work', async () => {
    const { context, database } = await fixture()
    const expired = context.doppelgangerMemory.remember({
      operationId: 'remember-expired',
      subjectKey: 'project.expired.fact',
      kind: 'fact',
      content: 'This fact has expired.',
      expiresAt: '2026-08-28T00:00:00.000Z',
    })
    const expiredWorkId = String(work(database)[0]?.id)
    expect(context.doppelgangerMemory.projectionStore.source(expiredWorkId, now)).toBeUndefined()
    expect(deletions(database)).toContainEqual(expect.objectContaining({
      record_id: expired.id,
      revision_id: expired.revision.id,
    }))

    const candidate = context.doppelgangerMemory.propose({
      operationId: 'candidate-one',
      subjectKey: 'project.candidate.fact',
      kind: 'fact',
      content: 'Review this candidate.',
    })
    database.prepare(`
      INSERT INTO memory_semantic_indexed_revisions VALUES ('generation-one', ?, ?, ?)
    `).run(candidate.id, candidate.revision.id, now)
    context.doppelgangerMemory.reject({ operationId: 'reject-one', candidateId: candidate.id })
    expect(database.prepare(`
      SELECT 1 FROM memory_semantic_indexed_revisions WHERE record_id = ?
    `).get(candidate.id)).toBeUndefined()
    expect(deletions(database)).toContainEqual(expect.objectContaining({
      record_id: candidate.id,
      revision_id: candidate.revision.id,
    }))
    await context.fiber.dispose()
  })

  it('rolls back a canonical mutation when its transactional outbox write fails', async () => {
    const { context, database } = await fixture()
    database.exec(`
      CREATE TRIGGER fail_projection_insert
      BEFORE INSERT ON memory_vector_projection_work
      BEGIN SELECT RAISE(ABORT, 'projection write failed'); END;
    `)
    expect(() => context.doppelgangerMemory.remember({
      operationId: 'rolled-back',
      subjectKey: 'project.rollback.fact',
      kind: 'fact',
      content: 'This entire mutation must roll back.',
    })).toThrow('projection write failed')
    for (const table of ['memory_records', 'memory_revisions', 'memory_evidence', 'memory_fts', 'memory_operations']) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0)
    }
    await context.fiber.dispose()
  })

  it('hard-deletes content immediately and retains only retryable vector identities', async () => {
    const { context, database } = await fixture()
    const record = context.doppelgangerMemory.remember({
      operationId: 'remember-deleted',
      subjectKey: 'project.deleted.fact',
      kind: 'fact',
      content: 'Delete this protected content.',
    })
    const workId = String(work(database)[0]?.id)
    database.prepare(`
      INSERT INTO memory_embedding_cache VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('embedder-one', record.id, record.revision.id, 'digest', 2, Buffer.from([1, 2]), now)
    expect(context.doppelgangerMemory.projectionStore.acknowledgeUpsert(workId, now)).toBe(true)

    expect(context.doppelgangerMemory.forget({ operationId: 'forget-deleted', id: record.id })).toBe(true)
    expect(context.doppelgangerMemory.get(record.id)).toBeUndefined()
    expect(await context.doppelgangerMemory.search({ query: 'protected content', tokenBudget: 100 })).toEqual([])
    for (const table of ['memory_records', 'memory_revisions', 'memory_fts', 'memory_embedding_cache', 'memory_semantic_indexed_revisions']) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0)
    }
    const pending = deletions(database)
    expect(pending).toEqual([
      expect.objectContaining({
        generation_id: 'generation-one',
        record_id: record.id,
        revision_id: record.revision.id,
        state: 'pending',
      }),
    ])
    expect(JSON.stringify(pending)).not.toContain('protected content')
    expect(context.doppelgangerMemory.projectionStore.acknowledgeDeletion(String(pending[0]?.id))).toBe(true)
    expect(deletions(database)).toHaveLength(0)
    await context.fiber.dispose()
  })
  it('revalidates canonical projection acknowledgments after external work', async () => {
    const { context, database } = await fixture()
    const record = context.doppelgangerMemory.remember({ operationId: 'ack-stale', subjectKey: 'project.ack.stale', kind: 'fact', content: 'Stale projection content.' })
    const workId = String(work(database)[0]?.id)
    database.prepare('UPDATE memory_records SET status = ? WHERE id = ?').run('rejected', record.id)
    expect(context.doppelgangerMemory.projectionStore.acknowledgeUpsert(workId, now)).toBe(false)
    expect(database.prepare('SELECT 1 FROM memory_semantic_indexed_revisions WHERE record_id = ?').get(record.id)).toBeUndefined()
    await context.fiber.dispose()
  })
  it('rejects incomplete activation and active-generation cleanup without losing work', async () => {
    const { context, database } = await fixture()
    try {
      const memory = context.doppelgangerMemory
      memory.remember({ operationId: 'generation-record', subjectKey: 'project.generation', kind: 'fact', content: 'A generation needs its canonical revision.' })
      const store = memory.projectionStore
      const queued = work(database)
      expect(store.prepareGeneration('candidate', 'aiden', '{}', '{}', now)).toBe(true)
      expect(store.activateGeneration('candidate', 'aiden', now)).toBe(false)
      expect(store.activeGeneration('aiden')).toBe('generation-one')
      expect(store.removeRetainedGeneration('generation-one')).toBe(false)
      expect(work(database)).toEqual(queued)
    } finally { await context.fiber.dispose() }
  })

  it('rejects stale rebuild pages and mismatched generation identities atomically', async () => {
    const { context, database } = await fixture()
    try {
      const memory = context.doppelgangerMemory
      const record = memory.remember({ operationId: 'rebuild-record', subjectKey: 'project.rebuild', kind: 'fact', content: 'The original rebuild source.' })
      const store = memory.projectionStore
      expect(store.prepareGeneration('candidate', 'aiden', '{}', '{}', now)).toBe(true)
      const page = store.rebuildPage('candidate', 'aiden', undefined, 10)
      memory.correct({ operationId: 'correct-rebuild', id: record.id, expectedRevisionId: record.revision.id, content: 'The corrected rebuild source.' })
      expect(() => store.markRebuildPage('candidate', page, now)).toThrow()
      expect(store.indexed('candidate')).toEqual([])
      expect(() => store.prepareGeneration('candidate', 'aiden', '{"model":"different"}', '{}', now)).toThrow()
      expect(store.generation('candidate', 'aiden')).toMatchObject({ state: 'building', embedderIdentityJson: '{}' })
      expect(database.prepare('SELECT generation_id FROM memory_semantic_active_generation').get()).toEqual({ generation_id: 'generation-one' })
    } finally { await context.fiber.dispose() }
  })
})
