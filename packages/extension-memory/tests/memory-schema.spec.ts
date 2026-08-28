import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/extension-persona'
import {
  InstanceSqliteService,
  type InstanceSqliteDatabase,
} from '@doppelganger/extension-sqlite'
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
    principalId: 'local-user',
    sessionId: 'schema-session',
    instanceHome,
    definitionRoot: instanceHome,
  }))
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

describe('memory schema', () => {
  it('creates production schema constraints and indexes idempotently', async () => {
    const fixture = await database()
    migrateMemorySchema(fixture.database, { legacyPrincipalId: 'local-user' })
    migrateMemorySchema(fixture.database, { legacyPrincipalId: 'local-user' })

    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(2)
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
      'memory_embeddings',
    ]))
    const columns = fixture.database.prepare('PRAGMA table_info(memory_records)').all().map(row => row.name)
    expect(columns).toEqual(expect.arrayContaining([
      'instance_id',
      'principal_id',
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
        id, instance_id, principal_id, kind, subject_key, scope_kind, project_id,
        status, confidence, salience, current_revision_id, source_session_id, created_at, updated_at
      ) VALUES ('bad', 'memory-instance', 'local-user', 'fact', 'bad', 'relationship', 'project',
        'active', 1, 1, 'missing', 'session', 'now', 'now')
    `).run()).toThrow()
    await fixture.context.fiber.dispose()
  })

  it('migrates populated version one state without losing lineage or eligibility', async () => {
    const fixture = await database()
    createVersionOne(fixture.database)
    insertVersionOneFixture(fixture.database)

    migrateMemorySchema(fixture.database, { legacyPrincipalId: 'legacy-user' })

    expect(fixture.database.prepare('SELECT version FROM memory_schema').get()?.version).toBe(2)
    expect(fixture.database.prepare(`
      SELECT principal_id, subject_key, scope_kind, pinned FROM memory_records WHERE id = 'relationship'
    `).get()).toEqual({
      principal_id: 'legacy-user',
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
    expect(fixture.database.prepare(`SELECT COUNT(*) AS count FROM memory_embeddings`).get()?.count).toBe(1)
    await fixture.context.fiber.dispose()
  })

  it('rolls back a failed migration and leaves version one recoverable', async () => {
    const fixture = await database()
    createVersionOne(fixture.database)
    const now = '2026-08-28T12:00:00.000Z'
    fixture.database.prepare(`
      INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('dangling', 'memory-instance', 'fact', 'global', null, 'active', 0, 'missing-revision', 'session', now, now)

    expect(() => migrateMemorySchema(fixture.database, { legacyPrincipalId: 'legacy-user' }))
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
    migrateMemorySchema(fixture.database, { legacyPrincipalId: 'local-user' })
    const now = '2026-08-28T12:00:00.000Z'
    fixture.database.exec(`
      INSERT INTO memory_records(
        id, instance_id, principal_id, kind, subject_key, scope_kind, project_id, status,
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
      INSERT INTO memory_embeddings VALUES ('record-one', 'revision-one', 'fake', 2, X'0102');
    `)

    expect(hardDeleteMemoryRecord(fixture.database, 'record-one')).toBe(true)
    for (const table of ['memory_records', 'memory_revisions', 'memory_evidence', 'memory_candidate_evidence', 'memory_fts', 'memory_embeddings']) {
      expect(fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0)
    }
    expect(fixture.database.prepare(`
      SELECT result_kind, result_record_id, result_revision_id FROM memory_operations WHERE operation_id = 'operation-one'
    `).get()).toEqual({ result_kind: 'deleted', result_record_id: null, result_revision_id: null })
    expect(hardDeleteMemoryRecord(fixture.database, 'record-one')).toBe(false)
    await fixture.context.fiber.dispose()
  })
})
