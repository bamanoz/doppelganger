import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/extension-persona'
import type { InstanceSqliteDatabase } from '@doppelganger/extension-sqlite'
import type {} from '@doppelganger/extension-sqlite'
import { containsMemorySecret } from './content-policy.ts'
import { memoryEligibility, memoryTemporalState, type MemoryPartition } from './eligibility.ts'
import { deleteMemoryRecordRows, migrateMemorySchema } from './schema.ts'

export type MemoryKind = 'decision' | 'fact' | 'preference' | 'procedure'
export type MemoryStatus = 'active' | 'candidate' | 'rejected'
export type MemoryRole = 'principal' | 'assistant' | 'tool' | 'system'
export type MemoryEvidenceRelation = 'support' | 'contradiction'

export interface MemoryScope {
  readonly kind: 'relationship' | 'project'
  readonly projectId?: string
}

export interface MemoryTemporalInput {
  readonly validFrom?: string
  readonly validUntil?: string
  readonly expiresAt?: string
}

export interface MemoryRevision extends MemoryTemporalInput {
  readonly id: string
  readonly ordinal: number
  readonly content: string
  readonly sourceSessionId: string
  readonly sourceKind: string
  readonly supersedesRevisionId?: string
  readonly createdAt: string
}

export interface MemoryRecord extends MemoryTemporalInput {
  readonly id: string
  readonly instanceId: string
  readonly principalId: string
  readonly kind: MemoryKind
  readonly subjectKey: string
  readonly scope: MemoryScope
  readonly status: MemoryStatus
  readonly pinned: boolean
  readonly confidence: number
  readonly salience: number
  readonly temporalState: 'eligible' | 'expired' | 'not-yet-valid'
  readonly hasUnresolvedConflict: boolean
  readonly sourceSessionId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly revision: MemoryRevision
}

export interface MemoryEvidence {
  readonly id: string
  readonly recordId: string
  readonly sourceSessionId: string
  readonly sourceTurnId: string
  readonly role: MemoryRole
  readonly relation: MemoryEvidenceRelation
  readonly excerpt: string
  readonly createdAt: string
}

export interface MemoryConflict {
  readonly id: string
  readonly activeRecordId: string
  readonly candidateRecordId: string
  readonly evidenceId?: string
  readonly status: 'unresolved' | 'resolved-active' | 'resolved-candidate' | 'dismissed'
  readonly createdAt: string
  readonly resolvedAt?: string
  readonly resolutionRevisionId?: string
}

export interface MemoryEvidenceInput {
  readonly turnId?: string
  readonly role?: MemoryRole
  readonly relation?: MemoryEvidenceRelation
  readonly excerpt?: string
}

export interface RememberMemoryRequest extends MemoryTemporalInput {
  readonly operationId: string
  readonly subjectKey: string
  readonly content: string
  readonly kind: MemoryKind
  readonly scope?: 'relationship' | 'project'
  readonly confidence?: number
  readonly salience?: number
  readonly evidence?: MemoryEvidenceInput
}

export interface ObserveMemoryRequest {
  readonly operationId: string
  readonly recordId: string
  readonly turnId: string
  readonly role: MemoryRole
  readonly relation: MemoryEvidenceRelation
  readonly excerpt: string
}

export interface CorrectMemoryRequest extends MemoryTemporalInput {
  readonly operationId: string
  readonly id: string
  readonly content: string
  readonly expectedRevisionId: string
  readonly confidence?: number
  readonly salience?: number
  readonly evidence?: MemoryEvidenceInput
}

export interface CandidateDecisionRequest {
  readonly operationId: string
  readonly candidateId: string
}

export interface CandidateEvidenceRequest {
  readonly operationId: string
  readonly candidateId: string
  readonly turnId: string
  readonly content: string
  readonly role?: MemoryRole
  readonly contradiction?: boolean
}

export interface PinMemoryRequest {
  readonly operationId: string
  readonly id: string
  readonly pinned: boolean
}

export interface ForgetMemoryRequest {
  readonly operationId: string
  readonly id: string
}

export interface ResolveMemoryConflictRequest {
  readonly operationId: string
  readonly conflictId: string
  readonly expectedRevisionId: string
  readonly resolution: 'dismiss' | 'keep-active' | 'promote-candidate'
}

export interface EmbeddingCandidate {
  readonly recordId: string
  readonly revisionId: string
  readonly content: string
}

export interface EmbeddingRank {
  readonly recordId: string
  readonly revisionId: string
  readonly rank: number
}

export interface MemoryEmbeddingProvider {
  rank(query: string, candidates: readonly EmbeddingCandidate[]): Promise<readonly EmbeddingRank[]>
}

export interface MemorySearchRequest {
  readonly query: string
  readonly tokenBudget: number
  readonly limit?: number
}

export interface MemorySearchResult {
  readonly record: MemoryRecord
  readonly score: number
  readonly lexicalRank?: number
  readonly semanticRank?: number
}

export interface MemoryServiceConfig {
  readonly namespace?: string
  readonly now?: () => Date
  readonly id?: () => string
  readonly automaticPromotionDistinctSessions?: number
  readonly semanticCandidateLimit?: number
}

export class MemoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'MemoryError'
  }
}

interface OperationReceipt {
  readonly command_digest: unknown
  readonly result_kind: unknown
  readonly result_record_id: unknown
  readonly result_revision_id: unknown
}

const RECORD_SELECT = `
  SELECT
    r.id, r.instance_id, r.principal_id, r.kind, r.subject_key,
    r.scope_kind, r.project_id, r.status, r.pinned, r.confidence, r.salience,
    r.valid_from, r.valid_until, r.expires_at,
    r.source_session_id, r.created_at, r.updated_at,
    EXISTS(
      SELECT 1 FROM memory_conflicts c
      WHERE (c.active_record_id = r.id OR c.candidate_record_id = r.id)
        AND c.status = 'unresolved'
    ) AS has_unresolved_conflict,
    v.id AS revision_id, v.ordinal, v.content,
    v.source_session_id AS revision_source_session_id,
    v.source_kind, v.supersedes_revision_id,
    v.valid_from AS revision_valid_from,
    v.valid_until AS revision_valid_until,
    v.expires_at AS revision_expires_at,
    v.created_at AS revision_created_at
  FROM memory_records r
  JOIN memory_revisions v ON v.id = r.current_revision_id
`

const SUBJECT_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MAX_CONTENT_LENGTH = 16_000
const MAX_EVIDENCE_LENGTH = 1_000
const RRF_K = 60

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid memory database ${field}`)
  return value
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === null || value === undefined ? undefined : text(value, field)
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`invalid memory database ${field}`)
  return value
}

function validateContent(content: string, field = 'memory content'): string {
  content = content.trim()
  if (content.length === 0) throw new MemoryError('INVALID_CONTENT', `${field} must be non-empty`)
  if (content.length > MAX_CONTENT_LENGTH) throw new MemoryError('CONTENT_TOO_LARGE', `${field} exceeds ${MAX_CONTENT_LENGTH} characters`)
  if (containsMemorySecret(content)) {
    throw new MemoryError('SECRET_REJECTED', `${field} appears to contain a credential or secret`)
  }
  return content
}

function boundedEvidence(content: string): string {
  content = validateContent(content, 'memory evidence')
  if (content.length <= MAX_EVIDENCE_LENGTH) return content
  return `${content.slice(0, MAX_EVIDENCE_LENGTH - 1)}…`
}

function validateKind(kind: MemoryKind): MemoryKind {
  if (!['decision', 'fact', 'preference', 'procedure'].includes(kind)) {
    throw new MemoryError('INVALID_KIND', `unsupported memory kind "${kind}"`)
  }
  return kind
}

function validateRole(role: MemoryRole): MemoryRole {
  if (!['principal', 'assistant', 'tool', 'system'].includes(role)) {
    throw new MemoryError('INVALID_ROLE', `unsupported memory evidence role "${role}"`)
  }
  return role
}

function validateRelation(relation: MemoryEvidenceRelation): MemoryEvidenceRelation {
  if (relation !== 'support' && relation !== 'contradiction') {
    throw new MemoryError('INVALID_RELATION', `unsupported memory evidence relation "${relation}"`)
  }
  return relation
}

function requiredId(field: string, value: string): string {
  value = value.trim()
  if (value.length === 0 || value.length > 200) throw new MemoryError('INVALID_ID', `${field} must be 1-200 characters`)
  return value
}

function subjectKey(value: string): string {
  value = value.trim()
  if (value.length > 200 || !SUBJECT_KEY_PATTERN.test(value)) {
    throw new MemoryError('INVALID_SUBJECT_KEY', 'memory subjectKey must be a stable lowercase dotted identifier')
  }
  return value
}

function unit(field: string, value: number | undefined, fallback: number): number {
  value ??= fallback
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new MemoryError('INVALID_WEIGHT', `${field} must be between 0 and 1`)
  }
  return value
}

function iso(field: string, value: string | undefined): string | undefined {
  if (value === undefined) return
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new MemoryError('INVALID_TIME', `${field} must be an ISO 8601 UTC timestamp`)
  }
  return value
}

function temporal(input: MemoryTemporalInput): Required<MemoryTemporalInput> | {
  readonly validFrom?: string
  readonly validUntil?: string
  readonly expiresAt?: string
} {
  const validFrom = iso('validFrom', input.validFrom)
  const validUntil = iso('validUntil', input.validUntil)
  const expiresAt = iso('expiresAt', input.expiresAt)
  if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
    throw new MemoryError('INVALID_TIME_RANGE', 'validUntil must be later than validFrom')
  }
  return {
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(command: string, payload: unknown): string {
  return createHash('sha256').update(stableJson({ command, payload })).digest('hex')
}

function recordFrom(row: Record<string, unknown>, now: string): MemoryRecord {
  const projectId = optionalText(row.project_id, 'project_id')
  const validFrom = optionalText(row.valid_from, 'valid_from')
  const validUntil = optionalText(row.valid_until, 'valid_until')
  const expiresAt = optionalText(row.expires_at, 'expires_at')
  const revisionValidFrom = optionalText(row.revision_valid_from, 'revision_valid_from')
  const revisionValidUntil = optionalText(row.revision_valid_until, 'revision_valid_until')
  const revisionExpiresAt = optionalText(row.revision_expires_at, 'revision_expires_at')
  return Object.freeze({
    id: text(row.id, 'id'),
    instanceId: text(row.instance_id, 'instance_id'),
    principalId: text(row.principal_id, 'principal_id'),
    kind: text(row.kind, 'kind') as MemoryKind,
    subjectKey: text(row.subject_key, 'subject_key'),
    scope: Object.freeze({
      kind: text(row.scope_kind, 'scope_kind') as MemoryScope['kind'],
      ...(projectId === undefined ? {} : { projectId }),
    }),
    status: text(row.status, 'status') as MemoryStatus,
    pinned: row.pinned === 1,
    confidence: finite(row.confidence, 'confidence'),
    salience: finite(row.salience, 'salience'),
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    temporalState: memoryTemporalState({
      ...(validFrom === undefined ? {} : { validFrom }),
      ...(validUntil === undefined ? {} : { validUntil }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    }, now),
    hasUnresolvedConflict: row.has_unresolved_conflict === 1,
    sourceSessionId: text(row.source_session_id, 'source_session_id'),
    createdAt: text(row.created_at, 'created_at'),
    updatedAt: text(row.updated_at, 'updated_at'),
    revision: Object.freeze({
      id: text(row.revision_id, 'revision_id'),
      ordinal: Number(row.ordinal),
      content: text(row.content, 'content'),
      sourceSessionId: text(row.revision_source_session_id, 'revision_source_session_id'),
      sourceKind: text(row.source_kind, 'source_kind'),
      ...(optionalText(row.supersedes_revision_id, 'supersedes_revision_id') === undefined
        ? {}
        : { supersedesRevisionId: text(row.supersedes_revision_id, 'supersedes_revision_id') }),
      ...(revisionValidFrom === undefined ? {} : { validFrom: revisionValidFrom }),
      ...(revisionValidUntil === undefined ? {} : { validUntil: revisionValidUntil }),
      ...(revisionExpiresAt === undefined ? {} : { expiresAt: revisionExpiresAt }),
      createdAt: text(row.revision_created_at, 'revision_created_at'),
    }),
  })
}

function evidenceFrom(row: Record<string, unknown>): MemoryEvidence {
  return Object.freeze({
    id: text(row.id, 'evidence.id'),
    recordId: text(row.record_id, 'evidence.record_id'),
    sourceSessionId: text(row.source_session_id, 'evidence.source_session_id'),
    sourceTurnId: text(row.source_turn_id, 'evidence.source_turn_id'),
    role: text(row.role, 'evidence.role') as MemoryRole,
    relation: text(row.relation, 'evidence.relation') as MemoryEvidenceRelation,
    excerpt: text(row.excerpt, 'evidence.excerpt'),
    createdAt: text(row.created_at, 'evidence.created_at'),
  })
}

function conflictFrom(row: Record<string, unknown>): MemoryConflict {
  const evidenceId = optionalText(row.evidence_id, 'conflict.evidence_id')
  const resolvedAt = optionalText(row.resolved_at, 'conflict.resolved_at')
  const resolutionRevisionId = optionalText(row.resolution_revision_id, 'conflict.resolution_revision_id')
  return Object.freeze({
    id: text(row.id, 'conflict.id'),
    activeRecordId: text(row.active_record_id, 'conflict.active_record_id'),
    candidateRecordId: text(row.candidate_record_id, 'conflict.candidate_record_id'),
    ...(evidenceId === undefined ? {} : { evidenceId }),
    status: text(row.status, 'conflict.status') as MemoryConflict['status'],
    createdAt: text(row.created_at, 'conflict.created_at'),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    ...(resolutionRevisionId === undefined ? {} : { resolutionRevisionId }),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerMemory: MemoryService
    doppelgangerEmbedding: MemoryEmbeddingProvider
  }
}

export class MemoryService extends Service {
  static inject = ['doppelgangerInstanceSqlite', 'doppelgangerPersona']

  private database!: InstanceSqliteDatabase
  private readonly now: () => Date
  private readonly id: () => string
  private readonly namespace: string
  private readonly automaticPromotionDistinctSessions: number
  private readonly semanticCandidateLimit: number

  constructor(ctx: Context, config: MemoryServiceConfig = {}) {
    super(ctx, 'doppelgangerMemory')
    this.now = config.now ?? (() => new Date())
    this.id = config.id ?? randomUUID
    this.namespace = config.namespace ?? 'memory'
    this.automaticPromotionDistinctSessions = config.automaticPromotionDistinctSessions ?? 2
    this.semanticCandidateLimit = config.semanticCandidateLimit ?? 200
    if (!Number.isSafeInteger(this.automaticPromotionDistinctSessions) || this.automaticPromotionDistinctSessions < 2) {
      throw new TypeError('automaticPromotionDistinctSessions must be an integer of at least 2')
    }
    if (!Number.isSafeInteger(this.semanticCandidateLimit) || this.semanticCandidateLimit <= 0) {
      throw new TypeError('semanticCandidateLimit must be a positive integer')
    }
  }

  async *[Service.init]() {
    this.database = await this.ctx.doppelgangerInstanceSqlite.open(this.namespace)
    migrateMemorySchema(this.database, { legacyPrincipalId: this.ctx.doppelgangerPersona.principalId })
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private partition(): MemoryPartition {
    const metadata = this.ctx.doppelgangerPersona
    return Object.freeze({
      instanceId: metadata.instanceId,
      principalId: metadata.principalId,
      ...(metadata.projectId === undefined ? {} : { projectId: metadata.projectId }),
    })
  }

  private scope(requested: 'relationship' | 'project' | undefined): MemoryScope {
    const projectId = this.ctx.doppelgangerPersona.projectId
    if (requested === 'relationship' || projectId === undefined) return Object.freeze({ kind: 'relationship' })
    return Object.freeze({ kind: 'project', projectId })
  }

  private visibleRecord(
    database: InstanceSqliteDatabase,
    id: string,
    statuses?: readonly MemoryStatus[],
    temporalOnly = false,
  ): MemoryRecord | undefined {
    const now = this.timestamp()
    const eligible = memoryEligibility(this.partition(), now, {
      ...(statuses === undefined ? {} : { statuses }),
      temporal: temporalOnly,
    })
    const row = database.prepare(`${RECORD_SELECT} WHERE r.id = ? AND ${eligible.sql}`)
      .get(id, ...eligible.parameters)
    return row === undefined ? undefined : recordFrom(row, now)
  }

  private requireRecord(
    database: InstanceSqliteDatabase,
    id: string,
    statuses?: readonly MemoryStatus[],
  ): MemoryRecord {
    const record = this.visibleRecord(database, requiredId('memory id', id), statuses)
    if (record === undefined) throw new MemoryError('NOT_FOUND', `memory "${id}" was not found in the active partition`)
    return record
  }

  private receipt(
    database: InstanceSqliteDatabase,
    operationId: string,
  ): OperationReceipt | undefined {
    const partition = this.partition()
    return database.prepare(`
      SELECT command_digest, result_kind, result_record_id, result_revision_id
      FROM memory_operations
      WHERE instance_id = ? AND principal_id = ? AND operation_id = ?
    `).get(partition.instanceId, partition.principalId, operationId) as OperationReceipt | undefined
  }

  private replayRecord(receipt: OperationReceipt, commandDigest: string): MemoryRecord {
    if (text(receipt.command_digest, 'operation.command_digest') !== commandDigest) {
      throw new MemoryError('IDEMPOTENCY_CONFLICT', 'operationId was already used for a different memory command')
    }
    const recordId = optionalText(receipt.result_record_id, 'operation.result_record_id')
    if (recordId === undefined) {
      throw new MemoryError('OPERATION_RESULT_DELETED', 'the original memory result was permanently deleted')
    }
    return this.requireRecord(this.database, recordId)
  }

  private insertReceipt(
    database: InstanceSqliteDatabase,
    operationId: string,
    commandKind: string,
    commandDigest: string,
    resultKind: string,
    recordId: string | undefined,
    revisionId: string | undefined,
    timestamp: string,
  ): void {
    const partition = this.partition()
    database.prepare(`
      INSERT INTO memory_operations(
        instance_id, principal_id, operation_id, command_kind, command_digest,
        result_kind, result_record_id, result_revision_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      partition.instanceId,
      partition.principalId,
      operationId,
      commandKind,
      commandDigest,
      resultKind,
      recordId ?? null,
      revisionId ?? null,
      timestamp,
    )
  }

  private insertEvidence(
    database: InstanceSqliteDatabase,
    recordId: string,
    input: Required<Pick<MemoryEvidenceInput, 'turnId' | 'role' | 'relation' | 'excerpt'>>,
    timestamp: string,
  ): MemoryEvidence {
    const evidenceId = this.id()
    const metadata = this.ctx.doppelgangerPersona
    const turnId = requiredId('memory evidence turnId', input.turnId)
    const role = validateRole(input.role)
    const relation = validateRelation(input.relation)
    const excerpt = boundedEvidence(input.excerpt)
    const insertion = database.prepare(`
      INSERT OR IGNORE INTO memory_evidence(
        id, record_id, source_session_id, source_turn_id, role, relation, excerpt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(evidenceId, recordId, metadata.sessionId, turnId, role, relation, excerpt, timestamp)
    const row = insertion.changes === 1
      ? database.prepare('SELECT * FROM memory_evidence WHERE id = ?').get(evidenceId)
      : database.prepare(`
          SELECT * FROM memory_evidence
          WHERE record_id = ? AND source_session_id = ? AND source_turn_id = ?
            AND role = ? AND relation = ? AND excerpt = ?
        `).get(recordId, metadata.sessionId, turnId, role, relation, excerpt)
    if (row === undefined) throw new Error('memory evidence insertion produced no canonical row')
    return evidenceFrom(row)
  }

  private initialEvidence(
    request: RememberMemoryRequest,
    source: 'explicit' | 'inferred',
    content: string,
  ): Required<Pick<MemoryEvidenceInput, 'turnId' | 'role' | 'relation' | 'excerpt'>> {
    return {
      turnId: request.evidence?.turnId ?? request.operationId,
      role: request.evidence?.role ?? (source === 'explicit' ? 'principal' : 'assistant'),
      relation: request.evidence?.relation ?? 'support',
      excerpt: request.evidence?.excerpt ?? content,
    }
  }

  private exactSubjectPredicate(scope: MemoryScope): { readonly sql: string; readonly parameters: readonly string[] } {
    return scope.kind === 'relationship'
      ? { sql: `r.scope_kind = 'relationship' AND r.project_id IS NULL`, parameters: [] }
      : { sql: `r.scope_kind = 'project' AND r.project_id = ?`, parameters: [scope.projectId!] }
  }

  private sameSubject(
    database: InstanceSqliteDatabase,
    kind: MemoryKind,
    key: string,
    scope: MemoryScope,
    status: MemoryStatus,
    content?: string,
  ): MemoryRecord | undefined {
    const partition = this.partition()
    const exactScope = this.exactSubjectPredicate(scope)
    const row = database.prepare(`${RECORD_SELECT}
      WHERE r.instance_id = ? AND r.principal_id = ?
        AND ${exactScope.sql} AND r.kind = ? AND r.subject_key = ? AND r.status = ?
        ${content === undefined ? '' : 'AND v.content = ?'}
      ORDER BY r.created_at, r.id
      LIMIT 1
    `).get(
      partition.instanceId,
      partition.principalId,
      ...exactScope.parameters,
      kind,
      key,
      status,
      ...(content === undefined ? [] : [content]),
    )
    return row === undefined ? undefined : recordFrom(row, this.timestamp())
  }

  remember(request: RememberMemoryRequest): MemoryRecord {
    return this.create(request, 'active', 'explicit')
  }

  propose(request: RememberMemoryRequest): MemoryRecord {
    return this.create(request, 'candidate', 'inferred')
  }

  private create(
    request: RememberMemoryRequest,
    requestedStatus: 'active' | 'candidate',
    sourceKind: 'explicit' | 'inferred',
  ): MemoryRecord {
    const operationId = requiredId('memory operationId', request.operationId)
    const content = validateContent(request.content)
    const kind = validateKind(request.kind)
    const key = subjectKey(request.subjectKey)
    const scope = this.scope(request.scope)
    const confidence = unit('memory confidence', request.confidence, sourceKind === 'explicit' ? 1 : 0.5)
    const salience = unit('memory salience', request.salience, 0.5)
    const times = temporal(request)
    const commandKind = sourceKind === 'explicit' ? 'remember' : 'propose'
    const commandDigest = digest(commandKind, { ...request, content, subjectKey: key, scope: scope.kind })
    const existingReceipt = this.receipt(this.database, operationId)
    if (existingReceipt !== undefined) return this.replayRecord(existingReceipt, commandDigest)
    return this.database.transaction((storage) => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return this.replayRecord(replay, commandDigest)
      const timestamp = this.timestamp()
      const active = this.sameSubject(storage, kind, key, scope, 'active')
      if (active !== undefined && active.revision.content === content) {
        this.insertEvidence(storage, active.id, this.initialEvidence(request, sourceKind, content), timestamp)
        this.insertReceipt(storage, operationId, commandKind, commandDigest, 'record', active.id, active.revision.id, timestamp)
        return this.requireRecord(storage, active.id)
      }
      if (sourceKind === 'explicit' && active !== undefined) {
        throw new MemoryError('SUBJECT_CONFLICT', `active memory for subject "${key}" must be changed with correct`)
      }
      let record: MemoryRecord | undefined
      if (sourceKind === 'inferred') record = this.sameSubject(storage, kind, key, scope, 'candidate', content)
      if (record === undefined) {
        const recordId = this.id()
        const revisionId = this.id()
        const status = active === undefined ? requestedStatus : 'candidate'
        const metadata = this.ctx.doppelgangerPersona
        storage.prepare(`
          INSERT INTO memory_records(
            id, instance_id, principal_id, kind, subject_key, scope_kind, project_id,
            status, pinned, confidence, salience, valid_from, valid_until, expires_at,
            current_revision_id, source_session_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          recordId,
          metadata.instanceId,
          metadata.principalId,
          kind,
          key,
          scope.kind,
          scope.projectId ?? null,
          status,
          confidence,
          salience,
          times.validFrom ?? null,
          times.validUntil ?? null,
          times.expiresAt ?? null,
          revisionId,
          metadata.sessionId,
          timestamp,
          timestamp,
        )
        storage.prepare(`
          INSERT INTO memory_revisions(
            id, record_id, ordinal, content, source_session_id, source_kind,
            supersedes_revision_id, valid_from, valid_until, expires_at, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?)
        `).run(
          revisionId,
          recordId,
          content,
          metadata.sessionId,
          sourceKind,
          times.validFrom ?? null,
          times.validUntil ?? null,
          times.expiresAt ?? null,
          timestamp,
        )
        if (status === 'active') {
          storage.prepare('INSERT INTO memory_fts(record_id, revision_id, content) VALUES (?, ?, ?)')
            .run(recordId, revisionId, content)
        }
        record = this.requireRecord(storage, recordId)
      }
      const evidence = this.insertEvidence(storage, record.id, this.initialEvidence(request, sourceKind, content), timestamp)
      if (sourceKind === 'inferred') {
        storage.prepare('INSERT OR IGNORE INTO memory_candidate_evidence(candidate_id, evidence_id) VALUES (?, ?)')
          .run(record.id, evidence.id)
      }
      if (active !== undefined && record.id !== active.id) {
        const conflictId = this.id()
        storage.prepare(`
          INSERT OR IGNORE INTO memory_conflicts(
            id, active_record_id, candidate_record_id, evidence_id, status, created_at
          ) VALUES (?, ?, ?, ?, 'unresolved', ?)
        `).run(conflictId, active.id, record.id, evidence.id, timestamp)
      }
      if (record.status === 'candidate') this.maybePromote(storage, record.id, timestamp)
      const result = this.requireRecord(storage, record.id)
      this.insertReceipt(storage, operationId, commandKind, commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  get(id: string): MemoryRecord | undefined {
    return this.visibleRecord(this.database, id)
  }

  inspect(id: string): MemoryRecord {
    return this.requireRecord(this.database, id)
  }

  evidence(id: string): readonly MemoryEvidence[] {
    const record = this.requireRecord(this.database, id)
    const rows = this.database.prepare(`
      SELECT * FROM memory_evidence WHERE record_id = ? ORDER BY created_at, id
    `).all(record.id)
    return Object.freeze(rows.map(evidenceFrom))
  }

  observe(request: ObserveMemoryRequest): MemoryRecord {
    const operationId = requiredId('memory operationId', request.operationId)
    const commandDigest = digest('observe', request)
    const existing = this.receipt(this.database, operationId)
    if (existing !== undefined) return this.replayRecord(existing, commandDigest)
    return this.database.transaction(storage => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return this.replayRecord(replay, commandDigest)
      const record = this.requireRecord(storage, request.recordId, ['active', 'candidate'])
      const timestamp = this.timestamp()
      const evidence = this.insertEvidence(storage, record.id, {
        turnId: request.turnId,
        role: request.role,
        relation: request.relation,
        excerpt: request.excerpt,
      }, timestamp)
      if (record.status === 'candidate') {
        storage.prepare('INSERT OR IGNORE INTO memory_candidate_evidence(candidate_id, evidence_id) VALUES (?, ?)')
          .run(record.id, evidence.id)
        this.maybePromote(storage, record.id, timestamp)
      }
      const result = this.requireRecord(storage, record.id)
      this.insertReceipt(storage, operationId, 'observe', commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  correct(request: CorrectMemoryRequest): MemoryRecord {
    const operationId = requiredId('memory operationId', request.operationId)
    const content = validateContent(request.content)
    const times = temporal(request)
    const commandDigest = digest('correct', { ...request, content })
    const existing = this.receipt(this.database, operationId)
    if (existing !== undefined) return this.replayRecord(existing, commandDigest)
    return this.database.transaction(storage => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return this.replayRecord(replay, commandDigest)
      const record = this.requireRecord(storage, request.id, ['active'])
      if (record.revision.id !== request.expectedRevisionId) {
        throw new MemoryError('REVISION_CONFLICT', `memory "${request.id}" changed before correction`)
      }
      const revisionId = this.id()
      const timestamp = this.timestamp()
      storage.prepare(`
        INSERT INTO memory_revisions(
          id, record_id, ordinal, content, source_session_id, source_kind,
          supersedes_revision_id, valid_from, valid_until, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'correction', ?, ?, ?, ?, ?)
      `).run(
        revisionId,
        record.id,
        record.revision.ordinal + 1,
        content,
        this.ctx.doppelgangerPersona.sessionId,
        record.revision.id,
        times.validFrom ?? record.validFrom ?? null,
        times.validUntil ?? record.validUntil ?? null,
        times.expiresAt ?? record.expiresAt ?? null,
        timestamp,
      )
      const update = storage.prepare(`
        UPDATE memory_records
        SET current_revision_id = ?, confidence = ?, salience = ?,
            valid_from = ?, valid_until = ?, expires_at = ?, updated_at = ?
        WHERE id = ? AND current_revision_id = ?
      `).run(
        revisionId,
        unit('memory confidence', request.confidence, record.confidence),
        unit('memory salience', request.salience, record.salience),
        times.validFrom ?? record.validFrom ?? null,
        times.validUntil ?? record.validUntil ?? null,
        times.expiresAt ?? record.expiresAt ?? null,
        timestamp,
        record.id,
        request.expectedRevisionId,
      )
      if (update.changes !== 1) throw new MemoryError('REVISION_CONFLICT', `memory "${request.id}" changed before correction`)
      storage.prepare('DELETE FROM memory_fts WHERE record_id = ?').run(record.id)
      storage.prepare('INSERT INTO memory_fts(record_id, revision_id, content) VALUES (?, ?, ?)')
        .run(record.id, revisionId, content)
      storage.prepare('DELETE FROM memory_embeddings WHERE record_id = ?').run(record.id)
      this.insertEvidence(storage, record.id, {
        turnId: request.evidence?.turnId ?? operationId,
        role: request.evidence?.role ?? 'principal',
        relation: request.evidence?.relation ?? 'support',
        excerpt: request.evidence?.excerpt ?? content,
      }, timestamp)
      const result = this.requireRecord(storage, record.id)
      this.insertReceipt(storage, operationId, 'correct', commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  forget(request: ForgetMemoryRequest): boolean {
    const operationId = requiredId('memory operationId', request.operationId)
    const commandDigest = digest('forget', request)
    const existing = this.receipt(this.database, operationId)
    if (existing !== undefined) {
      if (text(existing.command_digest, 'operation.command_digest') !== commandDigest) {
        throw new MemoryError('IDEMPOTENCY_CONFLICT', 'operationId was already used for a different memory command')
      }
      return text(existing.result_kind, 'operation.result_kind') === 'deleted'
    }
    return this.database.transaction(storage => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return text(replay.result_kind, 'operation.result_kind') === 'deleted'
      const record = this.requireRecord(storage, request.id)
      const timestamp = this.timestamp()
      deleteMemoryRecordRows(storage, record.id)
      this.insertReceipt(storage, operationId, 'forget', commandDigest, 'deleted', undefined, undefined, timestamp)
      return true
    })
  }

  pin(request: PinMemoryRequest): MemoryRecord {
    const operationId = requiredId('memory operationId', request.operationId)
    const commandDigest = digest(request.pinned ? 'pin' : 'unpin', request)
    const existing = this.receipt(this.database, operationId)
    if (existing !== undefined) return this.replayRecord(existing, commandDigest)
    return this.database.transaction(storage => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return this.replayRecord(replay, commandDigest)
      const record = this.requireRecord(storage, request.id, ['active'])
      const timestamp = this.timestamp()
      storage.prepare('UPDATE memory_records SET pinned = ?, updated_at = ? WHERE id = ?')
        .run(request.pinned ? 1 : 0, timestamp, record.id)
      const result = this.requireRecord(storage, record.id)
      this.insertReceipt(
        storage,
        operationId,
        request.pinned ? 'pin' : 'unpin',
        commandDigest,
        'record',
        result.id,
        result.revision.id,
        timestamp,
      )
      return result
    })
  }

  history(id: string): readonly MemoryRevision[] {
    const record = this.requireRecord(this.database, id)
    const rows = this.database.prepare(`
      SELECT id, ordinal, content, source_session_id, source_kind,
             supersedes_revision_id, valid_from, valid_until, expires_at, created_at
      FROM memory_revisions WHERE record_id = ? ORDER BY ordinal
    `).all(record.id)
    return Object.freeze(rows.map(row => {
      const validFrom = optionalText(row.valid_from, 'revision.valid_from')
      const validUntil = optionalText(row.valid_until, 'revision.valid_until')
      const expiresAt = optionalText(row.expires_at, 'revision.expires_at')
      return Object.freeze({
        id: text(row.id, 'revision.id'),
        ordinal: Number(row.ordinal),
        content: text(row.content, 'revision.content'),
        sourceSessionId: text(row.source_session_id, 'revision.source_session_id'),
        sourceKind: text(row.source_kind, 'revision.source_kind'),
        ...(optionalText(row.supersedes_revision_id, 'revision.supersedes_revision_id') === undefined
          ? {}
          : { supersedesRevisionId: text(row.supersedes_revision_id, 'revision.supersedes_revision_id') }),
        ...(validFrom === undefined ? {} : { validFrom }),
        ...(validUntil === undefined ? {} : { validUntil }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
        createdAt: text(row.created_at, 'revision.created_at'),
      })
    }))
  }

  listCandidates(): readonly MemoryRecord[] {
    const now = this.timestamp()
    const eligible = memoryEligibility(this.partition(), now, { statuses: ['candidate'] })
    const rows = this.database.prepare(`${RECORD_SELECT}
      WHERE ${eligible.sql}
      ORDER BY r.created_at, r.id
    `).all(...eligible.parameters)
    return Object.freeze(rows.map(row => recordFrom(row, now)))
  }

  approve(request: CandidateDecisionRequest): MemoryRecord {
    return this.decideCandidate(request, 'approve')
  }

  reject(request: CandidateDecisionRequest): MemoryRecord {
    return this.decideCandidate(request, 'reject')
  }

  private decideCandidate(request: CandidateDecisionRequest, decision: 'approve' | 'reject'): MemoryRecord {
    const operationId = requiredId('memory operationId', request.operationId)
    const commandDigest = digest(decision, request)
    const existing = this.receipt(this.database, operationId)
    if (existing !== undefined) return this.replayRecord(existing, commandDigest)
    return this.database.transaction(storage => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return this.replayRecord(replay, commandDigest)
      const candidate = this.requireRecord(storage, request.candidateId, ['candidate'])
      const timestamp = this.timestamp()
      if (decision === 'approve') this.promote(storage, candidate, 'manual-approval', timestamp, true)
      else storage.prepare(`UPDATE memory_records SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'candidate'`)
        .run(timestamp, candidate.id)
      const result = this.requireRecord(storage, candidate.id)
      this.insertReceipt(storage, operationId, decision, commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  corroborate(request: CandidateEvidenceRequest): MemoryRecord {
    return this.observe({
      operationId: request.operationId,
      recordId: request.candidateId,
      turnId: request.turnId,
      role: request.role ?? 'principal',
      relation: request.contradiction === true ? 'contradiction' : 'support',
      excerpt: request.content,
    })
  }

  conflicts(recordId?: string): readonly MemoryConflict[] {
    if (recordId !== undefined) this.requireRecord(this.database, recordId)
    const now = this.timestamp()
    const eligible = memoryEligibility(this.partition(), now)
    const rows = this.database.prepare(`
      SELECT c.* FROM memory_conflicts c
      JOIN memory_records r ON r.id = c.candidate_record_id
      WHERE ${eligible.sql}
        ${recordId === undefined ? '' : 'AND (c.active_record_id = ? OR c.candidate_record_id = ?)'}
      ORDER BY c.created_at, c.id
    `).all(...eligible.parameters, ...(recordId === undefined ? [] : [recordId, recordId]))
    return Object.freeze(rows.map(conflictFrom))
  }

  resolveConflict(request: ResolveMemoryConflictRequest): MemoryRecord {
    const operationId = requiredId('memory operationId', request.operationId)
    const commandDigest = digest('resolve-conflict', request)
    const existing = this.receipt(this.database, operationId)
    if (existing !== undefined) return this.replayRecord(existing, commandDigest)
    return this.database.transaction(storage => {
      const replay = this.receipt(storage, operationId)
      if (replay !== undefined) return this.replayRecord(replay, commandDigest)
      const conflictRow = storage.prepare('SELECT * FROM memory_conflicts WHERE id = ? AND status = ?')
        .get(request.conflictId, 'unresolved')
      if (conflictRow === undefined) throw new MemoryError('CONFLICT_NOT_FOUND', 'unresolved memory conflict was not found')
      const conflict = conflictFrom(conflictRow)
      const active = this.requireRecord(storage, conflict.activeRecordId, ['active'])
      const candidate = this.requireRecord(storage, conflict.candidateRecordId, ['candidate'])
      if (active.revision.id !== request.expectedRevisionId) {
        throw new MemoryError('REVISION_CONFLICT', `memory "${active.id}" changed before conflict resolution`)
      }
      const timestamp = this.timestamp()
      let resolutionRevisionId: string | undefined
      let status: MemoryConflict['status']
      if (request.resolution === 'promote-candidate') {
        resolutionRevisionId = this.id()
        storage.prepare(`
          INSERT INTO memory_revisions(
            id, record_id, ordinal, content, source_session_id, source_kind,
            supersedes_revision_id, valid_from, valid_until, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, 'conflict-resolution', ?, ?, ?, ?, ?)
        `).run(
          resolutionRevisionId,
          active.id,
          active.revision.ordinal + 1,
          candidate.revision.content,
          this.ctx.doppelgangerPersona.sessionId,
          active.revision.id,
          candidate.validFrom ?? null,
          candidate.validUntil ?? null,
          candidate.expiresAt ?? null,
          timestamp,
        )
        const update = storage.prepare(`
          UPDATE memory_records
          SET current_revision_id = ?, confidence = ?, salience = ?,
              valid_from = ?, valid_until = ?, expires_at = ?, updated_at = ?
          WHERE id = ? AND current_revision_id = ?
        `).run(
          resolutionRevisionId,
          candidate.confidence,
          candidate.salience,
          candidate.validFrom ?? null,
          candidate.validUntil ?? null,
          candidate.expiresAt ?? null,
          timestamp,
          active.id,
          request.expectedRevisionId,
        )
        if (update.changes !== 1) throw new MemoryError('REVISION_CONFLICT', `memory "${active.id}" changed before conflict resolution`)
        storage.prepare(`UPDATE memory_records SET status = 'rejected', updated_at = ? WHERE id = ?`).run(timestamp, candidate.id)
        storage.prepare('DELETE FROM memory_fts WHERE record_id = ?').run(active.id)
        storage.prepare('INSERT INTO memory_fts(record_id, revision_id, content) VALUES (?, ?, ?)')
          .run(active.id, resolutionRevisionId, candidate.revision.content)
        storage.prepare('DELETE FROM memory_embeddings WHERE record_id = ?').run(active.id)
        status = 'resolved-candidate'
      } else {
        status = request.resolution === 'keep-active' ? 'resolved-active' : 'dismissed'
        if (request.resolution === 'keep-active') {
          storage.prepare(`UPDATE memory_records SET status = 'rejected', updated_at = ? WHERE id = ?`).run(timestamp, candidate.id)
        }
      }
      storage.prepare(`
        UPDATE memory_conflicts
        SET status = ?, resolved_at = ?, resolution_revision_id = ?
        WHERE id = ? AND status = 'unresolved'
      `).run(status, timestamp, resolutionRevisionId ?? null, conflict.id)
      const result = this.requireRecord(storage, active.id)
      this.insertReceipt(storage, operationId, 'resolve-conflict', commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  private maybePromote(database: InstanceSqliteDatabase, candidateId: string, timestamp: string): void {
    const candidate = this.requireRecord(database, candidateId, ['candidate'])
    const contradiction = database.prepare(`
      SELECT 1 AS found FROM memory_evidence
      WHERE record_id = ? AND relation = 'contradiction' LIMIT 1
    `).get(candidate.id)
    const conflict = database.prepare(`
      SELECT 1 AS found FROM memory_conflicts
      WHERE candidate_record_id = ? AND status = 'unresolved' LIMIT 1
    `).get(candidate.id)
    if (contradiction !== undefined || conflict !== undefined) return
    const rolePredicate = candidate.kind === 'preference' ? `AND role = 'principal'` : ''
    const sessions = Number(database.prepare(`
      SELECT COUNT(DISTINCT source_session_id) AS count
      FROM memory_evidence
      WHERE record_id = ? AND relation = 'support' ${rolePredicate}
    `).get(candidate.id)?.count)
    if (sessions < this.automaticPromotionDistinctSessions) return
    this.promote(database, candidate, 'corroboration', timestamp, false)
  }

  private promote(
    database: InstanceSqliteDatabase,
    candidate: MemoryRecord,
    sourceKind: string,
    timestamp: string,
    manual: boolean,
  ): void {
    const unresolved = database.prepare(`
      SELECT 1 AS found
      FROM memory_conflicts c
      WHERE c.candidate_record_id = ? AND c.status = 'unresolved'
      UNION ALL
      SELECT 1 AS found
      FROM memory_evidence e
      WHERE e.record_id = ? AND e.relation = 'contradiction'
      LIMIT 1
    `).get(candidate.id, candidate.id)
    if (unresolved !== undefined) {
      if (manual) throw new MemoryError('UNRESOLVED_CONFLICT', 'candidate has unresolved contradiction evidence')
      return
    }
    const active = this.sameSubject(database, candidate.kind, candidate.subjectKey, candidate.scope, 'active')
    if (active !== undefined) {
      if (manual) throw new MemoryError('SUBJECT_CONFLICT', 'candidate conflicts with active memory and must be resolved explicitly')
      return
    }
    const result = database.prepare(`
      UPDATE memory_records SET status = 'active', updated_at = ?
      WHERE id = ? AND status = 'candidate'
    `).run(timestamp, candidate.id)
    if (result.changes !== 1) throw new MemoryError('INVALID_CANDIDATE', `candidate "${candidate.id}" is not eligible`)
    database.prepare('INSERT INTO memory_fts(record_id, revision_id, content) VALUES (?, ?, ?)')
      .run(candidate.id, candidate.revision.id, candidate.revision.content)
    database.prepare('UPDATE memory_revisions SET source_kind = ? WHERE id = ?')
      .run(sourceKind, candidate.revision.id)
  }

  async search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    const query = request.query.trim()
    if (query.length === 0) throw new MemoryError('INVALID_QUERY', 'memory search query must be non-empty')
    if (!Number.isSafeInteger(request.tokenBudget) || request.tokenBudget < 0) {
      throw new MemoryError('INVALID_BUDGET', 'memory search token budget must be a non-negative safe integer')
    }
    const limit = request.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new MemoryError('INVALID_LIMIT', 'memory search limit must be a positive safe integer')
    }
    const now = this.timestamp()
    const eligible = memoryEligibility(this.partition(), now, { statuses: ['active'], temporal: true })
    const lexicalQuery = [...query.matchAll(/[\p{L}\p{N}_-]+/gu)].map(match => `"${match[0].replaceAll('"', '""')}"`).join(' OR ')
    const lexicalRows = lexicalQuery.length === 0
      ? []
      : this.database.prepare(`${RECORD_SELECT}
          JOIN memory_fts f ON f.record_id = r.id AND f.revision_id = r.current_revision_id
          WHERE ${eligible.sql} AND memory_fts MATCH ?
          ORDER BY bm25(memory_fts), r.id
          LIMIT ?
        `).all(...eligible.parameters, lexicalQuery, this.semanticCandidateLimit)
    const candidateRows = this.database.prepare(`${RECORD_SELECT}
      WHERE ${eligible.sql}
      ORDER BY r.salience DESC, r.id
      LIMIT ?
    `).all(...eligible.parameters, this.semanticCandidateLimit)
    const snapshot = new Map(candidateRows.map(row => {
      const record = recordFrom(row, now)
      return [record.id, record] as const
    }))
    const ranks = new Map<string, { lexicalRank?: number; semanticRank?: number }>()
    lexicalRows.forEach((row, index) => {
      const record = recordFrom(row, now)
      ranks.set(record.id, { lexicalRank: index + 1 })
      if (!snapshot.has(record.id)) snapshot.set(record.id, record)
    })
    for (const record of snapshot.values()) {
      if (record.pinned && record.kind === 'preference' && record.scope.kind === 'relationship') {
        ranks.set(record.id, ranks.get(record.id) ?? {})
      }
    }
    const embedding = this.ctx.get('doppelgangerEmbedding') as MemoryEmbeddingProvider | undefined
    if (embedding !== undefined) {
      const candidates = Object.freeze([...snapshot.values()].map(record => Object.freeze({
        recordId: record.id,
        revisionId: record.revision.id,
        content: record.revision.content,
      })))
      const semantic = await embedding.rank(query, candidates)
      for (const result of semantic) {
        if (!Number.isSafeInteger(result.rank) || result.rank <= 0) continue
        const record = snapshot.get(result.recordId)
        if (record === undefined || record.revision.id !== result.revisionId) continue
        const rank = ranks.get(result.recordId) ?? {}
        if (rank.semanticRank === undefined || result.rank < rank.semanticRank) rank.semanticRank = result.rank
        ranks.set(result.recordId, rank)
      }
    }
    const revalidated = new Map<string, MemoryRecord>()
    for (const [id, original] of snapshot) {
      const current = this.visibleRecord(this.database, id, ['active'], true)
      if (current !== undefined && current.revision.id === original.revision.id) revalidated.set(id, current)
    }
    const ranked = [...ranks.entries()].flatMap(([id, components]) => {
      const record = revalidated.get(id)
      if (record === undefined) return []
      const score = (components.lexicalRank === undefined ? 0 : 1 / (RRF_K + components.lexicalRank))
        + (components.semanticRank === undefined ? 0 : 1 / (RRF_K + components.semanticRank))
      return [{ record, score, ...components }]
    }).sort((left, right) => {
      const leftPinned = left.record.pinned && left.record.kind === 'preference' && left.record.scope.kind === 'relationship' ? 1 : 0
      const rightPinned = right.record.pinned && right.record.kind === 'preference' && right.record.scope.kind === 'relationship' ? 1 : 0
      return rightPinned - leftPinned
        || right.score - left.score
        || right.record.salience - left.record.salience
        || left.record.id.localeCompare(right.record.id)
    })
    const seenSubjects = new Set<string>()
    const diverse: typeof ranked = []
    const repeated: typeof ranked = []
    for (const candidate of ranked) {
      if (seenSubjects.has(candidate.record.subjectKey)) repeated.push(candidate)
      else {
        seenSubjects.add(candidate.record.subjectKey)
        diverse.push(candidate)
      }
    }
    const selected: MemorySearchResult[] = []
    let tokens = 0
    for (const candidate of [...diverse, ...repeated]) {
      if (selected.length >= limit) break
      const candidateTokens = Math.ceil(Buffer.byteLength(candidate.record.revision.content, 'utf8') / 4)
      if (tokens + candidateTokens > request.tokenBudget) continue
      tokens += candidateTokens
      selected.push(Object.freeze({
        record: candidate.record,
        score: candidate.score,
        ...(candidate.lexicalRank === undefined ? {} : { lexicalRank: candidate.lexicalRank }),
        ...(candidate.semanticRank === undefined ? {} : { semanticRank: candidate.semanticRank }),
      }))
    }
    return Object.freeze(selected)
  }
}
