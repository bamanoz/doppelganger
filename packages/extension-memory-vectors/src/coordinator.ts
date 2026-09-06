import { setTimeout as delay } from 'node:timers/promises'
import type { Context, Logger } from '@deepseek-ai/cordis'
import {
  memoryProjectionOwner,
  memorySemanticGenerationId,
  validateMemoryVector,
  type MemoryEmbedder,
  type MemoryProjectionGenerationTransition,
  type MemoryProjectionLease,
  type MemoryProjectionOwner,
  type MemoryProjectionSource,
  type MemorySemanticHit,
  type MemorySemanticRetriever,
  type MemorySemanticSearchRequest,
  type MemorySemanticStatus,
  type MemoryApi,
  type MemoryVectorEntry,
  type MemoryVectorFailure,
  type MemoryVectorHealth,
  type MemoryVectorIdentity,
  type MemoryVectorIndex,
  type MemoryVectorMaintenanceKind,
  type MemoryVectorMaintenanceResult,
} from '@doppelganger/doppelganger-memory'

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
  const timeout = Promise.withResolvers<T>()
  const timer = setTimeout(() => timeout.reject(Object.assign(new Error('semantic operation timed out'), { code: 'timeout' })), timeoutMs)
  try {
    return await Promise.race([operation, timeout.promise])
  } finally {
    clearTimeout(timer)
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

function validHitIdentity(value: unknown): value is MemoryVectorIdentity & { readonly score: number } {
  if (typeof value !== 'object' || value === null) return false
  const hit = value as Partial<MemoryVectorIdentity> & { readonly score?: unknown }
  return typeof hit.generationId === 'string' && hit.generationId.length > 0
    && typeof hit.recordId === 'string' && hit.recordId.length > 0
    && typeof hit.revisionId === 'string' && hit.revisionId.length > 0
    && typeof hit.score === 'number' && Number.isFinite(hit.score)
}

export class MemoryVectorCoordinator implements MemorySemanticRetriever {
  private readonly logger: Logger
  private readonly memory: MemoryApi
  private readonly embedder: MemoryEmbedder
  private readonly index: MemoryVectorIndex
  private readonly instanceId: string
  private readonly owner: MemoryProjectionOwner
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly maximumAttempts: number
  private readonly retryBaseMs: number
  private readonly operationTimeoutMs: number
  private readonly pendingOperations = new Set<Promise<unknown>>()
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
    const generationId = memorySemanticGenerationId(this.instanceId, this.embedder.identity, this.index.identity)
    this.owner = memoryProjectionOwner(this.instanceId, generationId, this.embedder.identity, this.index.identity)
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => { this.pendingOperations.delete(tracked) })
    this.pendingOperations.add(tracked)
    return tracked
  }

  private get projectionStore(): MemoryApi['projectionStore'] {
    return this.memory.projectionStore
  }

  private rememberFailure(error: unknown): void {
    const code = failureCode(error)
    this.lastFailure = safeFailure(code)
    this.logger.warn('semantic.operation.failed code=%s', code)
  }

  private leaseExpiry(): string {
    return new Date(Date.now() + Math.max(this.retryBaseMs * 4, this.operationTimeoutMs * 2)).toISOString()
  }

  private transitionExpiry(): string {
    return new Date(Date.now() + Math.max(this.operationTimeoutMs * 2, 30_000)).toISOString()
  }

  private async ensureGeneration(): Promise<void> {
    const active = await this.projectionStore.activeGeneration(this.instanceId)
    if (active !== undefined && active.generationId !== this.owner.generationId) return
    const existing = await this.projectionStore.generation(this.owner)
    if (active?.generationId === this.owner.generationId && existing?.state === 'active') return
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
    this.timer = setInterval(() => {
      void this.drain().catch(error => this.rememberFailure(error))
    }, this.pollIntervalMs)
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

  private async recoverLeases(timestamp: string): Promise<void> {
    await this.projectionStore.recoverLeases(this.owner, timestamp)
  }

  private async claim(operation: 'upsert' | 'delete'): Promise<MemoryProjectionLease | undefined> {
    const timestamp = now()
    return this.projectionStore.claim(operation, this.owner, this.maximumAttempts, this.leaseExpiry(), timestamp)
  }

  private async retry(operation: 'upsert' | 'delete', lease: MemoryProjectionLease, error: unknown): Promise<void> {
    const code = failureCode(error)
    const backoff = Math.min(this.retryBaseMs * (2 ** Math.min(Math.max(lease.attempts - 1, 0), 10)), 300_000)
    await this.projectionStore.retry(
      operation,
      this.owner,
      lease,
      new Date(Date.now() + backoff).toISOString(),
      code,
      now(),
    )
    this.lastFailure = safeFailure(code)
    this.logger.warn('semantic.projection.retry kind=%s attempt=%d code=%s', operation, lease.attempts, code)
  }

  private async renewLease(operation: 'upsert' | 'delete', lease: MemoryProjectionLease): Promise<boolean> {
    return this.projectionStore.renewLease(operation, this.owner, lease, this.leaseExpiry(), now())
  }

  private async deliverUpsert(lease: MemoryProjectionLease): Promise<void> {
    const source = await this.projectionStore.source(this.owner, lease, now())
    if (source === undefined) return
    const vectors = await bounded(this.track(this.embedder.embedDocuments([source.content])), this.operationTimeoutMs)
    const vector = vectors[0]
    if (vector === undefined) throw Object.assign(new Error('embedder returned no vector'), { code: 'dimension' })
    validateMemoryVector(vector, this.embedder.identity.dimensions)
    if (!(await this.renewLease('upsert', lease))) return
    await bounded(this.track(this.index.upsert([entryFrom(source, vector)])), this.operationTimeoutMs)
    await this.projectionStore.acknowledgeUpsert(this.owner, lease, now())
  }

  private async deliverDelete(lease: MemoryProjectionLease): Promise<void> {
    if (!(await this.renewLease('delete', lease))) return
    await bounded(this.track(this.index.delete([lease])), this.operationTimeoutMs)
    await this.projectionStore.acknowledgeDeletion(this.owner, lease, now())
  }

  private async drain(): Promise<void> {
    if (this.stopped || this.workerBusy) return
    this.workerBusy = true
    try {
      await this.recoverLeases(now())
      for (let count = 0; count < this.batchSize && !this.stopped; count += 1) {
        const deletion = await this.claim('delete')
        if (deletion !== undefined) {
          try {
            await this.deliverDelete(deletion)
          } catch (error) {
            await this.retry('delete', deletion, error)
          }
          continue
        }
        const upsert = await this.claim('upsert')
        if (upsert === undefined) break
        try {
          await this.deliverUpsert(upsert)
        } catch (error) {
          await this.retry('upsert', upsert, error)
        }
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

  private async claimGenerationTransition(): Promise<MemoryProjectionGenerationTransition | undefined> {
    const embedderIdentityJson = JSON.stringify(this.embedder.identity)
    const vectorIndexIdentityJson = JSON.stringify(this.index.identity)
    for (;;) {
      if (this.stopped) throw Object.assign(new Error('semantic rebuild interrupted'), { code: 'timeout' })
      const transition = await this.projectionStore.prepareGeneration(
        this.owner,
        embedderIdentityJson,
        vectorIndexIdentityJson,
        now(),
        this.transitionExpiry(),
      )
      if (transition !== undefined) return transition
      const active = await this.projectionStore.activeGeneration(this.instanceId)
      const generation = await this.projectionStore.generation(this.owner)
      if (active?.generationId === this.owner.generationId && generation?.state === 'active') return undefined
      await delay(this.pollIntervalMs)
    }
  }

  private async performRebuild(): Promise<void> {
    const activeGeneration = await this.projectionStore.activeGeneration(this.instanceId)
    const configuredGeneration = await this.projectionStore.generation(this.owner)
    if (activeGeneration?.generationId === this.owner.generationId && configuredGeneration?.state === 'active') return
    let transition = await this.claimGenerationTransition()
    if (transition === undefined) return
    try {
      const oldIndexed = await this.projectionStore.cleanupIdentities(this.owner)
      if (oldIndexed.length > 0) {
        await bounded(this.track(this.index.delete(oldIndexed)), this.operationTimeoutMs)
        const renewed = await this.projectionStore.renewGenerationTransition(this.owner, transition, this.transitionExpiry(), now())
        if (renewed === undefined) throw Object.assign(new Error('semantic generation rebuild lease expired'), { code: 'identity' })
        transition = renewed
      }
      const reset = await this.projectionStore.resetGeneration(this.owner, transition, this.transitionExpiry(), now())
      if (reset === undefined) throw Object.assign(new Error('semantic generation rebuild became obsolete'), { code: 'identity' })
      transition = reset
      let lastId: string | undefined
      for (;;) {
        if (this.stopped) throw Object.assign(new Error('semantic rebuild interrupted'), { code: 'timeout' })
        const page = await this.projectionStore.rebuildPage(this.owner, transition, lastId, this.batchSize, now())
        if (page.length === 0) break
        const vectors = await bounded(this.track(this.embedder.embedDocuments(page.map(source => source.content))), this.operationTimeoutMs)
        if (vectors.length !== page.length) throw Object.assign(new Error('rebuild vector count mismatch'), { code: 'dimension' })
        for (const vector of vectors) validateMemoryVector(vector!, this.embedder.identity.dimensions)
        const renewed = await this.projectionStore.renewGenerationTransition(this.owner, transition, this.transitionExpiry(), now())
        if (renewed === undefined) throw Object.assign(new Error('semantic generation rebuild lease expired'), { code: 'identity' })
        transition = renewed
        await bounded(this.track(this.index.upsert(page.map((source, index) => entryFrom(source, vectors[index]!)))), this.operationTimeoutMs)
        if (this.stopped) throw Object.assign(new Error('semantic rebuild interrupted'), { code: 'timeout' })
        const marked = await this.projectionStore.markRebuildPage(this.owner, transition, page, now(), this.transitionExpiry())
        if (marked === undefined) throw Object.assign(new Error('semantic generation rebuild became obsolete'), { code: 'identity' })
        transition = marked
        lastId = page[page.length - 1]!.id
        if (page.length < this.batchSize) break
      }
      if (this.stopped) throw Object.assign(new Error('semantic rebuild interrupted'), { code: 'timeout' })
      if (!(await this.projectionStore.verifyGeneration(this.owner, now()))) throw Object.assign(new Error('rebuild identity verification failed'), { code: 'identity' })
      if (!(await this.projectionStore.activateGeneration(this.owner, transition, now()))) throw Object.assign(new Error('semantic generation became obsolete before activation'), { code: 'identity' })
    } catch (error) {
      await this.projectionStore.failGeneration(this.owner, transition, failureCode(error), now())
      throw error
    }
  }

  async rollback(generationId: string): Promise<void> {
    this.logger.info('semantic.rollback.started')
    if (typeof generationId !== 'string' || generationId.length === 0) throw new TypeError('generationId is required')
    if (generationId !== this.owner.generationId) throw Object.assign(new Error('generation identity is incompatible with configured semantic stack'), { code: 'identity' })
    const generation = await this.projectionStore.generation(this.owner)
    if (generation === undefined || generation.state !== 'retained') throw new Error('generation is not retained for rollback')
    let embedderIdentity: unknown
    let indexIdentity: unknown
    try {
      embedderIdentity = JSON.parse(generation.embedderIdentityJson)
      indexIdentity = JSON.parse(generation.vectorIndexIdentityJson)
    } catch {
      throw Object.assign(new Error('generation identity is malformed'), { code: 'identity' })
    }
    const expectedGeneration = memorySemanticGenerationId(
      this.instanceId,
      embedderIdentity as MemoryEmbedder['identity'],
      indexIdentity as MemoryVectorIndex['identity'],
    )
    if (expectedGeneration !== generationId) throw Object.assign(new Error('generation identity is incompatible with configured semantic stack'), { code: 'identity' })
    const active = await this.projectionStore.activeGeneration(this.instanceId)
    if (active === undefined || !(await this.projectionStore.rollbackGeneration(this.owner, active.generationRevision, now()))) {
      throw new Error('generation became obsolete before rollback')
    }
    this.logger.info('semantic.rollback.completed')
  }

  async search(request: MemorySemanticSearchRequest): Promise<readonly MemorySemanticHit[]> {
    this.logger.debug('semantic.search.started limit=%d', request.limit)
    if (request.instanceId !== this.instanceId || request.limit <= 0) return Object.freeze([])
    const active = await this.projectionStore.activeGeneration(this.instanceId)
    const generation = await this.projectionStore.generation(this.owner)
    if (active?.generationId !== this.owner.generationId || generation?.state !== 'active') return Object.freeze([])
    try {
      const query = await bounded(this.track(this.embedder.embedQuery(request.query)), this.operationTimeoutMs)
      validateMemoryVector(query, this.embedder.identity.dimensions, 'semantic query vector')
      const filters = [
        { instanceId: request.instanceId, actorId: request.actorId, scopeKind: 'relationship' as const },
        ...(request.projectId === undefined ? [] : [{ instanceId: request.instanceId, actorId: request.actorId, scopeKind: 'project' as const, projectId: request.projectId }]),
      ]
      const responses = await Promise.all(filters.map(filter => bounded(this.track(this.index.search({
        generationId: this.owner.generationId,
        vector: query,
        filter,
        limit: request.limit,
      })), this.operationTimeoutMs)))
      const candidates: Array<MemoryVectorIdentity & { readonly score: number }> = []
      for (const hit of responses.flat()) {
        if (!validHitIdentity(hit) || hit.generationId !== this.owner.generationId) {
          this.lastFailure = safeFailure('malformed-hit')
          continue
        }
        candidates.push(hit)
      }
      const eligible = await this.projectionStore.eligibleHits(this.owner, candidates, request.actorId, request.projectId, now())
      const eligibleKeys = new Set(eligible.map(hit => `${hit.recordId}\u0000${hit.revisionId}`))
      const hits: Array<MemorySemanticHit & { readonly score: number }> = []
      const seen = new Set<string>()
      for (const hit of candidates) {
        const key = `${hit.recordId}\u0000${hit.revisionId}`
        if (!eligibleKeys.has(key)) {
          this.lastFailure = safeFailure('malformed-hit')
          continue
        }
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ generationId: this.owner.generationId, recordId: hit.recordId, revisionId: hit.revisionId, rank: 0, score: hit.score })
      }
      hits.sort((left, right) => right.score - left.score || left.recordId.localeCompare(right.recordId) || left.revisionId.localeCompare(right.revisionId))
      const result = Object.freeze(hits.slice(0, request.limit).map((hit, index) => Object.freeze({
        generationId: this.owner.generationId,
        recordId: hit.recordId,
        revisionId: hit.revisionId,
        rank: index + 1,
      })))
      this.logger.debug('semantic.search.completed results=%d', result.length)
      return result
    } catch (error) {
      this.rememberFailure(error)
      this.logger.debug('semantic.search.completed results=0 degraded=true')
      return Object.freeze([])
    }
  }

  async status(): Promise<MemoryVectorCoordinatorStatus> {
    const active = await this.projectionStore.activeGeneration(this.instanceId)
    const generation = await this.projectionStore.generation(this.owner)
    const compatibleActive = active?.generationId === this.owner.generationId && generation?.state === 'active'
    let health: MemoryVectorHealth | undefined
    try {
      health = await bounded(this.track(this.index.health()), this.operationTimeoutMs)
    } catch (error) {
      this.rememberFailure(error)
    }
    const resolvedCounts = compatibleActive ? await this.projectionStore.statusCounts(this.owner, now()) : undefined
    const statusCounts = resolvedCounts === undefined ? undefined : Object.freeze({
      indexed: resolvedCounts.indexed,
      current: resolvedCounts.current,
      stale: Math.max(0, resolvedCounts.indexed - resolvedCounts.current),
      missing: Math.max(0, resolvedCounts.eligible - resolvedCounts.current),
      pendingUpserts: resolvedCounts.pendingUpserts,
      pendingDeletes: resolvedCounts.pendingDeletes,
    })
    return Object.freeze({
      active: compatibleActive,
      backend: this.index.identity.backend,
      sanitizedTarget: this.index.identity.sanitizedTarget,
      ...(!compatibleActive ? {} : { generationId: this.owner.generationId }),
      embedder: this.embedder.identity,
      ...(statusCounts === undefined ? {} : { counts: statusCounts }),
      supportedMaintenance: Object.freeze([...new Set([...this.index.supportedMaintenance, 'cleanup-generation' as const])]),
      ...(this.lastFailure === undefined
        ? (health?.lastFailure === undefined ? {} : { lastFailure: safeFailure(health.lastFailure.code, health.lastFailure.occurredAt) })
        : { lastFailure: this.lastFailure }),
      workerRunning: this.workerBusy,
    })
  }

  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    this.logger.info('semantic.maintenance.started kind=%s', kind)
    if (kind !== 'cleanup-generation') return bounded(this.track(this.index.maintenance(kind)), this.operationTimeoutMs)
    const startedAt = now()
    const retained = await this.projectionStore.retainedGenerations({
      instanceId: this.instanceId,
      vectorBackend: this.owner.vectorBackend,
      vectorTargetId: this.owner.vectorTargetId,
    })
    if (retained.length === 0) return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: now() })
    let removed = 0
    for (const generation of retained) {
      const transition = await this.projectionStore.beginRetainedGenerationCleanup(generation, this.transitionExpiry(), now())
      if (transition === undefined) continue
      try {
        const indexed = await this.projectionStore.cleanupIdentities(generation)
        let currentTransition = transition
        if (indexed.length > 0) {
          await bounded(this.track(this.index.delete(indexed)), this.operationTimeoutMs)
          const renewed = await this.projectionStore.renewGenerationTransition(generation, currentTransition, this.transitionExpiry(), now())
          if (renewed === undefined) throw Object.assign(new Error('semantic generation cleanup lease expired'), { code: 'identity' })
          currentTransition = renewed
        }
        if (!(await this.projectionStore.completeRetainedGenerationCleanup(generation, currentTransition, now()))) {
          throw Object.assign(new Error('semantic generation cleanup became obsolete'), { code: 'identity' })
        }
        removed += 1
      } catch (error) {
        await this.projectionStore.abandonRetainedGenerationCleanup(generation, transition, failureCode(error), now())
        throw error
      }
    }
    return Object.freeze({ kind, outcome: removed === 0 ? 'already-running' : 'ran', startedAt, completedAt: now() })
  }
}
