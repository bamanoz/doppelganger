import { EntitySchema } from '@mikro-orm/core'

export class MemoryStoreEntity {
  id!: string
  createdAt!: string
}

export class MemoryRecordEntity {
  id!: string
  instanceId!: string
  actorId!: string
  kind!: 'decision' | 'fact' | 'preference' | 'procedure'
  subjectKey!: string
  scopeKind!: 'relationship' | 'project'
  projectId!: string | null
  status!: 'active' | 'candidate' | 'rejected'
  pinned!: boolean
  confidence!: number
  salience!: number
  validFrom!: string | null
  validUntil!: string | null
  expiresAt!: string | null
  currentRevisionId!: string
  sourceSessionId!: string
  createdAt!: string
  updatedAt!: string
}

export class MemoryRevisionEntity {
  id!: string
  recordId!: string
  ordinal!: number
  content!: string
  sourceSessionId!: string
  sourceKind!: string
  supersedesRevisionId!: string | null
  validFrom!: string | null
  validUntil!: string | null
  expiresAt!: string | null
  createdAt!: string
}

export class MemoryEvidenceEntity {
  id!: string
  recordId!: string
  sourceSessionId!: string
  sourceTurnId!: string
  role!: 'principal' | 'assistant' | 'tool' | 'system'
  relation!: 'support' | 'contradiction'
  excerpt!: string
  createdAt!: string
}

export class MemoryCandidateEvidenceEntity {
  candidateId!: string
  evidenceId!: string
}

export class MemoryConflictEntity {
  id!: string
  activeRecordId!: string
  candidateRecordId!: string
  evidenceId!: string | null
  status!: 'unresolved' | 'resolved-active' | 'resolved-candidate' | 'dismissed'
  createdAt!: string
  resolvedAt!: string | null
  resolutionRevisionId!: string | null
}

export class MemoryOperationEntity {
  instanceId!: string
  actorId!: string
  operationId!: string
  commandKind!: string
  commandDigest!: string
  resultKind!: string
  resultRecordId!: string | null
  resultRevisionId!: string | null
  createdAt!: string
}

export class MemorySemanticGenerationEntity {
  id!: string
  storeId!: string
  instanceId!: string
  embedderIdentityJson!: string
  vectorIndexIdentityJson!: string
  embedderFingerprint!: string
  vectorBackend!: string
  vectorTargetId!: string
  generationRevision!: number
  transitionToken!: string | null
  transitionUntil!: string | null
  state!: 'building' | 'active' | 'retained' | 'failed' | 'deleting'
  createdAt!: string
  activatedAt!: string | null
  completedAt!: string | null
  failureCode!: string | null
}

export class MemorySemanticActiveGenerationEntity {
  storeId!: string
  instanceId!: string
  generationId!: string
  generationRevision!: number
  updatedAt!: string
}

export class MemorySemanticIndexedRevisionEntity {
  storeId!: string
  instanceId!: string
  generationId!: string
  recordId!: string
  revisionId!: string
  indexedAt!: string
}

export class MemoryVectorProjectionWorkEntity {
  id!: string
  storeId!: string
  instanceId!: string
  generationId!: string
  recordId!: string
  revisionId!: string
  vectorBackend!: string
  vectorTargetId!: string
  operation!: 'upsert'
  state!: 'pending' | 'leased' | 'failed'
  attempts!: number
  availableAt!: string
  leaseUntil!: string | null
  leaseToken!: string | null
  lastFailureCode!: string | null
  createdAt!: string
  updatedAt!: string
}

export class MemoryVectorDeletionEntity {
  id!: string
  storeId!: string
  instanceId!: string
  generationId!: string
  recordId!: string
  revisionId!: string
  vectorBackend!: string
  vectorTargetId!: string
  state!: 'pending' | 'leased' | 'failed'
  attempts!: number
  availableAt!: string
  leaseUntil!: string | null
  leaseToken!: string | null
  lastFailureCode!: string | null
  createdAt!: string
  updatedAt!: string
}

export class MemoryEmbeddingCacheEntity {
  embedderFingerprint!: string
  recordId!: string
  revisionId!: string
  contentDigest!: string
  dimensions!: number
  vector!: Buffer
  createdAt!: string
}

function text(fieldName: string, nullable = false) {
  return { type: 'string' as const, fieldName, nullable, columnType: 'text' }
}

export const MemoryStoreSchema = new EntitySchema({
  class: MemoryStoreEntity,
  tableName: 'memory_store',
  properties: {
    id: { ...text('id'), primary: true },
    createdAt: text('created_at'),
  },
})

export const MemoryRecordSchema = new EntitySchema({
  class: MemoryRecordEntity,
  tableName: 'memory_records',
  properties: {
    id: { ...text('id'), primary: true },
    instanceId: text('instance_id'),
    actorId: text('actor_id'),
    kind: text('kind'),
    subjectKey: text('subject_key'),
    scopeKind: text('scope_kind'),
    projectId: text('project_id', true),
    status: text('status'),
    pinned: { type: 'boolean', fieldName: 'pinned' },
    confidence: { type: 'number', fieldName: 'confidence' },
    salience: { type: 'number', fieldName: 'salience' },
    validFrom: text('valid_from', true),
    validUntil: text('valid_until', true),
    expiresAt: text('expires_at', true),
    currentRevisionId: text('current_revision_id'),
    sourceSessionId: text('source_session_id'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
})

export const MemoryRevisionSchema = new EntitySchema({
  class: MemoryRevisionEntity,
  tableName: 'memory_revisions',
  properties: {
    id: { ...text('id'), primary: true },
    recordId: text('record_id'),
    ordinal: { type: 'number', fieldName: 'ordinal' },
    content: text('content'),
    sourceSessionId: text('source_session_id'),
    sourceKind: text('source_kind'),
    supersedesRevisionId: text('supersedes_revision_id', true),
    validFrom: text('valid_from', true),
    validUntil: text('valid_until', true),
    expiresAt: text('expires_at', true),
    createdAt: text('created_at'),
  },
})

export const MemoryEvidenceSchema = new EntitySchema({
  class: MemoryEvidenceEntity,
  tableName: 'memory_evidence',
  properties: {
    id: { ...text('id'), primary: true },
    recordId: text('record_id'),
    sourceSessionId: text('source_session_id'),
    sourceTurnId: text('source_turn_id'),
    role: text('role'),
    relation: text('relation'),
    excerpt: text('excerpt'),
    createdAt: text('created_at'),
  },
})

export const MemoryCandidateEvidenceSchema = new EntitySchema({
  class: MemoryCandidateEvidenceEntity,
  tableName: 'memory_candidate_evidence',
  properties: {
    candidateId: { ...text('candidate_id'), primary: true },
    evidenceId: { ...text('evidence_id'), primary: true },
  },
})

export const MemoryConflictSchema = new EntitySchema({
  class: MemoryConflictEntity,
  tableName: 'memory_conflicts',
  properties: {
    id: { ...text('id'), primary: true },
    activeRecordId: text('active_record_id'),
    candidateRecordId: text('candidate_record_id'),
    evidenceId: text('evidence_id', true),
    status: text('status'),
    createdAt: text('created_at'),
    resolvedAt: text('resolved_at', true),
    resolutionRevisionId: text('resolution_revision_id', true),
  },
})

export const MemoryOperationSchema = new EntitySchema({
  class: MemoryOperationEntity,
  tableName: 'memory_operations',
  properties: {
    instanceId: { ...text('instance_id'), primary: true },
    actorId: { ...text('actor_id'), primary: true },
    operationId: { ...text('operation_id'), primary: true },
    commandKind: text('command_kind'),
    commandDigest: text('command_digest'),
    resultKind: text('result_kind'),
    resultRecordId: text('result_record_id', true),
    resultRevisionId: text('result_revision_id', true),
    createdAt: text('created_at'),
  },
})

export const MemorySemanticGenerationSchema = new EntitySchema({
  class: MemorySemanticGenerationEntity,
  tableName: 'memory_semantic_generations',
  properties: {
    id: { ...text('id'), primary: true },
    storeId: text('store_id'),
    instanceId: text('instance_id'),
    embedderIdentityJson: text('embedder_identity_json'),
    vectorIndexIdentityJson: text('vector_index_identity_json'),
    embedderFingerprint: text('embedder_fingerprint'),
    vectorBackend: text('vector_backend'),
    vectorTargetId: text('vector_target_id'),
    generationRevision: { type: 'number', fieldName: 'generation_revision' },
    transitionToken: text('transition_token', true),
    transitionUntil: text('transition_until', true),
    state: text('state'),
    createdAt: text('created_at'),
    activatedAt: text('activated_at', true),
    completedAt: text('completed_at', true),
    failureCode: text('failure_code', true),
  },
})

export const MemorySemanticActiveGenerationSchema = new EntitySchema({
  class: MemorySemanticActiveGenerationEntity,
  tableName: 'memory_semantic_active_generation',
  properties: {
    storeId: { ...text('store_id'), primary: true },
    instanceId: { ...text('instance_id'), primary: true },
    generationId: text('generation_id'),
    generationRevision: { type: 'number', fieldName: 'generation_revision' },
    updatedAt: text('updated_at'),
  },
})

export const MemorySemanticIndexedRevisionSchema = new EntitySchema({
  class: MemorySemanticIndexedRevisionEntity,
  tableName: 'memory_semantic_indexed_revisions',
  properties: {
    storeId: text('store_id'),
    instanceId: text('instance_id'),
    generationId: { ...text('generation_id'), primary: true },
    recordId: { ...text('record_id'), primary: true },
    revisionId: text('revision_id'),
    indexedAt: text('indexed_at'),
  },
})

export const MemoryVectorProjectionWorkSchema = new EntitySchema({
  class: MemoryVectorProjectionWorkEntity,
  tableName: 'memory_vector_projection_work',
  properties: {
    id: { ...text('id'), primary: true },
    storeId: text('store_id'),
    instanceId: text('instance_id'),
    generationId: text('generation_id'),
    recordId: text('record_id'),
    revisionId: text('revision_id'),
    vectorBackend: text('vector_backend'),
    vectorTargetId: text('vector_target_id'),
    operation: text('operation'),
    state: text('state'),
    attempts: { type: 'number', fieldName: 'attempts' },
    availableAt: text('available_at'),
    leaseUntil: text('lease_until', true),
    leaseToken: text('lease_token', true),
    lastFailureCode: text('last_failure_code', true),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
})

export const MemoryVectorDeletionSchema = new EntitySchema({
  class: MemoryVectorDeletionEntity,
  tableName: 'memory_vector_deletions',
  properties: {
    id: { ...text('id'), primary: true },
    storeId: text('store_id'),
    instanceId: text('instance_id'),
    generationId: text('generation_id'),
    recordId: text('record_id'),
    revisionId: text('revision_id'),
    vectorBackend: text('vector_backend'),
    vectorTargetId: text('vector_target_id'),
    state: text('state'),
    attempts: { type: 'number', fieldName: 'attempts' },
    availableAt: text('available_at'),
    leaseUntil: text('lease_until', true),
    leaseToken: text('lease_token', true),
    lastFailureCode: text('last_failure_code', true),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
})

export const MemoryEmbeddingCacheSchema = new EntitySchema({
  class: MemoryEmbeddingCacheEntity,
  tableName: 'memory_embedding_cache',
  properties: {
    embedderFingerprint: { ...text('embedder_fingerprint'), primary: true },
    recordId: { ...text('record_id'), primary: true },
    revisionId: { ...text('revision_id'), primary: true },
    contentDigest: text('content_digest'),
    dimensions: { type: 'number', fieldName: 'dimensions' },
    vector: { type: 'Buffer', fieldName: 'vector' },
    createdAt: text('created_at'),
  },
})

export const memoryEntities = Object.freeze([
  MemoryStoreSchema,
  MemoryRecordSchema,
  MemoryRevisionSchema,
  MemoryEvidenceSchema,
  MemoryCandidateEvidenceSchema,
  MemoryConflictSchema,
  MemoryOperationSchema,
  MemorySemanticGenerationSchema,
  MemorySemanticActiveGenerationSchema,
  MemorySemanticIndexedRevisionSchema,
  MemoryVectorProjectionWorkSchema,
  MemoryVectorDeletionSchema,
  MemoryEmbeddingCacheSchema,
])
