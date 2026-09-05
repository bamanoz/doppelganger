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

export interface MemoryProjectionLease extends MemoryVectorIdentity {
  readonly id: string
  readonly attempts: number
}

export interface MemoryProjectionGenerationRecord {
  readonly state: string
  readonly embedderIdentityJson: string
  readonly vectorIndexIdentityJson: string
}

export interface MemoryProjectionRebuildSource extends MemoryProjectionSource {
  readonly id: string
  readonly currentRevisionId: string
}

export interface MemoryProjectionStatusCounts {
  readonly indexed: number
  readonly eligible: number
  readonly current: number
  readonly pendingUpserts: number
  readonly pendingDeletes: number
}

interface GenerationRow {
  readonly state: unknown
  readonly embedder_identity_json: unknown
  readonly vector_index_identity_json: unknown
}

/** Synchronous, bounded canonical persistence operations for semantic coordinators. */
export class MemoryProjectionStore {
  private readonly database: InstanceSqliteDatabase

  constructor(database: InstanceSqliteDatabase) {
    this.database = database
  }

  activeGeneration(instanceId: string): string | undefined {
    return activeMemorySemanticGeneration(this.database, requiredText('instance id', instanceId))
  }

  generation(generationId: string, instanceId: string): MemoryProjectionGenerationRecord | undefined {
    const row = this.database.prepare(`
      SELECT state, embedder_identity_json, vector_index_identity_json
      FROM memory_semantic_generations WHERE id = ? AND instance_id = ?
    `).get(requiredText('generation id', generationId), requiredText('instance id', instanceId)) as GenerationRow | undefined
    return row === undefined ? undefined : Object.freeze({
      state: requiredText('generation state', row.state),
      embedderIdentityJson: requiredText('embedder identity', row.embedder_identity_json),
      vectorIndexIdentityJson: requiredText('vector index identity', row.vector_index_identity_json),
    })
  }

  recoverLeases(timestamp: string): void {
    for (const table of ['memory_vector_projection_work', 'memory_vector_deletions'] as const) {
      this.database.prepare(`UPDATE ${table} SET state = 'pending', lease_until = NULL, available_at = ?, updated_at = ? WHERE state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?`)
        .run(timestamp, timestamp, timestamp)
    }
  }

  claim(operation: 'upsert' | 'delete', maximumAttempts: number, leaseUntil: string, timestamp: string): MemoryProjectionLease | undefined {
    const table = operation === 'upsert' ? 'memory_vector_projection_work' : 'memory_vector_deletions'
    return this.database.transaction(storage => {
      const row = storage.prepare(`SELECT id, generation_id, record_id, revision_id, attempts FROM ${table} WHERE state IN ('pending', 'failed') AND attempts < ? AND available_at <= ? ORDER BY created_at, id LIMIT 1`)
        .get(maximumAttempts, timestamp) as (ProjectionIdentityRow & { readonly id: unknown; readonly attempts: unknown }) | undefined
      if (row === undefined) return undefined
      const id = requiredText('projection work id', row.id)
      const changed = storage.prepare(`UPDATE ${table} SET state = 'leased', lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND state IN ('pending', 'failed')`)
        .run(leaseUntil, timestamp, id).changes
      if (changed !== 1) return undefined
      const attempts = Number(row.attempts)
      if (!Number.isSafeInteger(attempts) || attempts < 0) throw new Error('invalid projection attempts')
      return Object.freeze({ id, ...identityFrom(row), attempts })
    })
  }

  retry(operation: 'upsert' | 'delete', lease: MemoryProjectionLease, availableAt: string, failureCode: string, timestamp: string): boolean {
    const table = operation === 'upsert' ? 'memory_vector_projection_work' : 'memory_vector_deletions'
    return this.database.prepare(`UPDATE ${table} SET state = 'failed', available_at = ?, last_failure_code = ?, updated_at = ?, lease_until = NULL WHERE id = ? AND state = 'leased'`)
      .run(availableAt, requiredText('failure code', failureCode), timestamp, lease.id).changes === 1
  }

  source(workId: string, timestamp: string): MemoryProjectionSource | undefined {
    return loadMemoryProjectionSource(this.database, requiredText('projection work id', workId), timestamp)
  }

  acknowledgeUpsert(workId: string, timestamp: string): boolean {
    return completeMemoryProjectionUpsert(this.database, requiredText('projection work id', workId), timestamp)
  }

  acknowledgeDeletion(deletionId: string): boolean {
    return completeMemoryProjectionDeletion(this.database, requiredText('projection deletion id', deletionId))
  }

  discardUpsert(workId: string): boolean {
    return this.database.prepare('DELETE FROM memory_vector_projection_work WHERE id = ?').run(requiredText('projection work id', workId)).changes === 1
  }

  indexed(generationId: string): readonly MemoryVectorIdentity[] {
    const rows = this.database.prepare('SELECT generation_id, record_id, revision_id FROM memory_semantic_indexed_revisions WHERE generation_id = ?')
      .all(requiredText('generation id', generationId)) as readonly unknown[]
    return Object.freeze(rows.map(row => identityFrom(row as ProjectionIdentityRow)))
  }

  prepareGeneration(generationId: string, instanceId: string, embedderIdentityJson: string, vectorIndexIdentityJson: string, timestamp: string): boolean {
    return this.database.transaction(storage => {
      const existing = storage.prepare('SELECT instance_id, embedder_identity_json, vector_index_identity_json FROM memory_semantic_generations WHERE id = ?').get(generationId)
      if (existing !== undefined && (existing.instance_id !== instanceId || existing.embedder_identity_json !== embedderIdentityJson || existing.vector_index_identity_json !== vectorIndexIdentityJson)) {
        throw new Error('semantic generation identity does not match its canonical owner')
      }
      storage.prepare(`INSERT OR IGNORE INTO memory_semantic_generations(id, instance_id, embedder_identity_json, vector_index_identity_json, state, created_at) VALUES (?, ?, ?, ?, 'building', ?)`)
        .run(generationId, instanceId, embedderIdentityJson, vectorIndexIdentityJson, timestamp)
      storage.prepare(`UPDATE memory_semantic_generations SET state = 'building', failure_code = NULL WHERE id = ? AND instance_id = ? AND state != 'active'`)
        .run(generationId, instanceId)
      const state = storage.prepare('SELECT state FROM memory_semantic_generations WHERE id = ? AND instance_id = ?').get(generationId, instanceId) as { state: unknown } | undefined
      if (state?.state !== 'building') return false
      storage.prepare('DELETE FROM memory_semantic_indexed_revisions WHERE generation_id = ?').run(generationId)
      return true
    })
  }

  rebuildPage(generationId: string, instanceId: string, lastId: string | undefined, limit: number): readonly MemoryProjectionRebuildSource[] {
    const generation = this.generation(generationId, instanceId)
    if (generation?.state !== 'building') throw new Error('semantic generation is not building')
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('rebuild page limit must be a positive safe integer')
    const rows = this.database.prepare(`
      SELECT r.id, r.current_revision_id, r.instance_id, r.actor_id, r.scope_kind,
        r.project_id, r.kind, r.subject_key, r.status, v.content, ? AS generation_id,
        r.id AS record_id, r.current_revision_id AS revision_id,
        r.valid_from, r.valid_until, r.expires_at, 'building' AS generation_state
      FROM memory_records r JOIN memory_revisions v ON v.id = r.current_revision_id
      WHERE r.instance_id = ? AND r.status = 'active' AND (? IS NULL OR r.id > ?)
      ORDER BY r.id LIMIT ?
    `).all(generationId, instanceId, lastId ?? null, lastId ?? null, limit) as readonly unknown[]
    return Object.freeze(rows.map(value => {
      const row = value as ProjectionSourceRow & { readonly id: unknown }
      const source = projectionSource(row)
      return Object.freeze({ ...source, id: requiredText('record id', row.id), currentRevisionId: source.revisionId })
    }))
  }

  markRebuildPage(generationId: string, page: readonly MemoryProjectionRebuildSource[], timestamp: string): void {
    this.database.transaction(storage => {
      const generation = storage.prepare('SELECT instance_id, state FROM memory_semantic_generations WHERE id = ?').get(generationId)
      if (generation?.state !== 'building') throw new Error('semantic generation is not building')
      const statement = storage.prepare(`INSERT INTO memory_semantic_indexed_revisions(generation_id, record_id, revision_id, indexed_at) VALUES (?, ?, ?, ?) ON CONFLICT(generation_id, record_id) DO UPDATE SET revision_id = excluded.revision_id, indexed_at = excluded.indexed_at`)
      for (const source of page) {
        const current = storage.prepare('SELECT instance_id, actor_id, current_revision_id, status FROM memory_records WHERE id = ?').get(source.id)
        if (source.generationId !== generationId || source.instanceId !== generation.instance_id || source.recordId !== source.id || source.revisionId !== source.currentRevisionId || current?.instance_id !== source.instanceId || current.actor_id !== source.actorId || current.current_revision_id !== source.currentRevisionId || current.status !== 'active') {
          throw new Error('canonical rebuild source changed before acknowledgment')
        }
        statement.run(generationId, source.id, source.currentRevisionId, timestamp)
      }
    })
  }

  verifyGeneration(generationId: string, instanceId: string): boolean {
    const expected = this.database.prepare(`SELECT COUNT(*) AS count FROM memory_records WHERE instance_id = ? AND status = 'active'`).get(instanceId) as { count: number }
    const verified = this.database.prepare(`SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions i JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id WHERE i.generation_id = ? AND r.instance_id = ? AND r.status = 'active'`).get(generationId, instanceId) as { count: number }
    const stale = this.database.prepare(`SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions i LEFT JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id AND r.instance_id = ? AND r.status = 'active' WHERE i.generation_id = ? AND r.id IS NULL`).get(instanceId, generationId) as { count: number }
    return Number(expected.count) === Number(verified.count) && Number(stale.count) === 0
  }

  activateGeneration(generationId: string, instanceId: string, timestamp: string): boolean {
    return this.database.transaction(storage => {
      const generation = storage.prepare(`SELECT state FROM memory_semantic_generations WHERE id = ? AND instance_id = ?`).get(generationId, instanceId) as { state: unknown } | undefined
      if (generation?.state !== 'building' || !this.verifyGeneration(generationId, instanceId)) return false
      const previous = activeMemorySemanticGeneration(storage, instanceId)
      if (previous !== undefined && previous !== generationId) storage.prepare(`UPDATE memory_semantic_generations SET state = 'retained' WHERE id = ? AND instance_id = ? AND state = 'active'`).run(previous, instanceId)
      if (storage.prepare(`UPDATE memory_semantic_generations SET state = 'active', activated_at = ?, completed_at = ?, failure_code = NULL WHERE id = ? AND instance_id = ? AND state = 'building'`).run(timestamp, timestamp, generationId, instanceId).changes !== 1) return false
      storage.prepare(`INSERT INTO memory_semantic_active_generation(instance_id, generation_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET generation_id = excluded.generation_id, updated_at = excluded.updated_at`).run(instanceId, generationId, timestamp)
      return true
    })
  }

  failGeneration(generationId: string, failureCode: string): boolean {
    return this.database.prepare(`UPDATE memory_semantic_generations SET state = 'failed', failure_code = ? WHERE id = ? AND state = 'building'`).run(failureCode, generationId).changes === 1
  }

  rollbackGeneration(generationId: string, instanceId: string, timestamp: string): boolean {
    return this.database.transaction(storage => {
      const generation = storage.prepare(`SELECT state FROM memory_semantic_generations WHERE id = ? AND instance_id = ?`).get(generationId, instanceId) as { state: unknown } | undefined
      if (generation?.state !== 'retained' || !this.verifyGeneration(generationId, instanceId)) return false
      const active = activeMemorySemanticGeneration(storage, instanceId)
      if (active !== undefined && active !== generationId) storage.prepare(`UPDATE memory_semantic_generations SET state = 'retained' WHERE id = ? AND instance_id = ? AND state = 'active'`).run(active, instanceId)
      if (storage.prepare(`UPDATE memory_semantic_generations SET state = 'active', activated_at = ?, failure_code = NULL WHERE id = ? AND instance_id = ? AND state = 'retained'`).run(timestamp, generationId, instanceId).changes !== 1) return false
      storage.prepare(`INSERT INTO memory_semantic_active_generation(instance_id, generation_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET generation_id = excluded.generation_id, updated_at = excluded.updated_at`).run(instanceId, generationId, timestamp)
      storage.prepare(`DELETE FROM memory_vector_projection_work WHERE generation_id = ?`).run(generationId)
      return true
    })
  }

  retainedGenerations(instanceId: string, activeGenerationId: string | undefined): readonly string[] {
    const rows = this.database.prepare(`SELECT id FROM memory_semantic_generations WHERE instance_id = ? AND state = 'retained' AND id != ? ORDER BY created_at, id`).all(instanceId, activeGenerationId ?? '')
    return Object.freeze(rows.map(row => requiredText('generation id', row.id)))
  }

  removeRetainedGeneration(generationId: string): boolean {
    return this.database.transaction(storage => {
      const generation = storage.prepare('SELECT state FROM memory_semantic_generations WHERE id = ?').get(generationId)
      if (generation?.state !== 'retained') return false
      if (storage.prepare('SELECT 1 FROM memory_semantic_active_generation WHERE generation_id = ?').get(generationId) !== undefined) return false
      storage.prepare('DELETE FROM memory_vector_projection_work WHERE generation_id = ?').run(generationId)
      storage.prepare('DELETE FROM memory_vector_deletions WHERE generation_id = ?').run(generationId)
      return storage.prepare(`DELETE FROM memory_semantic_generations WHERE id = ? AND state = 'retained'`).run(generationId).changes === 1
    })
  }

  statusCounts(generationId: string, instanceId: string, timestamp: string): MemoryProjectionStatusCounts {
    const indexed = Number((this.database.prepare('SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions WHERE generation_id = ?').get(generationId) as { count: number }).count)
    const eligible = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_records WHERE instance_id = ? AND status = 'active' AND (valid_from IS NULL OR valid_from <= ?) AND (valid_until IS NULL OR valid_until > ?) AND (expires_at IS NULL OR expires_at > ?)`).get(instanceId, timestamp, timestamp, timestamp) as { count: number }).count)
    const current = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions i JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id WHERE i.generation_id = ? AND r.instance_id = ? AND r.status = 'active'`).get(generationId, instanceId) as { count: number }).count)
    const pendingUpserts = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_vector_projection_work WHERE generation_id = ? AND state IN ('pending', 'leased', 'failed')`).get(generationId) as { count: number }).count)
    const pendingDeletes = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_vector_deletions WHERE generation_id = ? AND state IN ('pending', 'leased', 'failed')`).get(generationId) as { count: number }).count)
    return Object.freeze({ indexed, eligible, current, pendingUpserts, pendingDeletes })
  }

  eligibleHit(identity: MemoryVectorIdentity, instanceId: string, actorId: string, projectId: string | undefined, timestamp: string): boolean {
    if (identity.generationId !== activeMemorySemanticGeneration(this.database, instanceId)) return false
    const row = this.database.prepare(`SELECT instance_id, actor_id, scope_kind, project_id, status, valid_from, valid_until, expires_at FROM memory_records WHERE id = ? AND current_revision_id = ?`).get(identity.recordId, identity.revisionId) as { instance_id: string; actor_id: string; scope_kind: string; project_id: string | null; status: string; valid_from: string | null; valid_until: string | null; expires_at: string | null } | undefined
    if (row === undefined || row.instance_id !== instanceId || row.actor_id !== actorId || row.status !== 'active') return false
    if (row.scope_kind === 'project' && (projectId === undefined || row.project_id !== projectId)) return false
    if (row.scope_kind === 'relationship' && row.project_id !== null) return false
    return (row.valid_from === null || row.valid_from <= timestamp) && (row.valid_until === null || row.valid_until > timestamp) && (row.expires_at === null || row.expires_at > timestamp)
  }
}
