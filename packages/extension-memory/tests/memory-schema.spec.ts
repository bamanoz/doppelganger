import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/persistence/database.ts'
import { MEMORY_SCHEMA_VERSION } from '../src/persistence/migrations.ts'
import { createLegacyMemoryFixture } from './legacy-memory-fixtures.ts'
import { createMemoryBackendFixture } from './memory-backend-fixture.ts'

const roots: string[] = []

function sqliteConfig(home: string) {
  return { kind: 'sqlite' as const, home, namespace: 'memory', busyTimeoutMs: 5_000 }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-memory-schema-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('memory schema', () => {
  it('creates production schema constraints and indexes idempotently', async () => {
    const home = await temporaryRoot()
    const first = await openMemoryDatabase(sqliteConfig(home), 'local-user')
    await first.close()
    const second = await openMemoryDatabase(sqliteConfig(home), 'local-user')
    await second.close()
    const database = new DatabaseSync(join(home, 'storage', 'memory.sqlite'), { readOnly: true })
    try {
      expect(database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(MEMORY_SCHEMA_VERSION)
      expect(database.prepare('SELECT COUNT(*) AS count FROM memory_store').get()?.count).toBe(1)
      const generationColumns = database.prepare('PRAGMA table_info(memory_semantic_generations)').all().map(row => row.name)
      expect(generationColumns).toEqual(expect.arrayContaining([
        'store_id', 'embedder_fingerprint', 'vector_backend', 'vector_target_id',
        'generation_revision', 'transition_token', 'transition_until',
      ]))
      const workColumns = database.prepare('PRAGMA table_info(memory_vector_projection_work)').all().map(row => row.name)
      expect(workColumns).toEqual(expect.arrayContaining(['store_id', 'instance_id', 'vector_backend', 'vector_target_id', 'lease_token']))
    } finally {
      database.close()
    }
  })

  it('migrates populated version one state without losing lineage or eligibility', async () => {
    const home = await temporaryRoot()
    const legacy = await createLegacyMemoryFixture(home, 1)
    const database = await openMemoryDatabase(sqliteConfig(home), 'legacy-user')
    await database.close()
    const adopted = new DatabaseSync(legacy.path, { readOnly: true })
    try {
      expect(adopted.prepare(`SELECT actor_id, subject_key, scope_kind, pinned FROM memory_records WHERE id = 'relationship'`).get())
        .toEqual({ actor_id: 'legacy-user', subject_key: 'legacy.relationship', scope_kind: 'relationship', pinned: 1 })
      expect(adopted.prepare(`SELECT COUNT(*) AS count FROM memory_revisions WHERE record_id = 'relationship'`).get()?.count).toBe(2)
      expect(adopted.prepare(`SELECT relation, excerpt FROM memory_evidence WHERE record_id = 'candidate'`).get())
        .toEqual({ relation: 'support', excerpt: 'Principal repeated the project fact.' })
    } finally {
      adopted.close()
    }
  })

  it('rolls back a failed version three actor-column migration', async () => {
    const home = await temporaryRoot()
    const legacy = await createLegacyMemoryFixture(home, 3)
    const conflicted = new DatabaseSync(legacy.path)
    conflicted.exec('ALTER TABLE memory_records ADD COLUMN actor_id TEXT; ALTER TABLE memory_operations ADD COLUMN actor_id TEXT;')
    conflicted.close()
    await expect(openMemoryDatabase(sqliteConfig(home), 'actor')).rejects.toBeDefined()
    const recovered = new DatabaseSync(legacy.path, { readOnly: true })
    try {
      expect(recovered.prepare('SELECT version FROM memory_schema').get()?.version).toBe(3)
      const columns = recovered.prepare('PRAGMA table_info(memory_records)').all().map(row => row.name)
      expect(columns).toEqual(expect.arrayContaining(['principal_id', 'actor_id']))
      expect(recovered.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_store'`).get()).toBeUndefined()
    } finally {
      recovered.close()
    }
  })

  it('hard deletion removes canonical and derived rows while retaining content-free replay protection', async () => {
    const fixture = await createMemoryBackendFixture('sqlite')
    try {
      const session = await fixture.createSession({ actorId: 'local-user', instanceId: 'memory-instance', projectId: 'project-one' })
      const remembered = await session.memory.remember({
        operationId: 'remember-deletion', subjectKey: 'project.delete.fixture', kind: 'fact', content: 'Delete this content.',
      })
      expect(await session.memory.forget({ operationId: 'forget-deletion', id: remembered.id })).toBe(true)
      await session.database.read(async em => {
        for (const table of ['memory_records', 'memory_revisions', 'memory_evidence', 'memory_candidate_evidence']) {
          expect(Number((await em.execute<{ count: unknown }>(`SELECT COUNT(*) AS count FROM ${table}`, [], 'get')).count)).toBe(0)
        }
        expect(Number((await em.execute<{ count: unknown }>('SELECT COUNT(*) AS count FROM memory_fts', [], 'get')).count)).toBe(0)
        expect(await em.execute(`SELECT result_kind, result_record_id, result_revision_id FROM memory_operations WHERE operation_id = 'forget-deletion'`, [], 'get'))
          .toEqual({ result_kind: 'deleted', result_record_id: null, result_revision_id: null })
      })
    } finally {
      await fixture.close()
    }
  })
})
