import { createHash } from 'node:crypto'
import type {
  MemoryVectorEntry,
  MemoryVectorFilter,
  MemoryVectorHealth,
  MemoryVectorHit,
  MemoryVectorIdentity,
  MemoryVectorIndex,
  MemoryVectorIndexIdentity,
  MemoryVectorMaintenanceKind,
  MemoryVectorMaintenanceResult,
  MemoryVectorSearchRequest,
} from '@doppelganger/doppelganger-memory'
import {
  memoryVectorIdentityId,
  validateMemoryVector,
  validateMemoryVectorIndexIdentity,
} from '@doppelganger/doppelganger-memory'

export type ChromaErrorCode =
  | 'unavailable'
  | 'malformed-response'
  | 'partial-response'
  | 'dimension'
  | 'UNSUPPORTED_MAINTENANCE'

/** A server/client failure which intentionally excludes response bodies and credentials. */
export class ChromaAdapterError extends Error {
  readonly code: ChromaErrorCode
  readonly status?: number

  constructor(code: ChromaErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ChromaAdapterError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export type ChromaMetadata = Record<string, string | null>

export interface ChromaCollection {
  readonly id: string
  readonly name: string
}

export interface ChromaQueryResult {
  readonly ids?: readonly (readonly string[])[]
  readonly distances?: readonly (readonly number[])[]
  readonly metadatas?: readonly (readonly (ChromaMetadata | null)[])[]
}

/**
 * Narrow client seam used by the adapter. The default implementation is the
 * production Chroma HTTP API client; tests can inject a deterministic fake.
 */
export interface ChromaClient {
  createCollection(name: string): Promise<ChromaCollection>
  getCollection(name: string): Promise<ChromaCollection | undefined>
  upsert(collectionId: string, entries: readonly ChromaUpsertEntry[]): Promise<void>
  delete(collectionId: string, ids: readonly string[]): Promise<void>
  query(collectionId: string, embedding: readonly number[], limit: number, where: ChromaWhere): Promise<ChromaQueryResult>
  count(collectionId: string): Promise<number>
  heartbeat(): Promise<void>
  deleteCollection(collectionId: string): Promise<void>
  close?(): Promise<void>
}

export interface ChromaUpsertEntry {
  readonly id: string
  readonly embedding: readonly number[]
  readonly metadata: ChromaMetadata
}

export type ChromaWhereClause = Readonly<Record<string, string>>
export type ChromaWhere = ChromaWhereClause | Readonly<{ $and: readonly ChromaWhereClause[] }>

export interface ChromaConfig {
  readonly endpoint: string
  readonly dimensions: number
  readonly namespace?: string
  readonly tenant?: string
  readonly database?: string
  readonly collection?: string
  /** Name of the environment variable containing the bearer token, never the token itself. */
  readonly tokenEnv?: string
  readonly generationId?: string
  readonly configFingerprint?: string
  readonly sanitizedTarget?: string
  readonly client?: ChromaClient
  readonly fetch?: typeof globalThis.fetch
}

const DEFAULT_TENANT = 'default_tenant'
const DEFAULT_DATABASE = 'default_database'
const DEFAULT_COLLECTION = 'doppelganger-memory'
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/
function boundedText(value: string, field: string, max = 256): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) throw new TypeError(`${field} must be non-empty and bounded`)
  return normalized
}

function safeTarget(endpoint: string): string {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new TypeError('Chroma endpoint must be an absolute URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('Chroma endpoint must use http or https')
  // URL#origin/path deliberately excludes username, password, query, and hash.
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '') || '/'}`
}

function sanitizedConfiguredTarget(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback
  return safeTarget(value)
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function encodeName(base: string, generationId: string): string {
  const digest = createHash('sha256').update(generationId).digest('hex').slice(0, 20)
  const prefix = base.replaceAll(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || DEFAULT_COLLECTION
  return `${prefix}-${digest}`.slice(0, 63)
}

function metadataFor(entry: MemoryVectorEntry): ChromaMetadata {
  return {
    generationId: entry.generationId,
    recordId: entry.recordId,
    revisionId: entry.revisionId,
    instanceId: entry.instanceId,
    actorId: entry.actorId,
    scopeKind: entry.scopeKind,
    projectId: entry.projectId ?? '',
    kind: entry.kind,
    subjectKey: entry.subjectKey,
    status: entry.status,
  }
}

function whereFor(filter: MemoryVectorFilter, generationId: string): ChromaWhere {
  const clauses: ChromaWhereClause[] = [
    { generationId },
    { instanceId: filter.instanceId },
    { actorId: filter.actorId },
  ]
  if (filter.scopeKind !== undefined) clauses.push({ scopeKind: filter.scopeKind })
  if (filter.projectId !== undefined) clauses.push({ projectId: filter.projectId })
  else if (filter.scopeKind === 'relationship') clauses.push({ projectId: '' })
  if (filter.kind !== undefined) clauses.push({ kind: filter.kind })
  if (filter.status !== undefined) clauses.push({ status: filter.status })
  return { $and: clauses }
}

function asMetadata(value: unknown): ChromaMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed metadata')
  const metadata: Record<string, string | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' && item !== null) throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed metadata')
    metadata[key] = item
  }
  return metadata
}

function responseRows(result: ChromaQueryResult, expectedLimit: number): readonly MemoryVectorHit[] {
  if (!Array.isArray(result.ids) || result.ids.length === 0) throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed query results')
  const ids = result.ids[0]
  const distances = result.distances?.[0]
  const metadatas = result.metadatas?.[0]
  if (!Array.isArray(ids) || !Array.isArray(distances) || !Array.isArray(metadatas)) throw new ChromaAdapterError('malformed-response', 'Chroma returned incomplete query results')
  if (ids.length !== distances.length || ids.length !== metadatas.length) throw new ChromaAdapterError('partial-response', 'Chroma returned a partial query response')
  if (ids.length > expectedLimit) throw new ChromaAdapterError('malformed-response', 'Chroma returned more results than requested')
  const hits: MemoryVectorHit[] = []
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]
    const distance = distances[index]
    const metadata = asMetadata(metadatas[index])
    if (typeof id !== 'string' || typeof distance !== 'number' || !Number.isFinite(distance)) throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed query results')
    const generationId = metadata.generationId
    const recordId = metadata.recordId
    const revisionId = metadata.revisionId
    if (typeof generationId !== 'string' || typeof recordId !== 'string' || typeof revisionId !== 'string') throw new ChromaAdapterError('malformed-response', 'Chroma returned incomplete identity metadata')
    hits.push({ generationId, recordId, revisionId, score: 1 - distance })
    // Ensure deterministic ID is the one written by this adapter. This also prevents
    // arbitrary remote IDs from crossing the transport boundary as identities.
    if (id !== memoryVectorIdentityId({ generationId, recordId, revisionId })) throw new ChromaAdapterError('malformed-response', 'Chroma returned an invalid vector identity')
  }
  return Object.freeze(hits.sort((left, right) => right.score - left.score || left.recordId.localeCompare(right.recordId) || left.revisionId.localeCompare(right.revisionId)))
}

class HttpChromaClient implements ChromaClient {
  private readonly base: string
  private readonly tenant: string
  private readonly database: string
  private readonly tokenEnv: string | undefined
  private readonly fetcher: typeof globalThis.fetch
  private closed = false

  constructor(config: { endpoint: string; tenant: string; database: string; tokenEnv?: string; fetch?: typeof globalThis.fetch }) {
    this.base = safeTarget(config.endpoint).replace(/\/$/, '')
    this.tenant = config.tenant
    this.database = config.database
    this.tokenEnv = config.tokenEnv
    this.fetcher = config.fetch ?? globalThis.fetch
    if (typeof this.fetcher !== 'function') throw new TypeError('Chroma fetch implementation is unavailable')
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (this.closed) throw new ChromaAdapterError('unavailable', 'Chroma client is closed')
    const headers = new Headers(init.headers)
    headers.set('content-type', 'application/json')
    if (this.tokenEnv !== undefined) {
      const token = process.env[this.tokenEnv]
      if (token === undefined || token.length === 0) throw new ChromaAdapterError('unavailable', 'Chroma credential environment variable is unavailable')
      headers.set('authorization', `Bearer ${token}`)
    }
    let response: Response
    try {
      response = await this.fetcher(`${this.base}${path}`, { ...init, headers })
    } catch {
      throw new ChromaAdapterError('unavailable', 'Chroma server is unavailable')
    }
    if (!response.ok) throw new ChromaAdapterError('unavailable', `Chroma server request failed (status ${response.status})`, response.status)
    if (response.status === 204) return undefined
    try {
      return await response.json() as unknown
    } catch {
      throw new ChromaAdapterError('malformed-response', 'Chroma server returned malformed JSON', response.status)
    }
  }

  async createCollection(name: string): Promise<ChromaCollection> {
    const value = await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections`, { method: 'POST', body: JSON.stringify({ name, configuration: { hnsw: { space: 'cosine' } }, get_or_create: true }) })
    if (value === null || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed collection metadata')
    return { id: (value as { id: string }).id, name }
  }

  async getCollection(name: string): Promise<ChromaCollection | undefined> {
    try {
      const value = await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections/${encodeURIComponent(name)}`)
      if (value === null || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed collection metadata')
      return { id: (value as { id: string }).id, name }
    } catch (error) {
      if (error instanceof ChromaAdapterError && error.status === 404) return undefined
      throw error
    }
  }

  async upsert(collectionId: string, entries: readonly ChromaUpsertEntry[]): Promise<void> {
    await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections/${encodeURIComponent(collectionId)}/upsert`, { method: 'POST', body: JSON.stringify({ ids: entries.map(entry => entry.id), embeddings: entries.map(entry => entry.embedding), metadatas: entries.map(entry => entry.metadata) }) })
  }

  async delete(collectionId: string, ids: readonly string[]): Promise<void> {
    await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections/${encodeURIComponent(collectionId)}/delete`, { method: 'POST', body: JSON.stringify({ ids }) })
  }

  async query(collectionId: string, embedding: readonly number[], limit: number, where: ChromaWhere): Promise<ChromaQueryResult> {
    const value = await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections/${encodeURIComponent(collectionId)}/query`, { method: 'POST', body: JSON.stringify({ query_embeddings: [embedding], n_results: limit, where, include: ['metadatas', 'distances'] }) })
    if (value === null || typeof value !== 'object') throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed query results')
    return value as ChromaQueryResult
  }

  async count(collectionId: string): Promise<number> {
    const value = await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections/${encodeURIComponent(collectionId)}/count`)
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ChromaAdapterError('malformed-response', 'Chroma returned malformed collection count')
    return value
  }

  async heartbeat(): Promise<void> {
    await this.request('/api/v2/heartbeat')
  }

  async deleteCollection(collectionName: string): Promise<void> {
    await this.request(`/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections/${encodeURIComponent(collectionName)}`, { method: 'DELETE' })
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

export class ChromaMemoryVectorIndex implements MemoryVectorIndex {
  readonly identity: MemoryVectorIndexIdentity
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[] = Object.freeze(['cleanup-generation'])
  private readonly client: ChromaClient
  private readonly dimensions: number
  private readonly collectionBase: string
  private readonly configuredGeneration: string | undefined
  private readonly collections = new Map<string, ChromaCollection>()
  private maintenanceRunning = false
  private closed = false

  constructor(config: ChromaConfig) {
    if (!Number.isSafeInteger(config.dimensions) || config.dimensions <= 0) throw new TypeError('Chroma dimensions must be positive')
    const endpoint = safeTarget(config.endpoint)
    const tenant = boundedText(config.tenant ?? DEFAULT_TENANT, 'Chroma tenant')
    const database = boundedText(config.database ?? DEFAULT_DATABASE, 'Chroma database')
    const namespace = boundedText(config.namespace ?? `${tenant}.${database}`, 'Chroma namespace')
    const collectionBase = boundedText(config.collection ?? DEFAULT_COLLECTION, 'Chroma collection')
    if (config.tokenEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnv)) throw new TypeError('Chroma tokenEnv must be an environment variable name')
    if (config.generationId !== undefined) boundedText(config.generationId, 'Chroma generationId')
    const configuredFingerprint = config.configFingerprint ?? fingerprint({ backend: 'chroma', endpoint, tenant, database, collectionBase, namespace, dimensions: config.dimensions })
    if (!FINGERPRINT_PATTERN.test(configuredFingerprint)) throw new TypeError('Chroma configFingerprint must be a SHA-256 fingerprint')
    const configFingerprint = fingerprint({ partitionSchemaVersion: 2, configuredFingerprint })
    this.dimensions = config.dimensions
    this.collectionBase = collectionBase
    this.configuredGeneration = config.generationId
    this.identity = validateMemoryVectorIndexIdentity({ backend: 'chroma', namespace, sanitizedTarget: sanitizedConfiguredTarget(config.sanitizedTarget, endpoint), configFingerprint, dimensions: config.dimensions, distanceMetric: 'cosine' })
    this.client = config.client ?? new HttpChromaClient({ endpoint, tenant, database, ...(config.tokenEnv === undefined ? {} : { tokenEnv: config.tokenEnv }), ...(config.fetch === undefined ? {} : { fetch: config.fetch }) })
  }

  private assertOpen(): void {
    if (this.closed) throw new ChromaAdapterError('unavailable', 'Chroma vector index is closed')
  }

  private collectionName(generationId: string): string {
    return encodeName(this.collectionBase, generationId)
  }

  private async collectionFor(generationId: string, create: boolean): Promise<ChromaCollection | undefined> {
    const existing = this.collections.get(generationId)
    if (existing !== undefined) return existing
    const name = this.collectionName(generationId)
    const collection = create ? await this.client.createCollection(name) : await this.client.getCollection(name)
    if (collection !== undefined) this.collections.set(generationId, collection)
    return collection
  }

  private recordFailure(error: unknown): never {
    if (error instanceof ChromaAdapterError) throw error
    throw new ChromaAdapterError('unavailable', 'Chroma server operation failed')
  }

  async upsert(entries: readonly MemoryVectorEntry[]): Promise<void> {
    this.assertOpen()
    for (const entry of entries) {
      try {
        validateMemoryVector(entry.vector, this.dimensions, 'Chroma vector')
      } catch (error) {
        if (error instanceof Error && /dimension|length|equal/iu.test(error.message)) {
          throw new ChromaAdapterError('dimension', `Chroma vector dimensions must equal ${this.dimensions}`)
        }
        throw error
      }
    }
    const grouped = new Map<string, MemoryVectorEntry[]>()
    for (const entry of entries) {
      const group = grouped.get(entry.generationId) ?? []
      group.push(entry)
      grouped.set(entry.generationId, group)
    }
    try {
      for (const [generationId, group] of grouped) {
        const collection = await this.collectionFor(generationId, true)
        if (collection === undefined) throw new ChromaAdapterError('unavailable', 'Chroma collection is unavailable')
        await this.client.upsert(collection.id, group.map(entry => ({ id: memoryVectorIdentityId(entry), embedding: Array.from(entry.vector), metadata: metadataFor(entry) })))
      }
    } catch (error) {
      this.recordFailure(error)
    }
  }

  async delete(identities: readonly MemoryVectorIdentity[]): Promise<void> {
    this.assertOpen()
    const grouped = new Map<string, MemoryVectorIdentity[]>()
    for (const identity of identities) {
      const group = grouped.get(identity.generationId) ?? []
      group.push(identity)
      grouped.set(identity.generationId, group)
    }
    try {
      for (const [generationId, group] of grouped) {
        const collection = await this.collectionFor(generationId, false)
        if (collection !== undefined) await this.client.delete(collection.id, group.map(memoryVectorIdentityId))
      }
    } catch (error) {
      this.recordFailure(error)
    }
  }

  async search(request: MemoryVectorSearchRequest): Promise<readonly MemoryVectorHit[]> {
    this.assertOpen()
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) throw new TypeError('Chroma search limit must be positive')
    validateMemoryVector(request.vector, this.dimensions, 'Chroma search vector')
    try {
      const collection = await this.collectionFor(request.generationId, false)
      if (collection === undefined) return Object.freeze([])
      const fetchLimit = request.limit <= 2_500 ? request.limit * 4 : request.limit
      const result = await this.client.query(collection.id, Array.from(request.vector), fetchLimit, whereFor(request.filter, request.generationId))
      return responseRows(result, fetchLimit).slice(0, request.limit)
    } catch (error) {
      this.recordFailure(error)
    }
  }

  async health(): Promise<MemoryVectorHealth> {
    this.assertOpen()
    try {
      await this.client.heartbeat()
      let indexed = 0
      for (const collection of this.collections.values()) indexed += await this.client.count(collection.id)
      const health: MemoryVectorHealth = {
        state: 'healthy', checkedAt: new Date().toISOString(), backend: 'chroma',
        sanitizedTarget: this.identity.sanitizedTarget,
        ...(this.configuredGeneration === undefined ? {} : { generationId: this.configuredGeneration }),
        counts: { indexed, current: indexed, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 },
      }
      return Object.freeze(health)
    } catch (error) {
      const failure = error instanceof ChromaAdapterError ? error : new ChromaAdapterError('unavailable', 'Chroma server health check failed')
      const failureCode = failure.code === 'malformed-response' || failure.code === 'partial-response' ? 'malformed-hit' : failure.code === 'dimension' ? 'dimension' : 'backend'
      const health: MemoryVectorHealth = {
        state: failure.code === 'unavailable' ? 'unavailable' : 'degraded', checkedAt: new Date().toISOString(), backend: 'chroma',
        sanitizedTarget: this.identity.sanitizedTarget,
        ...(this.configuredGeneration === undefined ? {} : { generationId: this.configuredGeneration }),
        lastFailure: { code: failureCode, occurredAt: new Date().toISOString(), message: failure.message },
      }
      return Object.freeze(health)
    }
  }

  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    this.assertOpen()
    if (kind !== 'cleanup-generation') throw new ChromaAdapterError('UNSUPPORTED_MAINTENANCE', `Chroma does not support ${kind}`)
    const startedAt = new Date().toISOString()
    if (this.maintenanceRunning) return Object.freeze({ kind, outcome: 'already-running', startedAt, completedAt: new Date().toISOString() })
    this.maintenanceRunning = true
    try {
      if (this.configuredGeneration === undefined) return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: new Date().toISOString() })
      const collection = await this.collectionFor(this.configuredGeneration, false)
      if (collection === undefined) return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: new Date().toISOString() })
      await this.client.deleteCollection(collection.name)
      this.collections.delete(this.configuredGeneration)
      return Object.freeze({ kind, outcome: 'ran', startedAt, completedAt: new Date().toISOString() })
    } catch (error) {
      this.recordFailure(error)
    } finally {
      this.maintenanceRunning = false
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.client.close?.()
  }
}

export async function createChromaMemoryVectorIndex(config: ChromaConfig): Promise<ChromaMemoryVectorIndex> {
  return new ChromaMemoryVectorIndex(config)
}
