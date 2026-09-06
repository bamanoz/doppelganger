import { createHash, randomUUID } from 'node:crypto'
import type { SqlEntityManager } from '@mikro-orm/sql'
import {
  memoryEmbedderFingerprint,
  validateMemoryEmbedderIdentity,
  validateMemoryVectorIndexIdentity,
} from '../semantic.ts'

export const MEMORY_SCHEMA_VERSION = 5

export type MemoryDatabaseKind = 'sqlite' | 'postgresql'
type Row = Record<string, unknown>

const CORE_TABLES = Object.freeze([
  'memory_records',
  'memory_revisions',
  'memory_evidence',
  'memory_conflicts',
  'memory_candidate_evidence',
  'memory_operations',
] as const)

export const MEMORY_TRANSFER_TABLES = Object.freeze([
  'memory_store',
  ...CORE_TABLES,
  'memory_semantic_generations',
  'memory_semantic_active_generation',
  'memory_semantic_indexed_revisions',
  'memory_vector_projection_work',
  'memory_vector_deletions',
  'memory_embedding_cache',
] as const)

const COMMON_COLUMNS = Object.freeze({
  memory_schema: ['version', 'fingerprint'],
  memory_store: ['id', 'created_at'],
  memory_instance_locks: ['instance_id'],
  memory_partition_locks: ['instance_id', 'actor_id'],
  memory_records: ['id', 'instance_id', 'actor_id', 'kind', 'subject_key', 'scope_kind', 'project_id', 'status', 'pinned', 'confidence', 'salience', 'valid_from', 'valid_until', 'expires_at', 'current_revision_id', 'source_session_id', 'created_at', 'updated_at'],
  memory_revisions: ['id', 'record_id', 'ordinal', 'content', 'source_session_id', 'source_kind', 'supersedes_revision_id', 'valid_from', 'valid_until', 'expires_at', 'created_at'],
  memory_evidence: ['id', 'record_id', 'source_session_id', 'source_turn_id', 'role', 'relation', 'excerpt', 'created_at'],
  memory_conflicts: ['id', 'active_record_id', 'candidate_record_id', 'evidence_id', 'status', 'created_at', 'resolved_at', 'resolution_revision_id'],
  memory_candidate_evidence: ['candidate_id', 'evidence_id'],
  memory_operations: ['instance_id', 'actor_id', 'operation_id', 'command_kind', 'command_digest', 'result_kind', 'result_record_id', 'result_revision_id', 'created_at'],
  memory_semantic_generations: ['id', 'store_id', 'instance_id', 'embedder_identity_json', 'vector_index_identity_json', 'embedder_fingerprint', 'vector_backend', 'vector_target_id', 'generation_revision', 'transition_token', 'transition_until', 'state', 'created_at', 'activated_at', 'completed_at', 'failure_code'],
  memory_semantic_active_generation: ['store_id', 'instance_id', 'generation_id', 'generation_revision', 'updated_at'],
  memory_semantic_indexed_revisions: ['store_id', 'instance_id', 'generation_id', 'record_id', 'revision_id', 'indexed_at'],
  memory_vector_projection_work: ['id', 'store_id', 'instance_id', 'generation_id', 'record_id', 'revision_id', 'vector_backend', 'vector_target_id', 'operation', 'state', 'attempts', 'available_at', 'lease_until', 'lease_token', 'last_failure_code', 'created_at', 'updated_at'],
  memory_vector_deletions: ['id', 'store_id', 'instance_id', 'generation_id', 'record_id', 'revision_id', 'vector_backend', 'vector_target_id', 'state', 'attempts', 'available_at', 'lease_until', 'lease_token', 'last_failure_code', 'created_at', 'updated_at'],
  memory_embedding_cache: ['embedder_fingerprint', 'record_id', 'revision_id', 'content_digest', 'dimensions', 'vector', 'created_at'],
} as const)

const SQLITE_COLUMNS = Object.freeze({ ...COMMON_COLUMNS, memory_fts: ['record_id', 'revision_id', 'content'] })
const POSTGRESQL_COLUMNS = Object.freeze({ ...COMMON_COLUMNS, memory_lexical_index: ['record_id', 'revision_id', 'content', 'document'] })

const REQUIRED_INDEXES = Object.freeze([
  'memory_records_eligibility',
  'memory_records_subject',
  'memory_evidence_record_relation',
  'memory_conflicts_candidate_status',
  'memory_conflicts_active_status',
  'memory_operations_record',
  'memory_semantic_generation_active',
  'memory_semantic_generation_state',
  'memory_semantic_indexed_revision',
  'memory_vector_projection_ready',
  'memory_vector_deletion_ready',
  'memory_embedding_cache_record',
] as const)

function schemaFingerprint(kind: MemoryDatabaseKind): string {
  const columns = kind === 'sqlite' ? SQLITE_COLUMNS : POSTGRESQL_COLUMNS
  return createHash('sha256').update(JSON.stringify({ version: MEMORY_SCHEMA_VERSION, columns, indexes: REQUIRED_INDEXES })).digest('hex')
}

async function rows(em: SqlEntityManager, sql: string, params: readonly unknown[] = []): Promise<Row[]> {
  return await em.execute(sql, [...params], 'all') as Row[]
}

async function row(em: SqlEntityManager, sql: string, params: readonly unknown[] = []): Promise<Row | undefined> {
  return await em.execute(sql, [...params], 'get') as Row | undefined
}

async function run(em: SqlEntityManager, sql: string, params: readonly unknown[] = []): Promise<void> {
  await em.execute(sql, [...params], 'run')
}

async function executeStatements(em: SqlEntityManager, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await run(em, statement)
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`invalid memory ${field}`)
  return value
}

function integer(value: unknown, field: string): number {
  const output = Number(value)
  if (!Number.isSafeInteger(output)) throw new Error(`invalid memory ${field}`)
  return output
}

async function tableNames(em: SqlEntityManager, kind: MemoryDatabaseKind): Promise<string[]> {
  const result = kind === 'sqlite'
    ? await rows(em, "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
    : await rows(em, 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()')
  return result.map(value => requiredText(value.name, 'table name'))
}

async function tableExists(em: SqlEntityManager, kind: MemoryDatabaseKind, table: string): Promise<boolean> {
  if (kind === 'sqlite') return (await row(em, "SELECT 1 AS found FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?", [table])) !== undefined
  return (await row(em, 'SELECT 1 AS found FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?', [table])) !== undefined
}

async function tableColumns(em: SqlEntityManager, kind: MemoryDatabaseKind, table: string): Promise<string[]> {
  const result = kind === 'sqlite'
    ? await rows(em, `PRAGMA table_info("${table}")`)
    : await rows(em, 'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position', [table])
  return result.map(value => requiredText(kind === 'sqlite' ? value.name : value.name, `${table} column`))
}

async function indexNames(em: SqlEntityManager, kind: MemoryDatabaseKind): Promise<Set<string>> {
  const result = kind === 'sqlite'
    ? await rows(em, "SELECT name FROM sqlite_master WHERE type = 'index'")
    : await rows(em, 'SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()')
  return new Set(result.map(value => requiredText(value.name, 'index name')))
}


async function verifyVersionFive(em: SqlEntityManager, kind: MemoryDatabaseKind): Promise<void> {
  const expected = kind === 'sqlite' ? SQLITE_COLUMNS : POSTGRESQL_COLUMNS
  const names = new Set(await tableNames(em, kind))
  const unexpected = [...names].filter(name => name.startsWith('memory_') && !(name in expected) && !(kind === 'sqlite' && name.startsWith('memory_fts_')))
  if (unexpected.length > 0) throw new TypeError(`memory schema v5 contains unsupported table: ${unexpected[0]}`)
  for (const [table, columns] of Object.entries(expected)) {
    const actual = await tableColumns(em, kind, table)
    if (!names.has(table) || actual.length !== columns.length || actual.some((value, index) => value !== columns[index])) {
      throw new TypeError(`memory schema v5 fingerprint mismatch at ${table}`)
    }
  }
  const indexes = await indexNames(em, kind)
  for (const name of REQUIRED_INDEXES) if (!indexes.has(name)) throw new TypeError(`memory schema v5 fingerprint mismatch at ${name}`)
  if (kind === 'postgresql' && !indexes.has('memory_lexical_document')) throw new TypeError('memory schema v5 fingerprint mismatch at memory_lexical_document')
  const store = await row(em, 'SELECT COUNT(*) AS count, MIN(id) AS id FROM memory_store')
  if (integer(store?.count, 'store count') !== 1 || typeof store?.id !== 'string') throw new TypeError('memory schema v5 requires exactly one canonical store identity')
}

const SQLITE_CORE_DDL = Object.freeze([
  `CREATE TABLE memory_store (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
  `CREATE TABLE memory_instance_locks (instance_id TEXT PRIMARY KEY)`,
  `CREATE TABLE memory_partition_locks (instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, PRIMARY KEY(instance_id, actor_id))`,
  `CREATE TABLE memory_records (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, actor_id TEXT NOT NULL,
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
  )`,
  `CREATE TABLE memory_revisions (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal > 0), content TEXT NOT NULL, source_session_id TEXT NOT NULL,
    source_kind TEXT NOT NULL, supersedes_revision_id TEXT REFERENCES memory_revisions(id),
    valid_from TEXT, valid_until TEXT, expires_at TEXT, created_at TEXT NOT NULL,
    UNIQUE(record_id, ordinal)
  )`,
  `CREATE TABLE memory_evidence (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL, source_turn_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('principal', 'assistant', 'tool', 'system')),
    relation TEXT NOT NULL CHECK(relation IN ('support', 'contradiction')),
    excerpt TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(record_id, source_session_id, source_turn_id, role, relation, excerpt)
  )`,
  `CREATE TABLE memory_conflicts (
    id TEXT PRIMARY KEY, active_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    candidate_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK(status IN ('unresolved', 'resolved-active', 'resolved-candidate', 'dismissed')),
    created_at TEXT NOT NULL, resolved_at TEXT, resolution_revision_id TEXT REFERENCES memory_revisions(id),
    UNIQUE(active_record_id, candidate_record_id, status)
  )`,
  `CREATE TABLE memory_candidate_evidence (
    candidate_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES memory_evidence(id) ON DELETE CASCADE,
    PRIMARY KEY(candidate_id, evidence_id)
  )`,
  `CREATE TABLE memory_operations (
    instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    command_kind TEXT NOT NULL, command_digest TEXT NOT NULL, result_kind TEXT NOT NULL,
    result_record_id TEXT, result_revision_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY(instance_id, actor_id, operation_id)
  )`,
])

const POSTGRESQL_CORE_DDL = Object.freeze([
  `CREATE TABLE memory_store (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
  `CREATE TABLE memory_instance_locks (instance_id TEXT PRIMARY KEY)`,
  `CREATE TABLE memory_partition_locks (instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, PRIMARY KEY(instance_id, actor_id))`,
  `CREATE TABLE memory_records (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('decision', 'fact', 'preference', 'procedure')),
    subject_key TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('relationship', 'project')),
    project_id TEXT, status TEXT NOT NULL CHECK(status IN ('active', 'candidate', 'rejected')),
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    confidence DOUBLE PRECISION NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    salience DOUBLE PRECISION NOT NULL CHECK(salience >= 0 AND salience <= 1),
    valid_from TEXT, valid_until TEXT, expires_at TEXT, current_revision_id TEXT NOT NULL,
    source_session_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK((scope_kind = 'relationship' AND project_id IS NULL) OR (scope_kind = 'project' AND project_id IS NOT NULL)),
    CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
  )`,
  `CREATE TABLE memory_revisions (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal > 0), content TEXT NOT NULL, source_session_id TEXT NOT NULL,
    source_kind TEXT NOT NULL, supersedes_revision_id TEXT REFERENCES memory_revisions(id),
    valid_from TEXT, valid_until TEXT, expires_at TEXT, created_at TEXT NOT NULL,
    UNIQUE(record_id, ordinal)
  )`,
  `CREATE TABLE memory_evidence (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL, source_turn_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('principal', 'assistant', 'tool', 'system')),
    relation TEXT NOT NULL CHECK(relation IN ('support', 'contradiction')),
    excerpt TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(record_id, source_session_id, source_turn_id, role, relation, excerpt)
  )`,
  `CREATE TABLE memory_conflicts (
    id TEXT PRIMARY KEY, active_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    candidate_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK(status IN ('unresolved', 'resolved-active', 'resolved-candidate', 'dismissed')),
    created_at TEXT NOT NULL, resolved_at TEXT, resolution_revision_id TEXT REFERENCES memory_revisions(id),
    UNIQUE(active_record_id, candidate_record_id, status)
  )`,
  `CREATE TABLE memory_candidate_evidence (
    candidate_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES memory_evidence(id) ON DELETE CASCADE,
    PRIMARY KEY(candidate_id, evidence_id)
  )`,
  `CREATE TABLE memory_operations (
    instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    command_kind TEXT NOT NULL, command_digest TEXT NOT NULL, result_kind TEXT NOT NULL,
    result_record_id TEXT, result_revision_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY(instance_id, actor_id, operation_id)
  )`,
])

function projectionDdl(kind: MemoryDatabaseKind): readonly string[] {
  const bytes = kind === 'sqlite' ? 'BLOB' : 'BYTEA'
  return Object.freeze([
    `CREATE TABLE memory_semantic_generations (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES memory_store(id) ON DELETE RESTRICT,
      instance_id TEXT NOT NULL, embedder_identity_json TEXT NOT NULL, vector_index_identity_json TEXT NOT NULL,
      embedder_fingerprint TEXT NOT NULL, vector_backend TEXT NOT NULL, vector_target_id TEXT NOT NULL,
      generation_revision INTEGER NOT NULL CHECK(generation_revision >= 1),
      transition_token TEXT, transition_until TEXT,
      state TEXT NOT NULL CHECK(state IN ('building', 'active', 'retained', 'failed', 'deleting')),
      created_at TEXT NOT NULL, activated_at TEXT, completed_at TEXT, failure_code TEXT,
      UNIQUE(store_id, instance_id, id),
      CHECK((transition_token IS NULL AND transition_until IS NULL)
        OR (transition_token IS NOT NULL AND transition_until IS NOT NULL))
    )`,
    `CREATE TABLE memory_semantic_active_generation (
      store_id TEXT NOT NULL, instance_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      generation_revision INTEGER NOT NULL CHECK(generation_revision >= 1), updated_at TEXT NOT NULL,
      PRIMARY KEY(store_id, instance_id),
      FOREIGN KEY(store_id, instance_id, generation_id)
        REFERENCES memory_semantic_generations(store_id, instance_id, id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE memory_semantic_indexed_revisions (
      store_id TEXT NOT NULL, instance_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      indexed_at TEXT NOT NULL, PRIMARY KEY(generation_id, record_id),
      FOREIGN KEY(store_id, instance_id, generation_id)
        REFERENCES memory_semantic_generations(store_id, instance_id, id) ON DELETE CASCADE
    )`,
    `CREATE TABLE memory_vector_projection_work (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, instance_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      vector_backend TEXT NOT NULL, vector_target_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation = 'upsert'),
      state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at TEXT NOT NULL,
      lease_until TEXT, lease_token TEXT, last_failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(store_id, instance_id, generation_id)
        REFERENCES memory_semantic_generations(store_id, instance_id, id) ON DELETE CASCADE,
      CHECK((state = 'leased' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
        OR (state != 'leased' AND lease_until IS NULL AND lease_token IS NULL))
    )`,
    `CREATE TABLE memory_vector_deletions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES memory_store(id) ON DELETE RESTRICT,
      instance_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      record_id TEXT NOT NULL, revision_id TEXT NOT NULL, vector_backend TEXT NOT NULL, vector_target_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at TEXT NOT NULL,
      lease_until TEXT, lease_token TEXT, last_failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK((state = 'leased' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
        OR (state != 'leased' AND lease_until IS NULL AND lease_token IS NULL))
    )`,
    `CREATE TABLE memory_embedding_cache (
      embedder_fingerprint TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      content_digest TEXT NOT NULL, dimensions INTEGER NOT NULL CHECK(dimensions > 0),
      vector ${bytes} NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(embedder_fingerprint, record_id, revision_id)
    )`,
  ])
}

function indexDdl(): readonly string[] {
  return Object.freeze([
    `CREATE INDEX memory_records_eligibility ON memory_records(instance_id, actor_id, scope_kind, project_id, status, valid_from, valid_until, expires_at)`,
    `CREATE INDEX memory_records_subject ON memory_records(instance_id, actor_id, scope_kind, project_id, kind, subject_key, status)`,
    `CREATE INDEX memory_evidence_record_relation ON memory_evidence(record_id, relation, source_session_id, role)`,
    `CREATE INDEX memory_conflicts_candidate_status ON memory_conflicts(candidate_record_id, status)`,
    `CREATE INDEX memory_conflicts_active_status ON memory_conflicts(active_record_id, status)`,
    `CREATE INDEX memory_operations_record ON memory_operations(instance_id, actor_id, result_record_id)`,
    `CREATE UNIQUE INDEX memory_semantic_generation_active ON memory_semantic_generations(store_id, instance_id) WHERE state = 'active'`,
    `CREATE INDEX memory_semantic_generation_state ON memory_semantic_generations(store_id, instance_id, state, transition_until, created_at, id)`,
    `CREATE INDEX memory_semantic_indexed_revision ON memory_semantic_indexed_revisions(record_id, revision_id, generation_id)`,
    `CREATE INDEX memory_vector_projection_ready ON memory_vector_projection_work(store_id, instance_id, generation_id, vector_backend, vector_target_id, state, available_at, created_at, id)`,
    `CREATE INDEX memory_vector_deletion_ready ON memory_vector_deletions(store_id, instance_id, generation_id, vector_backend, vector_target_id, state, available_at, created_at, id)`,
    `CREATE INDEX memory_embedding_cache_record ON memory_embedding_cache(record_id, revision_id, embedder_fingerprint)`,
  ])
}

async function createVersionFive(em: SqlEntityManager, kind: MemoryDatabaseKind): Promise<void> {
  await run(em, 'CREATE TABLE memory_schema (version INTEGER NOT NULL, fingerprint TEXT NOT NULL)')
  await executeStatements(em, kind === 'sqlite' ? SQLITE_CORE_DDL : POSTGRESQL_CORE_DDL)
  await executeStatements(em, projectionDdl(kind))
  if (kind === 'sqlite') {
    await run(em, `CREATE VIRTUAL TABLE memory_fts USING fts5(record_id UNINDEXED, revision_id UNINDEXED, content, tokenize = 'unicode61')`)
  } else {
    await run(em, `CREATE TABLE memory_lexical_index (
      record_id TEXT PRIMARY KEY REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      document TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
    )`)
    await run(em, 'CREATE INDEX memory_lexical_document ON memory_lexical_index USING GIN(document)')
  }
  await executeStatements(em, indexDdl())
  await run(em, 'INSERT INTO memory_store(id, created_at) VALUES (?, ?)', [randomUUID(), new Date().toISOString()])
  await run(em, 'INSERT INTO memory_schema(version, fingerprint) VALUES (?, ?)', [MEMORY_SCHEMA_VERSION, schemaFingerprint(kind)])
}

async function createLegacyVersionTwo(em: SqlEntityManager): Promise<void> {
  await executeStatements(em, [
    ...SQLITE_CORE_DDL.slice(3).map(statement => statement.replaceAll('actor_id', 'principal_id')),
    `CREATE VIRTUAL TABLE memory_fts USING fts5(record_id UNINDEXED, revision_id UNINDEXED, content, tokenize = 'unicode61')`,
    `CREATE TABLE memory_embeddings (
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, dimensions INTEGER NOT NULL CHECK(dimensions > 0), vector BLOB NOT NULL,
      PRIMARY KEY(record_id, revision_id, provider)
    )`,
    ...indexDdl().slice(0, 6).map(statement => statement.replaceAll('actor_id', 'principal_id')),
  ])
}

async function count(em: SqlEntityManager, table: string): Promise<number> {
  return integer((await row(em, `SELECT COUNT(*) AS count FROM "${table}"`))?.count, `${table} count`)
}

async function migrateVersionOne(em: SqlEntityManager, legacyActorId: string): Promise<void> {
  const recordCount = await count(em, 'memory_records')
  const revisionCount = await count(em, 'memory_revisions')
  const candidateEvidenceCount = await count(em, 'memory_candidate_evidence')
  await executeStatements(em, [
    'ALTER TABLE memory_records RENAME TO memory_records_v1',
    'ALTER TABLE memory_revisions RENAME TO memory_revisions_v1',
    'ALTER TABLE memory_candidate_evidence RENAME TO memory_candidate_evidence_v1',
    'ALTER TABLE memory_embeddings RENAME TO memory_embeddings_v1',
    'DROP TABLE memory_fts',
  ])
  await createLegacyVersionTwo(em)
  await run(em, `INSERT INTO memory_records(
      id, instance_id, principal_id, kind, subject_key, scope_kind, project_id, status,
      pinned, confidence, salience, valid_from, valid_until, expires_at,
      current_revision_id, source_session_id, created_at, updated_at
    ) SELECT id, instance_id, ?, kind, 'legacy.' || id,
      CASE scope_kind WHEN 'global' THEN 'relationship' ELSE 'project' END,
      project_id, status, pinned, 1.0, 0.5, NULL, NULL, NULL,
      current_revision_id, source_session_id, created_at, updated_at FROM memory_records_v1`, [legacyActorId])
  await run(em, `INSERT INTO memory_revisions(
      id, record_id, ordinal, content, source_session_id, source_kind,
      supersedes_revision_id, valid_from, valid_until, expires_at, created_at
    ) SELECT id, record_id, ordinal, content, source_session_id, source_kind,
      supersedes_revision_id, NULL, NULL, NULL, created_at FROM memory_revisions_v1`)
  const evidence = await rows(em, `SELECT candidate_id, source_session_id, content, contradiction, created_at
    FROM memory_candidate_evidence_v1 ORDER BY candidate_id, source_session_id`)
  for (const [index, value] of evidence.entries()) {
    const evidenceId = `legacy.evidence.${index + 1}`
    const candidateId = requiredText(value.candidate_id, 'legacy candidate ID')
    const sessionId = requiredText(value.source_session_id, 'legacy source session ID')
    await run(em, `INSERT INTO memory_evidence(
      id, record_id, source_session_id, source_turn_id, role, relation, excerpt, created_at
    ) VALUES (?, ?, ?, ?, 'principal', ?, ?, ?)`, [
      evidenceId,
      candidateId,
      sessionId,
      `legacy.${sessionId}`,
      Number(value.contradiction) === 1 ? 'contradiction' : 'support',
      requiredText(value.content, 'legacy evidence content'),
      requiredText(value.created_at, 'legacy evidence timestamp'),
    ])
    await run(em, 'INSERT INTO memory_candidate_evidence(candidate_id, evidence_id) VALUES (?, ?)', [candidateId, evidenceId])
  }
  await run(em, 'INSERT INTO memory_embeddings(record_id, revision_id, provider, dimensions, vector) SELECT record_id, revision_id, provider, dimensions, vector FROM memory_embeddings_v1')
  await run(em, `INSERT INTO memory_fts(record_id, revision_id, content)
    SELECT r.id, r.current_revision_id, v.content FROM memory_records r
    JOIN memory_revisions v ON v.id = r.current_revision_id WHERE r.status = 'active'`)
  const dangling = await row(em, `SELECT COUNT(*) AS count FROM memory_records r
    LEFT JOIN memory_revisions v ON v.id = r.current_revision_id AND v.record_id = r.id WHERE v.id IS NULL`)
  if (await count(em, 'memory_records') !== recordCount
    || await count(em, 'memory_revisions') !== revisionCount
    || await count(em, 'memory_candidate_evidence') !== candidateEvidenceCount
    || integer(dangling?.count, 'dangling revision count') !== 0) {
    throw new Error('memory v1-to-v2 migration integrity check failed')
  }
  await executeStatements(em, [
    'DROP TABLE memory_candidate_evidence_v1',
    'DROP TABLE memory_embeddings_v1',
    'DROP TABLE memory_revisions_v1',
    'DROP TABLE memory_records_v1',
  ])
}

async function migrateVersionTwo(em: SqlEntityManager): Promise<void> {
  await run(em, 'DROP TABLE memory_embeddings')
  await executeStatements(em, [
    `CREATE TABLE memory_semantic_generations (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, embedder_identity_json TEXT NOT NULL,
      vector_index_identity_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('building', 'active', 'retained', 'failed', 'deleting')),
      created_at TEXT NOT NULL, activated_at TEXT, completed_at TEXT, failure_code TEXT
    )`,
    `CREATE TABLE memory_semantic_active_generation (
      instance_id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE memory_semantic_indexed_revisions (
      generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      indexed_at TEXT NOT NULL, PRIMARY KEY(generation_id, record_id)
    )`,
    `CREATE TABLE memory_vector_projection_work (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK(operation = 'upsert'), state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at TEXT NOT NULL, lease_until TEXT,
      last_failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE memory_vector_deletions (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES memory_semantic_generations(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL, revision_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at TEXT NOT NULL, lease_until TEXT,
      last_failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE memory_embedding_cache (
      embedder_fingerprint TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      content_digest TEXT NOT NULL, dimensions INTEGER NOT NULL CHECK(dimensions > 0), vector BLOB NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(embedder_fingerprint, record_id, revision_id)
    )`,
    `CREATE UNIQUE INDEX memory_semantic_generation_active ON memory_semantic_generations(instance_id) WHERE state = 'active'`,
    `CREATE INDEX memory_semantic_generation_state ON memory_semantic_generations(instance_id, state, created_at)`,
    `CREATE INDEX memory_semantic_indexed_revision ON memory_semantic_indexed_revisions(record_id, revision_id, generation_id)`,
    `CREATE INDEX memory_vector_projection_ready ON memory_vector_projection_work(generation_id, state, available_at, created_at, id)`,
    `CREATE INDEX memory_vector_deletion_ready ON memory_vector_deletions(generation_id, state, available_at, created_at, id)`,
    `CREATE INDEX memory_embedding_cache_record ON memory_embedding_cache(record_id, revision_id, embedder_fingerprint)`,
  ])
}

async function migrateVersionThree(em: SqlEntityManager): Promise<void> {
  await run(em, 'ALTER TABLE memory_records RENAME COLUMN principal_id TO actor_id')
  await run(em, 'ALTER TABLE memory_operations RENAME COLUMN principal_id TO actor_id')
}

interface GenerationRoute {
  readonly embedderFingerprint: string
  readonly vectorBackend: string
  readonly vectorTargetId: string
}

function generationRoute(value: Row): GenerationRoute {
  try {
    const embedder = validateMemoryEmbedderIdentity(JSON.parse(requiredText(value.embedder_identity_json, 'embedder identity JSON')))
    const vector = validateMemoryVectorIndexIdentity(JSON.parse(requiredText(value.vector_index_identity_json, 'vector identity JSON')))
    return Object.freeze({
      embedderFingerprint: memoryEmbedderFingerprint(embedder),
      vectorBackend: vector.backend,
      vectorTargetId: vector.configFingerprint,
    })
  } catch {
    throw new Error(`memory generation ${String(value.id)} has an invalid persisted identity`)
  }
}

async function migrateVersionFour(em: SqlEntityManager): Promise<void> {
  const storeId = randomUUID()
  const createdAt = new Date().toISOString()
  await run(em, 'CREATE TABLE memory_store (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)')
  await run(em, 'INSERT INTO memory_store(id, created_at) VALUES (?, ?)', [storeId, createdAt])
  await executeStatements(em, [
    'CREATE TABLE memory_instance_locks (instance_id TEXT PRIMARY KEY)',
    'CREATE TABLE memory_partition_locks (instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, PRIMARY KEY(instance_id, actor_id))',
    'ALTER TABLE memory_semantic_active_generation RENAME TO memory_semantic_active_generation_v4',
    'ALTER TABLE memory_semantic_indexed_revisions RENAME TO memory_semantic_indexed_revisions_v4',
    'ALTER TABLE memory_vector_projection_work RENAME TO memory_vector_projection_work_v4',
    'ALTER TABLE memory_vector_deletions RENAME TO memory_vector_deletions_v4',
    'ALTER TABLE memory_semantic_generations RENAME TO memory_semantic_generations_v4',
  ])
  await executeStatements(em, projectionDdl('sqlite').slice(0, 5))
  const generations = await rows(em, 'SELECT * FROM memory_semantic_generations_v4 ORDER BY id')
  for (const generation of generations) {
    const route = generationRoute(generation)
    await run(em, `INSERT INTO memory_semantic_generations(
      id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
      embedder_fingerprint, vector_backend, vector_target_id, generation_revision,
      transition_token, transition_until, state, created_at, activated_at, completed_at, failure_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?)`, [
      generation.id,
      storeId,
      generation.instance_id,
      generation.embedder_identity_json,
      generation.vector_index_identity_json,
      route.embedderFingerprint,
      route.vectorBackend,
      route.vectorTargetId,
      generation.state,
      generation.created_at,
      generation.activated_at,
      generation.completed_at,
      generation.failure_code,
    ])
  }
  await run(em, `INSERT INTO memory_semantic_active_generation(store_id, instance_id, generation_id, generation_revision, updated_at)
    SELECT ?, a.instance_id, a.generation_id, 1, a.updated_at
    FROM memory_semantic_active_generation_v4 a`, [storeId])
  await run(em, `INSERT INTO memory_semantic_indexed_revisions(store_id, instance_id, generation_id, record_id, revision_id, indexed_at)
    SELECT ?, g.instance_id, i.generation_id, i.record_id, i.revision_id, i.indexed_at
    FROM memory_semantic_indexed_revisions_v4 i JOIN memory_semantic_generations g ON g.id = i.generation_id`, [storeId])
  await run(em, `INSERT INTO memory_vector_projection_work(
      id, store_id, instance_id, generation_id, record_id, revision_id, vector_backend, vector_target_id,
      operation, state, attempts, available_at, lease_until, lease_token, last_failure_code, created_at, updated_at
    ) SELECT w.id, ?, g.instance_id, w.generation_id, w.record_id, w.revision_id, g.vector_backend, g.vector_target_id,
      w.operation, CASE WHEN w.state = 'leased' THEN 'pending' ELSE w.state END, w.attempts, w.available_at,
      NULL, NULL, w.last_failure_code, w.created_at, w.updated_at
    FROM memory_vector_projection_work_v4 w JOIN memory_semantic_generations g ON g.id = w.generation_id`, [storeId])
  await run(em, `INSERT INTO memory_vector_deletions(
      id, store_id, instance_id, generation_id, record_id, revision_id, vector_backend, vector_target_id,
      state, attempts, available_at, lease_until, lease_token, last_failure_code, created_at, updated_at
    ) SELECT d.id, ?, g.instance_id, d.generation_id, d.record_id, d.revision_id, g.vector_backend, g.vector_target_id,
      CASE WHEN d.state = 'leased' THEN 'pending' ELSE d.state END, d.attempts, d.available_at,
      NULL, NULL, d.last_failure_code, d.created_at, d.updated_at
    FROM memory_vector_deletions_v4 d JOIN memory_semantic_generations g ON g.id = d.generation_id`, [storeId])
  await executeStatements(em, [
    'DROP TABLE memory_semantic_active_generation_v4',
    'DROP TABLE memory_semantic_indexed_revisions_v4',
    'DROP TABLE memory_vector_projection_work_v4',
    'DROP TABLE memory_vector_deletions_v4',
    'DROP TABLE memory_semantic_generations_v4',
    'DROP INDEX IF EXISTS memory_semantic_generation_active',
    'DROP INDEX IF EXISTS memory_semantic_generation_state',
    'DROP INDEX IF EXISTS memory_semantic_indexed_revision',
    'DROP INDEX IF EXISTS memory_vector_projection_ready',
    'DROP INDEX IF EXISTS memory_vector_deletion_ready',
    ...indexDdl().slice(6, 11),
  ])
  await run(em, 'CREATE TABLE memory_schema_v5(version INTEGER NOT NULL, fingerprint TEXT NOT NULL)')
  await run(em, 'INSERT INTO memory_schema_v5(version, fingerprint) VALUES (4, ?)', [schemaFingerprint('sqlite')])
  await run(em, 'DROP TABLE memory_schema')
  await run(em, 'ALTER TABLE memory_schema_v5 RENAME TO memory_schema')
}

async function legacyVersion(em: SqlEntityManager): Promise<number> {
  const schemaRows = await rows(em, 'SELECT version FROM memory_schema')
  if (schemaRows.length !== 1) throw new TypeError('memory schema metadata must contain exactly one version row')
  return integer(schemaRows[0]?.version, 'schema version')
}

function validateLegacyActorId(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('memory legacy actor ID must be a non-empty string')
  return value.trim()
}

/** Called only inside the provider's database-wide migration transaction and PostgreSQL search_path. */
export async function migrateMemoryDatabase(
  em: SqlEntityManager,
  kind: MemoryDatabaseKind,
  legacyActorId: string,
): Promise<void> {
  const actorId = validateLegacyActorId(legacyActorId)
  const hasSchema = await tableExists(em, kind, 'memory_schema')
  if (!hasSchema) {
    const existing = (await tableNames(em, kind)).filter(name => kind === 'postgresql' || !name.startsWith('sqlite_'))
    if (existing.length > 0) throw new TypeError('unsupported nonempty unversioned memory schema')
    await createVersionFive(em, kind)
    await verifyVersionFive(em, kind)
    return
  }

  let version = await legacyVersion(em)
  const metadataColumns = await tableColumns(em, kind, 'memory_schema')
  const expectedMetadataColumns = version === MEMORY_SCHEMA_VERSION ? ['version', 'fingerprint'] : ['version']
  if (metadataColumns.length !== expectedMetadataColumns.length || metadataColumns.some((column, index) => column !== expectedMetadataColumns[index])) {
    throw new TypeError('unsupported memory schema metadata layout')
  }
  if (version === MEMORY_SCHEMA_VERSION) {
    const metadata = await row(em, 'SELECT fingerprint FROM memory_schema')
    if (metadata?.fingerprint !== schemaFingerprint(kind)) throw new TypeError('unsupported memory schema fingerprint')
    await verifyVersionFive(em, kind)
    return
  }
  if (kind !== 'sqlite' || ![0, 1, 2, 3, 4].includes(version)) {
    throw new TypeError(`unsupported memory schema version: ${String(version)}`)
  }
  if (version === 0) {
    const existing = (await tableNames(em, kind)).filter(name => name.startsWith('memory_') && name !== 'memory_schema')
    if (existing.length > 0) throw new TypeError('unsupported populated memory schema version 0')
    await run(em, 'DROP TABLE memory_schema')
    await createVersionFive(em, kind)
    await verifyVersionFive(em, kind)
    return
  }
  if (version === 1) {
    await migrateVersionOne(em, actorId)
    version = 2
  }
  if (version === 2) {
    await migrateVersionTwo(em)
    version = 3
  }
  if (version === 3) {
    await migrateVersionThree(em)
    version = 4
  }
  if (version === 4) await migrateVersionFour(em)
  await run(em, 'UPDATE memory_schema SET version = ?, fingerprint = ?', [MEMORY_SCHEMA_VERSION, schemaFingerprint(kind)])
  await verifyVersionFive(em, kind)
}
