import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import {
  activeMemorySemanticGeneration,
  completeMemoryProjectionDeletion,
  completeMemoryProjectionUpsert,
  loadMemoryProjectionSource,
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
import type { InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'

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
  readonly generation_id: string
  readonly record_id: string
  readonly revision_id: string
  readonly attempts: number
}

interface RebuildRow {
  readonly id: string
  readonly current_revision_id: string
  readonly instance_id: string
  readonly actor_id: string
  readonly scope_kind: 'relationship' | 'project'
  readonly project_id: string | null
  readonly kind: MemoryVectorEntry['kind']
  readonly subject_key: string
  readonly status: 'active'
  readonly content: string
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

  private get database(): InstanceSqliteDatabase {
    return this.memory.canonicalDatabase
  }

  private configuredGeneration(): string {
    return memorySemanticGenerationId(this.instanceId, this.embedder.identity, this.index.identity)
  }

  private rememberFailure(error: unknown): void {
    this.lastFailure = safeFailure(failureCode(error))
  }

  private async ensureGeneration(): Promise<void> {
    const generationId = this.configuredGeneration()
    const active = activeMemorySemanticGeneration(this.database, this.instanceId)
    const existing = this.database.prepare('SELECT state FROM memory_semantic_generations WHERE id = ? AND instance_id = ?').get(generationId, this.instanceId) as { state: string } | undefined
    if (active === generationId && existing?.state === 'active') return
    try {
      await this.rebuild()
    } catch (error) {
      this.rememberFailure(error)
      throw error
    }
  }

  async start(): Promise<void> {
    if (this.timer !== undefined) return
    this.stopped = false
    await this.ensureGeneration()
    if (this.stopped) return
    this.timer = setInterval(() => { void this.drain() }, this.pollIntervalMs)
    await this.drain()
  }

  async stop(): Promise<void> {
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
  }

  private recoverLeases(timestamp: string): void {
    for (const table of ['memory_vector_projection_work', 'memory_vector_deletions'] as const) {
      this.database.prepare(`UPDATE ${table} SET state = 'pending', lease_until = NULL, available_at = ?, updated_at = ? WHERE state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?`).run(timestamp, timestamp, timestamp)
    }
  }

  private claim(table: 'memory_vector_projection_work' | 'memory_vector_deletions'): WorkRow | undefined {
    const timestamp = now()
    return this.database.transaction(storage => {
      storage.prepare(`UPDATE ${table} SET state = 'pending', lease_until = NULL, available_at = ?, updated_at = ? WHERE state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?`).run(timestamp, timestamp, timestamp)
      const row = storage.prepare(`SELECT id, generation_id, record_id, revision_id, attempts FROM ${table} WHERE state IN ('pending', 'failed') AND attempts < ? AND available_at <= ? ORDER BY created_at, id LIMIT 1`).get(this.maximumAttempts, timestamp) as WorkRow | undefined
      if (row === undefined) return undefined
      const leaseUntil = new Date(Date.now() + Math.max(this.retryBaseMs * 4, this.operationTimeoutMs * 2)).toISOString()
      storage.prepare(`UPDATE ${table} SET state = 'leased', lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND state IN ('pending', 'failed')`).run(leaseUntil, timestamp, row.id)
      return row
    })
  }

  private retry(table: 'memory_vector_projection_work' | 'memory_vector_deletions', row: WorkRow, error: unknown): void {
    const attempts = row.attempts + 1
    const code = failureCode(error)
    const backoff = Math.min(this.retryBaseMs * (2 ** Math.min(Math.max(attempts - 1, 0), 10)), 300_000)
    const availableAt = new Date(Date.now() + backoff).toISOString()
    this.database.prepare(`UPDATE ${table} SET state = 'failed', available_at = ?, last_failure_code = ?, updated_at = ?, lease_until = NULL WHERE id = ? AND state = 'leased'`).run(availableAt, code, now(), row.id)
    this.lastFailure = safeFailure(code)
  }
  private async deliverUpsert(row: WorkRow): Promise<void> {
    const source = loadMemoryProjectionSource(this.database, row.id, now())
    if (source === undefined) {
      this.database.prepare('DELETE FROM memory_vector_projection_work WHERE id = ?').run(row.id)
      return
    }
    const vectors = await bounded(this.track(this.embedder.embedDocuments([source.content])), this.operationTimeoutMs)
    const vector = vectors[0]
    if (vector === undefined) throw Object.assign(new Error('embedder returned no vector'), { code: 'dimension' })
    validateMemoryVector(vector, this.embedder.identity.dimensions)
    await bounded(this.track(this.index.upsert([entryFrom(source, vector)])), this.operationTimeoutMs)
    completeMemoryProjectionUpsert(this.database, row.id, now())
  }

  private async deliverDelete(row: WorkRow): Promise<void> {
    await bounded(this.track(this.index.delete([{ generationId: row.generation_id, recordId: row.record_id, revisionId: row.revision_id }])), this.operationTimeoutMs)
    completeMemoryProjectionDeletion(this.database, row.id)
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
    if (this.rebuildPromise !== undefined) return this.rebuildPromise
    const operation = this.performRebuild()
    this.rebuildPromise = operation
    try { await operation } finally { if (this.rebuildPromise === operation) this.rebuildPromise = undefined }
  }

  private async performRebuild(): Promise<void> {
    const generationId = this.configuredGeneration()
    const database = this.database
    const activeGeneration = activeMemorySemanticGeneration(database, this.instanceId)
    const activeRow = database.prepare('SELECT state FROM memory_semantic_generations WHERE id = ? AND instance_id = ?').get(generationId, this.instanceId) as { state: string } | undefined
    if (activeGeneration === generationId && activeRow?.state === 'active') return
    const timestamp = now()
    const oldIndexed = database.prepare('SELECT generation_id, record_id, revision_id FROM memory_semantic_indexed_revisions WHERE generation_id = ?').all(generationId) as unknown as readonly { generation_id: string; record_id: string; revision_id: string }[]
    if (oldIndexed.length > 0) {
      await bounded(this.track(this.index.delete(oldIndexed.map(row => ({ generationId: row.generation_id, recordId: row.record_id, revisionId: row.revision_id })))), this.operationTimeoutMs)
    }
    database.transaction(storage => {
      storage.prepare(`INSERT OR IGNORE INTO memory_semantic_generations(id, instance_id, embedder_identity_json, vector_index_identity_json, state, created_at) VALUES (?, ?, ?, ?, 'building', ?)`).run(generationId, this.instanceId, JSON.stringify(this.embedder.identity), JSON.stringify(this.index.identity), timestamp)
      storage.prepare(`UPDATE memory_semantic_generations SET state = 'building', failure_code = NULL WHERE id = ? AND state != 'active'`).run(generationId)
      storage.prepare(`DELETE FROM memory_semantic_indexed_revisions WHERE generation_id = ?`).run(generationId)
    })
    try {
      let lastId: string | undefined
      for (;;) {
        if (this.stopped) throw Object.assign(new Error('semantic rebuild interrupted'), { code: 'timeout' })
        const page = database.prepare(`SELECT r.id, r.current_revision_id, r.instance_id, r.actor_id, r.scope_kind, r.project_id, r.kind, r.subject_key, r.status, v.content FROM memory_records r JOIN memory_revisions v ON v.id = r.current_revision_id WHERE r.instance_id = ? AND r.status = 'active' AND (? IS NULL OR r.id > ?) ORDER BY r.id LIMIT ?`).all(this.instanceId, lastId ?? null, lastId ?? null, this.batchSize) as unknown as readonly RebuildRow[]
        if (page.length === 0) break
        const vectors = await bounded(this.track(this.embedder.embedDocuments(page.map(row => row.content))), this.operationTimeoutMs)
        if (vectors.length !== page.length) throw Object.assign(new Error('rebuild vector count mismatch'), { code: 'dimension' })
        for (const vector of vectors) validateMemoryVector(vector!, this.embedder.identity.dimensions)
        await bounded(this.track(this.index.upsert(page.map((row, index) => entryFrom({ generationId, recordId: row.id, revisionId: row.current_revision_id, instanceId: row.instance_id, actorId: row.actor_id, scopeKind: row.scope_kind, ...(row.project_id === null ? {} : { projectId: row.project_id }), kind: row.kind, subjectKey: row.subject_key, status: row.status, content: row.content }, vectors[index]!)))), this.operationTimeoutMs)
        database.transaction(storage => {
          const statement = storage.prepare(`INSERT INTO memory_semantic_indexed_revisions(generation_id, record_id, revision_id, indexed_at) VALUES (?, ?, ?, ?) ON CONFLICT(generation_id, record_id) DO UPDATE SET revision_id = excluded.revision_id, indexed_at = excluded.indexed_at`)
          for (const row of page) statement.run(generationId, row.id, row.current_revision_id, now())
        })
        lastId = page[page.length - 1]!.id
        if (page.length < this.batchSize) break
      }
      const expected = database.prepare(`SELECT COUNT(*) AS count FROM memory_records WHERE instance_id = ? AND status = 'active'`).get(this.instanceId) as { count: number }
      const verified = database.prepare(`SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions i JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id WHERE i.generation_id = ? AND r.instance_id = ? AND r.status = 'active'`).get(generationId, this.instanceId) as { count: number }
      const stale = database.prepare(`SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions i LEFT JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id AND r.instance_id = ? AND r.status = 'active' WHERE i.generation_id = ? AND r.id IS NULL`).get(this.instanceId, generationId) as { count: number }
      if (Number(expected.count) !== Number(verified.count) || Number(stale.count) !== 0) throw Object.assign(new Error('rebuild identity verification failed'), { code: 'identity' })
      database.transaction(storage => {
        const previous = activeMemorySemanticGeneration(storage, this.instanceId)
        if (previous !== undefined && previous !== generationId) storage.prepare(`UPDATE memory_semantic_generations SET state = 'retained' WHERE id = ?`).run(previous)
        storage.prepare(`UPDATE memory_semantic_generations SET state = 'active', activated_at = ?, completed_at = ?, failure_code = NULL WHERE id = ?`).run(now(), now(), generationId)
        storage.prepare(`INSERT INTO memory_semantic_active_generation(instance_id, generation_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET generation_id = excluded.generation_id, updated_at = excluded.updated_at`).run(this.instanceId, generationId, now())
      })
    } catch (error) {
      database.prepare(`UPDATE memory_semantic_generations SET state = 'failed', failure_code = ? WHERE id = ? AND state = 'building'`).run(failureCode(error), generationId)
      throw error
    }
  }
  async rollback(generationId: string): Promise<void> {
    if (typeof generationId !== 'string' || generationId.length === 0) throw new TypeError('generationId is required')
    const row = this.database.prepare(`SELECT id, state, embedder_identity_json, vector_index_identity_json FROM memory_semantic_generations WHERE id = ? AND instance_id = ?`).get(generationId, this.instanceId) as { id: string; state: string; embedder_identity_json: string; vector_index_identity_json: string } | undefined
    if (row === undefined || row.state !== 'retained') throw new Error('generation is not retained for rollback')
    let embedderIdentity: unknown
    let indexIdentity: unknown
    try {
      embedderIdentity = JSON.parse(row.embedder_identity_json)
      indexIdentity = JSON.parse(row.vector_index_identity_json)
    } catch {
      throw Object.assign(new Error('generation identity is malformed'), { code: 'identity' })
    }
    const expectedGeneration = memorySemanticGenerationId(this.instanceId, embedderIdentity as MemoryEmbedder['identity'], indexIdentity as MemoryVectorIndex['identity'])
    if (expectedGeneration !== generationId || generationId !== this.configuredGeneration()) throw Object.assign(new Error('generation identity is incompatible with configured semantic stack'), { code: 'identity' })
    const indexed = this.database.prepare(`SELECT generation_id, record_id, revision_id FROM memory_semantic_indexed_revisions WHERE generation_id = ?`).all(generationId) as unknown as readonly { generation_id: string; record_id: string; revision_id: string }[]
    const timestamp = now()
    this.database.transaction(storage => {
      const active = activeMemorySemanticGeneration(storage, this.instanceId)
      if (active !== undefined && active !== generationId) storage.prepare(`UPDATE memory_semantic_generations SET state = 'retained' WHERE id = ? AND instance_id = ?`).run(active, this.instanceId)
      storage.prepare(`UPDATE memory_semantic_generations SET state = 'active', activated_at = ?, failure_code = NULL WHERE id = ? AND state = 'retained'`).run(timestamp, generationId)
      storage.prepare(`INSERT INTO memory_semantic_active_generation(instance_id, generation_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET generation_id = excluded.generation_id, updated_at = excluded.updated_at`).run(this.instanceId, generationId, timestamp)
      for (const entry of indexed) storage.prepare(`DELETE FROM memory_vector_projection_work WHERE generation_id = ? AND record_id = ? AND revision_id = ?`).run(entry.generation_id, entry.record_id, entry.revision_id)
    })
  }

  private eligibleHit(hit: { readonly generationId: string; readonly recordId: string; readonly revisionId: string }, request: MemorySemanticSearchRequest): boolean {
    if (hit.generationId !== activeMemorySemanticGeneration(this.database, this.instanceId)) return false
    if (typeof hit.recordId !== 'string' || typeof hit.revisionId !== 'string') return false
    const row = this.database.prepare(`SELECT instance_id, actor_id, scope_kind, project_id, status, current_revision_id, valid_from, valid_until, expires_at FROM memory_records WHERE id = ? AND current_revision_id = ?`).get(hit.recordId, hit.revisionId) as { instance_id: string; actor_id: string; scope_kind: string; project_id: string | null; status: string; current_revision_id: string; valid_from: string | null; valid_until: string | null; expires_at: string | null } | undefined
    if (row === undefined || row.instance_id !== request.instanceId || row.actor_id !== request.actorId || row.status !== 'active') return false
    if (row.scope_kind === 'project' && (request.projectId === undefined || row.project_id !== request.projectId)) return false
    if (row.scope_kind === 'relationship' && row.project_id !== null) return false
    const timestamp = now()
    return (row.valid_from === null || row.valid_from <= timestamp) && (row.valid_until === null || row.valid_until > timestamp) && (row.expires_at === null || row.expires_at > timestamp)
  }

  async search(request: MemorySemanticSearchRequest): Promise<readonly MemorySemanticHit[]> {
    if (request.instanceId !== this.instanceId || request.limit <= 0) return Object.freeze([])
    const generationId = activeMemorySemanticGeneration(this.database, this.instanceId)
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
      return Object.freeze(hits.slice(0, request.limit).map((hit, index) => Object.freeze({ generationId, recordId: hit.recordId, revisionId: hit.revisionId, rank: index + 1 })))
    } catch (error) {
      this.rememberFailure(error)
      return Object.freeze([])
    }
  }

  async status(): Promise<MemoryVectorCoordinatorStatus> {
    const generationId = activeMemorySemanticGeneration(this.database, this.instanceId)
    let health: MemoryVectorHealth | undefined
    try { health = await bounded(this.track(this.index.health()), this.operationTimeoutMs) } catch (error) { this.rememberFailure(error) }
    const counts = generationId === undefined ? undefined : (() => {
      const current = now()
      const indexed = Number((this.database.prepare('SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions WHERE generation_id = ?').get(generationId) as { count: number }).count)
      const eligible = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_records WHERE instance_id = ? AND status = 'active' AND (valid_from IS NULL OR valid_from <= ?) AND (valid_until IS NULL OR valid_until > ?) AND (expires_at IS NULL OR expires_at > ?)`).get(this.instanceId, current, current, current) as { count: number }).count)
      const currentIndexed = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_semantic_indexed_revisions i JOIN memory_records r ON r.id = i.record_id AND r.current_revision_id = i.revision_id WHERE i.generation_id = ? AND r.instance_id = ? AND r.status = 'active'`).get(generationId, this.instanceId) as { count: number }).count)
      const pendingUpserts = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_vector_projection_work WHERE generation_id = ? AND state IN ('pending', 'leased', 'failed')`).get(generationId) as { count: number }).count)
      const pendingDeletes = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM memory_vector_deletions WHERE generation_id = ? AND state IN ('pending', 'leased', 'failed')`).get(generationId) as { count: number }).count)
      return Object.freeze({ indexed, current: currentIndexed, stale: Math.max(0, indexed - currentIndexed), missing: Math.max(0, eligible - currentIndexed), pendingUpserts, pendingDeletes })
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
    if (kind !== 'cleanup-generation') return bounded(this.track(this.index.maintenance(kind)), this.operationTimeoutMs)
    const startedAt = now()
    const active = activeMemorySemanticGeneration(this.database, this.instanceId)
    const retained = this.database.prepare(`SELECT id FROM memory_semantic_generations WHERE instance_id = ? AND state = 'retained' AND id != ? ORDER BY created_at, id`).all(this.instanceId, active ?? '') as unknown as readonly { id: string }[]
    if (retained.length === 0) return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: now() })
    for (const generation of retained) {
      const rows = this.database.prepare(`SELECT generation_id, record_id, revision_id FROM memory_semantic_indexed_revisions WHERE generation_id = ?`).all(generation.id) as unknown as readonly { generation_id: string; record_id: string; revision_id: string }[]
      if (rows.length > 0) await bounded(this.track(this.index.delete(rows.map(row => ({ generationId: row.generation_id, recordId: row.record_id, revisionId: row.revision_id })))), this.operationTimeoutMs)
      this.database.transaction(storage => {
        storage.prepare('DELETE FROM memory_vector_projection_work WHERE generation_id = ?').run(generation.id)
        storage.prepare('DELETE FROM memory_vector_deletions WHERE generation_id = ?').run(generation.id)
        storage.prepare(`DELETE FROM memory_semantic_generations WHERE id = ? AND state = 'retained'`).run(generation.id)
      })
    }
    return Object.freeze({ kind, outcome: 'ran', startedAt, completedAt: now() })
  }
}
