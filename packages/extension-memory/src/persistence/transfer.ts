import { createHash } from 'node:crypto'
import type { SqlEntityManager } from '@mikro-orm/sql'
import { memoryEmbedderFingerprint, validateMemoryEmbedderIdentity, validateMemoryVectorIndexIdentity } from '../semantic.ts'
import type { MemoryDatabaseConfig } from './config.ts'
import { openMemoryDatabase, type MemoryDatabase } from './database.ts'
import { MEMORY_SCHEMA_VERSION, MEMORY_TRANSFER_TABLES, type MemoryDatabaseKind } from './migrations.ts'

type Row = Record<string, unknown>
type TableRows = Readonly<Record<string, readonly Row[]>>

const TABLE_COLUMNS = Object.freeze({
  memory_store: ['id', 'created_at'],
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
} satisfies Record<(typeof MEMORY_TRANSFER_TABLES)[number], readonly string[]>)

const TABLE_ORDER = Object.freeze([
  'memory_store',
  'memory_records',
  'memory_revisions',
  'memory_evidence',
  'memory_candidate_evidence',
  'memory_conflicts',
  'memory_operations',
  'memory_semantic_generations',
  'memory_semantic_active_generation',
  'memory_semantic_indexed_revisions',
  'memory_vector_projection_work',
  'memory_vector_deletions',
  'memory_embedding_cache',
] as const)

const TABLE_ORDER_BY: Readonly<Record<(typeof TABLE_ORDER)[number], string>> = Object.freeze({
  memory_store: 'id',
  memory_records: 'id',
  memory_revisions: 'record_id, ordinal, id',
  memory_evidence: 'id',
  memory_candidate_evidence: 'candidate_id, evidence_id',
  memory_conflicts: 'id',
  memory_operations: 'instance_id, actor_id, operation_id',
  memory_semantic_generations: 'id',
  memory_semantic_active_generation: 'store_id, instance_id',
  memory_semantic_indexed_revisions: 'generation_id, record_id',
  memory_vector_projection_work: 'id',
  memory_vector_deletions: 'id',
  memory_embedding_cache: 'embedder_fingerprint, record_id, revision_id',
})

export interface MemoryTransferRequest {
  readonly source: MemoryDatabaseConfig
  readonly destination: MemoryDatabaseConfig
  readonly legacyActorId: string
  /** Operator assertion: every source writer and semantic coordinator is stopped. */
  readonly sourceStopped: true
}

export interface MemoryTransferTableManifest {
  readonly rows: number
  readonly sha256: string
}

export interface MemoryTransferManifest {
  readonly schemaVersion: number
  readonly storeId: string
  readonly tables: Readonly<Record<string, MemoryTransferTableManifest>>
  readonly deletedReceipts: MemoryTransferTableManifest
  readonly cleanupObligations: MemoryTransferTableManifest
  readonly sha256: string
}

export interface MemoryTransferReport {
  readonly sourceKind: MemoryDatabaseKind
  readonly destinationKind: MemoryDatabaseKind
  readonly source: MemoryTransferManifest
  readonly installed: MemoryTransferManifest
  readonly resetProjectionLeases: number
  readonly resetGenerationTransitions: number
  readonly invalidatedLocalGenerations: number
}

interface TransferSnapshot {
  readonly tables: TableRows
  readonly manifest: MemoryTransferManifest
}

interface NormalizedTransfer {
  readonly tables: TableRows
  readonly resetProjectionLeases: number
  readonly resetGenerationTransitions: number
  readonly invalidatedLocalGenerations: number
}

async function queryRows(em: SqlEntityManager, sql: string, params: readonly unknown[] = []): Promise<Row[]> {
  return await em.execute(sql, [...params], 'all') as Row[]
}

async function queryRow(em: SqlEntityManager, sql: string, params: readonly unknown[] = []): Promise<Row | undefined> {
  return await em.execute(sql, [...params], 'get') as Row | undefined
}

async function execute(em: SqlEntityManager, sql: string, params: readonly unknown[] = []): Promise<void> {
  await em.execute(sql, [...params], 'run')
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid transfer ${field}`)
  return value
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stableValue)
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { base64: Buffer.from(value).toString('base64') }
  return Object.fromEntries(Object.entries(value as Row).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
}

function digestRows(values: readonly Row[]): MemoryTransferTableManifest {
  const serialized = JSON.stringify(values.map(stableValue))
  return Object.freeze({ rows: values.length, sha256: createHash('sha256').update(serialized).digest('hex') })
}

function manifest(tables: TableRows): MemoryTransferManifest {
  const storeRows = tables.memory_store ?? []
  if (storeRows.length !== 1) throw new Error('memory transfer source must contain exactly one canonical store identity')
  const storeId = requiredText(storeRows[0]?.id, 'store ID')
  const tableManifests: Record<string, MemoryTransferTableManifest> = {}
  for (const table of TABLE_ORDER) tableManifests[table] = digestRows(tables[table] ?? [])
  const operations = tables.memory_operations ?? []
  const deletedReceipts = digestRows(operations.filter(value => value.result_kind === 'deleted'))
  const cleanupObligations = digestRows(tables.memory_vector_deletions ?? [])
  const sha256 = createHash('sha256').update(JSON.stringify({ schemaVersion: MEMORY_SCHEMA_VERSION, storeId, tables: tableManifests, deletedReceipts, cleanupObligations })).digest('hex')
  return Object.freeze({ schemaVersion: MEMORY_SCHEMA_VERSION, storeId, tables: Object.freeze(tableManifests), deletedReceipts, cleanupObligations, sha256 })
}

async function snapshot(em: SqlEntityManager): Promise<TransferSnapshot> {
  const tables: Record<string, readonly Row[]> = {}
  for (const table of TABLE_ORDER) {
    const columns = TABLE_COLUMNS[table]
    const loaded = await queryRows(em, `SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${TABLE_ORDER_BY[table]}`)
    tables[table] = table === 'memory_records'
      ? loaded.map(value => ({ ...value, pinned: value.pinned === true || Number(value.pinned) === 1 }))
      : loaded
  }
  const frozen = Object.freeze(tables)
  return Object.freeze({ tables: frozen, manifest: manifest(frozen) })
}


function normalizeForTransfer(input: TableRows): NormalizedTransfer {
  const tables = Object.fromEntries(TABLE_ORDER.map(table => [table, (input[table] ?? []).map(value => ({ ...value }))]))
  let resetProjectionLeases = 0
  let resetGenerationTransitions = 0
  let invalidatedLocalGenerations = 0

  const storeId = requiredText(tables.memory_store?.[0]?.id, 'store ID')
  const supportedBackends = ['sqlite_exact', 'chroma', 'qdrant', 'pgvector']
  const generations = tables.memory_semantic_generations ?? []
  const generationById = new Map<string, Row>()
  for (const generation of generations) {
    const generationId = requiredText(generation.id, 'generation ID')
    const backend = requiredText(generation.vector_backend, 'generation vector backend')
    const targetId = requiredText(generation.vector_target_id, 'generation vector target ID')
    let identitiesMatch = false
    try {
      const embedder = validateMemoryEmbedderIdentity(JSON.parse(requiredText(generation.embedder_identity_json, 'embedder identity JSON')))
      const vector = validateMemoryVectorIndexIdentity(JSON.parse(requiredText(generation.vector_index_identity_json, 'vector identity JSON')))
      identitiesMatch = generation.embedder_fingerprint === memoryEmbedderFingerprint(embedder)
        && backend === vector.backend && targetId === vector.configFingerprint
    } catch {
      identitiesMatch = false
    }
    if (generation.store_id !== storeId || !supportedBackends.includes(backend) || !/^[a-f0-9]{64}$/u.test(targetId) || !identitiesMatch) {
      throw new Error(`memory transfer blocked by incompatible generation route: ${generationId}`)
    }
    generationById.set(generationId, generation)
  }
  for (const table of ['memory_vector_projection_work', 'memory_vector_deletions'] as const) {
    for (const work of tables[table] ?? []) {
      const workId = requiredText(work.id, 'projection work ID')
      const backend = requiredText(work.vector_backend, 'projection vector backend')
      const targetId = requiredText(work.vector_target_id, 'projection vector target ID')
      if (work.store_id !== storeId || !supportedBackends.includes(backend) || !/^[a-f0-9]{64}$/u.test(targetId)) {
        throw new Error(`memory transfer blocked by incompatible projection route: ${workId}`)
      }
      const generation = generationById.get(String(work.generation_id))
      if (generation !== undefined && (generation.instance_id !== work.instance_id || generation.vector_backend !== backend || generation.vector_target_id !== targetId)) {
        throw new Error(`memory transfer blocked by mismatched projection route: ${workId}`)
      }
    }
  }
  const activeGenerationIds = new Set((tables.memory_semantic_active_generation ?? []).map(value => String(value.generation_id)))
  const incompatibleActive = generations.filter(value => value.vector_backend === 'sqlite_exact'
    && (activeGenerationIds.has(String(value.id)) || ['active', 'building', 'deleting'].includes(String(value.state))))
  if (incompatibleActive.length > 0) {
    throw new Error(`memory transfer blocked by inaccessible active local vector destination: ${requiredText(incompatibleActive[0]?.id, 'generation ID')}`)
  }
  const localCleanup = (tables.memory_vector_deletions ?? []).find(value => value.vector_backend === 'sqlite_exact')
  if (localCleanup !== undefined) {
    throw new Error(`memory transfer blocked by inaccessible local vector cleanup obligation: ${requiredText(localCleanup.id, 'deletion ID')}`)
  }

  const invalidated = new Set<string>()
  for (const generation of generations) {
    if (generation.transition_token !== null || generation.transition_until !== null) {
      generation.transition_token = null
      generation.transition_until = null
      generation.generation_revision = Number(generation.generation_revision) + 1
      resetGenerationTransitions += 1
    }
    if (generation.vector_backend === 'sqlite_exact') {
      const generationId = requiredText(generation.id, 'generation ID')
      if (generation.state === 'retained') {
        generation.state = 'failed'
        generation.failure_code = 'transfer-local-target-unavailable'
        generation.generation_revision = Number(generation.generation_revision) + 1
      }
      invalidated.add(generationId)
      invalidatedLocalGenerations += 1
    }
  }
  tables.memory_semantic_indexed_revisions = (tables.memory_semantic_indexed_revisions ?? []).filter(value => !invalidated.has(String(value.generation_id)))
  tables.memory_vector_projection_work = (tables.memory_vector_projection_work ?? []).filter(value => !invalidated.has(String(value.generation_id)))

  for (const table of ['memory_vector_projection_work', 'memory_vector_deletions'] as const) {
    for (const work of tables[table] ?? []) {
      if (work.state !== 'leased') continue
      work.state = 'pending'
      work.lease_until = null
      work.lease_token = null
      resetProjectionLeases += 1
    }
  }
  const frozen = Object.fromEntries(TABLE_ORDER.map(table => [table, Object.freeze(tables[table] ?? [])]))
  return Object.freeze({ tables: Object.freeze(frozen), resetProjectionLeases, resetGenerationTransitions, invalidatedLocalGenerations })
}

async function assertEmptyDestination(em: SqlEntityManager, kind: MemoryDatabaseKind): Promise<void> {
  for (const table of TABLE_ORDER) {
    if (table === 'memory_store') continue
    const result = await queryRow(em, `SELECT COUNT(*) AS count FROM ${table}`)
    if (Number(result?.count) !== 0) throw new Error(`memory transfer destination is not empty: ${table}`)
  }
  const derivedTable = kind === 'sqlite' ? 'memory_fts' : 'memory_lexical_index'
  const result = await queryRow(em, `SELECT COUNT(*) AS count FROM ${derivedTable}`)
  if (Number(result?.count) !== 0) throw new Error(`memory transfer destination is not empty: ${derivedTable}`)
}

function destinationValue(table: string, column: string, value: unknown, kind: MemoryDatabaseKind): unknown {
  if (table === 'memory_embedding_cache' && column === 'vector') {
    if (!(value instanceof Uint8Array)) throw new Error('memory transfer embedding cache vector is not binary')
    return Buffer.from(value)
  }
  if (table !== 'memory_records' || column !== 'pinned') return value
  return kind === 'sqlite' ? (value === true || Number(value) === 1 ? 1 : 0) : value === true || Number(value) === 1
}

async function insertRows(em: SqlEntityManager, kind: MemoryDatabaseKind, table: (typeof TABLE_ORDER)[number], values: readonly Row[]): Promise<void> {
  const columns = TABLE_COLUMNS[table]
  const placeholders = columns.map(() => '?').join(', ')
  for (const value of values) {
    await execute(em, `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`, columns.map(column => destinationValue(table, column, value[column], kind)))
  }
}

async function rebuildLexicalIndex(em: SqlEntityManager, kind: MemoryDatabaseKind): Promise<void> {
  const lexicalTable = kind === 'sqlite' ? 'memory_fts' : 'memory_lexical_index'
  await execute(em, `DELETE FROM ${lexicalTable}`)
  await execute(em, `INSERT INTO ${lexicalTable}(record_id, revision_id, content)
    SELECT r.id, r.current_revision_id, v.content FROM memory_records r
    JOIN memory_revisions v ON v.id = r.current_revision_id AND v.record_id = r.id
    WHERE r.status = 'active'`)
  const expected = Number((await queryRow(em, "SELECT COUNT(*) AS count FROM memory_records WHERE status = 'active'"))?.count)
  const indexed = Number((await queryRow(em, `SELECT COUNT(*) AS count FROM ${lexicalTable}`))?.count)
  if (expected !== indexed) throw new Error('memory transfer lexical rebuild verification failed')
}

async function install(
  em: SqlEntityManager,
  kind: MemoryDatabaseKind,
  transferred: TableRows,
  expected: MemoryTransferManifest,
): Promise<MemoryTransferManifest> {
  await assertEmptyDestination(em, kind)
  await execute(em, 'DELETE FROM memory_store')
  for (const table of TABLE_ORDER) await insertRows(em, kind, table, transferred[table] ?? [])
  await rebuildLexicalIndex(em, kind)
  const installed = (await snapshot(em)).manifest
  if (!sameManifest(expected, installed)) throw new Error('memory transfer destination verification failed')
  return installed
}

function sameManifest(left: MemoryTransferManifest, right: MemoryTransferManifest): boolean {
  return left.sha256 === right.sha256
    && left.deletedReceipts.sha256 === right.deletedReceipts.sha256
    && left.cleanupObligations.sha256 === right.cleanupObligations.sha256
}

/**
 * Installs one quiescent canonical store into an empty opposite-dialect destination.
 * Opening either provider performs versioned schema adoption first; source data is never changed or deleted.
 */
export async function transferMemoryDatabase(request: MemoryTransferRequest): Promise<MemoryTransferReport> {
  if (request.sourceStopped !== true) throw new TypeError('memory transfer requires an explicit stopped-source assertion')
  if (request.source.kind === request.destination.kind) throw new TypeError('memory transfer requires opposite SQLite and PostgreSQL backends')
  let source: MemoryDatabase | undefined
  let destination: MemoryDatabase | undefined
  try {
    source = await openMemoryDatabase(request.source, request.legacyActorId)
    destination = await openMemoryDatabase(request.destination, request.legacyActorId)
    await destination.read(em => assertEmptyDestination(em, destination!.kind))
    const sourceSnapshot = await source.read(snapshot)
    const normalized = normalizeForTransfer(sourceSnapshot.tables)
    const expected = manifest(normalized.tables)
    const installed = await destination.write({ instanceId: 'memory.transfer' }, em => install(em, destination!.kind, normalized.tables, expected))
    if (!sameManifest(expected, installed)) throw new Error('memory transfer destination verification failed')
    return Object.freeze({
      sourceKind: source.kind,
      destinationKind: destination.kind,
      source: sourceSnapshot.manifest,
      installed,
      resetProjectionLeases: normalized.resetProjectionLeases,
      resetGenerationTransitions: normalized.resetGenerationTransitions,
      invalidatedLocalGenerations: normalized.invalidatedLocalGenerations,
    })
  } finally {
    await Promise.allSettled([destination?.close(), source?.close()].filter((value): value is Promise<void> => value !== undefined))
  }
}
