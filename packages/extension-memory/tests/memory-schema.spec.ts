import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import {
  InstanceSqliteService,
  type InstanceSqliteDatabase,
} from '@doppelganger/doppelganger-sqlite'
import { hardDeleteMemoryRecord, migrateMemorySchema } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function database(): Promise<{ context: Context; database: InstanceSqliteDatabase }> {
  const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-schema-'))
  temporaryRoots.push(instanceHome)
  const context = new Context()
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'memory-instance',
    sessionId: 'schema-session',
  }))
  await context.plugin(createActorIdentityPlugin('local-user'))
  await context.plugin(InstanceSqliteService, { home: instanceHome })
  return { context, database: await context.doppelgangerInstanceSqlite.open('memory') }
}

function createVersionOne(database: InstanceSqliteDatabase): void {
  database.exec(`
    CREATE TABLE memory_schema(version INTEGER NOT NULL);
    INSERT INTO memory_schema VALUES (1);
    CREATE TABLE memory_records (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global', 'project')),
      project_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('active', 'candidate', 'rejected')),
      pinned INTEGER NOT NULL DEFAULT 0,
      current_revision_id TEXT,
      source_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      supersedes_revision_id TEXT REFERENCES memory_revisions(id),
      created_at TEXT NOT NULL,
      UNIQUE(record_id, ordinal)
    );
    CREATE TABLE memory_candidate_evidence (
      candidate_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      contradiction INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY(candidate_id, source_session_id)
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(record_id UNINDEXED, revision_id UNINDEXED, content);
    CREATE TABLE memory_embeddings (
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY(record_id, revision_id, provider)
    );
  `)
}

function insertVersionOneFixture(database: InstanceSqliteDatabase): void {
  const now = '2026-08-28T12:00:00.000Z'
  database.exec(`
    INSERT INTO memory_records VALUES
      ('relationship', 'memory-instance', 'preference', 'global', NULL, 'active', 1, 'relationship-r2', 'old-one', '${now}', '${now}'),
      ('project', 'memory-instance', 'decision', 'project', 'project-one', 'active', 0, 'project-r1', 'old-two', '${now}', '${now}'),
      ('candidate', 'memory-instance', 'fact', 'project', 'project-one', 'candidate', 0, 'candidate-r1', 'old-three', '${now}', '${now}');
    INSERT INTO memory_revisions VALUES
      ('relationship-r1', 'relationship', 1, 'Use concise answers.', 'old-one', 'explicit', NULL, '${now}'),
      ('relationship-r2', 'relationship', 2, 'Use concise evidence-first answers.', 'old-two', 'correction', 'relationship-r1', '${now}'),
      ('project-r1', 'project', 1, 'Project uses SQLite.', 'old-two', 'explicit', NULL, '${now}'),
      ('candidate-r1', 'candidate', 1, 'Possible project fact.', 'old-three', 'inferred', NULL, '${now}');
    INSERT INTO memory_candidate_evidence VALUES
      ('candidate', 'old-four', 'Principal repeated the project fact.', 0, '${now}');
    INSERT INTO memory_fts VALUES
      ('relationship', 'relationship-r2', 'Use concise evidence-first answers.'),
      ('project', 'project-r1', 'Project uses SQLite.');
    INSERT INTO memory_embeddings VALUES
      ('project', 'project-r1', 'fixture', 2, X'0102');
  `)
}


function downgradeActorSchema(database: InstanceSqliteDatabase, version: 2 | 3): void {
  database.exec(`
    ALTER TABLE memory_records RENAME COLUMN actor_id TO principal_id;
    ALTER TABLE memory_operations RENAME COLUMN actor_id TO principal_id;
  `)
  if (version === 2) {
    database.exec(`
      DROP TABLE memory_semantic_active_generation;
      DROP TABLE memory_semantic_indexed_revisions;
      DROP TABLE memory_vector_projection_work;
      DROP TABLE memory_vector_deletions;
      DROP TABLE memory_embedding_cache;
      DROP TABLE memory_semantic_generations;
      CREATE TABLE memory_embeddings (
        record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK(dimensions > 0),
        vector BLOB NOT NULL,
        PRIMARY KEY(record_id, revision_id, provider)
      );
    `)
  }
  database.prepare('UPDATE memory_schema SET version = ?').run(version)
}

function insertLegacyActorFixture(database: InstanceSqliteDatabase): void {
  const now = '2026-08-29T12:00:00.000Z'
  database.exec(`
    INSERT INTO memory_records(
      id, instance_id, principal_id, kind, subject_key, scope_kind, project_id, status,
      pinned, confidence, salience, current_revision_id, source_session_id, created_at, updated_at
    ) VALUES ('legacy-record', 'memory-instance', 'persisted-actor', 'fact', 'legacy.actor', 'relationship', NULL,
      'active', 0, 1, 0.5, 'legacy-revision', 'legacy-session', '${now}', '${now}');
    INSERT INTO memory_revisions(
      id, record_id, ordinal, content, source_session_id, source_kind, created_at
    ) VALUES ('legacy-revision', 'legacy-record', 1, 'Persist this actor partition.', 'legacy-session', 'explicit', '${now}');
    INSERT INTO memory_operations(
      instance_id, principal_id, operation_id, command_kind, command_digest,
      result_kind, result_record_id, result_revision_id, created_at
    ) VALUES ('memory-instance', 'persisted-actor', 'legacy-operation', 'remember', 'digest',
      'record', 'legacy-record', 'legacy-revision', '${now}');
  `)
}
describe('memory schema', () => {
  it('creates production schema constraints and indexes idempotently', async () => {
    const fixture = await database()
    migrateMemorySchema(fixture.database, { legacyActorId: 'local-user' })
    migrateMemorySchema(fixture.database, { legacyActorId: 'local-user' })

    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(4)
    const tables = fixture.database.prepare(`
      SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name
    `).all().map(row => row.name)
    expect(tables).toEqual(expect.arrayContaining([
      'memory_records',
      'memory_revisions',
      'memory_evidence',
      'memory_conflicts',
      'memory_candidate_evidence',
      'memory_operations',
      'memory_fts',
      'memory_semantic_generations',
      'memory_semantic_active_generation',
      'memory_semantic_indexed_revisions',
      'memory_vector_projection_work',
      'memory_vector_deletions',
      'memory_embedding_cache',
    ]))
    const columns = fixture.database.prepare('PRAGMA table_info(memory_records)').all().map(row => row.name)
    expect(columns).toEqual(expect.arrayContaining([
      'instance_id',
      'actor_id',
      'subject_key',
      'scope_kind',
      'confidence',
      'salience',
      'valid_from',
      'valid_until',
      'expires_at',
      'current_revision_id',
    ]))
    const indexes = fixture.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name
    `).all().map(row => row.name)
    expect(indexes).toEqual(expect.arrayContaining([
      'memory_records_eligibility',
      'memory_records_subject',
      'memory_evidence_record_relation',
      'memory_conflicts_candidate_status',
      'memory_operations_record',
    ]))
    expect(() => fixture.database.prepare(`
      INSERT INTO memory_records(
        id, instance_id, actor_id, kind, subject_key, scope_kind, project_id,
        status, confidence, salience, current_revision_id, source_session_id, created_at, updated_at
      ) VALUES ('bad', 'memory-instance', 'local-user', 'fact', 'bad', 'relationship', 'project',
        'active', 1, 1, 'missing', 'session', 'now', 'now')
    `).run()).toThrow()
    await fixture.context.fiber.dispose()
  })

  it.each([2, 3] as const)('migrates populated version %i actor partitions without data loss', async (version) => {
    const fixture = await database()
    migrateMemorySchema(fixture.database, { legacyActorId: 'bootstrap-actor' })
    downgradeActorSchema(fixture.database, version)
    insertLegacyActorFixture(fixture.database)

    migrateMemorySchema(fixture.database, { legacyActorId: 'ignored-for-version-two-and-three' })

    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(4)
    expect(fixture.database.prepare(`
      SELECT actor_id, subject_key FROM memory_records WHERE id = 'legacy-record'
    `).get()).toEqual({ actor_id: 'persisted-actor', subject_key: 'legacy.actor' })
    expect(fixture.database.prepare(`
      SELECT actor_id, result_record_id FROM memory_operations WHERE operation_id = 'legacy-operation'
    `).get()).toEqual({ actor_id: 'persisted-actor', result_record_id: 'legacy-record' })
    expect(fixture.database.prepare('PRAGMA table_info(memory_records)').all().map(row => row.name))
      .not.toContain('principal_id')
    expect(fixture.database.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_semantic_generations'`).get())
      .toBeDefined()
    await fixture.context.fiber.dispose()
  })

  it('rolls back a failed version three actor-column migration', async () => {
    const fixture = await database()
    migrateMemorySchema(fixture.database, { legacyActorId: 'bootstrap-actor' })
    downgradeActorSchema(fixture.database, 3)
    fixture.database.exec(`
      ALTER TABLE memory_records ADD COLUMN actor_id TEXT;
      ALTER TABLE memory_operations ADD COLUMN actor_id TEXT;
    `)

    expect(() => migrateMemorySchema(fixture.database, { legacyActorId: 'actor' })).toThrow()
    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(3)
    const columns = fixture.database.prepare('PRAGMA table_info(memory_records)').all().map(row => row.name)
    expect(columns).toEqual(expect.arrayContaining(['principal_id', 'actor_id']))
    await fixture.context.fiber.dispose()
  })

  it('migrates populated version one state without losing lineage or eligibility', async () => {
    const fixture = await database()
    createVersionOne(fixture.database)
    insertVersionOneFixture(fixture.database)

    migrateMemorySchema(fixture.database, { legacyActorId: 'legacy-user' })

    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(4)
    expect(fixture.database.prepare(`
      SELECT actor_id, subject_key, scope_kind, pinned FROM memory_records WHERE id = 'relationship'
    `).get()).toEqual({
      actor_id: 'legacy-user',
      subject_key: 'legacy.relationship',
      scope_kind: 'relationship',
      pinned: 1,
    })
    expect(fixture.database.prepare(`
      SELECT scope_kind, project_id FROM memory_records WHERE id = 'project'
    `).get()).toEqual({ scope_kind: 'project', project_id: 'project-one' })
    expect(fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM memory_revisions WHERE record_id = 'relationship'
    `).get()?.count).toBe(2)
    expect(fixture.database.prepare(`
      SELECT relation, excerpt FROM memory_evidence WHERE record_id = 'candidate'
    `).get()).toEqual({ relation: 'support', excerpt: 'Principal repeated the project fact.' })
    expect(fixture.database.prepare(`
      SELECT record_id FROM memory_fts WHERE memory_fts MATCH 'SQLite'
    `).get()?.record_id).toBe('project')
    expect(fixture.database.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_embeddings'`).get()).toBeUndefined()
    await fixture.context.fiber.dispose()
  })

  it('rolls back a failed migration and leaves version one recoverable', async () => {
    const fixture = await database()
    createVersionOne(fixture.database)
    const now = '2026-08-28T12:00:00.000Z'
    fixture.database.prepare(`
      INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('dangling', 'memory-instance', 'fact', 'global', null, 'active', 0, 'missing-revision', 'session', now, now)

    expect(() => migrateMemorySchema(fixture.database, { legacyActorId: 'legacy-user' }))
      .toThrow('migration integrity check failed')
    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(1)
    expect(fixture.database.prepare('SELECT scope_kind, current_revision_id FROM memory_records WHERE id = ?')
      .get('dangling')).toEqual({ scope_kind: 'global', current_revision_id: 'missing-revision' })
    expect(fixture.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_records_v1'
    `).get()).toBeUndefined()
    await fixture.context.fiber.dispose()
  })

  it('hard deletion removes canonical and derived rows while retaining content-free replay protection', async () => {
    const fixture = await database()
    migrateMemorySchema(fixture.database, { legacyActorId: 'local-user' })
    const now = '2026-08-28T12:00:00.000Z'
    fixture.database.exec(`
      INSERT INTO memory_records(
        id, instance_id, actor_id, kind, subject_key, scope_kind, project_id, status,
        confidence, salience, current_revision_id, source_session_id, created_at, updated_at
      ) VALUES ('record-one', 'memory-instance', 'local-user', 'fact', 'project.fact', 'project', 'project-one',
        'active', 1, 0.5, 'revision-one', 'session-one', '${now}', '${now}');
      INSERT INTO memory_revisions(
        id, record_id, ordinal, content, source_session_id, source_kind, created_at
      ) VALUES ('revision-one', 'record-one', 1, 'remember this', 'session-one', 'explicit', '${now}');
      INSERT INTO memory_evidence VALUES
        ('evidence-one', 'record-one', 'session-one', 'turn-one', 'principal', 'support', 'remember this', '${now}');
      INSERT INTO memory_candidate_evidence VALUES ('record-one', 'evidence-one');
      INSERT INTO memory_operations VALUES
        ('memory-instance', 'local-user', 'operation-one', 'remember', 'digest', 'record', 'record-one', 'revision-one', '${now}');
      INSERT INTO memory_fts VALUES ('record-one', 'revision-one', 'remember this');
      INSERT INTO memory_semantic_generations VALUES
        ('generation-one', 'memory-instance', '{}', '{}', 'active', '${now}', '${now}', '${now}', NULL);
      INSERT INTO memory_semantic_active_generation VALUES ('memory-instance', 'generation-one', '${now}');
      INSERT INTO memory_semantic_indexed_revisions VALUES
        ('generation-one', 'record-one', 'revision-one', '${now}');
      INSERT INTO memory_vector_projection_work VALUES
        ('work-one', 'generation-one', 'record-one', 'revision-one', 'upsert', 'pending', 0, '${now}', NULL, NULL, '${now}', '${now}');
      INSERT INTO memory_embedding_cache VALUES
        ('embedder-fingerprint', 'record-one', 'revision-one', 'content-digest', 2, X'0102', '${now}');
    `)

    expect(hardDeleteMemoryRecord(fixture.database, 'record-one')).toBe(true)
    for (const table of ['memory_records', 'memory_revisions', 'memory_evidence', 'memory_candidate_evidence', 'memory_fts', 'memory_semantic_indexed_revisions', 'memory_vector_projection_work', 'memory_embedding_cache']) {
      expect(fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0)
    }
    expect(fixture.database.prepare(`
      SELECT result_kind, result_record_id, result_revision_id FROM memory_operations WHERE operation_id = 'operation-one'
    `).get()).toEqual({ result_kind: 'deleted', result_record_id: null, result_revision_id: null })
    expect(hardDeleteMemoryRecord(fixture.database, 'record-one')).toBe(false)
    await fixture.context.fiber.dispose()
  })
})
