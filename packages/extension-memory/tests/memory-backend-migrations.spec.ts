import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/persistence/database.ts'
import { MEMORY_SCHEMA_VERSION } from '../src/persistence/migrations.ts'
import { createLegacyMemoryFixture } from './legacy-memory-fixtures.ts'
import { createPostgresqlFixture, type PostgresqlFixture } from './postgresql-fixture.ts'

const roots: string[] = []
const postgresqlFixtures: PostgresqlFixture[] = []

function sqliteConfig(home: string) {
  return { kind: 'sqlite' as const, home, namespace: 'memory', busyTimeoutMs: 5_000 }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-memory-migration-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.allSettled(postgresqlFixtures.splice(0).map(fixture => fixture.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('memory backend migrations', () => {
  it('adopts supported populated SQLite schemas without losing canonical state', async () => {
    for (const version of [1, 2, 3, 4] as const) {
      const home = await temporaryRoot()
      const legacy = await createLegacyMemoryFixture(home, version)
      const database = await openMemoryDatabase(sqliteConfig(home), 'legacy-user')
      await database.close()
      const adopted = new DatabaseSync(legacy.path, { readOnly: true })
      try {
        expect(adopted.prepare('SELECT version FROM memory_schema').get()?.version).toBe(MEMORY_SCHEMA_VERSION)
        const recordId = version === 1 ? 'relationship' : 'record-one'
        const expectedActor = version === 1 ? 'legacy-user' : 'persisted-actor'
        expect(adopted.prepare('SELECT actor_id FROM memory_records WHERE id = ?').get(recordId)?.actor_id).toBe(expectedActor)
        expect(adopted.prepare('SELECT COUNT(*) AS count FROM memory_revisions WHERE record_id = ?').get(recordId)?.count)
          .toBe(version === 1 ? 2 : 1)
        expect(adopted.prepare('SELECT COUNT(*) AS count FROM memory_evidence').get()?.count).toBe(1)
        expect(adopted.prepare('SELECT COUNT(*) AS count FROM memory_store').get()?.count).toBe(1)
        if (version >= 2) {
          expect(adopted.prepare(`SELECT actor_id, command_digest FROM memory_operations WHERE operation_id = 'legacy-operation'`).get())
            .toEqual({ actor_id: 'persisted-actor', command_digest: 'digest' })
        }
        if (version >= 3) {
          expect(adopted.prepare(`SELECT state, lease_token, lease_until FROM memory_vector_projection_work WHERE id = 'work-one'`).get())
            .toEqual({ state: 'pending', lease_token: null, lease_until: null })
          expect(adopted.prepare(`SELECT state, lease_token, lease_until FROM memory_vector_deletions WHERE id = 'deletion-one'`).get())
            .toEqual({ state: 'pending', lease_token: null, lease_until: null })
        }
      } finally {
        adopted.close()
      }
    }
  })

  it('retains recoverable source state after migration failure on both backends', async () => {
    const home = await temporaryRoot()
    const legacy = await createLegacyMemoryFixture(home, 4)
    const corrupted = new DatabaseSync(legacy.path)
    corrupted.prepare(`UPDATE memory_semantic_generations SET vector_index_identity_json = '{}' WHERE id = 'generation-one'`).run()
    corrupted.close()
    await expect(openMemoryDatabase(sqliteConfig(home), 'legacy-user')).rejects.toBeDefined()
    const recovered = new DatabaseSync(legacy.path, { readOnly: true })
    try {
      expect(recovered.prepare('SELECT version FROM memory_schema').get()?.version).toBe(4)
      expect(recovered.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_store'`).get()).toBeUndefined()
      expect(recovered.prepare(`SELECT vector_index_identity_json FROM memory_semantic_generations WHERE id = 'generation-one'`).get())
        .toEqual({ vector_index_identity_json: '{}' })
    } finally {
      recovered.close()
    }

    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const schema = `"${postgresql.config.schema}"`
    await postgresql.client.em.execute(`CREATE TABLE ${schema}.memory_schema(version INTEGER NOT NULL)`)
    await postgresql.client.em.execute(`INSERT INTO ${schema}.memory_schema(version) VALUES (6)`)
    const activation = openMemoryDatabase({ kind: 'postgresql', ...postgresql.config }, 'legacy-user')
    try {
      await expect(activation).rejects.toThrow('unsupported memory schema version: 6')
    } finally {
      await activation.then(database => database.close(), () => undefined)
    }
    expect(await postgresql.client.em.execute(`SELECT version FROM ${schema}.memory_schema`, [], 'get')).toEqual({ version: 6 })
    expect(await postgresql.client.em.execute(`SELECT to_regclass('${postgresql.config.schema}.memory_store') AS table_name`, [], 'get'))
      .toEqual({ table_name: null })
  })

  it('serializes concurrent PostgreSQL schema activation', async () => {
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const config = { kind: 'postgresql' as const, ...postgresql.config }
    const [first, second] = await Promise.all([
      openMemoryDatabase(config, 'actor-one'),
      openMemoryDatabase(config, 'actor-two'),
    ])
    try {
      expect(await first.read(em => em.execute('SELECT version FROM memory_schema', [], 'get')))
        .toEqual({ version: MEMORY_SCHEMA_VERSION })
      expect(await second.read(em => em.execute('SELECT COUNT(*)::int AS count FROM memory_store', [], 'get')))
        .toEqual({ count: 1 })
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  })

  it('rejects newer and unknown layouts without altering them', async () => {
    const home = await temporaryRoot()
    const legacy = await createLegacyMemoryFixture(home, 4)
    const database = new DatabaseSync(legacy.path)
    database.prepare('UPDATE memory_schema SET version = 99').run()
    database.close()
    await expect(openMemoryDatabase(sqliteConfig(home), 'actor')).rejects.toThrow('unsupported memory schema version: 99')
    const unchanged = new DatabaseSync(legacy.path, { readOnly: true })
    try {
      expect(unchanged.prepare('SELECT version FROM memory_schema').get()?.version).toBe(99)
      expect(unchanged.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_store'`).get()).toBeUndefined()
    } finally {
      unchanged.close()
    }
  })
})
