import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSQLiteExactMemoryVectorIndex } from '../src/index.ts'
import type { MemoryVectorMaintenanceResult } from '@doppelganger/doppelganger-memory'
import { runMemoryVectorBackendConformance } from './conformance.ts'

runMemoryVectorBackendConformance('SQLite exact', ({ root, dimensions }) => createSQLiteExactMemoryVectorIndex({ databasePath: join(root, 'vectors.sqlite'), dimensions }), {}, async index => ({
  kind: 'compact',
  async run() {
    let underlyingOperations = 0
    let competing: Promise<MemoryVectorMaintenanceResult> | undefined
    const originalExec = DatabaseSync.prototype.exec
    DatabaseSync.prototype.exec = function exec(sql: string) {
      if (sql === 'PRAGMA optimize') {
        underlyingOperations += 1
        competing = index.maintenance('compact')
      }
      return originalExec.call(this, sql)
    }
    try {
      const first = await index.maintenance('compact')
      if (competing === undefined) throw new Error('SQLite exclusive work did not execute')
      return { first, competing: await competing, underlyingOperations }
    } finally {
      DatabaseSync.prototype.exec = originalExec
    }
  },
}))

const roots: string[] = []
const identity = { generationId: 'generation.one', recordId: 'record.one', revisionId: 'revision.one' }
const entry = (overrides: Partial<typeof identity & { instanceId: string; actorId: string; scopeKind: 'relationship' | 'project'; projectId?: string; kind: 'fact'; subjectKey: string; status: 'active'; vector: Float32Array }> = {}) => ({ ...identity,
instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' as const,
kind: 'fact' as const,
subjectKey: 'subject.one',
status: 'active' as const,
vector: new Float32Array([1, 0, 0]),
...overrides, })

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-vectors-'))
  roots.push(root)
  return join(root, 'vectors.sqlite')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('SQLite exact vector index', () => {
  it('upserts idempotently and returns deterministic cosine top-K with filters', async () => {
    const index = await createSQLiteExactMemoryVectorIndex({ databasePath: await databasePath(), dimensions: 3 })
    await index.upsert([
      entry(),
      entry({ recordId: 'record.two', revisionId: 'revision.two', subjectKey: 'subject.two', vector: new Float32Array([0, 1, 0]) }),
      entry({ recordId: 'record.three', revisionId: 'revision.three', subjectKey: 'subject.three', projectId: 'project.one', scopeKind: 'project', vector: new Float32Array([1, 0, 0]) }),
    ])
    await index.upsert([entry()])
    const hits = await index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' }, limit: 10 })
    expect(hits.map(hit => hit.recordId)).toEqual(['record.one', 'record.two'])
    expect(await index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'project', projectId: 'project.one' }, limit: 5 })).toMatchObject([{ recordId: 'record.three', score: 1 }])
    expect((await index.health()).counts?.indexed).toBe(3)
    await index.close()
  })

  it('rejects dimension mismatches before committing partial batches and persists across restart', async () => {
    const path = await databasePath()
    const first = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3 })
    await expect(first.upsert([entry({ recordId: 'record.valid' }), entry({ recordId: 'record.invalid', vector: new Float32Array([1, 2]) })])).rejects.toThrow('dimensions')
    expect((await first.health()).counts?.indexed).toBe(0)
    await first.upsert([entry({ recordId: 'record.valid' })])
    await first.close()
    const second = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3 })
    await expect(createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 2 })).rejects.toThrow('incompatible vector index identity')
    expect(await second.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 1 })).toHaveLength(1)
    await second.delete([{ ...identity, recordId: 'record.valid' }])
    expect(await second.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 1 })).toHaveLength(0)
    expect((await second.maintenance('compact')).outcome).toBe('ran')
    await expect(second.maintenance('reindex')).rejects.toMatchObject({ code: 'UNSUPPORTED_MAINTENANCE' })
    await second.close()
  })

  it('migrates a populated principal-partition artifact to actor schema version two', async () => {
    const path = await databasePath()
    const configuredFingerprint = 'a'.repeat(64)
    const first = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3, configFingerprint: configuredFingerprint })
    await first.upsert([entry({ actorId: 'persisted-actor' })])
    await first.close()
    const legacy = new DatabaseSync(path)
    const table = legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'doppelganger_vectors_%'").get() as { name: string }
    legacy.exec(`ALTER TABLE ${table.name} RENAME COLUMN actor_id TO principal_id`)
    legacy.prepare('UPDATE doppelganger_vector_metadata SET config_fingerprint = ?, schema_version = 1').run(configuredFingerprint)
    legacy.close()

    const migrated = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3, configFingerprint: configuredFingerprint })
    expect(await migrated.search({
      generationId: 'generation.one', vector: new Float32Array([1, 0, 0]),
      filter: { instanceId: 'instance.one', actorId: 'persisted-actor' }, limit: 1,
    })).toMatchObject([{ recordId: 'record.one' }])
    await migrated.close()
    const verified = new DatabaseSync(path)
    expect(verified.prepare('SELECT schema_version FROM doppelganger_vector_metadata').get()?.schema_version).toBe(2)
    expect(verified.prepare(`PRAGMA table_info(${table.name})`).all().map(row => row.name)).toContain('actor_id')
    expect(verified.prepare(`PRAGMA table_info(${table.name})`).all().map(row => row.name)).not.toContain('principal_id')
    verified.close()
  })

  it('rolls back an ambiguous exact-vector actor migration', async () => {
    const path = await databasePath()
    const configuredFingerprint = 'b'.repeat(64)
    const first = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3, configFingerprint: configuredFingerprint })
    await first.close()
    const legacy = new DatabaseSync(path)
    const table = legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'doppelganger_vectors_%'").get() as { name: string }
    legacy.exec(`ALTER TABLE ${table.name} RENAME COLUMN actor_id TO principal_id`)
    legacy.exec(`ALTER TABLE ${table.name} ADD COLUMN actor_id TEXT`)
    legacy.prepare('UPDATE doppelganger_vector_metadata SET config_fingerprint = ?, schema_version = 1').run(configuredFingerprint)
    legacy.close()

    await expect(createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3, configFingerprint: configuredFingerprint }))
      .rejects.toThrow('cannot identify the partition column')
    const verified = new DatabaseSync(path)
    expect(verified.prepare('SELECT schema_version FROM doppelganger_vector_metadata').get()?.schema_version).toBe(1)
    expect(verified.prepare(`PRAGMA table_info(${table.name})`).all().map(row => row.name))
      .toEqual(expect.arrayContaining(['principal_id', 'actor_id']))
    verified.close()
  })

  it('rejects a corrupt persisted vector artifact instead of ranking it', async () => {
    const path = await databasePath()
    const first = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3 })
    await first.upsert([entry()])
    await first.close()
    const database = new DatabaseSync(path)
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'doppelganger_vectors_%'").get() as { name: string }
    database.exec(`UPDATE ${table.name} SET vector = X'00'`)
    database.close()
    const reopened = await createSQLiteExactMemoryVectorIndex({ databasePath: path, dimensions: 3 })
    await expect(reopened.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 1 }))
      .rejects.toThrow('stored vector dimensions do not match backend identity')
    await reopened.close()
  })
})
