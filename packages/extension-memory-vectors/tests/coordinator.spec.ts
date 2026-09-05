import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { ToolRegistry, createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService, type InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { MemoryService, memorySemanticGenerationId, type MemoryEmbedder, type MemoryVectorEntry, type MemoryVectorHealth, type MemoryVectorIndex, type MemoryVectorMaintenanceKind, type MemoryVectorMaintenanceResult, type MemoryVectorSearchRequest } from '@doppelganger/doppelganger-memory'
import { MemoryVectorCoordinatorPlugin } from '../src/plugin.ts'
import { MemoryVectorCoordinator } from '../src/coordinator.ts'

const roots: string[] = []
const contexts: Context[] = []
const digest = `sha256:${'a'.repeat(64)}`
const embedder: MemoryEmbedder = {
  identity: { provider: 'test', modelId: 'test-model', revision: '1', artifactDigest: digest, pooling: 'mean', projection: 'none', dimensions: 3, normalized: true, distanceMetric: 'cosine' },
  async embedDocuments(texts) { return texts.map(() => new Float32Array([1, 0, 0])) },
  async embedQuery() { return new Float32Array([1, 0, 0]) },
}

function unitVector(dimensions: number, activeIndex = 0): Float32Array {
  const vector = new Float32Array(dimensions)
  vector[activeIndex] = 1
  return vector
}

class FakeIndex implements MemoryVectorIndex {
  readonly identity: MemoryVectorIndex['identity']
  readonly supportedMaintenance = ['compact', 'cleanup-generation'] as const
  readonly entries: Map<string, MemoryVectorEntry>
  readonly upsertCalls: MemoryVectorEntry[][] = []
  readonly deleteCalls: Array<readonly { generationId: string; recordId: string; revisionId: string }[]> = []
  delay = 0
  closed = false
  beforeUpsert: (() => Promise<void>) | undefined
  failUpserts = 0
  failOnUpsertCall: number | undefined
  maintenanceEntered: (() => void) | undefined
  maintenanceRelease: Promise<void> | undefined
  maintenanceRunning = false
  maintenanceOperations = 0
  constructor(dimensions = 3, entries = new Map<string, MemoryVectorEntry>()) {
    this.identity = Object.freeze({
      backend: 'sqlite_exact' as const,
      namespace: 'test',
      sanitizedTarget: 'memory',
      configFingerprint: (dimensions === 256 ? 'c' : dimensions === 384 ? 'd' : 'b').repeat(64),
      dimensions,
      distanceMetric: 'cosine' as const,
    })
    this.entries = entries
  }

  async upsert(entries: readonly MemoryVectorEntry[]) {
    this.upsertCalls.push(entries.map(entry => ({ ...entry, vector: entry.vector.slice() })))
    const upsertCall = this.upsertCalls.length
    if (this.beforeUpsert !== undefined) await this.beforeUpsert()
    if (this.failUpserts > 0 || this.failOnUpsertCall === upsertCall) {
      this.failUpserts = Math.max(0, this.failUpserts - 1)
      this.failOnUpsertCall = undefined
      throw Object.assign(new Error('injected vector backend failure'), { code: 'backend' })
    }
    if (this.delay > 0) await new Promise(resolve => setTimeout(resolve, this.delay))
    for (const entry of entries) {
      if (entry.vector.length !== this.identity.dimensions) throw Object.assign(new Error('vector dimensions differ'), { code: 'dimension' })
      this.entries.set(`${entry.generationId}/${entry.recordId}/${entry.revisionId}`, entry)
    }
  }

  async delete(ids: readonly { generationId: string; recordId: string; revisionId: string }[]) {
    this.deleteCalls.push(ids.map(id => ({ ...id })))
    for (const id of ids) this.entries.delete(`${id.generationId}/${id.recordId}/${id.revisionId}`)
  }

  async search(request: MemoryVectorSearchRequest) { return [...this.entries.values()].filter(entry => entry.generationId === request.generationId && entry.instanceId === request.filter.instanceId && entry.actorId === request.filter.actorId).slice(0, request.limit).map(entry => ({ generationId: entry.generationId, recordId: entry.recordId, revisionId: entry.revisionId, score: 1 })) }
  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    const startedAt = new Date().toISOString()
    if (this.maintenanceRelease === undefined) return { kind, outcome: 'noop', startedAt, completedAt: new Date().toISOString() }
    if (this.maintenanceRunning) return { kind, outcome: 'already-running', startedAt, completedAt: new Date().toISOString() }
    this.maintenanceRunning = true
    this.maintenanceOperations += 1
    this.maintenanceEntered?.()
    try {
      await this.maintenanceRelease
      return { kind, outcome: 'ran', startedAt, completedAt: new Date().toISOString() }
    } finally { this.maintenanceRunning = false }
  }
  async health(): Promise<MemoryVectorHealth> {
    return { state: this.closed ? 'unavailable' : 'healthy', checkedAt: new Date().toISOString(), backend: this.identity.backend, sanitizedTarget: this.identity.sanitizedTarget, counts: { indexed: this.entries.size, current: this.entries.size, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 } }
  }
  async close(): Promise<void> { this.closed = true }
}

interface Fixture { context: Context; database: InstanceSqliteDatabase; index: FakeIndex; coordinator: MemoryVectorCoordinator }

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'doppelganger-coordinator-'))
  roots.push(home)
  return home
}

async function openFixture(home: string, selectedEmbedder: MemoryEmbedder, index: FakeIndex, batchSize = 2): Promise<Fixture> {
  const context = new Context()
  contexts.push(context)
  await context.plugin(createPersonaActivationPlugin({ instanceId: 'aiden', sessionId: 'coordinator', projectId: 'project', projectRoot: join(home, 'project') }))
  await context.plugin(createActorIdentityPlugin('actor'))
  await context.plugin(InstanceSqliteService, { home })
  await context.plugin(ToolRegistry)
  await context.plugin(MemoryService)
  const services: Plugin = { name: 'coordinator-fakes', apply(ctx) { ctx.provide('doppelgangerMemoryEmbedder', selectedEmbedder); ctx.provide('doppelgangerMemoryVectorIndex', index) } }
  await context.plugin(services)
  const coordinator = new MemoryVectorCoordinator(context, { pollIntervalMs: 5, batchSize, retryBaseMs: 2, operationTimeoutMs: 100 })
  return { context, database: (context.doppelgangerMemory as unknown as { database: InstanceSqliteDatabase }).database, index, coordinator }
}

async function fixture(): Promise<Fixture> {
  return await openFixture(await createHome(), embedder, new FakeIndex())
}

async function disposeContext(context: Context): Promise<void> {
  const index = contexts.indexOf(context)
  if (index >= 0) contexts.splice(index, 1)
  await context.fiber.dispose()
}

function migrationEmbedder(dimensions: 256 | 384, projection: string, activeIndex: number) {
  const documentCalls: string[][] = []
  const value: MemoryEmbedder & { readonly documentCalls: readonly string[][] } = {
    identity: {
      provider: 'transformers.js',
      modelId: 'onnx-community/embeddinggemma-300m-ONNX',
      revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
      artifactDigest: `sha256:${(dimensions === 256 ? 'e' : 'f').repeat(64)}`,
      pooling: 'sentence_embedding',
      projection,
      dimensions,
      normalized: true,
      distanceMetric: 'cosine',
    },
    async embedDocuments(texts) {
      documentCalls.push([...texts])
      return texts.map(() => unitVector(dimensions, activeIndex))
    },
    async embedQuery() { return unitVector(dimensions, activeIndex) },
    documentCalls,
  }
  return value
}

describe('memory vector coordinator', () => {
  it('rebuilds deterministic pages, drains queued projections, and reports status without content', async () => {
    const { context, coordinator, index } = await fixture()
    context.doppelgangerMemory.remember({ operationId: 'remember', subjectKey: 'runtime.transport', kind: 'fact', content: 'Framed JSON.' })
    await coordinator.start()
    const status = await coordinator.status()
    expect(status.active).toBe(true)
    expect(status.counts?.indexed).toBe(1)
    expect(JSON.stringify(status)).not.toContain('Framed JSON.')
    await coordinator.stop()
    expect(index.entries.size).toBe(1)
  })

  it('rebuilds q8/384 from canonical content and atomically retains the q4/256 generation', async () => {
    const home = await createHome()
    const sharedEntries = new Map<string, MemoryVectorEntry>()
    const q4Embedder = migrationEmbedder(256, 'mrl-truncate-256-l2', 0)
    const q4Index = new FakeIndex(256, sharedEntries)
    const q4 = await openFixture(home, q4Embedder, q4Index, 1)
    q4.context.doppelgangerMemory.remember({ operationId: 'remember-alpha', subjectKey: 'migration.alpha', kind: 'fact', content: 'Canonical alpha.' })
    q4.context.doppelgangerMemory.remember({ operationId: 'remember-beta', subjectKey: 'migration.beta', kind: 'fact', content: 'Canonical beta.' })
    await q4.coordinator.start()
    const q4Generation = memorySemanticGenerationId('aiden', q4Embedder.identity, q4Index.identity)
    expect(q4.database.prepare('SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?').get('aiden')).toMatchObject({ generation_id: q4Generation })
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q4Generation)).toHaveLength(2)
    await q4.coordinator.stop()
    await disposeContext(q4.context)

    const q8Embedder = migrationEmbedder(384, 'mrl-truncate-384-l2', 1)
    const q8Index = new FakeIndex(384, sharedEntries)
    const q8 = await openFixture(home, q8Embedder, q8Index, 1)
    await q8.coordinator.start()
    const q8Generation = memorySemanticGenerationId('aiden', q8Embedder.identity, q8Index.identity)
    expect(q8Generation).not.toBe(q4Generation)
    expect(q8.database.prepare('SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?').get('aiden')).toMatchObject({ generation_id: q8Generation })
    expect(q8.database.prepare('SELECT state FROM memory_semantic_generations WHERE id = ?').get(q4Generation)).toMatchObject({ state: 'retained' })
    expect(q8.database.prepare('SELECT state FROM memory_semantic_generations WHERE id = ?').get(q8Generation)).toMatchObject({ state: 'active' })
    expect(q8Embedder.documentCalls.flat().sort()).toEqual(['Canonical alpha.', 'Canonical beta.'])
    const q8Entries = [...sharedEntries.values()].filter(entry => entry.generationId === q8Generation)
    expect(q8Entries).toHaveLength(2)
    expect(q8Entries.every(entry => entry.vector.length === 384 && entry.vector[0] === 0 && entry.vector[1] === 1)).toBe(true)
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q4Generation).every(entry => entry.vector.length === 256)).toBe(true)
    expect(q8Index.deleteCalls.flat().some(entry => entry.generationId === q4Generation)).toBe(false)
    await q8.coordinator.stop()
  })

  it('keeps q4/256 active across an incomplete q8/384 rebuild and retries from canonical state', async () => {
    const home = await createHome()
    const sharedEntries = new Map<string, MemoryVectorEntry>()
    const q4Embedder = migrationEmbedder(256, 'mrl-truncate-256-l2', 0)
    const q4Index = new FakeIndex(256, sharedEntries)
    const q4 = await openFixture(home, q4Embedder, q4Index, 1)
    q4.context.doppelgangerMemory.remember({ operationId: 'remember-one', subjectKey: 'migration.one', kind: 'fact', content: 'Canonical one.' })
    q4.context.doppelgangerMemory.remember({ operationId: 'remember-two', subjectKey: 'migration.two', kind: 'fact', content: 'Canonical two.' })
    await q4.coordinator.start()
    const q4Generation = memorySemanticGenerationId('aiden', q4Embedder.identity, q4Index.identity)
    await q4.coordinator.stop()
    await disposeContext(q4.context)

    const q8Embedder = migrationEmbedder(384, 'mrl-truncate-384-l2', 1)
    const q8Index = new FakeIndex(384, sharedEntries)
    q8Index.failOnUpsertCall = 2
    const q8 = await openFixture(home, q8Embedder, q8Index, 1)
    const q8Generation = memorySemanticGenerationId('aiden', q8Embedder.identity, q8Index.identity)
    await expect(q8.coordinator.start()).rejects.toThrow('injected vector backend failure')
    expect(q8.database.prepare('SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?').get('aiden')).toMatchObject({ generation_id: q4Generation })
    expect(q8.database.prepare('SELECT state FROM memory_semantic_generations WHERE id = ?').get(q8Generation)).toMatchObject({ state: 'failed' })
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q8Generation)).toHaveLength(1)

    await q8.coordinator.rebuild()
    expect(q8.database.prepare('SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?').get('aiden')).toMatchObject({ generation_id: q8Generation })
    expect(q8.database.prepare('SELECT state FROM memory_semantic_generations WHERE id = ?').get(q4Generation)).toMatchObject({ state: 'retained' })
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q8Generation)).toHaveLength(2)
    expect(q8Index.deleteCalls.flat().every(entry => entry.generationId === q8Generation)).toBe(true)
    expect(q8Embedder.documentCalls.flat()).toEqual(expect.arrayContaining(['Canonical one.', 'Canonical two.']))
    await q8.coordinator.stop()
  })

  it('keeps the active generation on a failed rebuild and closes after in-flight work', async () => {
    const { coordinator, index } = await fixture()
    index.delay = 20
    const work = coordinator.rebuild()
    await coordinator.stop()
    await work.catch(() => undefined)
    expect(index.closed).toBe(false)
    const result = await coordinator.maintenance('compact')
    expect(result.outcome).toBe('noop')
  })

  it('atomically rolls back to a retained compatible generation', async () => {
    const { coordinator, database } = await fixture()
    await coordinator.start()
    const generation = memorySemanticGenerationId('aiden', embedder.identity, { backend: 'sqlite_exact', namespace: 'test', sanitizedTarget: 'memory', configFingerprint: 'b'.repeat(64), dimensions: 3, distanceMetric: 'cosine' })
    const timestamp = new Date().toISOString()
    database.prepare(`UPDATE memory_semantic_generations SET state = 'retained' WHERE id = ?`).run(generation)
    database.prepare(`INSERT INTO memory_semantic_generations(id, instance_id, embedder_identity_json, vector_index_identity_json, state, created_at) VALUES ('other-generation', 'aiden', '{}', '{}', 'active', ?)`).run(timestamp)
    database.prepare(`UPDATE memory_semantic_active_generation SET generation_id = ? WHERE instance_id = ?`).run('other-generation', 'aiden')
    await coordinator.rollback(generation)
    expect(database.prepare('SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?').get('aiden')).toMatchObject({ generation_id: generation })
    const active = database.prepare('SELECT embedder_identity_json, vector_index_identity_json FROM memory_semantic_generations WHERE id = ?').get(generation) as { embedder_identity_json: string; vector_index_identity_json: string }
    database.prepare(`INSERT INTO memory_semantic_generations(id, instance_id, embedder_identity_json, vector_index_identity_json, state, created_at) VALUES (?, ?, ?, ?, 'retained', ?)`).run(
      'incompatible-generation',
      'aiden',
      JSON.stringify({ ...JSON.parse(active.embedder_identity_json), dimensions: 2 }),
      active.vector_index_identity_json,
      timestamp,
    )
    await expect(coordinator.rollback('incompatible-generation')).rejects.toThrow('incompatible')
    expect(database.prepare('SELECT generation_id FROM memory_semantic_active_generation WHERE instance_id = ?').get('aiden')).toMatchObject({ generation_id: generation })
    await coordinator.stop()
  })
  it('preserves canonical state when a coordinator generation transition is invalid', async () => {
    const { context, database } = await fixture()
    const store = context.doppelgangerMemory.projectionStore
    const timestamp = new Date().toISOString()
    database.prepare(`INSERT INTO memory_semantic_generations(id, instance_id, embedder_identity_json, vector_index_identity_json, state, created_at) VALUES (?, ?, '{}', '{}', 'failed', ?)`).run('obsolete-generation', 'aiden', timestamp)
    const active = store.activeGeneration('aiden')
    expect(store.activateGeneration('obsolete-generation', 'aiden', timestamp)).toBe(false)
    expect(store.rollbackGeneration('obsolete-generation', 'aiden', timestamp)).toBe(false)
    expect(store.activeGeneration('aiden')).toBe(active)
  })
  it('registers sanitized status, rebuild, rollback, and maintenance tools', async () => {
    const { context } = await fixture()
    await context.plugin(MemoryVectorCoordinatorPlugin, {
      pollIntervalMs: 5,
      batchSize: 2,
      retryBaseMs: 2,
      operationTimeoutMs: 100,
    })
    expect(context.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toEqual([
      'memory.semantic.maintenance',
      'memory.semantic.rebuild',
      'memory.semantic.rollback',
      'memory.semantic.status',
    ])
    const status = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.semantic.status', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.semantic.status')!.revision, input: {} }, 'test-session')
    expect(status).toMatchObject({ ok: true, value: { active: true, backend: 'sqlite_exact' } })
    expect(JSON.stringify(status)).not.toMatch(/content|password|secret/iu)
    expect(await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.semantic.maintenance', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.semantic.maintenance')!.revision, input: { kind: 'compact' } }, 'test-session'))
      .toMatchObject({ ok: true, value: { kind: 'compact', outcome: 'noop' } })
    expect(await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.semantic.rollback', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.semantic.rollback')!.revision, input: { generationId: 'unknown' } }, 'test-session'))
      .toMatchObject({ ok: false, error: { code: 'SEMANTIC_OPERATION_FAILED' } })
  })

  it('proves one exclusive maintenance operation while a second request overlaps', async () => {
    const { coordinator, index } = await fixture()
    let entered!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    index.maintenanceEntered = entered
    index.maintenanceRelease = new Promise<void>(resolve => { release = resolve })
    const first = coordinator.maintenance('compact')
    await enteredPromise
    await expect(coordinator.maintenance('compact')).resolves.toMatchObject({ outcome: 'already-running' })
    expect(index.maintenanceOperations).toBe(1)
    release()
    await expect(first).resolves.toMatchObject({ outcome: 'ran' })
  })
  it('distinguishes completed and noop maintenance from overlapping work', async () => {
    const { coordinator, index } = await fixture()
    index.maintenanceRelease = Promise.resolve()
    await expect(coordinator.maintenance('compact')).resolves.toMatchObject({ outcome: 'ran' })
    await expect(coordinator.maintenance('compact')).resolves.toMatchObject({ outcome: 'ran' })
    expect(index.maintenanceOperations).toBe(2)
    index.maintenanceRelease = undefined
    await expect(coordinator.maintenance('compact')).resolves.toMatchObject({ outcome: 'noop' })
    expect(index.maintenanceOperations).toBe(2)
  })
})
