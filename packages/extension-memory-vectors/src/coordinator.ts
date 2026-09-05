import { setTimeout as delay } from 'node:timers/promises'
import type { Context, Logger } from '@deepseek-ai/cordis'
import {
  memorySemanticGenerationId,
  validateMemoryVector,
  type MemoryEmbedder,
  type MemoryProjectionSource,
  type MemorySemanticHit,
  type MemorySemanticRetriever,
  type MemorySemanticSearchRequest,
  type MemorySemanticStatus,
  type MemoryVectorEntry,
  type MemoryVectorFailure,
  type MemoryVectorHealth,
  type MemoryVectorIndex,
  type MemoryVectorMaintenanceKind,
  type MemoryVectorMaintenanceResult,
} from '@doppelganger/doppelganger-memory'
import type { MemoryService } from '@doppelganger/doppelganger-memory'

export interface MemoryVectorCoordinatorConfig {
  readonly instanceId?: string
  readonly pollIntervalMs?: number
  readonly batchSize?: number
  readonly maximumAttempts?: number
  readonly retryBaseMs?: number
  readonly operationTimeoutMs?: number
}

export interface MemoryVectorCoordinatorStatus extends MemorySemanticStatus {
  readonly workerRunning: boolean
}

interface WorkRow {
  readonly id: string
  readonly generationId: string
  readonly recordId: string
  readonly revisionId: string
  readonly attempts: number
}

function boundedInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new TypeError(`${name} must be a positive safe integer no greater than ${maximum}`)
  return value
}

function failureCode(error: unknown): MemoryVectorFailure['code'] {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  if (['backend', 'dimension', 'embedder', 'health', 'identity', 'malformed-hit', 'timeout'].includes(String(code))) return code as MemoryVectorFailure['code']
  return 'backend'
}

function now(): string {
  return new Date().toISOString()
}

function safeFailure(code: MemoryVectorFailure['code'], occurredAt = now()): MemoryVectorFailure {
  return Object.freeze({ code, occurredAt, message: `semantic operation failed (${code})` })
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('semantic operation timed out'), { code: 'timeout' })), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function entryFrom(source: MemoryProjectionSource, vector: Float32Array): MemoryVectorEntry {
  return Object.freeze({
    generationId: source.generationId,
    recordId: source.recordId,
    revisionId: source.revisionId,
    instanceId: source.instanceId,
    actorId: source.actorId,
    scopeKind: source.scopeKind,
    ...(source.projectId === undefined ? {} : { projectId: source.projectId }),
    kind: source.kind,
    subjectKey: source.subjectKey,
    status: source.status,
    vector,
  })
}

export class MemoryVectorCoordinator implements MemorySemanticRetriever {
  private readonly logger: Logger
  private readonly memory: MemoryService
  private readonly embedder: MemoryEmbedder
  private readonly index: MemoryVectorIndex
  private readonly instanceId: string
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly maximumAttempts: number
  private readonly retryBaseMs: number
  private readonly operationTimeoutMs: number
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false
  private workerBusy = false
  private lastFailure?: MemoryVectorFailure
  private rebuildPromise: Promise<void> | undefined

  constructor(ctx: Context, config: MemoryVectorCoordinatorConfig = {}) {
    this.logger = ctx.logger('doppelganger-memory-vector-coordinator')
    this.memory = ctx.doppelgangerMemory
    this.embedder = ctx.doppelgangerMemoryEmbedder
    this.index = ctx.doppelgangerMemoryVectorIndex
    this.instanceId = config.instanceId ?? ctx.doppelgangerPersona.instanceId
    this.pollIntervalMs = boundedInteger('pollIntervalMs', config.pollIntervalMs ?? 250, 60_000)
    this.batchSize = boundedInteger('batchSize', config.batchSize ?? 8, 128)
    this.maximumAttempts = boundedInteger('maximumAttempts', config.maximumAttempts ?? 10, 100)
    this.retryBaseMs = boundedInteger('retryBaseMs', config.retryBaseMs ?? 500, 60_000)
    this.operationTimeoutMs = boundedInteger('operationTimeoutMs', config.operationTimeoutMs ?? 30_000, 120_000)
    if (this.embedder.identity.dimensions !== this.index.identity.dimensions) throw Object.assign(new Error('embedder and vector index dimensions differ'), { code: 'identity' })
    if (this.embedder.identity.distanceMetric !== this.index.identity.distanceMetric) throw Object.assign(new Error('embedder and vector index metrics differ'), { code: 'identity' })
  }
  private readonly pendingOperations = new Set<Promise<unknown>>()

  private track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => { this.pendingOperations.delete(tracked) })
    this.pendingOperations.add(tracked)
    return tracked
  }

  private get projectionStore(): MemoryService['projectionStore'] {
    return this.memory.projectionStore
  }

  private configuredGeneration(): string {
    return memorySemanticGenerationId(this.instanceId, this.embedder.identity, this.index.identity)
  }

  private rememberFailure(error: unknown): void {
    const code = failureCode(error)
    this.lastFailure = safeFailure(code)
    this.logger.warn('semantic.operation.failed code=%s', code)
  }

  private async ensureGeneration(): Promise<void> {
    const generationId = this.configuredGeneration()
    const active = this.projectionStore.activeGeneration(this.instanceId)
    const existing = this.projectionStore.generation(generationId, this.instanceId)
    if (active === generationId && existing?.state === 'active') return
    try {
      await this.rebuild()
    } catch (error) {
      this.rememberFailure(error)
      throw error
    }
  }

  async start(): Promise<void> {
    this.logger.info('component.activation.started backend=%s', this.index.identity.backend)
    if (this.timer !== undefined) return
    this.stopped = false
    await this.ensureGeneration()
    if (this.stopped) return
    this.timer = setInterval(() => { void this.drain() }, this.pollIntervalMs)
    await this.drain()
    this.logger.info('component.active backend=%s', this.index.identity.backend)
  }

  async stop(): Promise<void> {
    this.logger.info('component.disposal.started')
    this.stopped = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    while (this.workerBusy || this.rebuildPromise !== undefined) await delay(5)
    if (this.pendingOperations.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.pendingOperations]),
        delay(this.operationTimeoutMs),
      ])
    }
    this.logger.info('component.disposal.completed')
  }

  private recoverLeases(timestamp: string): void { this.projectionStore.recoverLeases(timestamp) }

  private claim(table: 'memory_vector_projection_work' | 'memory_vector_deletions'): WorkRow | undefined {
    const timestamp = now()
    const operation = table === 'memory_vector_deletions' ? 'delete' : 'upsert'
    const leaseUntil = new Date(Date.now() + Math.max(this.retryBaseMs * 4, this.operationTimeoutMs * 2)).toISOString()
    return this.projectionStore.claim(operation, this.maximumAttempts, leaseUntil, timestamp) as WorkRow | undefined
  }

  private retry(table: 'memory_vector_projection_work' | 'memory_vector_deletions', row: WorkRow, error: unknown): void {
    const attempts = row.attempts + 1
    const code = failureCode(error)
    const backoff = Math.min(this.retryBaseMs * (2 ** Math.min(Math.max(attempts - 1, 0), 10)), 300_000)
    this.projectionStore.retry(table === 'memory_vector_deletions' ? 'delete' : 'upsert', row, new Date(Date.now() + backoff).toISOString(), code, now())
    this.lastFailure = safeFailure(code)
    this.logger.warn('semantic.projection.retry kind=%s attempt=%d code=%s', table === 'memory_vector_deletions' ? 'delete' : 'upsert', attempts, code)
  }

  private async deliverUpsert(row: WorkRow): Promise<void> {
    const source = this.projectionStore.source(row.id, now())
    if (source === undefined) { this.projectionStore.discardUpsert(row.id); return }
    const vectors = await bounded(this.track(this.embedder.embedDocuments([source.content])), this.operationTimeoutMs)
    const vector = vectors[0]
    if (vector === undefined) throw Object.assign(new Error('embedder returned no vector'), { code: 'dimension' })
    validateMemoryVector(vector, this.embedder.identity.dimensions)
    await bounded(this.track(this.index.upsert([entryFrom(source, vector)])), this.operationTimeoutMs)
    this.projectionStore.acknowledgeUpsert(row.id, now())
  }

  private async deliverDelete(row: WorkRow): Promise<void> {
    await bounded(this.track(this.index.delete([{ generationId: row.generationId, recordId: row.recordId, revisionId: row.revisionId }])), this.operationTimeoutMs)
    this.projectionStore.acknowledgeDeletion(row.id)
  }

  private async drain(): Promise<void> {
    if (this.stopped || this.workerBusy) return
    this.workerBusy = true
    try {
      this.recoverLeases(now())
      for (let count = 0; count < this.batchSize && !this.stopped; count += 1) {
        const deletion = this.claim('memory_vector_deletions')
        if (deletion !== undefined) {
          try { await this.deliverDelete(deletion) } catch (error) { this.retry('memory_vector_deletions', deletion, error) }
          continue
        }
        const upsert = this.claim('memory_vector_projection_work')
        if (upsert === undefined) break
        try { await this.deliverUpsert(upsert) } catch (error) { this.retry('memory_vector_projection_work', upsert, error) }
      }
    } finally {
      this.workerBusy = false
    }
  }

  async rebuild(): Promise<void> {
    this.logger.info('semantic.rebuild.started')
    if (this.rebuildPromise !== undefined) return this.rebuildPromise
    const operation = this.performRebuild()
    this.rebuildPromise = operation
    try {
      await operation
      this.logger.info('semantic.rebuild.completed')
    } catch (error) {
      this.rememberFailure(error)
      throw error
    } finally {
      if (this.rebuildPromise === operation) this.rebuildPromise = undefined
    }
  }

  private async performRebuild(): Promise<void> {
    const generationId = this.configuredGeneration()
    const activeGeneration = this.projectionStore.activeGeneration(this.instanceId)
    const activeRow = this.projectionStore.generation(generationId, this.instanceId)
    if (activeGeneration === generationId && activeRow?.state === 'active') return
    const oldIndexed = this.projectionStore.indexed(generationId)
    if (oldIndexed.length > 0) await bounded(this.track(this.index.delete(oldIndexed)), this.operationTimeoutMs)
    const timestamp = now()
    if (!this.projectionStore.prepareGeneration(generationId, this.instanceId, JSON.stringify(this.embedder.identity), JSON.stringify(this.index.identity), timestamp)) {
      throw Object.assign(new Error('semantic generation is not eligible for rebuild'), { code: 'identity' })
    }
    try {
      let lastId: string | undefined
      for (;;) {
        if (this.stopped) throw Object.assign(new Error('semantic rebuild interrupted'), { code: 'timeout' })
        const page = this.projectionStore.rebuildPage(generationId, this.instanceId, lastId, this.batchSize)
        if (page.length === 0) break
        const vectors = await bounded(this.track(this.embedder.embedDocuments(page.map(row => row.content))), this.operationTimeoutMs)
        if (vectors.length !== page.length) throw Object.assign(new Error('rebuild vector count mismatch'), { code: 'dimension' })
        for (const vector of vectors) validateMemoryVector(vector!, this.embedder.identity.dimensions)
        await bounded(this.track(this.index.upsert(page.map((source, index) => entryFrom(source, vectors[index]!)))), this.operationTimeoutMs)
        this.projectionStore.markRebuildPage(generationId, page, now())
        lastId = page[page.length - 1]!.id
        if (page.length < this.batchSize) break
      }
      if (!this.projectionStore.verifyGeneration(generationId, this.instanceId)) throw Object.assign(new Error('rebuild identity verification failed'), { code: 'identity' })
      if (!this.projectionStore.activateGeneration(generationId, this.instanceId, now())) throw Object.assign(new Error('semantic generation became obsolete before activation'), { code: 'identity' })
    } catch (error) {
      this.projectionStore.failGeneration(generationId, failureCode(error))
      throw error
    }
  }
  async rollback(generationId: string): Promise<void> {
    this.logger.info('semantic.rollback.started')
    if (typeof generationId !== 'string' || generationId.length === 0) throw new TypeError('generationId is required')
    const row = this.projectionStore.generation(generationId, this.instanceId)
    if (row === undefined || row.state !== 'retained') throw new Error('generation is not retained for rollback')
    let embedderIdentity: unknown
    let indexIdentity: unknown
    try {
      embedderIdentity = JSON.parse(row.embedderIdentityJson)
      indexIdentity = JSON.parse(row.vectorIndexIdentityJson)
    } catch {
      throw Object.assign(new Error('generation identity is malformed'), { code: 'identity' })
    }
    const expectedGeneration = memorySemanticGenerationId(this.instanceId, embedderIdentity as MemoryEmbedder['identity'], indexIdentity as MemoryVectorIndex['identity'])
    if (expectedGeneration !== generationId || generationId !== this.configuredGeneration()) throw Object.assign(new Error('generation identity is incompatible with configured semantic stack'), { code: 'identity' })
    if (!this.projectionStore.rollbackGeneration(generationId, this.instanceId, now())) throw new Error('generation became obsolete before rollback')
    this.logger.info('semantic.rollback.completed')
  }

  private eligibleHit(hit: { readonly generationId: string; readonly recordId: string; readonly revisionId: string }, request: MemorySemanticSearchRequest): boolean {
    return this.projectionStore.eligibleHit(hit, request.instanceId, request.actorId, request.projectId, now())
  }

  async search(request: MemorySemanticSearchRequest): Promise<readonly MemorySemanticHit[]> {
    this.logger.debug('semantic.search.started limit=%d', request.limit)
    if (request.instanceId !== this.instanceId || request.limit <= 0) return Object.freeze([])
    const generationId = this.projectionStore.activeGeneration(this.instanceId)
    if (generationId === undefined) return Object.freeze([])
    try {
      const query = await bounded(this.track(this.embedder.embedQuery(request.query)), this.operationTimeoutMs)
      validateMemoryVector(query, this.embedder.identity.dimensions, 'semantic query vector')
      const filters = [
        { instanceId: request.instanceId, actorId: request.actorId, scopeKind: 'relationship' as const },
        ...(request.projectId === undefined ? [] : [{ instanceId: request.instanceId, actorId: request.actorId, scopeKind: 'project' as const, projectId: request.projectId }]),
      ]
      const responses = await Promise.all(filters.map(filter => bounded(this.track(this.index.search({ generationId, vector: query, filter, limit: request.limit })), this.operationTimeoutMs)))
      const hits: Array<MemorySemanticHit & { score: number }> = []
      const seen = new Set<string>()
      for (const hit of responses.flat()) {
        if (typeof hit !== 'object' || hit === null || !Number.isFinite(hit.score) || !this.eligibleHit(hit, request)) { this.lastFailure = safeFailure('malformed-hit'); continue }
        const key = `${hit.recordId}\u0000${hit.revisionId}`
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ generationId, recordId: hit.recordId, revisionId: hit.revisionId, rank: 0, score: hit.score })
      }
      hits.sort((left, right) => right.score - left.score || left.recordId.localeCompare(right.recordId) || left.revisionId.localeCompare(right.revisionId))
      const result = Object.freeze(hits.slice(0, request.limit).map((hit, index) => Object.freeze({ generationId, recordId: hit.recordId, revisionId: hit.revisionId, rank: index + 1 })))
      this.logger.debug('semantic.search.completed results=%d', result.length)
      return result
    } catch (error) {
      this.rememberFailure(error)
      this.logger.debug('semantic.search.completed results=0 degraded=true')
      return Object.freeze([])
    }
  }

  async status(): Promise<MemoryVectorCoordinatorStatus> {
    const generationId = this.projectionStore.activeGeneration(this.instanceId)
    let health: MemoryVectorHealth | undefined
    try { health = await bounded(this.track(this.index.health()), this.operationTimeoutMs) } catch (error) { this.rememberFailure(error) }
    const counts = generationId === undefined ? undefined : (() => {
      const current = this.projectionStore.statusCounts(generationId, this.instanceId, now())
      return Object.freeze({ indexed: current.indexed, current: current.current, stale: Math.max(0, current.indexed - current.current), missing: Math.max(0, current.eligible - current.current), pendingUpserts: current.pendingUpserts, pendingDeletes: current.pendingDeletes })
    })()
    return Object.freeze({
      active: generationId !== undefined,
      backend: this.index.identity.backend,
      sanitizedTarget: this.index.identity.sanitizedTarget,
      ...(generationId === undefined ? {} : { generationId }),
      embedder: this.embedder.identity,
      ...(counts === undefined ? {} : { counts }),
      supportedMaintenance: Object.freeze([...new Set([...this.index.supportedMaintenance, 'cleanup-generation' as const])]),
      ...(this.lastFailure === undefined ? (health?.lastFailure === undefined ? {} : { lastFailure: safeFailure(health.lastFailure.code, health.lastFailure.occurredAt) }) : { lastFailure: this.lastFailure }),
      workerRunning: this.workerBusy,
    })
  }
  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    this.logger.info('semantic.maintenance.started kind=%s', kind)
    if (kind !== 'cleanup-generation') return bounded(this.track(this.index.maintenance(kind)), this.operationTimeoutMs)
    const startedAt = now()
    const active = this.projectionStore.activeGeneration(this.instanceId)
    const retained = this.projectionStore.retainedGenerations(this.instanceId, active)
    if (retained.length === 0) return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: now() })
    for (const generationId of retained) {
      const rows = this.projectionStore.indexed(generationId)
      if (rows.length > 0) await bounded(this.track(this.index.delete(rows)), this.operationTimeoutMs)
      this.projectionStore.removeRetainedGeneration(generationId)
    }
    return Object.freeze({ kind, outcome: 'ran', startedAt, completedAt: now() })
  }
}
