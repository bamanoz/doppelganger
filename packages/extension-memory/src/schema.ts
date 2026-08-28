import type { InstanceSqliteDatabase } from '@doppelganger/extension-sqlite'

export const MEMORY_SCHEMA_VERSION = 2

export interface MemoryMigrationOptions {
  readonly legacyPrincipalId: string
}

function requiredId(field: string, value: string): string {
  value = value.trim()
  if (value.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function createVersionTwo(storage: InstanceSqliteDatabase): void {
  storage.exec(`
    CREATE TABLE memory_records (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('decision', 'fact', 'preference', 'procedure')),
      subject_key TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK(scope_kind IN ('relationship', 'project')),
      project_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('active', 'candidate', 'rejected')),
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      salience REAL NOT NULL CHECK(salience >= 0 AND salience <= 1),
      valid_from TEXT,
      valid_until TEXT,
      expires_at TEXT,
      current_revision_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK((scope_kind = 'relationship' AND project_id IS NULL) OR (scope_kind = 'project' AND project_id IS NOT NULL)),
      CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
    );
    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK(ordinal > 0),
      content TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      supersedes_revision_id TEXT REFERENCES memory_revisions(id),
      valid_from TEXT,
      valid_until TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(record_id, ordinal)
    );
    CREATE TABLE memory_evidence (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL,
      source_turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('principal', 'assistant', 'tool', 'system')),
      relation TEXT NOT NULL CHECK(relation IN ('support', 'contradiction')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(record_id, source_session_id, source_turn_id, role, relation, excerpt)
    );
    CREATE TABLE memory_conflicts (
      id TEXT PRIMARY KEY,
      active_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      candidate_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('unresolved', 'resolved-active', 'resolved-candidate', 'dismissed')),
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_revision_id TEXT REFERENCES memory_revisions(id),
      UNIQUE(active_record_id, candidate_record_id, status)
    );
    CREATE TABLE memory_candidate_evidence (
      candidate_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES memory_evidence(id) ON DELETE CASCADE,
      PRIMARY KEY(candidate_id, evidence_id)
    );
    CREATE TABLE memory_operations (
      instance_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      command_kind TEXT NOT NULL,
      command_digest TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      result_record_id TEXT,
      result_revision_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, principal_id, operation_id)
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(
      record_id UNINDEXED,
      revision_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    );
    CREATE TABLE memory_embeddings (
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK(dimensions > 0),
      vector BLOB NOT NULL,
      PRIMARY KEY(record_id, revision_id, provider)
    );
    CREATE INDEX memory_records_eligibility
      ON memory_records(instance_id, principal_id, scope_kind, project_id, status, valid_from, valid_until, expires_at);
    CREATE INDEX memory_records_subject
      ON memory_records(instance_id, principal_id, scope_kind, project_id, kind, subject_key, status);
    CREATE INDEX memory_evidence_record_relation
      ON memory_evidence(record_id, relation, source_session_id, role);
    CREATE INDEX memory_conflicts_candidate_status
      ON memory_conflicts(candidate_record_id, status);
    CREATE INDEX memory_conflicts_active_status
      ON memory_conflicts(active_record_id, status);
    CREATE INDEX memory_operations_record
      ON memory_operations(instance_id, principal_id, result_record_id);
  `)
}

function count(storage: InstanceSqliteDatabase, table: string): number {
  return Number(storage.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count)
}
function outputText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid legacy memory ${field}`)
  return value
}


function migrateVersionOne(storage: InstanceSqliteDatabase, legacyPrincipalId: string): void {
  const recordCount = count(storage, 'memory_records')
  const revisionCount = count(storage, 'memory_revisions')
  const candidateEvidenceCount = count(storage, 'memory_candidate_evidence')
  storage.exec(`
    ALTER TABLE memory_records RENAME TO memory_records_v1;
    ALTER TABLE memory_revisions RENAME TO memory_revisions_v1;
    ALTER TABLE memory_candidate_evidence RENAME TO memory_candidate_evidence_v1;
    ALTER TABLE memory_embeddings RENAME TO memory_embeddings_v1;
    DROP TABLE memory_fts;
  `)
  createVersionTwo(storage)
  storage.prepare(`
    INSERT INTO memory_records(
      id, instance_id, principal_id, kind, subject_key, scope_kind, project_id, status,
      pinned, confidence, salience, valid_from, valid_until, expires_at,
      current_revision_id, source_session_id, created_at, updated_at
    )
    SELECT
      id, instance_id, ?, kind, 'legacy.' || id,
      CASE scope_kind WHEN 'global' THEN 'relationship' ELSE 'project' END,
      project_id, status, pinned, 1.0, 0.5, NULL, NULL, NULL,
      current_revision_id, source_session_id, created_at, updated_at
    FROM memory_records_v1
  `).run(legacyPrincipalId)
  storage.exec(`
    INSERT INTO memory_revisions(
      id, record_id, ordinal, content, source_session_id, source_kind,
      supersedes_revision_id, valid_from, valid_until, expires_at, created_at
    )
    SELECT id, record_id, ordinal, content, source_session_id, source_kind,
           supersedes_revision_id, NULL, NULL, NULL, created_at
    FROM memory_revisions_v1;
  `)
  const legacyEvidence = storage.prepare(`
    SELECT candidate_id, source_session_id, content, contradiction, created_at
    FROM memory_candidate_evidence_v1
    ORDER BY candidate_id, source_session_id
  `).all()
  for (const [index, row] of legacyEvidence.entries()) {
    const evidenceId = `legacy.evidence.${index + 1}`
    const candidateId = outputText(row.candidate_id, 'candidate_id')
    const sessionId = outputText(row.source_session_id, 'source_session_id')
    storage.prepare(`
      INSERT INTO memory_evidence(
        id, record_id, source_session_id, source_turn_id, role, relation, excerpt, created_at
      ) VALUES (?, ?, ?, ?, 'principal', ?, ?, ?)
    `).run(
      evidenceId,
      candidateId,
      sessionId,
      `legacy.${sessionId}`,
      row.contradiction === 1 ? 'contradiction' : 'support',
      outputText(row.content, 'evidence content'),
      outputText(row.created_at, 'evidence created_at'),
    )
    storage.prepare('INSERT INTO memory_candidate_evidence(candidate_id, evidence_id) VALUES (?, ?)')
      .run(candidateId, evidenceId)
  }
  storage.exec(`
    INSERT INTO memory_embeddings(record_id, revision_id, provider, dimensions, vector)
    SELECT record_id, revision_id, provider, dimensions, vector FROM memory_embeddings_v1;
    INSERT INTO memory_fts(record_id, revision_id, content)
    SELECT r.id, r.current_revision_id, v.content
    FROM memory_records r
    JOIN memory_revisions v ON v.id = r.current_revision_id
    WHERE r.status = 'active';
  `)
  const dangling = Number(storage.prepare(`
    SELECT COUNT(*) AS count
    FROM memory_records r
    LEFT JOIN memory_revisions v ON v.id = r.current_revision_id AND v.record_id = r.id
    WHERE v.id IS NULL
  `).get()?.count)
  if (
    count(storage, 'memory_records') !== recordCount
    || count(storage, 'memory_revisions') !== revisionCount
    || count(storage, 'memory_candidate_evidence') !== candidateEvidenceCount
    || dangling !== 0
  ) {
    throw new Error('memory v1-to-v2 migration integrity check failed')
  }
  storage.exec(`
    DROP TABLE memory_candidate_evidence_v1;
    DROP TABLE memory_embeddings_v1;
    DROP TABLE memory_revisions_v1;
    DROP TABLE memory_records_v1;
  `)
}

export function migrateMemorySchema(
  database: InstanceSqliteDatabase,
  options: MemoryMigrationOptions,
): void {
  const legacyPrincipalId = requiredId('memory legacy principal ID', options.legacyPrincipalId)
  database.transaction((storage) => {
    storage.exec(`
      CREATE TABLE IF NOT EXISTS memory_schema (
        version INTEGER NOT NULL
      );
      INSERT INTO memory_schema(version)
      SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM memory_schema);
    `)
    const current = Number(storage.prepare('SELECT version FROM memory_schema').get()?.version)
    if (![0, 1, MEMORY_SCHEMA_VERSION].includes(current)) {
      throw new Error(`unsupported memory schema version: ${String(current)}`)
    }
    if (current === MEMORY_SCHEMA_VERSION) return
    if (current === 0) createVersionTwo(storage)
    else migrateVersionOne(storage, legacyPrincipalId)
    storage.prepare('UPDATE memory_schema SET version = ?').run(MEMORY_SCHEMA_VERSION)
  })
}

export function deleteMemoryRecordRows(database: InstanceSqliteDatabase, recordId: string): boolean {
  const exists = database.prepare('SELECT 1 AS found FROM memory_records WHERE id = ?').get(recordId)
  if (exists === undefined) return false
  database.prepare(`
    UPDATE memory_operations
    SET result_kind = 'deleted', result_record_id = NULL, result_revision_id = NULL
    WHERE result_record_id = ?
  `).run(recordId)
  database.prepare('DELETE FROM memory_conflicts WHERE active_record_id = ? OR candidate_record_id = ?')
    .run(recordId, recordId)
  database.prepare('DELETE FROM memory_candidate_evidence WHERE candidate_id = ?').run(recordId)
  database.prepare('DELETE FROM memory_evidence WHERE record_id = ?').run(recordId)
  database.prepare('DELETE FROM memory_embeddings WHERE record_id = ?').run(recordId)
  database.prepare('DELETE FROM memory_fts WHERE record_id = ?').run(recordId)
  database.prepare('DELETE FROM memory_revisions WHERE record_id = ?').run(recordId)
  return database.prepare('DELETE FROM memory_records WHERE id = ?').run(recordId).changes === 1
}

export function hardDeleteMemoryRecord(database: InstanceSqliteDatabase, recordId: string): boolean {
  return database.transaction(storage => deleteMemoryRecordRows(storage, recordId))
}
