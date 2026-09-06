import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { ToolRegistry, createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import {
  MemoryService,
  SqliteMemoryPlugin,
  memoryProjectionOwner,
  memorySemanticGenerationId,
  type MemoryEmbedder,
  type MemoryProjectionOwner,
  type MemoryVectorEntry,
  type MemoryVectorHealth,
  type MemoryVectorIndex,
  type MemoryVectorMaintenanceKind,
  type MemoryVectorMaintenanceResult,
  type MemoryVectorSearchRequest,
} from '@doppelganger/doppelganger-memory'
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

  constructor(dimensions = 3, entries = new Map<string, MemoryVectorEntry>(), target = dimensions === 256 ? 'c' : dimensions === 384 ? 'd' : 'b') {
    this.identity = Object.freeze({
      backend: 'sqlite_exact' as const,
      namespace: 'test',
      sanitizedTarget: 'memory',
      configFingerprint: target.repeat(64),
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
    if (this.delay > 0) await delay(this.delay)
    for (const entry of entries) {
      if (entry.vector.length !== this.identity.dimensions) throw Object.assign(new Error('vector dimensions differ'), { code: 'dimension' })
      this.entries.set(`${entry.generationId}/${entry.recordId}/${entry.revisionId}`, entry)
    }
  }

  async delete(ids: readonly { generationId: string; recordId: string; revisionId: string }[]) {
    this.deleteCalls.push(ids.map(id => ({ ...id })))
    for (const id of ids) this.entries.delete(`${id.generationId}/${id.recordId}/${id.revisionId}`)
  }

  async search(request: MemoryVectorSearchRequest) {
    return [...this.entries.values()]
      .filter(entry => entry.generationId === request.generationId && entry.instanceId === request.filter.instanceId && entry.actorId === request.filter.actorId)
      .slice(0, request.limit)
      .map(entry => ({ generationId: entry.generationId, recordId: entry.recordId, revisionId: entry.revisionId, score: 1 }))
  }

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
    } finally {
      this.maintenanceRunning = false
    }
  }

  async health(): Promise<MemoryVectorHealth> {
    return { state: this.closed ? 'unavailable' : 'healthy', checkedAt: new Date().toISOString(), backend: this.identity.backend, sanitizedTarget: this.identity.sanitizedTarget, counts: { indexed: this.entries.size, current: this.entries.size, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 } }
  }

  async close(): Promise<void> { this.closed = true }
}

interface Fixture {
  readonly context: Context
  readonly index: FakeIndex
  readonly coordinator: MemoryVectorCoordinator
  readonly owner: MemoryProjectionOwner
}

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
  await context.plugin(SqliteMemoryPlugin, { home })
  await context.plugin(ToolRegistry)
  await context.plugin(MemoryService)
  const services: Plugin = {
    name: 'coordinator-fakes',
    apply(ctx) {
      ctx.provide('doppelgangerMemoryEmbedder', selectedEmbedder)
      ctx.provide('doppelgangerMemoryVectorIndex', index)
    },
  }
  await context.plugin(services)
  const coordinator = new MemoryVectorCoordinator(context, { pollIntervalMs: 5, batchSize, retryBaseMs: 2, operationTimeoutMs: 100 })
  const generationId = memorySemanticGenerationId('aiden', selectedEmbedder.identity, index.identity)
  return { context, index, coordinator, owner: memoryProjectionOwner('aiden', generationId, selectedEmbedder.identity, index.identity) }
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
    await context.doppelgangerMemory.remember({ operationId: 'remember', subjectKey: 'runtime.transport', kind: 'fact', content: 'Framed JSON.' })
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
    await q4.context.doppelgangerMemory.remember({ operationId: 'remember-alpha', subjectKey: 'migration.alpha', kind: 'fact', content: 'Canonical alpha.' })
    await q4.context.doppelgangerMemory.remember({ operationId: 'remember-beta', subjectKey: 'migration.beta', kind: 'fact', content: 'Canonical beta.' })
    await q4.coordinator.start()
    const q4Generation = q4.owner.generationId
    expect(await q4.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q4Generation })
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q4Generation)).toHaveLength(2)
    await q4.coordinator.stop()
    await disposeContext(q4.context)

    const q8Embedder = migrationEmbedder(384, 'mrl-truncate-384-l2', 1)
    const q8Index = new FakeIndex(384, sharedEntries)
    const q8 = await openFixture(home, q8Embedder, q8Index, 1)
    await q8.coordinator.start()
    const q8Generation = q8.owner.generationId
    expect(q8Generation).not.toBe(q4Generation)
    expect(await q8.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q4Generation })
    expect((await q8.coordinator.status()).active).toBe(false)
    await q8.coordinator.rebuild()
    expect(await q8.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q8Generation })
    expect(await q8.context.doppelgangerMemory.projectionStore.generation(q4.owner)).toMatchObject({ state: 'retained' })
    expect(await q8.context.doppelgangerMemory.projectionStore.generation(q8.owner)).toMatchObject({ state: 'active' })
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
    const q4 = await openFixture(home, q4Embedder, new FakeIndex(256, sharedEntries), 1)
    await q4.context.doppelgangerMemory.remember({ operationId: 'remember-one', subjectKey: 'migration.one', kind: 'fact', content: 'Canonical one.' })
    await q4.context.doppelgangerMemory.remember({ operationId: 'remember-two', subjectKey: 'migration.two', kind: 'fact', content: 'Canonical two.' })
    await q4.coordinator.start()
    const q4Generation = q4.owner.generationId
    await q4.coordinator.stop()
    await disposeContext(q4.context)

    const q8Embedder = migrationEmbedder(384, 'mrl-truncate-384-l2', 1)
    const q8Index = new FakeIndex(384, sharedEntries)
    q8Index.failOnUpsertCall = 2
    const q8 = await openFixture(home, q8Embedder, q8Index, 1)
    await q8.coordinator.start()
    expect(await q8.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q4Generation })
    expect((await q8.coordinator.status()).active).toBe(false)
    await expect(q8.coordinator.rebuild()).rejects.toThrow('injected vector backend failure')
    expect(await q8.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q4Generation })
    expect(await q8.context.doppelgangerMemory.projectionStore.generation(q8.owner)).toMatchObject({ state: 'failed' })
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q8.owner.generationId)).toHaveLength(1)

    await q8.coordinator.rebuild()
    expect(await q8.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q8.owner.generationId })
    expect(await q8.context.doppelgangerMemory.projectionStore.generation(q4.owner)).toMatchObject({ state: 'retained' })
    expect([...sharedEntries.values()].filter(entry => entry.generationId === q8.owner.generationId)).toHaveLength(2)
    expect(q8Index.deleteCalls.flat().every(entry => entry.generationId === q8.owner.generationId)).toBe(true)
    expect(q8Embedder.documentCalls.flat()).toEqual(expect.arrayContaining(['Canonical one.', 'Canonical two.']))
    await q8.coordinator.stop()
  })

  it('keeps the active generation on a failed rebuild and closes after in-flight work', async () => {
    const home = await createHome()
    const sharedEntries = new Map<string, MemoryVectorEntry>()
    const q4Embedder = migrationEmbedder(256, 'mrl-truncate-256-l2', 0)
    const q4 = await openFixture(home, q4Embedder, new FakeIndex(256, sharedEntries), 1)
    await q4.context.doppelgangerMemory.remember({ operationId: 'dispose-record', subjectKey: 'dispose.record', kind: 'fact', content: 'Wait for in-flight vector I/O.' })
    await q4.coordinator.start()
    await q4.coordinator.stop()
    await disposeContext(q4.context)

    const q8Embedder = migrationEmbedder(384, 'mrl-truncate-384-l2', 1)
    const q8Index = new FakeIndex(384, sharedEntries)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    q8Index.beforeUpsert = async () => {
      entered.resolve()
      await release.promise
    }
    const q8 = await openFixture(home, q8Embedder, q8Index, 1)
    const work = q8.coordinator.rebuild()
    await entered.promise
    const stopping = q8.coordinator.stop()
    release.resolve()
    await expect(work).rejects.toThrow('interrupted')
    await stopping
    expect(await q8.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q4.owner.generationId })
    expect(await q8.context.doppelgangerMemory.projectionStore.generation(q8.owner)).toMatchObject({ state: 'failed' })
    expect(q8Index.closed).toBe(false)
    await expect(q8.coordinator.maintenance('compact')).resolves.toMatchObject({ outcome: 'noop' })
  })

  it('atomically rolls back to a retained compatible generation', async () => {
    const home = await createHome()
    const sharedEntries = new Map<string, MemoryVectorEntry>()
    const q4Embedder = migrationEmbedder(256, 'mrl-truncate-256-l2', 0)
    const q4Index = new FakeIndex(256, sharedEntries)
    const q4 = await openFixture(home, q4Embedder, q4Index, 1)
    await q4.context.doppelgangerMemory.remember({ operationId: 'rollback-record', subjectKey: 'migration.rollback', kind: 'fact', content: 'Rollback source.' })
    await q4.coordinator.start()
    await q4.coordinator.stop()
    await disposeContext(q4.context)

    const q8Embedder = migrationEmbedder(384, 'mrl-truncate-384-l2', 1)
    const q8 = await openFixture(home, q8Embedder, new FakeIndex(384, sharedEntries), 1)
    await q8.coordinator.start()
    expect((await q8.coordinator.status()).active).toBe(false)
    await q8.coordinator.rebuild()
    await q8.coordinator.stop()
    await disposeContext(q8.context)

    const rollback = await openFixture(home, q4Embedder, new FakeIndex(256, sharedEntries), 1)
    await rollback.coordinator.rollback(q4.owner.generationId)
    expect(await rollback.context.doppelgangerMemory.projectionStore.activeGeneration('aiden')).toMatchObject({ generationId: q4.owner.generationId })
    await expect(rollback.coordinator.rollback('incompatible-generation')).rejects.toThrow('incompatible')
  })

  it('preserves canonical state when a coordinator generation transition is invalid', async () => {
    const { context, coordinator, owner } = await fixture()
    await coordinator.start()
    const store = context.doppelgangerMemory.projectionStore
    const active = await store.activeGeneration('aiden')
    const incompatible = { ...owner, generationId: 'obsolete-generation' }
    expect(await store.activateGeneration(incompatible, { generationRevision: 1, activeGenerationRevision: active!.generationRevision, transitionToken: 'stale', transitionUntil: '2999-01-01T00:00:00.000Z' }, new Date().toISOString())).toBe(false)
    expect(await store.rollbackGeneration(incompatible, active!.generationRevision, new Date().toISOString())).toBe(false)
    expect(await store.activeGeneration('aiden')).toEqual(active)
    await coordinator.stop()
  })

  it('fences stale leases and routes identifier-only deletions by target', async () => {
    const { context, coordinator, owner } = await fixture()
    await coordinator.start()
    await coordinator.stop()
    const record = await context.doppelgangerMemory.remember({ operationId: 'lease-record', subjectKey: 'lease.record', kind: 'fact', content: 'Lease fencing.' })
    const corrected = await context.doppelgangerMemory.correct({ operationId: 'lease-correct', id: record.id, expectedRevisionId: record.revision.id, content: 'Lease fencing corrected.' })
    const store = context.doppelgangerMemory.projectionStore
    const first = await store.claim('delete', owner, 10, '2999-09-06T00:00:01.000Z', '2999-09-06T00:00:00.000Z')
    expect(first).toMatchObject({ recordId: record.id, revisionId: record.revision.id })
    await store.recoverLeases(owner, '2999-09-06T00:00:02.000Z')
    const second = await store.claim('delete', owner, 10, '2999-09-06T00:00:04.000Z', '2999-09-06T00:00:02.000Z')
    expect(second?.leaseToken).not.toBe(first?.leaseToken)
    expect(await store.acknowledgeDeletion(owner, first!, '2999-09-06T00:00:02.500Z')).toBe(false)
    const otherTarget = { ...owner, vectorTargetId: 'f'.repeat(64) }
    expect(await store.claim('delete', otherTarget, 10, '2999-09-06T00:00:05.000Z', '2999-09-06T00:00:02.500Z')).toBeUndefined()
    expect(await store.acknowledgeDeletion(owner, second!, '2999-09-06T00:00:03.000Z')).toBe(true)
    expect(corrected.revision.id).not.toBe(record.revision.id)
  })

  it('registers sanitized status, rebuild, rollback, and maintenance tools', async () => {
    const { context } = await fixture()
    await context.plugin(MemoryVectorCoordinatorPlugin, { pollIntervalMs: 5, batchSize: 2, retryBaseMs: 2, operationTimeoutMs: 100 })
    expect(context.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toEqual([
      'memory.semantic.maintenance',
      'memory.semantic.rebuild',
      'memory.semantic.rollback',
      'memory.semantic.status',
    ])
    const statusTool = context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.semantic.status')!
    const status = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: statusTool.name, toolRevision: statusTool.revision, input: {} }, 'test-session')
    expect(status).toMatchObject({ ok: true, value: { active: true, backend: 'sqlite_exact' } })
    expect(JSON.stringify(status)).not.toMatch(/content|password|secret/iu)
    const maintenanceTool = context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.semantic.maintenance')!
    expect(await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: maintenanceTool.name, toolRevision: maintenanceTool.revision, input: { kind: 'compact' } }, 'test-session'))
      .toMatchObject({ ok: true, value: { kind: 'compact', outcome: 'noop' } })
    const rollbackTool = context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.semantic.rollback')!
    expect(await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: rollbackTool.name, toolRevision: rollbackTool.revision, input: { generationId: 'unknown' } }, 'test-session'))
      .toMatchObject({ ok: false, error: { code: 'SEMANTIC_OPERATION_FAILED' } })
  })

  it('proves one exclusive maintenance operation while a second request overlaps', async () => {
    const { coordinator, index } = await fixture()
    const enteredGate = Promise.withResolvers<void>()
    const releaseGate = Promise.withResolvers<void>()
    index.maintenanceEntered = enteredGate.resolve
    index.maintenanceRelease = releaseGate.promise
    const first = coordinator.maintenance('compact')
    await enteredGate.promise
    await expect(coordinator.maintenance('compact')).resolves.toMatchObject({ outcome: 'already-running' })
    expect(index.maintenanceOperations).toBe(1)
    releaseGate.resolve()
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
