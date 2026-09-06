import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const TIMESTAMP = '2026-08-28T12:00:00.000Z'
const EMBEDDER_JSON = JSON.stringify({
  provider: 'fixture', modelId: 'fixture-model', revision: 'v1', artifactDigest: 'a'.repeat(64),
  pooling: 'mean', projection: 'none', dimensions: 3, normalized: true, distanceMetric: 'cosine',
})
const VECTOR_JSON = JSON.stringify({
  backend: 'qdrant', namespace: 'fixture', sanitizedTarget: 'https://vectors.example.test',
  configFingerprint: 'b'.repeat(64), dimensions: 3, distanceMetric: 'cosine',
})

export interface LegacyMemoryFixture {
  readonly path: string
  readonly version: 1 | 2 | 3 | 4
}

function createVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE memory_schema(version INTEGER NOT NULL);
    INSERT INTO memory_schema VALUES (1);
    CREATE TABLE memory_records (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, kind TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global', 'project')), project_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('active', 'candidate', 'rejected')),
      pinned INTEGER NOT NULL DEFAULT 0, current_revision_id TEXT,
      source_session_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, content TEXT NOT NULL, source_session_id TEXT NOT NULL,
      source_kind TEXT NOT NULL, supersedes_revision_id TEXT REFERENCES memory_revisions(id),
      created_at TEXT NOT NULL, UNIQUE(record_id, ordinal)
    );
    CREATE TABLE memory_candidate_evidence (
      candidate_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL, content TEXT NOT NULL,
      contradiction INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      PRIMARY KEY(candidate_id, source_session_id)
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(record_id UNINDEXED, revision_id UNINDEXED, content);
    CREATE TABLE memory_embeddings (
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL,
      PRIMARY KEY(record_id, revision_id, provider)
    );
    INSERT INTO memory_records VALUES
      ('relationship', 'memory-instance', 'preference', 'global', NULL, 'active', 1, 'relationship-r2', 'old-one', '${TIMESTAMP}', '${TIMESTAMP}'),
      ('candidate', 'memory-instance', 'fact', 'project', 'project-one', 'candidate', 0, 'candidate-r1', 'old-two', '${TIMESTAMP}', '${TIMESTAMP}');
    INSERT INTO memory_revisions VALUES
      ('relationship-r1', 'relationship', 1, 'Use concise answers.', 'old-one', 'explicit', NULL, '${TIMESTAMP}'),
      ('relationship-r2', 'relationship', 2, 'Use concise evidence-first answers.', 'old-two', 'correction', 'relationship-r1', '${TIMESTAMP}'),
      ('candidate-r1', 'candidate', 1, 'Possible project fact.', 'old-two', 'inferred', NULL, '${TIMESTAMP}');
    INSERT INTO memory_candidate_evidence VALUES
      ('candidate', 'old-two', 'Principal repeated the project fact.', 0, '${TIMESTAMP}');
    INSERT INTO memory_fts VALUES ('relationship', 'relationship-r2', 'Use concise evidence-first answers.');
    INSERT INTO memory_embeddings VALUES ('relationship', 'relationship-r2', 'fixture', 2, X'0102');
  `)
}

function createModernLegacy(database: DatabaseSync, version: 2 | 3 | 4): void {
  const actorColumn = version === 4 ? 'actor_id' : 'principal_id'
  database.exec(`
    CREATE TABLE memory_schema(version INTEGER NOT NULL);
    INSERT INTO memory_schema VALUES (${version});
    CREATE TABLE memory_records (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, ${actorColumn} TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('decision', 'fact', 'preference', 'procedure')),
      subject_key TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('relationship', 'project')),
      project_id TEXT, status TEXT NOT NULL CHECK(status IN ('active', 'candidate', 'rejected')),
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      salience REAL NOT NULL CHECK(salience >= 0 AND salience <= 1),
      valid_from TEXT, valid_until TEXT, expires_at TEXT, current_revision_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK((scope_kind = 'relationship' AND project_id IS NULL) OR (scope_kind = 'project' AND project_id IS NOT NULL)),
      CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
    );
    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK(ordinal > 0), content TEXT NOT NULL, source_session_id TEXT NOT NULL,
      source_kind TEXT NOT NULL, supersedes_revision_id TEXT REFERENCES memory_revisions(id),
      valid_from TEXT, valid_until TEXT, expires_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(record_id, ordinal)
    );
    CREATE TABLE memory_evidence (
      id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL, source_turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('principal', 'assistant', 'tool', 'system')),
      relation TEXT NOT NULL CHECK(relation IN ('support', 'contradiction')),
      excerpt TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(record_id, source_session_id, source_turn_id, role, relation, excerpt)
    );
    CREATE TABLE memory_conflicts (
      id TEXT PRIMARY KEY, active_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      candidate_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('unresolved', 'resolved-active', 'resolved-candidate', 'dismissed')),
      created_at TEXT NOT NULL, resolved_at TEXT, resolution_revision_id TEXT REFERENCES memory_revisions(id),
      UNIQUE(active_record_id, candidate_record_id, status)
    );
    CREATE TABLE memory_candidate_evidence (
      candidate_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES memory_evidence(id) ON DELETE CASCADE,
      PRIMARY KEY(candidate_id, evidence_id)
    );
    CREATE TABLE memory_operations (
      instance_id TEXT NOT NULL, ${actorColumn} TEXT NOT NULL, operation_id TEXT NOT NULL,
      command_kind TEXT NOT NULL, command_digest TEXT NOT NULL, result_kind TEXT NOT NULL,
      result_record_id TEXT, result_revision_id TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, ${actorColumn}, operation_id)
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(record_id UNINDEXED, revision_id UNINDEXED, content, tokenize = 'unicode61');
    CREATE INDEX memory_records_eligibility ON memory_records(instance_id, ${actorColumn}, scope_kind, project_id, status, valid_from, valid_until, expires_at);
    CREATE INDEX memory_records_subject ON memory_records(instance_id, ${actorColumn}, scope_kind, project_id, kind, subject_key, status);
    CREATE INDEX memory_evidence_record_relation ON memory_evidence(record_id, relation, source_session_id, role);
    CREATE INDEX memory_conflicts_candidate_status ON memory_conflicts(candidate_record_id, status);
    CREATE INDEX memory_conflicts_active_status ON memory_conflicts(active_record_id, status);
    CREATE INDEX memory_operations_record ON memory_operations(instance_id, ${actorColumn}, result_record_id);
    INSERT INTO memory_records VALUES
      ('record-one', 'memory-instance', 'persisted-actor', 'fact', 'legacy.actor', 'relationship', NULL, 'active', 0, 1, 0.5, NULL, NULL, NULL, 'revision-one', 'legacy-session', '${TIMESTAMP}', '${TIMESTAMP}'),
      ('candidate-one', 'memory-instance', 'persisted-actor', 'fact', 'legacy.candidate', 'relationship', NULL, 'candidate', 0, 0.7, 0.4, NULL, NULL, NULL, 'candidate-revision', 'legacy-session', '${TIMESTAMP}', '${TIMESTAMP}');
    INSERT INTO memory_revisions VALUES
      ('revision-one', 'record-one', 1, 'Persist this actor partition.', 'legacy-session', 'explicit', NULL, NULL, NULL, NULL, '${TIMESTAMP}'),
      ('candidate-revision', 'candidate-one', 1, 'Candidate content.', 'legacy-session', 'inferred', NULL, NULL, NULL, NULL, '${TIMESTAMP}');
    INSERT INTO memory_evidence VALUES ('evidence-one', 'candidate-one', 'legacy-session', 'turn-one', 'principal', 'support', 'Candidate content.', '${TIMESTAMP}');
    INSERT INTO memory_candidate_evidence VALUES ('candidate-one', 'evidence-one');
    INSERT INTO memory_conflicts VALUES ('conflict-one', 'record-one', 'candidate-one', 'evidence-one', 'unresolved', '${TIMESTAMP}', NULL, NULL);
    INSERT INTO memory_operations VALUES ('memory-instance', 'persisted-actor', 'legacy-operation', 'remember', 'digest', 'record', 'record-one', 'revision-one', '${TIMESTAMP}');
    INSERT INTO memory_fts VALUES ('record-one', 'revision-one', 'Persist this actor partition.');
  `)
  if (version === 2) {
    database.exec(`
      CREATE TABLE memory_embeddings (
        record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, dimensions INTEGER NOT NULL CHECK(dimensions > 0), vector BLOB NOT NULL,
        PRIMARY KEY(record_id, revision_id, provider)
      );
      INSERT INTO memory_embeddings VALUES ('record-one', 'revision-one', 'fixture', 2, X'0102');
    `)
    return
  }
  database.exec(`
    CREATE TABLE memory_semantic_generations (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, embedder_identity_json TEXT NOT NULL,
      vector_index_identity_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('building', 'active', 'retained', 'failed', 'deleting')),
      created_at TEXT NOT NULL, activated_at TEXT, completed_at TEXT, failure_code TEXT
    );
    CREATE TABLE memory_semantic_active_generation (
      instance_id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_semantic_indexed_revisions (
      generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      indexed_at TEXT NOT NULL, PRIMARY KEY(generation_id, record_id)
    );
    CREATE TABLE memory_vector_projection_work (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK(operation = 'upsert'), state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at TEXT NOT NULL, lease_until TEXT,
      last_failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_vector_deletions (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL, revision_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at TEXT NOT NULL, lease_until TEXT,
      last_failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_embedding_cache (
      embedder_fingerprint TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      content_digest TEXT NOT NULL, dimensions INTEGER NOT NULL CHECK(dimensions > 0), vector BLOB NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(embedder_fingerprint, record_id, revision_id)
    );
    CREATE UNIQUE INDEX memory_semantic_generation_active ON memory_semantic_generations(instance_id) WHERE state = 'active';
    CREATE INDEX memory_semantic_generation_state ON memory_semantic_generations(instance_id, state, created_at);
    CREATE INDEX memory_semantic_indexed_revision ON memory_semantic_indexed_revisions(record_id, revision_id, generation_id);
    CREATE INDEX memory_vector_projection_ready ON memory_vector_projection_work(generation_id, state, available_at, created_at, id);
    CREATE INDEX memory_vector_deletion_ready ON memory_vector_deletions(generation_id, state, available_at, created_at, id);
    CREATE INDEX memory_embedding_cache_record ON memory_embedding_cache(record_id, revision_id, embedder_fingerprint);
    INSERT INTO memory_semantic_generations VALUES ('generation-one', 'memory-instance', '${EMBEDDER_JSON.replaceAll("'", "''")}', '${VECTOR_JSON.replaceAll("'", "''")}', 'active', '${TIMESTAMP}', '${TIMESTAMP}', '${TIMESTAMP}', NULL);
    INSERT INTO memory_semantic_active_generation VALUES ('memory-instance', 'generation-one', '${TIMESTAMP}');
    INSERT INTO memory_semantic_indexed_revisions VALUES ('generation-one', 'record-one', 'revision-one', '${TIMESTAMP}');
    INSERT INTO memory_vector_projection_work VALUES ('work-one', 'generation-one', 'record-one', 'revision-one', 'upsert', 'leased', 1, '${TIMESTAMP}', '2026-08-28T13:00:00.000Z', NULL, '${TIMESTAMP}', '${TIMESTAMP}');
    INSERT INTO memory_vector_deletions VALUES ('deletion-one', 'generation-one', 'forgotten-record', 'forgotten-revision', 'leased', 2, '${TIMESTAMP}', '2026-08-28T13:00:00.000Z', NULL, '${TIMESTAMP}', '${TIMESTAMP}');
  `)
}

export async function createLegacyMemoryFixture(home: string, version: 1 | 2 | 3 | 4): Promise<LegacyMemoryFixture> {
  const directory = join(home, 'storage')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'memory.sqlite')
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true })
  try {
    if (version === 1) createVersionOne(database)
    else createModernLegacy(database, version)
  } finally {
    database.close()
  }
  return Object.freeze({ path, version })
}
