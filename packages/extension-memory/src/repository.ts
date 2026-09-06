import type { MemoryProjectionStore } from './projection-store.ts'
import type { MemoryVectorFailure } from './semantic.ts'

export type MemoryKind = 'decision' | 'fact' | 'preference' | 'procedure'
export type MemoryStatus = 'active' | 'candidate' | 'rejected'
export type MemoryRole = 'principal' | 'assistant' | 'tool' | 'system'
export type MemoryEvidenceRelation = 'support' | 'contradiction'

export interface MemoryPartition {
  readonly instanceId: string
  readonly actorId: string
  readonly projectId?: string
}

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
  readonly actorId: string
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

export interface MemoryApi {
  readonly projectionStore: MemoryProjectionStore
  remember(request: RememberMemoryRequest): Promise<MemoryRecord>
  propose(request: RememberMemoryRequest): Promise<MemoryRecord>
  get(id: string): Promise<MemoryRecord | undefined>
  inspect(id: string): Promise<MemoryRecord>
  evidence(id: string): Promise<readonly MemoryEvidence[]>
  observe(request: ObserveMemoryRequest): Promise<MemoryRecord>
  correct(request: CorrectMemoryRequest): Promise<MemoryRecord>
  forget(request: ForgetMemoryRequest): Promise<boolean>
  pin(request: PinMemoryRequest): Promise<MemoryRecord>
  history(id: string): Promise<readonly MemoryRevision[]>
  listCandidates(): Promise<readonly MemoryRecord[]>
  approve(request: CandidateDecisionRequest): Promise<MemoryRecord>
  reject(request: CandidateDecisionRequest): Promise<MemoryRecord>
  corroborate(request: CandidateEvidenceRequest): Promise<MemoryRecord>
  conflicts(recordId?: string): Promise<readonly MemoryConflict[]>
  resolveConflict(request: ResolveMemoryConflictRequest): Promise<MemoryRecord>
  stableProfile(): Promise<readonly MemoryRecord[]>
  automaticRecall(query: string, tokenBudget: number): Promise<readonly MemoryRecord[]>
  search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]>
  semanticFailure(): MemoryVectorFailure | undefined
}

export interface MemoryReadOptions {
  readonly statuses?: readonly MemoryStatus[]
  readonly temporal?: boolean
}

export interface MemorySubjectQuery {
  readonly kind: MemoryKind
  readonly subjectKey: string
  readonly scope: MemoryScope
  readonly status: MemoryStatus
  readonly content?: string
}

export interface MemoryOperationReceipt {
  readonly commandDigest: string
  readonly resultKind: string
  readonly resultRecordId?: string
  readonly resultRevisionId?: string
}

export interface NewMemoryRecord {
  readonly id: string
  readonly partition: MemoryPartition
  readonly kind: MemoryKind
  readonly subjectKey: string
  readonly scope: MemoryScope
  readonly status: MemoryStatus
  readonly pinned: boolean
  readonly confidence: number
  readonly salience: number
  readonly validFrom?: string
  readonly validUntil?: string
  readonly expiresAt?: string
  readonly currentRevisionId: string
  readonly sourceSessionId: string
  readonly timestamp: string
}

export interface NewMemoryRevision extends MemoryTemporalInput {
  readonly id: string
  readonly recordId: string
  readonly ordinal: number
  readonly content: string
  readonly sourceSessionId: string
  readonly sourceKind: string
  readonly supersedesRevisionId?: string
  readonly createdAt: string
}

export interface NewMemoryEvidence {
  readonly id: string
  readonly recordId: string
  readonly sourceSessionId: string
  readonly sourceTurnId: string
  readonly role: MemoryRole
  readonly relation: MemoryEvidenceRelation
  readonly excerpt: string
  readonly createdAt: string
}

export interface NewMemoryConflict {
  readonly id: string
  readonly activeRecordId: string
  readonly candidateRecordId: string
  readonly evidenceId?: string
  readonly createdAt: string
}

export interface MemoryRevisionUpdate extends MemoryTemporalInput {
  readonly recordId: string
  readonly expectedRevisionId: string
  readonly revisionId: string
  readonly confidence: number
  readonly salience: number
  readonly timestamp: string
}

export interface MemoryPromotionEvidence {
  readonly contradiction: boolean
  readonly unresolvedConflict: boolean
  readonly distinctSupportingSessions: number
}

export interface MemoryLexicalCandidate {
  readonly recordId: string
  readonly revisionId: string
}

export interface MemoryCanonicalSnapshot {
  readonly records: readonly MemoryRecord[]
  readonly activeGenerationId?: string
}

export interface MemoryRepositoryReader {
  getRecord(partition: MemoryPartition, id: string, now: string, options?: MemoryReadOptions): Promise<MemoryRecord | undefined>
  getRecords(partition: MemoryPartition, ids: readonly string[], now: string, options?: MemoryReadOptions): Promise<readonly MemoryRecord[]>
  findSubject(partition: MemoryPartition, query: MemorySubjectQuery, now: string): Promise<MemoryRecord | undefined>
  getReceipt(partition: MemoryPartition, operationId: string): Promise<MemoryOperationReceipt | undefined>
  listEvidence(partition: MemoryPartition, recordId: string, now: string): Promise<readonly MemoryEvidence[]>
  listRevisions(partition: MemoryPartition, recordId: string, now: string): Promise<readonly MemoryRevision[]>
  listCandidates(partition: MemoryPartition, now: string): Promise<readonly MemoryRecord[]>
  listConflicts(partition: MemoryPartition, recordId?: string): Promise<readonly MemoryConflict[]>
  getUnresolvedConflict(partition: MemoryPartition, conflictId: string, now: string): Promise<MemoryConflict | undefined>
  activeGeneration(instanceId: string): Promise<string | undefined>
}

export interface MemoryUnitOfWork extends MemoryRepositoryReader {
  insertRecord(record: NewMemoryRecord): Promise<void>
  insertRevision(revision: NewMemoryRevision): Promise<void>
  updateCurrentRevision(update: MemoryRevisionUpdate): Promise<boolean>
  setPinned(recordId: string, pinned: boolean, timestamp: string): Promise<void>
  transitionStatus(recordId: string, expected: MemoryStatus, next: MemoryStatus, timestamp: string): Promise<boolean>
  updateRevisionSourceKind(revisionId: string, sourceKind: string): Promise<void>
  insertEvidence(evidence: NewMemoryEvidence): Promise<MemoryEvidence>
  linkCandidateEvidence(candidateId: string, evidenceId: string): Promise<void>
  insertConflict(conflict: NewMemoryConflict): Promise<void>
  promotionEvidence(recordId: string, principalOnly: boolean): Promise<MemoryPromotionEvidence>
  resolveConflict(conflictId: string, status: MemoryConflict['status'], timestamp: string, resolutionRevisionId?: string): Promise<boolean>
  insertReceipt(partition: MemoryPartition, operationId: string, commandKind: string, commandDigest: string, resultKind: string, recordId: string | undefined, revisionId: string | undefined, timestamp: string): Promise<void>
  replaceLexicalEntry(recordId: string, revisionId: string, content: string): Promise<void>
  removeLexicalEntry(recordId: string): Promise<void>
  enqueueActiveProjection(instanceId: string, recordId: string, revisionId: string, timestamp: string): Promise<void>
  enqueueRevisionReplacement(instanceId: string, recordId: string, previousRevisionId: string, nextRevisionId: string, timestamp: string): Promise<void>
  enqueueKnownProjectionDeletions(recordId: string, timestamp: string): Promise<void>
  deleteRecord(recordId: string): Promise<boolean>
}

export interface MemoryRepository extends MemoryRepositoryReader {
  readonly projectionStore: MemoryProjectionStore
  transaction<T>(partition: MemoryPartition, work: (unit: MemoryUnitOfWork) => Promise<T>): Promise<T>
  lexicalCandidates(partition: MemoryPartition, query: string, now: string, limit: number): Promise<readonly MemoryLexicalCandidate[]>
  stableProfile(partition: MemoryPartition, now: string, limit: number): Promise<readonly MemoryRecord[]>
  readCanonicalSnapshot(partition: MemoryPartition, ids: readonly string[], now: string): Promise<MemoryCanonicalSnapshot>
  close(): Promise<void>
}

