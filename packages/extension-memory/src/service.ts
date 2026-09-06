import { createHash, randomUUID } from 'node:crypto'
import { Context, Service, type Logger } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-persona'
import { containsCredentialMaterial } from '@doppelganger/doppelganger-protocols'
import type {} from '@doppelganger/doppelganger-protocols'
import type { MemoryProjectionStore } from './projection-store.ts'
import { projectMemorySemanticQuery } from './query-projection.ts'
import type {
  CandidateDecisionRequest,
  CandidateEvidenceRequest,
  CorrectMemoryRequest,
  ForgetMemoryRequest,
  MemoryApi,
  MemoryConflict,
  MemoryEvidence,
  MemoryEvidenceInput,
  MemoryEvidenceRelation,
  MemoryKind,
  MemoryOperationReceipt,
  MemoryPartition,
  MemoryRecord,
  MemoryRepository,
  MemoryRepositoryReader,
  MemoryRevision,
  MemoryRole,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStatus,
  MemoryTemporalInput,
  MemoryUnitOfWork,
  ObserveMemoryRequest,
  PinMemoryRequest,
  RememberMemoryRequest,
  ResolveMemoryConflictRequest,
} from './repository.ts'
import type {
  MemorySemanticFailureCode,
  MemorySemanticHit,
  MemorySemanticRetriever,
  MemoryVectorFailure,
} from './semantic.ts'


export interface MemoryServiceConfig {
  readonly now?: () => Date
  readonly id?: () => string
  readonly automaticPromotionDistinctSessions?: number
  readonly lexicalTopK?: number
  readonly semanticTopK?: number
  readonly semanticQueryMaximumCharacters?: number
  readonly semanticTimeoutMs?: number
}

export class MemoryError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'MemoryError'
  }
}

const SUBJECT_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MAX_CONTENT_LENGTH = 16_000
const MAX_EVIDENCE_LENGTH = 1_000
const RRF_K = 60
const STABLE_PROFILE_LIMIT = 20

function text(value: string, field: string): string {
  value = value.trim()
  if (value.length === 0 || value.length > 200) throw new MemoryError('INVALID_ID', `${field} must be 1-200 characters`)
  return value
}

function validateContent(content: string, field = 'memory content'): string {
  content = content.trim()
  if (content.length === 0) throw new MemoryError('INVALID_CONTENT', `${field} must be non-empty`)
  if (content.length > MAX_CONTENT_LENGTH) throw new MemoryError('CONTENT_TOO_LARGE', `${field} exceeds ${MAX_CONTENT_LENGTH} characters`)
  if (containsCredentialMaterial(content)) {
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

function temporalFields(
  validFrom: string | undefined,
  validUntil: string | undefined,
  expiresAt: string | undefined,
): MemoryTemporalInput {
  return Object.freeze({
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  })
}

function temporal(input: MemoryTemporalInput): MemoryTemporalInput {
  const validFrom = iso('validFrom', input.validFrom)
  const validUntil = iso('validUntil', input.validUntil)
  const expiresAt = iso('expiresAt', input.expiresAt)
  if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
    throw new MemoryError('INVALID_TIME_RANGE', 'validUntil must be later than validFrom')
  }
  return temporalFields(validFrom, validUntil, expiresAt)
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerMemory: MemoryApi
    doppelgangerMemoryRepository: MemoryRepository
  }
}

export class MemoryService extends Service implements MemoryApi {
  static inject = ['doppelgangerMemoryRepository', 'doppelgangerPersona', 'doppelgangerActor']

  private readonly logger: Logger
  private readonly now: () => Date
  private readonly id: () => string
  private readonly automaticPromotionDistinctSessions: number
  private readonly lexicalTopK: number
  private readonly semanticTopK: number
  private readonly semanticQueryMaximumCharacters: number
  private readonly semanticTimeoutMs: number
  private repository!: MemoryRepository
  private lastSemanticFailure: MemoryVectorFailure | undefined

  get projectionStore(): MemoryProjectionStore {
    if (this.repository === undefined) throw new Error('memory service is not initialized')
    return this.repository.projectionStore
  }

  constructor(ctx: Context, config: MemoryServiceConfig = {}) {
    super(ctx, 'doppelgangerMemory')
    this.logger = ctx.logger('doppelganger-memory')
    this.now = config.now ?? (() => new Date())
    this.id = config.id ?? randomUUID
    this.automaticPromotionDistinctSessions = config.automaticPromotionDistinctSessions ?? 2
    this.lexicalTopK = config.lexicalTopK ?? 40
    this.semanticTopK = config.semanticTopK ?? 40
    this.semanticQueryMaximumCharacters = config.semanticQueryMaximumCharacters ?? 512
    this.semanticTimeoutMs = config.semanticTimeoutMs ?? 1_500
    if (!Number.isSafeInteger(this.automaticPromotionDistinctSessions) || this.automaticPromotionDistinctSessions < 2) {
      throw new TypeError('automaticPromotionDistinctSessions must be an integer of at least 2')
    }
    for (const [name, value] of [
      ['lexicalTopK', this.lexicalTopK],
      ['semanticTopK', this.semanticTopK],
      ['semanticQueryMaximumCharacters', this.semanticQueryMaximumCharacters],
      ['semanticTimeoutMs', this.semanticTimeoutMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`)
    }
  }

  async *[Service.init]() {
    this.logger.info('component.activation.started')
    try {
      if (this.ctx.doppelgangerActor.state !== 'bound') throw new Error('memory requires a bound host actor')
      this.repository = this.ctx.doppelgangerMemoryRepository
      this.logger.info('component.active')
    } catch (error) {
      this.logger.error('component.activation.failed reason=%s', error instanceof MemoryError ? error.code : error instanceof Error ? error.name : typeof error)
      throw error
    }
  }

  private async mutate<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    this.logger.debug('memory.mutation.started operation=%s', operation)
    try {
      const result = await callback()
      this.logger.info('memory.mutation.completed operation=%s', operation)
      return result
    } catch (error) {
      this.logger.warn('memory.mutation.rejected operation=%s code=%s', operation, error instanceof MemoryError ? error.code : 'MEMORY_OPERATION_FAILED')
      throw error
    }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private partition(): MemoryPartition {
    const metadata = this.ctx.doppelgangerPersona
    const actor = this.ctx.doppelgangerActor
    if (actor.state !== 'bound') throw new Error('memory requires a bound host actor')
    return Object.freeze({
      instanceId: metadata.instanceId,
      actorId: actor.actorId,
      ...(metadata.projectId === undefined ? {} : { projectId: metadata.projectId }),
    })
  }

  private scope(requested: 'relationship' | 'project' | undefined): MemoryScope {
    const projectId = this.ctx.doppelgangerPersona.projectId
    if (requested === 'relationship' || projectId === undefined) return Object.freeze({ kind: 'relationship' })
    return Object.freeze({ kind: 'project', projectId })
  }

  private async requireRecord(
    reader: MemoryRepositoryReader,
    partition: MemoryPartition,
    id: string,
    now: string,
    statuses?: readonly MemoryStatus[],
  ): Promise<MemoryRecord> {
    const recordId = text(id, 'memory id')
    const record = await reader.getRecord(partition, recordId, now, statuses === undefined ? {} : { statuses })
    if (record === undefined) throw new MemoryError('NOT_FOUND', `memory "${id}" was not found in the active partition`)
    return record
  }

  private async replayRecord(
    reader: MemoryRepositoryReader,
    partition: MemoryPartition,
    receipt: MemoryOperationReceipt,
    commandDigest: string,
    now: string,
  ): Promise<MemoryRecord> {
    if (receipt.commandDigest !== commandDigest) {
      throw new MemoryError('IDEMPOTENCY_CONFLICT', 'operationId was already used for a different memory command')
    }
    if (receipt.resultRecordId === undefined) {
      throw new MemoryError('OPERATION_RESULT_DELETED', 'the original memory result was permanently deleted')
    }
    return this.requireRecord(reader, partition, receipt.resultRecordId, now)
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

  private async insertEvidence(
    unitOfWork: MemoryUnitOfWork,
    recordId: string,
    input: Required<Pick<MemoryEvidenceInput, 'turnId' | 'role' | 'relation' | 'excerpt'>>,
    timestamp: string,
  ): Promise<MemoryEvidence> {
    return unitOfWork.insertEvidence({
      id: this.id(),
      recordId,
      sourceSessionId: this.ctx.doppelgangerPersona.sessionId,
      sourceTurnId: text(input.turnId, 'memory evidence turnId'),
      role: validateRole(input.role),
      relation: validateRelation(input.relation),
      excerpt: boundedEvidence(input.excerpt),
      createdAt: timestamp,
    })
  }

  remember(request: RememberMemoryRequest): Promise<MemoryRecord> {
    return this.mutate('remember', () => this.create(request, 'active', 'explicit'))
  }

  propose(request: RememberMemoryRequest): Promise<MemoryRecord> {
    return this.mutate('propose', () => this.create(request, 'candidate', 'inferred'))
  }

  private async create(
    request: RememberMemoryRequest,
    requestedStatus: 'active' | 'candidate',
    sourceKind: 'explicit' | 'inferred',
  ): Promise<MemoryRecord> {
    const operationId = text(request.operationId, 'memory operationId')
    const content = validateContent(request.content)
    const kind = validateKind(request.kind)
    const key = subjectKey(request.subjectKey)
    const scope = this.scope(request.scope)
    const confidence = unit('memory confidence', request.confidence, sourceKind === 'explicit' ? 1 : 0.5)
    const salience = unit('memory salience', request.salience, 0.5)
    const times = temporal(request)
    const commandKind = sourceKind === 'explicit' ? 'remember' : 'propose'
    const commandDigest = digest(commandKind, { ...request, content, subjectKey: key, scope: scope.kind })
    const partition = this.partition()
    return this.repository.transaction(partition, async unitOfWork => {
      const timestamp = this.timestamp()
      const replay = await unitOfWork.getReceipt(partition, operationId)
      if (replay !== undefined) return this.replayRecord(unitOfWork, partition, replay, commandDigest, timestamp)
      const active = await unitOfWork.findSubject(partition, { kind, subjectKey: key, scope, status: 'active' }, timestamp)
      if (active !== undefined && active.revision.content === content) {
        await this.insertEvidence(unitOfWork, active.id, this.initialEvidence(request, sourceKind, content), timestamp)
        await unitOfWork.insertReceipt(partition, operationId, commandKind, commandDigest, 'record', active.id, active.revision.id, timestamp)
        return this.requireRecord(unitOfWork, partition, active.id, timestamp)
      }
      if (sourceKind === 'explicit' && active !== undefined) {
        throw new MemoryError('SUBJECT_CONFLICT', `active memory for subject "${key}" must be changed with correct`)
      }
      let record: MemoryRecord | undefined
      if (sourceKind === 'inferred') {
        record = await unitOfWork.findSubject(partition, { kind, subjectKey: key, scope, status: 'candidate', content }, timestamp)
      }
      if (record === undefined) {
        const recordId = this.id()
        const revisionId = this.id()
        const status = active === undefined ? requestedStatus : 'candidate'
        const sessionId = this.ctx.doppelgangerPersona.sessionId
        await unitOfWork.insertRecord({
          id: recordId,
          partition,
          kind,
          subjectKey: key,
          scope,
          status,
          pinned: false,
          confidence,
          salience,
          ...times,
          currentRevisionId: revisionId,
          sourceSessionId: sessionId,
          timestamp,
        })
        await unitOfWork.insertRevision({
          id: revisionId,
          recordId,
          ordinal: 1,
          content,
          sourceSessionId: sessionId,
          sourceKind,
          ...times,
          createdAt: timestamp,
        })
        if (status === 'active') {
          await unitOfWork.replaceLexicalEntry(recordId, revisionId, content)
          await unitOfWork.enqueueActiveProjection(partition.instanceId, recordId, revisionId, timestamp)
        }
        record = await this.requireRecord(unitOfWork, partition, recordId, timestamp)
      }
      const evidence = await this.insertEvidence(unitOfWork, record.id, this.initialEvidence(request, sourceKind, content), timestamp)
      if (sourceKind === 'inferred') await unitOfWork.linkCandidateEvidence(record.id, evidence.id)
      if (active !== undefined && record.id !== active.id) {
        await unitOfWork.insertConflict({
          id: this.id(),
          activeRecordId: active.id,
          candidateRecordId: record.id,
          evidenceId: evidence.id,
          createdAt: timestamp,
        })
      }
      if (record.status === 'candidate') await this.maybePromote(unitOfWork, partition, record.id, timestamp)
      const result = await this.requireRecord(unitOfWork, partition, record.id, timestamp)
      await unitOfWork.insertReceipt(partition, operationId, commandKind, commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  get(id: string): Promise<MemoryRecord | undefined> {
    return this.repository.getRecord(this.partition(), id, this.timestamp())
  }

  inspect(id: string): Promise<MemoryRecord> {
    const partition = this.partition()
    return this.requireRecord(this.repository, partition, id, this.timestamp())
  }

  async evidence(id: string): Promise<readonly MemoryEvidence[]> {
    const partition = this.partition()
    const timestamp = this.timestamp()
    const record = await this.requireRecord(this.repository, partition, id, timestamp)
    return this.repository.listEvidence(partition, record.id, timestamp)
  }

  observe(request: ObserveMemoryRequest): Promise<MemoryRecord> {
    return this.mutate('observe', async () => {
      const operationId = text(request.operationId, 'memory operationId')
      const commandDigest = digest('observe', request)
      const partition = this.partition()
      return this.repository.transaction(partition, async unitOfWork => {
        const timestamp = this.timestamp()
        const replay = await unitOfWork.getReceipt(partition, operationId)
        if (replay !== undefined) return this.replayRecord(unitOfWork, partition, replay, commandDigest, timestamp)
        const record = await this.requireRecord(unitOfWork, partition, request.recordId, timestamp, ['active', 'candidate'])
        const evidence = await this.insertEvidence(unitOfWork, record.id, {
          turnId: request.turnId,
          role: request.role,
          relation: request.relation,
          excerpt: request.excerpt,
        }, timestamp)
        if (record.status === 'candidate') {
          await unitOfWork.linkCandidateEvidence(record.id, evidence.id)
          await this.maybePromote(unitOfWork, partition, record.id, timestamp)
        }
        const result = await this.requireRecord(unitOfWork, partition, record.id, timestamp)
        await unitOfWork.insertReceipt(partition, operationId, 'observe', commandDigest, 'record', result.id, result.revision.id, timestamp)
        return result
      })
    })
  }

  correct(request: CorrectMemoryRequest): Promise<MemoryRecord> {
    return this.mutate('correct', async () => {
      const operationId = text(request.operationId, 'memory operationId')
      const content = validateContent(request.content)
      const times = temporal(request)
      const commandDigest = digest('correct', { ...request, content })
      const partition = this.partition()
      return this.repository.transaction(partition, async unitOfWork => {
        const timestamp = this.timestamp()
        const replay = await unitOfWork.getReceipt(partition, operationId)
        if (replay !== undefined) return this.replayRecord(unitOfWork, partition, replay, commandDigest, timestamp)
        const record = await this.requireRecord(unitOfWork, partition, request.id, timestamp, ['active'])
        if (record.revision.id !== request.expectedRevisionId) {
          throw new MemoryError('REVISION_CONFLICT', `memory "${request.id}" changed before correction`)
        }
        const revisionId = this.id()
        const resolvedTimes = temporalFields(
          times.validFrom ?? record.validFrom,
          times.validUntil ?? record.validUntil,
          times.expiresAt ?? record.expiresAt,
        )
        await unitOfWork.insertRevision({
          id: revisionId,
          recordId: record.id,
          ordinal: record.revision.ordinal + 1,
          content,
          sourceSessionId: this.ctx.doppelgangerPersona.sessionId,
          sourceKind: 'correction',
          supersedesRevisionId: record.revision.id,
          ...resolvedTimes,
          createdAt: timestamp,
        })
        const updated = await unitOfWork.updateCurrentRevision({
          recordId: record.id,
          expectedRevisionId: request.expectedRevisionId,
          revisionId,
          confidence: unit('memory confidence', request.confidence, record.confidence),
          salience: unit('memory salience', request.salience, record.salience),
          ...resolvedTimes,
          timestamp,
        })
        if (!updated) throw new MemoryError('REVISION_CONFLICT', `memory "${request.id}" changed before correction`)
        await unitOfWork.replaceLexicalEntry(record.id, revisionId, content)
        await unitOfWork.enqueueRevisionReplacement(record.instanceId, record.id, record.revision.id, revisionId, timestamp)
        await this.insertEvidence(unitOfWork, record.id, {
          turnId: request.evidence?.turnId ?? operationId,
          role: request.evidence?.role ?? 'principal',
          relation: request.evidence?.relation ?? 'support',
          excerpt: request.evidence?.excerpt ?? content,
        }, timestamp)
        const result = await this.requireRecord(unitOfWork, partition, record.id, timestamp)
        await unitOfWork.insertReceipt(partition, operationId, 'correct', commandDigest, 'record', result.id, result.revision.id, timestamp)
        return result
      })
    })
  }

  forget(request: ForgetMemoryRequest): Promise<boolean> {
    return this.mutate('forget', async () => {
      const operationId = text(request.operationId, 'memory operationId')
      const commandDigest = digest('forget', request)
      const partition = this.partition()
      return this.repository.transaction(partition, async unitOfWork => {
        const replay = await unitOfWork.getReceipt(partition, operationId)
        if (replay !== undefined) {
          if (replay.commandDigest !== commandDigest) {
            throw new MemoryError('IDEMPOTENCY_CONFLICT', 'operationId was already used for a different memory command')
          }
          return replay.resultKind === 'deleted'
        }
        const timestamp = this.timestamp()
        const record = await this.requireRecord(unitOfWork, partition, request.id, timestamp)
        await unitOfWork.enqueueKnownProjectionDeletions(record.id, timestamp)
        await unitOfWork.deleteRecord(record.id)
        await unitOfWork.insertReceipt(partition, operationId, 'forget', commandDigest, 'deleted', undefined, undefined, timestamp)
        return true
      })
    })
  }

  pin(request: PinMemoryRequest): Promise<MemoryRecord> {
    return this.mutate(request.pinned ? 'pin' : 'unpin', async () => {
      const operationId = text(request.operationId, 'memory operationId')
      const commandKind = request.pinned ? 'pin' : 'unpin'
      const commandDigest = digest(commandKind, request)
      const partition = this.partition()
      return this.repository.transaction(partition, async unitOfWork => {
        const timestamp = this.timestamp()
        const replay = await unitOfWork.getReceipt(partition, operationId)
        if (replay !== undefined) return this.replayRecord(unitOfWork, partition, replay, commandDigest, timestamp)
        const record = await this.requireRecord(unitOfWork, partition, request.id, timestamp, ['active'])
        await unitOfWork.setPinned(record.id, request.pinned, timestamp)
        const result = await this.requireRecord(unitOfWork, partition, record.id, timestamp)
        await unitOfWork.insertReceipt(partition, operationId, commandKind, commandDigest, 'record', result.id, result.revision.id, timestamp)
        return result
      })
    })
  }

  async history(id: string): Promise<readonly MemoryRevision[]> {
    const partition = this.partition()
    const timestamp = this.timestamp()
    const record = await this.requireRecord(this.repository, partition, id, timestamp)
    return this.repository.listRevisions(partition, record.id, timestamp)
  }

  listCandidates(): Promise<readonly MemoryRecord[]> {
    return this.repository.listCandidates(this.partition(), this.timestamp())
  }

  approve(request: CandidateDecisionRequest): Promise<MemoryRecord> {
    return this.mutate('approve-candidate', () => this.decideCandidate(request, 'approve'))
  }

  reject(request: CandidateDecisionRequest): Promise<MemoryRecord> {
    return this.mutate('reject-candidate', () => this.decideCandidate(request, 'reject'))
  }

  private async decideCandidate(request: CandidateDecisionRequest, decision: 'approve' | 'reject'): Promise<MemoryRecord> {
    const operationId = text(request.operationId, 'memory operationId')
    const commandDigest = digest(decision, request)
    const partition = this.partition()
    return this.repository.transaction(partition, async unitOfWork => {
      const timestamp = this.timestamp()
      const replay = await unitOfWork.getReceipt(partition, operationId)
      if (replay !== undefined) return this.replayRecord(unitOfWork, partition, replay, commandDigest, timestamp)
      const candidate = await this.requireRecord(unitOfWork, partition, request.candidateId, timestamp, ['candidate'])
      if (decision === 'approve') await this.promote(unitOfWork, partition, candidate, 'manual-approval', timestamp, true)
      else {
        await unitOfWork.transitionStatus(candidate.id, 'candidate', 'rejected', timestamp)
        await unitOfWork.enqueueKnownProjectionDeletions(candidate.id, timestamp)
      }
      const result = await this.requireRecord(unitOfWork, partition, candidate.id, timestamp)
      await unitOfWork.insertReceipt(partition, operationId, decision, commandDigest, 'record', result.id, result.revision.id, timestamp)
      return result
    })
  }

  corroborate(request: CandidateEvidenceRequest): Promise<MemoryRecord> {
    return this.observe({
      operationId: request.operationId,
      recordId: request.candidateId,
      turnId: request.turnId,
      role: request.role ?? 'principal',
      relation: request.contradiction === true ? 'contradiction' : 'support',
      excerpt: request.content,
    })
  }

  async conflicts(recordId?: string): Promise<readonly MemoryConflict[]> {
    const partition = this.partition()
    const timestamp = this.timestamp()
    if (recordId !== undefined) await this.requireRecord(this.repository, partition, recordId, timestamp)
    return this.repository.listConflicts(partition, recordId)
  }

  resolveConflict(request: ResolveMemoryConflictRequest): Promise<MemoryRecord> {
    return this.mutate('resolve-conflict', async () => {
      const operationId = text(request.operationId, 'memory operationId')
      const commandDigest = digest('resolve-conflict', request)
      const partition = this.partition()
      return this.repository.transaction(partition, async unitOfWork => {
        const timestamp = this.timestamp()
        const replay = await unitOfWork.getReceipt(partition, operationId)
        if (replay !== undefined) return this.replayRecord(unitOfWork, partition, replay, commandDigest, timestamp)
        const conflict = await unitOfWork.getUnresolvedConflict(partition, request.conflictId, timestamp)
        if (conflict === undefined) throw new MemoryError('CONFLICT_NOT_FOUND', 'unresolved memory conflict was not found')
        const active = await this.requireRecord(unitOfWork, partition, conflict.activeRecordId, timestamp, ['active'])
        const candidate = await this.requireRecord(unitOfWork, partition, conflict.candidateRecordId, timestamp, ['candidate'])
        if (active.revision.id !== request.expectedRevisionId) {
          throw new MemoryError('REVISION_CONFLICT', `memory "${active.id}" changed before conflict resolution`)
        }
        let resolutionRevisionId: string | undefined
        let status: MemoryConflict['status']
        if (request.resolution === 'promote-candidate') {
          resolutionRevisionId = this.id()
          const candidateTimes = temporalFields(candidate.validFrom, candidate.validUntil, candidate.expiresAt)
          await unitOfWork.insertRevision({
            id: resolutionRevisionId,
            recordId: active.id,
            ordinal: active.revision.ordinal + 1,
            content: candidate.revision.content,
            sourceSessionId: this.ctx.doppelgangerPersona.sessionId,
            sourceKind: 'conflict-resolution',
            supersedesRevisionId: active.revision.id,
            ...candidateTimes,
            createdAt: timestamp,
          })
          const updated = await unitOfWork.updateCurrentRevision({
            recordId: active.id,
            expectedRevisionId: request.expectedRevisionId,
            revisionId: resolutionRevisionId,
            confidence: candidate.confidence,
            salience: candidate.salience,
            ...candidateTimes,
            timestamp,
          })
          if (!updated) throw new MemoryError('REVISION_CONFLICT', `memory "${active.id}" changed before conflict resolution`)
          await unitOfWork.transitionStatus(candidate.id, 'candidate', 'rejected', timestamp)
          await unitOfWork.replaceLexicalEntry(active.id, resolutionRevisionId, candidate.revision.content)
          await unitOfWork.enqueueRevisionReplacement(active.instanceId, active.id, active.revision.id, resolutionRevisionId, timestamp)
          await unitOfWork.enqueueKnownProjectionDeletions(candidate.id, timestamp)
          status = 'resolved-candidate'
        } else {
          status = request.resolution === 'keep-active' ? 'resolved-active' : 'dismissed'
          if (request.resolution === 'keep-active') {
            await unitOfWork.transitionStatus(candidate.id, 'candidate', 'rejected', timestamp)
            await unitOfWork.enqueueKnownProjectionDeletions(candidate.id, timestamp)
          }
        }
        await unitOfWork.resolveConflict(conflict.id, status, timestamp, resolutionRevisionId)
        const result = await this.requireRecord(unitOfWork, partition, active.id, timestamp)
        await unitOfWork.insertReceipt(partition, operationId, 'resolve-conflict', commandDigest, 'record', result.id, result.revision.id, timestamp)
        return result
      })
    })
  }

  private async maybePromote(
    unitOfWork: MemoryUnitOfWork,
    partition: MemoryPartition,
    candidateId: string,
    timestamp: string,
  ): Promise<void> {
    const candidate = await this.requireRecord(unitOfWork, partition, candidateId, timestamp, ['candidate'])
    const evidence = await unitOfWork.promotionEvidence(candidate.id, candidate.kind === 'preference')
    if (evidence.contradiction || evidence.unresolvedConflict) return
    if (evidence.distinctSupportingSessions < this.automaticPromotionDistinctSessions) return
    await this.promote(unitOfWork, partition, candidate, 'corroboration', timestamp, false)
  }

  private async promote(
    unitOfWork: MemoryUnitOfWork,
    partition: MemoryPartition,
    candidate: MemoryRecord,
    sourceKind: string,
    timestamp: string,
    manual: boolean,
  ): Promise<void> {
    const evidence = await unitOfWork.promotionEvidence(candidate.id, false)
    if (evidence.contradiction || evidence.unresolvedConflict) {
      if (manual) throw new MemoryError('UNRESOLVED_CONFLICT', 'candidate has unresolved contradiction evidence')
      return
    }
    const active = await unitOfWork.findSubject(partition, {
      kind: candidate.kind,
      subjectKey: candidate.subjectKey,
      scope: candidate.scope,
      status: 'active',
    }, timestamp)
    if (active !== undefined) {
      if (manual) throw new MemoryError('SUBJECT_CONFLICT', 'candidate conflicts with active memory and must be resolved explicitly')
      return
    }
    if (!await unitOfWork.transitionStatus(candidate.id, 'candidate', 'active', timestamp)) {
      throw new MemoryError('INVALID_CANDIDATE', `candidate "${candidate.id}" is not eligible`)
    }
    await unitOfWork.replaceLexicalEntry(candidate.id, candidate.revision.id, candidate.revision.content)
    await unitOfWork.enqueueActiveProjection(candidate.instanceId, candidate.id, candidate.revision.id, timestamp)
    await unitOfWork.updateRevisionSourceKind(candidate.revision.id, sourceKind)
  }

  semanticFailure(): MemoryVectorFailure | undefined {
    return this.lastSemanticFailure
  }

  private recordSemanticFailure(error: unknown): void {
    const candidate = typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined
    const code: MemorySemanticFailureCode = [
      'backend', 'dimension', 'embedder', 'health', 'identity', 'malformed-hit', 'timeout',
    ].includes(String(candidate)) ? candidate as MemorySemanticFailureCode : 'backend'
    this.lastSemanticFailure = Object.freeze({
      code,
      occurredAt: this.timestamp(),
      message: `semantic retrieval ${code} failure`,
    })
    this.logger.warn('memory.search.semantic.failed code=%s', code)
  }

  private validSemanticHit(value: unknown, generationId: string): MemorySemanticHit | undefined {
    if (typeof value !== 'object' || value === null
      || !('generationId' in value) || value.generationId !== generationId
      || !('recordId' in value) || typeof value.recordId !== 'string' || value.recordId.length === 0
      || !('revisionId' in value) || typeof value.revisionId !== 'string' || value.revisionId.length === 0
      || !('rank' in value) || typeof value.rank !== 'number' || !Number.isSafeInteger(value.rank) || value.rank <= 0) return undefined
    return Object.freeze({
      generationId,
      recordId: value.recordId,
      revisionId: value.revisionId,
      rank: value.rank,
    })
  }

  stableProfile(): Promise<readonly MemoryRecord[]> {
    return this.repository.stableProfile(this.partition(), this.timestamp(), STABLE_PROFILE_LIMIT)
  }

  async automaticRecall(query: string, tokenBudget: number): Promise<readonly MemoryRecord[]> {
    if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 0) {
      throw new MemoryError('INVALID_BUDGET', 'memory recall token budget must be a non-negative safe integer')
    }
    if (tokenBudget === 0) return Object.freeze([])
    const stable = await this.stableProfile()
    const ranked = query.trim().length === 0 ? [] : await this.search({ query, tokenBudget })
    const partition = this.partition()
    const orderedIds = [...stable.map(record => record.id), ...ranked.map(result => result.record.id)]
    const snapshot = await this.repository.readCanonicalSnapshot(partition, orderedIds, this.timestamp())
    const records = new Map(snapshot.records.map(record => [record.id, record]))
    const selected: MemoryRecord[] = []
    const seen = new Set<string>()
    let tokens = 0
    for (const id of orderedIds) {
      if (seen.has(id)) continue
      seen.add(id)
      const current = records.get(id)
      if (current === undefined) continue
      const candidateTokens = Math.ceil(Buffer.byteLength(current.revision.content, 'utf8') / 4)
      if (tokens + candidateTokens > tokenBudget) continue
      tokens += candidateTokens
      selected.push(current)
    }
    return Object.freeze(selected)
  }

  async search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    const semantic = this.ctx.get('doppelgangerMemorySemantic') as MemorySemanticRetriever | undefined
    this.logger.debug('memory.search.started semantic=%s', semantic === undefined ? 'absent' : 'available')
    const query = request.query.trim()
    if (query.length === 0) throw new MemoryError('INVALID_QUERY', 'memory search query must be non-empty')
    if (!Number.isSafeInteger(request.tokenBudget) || request.tokenBudget < 0) {
      throw new MemoryError('INVALID_BUDGET', 'memory search token budget must be a non-negative safe integer')
    }
    const limit = request.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new MemoryError('INVALID_LIMIT', 'memory search limit must be a positive safe integer')
    }

    const partition = this.partition()
    const initialTimestamp = this.timestamp()
    const [lexical, generationId] = await Promise.all([
      this.repository.lexicalCandidates(partition, query, initialTimestamp, this.lexicalTopK),
      this.repository.activeGeneration(partition.instanceId),
    ])
    const ranks = new Map<string, { lexicalRank?: number; semanticRank?: number }>()
    const expectedRevisions = new Map<string, string>()
    lexical.forEach((candidate, index) => {
      ranks.set(candidate.recordId, { lexicalRank: index + 1 })
      expectedRevisions.set(candidate.recordId, candidate.revisionId)
    })

    const semanticHits: MemorySemanticHit[] = []
    if (semantic !== undefined && generationId !== undefined) {
      const projection = projectMemorySemanticQuery(query, this.semanticQueryMaximumCharacters)
      let timeout: NodeJS.Timeout | undefined
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(Object.assign(new Error('semantic retrieval timed out'), { code: 'timeout' })), this.semanticTimeoutMs)
        })
        const response = await Promise.race([
          semantic.search(Object.freeze({
            query: projection.query,
            instanceId: partition.instanceId,
            actorId: partition.actorId,
            ...(partition.projectId === undefined ? {} : { projectId: partition.projectId }),
            limit: this.semanticTopK,
          })),
          deadline,
        ])
        if (!Array.isArray(response)) {
          throw Object.assign(new Error('semantic retrieval returned a malformed response'), { code: 'malformed-hit' })
        }
        for (const value of response) {
          const hit = this.validSemanticHit(value, generationId)
          if (hit === undefined) {
            throw Object.assign(new Error('semantic retrieval returned a malformed hit'), { code: 'malformed-hit' })
          }
          semanticHits.push(hit)
        }
        this.lastSemanticFailure = undefined
      } catch (error) {
        semanticHits.length = 0
        this.recordSemanticFailure(error)
      } finally {
        clearTimeout(timeout)
      }
    }

    const allIds = [...new Set([...lexical.map(candidate => candidate.recordId), ...semanticHits.map(hit => hit.recordId)])]
    const snapshot = await this.repository.readCanonicalSnapshot(partition, allIds, this.timestamp())
    const current = new Map(snapshot.records.map(record => [record.id, record]))
    if (generationId !== undefined && snapshot.activeGenerationId === generationId) {
      for (const hit of semanticHits) {
        const record = current.get(hit.recordId)
        if (record === undefined || record.revision.id !== hit.revisionId) continue
        const components = ranks.get(hit.recordId) ?? {}
        if (components.semanticRank === undefined || hit.rank < components.semanticRank) components.semanticRank = hit.rank
        ranks.set(hit.recordId, components)
        expectedRevisions.set(hit.recordId, hit.revisionId)
      }
    }

    const ranked = [...ranks.entries()].flatMap(([id, components]) => {
      const record = current.get(id)
      const expectedRevisionId = expectedRevisions.get(id)
      if (record === undefined || expectedRevisionId === undefined || record.revision.id !== expectedRevisionId) return []
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
    const result = Object.freeze(selected)
    this.logger.debug('memory.search.completed results=%d semanticFailure=%s', result.length, this.lastSemanticFailure?.code ?? 'none')
    return result
  }
}
