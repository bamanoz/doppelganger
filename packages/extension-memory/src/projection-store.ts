import { randomUUID } from 'node:crypto'
import type { QueryResult } from '@mikro-orm/core'
import type { SqlEntityManager } from '@mikro-orm/sql'
import {
  memoryEmbedderFingerprint,
  memoryProjectionWorkId,
  type MemoryEmbedderIdentity,
  type MemoryVectorBackendKind,
  type MemoryVectorIdentity,
  type MemoryVectorIndexIdentity,
} from './semantic.ts'
import type { MemoryDatabase } from './persistence/database.ts'

interface ProjectionIdentityRow {
  readonly generation_id: unknown
  readonly record_id: unknown
  readonly revision_id: unknown
}

interface ProjectionRouteRow {
  readonly store_id: unknown
  readonly instance_id: unknown
  readonly vector_backend: unknown
  readonly vector_target_id: unknown
}

interface ProjectionWorkRow extends ProjectionIdentityRow, ProjectionRouteRow {
  readonly id: unknown
  readonly attempts: unknown
  readonly lease_token: unknown
  readonly lease_until: unknown
}

interface ProjectionSourceRow extends ProjectionWorkRow {
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

interface GenerationRow extends ProjectionRouteRow {
  readonly id: unknown
  readonly state: unknown
  readonly embedder_identity_json: unknown
  readonly vector_index_identity_json: unknown
  readonly embedder_fingerprint: unknown
  readonly generation_revision: unknown
  readonly transition_token: unknown
  readonly transition_until: unknown
}

interface ActiveGenerationRow {
  readonly generation_id: unknown
  readonly generation_revision: unknown
}

const GENERATION_STATES = ['building', 'active', 'retained', 'failed', 'deleting'] as const

type MemoryProjectionGenerationState = (typeof GENERATION_STATES)[number]

function requiredText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`)
  return value
}

function optionalText(field: string, value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : requiredText(field, value)
}

function requiredInteger(field: string, value: unknown, minimum = 0): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`invalid ${field}`)
  return number
}

function requiredGenerationState(value: unknown): MemoryProjectionGenerationState {
  const state = requiredText('semantic generation state', value)
  if (!(GENERATION_STATES as readonly string[]).includes(state)) throw new Error('invalid semantic generation state')
  return state as MemoryProjectionGenerationState
}

function requiredVectorBackend(value: unknown): MemoryVectorBackendKind {
  const backend = requiredText('vector backend', value)
  if (!['sqlite_exact', 'chroma', 'qdrant', 'pgvector'].includes(backend)) throw new Error('invalid vector backend')
  return backend as MemoryVectorBackendKind
}

function affected(result: QueryResult): number {
  return requiredInteger('affected row count', result.affectedRows)
}

async function rows<Row>(em: SqlEntityManager, sql: string, parameters: readonly unknown[] = []): Promise<readonly Row[]> {
  return await em.execute(sql, [...parameters], 'all') as readonly Row[]
}

async function row<Row>(em: SqlEntityManager, sql: string, parameters: readonly unknown[] = []): Promise<Row | undefined> {
  return await em.execute(sql, [...parameters], 'get') as Row | undefined
}

async function run(em: SqlEntityManager, sql: string, parameters: readonly unknown[] = []): Promise<number> {
  return affected(await em.execute(sql, [...parameters], 'run') as QueryResult)
}

async function canonicalStoreId(em: SqlEntityManager): Promise<string> {
  const result = await rows<{ readonly id: unknown }>(em, 'SELECT id FROM memory_store ORDER BY id LIMIT 2')
  if (result.length !== 1) throw new Error('canonical memory store identity is unavailable')
  return requiredText('canonical memory store id', result[0]!.id)
}

function identityFrom(value: ProjectionIdentityRow): MemoryVectorIdentity {
  return Object.freeze({
    generationId: requiredText('projection generation id', value.generation_id),
    recordId: requiredText('projection record id', value.record_id),
    revisionId: requiredText('projection revision id', value.revision_id),
  })
}


function temporalEligible(rowValue: Pick<ProjectionSourceRow, 'valid_from' | 'valid_until' | 'expires_at'>, timestamp: string): boolean {
  const validFrom = optionalText('projection valid_from', rowValue.valid_from)
  const validUntil = optionalText('projection valid_until', rowValue.valid_until)
  const expiresAt = optionalText('projection expires_at', rowValue.expires_at)
  return (validFrom === undefined || validFrom <= timestamp)
    && (validUntil === undefined || validUntil > timestamp)
    && (expiresAt === undefined || expiresAt > timestamp)
}

export interface MemoryProjectionRoute {
  readonly instanceId: string
  readonly vectorBackend: MemoryVectorBackendKind
  readonly vectorTargetId: string
}

export interface MemoryProjectionOwner extends MemoryProjectionRoute {
  readonly generationId: string
  readonly embedderFingerprint: string
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

export interface MemoryProjectionLease extends MemoryVectorIdentity {
  readonly id: string
  readonly leaseToken: string
  readonly leaseUntil: string
  readonly attempts: number
}

export interface MemoryProjectionGenerationTransition {
  readonly generationRevision: number
  readonly activeGenerationRevision: number
  readonly transitionToken: string
  readonly transitionUntil: string
}

export interface MemoryProjectionGenerationRecord extends MemoryProjectionOwner {
  readonly state: MemoryProjectionGenerationState
  readonly embedderIdentityJson: string
  readonly vectorIndexIdentityJson: string
  readonly generationRevision: number
}

export interface MemoryProjectionActiveGeneration {
  readonly generationId: string
  readonly generationRevision: number
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

export interface MemoryProjectionRetainedGeneration extends MemoryProjectionOwner {
  readonly generationRevision: number
}

function validatedRoute(route: MemoryProjectionRoute): MemoryProjectionRoute {
  return Object.freeze({
    instanceId: requiredText('instance id', route.instanceId),
    vectorBackend: requiredVectorBackend(route.vectorBackend),
    vectorTargetId: requiredText('vector target id', route.vectorTargetId),
  })
}

function validatedOwner(owner: MemoryProjectionOwner): MemoryProjectionOwner {
  return Object.freeze({
    ...validatedRoute(owner),
    generationId: requiredText('generation id', owner.generationId),
    embedderFingerprint: requiredText('embedder fingerprint', owner.embedderFingerprint),
  })
}

function projectionSource(rowValue: ProjectionSourceRow): MemoryProjectionSource {
  const scopeKind = requiredText('projection scope kind', rowValue.scope_kind)
  if (scopeKind !== 'relationship' && scopeKind !== 'project') throw new Error('invalid projection scope kind')
  const kind = requiredText('projection kind', rowValue.kind)
  if (!['decision', 'fact', 'preference', 'procedure'].includes(kind)) throw new Error('invalid projection kind')
  if (rowValue.status !== 'active') throw new Error('invalid projection status')
  const projectId = optionalText('projection project id', rowValue.project_id)
  return Object.freeze({
    ...identityFrom(rowValue),
    instanceId: requiredText('projection instance id', rowValue.instance_id),
    actorId: requiredText('projection actor id', rowValue.actor_id),
    scopeKind,
    ...(projectId === undefined ? {} : { projectId }),
    kind: kind as MemoryProjectionSource['kind'],
    subjectKey: requiredText('projection subject key', rowValue.subject_key),
    status: 'active',
    content: requiredText('projection content', rowValue.content),
  })
}

function generationRecord(rowValue: GenerationRow): MemoryProjectionGenerationRecord {
  return Object.freeze({
    generationId: requiredText('generation id', rowValue.id),
    instanceId: requiredText('generation instance id', rowValue.instance_id),
    embedderFingerprint: requiredText('generation embedder fingerprint', rowValue.embedder_fingerprint),
    vectorBackend: requiredVectorBackend(rowValue.vector_backend),
    vectorTargetId: requiredText('generation vector target id', rowValue.vector_target_id),
    state: requiredGenerationState(rowValue.state),
    embedderIdentityJson: requiredText('embedder identity', rowValue.embedder_identity_json),
    vectorIndexIdentityJson: requiredText('vector index identity', rowValue.vector_index_identity_json),
    generationRevision: requiredInteger('generation revision', rowValue.generation_revision, 1),
  })
}

async function activeGenerationInTransaction(em: SqlEntityManager, storeId: string, instanceId: string): Promise<MemoryProjectionActiveGeneration | undefined> {
  const current = await row<ActiveGenerationRow>(em, `
    SELECT generation_id, generation_revision
    FROM memory_semantic_active_generation
    WHERE store_id = ? AND instance_id = ?
  `, [storeId, instanceId])
  return current === undefined ? undefined : Object.freeze({
    generationId: requiredText('active semantic generation id', current.generation_id),
    generationRevision: requiredInteger('active semantic generation revision', current.generation_revision, 1),
  })
}

export async function activeMemorySemanticGeneration(em: SqlEntityManager, instanceId: string): Promise<string | undefined> {
  const storeId = await canonicalStoreId(em)
  return (await activeGenerationInTransaction(em, storeId, requiredText('instance id', instanceId)))?.generationId
}

async function generationInTransaction(em: SqlEntityManager, storeId: string, owner: MemoryProjectionOwner): Promise<MemoryProjectionGenerationRecord | undefined> {
  const result = await row<GenerationRow>(em, `
    SELECT id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
      embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
      transition_token, transition_until
    FROM memory_semantic_generations
    WHERE id = ? AND store_id = ? AND instance_id = ?
      AND embedder_fingerprint = ? AND vector_backend = ? AND vector_target_id = ?
  `, [owner.generationId, storeId, owner.instanceId, owner.embedderFingerprint, owner.vectorBackend, owner.vectorTargetId])
  return result === undefined ? undefined : generationRecord(result)
}

async function insertProjectionUpsert(
  em: SqlEntityManager,
  storeId: string,
  owner: MemoryProjectionOwner,
  identity: MemoryVectorIdentity,
  timestamp: string,
): Promise<boolean> {
  const id = memoryProjectionWorkId('upsert', identity)
  return await run(em, `
    INSERT INTO memory_vector_projection_work(
      id, store_id, instance_id, generation_id, vector_backend, vector_target_id,
      record_id, revision_id, operation, state, attempts, available_at,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upsert', 'pending', 0, ?, NULL, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `, [
    id, storeId, owner.instanceId, identity.generationId, owner.vectorBackend, owner.vectorTargetId,
    identity.recordId, identity.revisionId, timestamp, timestamp, timestamp,
  ]) === 1
}

async function insertProjectionDeletion(
  em: SqlEntityManager,
  storeId: string,
  route: ProjectionRouteRow & ProjectionIdentityRow,
  timestamp: string,
): Promise<boolean> {
  const identity = identityFrom(route)
  const id = memoryProjectionWorkId('delete', identity)
  return await run(em, `
    INSERT INTO memory_vector_deletions(
      id, store_id, instance_id, generation_id, vector_backend, vector_target_id,
      record_id, revision_id, state, attempts, available_at,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `, [
    id, storeId, requiredText('deletion instance id', route.instance_id), identity.generationId,
    requiredVectorBackend(route.vector_backend), requiredText('deletion vector target id', route.vector_target_id),
    identity.recordId, identity.revisionId, timestamp, timestamp, timestamp,
  ]) === 1
}

export async function enqueueActiveMemoryProjection(
  em: SqlEntityManager,
  instanceId: string,
  recordId: string,
  revisionId: string,
  timestamp: string,
): Promise<void> {
  const canonicalInstanceId = requiredText('instance id', instanceId)
  const storeId = await canonicalStoreId(em)
  const active = await activeGenerationInTransaction(em, storeId, canonicalInstanceId)
  if (active === undefined) return
  const generation = await row<GenerationRow>(em, `
    SELECT id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
      embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
      transition_token, transition_until
    FROM memory_semantic_generations
    WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'active'
  `, [active.generationId, storeId, canonicalInstanceId])
  if (generation === undefined) throw new Error('active semantic generation is inconsistent')
  const owner = generationRecord(generation)
  await insertProjectionUpsert(em, storeId, owner, {
    generationId: owner.generationId,
    recordId: requiredText('record id', recordId),
    revisionId: requiredText('revision id', revisionId),
  }, requiredText('timestamp', timestamp))
}

export async function enqueueMemoryRevisionReplacement(
  em: SqlEntityManager,
  instanceId: string,
  recordId: string,
  previousRevisionId: string,
  nextRevisionId: string,
  timestamp: string,
): Promise<void> {
  const canonicalInstanceId = requiredText('instance id', instanceId)
  const storeId = await canonicalStoreId(em)
  const active = await activeGenerationInTransaction(em, storeId, canonicalInstanceId)
  if (active === undefined) return
  const generation = await row<GenerationRow>(em, `
    SELECT id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
      embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
      transition_token, transition_until
    FROM memory_semantic_generations
    WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'active'
  `, [active.generationId, storeId, canonicalInstanceId])
  if (generation === undefined) throw new Error('active semantic generation is inconsistent')
  const owner = generationRecord(generation)
  const canonicalRecordId = requiredText('record id', recordId)
  const canonicalTimestamp = requiredText('timestamp', timestamp)
  await insertProjectionDeletion(em, storeId, {
    store_id: storeId,
    instance_id: canonicalInstanceId,
    generation_id: owner.generationId,
    vector_backend: owner.vectorBackend,
    vector_target_id: owner.vectorTargetId,
    record_id: canonicalRecordId,
    revision_id: requiredText('previous revision id', previousRevisionId),
  }, canonicalTimestamp)
  await insertProjectionUpsert(em, storeId, owner, {
    generationId: owner.generationId,
    recordId: canonicalRecordId,
    revisionId: requiredText('next revision id', nextRevisionId),
  }, canonicalTimestamp)
}

export async function enqueueKnownMemoryProjectionDeletions(
  em: SqlEntityManager,
  recordId: string,
  timestamp: string,
): Promise<void> {
  const canonicalRecordId = requiredText('record id', recordId)
  const canonicalTimestamp = requiredText('timestamp', timestamp)
  const storeId = await canonicalStoreId(em)
  const known = await rows<ProjectionRouteRow & ProjectionIdentityRow>(em, `
    SELECT g.store_id, g.instance_id, g.id AS generation_id, g.vector_backend, g.vector_target_id,
      r.id AS record_id, v.id AS revision_id
    FROM memory_records r
    JOIN memory_revisions v ON v.record_id = r.id
    JOIN memory_semantic_generations g ON g.store_id = ? AND g.instance_id = r.instance_id
    WHERE r.id = ?
    UNION
    SELECT i.store_id, i.instance_id, i.generation_id, g.vector_backend, g.vector_target_id,
      i.record_id, i.revision_id
    FROM memory_semantic_indexed_revisions i
    JOIN memory_semantic_generations g ON g.id = i.generation_id AND g.store_id = i.store_id
    WHERE i.store_id = ? AND i.record_id = ?
    UNION
    SELECT w.store_id, w.instance_id, w.generation_id, w.vector_backend, w.vector_target_id,
      w.record_id, w.revision_id
    FROM memory_vector_projection_work w
    WHERE w.store_id = ? AND w.record_id = ?
    UNION
    SELECT d.store_id, d.instance_id, d.generation_id, d.vector_backend, d.vector_target_id,
      d.record_id, d.revision_id
    FROM memory_vector_deletions d
    WHERE d.store_id = ? AND d.record_id = ?
  `, [storeId, canonicalRecordId, storeId, canonicalRecordId, storeId, canonicalRecordId, storeId, canonicalRecordId])
  for (const route of known) await insertProjectionDeletion(em, storeId, route, canonicalTimestamp)
  await run(em, 'DELETE FROM memory_vector_projection_work WHERE store_id = ? AND record_id = ?', [storeId, canonicalRecordId])
  await run(em, 'DELETE FROM memory_semantic_indexed_revisions WHERE store_id = ? AND record_id = ?', [storeId, canonicalRecordId])
  await run(em, 'DELETE FROM memory_embedding_cache WHERE record_id = ?', [canonicalRecordId])
}

async function convergeProjectionSource(
  em: SqlEntityManager,
  storeId: string,
  owner: MemoryProjectionOwner,
  lease: MemoryProjectionLease,
  timestamp: string,
): Promise<MemoryProjectionSource | undefined> {
  const sourceRow = await row<ProjectionSourceRow>(em, `
    SELECT w.id, w.store_id, w.instance_id, w.generation_id, w.vector_backend, w.vector_target_id,
      w.record_id, w.revision_id, w.attempts, w.lease_token, w.lease_until,
      r.actor_id, r.scope_kind, r.project_id, r.kind, r.subject_key, r.status,
      r.current_revision_id, r.valid_from, r.valid_until, r.expires_at,
      v.content, g.state AS generation_state
    FROM memory_vector_projection_work w
    LEFT JOIN memory_semantic_generations g
      ON g.id = w.generation_id AND g.store_id = w.store_id AND g.instance_id = w.instance_id
    LEFT JOIN memory_records r ON r.id = w.record_id AND r.instance_id = w.instance_id
    LEFT JOIN memory_revisions v ON v.id = w.revision_id AND v.record_id = r.id
    WHERE w.id = ? AND w.store_id = ? AND w.instance_id = ? AND w.generation_id = ?
      AND w.vector_backend = ? AND w.vector_target_id = ?
      AND w.state = 'leased' AND w.lease_token = ? AND w.lease_until > ?
  `, [
    lease.id, storeId, owner.instanceId, owner.generationId,
    owner.vectorBackend, owner.vectorTargetId, lease.leaseToken, timestamp,
  ])
  if (sourceRow === undefined) return undefined
  const identity = identityFrom(sourceRow)
  const generationState = optionalText('projection generation state', sourceRow.generation_state)
  const currentRevisionId = optionalText('projection current revision id', sourceRow.current_revision_id)
  const current = sourceRow.status === 'active'
    && currentRevisionId === identity.revisionId
    && sourceRow.content !== null
    && sourceRow.content !== undefined
    && temporalEligible(sourceRow, timestamp)
    && (generationState === 'active' || generationState === 'building')
  if (current) return projectionSource(sourceRow)

  await insertProjectionDeletion(em, storeId, sourceRow, timestamp)
  await run(em, `
    DELETE FROM memory_vector_projection_work
    WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_id = ?
      AND vector_backend = ? AND vector_target_id = ? AND state = 'leased' AND lease_token = ?
  `, [lease.id, storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId, lease.leaseToken])
  if (
    sourceRow.status === 'active'
    && currentRevisionId !== undefined
    && currentRevisionId !== identity.revisionId
    && (generationState === 'active' || generationState === 'building')
  ) {
    await insertProjectionUpsert(em, storeId, owner, {
      generationId: owner.generationId,
      recordId: identity.recordId,
      revisionId: currentRevisionId,
    }, timestamp)
  }
  return undefined
}

async function preserveStaleUpsertConvergence(
  em: SqlEntityManager,
  storeId: string,
  owner: MemoryProjectionOwner,
  lease: MemoryProjectionLease,
  timestamp: string,
): Promise<void> {
  const current = await row<{
    readonly current_revision_id: unknown
    readonly status: unknown
    readonly valid_from: unknown
    readonly valid_until: unknown
    readonly expires_at: unknown
    readonly generation_state: unknown
  }>(em, `
    SELECT r.current_revision_id, r.status, r.valid_from, r.valid_until, r.expires_at,
      g.state AS generation_state
    FROM memory_semantic_generations g
    LEFT JOIN memory_records r ON r.id = ? AND r.instance_id = g.instance_id
    WHERE g.id = ? AND g.store_id = ? AND g.instance_id = ?
      AND g.embedder_fingerprint = ? AND g.vector_backend = ? AND g.vector_target_id = ?
  `, [
    lease.recordId, owner.generationId, storeId, owner.instanceId,
    owner.embedderFingerprint, owner.vectorBackend, owner.vectorTargetId,
  ])
  const currentRevisionId = optionalText('projection current revision id', current?.current_revision_id)
  const generationState = optionalText('projection generation state', current?.generation_state)
  const sourceCurrent = current?.status === 'active'
    && currentRevisionId !== undefined
    && temporalEligible(current as Pick<ProjectionSourceRow, 'valid_from' | 'valid_until' | 'expires_at'>, timestamp)
    && (generationState === 'active' || generationState === 'building')
  if (sourceCurrent && currentRevisionId === lease.revisionId) return
  await insertProjectionDeletion(em, storeId, {
    store_id: storeId,
    instance_id: owner.instanceId,
    generation_id: owner.generationId,
    vector_backend: owner.vectorBackend,
    vector_target_id: owner.vectorTargetId,
    record_id: lease.recordId,
    revision_id: lease.revisionId,
  }, timestamp)
  if (sourceCurrent) {
    await insertProjectionUpsert(em, storeId, owner, {
      generationId: owner.generationId,
      recordId: lease.recordId,
      revisionId: currentRevisionId,
    }, timestamp)
  }
}

async function preserveStaleDeletionConvergence(
  em: SqlEntityManager,
  storeId: string,
  owner: MemoryProjectionOwner,
  lease: MemoryProjectionLease,
): Promise<void> {
  await run(em, `
    DELETE FROM memory_semantic_indexed_revisions
    WHERE store_id = ? AND instance_id = ? AND generation_id = ?
      AND record_id = ? AND revision_id = ?
  `, [storeId, owner.instanceId, lease.generationId, lease.recordId, lease.revisionId])
}

async function verifyGenerationInTransaction(
  em: SqlEntityManager,
  storeId: string,
  owner: MemoryProjectionOwner,
  timestamp: string,
): Promise<boolean> {
  const expected = await row<{ readonly count: unknown }>(em, `
    SELECT COUNT(*) AS count FROM memory_records
    WHERE instance_id = ? AND status = 'active'
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_until IS NULL OR valid_until > ?)
      AND (expires_at IS NULL OR expires_at > ?)
  `, [owner.instanceId, timestamp, timestamp, timestamp])
  const verified = await row<{ readonly count: unknown }>(em, `
    SELECT COUNT(*) AS count
    FROM memory_semantic_indexed_revisions i
    JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id
    WHERE i.store_id = ? AND i.instance_id = ? AND i.generation_id = ?
      AND r.instance_id = ? AND r.status = 'active'
      AND (r.valid_from IS NULL OR r.valid_from <= ?)
      AND (r.valid_until IS NULL OR r.valid_until > ?)
      AND (r.expires_at IS NULL OR r.expires_at > ?)
  `, [storeId, owner.instanceId, owner.generationId, owner.instanceId, timestamp, timestamp, timestamp])
  const stale = await row<{ readonly count: unknown }>(em, `
    SELECT COUNT(*) AS count
    FROM memory_semantic_indexed_revisions i
    LEFT JOIN memory_records r
      ON r.id = i.record_id AND r.current_revision_id = i.revision_id
      AND r.instance_id = ? AND r.status = 'active'
      AND (r.valid_from IS NULL OR r.valid_from <= ?)
      AND (r.valid_until IS NULL OR r.valid_until > ?)
      AND (r.expires_at IS NULL OR r.expires_at > ?)
    WHERE i.store_id = ? AND i.instance_id = ? AND i.generation_id = ? AND r.id IS NULL
  `, [owner.instanceId, timestamp, timestamp, timestamp, storeId, owner.instanceId, owner.generationId])
  return requiredInteger('expected generation count', expected?.count) === requiredInteger('verified generation count', verified?.count)
    && requiredInteger('stale generation count', stale?.count) === 0
}

function validatedTransition(transition: MemoryProjectionGenerationTransition): MemoryProjectionGenerationTransition {
  return Object.freeze({
    generationRevision: requiredInteger('generation revision', transition.generationRevision, 1),
    activeGenerationRevision: requiredInteger('active generation revision', transition.activeGenerationRevision),
    transitionToken: requiredText('generation transition token', transition.transitionToken),
    transitionUntil: requiredText('generation transition expiry', transition.transitionUntil),
  })
}

/** Asynchronous bounded canonical persistence operations for semantic coordinators. */
export class MemoryProjectionStore {
  private readonly database: MemoryDatabase

  constructor(database: MemoryDatabase) {
    this.database = database
  }

  async activeGeneration(instanceId: string): Promise<MemoryProjectionActiveGeneration | undefined> {
    const canonicalInstanceId = requiredText('instance id', instanceId)
    return this.database.read(async em => activeGenerationInTransaction(em, await canonicalStoreId(em), canonicalInstanceId))
  }

  async generation(ownerInput: MemoryProjectionOwner): Promise<MemoryProjectionGenerationRecord | undefined> {
    const owner = validatedOwner(ownerInput)
    return this.database.read(async em => generationInTransaction(em, await canonicalStoreId(em), owner))
  }

  async recoverLeases(ownerInput: MemoryProjectionOwner, timestamp: string): Promise<void> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    await this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      await run(em, `
        UPDATE memory_vector_projection_work
        SET state = 'failed', lease_token = NULL, lease_until = NULL,
          available_at = ?, updated_at = ?
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
          AND state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?
      `, [
        canonicalTimestamp, canonicalTimestamp, storeId, owner.instanceId, owner.generationId,
        owner.vectorBackend, owner.vectorTargetId, canonicalTimestamp,
      ])
      await run(em, `
        UPDATE memory_vector_deletions
        SET state = 'failed', lease_token = NULL, lease_until = NULL,
          available_at = ?, updated_at = ?
        WHERE store_id = ? AND instance_id = ?
          AND vector_backend = ? AND vector_target_id = ?
          AND state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?
      `, [
        canonicalTimestamp, canonicalTimestamp, storeId, owner.instanceId,
        owner.vectorBackend, owner.vectorTargetId, canonicalTimestamp,
      ])
    })
  }

  async claim(
    operation: 'upsert' | 'delete',
    ownerInput: MemoryProjectionOwner,
    maximumAttempts: number,
    leaseUntil: string,
    timestamp: string,
  ): Promise<MemoryProjectionLease | undefined> {
    const owner = validatedOwner(ownerInput)
    const attemptsLimit = requiredInteger('maximum attempts', maximumAttempts, 1)
    const canonicalLeaseUntil = requiredText('lease expiry', leaseUntil)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const table = operation === 'upsert' ? 'memory_vector_projection_work' : 'memory_vector_deletions'
    const generationCondition = operation === 'upsert' ? 'AND generation_id = ?' : ''
    const generationParameters = operation === 'upsert' ? [owner.generationId] : []
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const candidate = await row<ProjectionWorkRow>(em, `
        SELECT id, store_id, instance_id, generation_id, vector_backend, vector_target_id,
          record_id, revision_id, attempts, lease_token, lease_until
        FROM ${table}
        WHERE store_id = ? AND instance_id = ? ${generationCondition}
          AND vector_backend = ? AND vector_target_id = ?
          AND state IN ('pending', 'failed') AND attempts < ? AND available_at <= ?
        ORDER BY created_at, id LIMIT 1
      `, [
        storeId, owner.instanceId, ...generationParameters,
        owner.vectorBackend, owner.vectorTargetId, attemptsLimit, canonicalTimestamp,
      ])
      if (candidate === undefined) return undefined
      const id = requiredText('projection work id', candidate.id)
      const candidateGenerationId = requiredText('projection generation id', candidate.generation_id)
      const leaseToken = randomUUID()
      const changed = await run(em, `
        UPDATE ${table}
        SET state = 'leased', lease_token = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ? AND state IN ('pending', 'failed')
      `, [
        leaseToken, canonicalLeaseUntil, canonicalTimestamp, id, storeId, owner.instanceId,
        candidateGenerationId, owner.vectorBackend, owner.vectorTargetId,
      ])
      if (changed !== 1) return undefined
      return Object.freeze({
        id,
        ...identityFrom(candidate),
        leaseToken,
        leaseUntil: canonicalLeaseUntil,
        attempts: requiredInteger('projection attempts', candidate.attempts) + 1,
      })
    })
  }

  async renewLease(
    operation: 'upsert' | 'delete',
    ownerInput: MemoryProjectionOwner,
    lease: MemoryProjectionLease,
    leaseUntil: string,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const table = operation === 'upsert' ? 'memory_vector_projection_work' : 'memory_vector_deletions'
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const canonicalLeaseUntil = requiredText('lease expiry', leaseUntil)
    return this.database.write({ instanceId: owner.instanceId }, async em => await run(em, `
      UPDATE ${table}
      SET lease_until = ?, updated_at = ?
      WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_id = ?
        AND vector_backend = ? AND vector_target_id = ? AND state = 'leased'
        AND lease_token = ? AND lease_until > ?
    `, [
      canonicalLeaseUntil, canonicalTimestamp, requiredText('projection work id', lease.id),
      await canonicalStoreId(em), owner.instanceId, requiredText('projection generation id', lease.generationId),
      owner.vectorBackend, owner.vectorTargetId,
      requiredText('projection lease token', lease.leaseToken), canonicalTimestamp,
    ]) === 1)
  }

  async retry(
    operation: 'upsert' | 'delete',
    ownerInput: MemoryProjectionOwner,
    lease: MemoryProjectionLease,
    availableAt: string,
    failureCode: string,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const table = operation === 'upsert' ? 'memory_vector_projection_work' : 'memory_vector_deletions'
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const retried = await run(em, `
        UPDATE ${table}
        SET state = 'failed', available_at = ?, last_failure_code = ?, updated_at = ?,
          lease_token = NULL, lease_until = NULL
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ? AND state = 'leased'
          AND lease_token = ? AND lease_until > ?
      `, [
        requiredText('retry availability', availableAt), requiredText('failure code', failureCode), canonicalTimestamp,
        requiredText('projection work id', lease.id), storeId, owner.instanceId,
        requiredText('projection generation id', lease.generationId), owner.vectorBackend, owner.vectorTargetId,
        requiredText('projection lease token', lease.leaseToken), canonicalTimestamp,
      ])
      if (retried === 1) return true
      if (operation === 'upsert') await preserveStaleUpsertConvergence(em, storeId, owner, lease, canonicalTimestamp)
      else await preserveStaleDeletionConvergence(em, storeId, owner, lease)
      return false
    })
  }

  async source(ownerInput: MemoryProjectionOwner, lease: MemoryProjectionLease, timestamp: string): Promise<MemoryProjectionSource | undefined> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => convergeProjectionSource(
      em, await canonicalStoreId(em), owner, lease, canonicalTimestamp,
    ))
  }

  async acknowledgeUpsert(ownerInput: MemoryProjectionOwner, lease: MemoryProjectionLease, timestamp: string): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const source = await convergeProjectionSource(em, storeId, owner, lease, canonicalTimestamp)
      if (source === undefined) {
        await preserveStaleUpsertConvergence(em, storeId, owner, lease, canonicalTimestamp)
        return false
      }
      const deleted = await run(em, `
        DELETE FROM memory_vector_projection_work
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ? AND state = 'leased'
          AND lease_token = ? AND lease_until > ?
      `, [
        lease.id, storeId, owner.instanceId, lease.generationId, owner.vectorBackend,
        owner.vectorTargetId, lease.leaseToken, canonicalTimestamp,
      ])
      if (deleted !== 1) {
        await preserveStaleUpsertConvergence(em, storeId, owner, lease, canonicalTimestamp)
        return false
      }
      await run(em, `
        INSERT INTO memory_semantic_indexed_revisions(
          store_id, instance_id, generation_id, record_id, revision_id, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(generation_id, record_id) DO UPDATE SET
          store_id = excluded.store_id,
          instance_id = excluded.instance_id,
          revision_id = excluded.revision_id,
          indexed_at = excluded.indexed_at
      `, [storeId, owner.instanceId, source.generationId, source.recordId, source.revisionId, canonicalTimestamp])
      return true
    })
  }

  async acknowledgeDeletion(ownerInput: MemoryProjectionOwner, lease: MemoryProjectionLease, timestamp: string): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const deleted = await run(em, `
        DELETE FROM memory_vector_deletions
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ? AND state = 'leased'
          AND lease_token = ? AND lease_until > ?
      `, [
        lease.id, storeId, owner.instanceId, lease.generationId, owner.vectorBackend,
        owner.vectorTargetId, lease.leaseToken, canonicalTimestamp,
      ])
      if (deleted !== 1) {
        await preserveStaleDeletionConvergence(em, storeId, owner, lease)
        return false
      }
      await preserveStaleDeletionConvergence(em, storeId, owner, lease)
      return true
    })
  }
  async indexed(ownerInput: MemoryProjectionOwner): Promise<readonly MemoryVectorIdentity[]> {
    const owner = validatedOwner(ownerInput)
    return this.database.read(async em => {
      const storeId = await canonicalStoreId(em)
      const result = await rows<ProjectionIdentityRow>(em, `
        SELECT generation_id, record_id, revision_id
        FROM memory_semantic_indexed_revisions
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
        ORDER BY record_id, revision_id
      `, [storeId, owner.instanceId, owner.generationId])
      return Object.freeze(result.map(identityFrom))
    })
  }

  async cleanupIdentities(ownerInput: MemoryProjectionOwner): Promise<readonly MemoryVectorIdentity[]> {
    const owner = validatedOwner(ownerInput)
    return this.database.read(async em => {
      const storeId = await canonicalStoreId(em)
      const result = await rows<ProjectionIdentityRow>(em, `
        SELECT generation_id, record_id, revision_id
        FROM memory_semantic_indexed_revisions
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
        UNION
        SELECT generation_id, record_id, revision_id
        FROM memory_vector_projection_work
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
        UNION
        SELECT generation_id, record_id, revision_id
        FROM memory_vector_deletions
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
        ORDER BY record_id, revision_id
      `, [
        storeId, owner.instanceId, owner.generationId,
        storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId,
        storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId,
      ])
      return Object.freeze(result.map(identityFrom))
    })
  }

  async prepareGeneration(
    ownerInput: MemoryProjectionOwner,
    embedderIdentityJson: string,
    vectorIndexIdentityJson: string,
    timestamp: string,
    transitionUntil: string,
  ): Promise<MemoryProjectionGenerationTransition | undefined> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const canonicalTransitionUntil = requiredText('generation transition expiry', transitionUntil)
    const canonicalEmbedderIdentity = requiredText('embedder identity', embedderIdentityJson)
    const canonicalVectorIdentity = requiredText('vector index identity', vectorIndexIdentityJson)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const activeGeneration = await activeGenerationInTransaction(em, storeId, owner.instanceId)
      const activeGenerationRevision = activeGeneration?.generationRevision ?? 0
      const existing = await row<GenerationRow>(em, `
        SELECT id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
          embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
          transition_token, transition_until
        FROM memory_semantic_generations WHERE id = ?
      `, [owner.generationId])
      const transitionToken = randomUUID()
      if (existing === undefined) {
        await run(em, `
          INSERT INTO memory_semantic_generations(
            id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
            embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
            transition_token, transition_until, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'building', 1, ?, ?, ?)
        `, [
          owner.generationId, storeId, owner.instanceId, canonicalEmbedderIdentity, canonicalVectorIdentity,
          owner.embedderFingerprint, owner.vectorBackend, owner.vectorTargetId,
          transitionToken, canonicalTransitionUntil, canonicalTimestamp,
        ])
        return Object.freeze({ generationRevision: 1, activeGenerationRevision, transitionToken, transitionUntil: canonicalTransitionUntil })
      }
      const existingRecord = generationRecord(existing)
      if (
        existingRecord.instanceId !== owner.instanceId
        || requiredText('generation store id', existing.store_id) !== storeId
        || existingRecord.embedderFingerprint !== owner.embedderFingerprint
        || existingRecord.vectorBackend !== owner.vectorBackend
        || existingRecord.vectorTargetId !== owner.vectorTargetId
        || existingRecord.embedderIdentityJson !== canonicalEmbedderIdentity
        || existingRecord.vectorIndexIdentityJson !== canonicalVectorIdentity
      ) throw new Error('semantic generation identity does not match its canonical owner')
      if (existingRecord.state === 'active') {
        if (activeGeneration?.generationId === owner.generationId) return undefined
        throw new Error('semantic generation active pointer is inconsistent')
      }
      const existingToken = optionalText('generation transition token', existing.transition_token)
      const existingUntil = optionalText('generation transition expiry', existing.transition_until)
      if ((existingRecord.state === 'building' || existingRecord.state === 'deleting') && existingToken !== undefined && existingUntil !== undefined && existingUntil > canonicalTimestamp) return undefined
      const nextRevision = existingRecord.generationRevision + 1
      const changed = await run(em, `
        UPDATE memory_semantic_generations
        SET state = 'building', generation_revision = ?, transition_token = ?, transition_until = ?,
          failure_code = NULL, activated_at = NULL, completed_at = NULL
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_revision = ?
      `, [
        nextRevision, transitionToken, canonicalTransitionUntil, owner.generationId,
        storeId, owner.instanceId, existingRecord.generationRevision,
      ])
      return changed === 1
        ? Object.freeze({ generationRevision: nextRevision, activeGenerationRevision, transitionToken, transitionUntil: canonicalTransitionUntil })
        : undefined
    })
  }

  async renewGenerationTransition(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    transitionUntil: string,
    timestamp: string,
  ): Promise<MemoryProjectionGenerationTransition | undefined> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const canonicalUntil = requiredText('generation transition expiry', transitionUntil)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const changed = await run(em, `
        UPDATE memory_semantic_generations
        SET transition_until = ?
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_revision = ?
          AND transition_token = ? AND transition_until > ? AND state IN ('building', 'deleting')
      `, [
        canonicalUntil, owner.generationId, await canonicalStoreId(em), owner.instanceId,
        transition.generationRevision, transition.transitionToken, canonicalTimestamp,
      ])
      return changed === 1 ? Object.freeze({ ...transition, transitionUntil: canonicalUntil }) : undefined
    })
  }

  async resetGeneration(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    transitionUntil: string,
    timestamp: string,
  ): Promise<MemoryProjectionGenerationTransition | undefined> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const canonicalUntil = requiredText('generation transition expiry', transitionUntil)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const generation = await row<{ readonly id: unknown }>(em, `
        SELECT id FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'building'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        owner.generationId, storeId, owner.instanceId, transition.generationRevision,
        transition.transitionToken, canonicalTimestamp,
      ])
      if (generation === undefined) return undefined
      await run(em, `
        DELETE FROM memory_semantic_indexed_revisions
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
      `, [storeId, owner.instanceId, owner.generationId])
      await run(em, `
        DELETE FROM memory_vector_projection_work
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
      `, [storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId])
      await run(em, `
        DELETE FROM memory_vector_deletions
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
      `, [storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId])
      await run(em, `
        UPDATE memory_semantic_generations SET transition_until = ?
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_revision = ?
          AND transition_token = ? AND state = 'building'
      `, [canonicalUntil, owner.generationId, storeId, owner.instanceId, transition.generationRevision, transition.transitionToken])
      return Object.freeze({ ...transition, transitionUntil: canonicalUntil })
    })
  }

  async rebuildPage(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    lastId: string | undefined,
    limit: number,
    timestamp: string,
  ): Promise<readonly MemoryProjectionRebuildSource[]> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalLimit = requiredInteger('rebuild page limit', limit, 1)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.read(async em => {
      const storeId = await canonicalStoreId(em)
      const generation = await row<{ readonly id: unknown }>(em, `
        SELECT id FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'building'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        owner.generationId, storeId, owner.instanceId, transition.generationRevision,
        transition.transitionToken, canonicalTimestamp,
      ])
      if (generation === undefined) throw new Error('semantic generation rebuild lease is not current')
      const result = await rows<ProjectionSourceRow>(em, `
        SELECT r.id, r.current_revision_id, ? AS store_id, r.instance_id,
          ? AS generation_id, ? AS vector_backend, ? AS vector_target_id,
          r.id AS record_id, r.current_revision_id AS revision_id,
          0 AS attempts, '' AS lease_token, ? AS lease_until,
          r.actor_id, r.scope_kind, r.project_id, r.kind, r.subject_key, r.status,
          v.content, r.valid_from, r.valid_until, r.expires_at, 'building' AS generation_state
        FROM memory_records r
        JOIN memory_revisions v ON v.id = r.current_revision_id AND v.record_id = r.id
        WHERE r.instance_id = ? AND r.status = 'active'
          AND (r.valid_from IS NULL OR r.valid_from <= ?)
          AND (r.valid_until IS NULL OR r.valid_until > ?)
          AND (r.expires_at IS NULL OR r.expires_at > ?)
          AND (? IS NULL OR r.id > ?)
        ORDER BY r.id LIMIT ?
      `, [
        storeId, owner.generationId, owner.vectorBackend, owner.vectorTargetId, transition.transitionUntil,
        owner.instanceId, canonicalTimestamp, canonicalTimestamp, canonicalTimestamp,
        lastId ?? null, lastId ?? null, canonicalLimit,
      ])
      return Object.freeze(result.map(value => {
        const source = projectionSource(value)
        return Object.freeze({ ...source, id: source.recordId, currentRevisionId: source.revisionId })
      }))
    })
  }

  async markRebuildPage(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    page: readonly MemoryProjectionRebuildSource[],
    timestamp: string,
    transitionUntil: string,
  ): Promise<MemoryProjectionGenerationTransition | undefined> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const canonicalUntil = requiredText('generation transition expiry', transitionUntil)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const generation = await row<{ readonly id: unknown }>(em, `
        SELECT id FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'building'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        owner.generationId, storeId, owner.instanceId, transition.generationRevision,
        transition.transitionToken, canonicalTimestamp,
      ])
      if (generation === undefined) return undefined
      for (const source of page) {
        if (
          source.generationId !== owner.generationId
          || source.instanceId !== owner.instanceId
          || source.recordId !== source.id
          || source.revisionId !== source.currentRevisionId
        ) throw new Error('canonical rebuild source identity is invalid')
        const current = await row<{
          readonly instance_id: unknown
          readonly actor_id: unknown
          readonly current_revision_id: unknown
          readonly status: unknown
          readonly valid_from: unknown
          readonly valid_until: unknown
          readonly expires_at: unknown
        }>(em, `
          SELECT instance_id, actor_id, current_revision_id, status, valid_from, valid_until, expires_at
          FROM memory_records WHERE id = ?
        `, [source.id])
        if (
          current === undefined
          || current.instance_id !== source.instanceId
          || current.actor_id !== source.actorId
          || current.current_revision_id !== source.currentRevisionId
          || current.status !== 'active'
          || !temporalEligible(current, canonicalTimestamp)
        ) throw new Error('canonical rebuild source changed before acknowledgment')
        await run(em, `
          INSERT INTO memory_semantic_indexed_revisions(
            store_id, instance_id, generation_id, record_id, revision_id, indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(generation_id, record_id) DO UPDATE SET
            store_id = excluded.store_id,
            instance_id = excluded.instance_id,
            revision_id = excluded.revision_id,
            indexed_at = excluded.indexed_at
        `, [storeId, owner.instanceId, owner.generationId, source.id, source.currentRevisionId, canonicalTimestamp])
      }
      await run(em, `
        UPDATE memory_semantic_generations SET transition_until = ?
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_revision = ?
          AND transition_token = ? AND state = 'building'
      `, [canonicalUntil, owner.generationId, storeId, owner.instanceId, transition.generationRevision, transition.transitionToken])
      return Object.freeze({ ...transition, transitionUntil: canonicalUntil })
    })
  }

  async verifyGeneration(ownerInput: MemoryProjectionOwner, timestamp: string): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.read(async em => verifyGenerationInTransaction(em, await canonicalStoreId(em), owner, canonicalTimestamp))
  }

  async activateGeneration(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const generation = await row<{ readonly id: unknown }>(em, `
        SELECT id FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'building'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        owner.generationId, storeId, owner.instanceId, transition.generationRevision,
        transition.transitionToken, canonicalTimestamp,
      ])
      if (generation === undefined || !(await verifyGenerationInTransaction(em, storeId, owner, canonicalTimestamp))) return false
      const previous = await activeGenerationInTransaction(em, storeId, owner.instanceId)
      if ((previous?.generationRevision ?? 0) !== transition.activeGenerationRevision) return false
      if (previous !== undefined && previous.generationId !== owner.generationId) {
        await run(em, `
          UPDATE memory_semantic_generations
          SET state = 'retained', generation_revision = generation_revision + 1,
            transition_token = NULL, transition_until = NULL
          WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'active'
        `, [previous.generationId, storeId, owner.instanceId])
      }
      const activated = await run(em, `
        UPDATE memory_semantic_generations
        SET state = 'active', activated_at = ?, completed_at = ?, failure_code = NULL,
          generation_revision = generation_revision + 1,
          transition_token = NULL, transition_until = NULL
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'building'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        canonicalTimestamp, canonicalTimestamp, owner.generationId, storeId, owner.instanceId,
        transition.generationRevision, transition.transitionToken, canonicalTimestamp,
      ])
      if (activated !== 1) return false
      if (previous === undefined) {
        await run(em, `
          INSERT INTO memory_semantic_active_generation(
            store_id, instance_id, generation_id, generation_revision, updated_at
          ) VALUES (?, ?, ?, 1, ?)
        `, [storeId, owner.instanceId, owner.generationId, canonicalTimestamp])
      } else {
        const switched = await run(em, `
          UPDATE memory_semantic_active_generation
          SET generation_id = ?, generation_revision = generation_revision + 1, updated_at = ?
          WHERE store_id = ? AND instance_id = ? AND generation_revision = ?
        `, [owner.generationId, canonicalTimestamp, storeId, owner.instanceId, transition.activeGenerationRevision])
        if (switched !== 1) throw new Error('active semantic generation changed during activation')
      }
      return true
    })
  }

  async failGeneration(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    failureCode: string,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => await run(em, `
      UPDATE memory_semantic_generations
      SET state = 'failed', failure_code = ?, generation_revision = generation_revision + 1,
        transition_token = NULL, transition_until = NULL
      WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'building'
        AND generation_revision = ? AND transition_token = ? AND transition_until > ?
    `, [
      requiredText('generation failure code', failureCode), owner.generationId, await canonicalStoreId(em),
      owner.instanceId, transition.generationRevision, transition.transitionToken, canonicalTimestamp,
    ]) === 1)
  }

  async rollbackGeneration(
    ownerInput: MemoryProjectionOwner,
    expectedActiveRevision: number,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const activeRevision = requiredInteger('active generation revision', expectedActiveRevision, 1)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const target = await generationInTransaction(em, storeId, owner)
      const active = await activeGenerationInTransaction(em, storeId, owner.instanceId)
      if (
        target?.state !== 'retained'
        || active === undefined
        || active.generationRevision !== activeRevision
        || active.generationId === owner.generationId
        || !(await verifyGenerationInTransaction(em, storeId, owner, canonicalTimestamp))
      ) return false
      await run(em, `
        UPDATE memory_semantic_generations
        SET state = 'retained', generation_revision = generation_revision + 1,
          transition_token = NULL, transition_until = NULL
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'active'
      `, [active.generationId, storeId, owner.instanceId])
      const activated = await run(em, `
        UPDATE memory_semantic_generations
        SET state = 'active', activated_at = ?, failure_code = NULL,
          generation_revision = generation_revision + 1,
          transition_token = NULL, transition_until = NULL
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'retained'
          AND generation_revision = ?
      `, [canonicalTimestamp, owner.generationId, storeId, owner.instanceId, target.generationRevision])
      if (activated !== 1) return false
      const switched = await run(em, `
        UPDATE memory_semantic_active_generation
        SET generation_id = ?, generation_revision = generation_revision + 1, updated_at = ?
        WHERE store_id = ? AND instance_id = ? AND generation_revision = ?
      `, [owner.generationId, canonicalTimestamp, storeId, owner.instanceId, activeRevision])
      if (switched !== 1) throw new Error('active semantic generation changed during rollback')
      await run(em, `
        DELETE FROM memory_vector_projection_work
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
      `, [storeId, owner.instanceId, owner.generationId])
      return true
    })
  }

  async retainedGenerations(routeInput: MemoryProjectionRoute): Promise<readonly MemoryProjectionRetainedGeneration[]> {
    const route = validatedRoute(routeInput)
    return this.database.read(async em => {
      const result = await rows<GenerationRow>(em, `
        SELECT id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
          embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
          transition_token, transition_until
        FROM memory_semantic_generations
        WHERE store_id = ? AND instance_id = ? AND vector_backend = ? AND vector_target_id = ?
          AND state = 'retained'
        ORDER BY created_at, id
      `, [await canonicalStoreId(em), route.instanceId, route.vectorBackend, route.vectorTargetId])
      return Object.freeze(result.map(value => {
        const generation = generationRecord(value)
        return Object.freeze({
          generationId: generation.generationId,
          instanceId: generation.instanceId,
          embedderFingerprint: generation.embedderFingerprint,
          vectorBackend: generation.vectorBackend,
          vectorTargetId: generation.vectorTargetId,
          generationRevision: generation.generationRevision,
        })
      }))
    })
  }

  async beginRetainedGenerationCleanup(
    ownerInput: MemoryProjectionOwner,
    transitionUntil: string,
    timestamp: string,
  ): Promise<MemoryProjectionGenerationTransition | undefined> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    const canonicalUntil = requiredText('generation transition expiry', transitionUntil)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const activeGenerationRevision = (await activeGenerationInTransaction(em, storeId, owner.instanceId))?.generationRevision ?? 0
      const current = await row<GenerationRow>(em, `
        SELECT id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
          embedder_fingerprint, vector_backend, vector_target_id, state, generation_revision,
          transition_token, transition_until
        FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ?
          AND embedder_fingerprint = ? AND vector_backend = ? AND vector_target_id = ?
      `, [owner.generationId, storeId, owner.instanceId, owner.embedderFingerprint, owner.vectorBackend, owner.vectorTargetId])
      if (current === undefined) return undefined
      const generation = generationRecord(current)
      const token = optionalText('generation transition token', current.transition_token)
      const until = optionalText('generation transition expiry', current.transition_until)
      if (generation.state === 'deleting' && token !== undefined && until !== undefined && until > canonicalTimestamp) return undefined
      if (generation.state !== 'retained' && generation.state !== 'deleting') return undefined
      const transitionToken = randomUUID()
      const nextRevision = generation.generationRevision + 1
      const changed = await run(em, `
        UPDATE memory_semantic_generations
        SET state = 'deleting', generation_revision = ?, transition_token = ?, transition_until = ?
        WHERE id = ? AND store_id = ? AND instance_id = ? AND generation_revision = ?
      `, [
        nextRevision, transitionToken, canonicalUntil, owner.generationId,
        storeId, owner.instanceId, generation.generationRevision,
      ])
      return changed === 1
        ? Object.freeze({ generationRevision: nextRevision, activeGenerationRevision, transitionToken, transitionUntil: canonicalUntil })
        : undefined
    })
  }

  async completeRetainedGenerationCleanup(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => {
      const storeId = await canonicalStoreId(em)
      const current = await row<{ readonly id: unknown }>(em, `
        SELECT id FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'deleting'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        owner.generationId, storeId, owner.instanceId, transition.generationRevision,
        transition.transitionToken, canonicalTimestamp,
      ])
      if (current === undefined) return false
      if ((await activeGenerationInTransaction(em, storeId, owner.instanceId))?.generationId === owner.generationId) return false
      await run(em, `DELETE FROM memory_vector_projection_work WHERE store_id = ? AND instance_id = ? AND generation_id = ?`, [storeId, owner.instanceId, owner.generationId])
      await run(em, `
        DELETE FROM memory_vector_deletions
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
      `, [storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId])
      await run(em, `DELETE FROM memory_semantic_indexed_revisions WHERE store_id = ? AND instance_id = ? AND generation_id = ?`, [storeId, owner.instanceId, owner.generationId])
      return await run(em, `
        DELETE FROM memory_semantic_generations
        WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'deleting'
          AND generation_revision = ? AND transition_token = ? AND transition_until > ?
      `, [
        owner.generationId, storeId, owner.instanceId, transition.generationRevision,
        transition.transitionToken, canonicalTimestamp,
      ]) === 1
    })
  }

  async abandonRetainedGenerationCleanup(
    ownerInput: MemoryProjectionOwner,
    transitionInput: MemoryProjectionGenerationTransition,
    failureCode: string,
    timestamp: string,
  ): Promise<boolean> {
    const owner = validatedOwner(ownerInput)
    const transition = validatedTransition(transitionInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.write({ instanceId: owner.instanceId }, async em => await run(em, `
      UPDATE memory_semantic_generations
      SET state = 'retained', failure_code = ?, generation_revision = generation_revision + 1,
        transition_token = NULL, transition_until = NULL
      WHERE id = ? AND store_id = ? AND instance_id = ? AND state = 'deleting'
        AND generation_revision = ? AND transition_token = ? AND transition_until > ?
    `, [
      requiredText('generation cleanup failure code', failureCode), owner.generationId,
      await canonicalStoreId(em), owner.instanceId, transition.generationRevision,
      transition.transitionToken, canonicalTimestamp,
    ]) === 1)
  }

  async statusCounts(ownerInput: MemoryProjectionOwner, timestamp: string): Promise<MemoryProjectionStatusCounts> {
    const owner = validatedOwner(ownerInput)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.read(async em => {
      const storeId = await canonicalStoreId(em)
      const indexed = await row<{ readonly count: unknown }>(em, `SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions WHERE store_id = ? AND instance_id = ? AND generation_id = ?`, [storeId, owner.instanceId, owner.generationId])
      const eligible = await row<{ readonly count: unknown }>(em, `
        SELECT COUNT(*) AS count FROM memory_records
        WHERE instance_id = ? AND status = 'active'
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_until IS NULL OR valid_until > ?)
          AND (expires_at IS NULL OR expires_at > ?)
      `, [owner.instanceId, canonicalTimestamp, canonicalTimestamp, canonicalTimestamp])
      const current = await row<{ readonly count: unknown }>(em, `
        SELECT COUNT(*) AS count
        FROM memory_semantic_indexed_revisions i
        JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id
        WHERE i.store_id = ? AND i.instance_id = ? AND i.generation_id = ?
          AND r.instance_id = ? AND r.status = 'active'
          AND (r.valid_from IS NULL OR r.valid_from <= ?)
          AND (r.valid_until IS NULL OR r.valid_until > ?)
          AND (r.expires_at IS NULL OR r.expires_at > ?)
      `, [
        storeId, owner.instanceId, owner.generationId, owner.instanceId,
        canonicalTimestamp, canonicalTimestamp, canonicalTimestamp,
      ])
      const pendingUpserts = await row<{ readonly count: unknown }>(em, `
        SELECT COUNT(*) AS count FROM memory_vector_projection_work
        WHERE store_id = ? AND instance_id = ? AND generation_id = ?
          AND vector_backend = ? AND vector_target_id = ?
          AND state IN ('pending', 'leased', 'failed')
      `, [storeId, owner.instanceId, owner.generationId, owner.vectorBackend, owner.vectorTargetId])
      const pendingDeletes = await row<{ readonly count: unknown }>(em, `
        SELECT COUNT(*) AS count FROM memory_vector_deletions
        WHERE store_id = ? AND instance_id = ?
          AND vector_backend = ? AND vector_target_id = ?
          AND state IN ('pending', 'leased', 'failed')
      `, [storeId, owner.instanceId, owner.vectorBackend, owner.vectorTargetId])
      return Object.freeze({
        indexed: requiredInteger('indexed count', indexed?.count),
        eligible: requiredInteger('eligible count', eligible?.count),
        current: requiredInteger('current count', current?.count),
        pendingUpserts: requiredInteger('pending upsert count', pendingUpserts?.count),
        pendingDeletes: requiredInteger('pending deletion count', pendingDeletes?.count),
      })
    })
  }

  async eligibleHits(
    ownerInput: MemoryProjectionOwner,
    identities: readonly MemoryVectorIdentity[],
    actorId: string,
    projectId: string | undefined,
    timestamp: string,
  ): Promise<readonly MemoryVectorIdentity[]> {
    const owner = validatedOwner(ownerInput)
    if (identities.length === 0) return Object.freeze([])
    if (identities.length > 1024) throw new TypeError('semantic hit validation batch is too large')
    const canonicalActorId = requiredText('actor id', actorId)
    const canonicalTimestamp = requiredText('timestamp', timestamp)
    return this.database.read(async em => {
      const storeId = await canonicalStoreId(em)
      const active = await activeGenerationInTransaction(em, storeId, owner.instanceId)
      if (active?.generationId !== owner.generationId) return Object.freeze([])
      const generation = await generationInTransaction(em, storeId, owner)
      if (generation?.state !== 'active') return Object.freeze([])
      const recordIds = [...new Set(identities.map(identity => requiredText('semantic hit record id', identity.recordId)))]
      const placeholders = recordIds.map(() => '?').join(', ')
      const result = await rows<{
        readonly id: unknown
        readonly current_revision_id: unknown
        readonly scope_kind: unknown
        readonly project_id: unknown
        readonly status: unknown
        readonly valid_from: unknown
        readonly valid_until: unknown
        readonly expires_at: unknown
      }>(em, `
        SELECT id, current_revision_id, scope_kind, project_id, status,
          valid_from, valid_until, expires_at
        FROM memory_records
        WHERE instance_id = ? AND actor_id = ? AND id IN (${placeholders})
      `, [owner.instanceId, canonicalActorId, ...recordIds])
      const eligible = new Set<string>()
      for (const record of result) {
        if (record.status !== 'active') continue
        if (record.scope_kind === 'project' && (projectId === undefined || record.project_id !== projectId)) continue
        if (record.scope_kind === 'relationship' && record.project_id !== null) continue
        if (record.scope_kind !== 'project' && record.scope_kind !== 'relationship') continue
        if (!temporalEligible(record as Pick<ProjectionSourceRow, 'valid_from' | 'valid_until' | 'expires_at'>, canonicalTimestamp)) continue
        eligible.add(`${requiredText('record id', record.id)}\u0000${requiredText('revision id', record.current_revision_id)}`)
      }
      return Object.freeze(identities.filter(identity =>
        identity.generationId === owner.generationId
        && eligible.has(`${identity.recordId}\u0000${identity.revisionId}`),
      ).map(identity => Object.freeze({ ...identity })))
    })
  }
}

export function memoryProjectionOwner(
  instanceId: string,
  generationId: string,
  embedder: MemoryEmbedderIdentity,
  vectorIndex: MemoryVectorIndexIdentity,
): MemoryProjectionOwner {
  return Object.freeze({
    instanceId: requiredText('instance id', instanceId),
    generationId: requiredText('generation id', generationId),
    embedderFingerprint: memoryEmbedderFingerprint(embedder),
    vectorBackend: vectorIndex.backend,
    vectorTargetId: requiredText('vector target id', vectorIndex.configFingerprint),
  })
}
