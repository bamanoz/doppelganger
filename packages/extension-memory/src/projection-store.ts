import type { InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { memoryProjectionWorkId, type MemoryVectorIdentity } from './semantic.ts'

interface ProjectionIdentityRow {
  readonly generation_id: unknown
  readonly record_id: unknown
  readonly revision_id: unknown
}

function requiredText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`)
  return value
}

interface ProjectionSourceRow extends ProjectionIdentityRow {
  readonly instance_id: unknown
  readonly actor_id: unknown
  readonly scope_kind: unknown
  readonly project_id: unknown
  readonly kind: unknown
  readonly subject_key: unknown
  readonly status: unknown
  readonly content: unknown
  readonly current_revision_id: unknown
  readonly valid_from: unknown
  readonly valid_until: unknown
  readonly expires_at: unknown
  readonly generation_state: unknown
}

export interface MemoryProjectionSource extends MemoryVectorIdentity {
  readonly instanceId: string
  readonly actorId: string
  readonly scopeKind: 'relationship' | 'project'
  readonly projectId?: string
  readonly kind: 'decision' | 'fact' | 'preference' | 'procedure'
  readonly subjectKey: string
  readonly status: 'active'
  readonly content: string
}

function identityFrom(row: ProjectionIdentityRow): MemoryVectorIdentity {
  return Object.freeze({
    generationId: requiredText('projection generation_id', row.generation_id),
    recordId: requiredText('projection record_id', row.record_id),
    revisionId: requiredText('projection revision_id', row.revision_id),
  })
}

export function activeMemorySemanticGeneration(
  database: InstanceSqliteDatabase,
  instanceId: string,
): string | undefined {
  const row = database.prepare(`
    SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?
  `).get(instanceId)
  return row === undefined ? undefined : requiredText('active semantic generation_id', row.generation_id)
}

export function enqueueMemoryProjectionUpsert(
  database: InstanceSqliteDatabase,
  identity: MemoryVectorIdentity,
  timestamp: string,
): boolean {
  const id = memoryProjectionWorkId('upsert', identity)
  return database.prepare(`
    INSERT OR IGNORE INTO memory_vector_projection_work(
      id, generation_id, record_id, revision_id, operation, state,
      attempts, available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'upsert', 'pending', 0, ?, ?, ?)
  `).run(
    id,
    identity.generationId,
    identity.recordId,
    identity.revisionId,
    timestamp,
    timestamp,
    timestamp,
  ).changes === 1
}

export function enqueueActiveMemoryProjection(
  database: InstanceSqliteDatabase,
  instanceId: string,
  recordId: string,
  revisionId: string,
  timestamp: string,
): boolean {
  const generationId = activeMemorySemanticGeneration(database, instanceId)
  if (generationId === undefined) return false
  return enqueueMemoryProjectionUpsert(database, { generationId, recordId, revisionId }, timestamp)
}

export function enqueueMemoryProjectionDeletion(
  database: InstanceSqliteDatabase,
  identity: MemoryVectorIdentity,
  timestamp: string,
): boolean {
  const id = memoryProjectionWorkId('delete', identity)
  return database.prepare(`
    INSERT OR IGNORE INTO memory_vector_deletions(
      id, generation_id, record_id, revision_id, state,
      attempts, available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(
    id,
    identity.generationId,
    identity.recordId,
    identity.revisionId,
    timestamp,
    timestamp,
    timestamp,
  ).changes === 1
}

export function enqueueMemoryRevisionReplacement(
  database: InstanceSqliteDatabase,
  instanceId: string,
  recordId: string,
  previousRevisionId: string,
  nextRevisionId: string,
  timestamp: string,
): void {
  const generationId = activeMemorySemanticGeneration(database, instanceId)
  if (generationId === undefined) return
  enqueueMemoryProjectionDeletion(database, { generationId, recordId, revisionId: previousRevisionId }, timestamp)
  enqueueMemoryProjectionUpsert(database, { generationId, recordId, revisionId: nextRevisionId }, timestamp)
}

export function enqueueKnownMemoryProjectionDeletions(
  database: InstanceSqliteDatabase,
  recordId: string,
  timestamp: string,
): number {
  const rows = database.prepare(`
    SELECT g.id AS generation_id, r.id AS record_id, v.id AS revision_id
    FROM memory_records r
    JOIN memory_revisions v ON v.record_id = r.id
    JOIN memory_semantic_generations g ON g.instance_id = r.instance_id
    WHERE r.id = ?
    UNION
    SELECT generation_id, record_id, revision_id
    FROM memory_semantic_indexed_revisions
    WHERE record_id = ?
    UNION
    SELECT generation_id, record_id, revision_id
    FROM memory_vector_projection_work
    WHERE record_id = ?
  `).all(recordId, recordId, recordId) as readonly unknown[]
  let inserted = 0
  for (const row of rows) {
    if (enqueueMemoryProjectionDeletion(database, identityFrom(row as ProjectionIdentityRow), timestamp)) inserted += 1
  }
  database.prepare('DELETE FROM memory_vector_projection_work WHERE record_id = ?').run(recordId)
  database.prepare('DELETE FROM memory_semantic_indexed_revisions WHERE record_id = ?').run(recordId)
  database.prepare('DELETE FROM memory_embedding_cache WHERE record_id = ?').run(recordId)
  return inserted
}

function optionalText(field: string, value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : requiredText(field, value)
}

function projectionSource(row: ProjectionSourceRow): MemoryProjectionSource {
  const scopeKind = requiredText('projection scope_kind', row.scope_kind)
  if (scopeKind !== 'relationship' && scopeKind !== 'project') throw new Error('invalid projection scope_kind')
  const kind = requiredText('projection kind', row.kind)
  if (!['decision', 'fact', 'preference', 'procedure'].includes(kind)) throw new Error('invalid projection kind')
  const status = requiredText('projection status', row.status)
  if (status !== 'active') throw new Error('invalid projection status')
  const projectId = optionalText('projection project_id', row.project_id)
  return Object.freeze({
    ...identityFrom(row),
    instanceId: requiredText('projection instance_id', row.instance_id),
    actorId: requiredText('projection actor_id', row.actor_id),
    scopeKind,
    ...(projectId === undefined ? {} : { projectId }),
    kind: kind as MemoryProjectionSource['kind'],
    subjectKey: requiredText('projection subject_key', row.subject_key),
    status,
    content: requiredText('projection content', row.content),
  })
}

function temporalEligible(row: ProjectionSourceRow, timestamp: string): boolean {
  const validFrom = optionalText('projection valid_from', row.valid_from)
  const validUntil = optionalText('projection valid_until', row.valid_until)
  const expiresAt = optionalText('projection expires_at', row.expires_at)
  return (validFrom === undefined || validFrom <= timestamp)
    && (validUntil === undefined || validUntil > timestamp)
    && (expiresAt === undefined || expiresAt > timestamp)
}

function convergeMemoryProjectionSource(
  storage: InstanceSqliteDatabase,
  workId: string,
  timestamp: string,
): MemoryProjectionSource | undefined {
  const row = storage.prepare(`
    SELECT
      w.generation_id, w.record_id, w.revision_id,
      r.instance_id, r.actor_id, r.scope_kind, r.project_id,
      r.kind, r.subject_key, r.status, r.current_revision_id,
      r.valid_from, r.valid_until, r.expires_at,
      v.content, g.state AS generation_state
    FROM memory_vector_projection_work w
    JOIN memory_semantic_generations g ON g.id = w.generation_id
    JOIN memory_records r ON r.id = w.record_id
    JOIN memory_revisions v ON v.id = w.revision_id AND v.record_id = r.id
    WHERE w.id = ?
  `).get(workId) as ProjectionSourceRow | undefined
  if (row === undefined) return undefined
  const identity = identityFrom(row)
  const generationState = requiredText('projection generation_state', row.generation_state)
  const currentRevisionId = requiredText('projection current_revision_id', row.current_revision_id)
  const current = row.status === 'active'
    && currentRevisionId === identity.revisionId
    && temporalEligible(row, timestamp)
    && (generationState === 'active' || generationState === 'building')
  if (current) return projectionSource(row)

  enqueueMemoryProjectionDeletion(storage, identity, timestamp)
  storage.prepare('DELETE FROM memory_vector_projection_work WHERE id = ?').run(workId)
  if (
    row.status === 'active'
    && currentRevisionId !== identity.revisionId
    && (generationState === 'active' || generationState === 'building')
  ) {
    enqueueMemoryProjectionUpsert(storage, {
      generationId: identity.generationId,
      recordId: identity.recordId,
      revisionId: currentRevisionId,
    }, timestamp)
  }
  return undefined
}

export function loadMemoryProjectionSource(
  database: InstanceSqliteDatabase,
  workId: string,
  timestamp: string,
): MemoryProjectionSource | undefined {
  return database.transaction(storage => convergeMemoryProjectionSource(storage, workId, timestamp))
}

export function completeMemoryProjectionUpsert(
  database: InstanceSqliteDatabase,
  workId: string,
  timestamp: string,
): boolean {
  return database.transaction(storage => {
    const source = convergeMemoryProjectionSource(storage, workId, timestamp)
    if (source === undefined) return false
    storage.prepare(`
      INSERT INTO memory_semantic_indexed_revisions(generation_id, record_id, revision_id, indexed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(generation_id, record_id) DO UPDATE SET
        revision_id = excluded.revision_id,
        indexed_at = excluded.indexed_at
    `).run(source.generationId, source.recordId, source.revisionId, timestamp)
    storage.prepare('DELETE FROM memory_vector_projection_work WHERE id = ?').run(workId)
    return true
  })
}

export function completeMemoryProjectionDeletion(
  database: InstanceSqliteDatabase,
  deletionId: string,
): boolean {
  return database.transaction(storage => {
    const row = storage.prepare(`
      SELECT generation_id, record_id, revision_id FROM memory_vector_deletions WHERE id = ?
    `).get(deletionId) as ProjectionIdentityRow | undefined
    if (row === undefined) return false
    const identity = identityFrom(row)
    storage.prepare(`
      DELETE FROM memory_semantic_indexed_revisions
      WHERE generation_id = ? AND record_id = ? AND revision_id = ?
    `).run(identity.generationId, identity.recordId, identity.revisionId)
    storage.prepare('DELETE FROM memory_vector_deletions WHERE id = ?').run(deletionId)
    return true
  })
}
