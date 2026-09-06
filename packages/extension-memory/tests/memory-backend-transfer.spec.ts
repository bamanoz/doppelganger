import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase, type MemoryDatabase } from '../src/persistence/database.ts'
import { transferMemoryDatabase } from '../src/persistence/transfer.ts'
import { memoryEmbedderFingerprint, type MemoryEmbedderIdentity, type MemoryVectorBackendKind } from '../src/semantic.ts'
import { createPostgresqlFixture, type PostgresqlFixture } from './postgresql-fixture.ts'

const roots: string[] = []
const postgresqlFixtures: PostgresqlFixture[] = []
const timestamp = '2026-08-28T12:00:00.000Z'
const embedder: MemoryEmbedderIdentity = Object.freeze({
  provider: 'fixture', modelId: 'fixture-model', revision: 'v1', artifactDigest: 'a'.repeat(64),
  pooling: 'mean', projection: 'none', dimensions: 3, normalized: true, distanceMetric: 'cosine',
})
const vector = Object.freeze({
  backend: 'qdrant', namespace: 'fixture', sanitizedTarget: 'https://vectors.example.test',
  configFingerprint: 'b'.repeat(64), dimensions: 3, distanceMetric: 'cosine',
})

async function sqliteHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-transfer-'))
  roots.push(home)
  return home
}

function sqliteConfig(home: string) {
  return { kind: 'sqlite' as const, home, namespace: 'memory', busyTimeoutMs: 5_000 }
}

function postgresqlConfig(fixture: PostgresqlFixture) {
  return { kind: 'postgresql' as const, ...fixture.config }
}

async function seed(database: MemoryDatabase, vectorBackend: MemoryVectorBackendKind = vector.backend, vectorTargetId = vector.configFingerprint): Promise<void> {
  await database.write({ instanceId: 'memory-instance', actorId: 'persisted-actor' }, async em => {
    const store = await em.execute<{ id: string }>('SELECT id FROM memory_store', [], 'get')
    const storeId = store.id
    await em.execute(`INSERT INTO memory_records(
      id, instance_id, actor_id, kind, subject_key, scope_kind, project_id, status,
      pinned, confidence, salience, valid_from, valid_until, expires_at,
      current_revision_id, source_session_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'fact', 'transfer.fact', 'relationship', NULL, 'active', ?, 1, 0.5, NULL, NULL, NULL, ?, ?, ?, ?)`, [
      'record-one', 'memory-instance', 'persisted-actor', database.kind === 'sqlite' ? 0 : false,
      'revision-one', 'session-one', timestamp, timestamp,
    ])
    await em.execute(`INSERT INTO memory_records(
      id, instance_id, actor_id, kind, subject_key, scope_kind, project_id, status,
      pinned, confidence, salience, valid_from, valid_until, expires_at,
      current_revision_id, source_session_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'fact', 'transfer.candidate', 'relationship', NULL, 'candidate', ?, 0.7, 0.4, NULL, NULL, NULL, ?, ?, ?, ?)`, [
      'candidate-one', 'memory-instance', 'persisted-actor', database.kind === 'sqlite' ? 0 : false,
      'candidate-revision', 'session-one', timestamp, timestamp,
    ])
    await em.execute(`INSERT INTO memory_revisions(
      id, record_id, ordinal, content, source_session_id, source_kind,
      supersedes_revision_id, valid_from, valid_until, expires_at, created_at
    ) VALUES
      ('revision-one', 'record-one', 1, 'Transfer keeps canonical content.', 'session-one', 'explicit', NULL, NULL, NULL, NULL, ?),
      ('candidate-revision', 'candidate-one', 1, 'Candidate transfer content.', 'session-one', 'inferred', NULL, NULL, NULL, NULL, ?)`, [timestamp, timestamp])
    await em.execute(`INSERT INTO memory_embedding_cache(
      embedder_fingerprint, record_id, revision_id, content_digest, dimensions, vector, created_at
    ) VALUES (?, 'record-one', 'revision-one', ?, 3, ?, ?)`, [
      memoryEmbedderFingerprint(embedder), 'd'.repeat(64), Buffer.from([1, 2, 3, 4]), timestamp,
    ])
    await em.execute(`INSERT INTO memory_evidence(
      id, record_id, source_session_id, source_turn_id, role, relation, excerpt, created_at
    ) VALUES ('evidence-one', 'candidate-one', 'session-one', 'turn-one', 'principal', 'support', 'Candidate transfer content.', ?)`, [timestamp])
    await em.execute(`INSERT INTO memory_candidate_evidence(candidate_id, evidence_id) VALUES ('candidate-one', 'evidence-one')`)
    await em.execute(`INSERT INTO memory_conflicts(
      id, active_record_id, candidate_record_id, evidence_id, status, created_at, resolved_at, resolution_revision_id
    ) VALUES ('conflict-one', 'record-one', 'candidate-one', 'evidence-one', 'unresolved', ?, NULL, NULL)`, [timestamp])
    await em.execute(`INSERT INTO memory_operations(
      instance_id, actor_id, operation_id, command_kind, command_digest,
      result_kind, result_record_id, result_revision_id, created_at
    ) VALUES
      ('memory-instance', 'persisted-actor', 'operation-one', 'remember', 'digest-one', 'record', 'record-one', 'revision-one', ?),
      ('memory-instance', 'persisted-actor', 'operation-forgotten', 'forget', 'digest-forgotten', 'deleted', NULL, NULL, ?)`, [timestamp, timestamp])
    const vectorIdentity = JSON.stringify({
      ...vector,
      backend: vectorBackend,
      sanitizedTarget: vectorBackend === 'sqlite_exact' ? '/fixture/local-vectors.sqlite' : vector.sanitizedTarget,
      configFingerprint: vectorTargetId,
    })
    await em.execute(`INSERT INTO memory_semantic_generations(
      id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
      embedder_fingerprint, vector_backend, vector_target_id, generation_revision,
      transition_token, transition_until, state, created_at, activated_at, completed_at, failure_code
    ) VALUES ('generation-one', ?, 'memory-instance', ?, ?, ?, ?, ?, 3, NULL, NULL, 'active', ?, ?, ?, NULL)`, [
      storeId, JSON.stringify(embedder), vectorIdentity, memoryEmbedderFingerprint(embedder), vectorBackend, vectorTargetId,
      timestamp, timestamp, timestamp,
    ])
    await em.execute(`INSERT INTO memory_semantic_active_generation(
      store_id, instance_id, generation_id, generation_revision, updated_at
    ) VALUES (?, 'memory-instance', 'generation-one', 2, ?)`, [storeId, timestamp])
    await em.execute(`INSERT INTO memory_semantic_indexed_revisions(
      store_id, instance_id, generation_id, record_id, revision_id, indexed_at
    ) VALUES (?, 'memory-instance', 'generation-one', 'record-one', 'revision-one', ?)`, [storeId, timestamp])
    await em.execute(`INSERT INTO memory_vector_projection_work(
      id, store_id, instance_id, generation_id, record_id, revision_id, vector_backend, vector_target_id,
      operation, state, attempts, available_at, lease_until, lease_token, last_failure_code, created_at, updated_at
    ) VALUES ('work-one', ?, 'memory-instance', 'generation-one', 'record-one', 'revision-one', ?, ?,
      'upsert', 'pending', 1, ?, NULL, NULL, NULL, ?, ?)`, [storeId, vectorBackend, vectorTargetId, timestamp, timestamp, timestamp])
    await em.execute(`INSERT INTO memory_vector_deletions(
      id, store_id, instance_id, generation_id, record_id, revision_id, vector_backend, vector_target_id,
      state, attempts, available_at, lease_until, lease_token, last_failure_code, created_at, updated_at
    ) VALUES ('deletion-one', ?, 'memory-instance', 'generation-one', 'forgotten-record', 'forgotten-revision', ?, ?,
      'pending', 2, ?, NULL, NULL, 'backend', ?, ?)`, [storeId, vectorBackend, vectorTargetId, timestamp, timestamp, timestamp])
  })
}

async function assertTransferred(database: MemoryDatabase): Promise<void> {
  await database.read(async em => {
    expect(await em.execute('SELECT actor_id, current_revision_id FROM memory_records WHERE id = ?', ['record-one'], 'get'))
      .toEqual({ actor_id: 'persisted-actor', current_revision_id: 'revision-one' })
    expect(Number((await em.execute<{ count: unknown }>('SELECT COUNT(*) AS count FROM memory_revisions', [], 'get')).count)).toBe(2)
    expect(Number((await em.execute<{ count: unknown }>('SELECT COUNT(*) AS count FROM memory_evidence', [], 'get')).count)).toBe(1)
    expect(Number((await em.execute<{ count: unknown }>('SELECT COUNT(*) AS count FROM memory_conflicts', [], 'get')).count)).toBe(1)
    expect(await em.execute(`SELECT result_kind, result_record_id FROM memory_operations WHERE operation_id = 'operation-forgotten'`, [], 'get'))
      .toEqual({ result_kind: 'deleted', result_record_id: null })
    expect(await em.execute(`SELECT vector_backend, vector_target_id, state FROM memory_vector_deletions WHERE id = 'deletion-one'`, [], 'get'))
      .toEqual({ vector_backend: 'qdrant', vector_target_id: 'b'.repeat(64), state: 'pending' })
    const cache = await em.execute<{ dimensions: unknown; vector: Uint8Array }>(
      `SELECT dimensions, vector FROM memory_embedding_cache WHERE record_id = 'record-one'`, [], 'get',
    )
    expect(Number(cache.dimensions)).toBe(3)
    expect(Buffer.from(cache.vector)).toEqual(Buffer.from([1, 2, 3, 4]))
    const lexical = database.kind === 'sqlite'
      ? await em.execute(`SELECT record_id FROM memory_fts WHERE memory_fts MATCH 'canonical'`, [], 'get')
      : await em.execute(`SELECT record_id FROM memory_lexical_index WHERE document @@ plainto_tsquery('simple', 'canonical')`, [], 'get')
    expect(lexical).toEqual({ record_id: 'record-one' })
  })
}

afterEach(async () => {
  await Promise.allSettled(postgresqlFixtures.splice(0).map(fixture => fixture.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('memory backend transfer', () => {
  it('transfers complete SQLite memory into PostgreSQL', async () => {
    const home = await sqliteHome()
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const source = await openMemoryDatabase(sqliteConfig(home), 'persisted-actor')
    await seed(source)
    await source.close()

    const report = await transferMemoryDatabase({
      source: sqliteConfig(home), destination: postgresqlConfig(postgresql),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })
    expect(report.source.deletedReceipts.rows).toBe(1)
    expect(report.installed.cleanupObligations.rows).toBe(1)
    const destination = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    try {
      await assertTransferred(destination)
    } finally {
      await destination.close()
    }
    const reopenedSource = await openMemoryDatabase(sqliteConfig(home), 'persisted-actor')
    try {
      const count = await reopenedSource.read(em => em.execute<{ count: unknown }>('SELECT COUNT(*) AS count FROM memory_records', [], 'get'))
      expect(Number(count.count)).toBe(2)
    } finally {
      await reopenedSource.close()
    }
  })

  it('transfers complete PostgreSQL memory into SQLite', async () => {
    const home = await sqliteHome()
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const source = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    await seed(source)
    await source.close()

    const report = await transferMemoryDatabase({
      source: postgresqlConfig(postgresql), destination: sqliteConfig(home),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })
    expect(report.installed.sha256).toBe(report.source.sha256)
    const destination = await openMemoryDatabase(sqliteConfig(home), 'persisted-actor')
    try {
      await assertTransferred(destination)
    } finally {
      await destination.close()
    }
  })
  it('preserves forgotten-result receipts and remote deletion routing across transfer', async () => {
    const home = await sqliteHome()
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const source = await openMemoryDatabase(sqliteConfig(home), 'persisted-actor')
    await seed(source)
    await source.close()
    const report = await transferMemoryDatabase({
      source: sqliteConfig(home), destination: postgresqlConfig(postgresql),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })
    expect(report.installed.deletedReceipts).toEqual(report.source.deletedReceipts)
    expect(report.installed.cleanupObligations).toEqual(report.source.cleanupObligations)
    const destination = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    try {
      expect(await destination.read(em => em.execute(`SELECT command_digest, result_kind, result_record_id
        FROM memory_operations WHERE operation_id = 'operation-forgotten'`, [], 'get')))
        .toEqual({ command_digest: 'digest-forgotten', result_kind: 'deleted', result_record_id: null })
      expect(await destination.read(em => em.execute(`SELECT generation_id, record_id, revision_id, vector_backend, vector_target_id
        FROM memory_vector_deletions WHERE id = 'deletion-one'`, [], 'get')))
        .toEqual({ generation_id: 'generation-one', record_id: 'forgotten-record', revision_id: 'forgotten-revision', vector_backend: 'qdrant', vector_target_id: 'b'.repeat(64) })
    } finally {
      await destination.close()
    }
  })

  it('rejects transfer into a nonempty canonical destination', async () => {
    const sourceHome = await sqliteHome()
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const source = await openMemoryDatabase(sqliteConfig(sourceHome), 'persisted-actor')
    await seed(source)
    await source.close()
    const occupied = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    await occupied.write({ instanceId: 'occupied', actorId: 'actor' }, async em => {
      await em.execute(`INSERT INTO memory_records(
        id, instance_id, actor_id, kind, subject_key, scope_kind, project_id, status, pinned,
        confidence, salience, current_revision_id, source_session_id, created_at, updated_at
      ) VALUES ('occupied', 'occupied', 'actor', 'fact', 'occupied', 'relationship', NULL, 'active', FALSE,
        1, 0.5, 'occupied-revision', 'session', ?, ?)`, [timestamp, timestamp])
    })
    await occupied.close()
    await expect(transferMemoryDatabase({
      source: sqliteConfig(sourceHome), destination: postgresqlConfig(postgresql),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })).rejects.toThrow('destination is not empty')
    const preserved = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    try {
      expect(await preserved.read(em => em.execute(`SELECT id FROM memory_records WHERE id = 'occupied'`, [], 'get')))
        .toEqual({ id: 'occupied' })
    } finally {
      await preserved.close()
    }
  })

  it('does not publish partial destination state or modify the source on failure', async () => {
    const destinationHome = await sqliteHome()
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const source = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    await seed(source)
    await source.close()
    const emptyDestination = await openMemoryDatabase(sqliteConfig(destinationHome), 'persisted-actor')
    await emptyDestination.close()
    const path = join(destinationHome, 'storage', 'memory.sqlite')
    const raw = new DatabaseSync(path)
    raw.exec(`CREATE TRIGGER fail_memory_records_import BEFORE INSERT ON memory_records BEGIN SELECT RAISE(ABORT, 'injected transfer failure'); END`)
    raw.close()
    await expect(transferMemoryDatabase({
      source: postgresqlConfig(postgresql), destination: sqliteConfig(destinationHome),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })).rejects.toBeDefined()
    const rolledBack = new DatabaseSync(path, { readOnly: true })
    try {
      expect(rolledBack.prepare('SELECT COUNT(*) AS count FROM memory_records').get()?.count).toBe(0)
      expect(rolledBack.prepare('SELECT COUNT(*) AS count FROM memory_store').get()?.count).toBe(1)
    } finally {
      rolledBack.close()
    }
    const preservedSource = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    try {
      const result = await preservedSource.read(em => em.execute<{ count: unknown }>('SELECT COUNT(*) AS count FROM memory_records', [], 'get'))
      expect(Number(result.count)).toBe(2)
    } finally {
      await preservedSource.close()
    }
  })

  it('blocks inaccessible active local vector destinations and cleanup obligations', async () => {
    const home = await sqliteHome()
    const postgresql = await createPostgresqlFixture()
    postgresqlFixtures.push(postgresql)
    const source = await openMemoryDatabase(sqliteConfig(home), 'persisted-actor')
    await seed(source, 'sqlite_exact', 'c'.repeat(64))
    await source.close()
    await expect(transferMemoryDatabase({
      source: sqliteConfig(home), destination: postgresqlConfig(postgresql),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })).rejects.toThrow('inaccessible active local vector destination')
    const retained = await openMemoryDatabase(sqliteConfig(home), 'persisted-actor')
    await retained.write({ instanceId: 'memory-instance' }, async em => {
      await em.execute(`DELETE FROM memory_semantic_active_generation WHERE generation_id = 'generation-one'`)
      await em.execute(`UPDATE memory_semantic_generations
        SET state = 'retained', generation_revision = generation_revision + 1
        WHERE id = 'generation-one'`)
    })
    await retained.close()
    await expect(transferMemoryDatabase({
      source: sqliteConfig(home), destination: postgresqlConfig(postgresql),
      legacyActorId: 'persisted-actor', sourceStopped: true,
    })).rejects.toThrow('inaccessible local vector cleanup obligation')
    const destination = await openMemoryDatabase(postgresqlConfig(postgresql), 'persisted-actor')
    try {
      expect(await destination.read(em => em.execute('SELECT COUNT(*)::int AS count FROM memory_records', [], 'get')))
        .toEqual({ count: 0 })
    } finally {
      await destination.close()
    }
  })
})