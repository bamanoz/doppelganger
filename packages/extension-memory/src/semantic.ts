import { createHash } from 'node:crypto'

export const MEMORY_EMBEDDER_SERVICE = 'doppelgangerMemoryEmbedder'
export const MEMORY_VECTOR_INDEX_SERVICE = 'doppelgangerMemoryVectorIndex'
export const MEMORY_SEMANTIC_SERVICE = 'doppelgangerMemorySemantic'

export type MemoryDistanceMetric = 'cosine'
export type MemoryVectorBackendKind = 'sqlite_exact' | 'chroma' | 'qdrant' | 'pgvector'
export type MemoryVectorScopeKind = 'relationship' | 'project'
export type MemoryVectorStatus = 'active' | 'candidate'
export type MemoryVectorMaintenanceKind = 'compact' | 'build-index' | 'reindex' | 'cleanup-generation'
export type MemoryVectorMaintenanceOutcome = 'ran' | 'already-running' | 'noop'
export type MemoryProjectionOperation = 'upsert' | 'delete'
export type MemoryProjectionWorkState = 'pending' | 'leased' | 'failed'
export type MemorySemanticFailureCode =
  | 'backend'
  | 'dimension'
  | 'embedder'
  | 'health'
  | 'identity'
  | 'malformed-hit'
  | 'timeout'

export interface MemoryEmbedderIdentity {
  readonly provider: string
  readonly modelId: string
  readonly revision: string
  readonly artifactDigest: string
  readonly pooling: string
  readonly projection: string
  readonly dimensions: number
  readonly normalized: boolean
  readonly distanceMetric: MemoryDistanceMetric
}

export interface MemoryVectorIndexIdentity {
  readonly backend: MemoryVectorBackendKind
  readonly namespace: string
  readonly sanitizedTarget: string
  readonly configFingerprint: string
  readonly dimensions: number
  readonly distanceMetric: MemoryDistanceMetric
}

export interface MemorySemanticGenerationIdentity {
  readonly id: string
  readonly instanceId: string
  readonly embedder: MemoryEmbedderIdentity
  readonly vectorIndex: MemoryVectorIndexIdentity
}

export interface MemoryVectorIdentity {
  readonly generationId: string
  readonly recordId: string
  readonly revisionId: string
}

export interface MemoryVectorFilter {
  readonly instanceId: string
  readonly actorId: string
  readonly scopeKind?: MemoryVectorScopeKind
  readonly projectId?: string
  readonly kind?: 'decision' | 'fact' | 'preference' | 'procedure'
  readonly status?: MemoryVectorStatus
}

export interface MemoryVectorEntry extends MemoryVectorIdentity {
  readonly instanceId: string
  readonly actorId: string
  readonly scopeKind: MemoryVectorScopeKind
  readonly projectId?: string
  readonly kind: 'decision' | 'fact' | 'preference' | 'procedure'
  readonly subjectKey: string
  readonly status: MemoryVectorStatus
  readonly vector: Float32Array
}

export interface MemoryVectorSearchRequest {
  readonly generationId: string
  readonly vector: Float32Array
  readonly filter: MemoryVectorFilter
  readonly limit: number
}

export interface MemoryVectorHit extends MemoryVectorIdentity {
  readonly score: number
}

export interface MemoryVectorCounts {
  readonly indexed: number
  readonly current: number
  readonly stale: number
  readonly missing: number
  readonly pendingUpserts: number
  readonly pendingDeletes: number
}

export interface MemoryVectorFailure {
  readonly code: MemorySemanticFailureCode
  readonly occurredAt: string
  readonly message: string
}

export interface MemoryVectorHealth {
  readonly state: 'healthy' | 'degraded' | 'unavailable'
  readonly checkedAt: string
  readonly backend: MemoryVectorBackendKind
  readonly sanitizedTarget: string
  readonly generationId?: string
  readonly counts?: MemoryVectorCounts
  readonly lastFailure?: MemoryVectorFailure
}

export interface MemoryVectorMaintenanceResult {
  readonly kind: MemoryVectorMaintenanceKind
  readonly outcome: MemoryVectorMaintenanceOutcome
  readonly startedAt: string
  readonly completedAt: string
  readonly detail?: string
}

export interface MemoryProjectionWork extends MemoryVectorIdentity {
  readonly id: string
  readonly operation: MemoryProjectionOperation
  readonly state: MemoryProjectionWorkState
  readonly attempts: number
  readonly availableAt: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastFailureCode?: MemorySemanticFailureCode
}

export interface MemorySemanticGeneration extends MemorySemanticGenerationIdentity {
  readonly state: 'building' | 'active' | 'retained' | 'failed' | 'deleting'
  readonly createdAt: string
  readonly activatedAt?: string
  readonly completedAt?: string
}

export interface MemorySemanticSearchRequest {
  readonly query: string
  readonly instanceId: string
  readonly actorId: string
  readonly projectId?: string
  readonly limit: number
}

export interface MemorySemanticHit extends MemoryVectorIdentity {
  readonly rank: number
}

export interface MemorySemanticStatus {
  readonly active: boolean
  readonly backend?: MemoryVectorBackendKind
  readonly sanitizedTarget?: string
  readonly generationId?: string
  readonly embedder?: MemoryEmbedderIdentity
  readonly counts?: MemoryVectorCounts
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[]
  readonly lastFailure?: MemoryVectorFailure
}

export interface MemoryEmbedder {
  readonly identity: MemoryEmbedderIdentity
  embedDocuments(texts: readonly string[]): Promise<readonly Float32Array[]>
  embedQuery(text: string): Promise<Float32Array>
}

export interface MemoryVectorIndex {
  readonly identity: MemoryVectorIndexIdentity
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[]
  upsert(entries: readonly MemoryVectorEntry[]): Promise<void>
  delete(identities: readonly MemoryVectorIdentity[]): Promise<void>
  search(request: MemoryVectorSearchRequest): Promise<readonly MemoryVectorHit[]>
  health(): Promise<MemoryVectorHealth>
  maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult>
  close(): Promise<void>
}

export interface MemorySemanticNeighborRequest {
  readonly content: string
  readonly instanceId: string
  readonly actorId: string
  readonly scopeKind: MemoryVectorScopeKind
  readonly projectId?: string
  readonly kind: 'decision' | 'fact' | 'preference' | 'procedure'
  readonly limit: number
}

export type MemorySemanticNeighborRelation = 'equivalent' | 'paraphrase' | 'possible-contradiction'

export interface MemorySemanticNeighborSuggestion {
  readonly recordId: string
  readonly revisionId: string
  readonly subjectKey: string
  readonly score: number
  readonly relation: MemorySemanticNeighborRelation
}

export interface MemorySemanticRetriever {
  search(request: MemorySemanticSearchRequest): Promise<readonly MemorySemanticHit[]>
  neighbors?(request: MemorySemanticNeighborRequest): Promise<readonly MemorySemanticNeighborSuggestion[]>
  status(): MemorySemanticStatus | Promise<MemorySemanticStatus>
  maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult>
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/
const DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/
const TARGET_MAXIMUM = 512

function requiredText(field: string, value: unknown, maximum = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new TypeError(`${field} must contain 1-${maximum} characters`)
  }
  return normalized
}

function identityText(field: string, value: unknown): string {
  const normalized = requiredText(field, value)
  if (!ID_PATTERN.test(normalized)) throw new TypeError(`${field} contains unsupported characters`)
  return normalized
}

function dimensions(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 65_536) {
    throw new TypeError('embedder dimensions must be a positive safe integer no greater than 65536')
  }
  return Number(value)
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export function validateMemoryEmbedderIdentity(value: MemoryEmbedderIdentity): MemoryEmbedderIdentity {
  const metric = value.distanceMetric
  if (metric !== 'cosine') throw new TypeError('embedder distanceMetric must be cosine')
  if (typeof value.normalized !== 'boolean') throw new TypeError('embedder normalized must be a boolean')
  const artifactDigest = requiredText('embedder artifactDigest', value.artifactDigest)
  if (!DIGEST_PATTERN.test(artifactDigest)) {
    throw new TypeError('embedder artifactDigest must be an immutable SHA-256 digest')
  }
  return Object.freeze({
    provider: identityText('embedder provider', value.provider),
    modelId: identityText('embedder modelId', value.modelId),
    revision: identityText('embedder revision', value.revision),
    artifactDigest,
    pooling: identityText('embedder pooling', value.pooling),
    projection: identityText('embedder projection', value.projection),
    dimensions: dimensions(value.dimensions),
    normalized: value.normalized,
    distanceMetric: metric,
  })
}

export function validateMemoryVectorIndexIdentity(value: MemoryVectorIndexIdentity): MemoryVectorIndexIdentity {
  if (!['sqlite_exact', 'chroma', 'qdrant', 'pgvector'].includes(value.backend)) {
    throw new TypeError('vector index backend is unsupported')
  }
  if (value.distanceMetric !== 'cosine') throw new TypeError('vector index distanceMetric must be cosine')
  const configFingerprint = requiredText('vector index configFingerprint', value.configFingerprint, 64)
  if (!FINGERPRINT_PATTERN.test(configFingerprint)) {
    throw new TypeError('vector index configFingerprint must be a SHA-256 fingerprint')
  }
  return Object.freeze({
    backend: value.backend,
    namespace: identityText('vector index namespace', value.namespace),
    sanitizedTarget: requiredText('vector index sanitizedTarget', value.sanitizedTarget, TARGET_MAXIMUM),
    configFingerprint,
    dimensions: dimensions(value.dimensions),
    distanceMetric: value.distanceMetric,
  })
}

export function memoryEmbedderFingerprint(identity: MemoryEmbedderIdentity): string {
  return fingerprint(validateMemoryEmbedderIdentity(identity))
}

export function memoryVectorIndexFingerprint(identity: MemoryVectorIndexIdentity): string {
  return fingerprint(validateMemoryVectorIndexIdentity(identity))
}

export function memorySemanticGenerationId(
  instanceId: string,
  embedder: MemoryEmbedderIdentity,
  vectorIndex: MemoryVectorIndexIdentity,
): string {
  const canonical = {
    instanceId: identityText('Persona Instance ID', instanceId),
    embedder: validateMemoryEmbedderIdentity(embedder),
    vectorIndex: validateMemoryVectorIndexIdentity(vectorIndex),
  }
  return `generation.${fingerprint(canonical)}`
}

export function assertMemorySemanticGenerationCompatible(
  generation: MemorySemanticGenerationIdentity,
  instanceId: string,
  embedder: MemoryEmbedderIdentity,
  vectorIndex: MemoryVectorIndexIdentity,
): void {
  const expected = memorySemanticGenerationId(instanceId, embedder, vectorIndex)
  if (generation.id !== expected) {
    throw new TypeError('semantic generation identity is incompatible with the configured vector space')
  }
}

export function validateMemoryVector(
  vector: Float32Array,
  expectedDimensions: number,
  field = 'memory vector',
): Float32Array {
  const expected = dimensions(expectedDimensions)
  if (!(vector instanceof Float32Array)) throw new TypeError(`${field} must be a Float32Array`)
  if (vector.length !== expected) throw new TypeError(`${field} dimensions must equal ${expected}`)
  let squaredNorm = 0
  for (const component of vector) {
    if (!Number.isFinite(component)) throw new TypeError(`${field} components must be finite`)
    squaredNorm += component * component
  }
  if (squaredNorm === 0) throw new TypeError(`${field} must have a non-zero norm`)
  return vector
}

export function memoryVectorIdentityId(identity: MemoryVectorIdentity): string {
  const canonical = {
    generationId: identityText('semantic generation ID', identity.generationId),
    recordId: identityText('memory record ID', identity.recordId),
    revisionId: identityText('memory revision ID', identity.revisionId),
  }
  return `vector.${fingerprint(canonical)}`
}

export function memoryProjectionWorkId(
  operation: MemoryProjectionOperation,
  identity: MemoryVectorIdentity,
): string {
  if (operation !== 'upsert' && operation !== 'delete') throw new TypeError('projection operation is unsupported')
  return `projection.${fingerprint({ operation, vectorId: memoryVectorIdentityId(identity) })}`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerMemoryEmbedder: MemoryEmbedder
    doppelgangerMemoryVectorIndex: MemoryVectorIndex
    doppelgangerMemorySemantic: MemorySemanticRetriever
  }
}
