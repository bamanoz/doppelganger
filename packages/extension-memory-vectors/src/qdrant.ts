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

/** The minimum official-client surface used by the adapter and its deterministic fakes. */
export interface QdrantClientLike {
  createCollection(name: string, config: unknown): Promise<unknown>
  getCollection(name: string): Promise<unknown>
  upsert(name: string, request: unknown): Promise<unknown>
  query(name: string, request: unknown): Promise<unknown>
  delete(name: string, request: unknown): Promise<unknown>
  deleteCollection?(name: string): Promise<unknown>
  count?(name: string, request?: unknown): Promise<unknown>
  close?(): Promise<void> | void
}

export interface QdrantClientFactoryOptions {
  readonly url: string
  readonly apiKey?: string
}

export interface QdrantConfig {
  readonly url?: string
  /** Alias accepted by backend harnesses; url takes precedence. */
  readonly endpoint?: string
  readonly dimensions: number
  readonly namespace?: string
  /** Environment variable name, never the API key itself. */
  readonly apiKeyEnv?: string
  /** Optional generation selected by cleanup-generation maintenance. */
  readonly generationId?: string
  readonly sanitizedTarget?: string
  readonly configFingerprint?: string
  readonly collectionName?: string
  /** Intended for disposable smoke fixtures, not persistent configured indexes. */
  readonly cleanupOnClose?: boolean
  readonly client?: QdrantClientLike
  readonly clientFactory?: (options: QdrantClientFactoryOptions) => QdrantClientLike | Promise<QdrantClientLike>
}

export class QdrantAdapterError extends Error {
  readonly code: 'backend' | 'malformed-response' | 'unsupported-maintenance'

  constructor(code: 'backend' | 'malformed-response' | 'unsupported-maintenance', message: string) {
    super(message)
    this.name = 'QdrantAdapterError'
    this.code = code
  }
}

type QdrantPayload = {
  readonly generationId: string
  readonly recordId: string
  readonly revisionId: string
  readonly instanceId: string
  readonly actorId: string
  readonly scopeKind: string
  readonly projectId?: string
  readonly kind: string
  readonly subjectKey: string
  readonly status: string
}

type ScoredPoint = { readonly id?: unknown; readonly score?: unknown; readonly payload?: unknown }

function boundedText(value: string, field: string, maximum = 256): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) throw new TypeError(`${field} must be non-empty and bounded`)
  return normalized
}

function safeTarget(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('Qdrant url must use http or https')
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('must use')) throw error
    return boundedText(value.replace(/:\/\/[^/@\s]+@/, '://[redacted]@'), 'Qdrant sanitizedTarget', 512)
  }
}

function endpointTarget(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new TypeError('Qdrant url must be an absolute URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('Qdrant url must use http or https')
  return value
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Qdrant accepts UUIDs or unsigned integers as point IDs. */
export function qdrantPointId(identity: MemoryVectorIdentity): string {
  const digest = createHash('sha256').update(memoryVectorIdentityId(identity)).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`
}

function payloadFor(entry: MemoryVectorEntry): QdrantPayload {
  return {
    generationId: entry.generationId,
    recordId: entry.recordId,
    revisionId: entry.revisionId,
    instanceId: entry.instanceId,
    actorId: entry.actorId,
    scopeKind: entry.scopeKind,
    ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
    kind: entry.kind,
    subjectKey: entry.subjectKey,
    status: entry.status,
  }
}

function match(key: string, value: string): unknown {
  return { key, match: { value } }
}

function searchFilter(generationId: string, filter: MemoryVectorFilter): unknown {
  const must: unknown[] = [
    match('generationId', generationId),
    match('instanceId', filter.instanceId),
    match('actorId', filter.actorId),
  ]
  if (filter.scopeKind !== undefined) must.push(match('scopeKind', filter.scopeKind))
  if (filter.projectId !== undefined) must.push(match('projectId', filter.projectId))
  if (filter.kind !== undefined) must.push(match('kind', filter.kind))
  if (filter.status !== undefined) must.push(match('status', filter.status))
  return { must }
}

function responseResult(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'result' in value) return (value as { result?: unknown }).result
  return value
}

function decodeHit(value: unknown): MemoryVectorHit {
  if (value === null || typeof value !== 'object') throw new QdrantAdapterError('malformed-response', 'Qdrant returned a malformed search response')
  const point = value as ScoredPoint
  if (typeof point.score !== 'number' || !Number.isFinite(point.score) || point.payload === null || typeof point.payload !== 'object') {
    throw new QdrantAdapterError('malformed-response', 'Qdrant returned a malformed search response')
  }
  const data = point.payload as Record<string, unknown>
  if (typeof data.generationId !== 'string' || typeof data.recordId !== 'string' || typeof data.revisionId !== 'string') {
    throw new QdrantAdapterError('malformed-response', 'Qdrant returned incomplete identity metadata')
  }
  const identity = { generationId: data.generationId, recordId: data.recordId, revisionId: data.revisionId }
  if (point.id !== undefined && point.id !== qdrantPointId(identity)) throw new QdrantAdapterError('malformed-response', 'Qdrant returned an invalid vector identity')
  return { ...identity, score: point.score }
}

export class QdrantMemoryVectorIndex implements MemoryVectorIndex {
  readonly identity: MemoryVectorIndexIdentity
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[] = Object.freeze(['cleanup-generation'])
  private readonly config: QdrantConfig
  private readonly targetUrl: string
  private readonly collection: string
  private clientPromise: Promise<QdrantClientLike> | undefined
  private collectionReady: Promise<void> | undefined
  private ownedClient: QdrantClientLike | undefined
  private closePromise: Promise<void> | undefined
  private lastFailure: { readonly code: 'backend' | 'malformed-hit'; readonly occurredAt: string; readonly message: string } | undefined
  private initialized = false
  private closed = false
  private maintenanceRunning = false
  constructor(config: QdrantConfig) {
    const rawUrl = config.url ?? config.endpoint
    if (rawUrl === undefined) throw new TypeError('Qdrant url is required')
    const target = endpointTarget(rawUrl)
    this.targetUrl = target
    if (!Number.isSafeInteger(config.dimensions) || config.dimensions <= 0) throw new TypeError('Qdrant dimensions must be positive')
    if (config.apiKeyEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(config.apiKeyEnv)) throw new TypeError('Qdrant apiKeyEnv must be an environment variable name')
    const namespace = boundedText(config.namespace ?? 'default', 'Qdrant namespace')
    this.collection = boundedText(config.collectionName ?? `doppelganger_memory_${namespace.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`, 'Qdrant collection name', 255)
    const configuredFingerprint = config.configFingerprint ?? fingerprint({ backend: 'qdrant', target, namespace, collection: this.collection, dimensions: config.dimensions })
    if (!/^[a-f0-9]{64}$/.test(configuredFingerprint)) throw new TypeError('Qdrant configFingerprint must be a SHA-256 fingerprint')
    const configFingerprint = fingerprint({ partitionSchemaVersion: 2, configuredFingerprint })
    this.config = config
    this.identity = validateMemoryVectorIndexIdentity({
      backend: 'qdrant', namespace, sanitizedTarget: safeTarget(config.sanitizedTarget ?? target),
      configFingerprint, dimensions: config.dimensions, distanceMetric: 'cosine',
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new QdrantAdapterError('backend', 'Qdrant vector index is closed')
  }

  private client(): Promise<QdrantClientLike> {
    this.assertOpen()
    if (this.config.client !== undefined) return Promise.resolve(this.config.client)
    if (this.ownedClient !== undefined) return Promise.resolve(this.ownedClient)
    if (this.clientPromise !== undefined) return this.clientPromise
    const attempt = (async () => {
      const apiKey = this.config.apiKeyEnv === undefined ? undefined : process.env[this.config.apiKeyEnv]
      if (this.config.apiKeyEnv !== undefined && (apiKey === undefined || apiKey.length === 0)) throw new QdrantAdapterError('backend', 'Qdrant credential environment variable is unavailable')
      const options: QdrantClientFactoryOptions = apiKey === undefined ? { url: this.targetUrl } : { url: this.targetUrl, apiKey }
      const candidate = this.config.clientFactory !== undefined
        ? await this.config.clientFactory(options)
        : new (await import('@qdrant/js-client-rest')).QdrantClient(options) as unknown as QdrantClientLike
      if (this.closed) {
        await candidate.close?.()
        throw new QdrantAdapterError('backend', 'Qdrant vector index is closed')
      }
      this.ownedClient = candidate
      return candidate
    })()
    this.clientPromise = attempt
    void attempt.catch(() => {
      if (this.clientPromise === attempt) this.clientPromise = undefined
    })
    return attempt
  }

  private ensureCollection(): Promise<void> {
    this.assertOpen()
    if (this.collectionReady !== undefined) return this.collectionReady
    const readiness = (async () => {
      const client = await this.client()
      try {
        await client.createCollection(this.collection, { vectors: { size: this.identity.dimensions, distance: 'Cosine' } })
      } catch {
        // A create race or an existing collection is resolved by validating the authoritative collection metadata.
      }
      let info: unknown
      try {
        info = responseResult(await client.getCollection(this.collection))
      } catch {
        throw new QdrantAdapterError('backend', 'Qdrant collection is unavailable')
      }
      const vectors = (info as { config?: { params?: { vectors?: unknown } } } | undefined)?.config?.params?.vectors
      const size = typeof vectors === 'object' && vectors !== null && 'size' in vectors ? (vectors as { size?: unknown }).size : undefined
      const distance = typeof vectors === 'object' && vectors !== null && 'distance' in vectors ? (vectors as { distance?: unknown }).distance : undefined
      if (size !== this.identity.dimensions || String(distance).toLowerCase() !== 'cosine') {
        throw new QdrantAdapterError('malformed-response', 'Qdrant collection vector space does not match index identity')
      }
      this.assertOpen()
      this.initialized = true
    })()
    this.collectionReady = readiness
    void readiness.catch(() => {
      if (this.collectionReady === readiness) this.collectionReady = undefined
    })
    return readiness
  }

  private unavailable(error: unknown, operation: string): never {
    const code = error instanceof QdrantAdapterError && error.code === 'malformed-response' ? 'malformed-hit' : 'backend'
    this.lastFailure = Object.freeze({ code, occurredAt: new Date().toISOString(), message: `Qdrant ${operation} failed` })
    if (error instanceof QdrantAdapterError) throw error
    throw new QdrantAdapterError('backend', `Qdrant ${operation} failed`)
  }

  async upsert(entries: readonly MemoryVectorEntry[]): Promise<void> {
    this.assertOpen()
    for (const entry of entries) validateMemoryVector(entry.vector, this.identity.dimensions, 'Qdrant vector')
    if (entries.length === 0) return
    try {
      await this.ensureCollection()
      const result = responseResult(await (await this.client()).upsert(this.collection, {
        wait: true,
        points: entries.map(entry => ({ id: qdrantPointId(entry), vector: Array.from(entry.vector), payload: payloadFor(entry) })),
      })) as { status?: unknown } | undefined
      if (result?.status !== undefined && !['completed', 'acknowledged'].includes(String(result.status).toLowerCase())) {
        throw new QdrantAdapterError('malformed-response', 'Qdrant upsert was not acknowledged')
      }
    } catch (error) {
      this.unavailable(error, 'upsert')
    }
  }

  async delete(identities: readonly MemoryVectorIdentity[]): Promise<void> {
    this.assertOpen()
    if (identities.length === 0) return
    try {
      await this.ensureCollection()
      await (await this.client()).delete(this.collection, { wait: true, points: identities.map(qdrantPointId) })
    } catch (error) {
      this.unavailable(error, 'delete')
    }
  }

  async search(request: MemoryVectorSearchRequest): Promise<readonly MemoryVectorHit[]> {
    this.assertOpen()
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) throw new TypeError('Qdrant search limit must be positive')
    validateMemoryVector(request.vector, this.identity.dimensions, 'Qdrant search vector')
    try {
      await this.ensureCollection()
      const fetchLimit = request.limit <= 2_500 ? request.limit * 4 : request.limit
      const response = responseResult(await (await this.client()).query(this.collection, {
        query: Array.from(request.vector), limit: fetchLimit, with_payload: true,
        filter: searchFilter(request.generationId, request.filter),
      }))
      const points = response !== null && typeof response === 'object' && 'points' in response
        ? (response as { points?: unknown }).points
        : undefined
      if (!Array.isArray(points) || points.length > fetchLimit) throw new QdrantAdapterError('malformed-response', 'Qdrant returned a malformed query response')
      return Object.freeze(points.map(decodeHit).sort((left, right) => right.score - left.score || left.recordId.localeCompare(right.recordId) || left.revisionId.localeCompare(right.revisionId)).slice(0, request.limit).map(hit => Object.freeze(hit)))
    } catch (error) {
      this.unavailable(error, 'search')
    }
  }

  async health(): Promise<MemoryVectorHealth> {
    this.assertOpen()
    const checkedAt = new Date().toISOString()
    try {
      await this.ensureCollection()
      let indexed = 0
      const client = await this.client()
      if (client.count !== undefined) {
        const result = responseResult(await client.count(this.collection, { exact: true })) as { count?: unknown } | undefined
        if (typeof result?.count !== 'number' || !Number.isSafeInteger(result.count) || result.count < 0) throw new QdrantAdapterError('malformed-response', 'Qdrant returned a malformed count response')
        indexed = result.count
      }
      return Object.freeze({
        state: 'healthy', checkedAt, backend: 'qdrant', sanitizedTarget: this.identity.sanitizedTarget,
        ...(this.config.generationId === undefined ? {} : { generationId: this.config.generationId }),
        counts: Object.freeze({ indexed, current: indexed, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 }),
        ...(this.lastFailure === undefined ? {} : { lastFailure: this.lastFailure }),
      })
    } catch (error) {
      const malformed = error instanceof QdrantAdapterError && error.code === 'malformed-response'
      return Object.freeze({
        state: malformed ? 'degraded' : 'unavailable', checkedAt, backend: 'qdrant', sanitizedTarget: this.identity.sanitizedTarget,
        ...(this.config.generationId === undefined ? {} : { generationId: this.config.generationId }),
        lastFailure: Object.freeze({ code: malformed ? 'malformed-hit' : 'backend', occurredAt: checkedAt, message: malformed ? 'Qdrant returned malformed operational metadata' : 'Qdrant health check failed' }),
      })
    }
  }

  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    this.assertOpen()
    if (kind !== 'cleanup-generation') throw Object.assign(new QdrantAdapterError('unsupported-maintenance', `Qdrant does not support ${kind}`), { code: 'UNSUPPORTED_MAINTENANCE' })
    const startedAt = new Date().toISOString()
    if (this.maintenanceRunning) return Object.freeze({ kind, outcome: 'already-running', startedAt, completedAt: new Date().toISOString() })
    this.maintenanceRunning = true
    try {
      if (this.config.generationId === undefined) return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: new Date().toISOString() })
      await this.ensureCollection()
      await (await this.client()).delete(this.collection, { wait: true, filter: { must: [match('generationId', this.config.generationId)] } })
      return Object.freeze({ kind, outcome: 'ran', startedAt, completedAt: new Date().toISOString() })
    } catch (error) {
      this.unavailable(error, 'generation cleanup')
    } finally {
      this.maintenanceRunning = false
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closed = true
    this.closePromise = (async () => {
      await this.collectionReady?.catch(() => undefined)
      await this.clientPromise?.catch(() => undefined)
      const client = this.config.client ?? this.ownedClient
      if (this.initialized && this.config.cleanupOnClose === true) {
        try { await client?.deleteCollection?.(this.collection) } catch { /* best-effort disposal of a disposable collection */ }
      }
      this.ownedClient = undefined
      if (this.config.client === undefined) {
        try { await client?.close?.() } catch { /* owned client has no recoverable close path */ }
      }
    })()
    return this.closePromise
  }
}

export async function createQdrantMemoryVectorIndex(config: QdrantConfig): Promise<QdrantMemoryVectorIndex> {
  return new QdrantMemoryVectorIndex(config)
}
