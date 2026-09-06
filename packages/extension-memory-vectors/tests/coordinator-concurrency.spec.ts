import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import {
  MemoryService,
  PostgresqlMemoryPlugin,
  SqliteMemoryPlugin,
  memoryProjectionOwner,
  memorySemanticGenerationId,
  type MemoryEmbedder,
  type MemoryProjectionOwner,
  type MemoryVectorEntry,
  type MemoryVectorHealth,
  type MemoryVectorIdentity,
  type MemoryVectorIndex,
  type MemoryVectorMaintenanceKind,
  type MemoryVectorMaintenanceResult,
  type MemoryVectorSearchRequest,
} from '@doppelganger/doppelganger-memory'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { MemoryVectorCoordinator } from '../src/coordinator.ts'

const POSTGRESQL_TEST_DSN_ENV = 'DOPPELGANGER_TEST_POSTGRESQL_DSN'
const BASE = '2026-01-01T00:00:00.000Z'
const LEASE = '2026-01-01T00:01:00.000Z'
const LATER = '2026-01-01T00:02:00.000Z'
const TRANSITION = '2026-01-01T00:10:00.000Z'
const BACKENDS = ['sqlite', 'postgresql'] as const

type BackendKind = (typeof BACKENDS)[number]

interface BackendHarness {
  createCoordinator(context: Context): MemoryVectorCoordinator
  createContext(options: ContextOptions): Promise<Context>
  disposeContext(context: Context): Promise<void>
  close(): Promise<void>
}

interface ContextOptions {
  readonly instanceId: string
  readonly sessionId: string
  readonly embedder?: MemoryEmbedder
  readonly index?: MemoryVectorIndex
}

function embedder(revision: string): MemoryEmbedder {
  return Object.freeze({
    identity: Object.freeze({
      provider: 'concurrency-test',
      modelId: 'concurrency-model',
      revision,
      artifactDigest: `sha256:${revision.repeat(64).slice(0, 64)}`,
      pooling: 'mean',
      projection: 'none',
      dimensions: 3,
      normalized: true,
      distanceMetric: 'cosine' as const,
    }),
    async embedDocuments(texts: readonly string[]) {
      return texts.map(() => new Float32Array([1, 0, 0]))
    },
    async embedQuery() {
      return new Float32Array([1, 0, 0])
    },
  })
}

class SharedIndex implements MemoryVectorIndex {
  readonly identity: MemoryVectorIndex['identity']
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[] = Object.freeze(['compact'])
  readonly entries: Map<string, MemoryVectorEntry>
  readonly deletions: MemoryVectorIdentity[][] = []

  beforeUpsert: (() => Promise<void>) | undefined
  constructor(target: string, entries = new Map<string, MemoryVectorEntry>()) {
    this.identity = Object.freeze({
      backend: 'sqlite_exact' as const,
      namespace: 'coordinator-concurrency',
      sanitizedTarget: `target-${target}`,
      configFingerprint: target.repeat(64),
      dimensions: 3,
      distanceMetric: 'cosine' as const,
    })
    this.entries = entries
  }

  async upsert(entries: readonly MemoryVectorEntry[]): Promise<void> {
    if (this.beforeUpsert !== undefined) await this.beforeUpsert()
    for (const entry of entries) this.entries.set(`${entry.generationId}/${entry.recordId}/${entry.revisionId}`, entry)
  }

  async delete(identities: readonly MemoryVectorIdentity[]): Promise<void> {
    this.deletions.push(identities.map(identity => ({ ...identity })))
    for (const identity of identities) this.entries.delete(`${identity.generationId}/${identity.recordId}/${identity.revisionId}`)
  }

  async search(_request: MemoryVectorSearchRequest) {
    return Object.freeze([])
  }

  async health(): Promise<MemoryVectorHealth> {
    return Object.freeze({
      state: 'healthy',
      checkedAt: new Date().toISOString(),
      backend: this.identity.backend,
      sanitizedTarget: this.identity.sanitizedTarget,
      counts: { indexed: this.entries.size, current: this.entries.size, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 },
    })
  }

  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    const timestamp = new Date().toISOString()
    return Object.freeze({ kind, outcome: 'noop', startedAt: timestamp, completedAt: timestamp })
  }

  async close(): Promise<void> {}
}

function owner(instanceId: string, selectedEmbedder: MemoryEmbedder, index: MemoryVectorIndex): MemoryProjectionOwner {
  return memoryProjectionOwner(
    instanceId,
    memorySemanticGenerationId(instanceId, selectedEmbedder.identity, index.identity),
    selectedEmbedder.identity,
    index.identity,
  )
}

async function activate(
  context: Context,
  projectionOwner: MemoryProjectionOwner,
  selectedEmbedder: MemoryEmbedder,
  index: MemoryVectorIndex,
): Promise<void> {
  const store = context.doppelgangerMemory.projectionStore
  let transition = await store.prepareGeneration(
    projectionOwner,
    JSON.stringify(selectedEmbedder.identity),
    JSON.stringify(index.identity),
    BASE,
    TRANSITION,
  )
  if (transition === undefined) throw new Error('test generation transition was not acquired')
  let lastId: string | undefined
  for (;;) {
    const page = await store.rebuildPage(projectionOwner, transition, lastId, 100, BASE)
    if (page.length === 0) break
    const renewed = await store.markRebuildPage(projectionOwner, transition, page, BASE, TRANSITION)
    if (renewed === undefined) throw new Error('test generation transition expired')
    transition = renewed
    lastId = page.at(-1)!.id
  }
  if (!(await store.activateGeneration(projectionOwner, transition, BASE))) throw new Error('test generation was not activated')
}

function quotedSchema(schema: string): string {
  if (!/^dg_vector_[a-f0-9]{32}$/u.test(schema)) throw new Error('invalid test schema')
  return `"${schema}"`
}

async function createBackend(kind: BackendKind): Promise<BackendHarness> {
  const contexts = new Set<Context>()
  const coordinators = new Set<MemoryVectorCoordinator>()
  const sqliteHome = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'doppelganger-vector-concurrency-')) : undefined
  const connectionString = kind === 'postgresql' ? process.env[POSTGRESQL_TEST_DSN_ENV]?.trim() : undefined
  if (kind === 'postgresql' && !connectionString) throw new Error(`${POSTGRESQL_TEST_DSN_ENV} is required for PostgreSQL coordinator concurrency tests`)
  const schema = kind === 'postgresql' ? `dg_vector_${randomUUID().replaceAll('-', '')}` : undefined
  const control = kind === 'postgresql' ? new Client({ connectionString }) : undefined
  try {
    if (control !== undefined) {
      await control.connect()
      const version = await control.query<{ server_major: number }>('SELECT current_setting(\'server_version_num\')::integer / 10000 AS server_major')
      if (version.rows[0]?.server_major !== 17) throw new Error('PostgreSQL coordinator concurrency tests require PostgreSQL 17')
      await control.query(`CREATE SCHEMA ${quotedSchema(schema!)}`)
    }
  } catch (error) {
    await control?.end().catch(() => undefined)
    if (sqliteHome !== undefined) await rm(sqliteHome, { recursive: true, force: true })
    throw error
  }

  async function disposeContext(context: Context): Promise<void> {
    if (!contexts.delete(context)) return
    await context.fiber.dispose()
  }

  return {
    createCoordinator(context) {
      const coordinator = new MemoryVectorCoordinator(context, { pollIntervalMs: 5, operationTimeoutMs: 5_000 })
      coordinators.add(coordinator)
      return coordinator
    },
    async createContext(options) {
      const context = new Context()
      try {
        await context.plugin(createPersonaActivationPlugin({
          instanceId: options.instanceId,
          sessionId: options.sessionId,
          projectId: 'coordinator-concurrency',
          projectRoot: join(sqliteHome ?? tmpdir(), `${options.instanceId}-${options.sessionId}`),
        }))
        await context.plugin(createActorIdentityPlugin('concurrency-actor'))
        if (kind === 'sqlite') {
          await context.plugin(SqliteMemoryPlugin, { home: sqliteHome! })
        } else {
          await context.plugin(PostgresqlMemoryPlugin, {
            connectionStringEnv: POSTGRESQL_TEST_DSN_ENV,
            schema: schema!,
            poolSize: 4,
            connectionTimeoutMs: 5_000,
            statementTimeoutMs: 30_000,
            lockTimeoutMs: 5_000,
          })
        }
        await context.plugin(MemoryService, { now: () => new Date(BASE) })
        if (options.embedder !== undefined && options.index !== undefined) {
          const services: Plugin = {
            name: `coordinator-concurrency-services-${options.sessionId}`,
            apply(ctx) {
              ctx.provide('doppelgangerMemoryEmbedder', options.embedder!)
              ctx.provide('doppelgangerMemoryVectorIndex', options.index!)
            },
          }
          await context.plugin(services)
        }
        contexts.add(context)
        return context
      } catch (error) {
        await context.fiber.dispose().catch(() => undefined)
        throw error
      }
    },
    disposeContext,
    async close() {
      await Promise.allSettled([...coordinators].map(coordinator => coordinator.stop()))
      const disposed = await Promise.allSettled([...contexts].reverse().map(disposeContext))
      if (control !== undefined) {
        if (schema !== undefined) await control.query(`DROP SCHEMA IF EXISTS ${quotedSchema(schema)} CASCADE`)
        await control.end()
      }
      if (sqliteHome !== undefined) await rm(sqliteHome, { recursive: true, force: true })
      const failure = disposed.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    },
  }
}

async function onBothBackends(run: (backend: BackendHarness, kind: BackendKind) => Promise<void>): Promise<void> {
  await Promise.all(BACKENDS.map(async kind => {
    const backend = await createBackend(kind)
    try {
      await run(backend, kind)
    } finally {
      await backend.close()
    }
  }))
}

describe('memory vector coordinator concurrency', () => {
  it('routes shared-store work by instance generation and target', async () => {
    await onBothBackends(async backend => {
      const firstEmbedder = embedder('a')
      const secondEmbedder = embedder('b')
      const firstIndex = new SharedIndex('c')
      const secondIndex = new SharedIndex('d')
      const first = await backend.createContext({ instanceId: 'instance-a', sessionId: 'route-a', embedder: firstEmbedder, index: firstIndex })
      const second = await backend.createContext({ instanceId: 'instance-b', sessionId: 'route-b', embedder: secondEmbedder, index: secondIndex })
      const firstOwner = owner('instance-a', firstEmbedder, firstIndex)
      const secondOwner = owner('instance-b', secondEmbedder, secondIndex)
      await activate(first, firstOwner, firstEmbedder, firstIndex)
      await activate(second, secondOwner, secondEmbedder, secondIndex)
      const firstRecord = await first.doppelgangerMemory.remember({ operationId: 'route-a-record', subjectKey: 'route.a', kind: 'fact', content: 'First route.' })
      const secondRecord = await second.doppelgangerMemory.remember({ operationId: 'route-b-record', subjectKey: 'route.b', kind: 'fact', content: 'Second route.' })
      expect(await first.doppelgangerMemory.projectionStore.claim('upsert', { ...firstOwner, generationId: secondOwner.generationId }, 10, LEASE, BASE)).toBeUndefined()
      const firstCoordinator = backend.createCoordinator(first)
      const secondCoordinator = backend.createCoordinator(second)
      await Promise.all([firstCoordinator.start(), secondCoordinator.start()])
      await Promise.all([firstCoordinator.stop(), secondCoordinator.stop()])
      expect(firstIndex.entries.has(`${firstOwner.generationId}/${firstRecord.id}/${firstRecord.revision.id}`)).toBe(true)
      expect(firstIndex.entries.has(`${secondOwner.generationId}/${secondRecord.id}/${secondRecord.revision.id}`)).toBe(false)
      expect(secondIndex.entries.has(`${secondOwner.generationId}/${secondRecord.id}/${secondRecord.revision.id}`)).toBe(true)
      expect(secondIndex.entries.has(`${firstOwner.generationId}/${firstRecord.id}/${firstRecord.revision.id}`)).toBe(false)
      expect(await first.doppelgangerMemory.forget({ operationId: 'route-a-forget', id: firstRecord.id })).toBe(true)
      expect(await second.doppelgangerMemory.projectionStore.claim('delete', { ...firstOwner, vectorTargetId: secondOwner.vectorTargetId }, 10, LEASE, BASE)).toBeUndefined()
      await firstCoordinator.start()
      await firstCoordinator.stop()
      const forgotten = { generationId: firstOwner.generationId, recordId: firstRecord.id, revisionId: firstRecord.revision.id }
      expect(firstIndex.deletions.flat()).toContainEqual(expect.objectContaining(forgotten))
      expect(secondIndex.deletions.flat()).not.toContainEqual(expect.objectContaining(forgotten))
      expect(firstIndex.entries.has(`${firstOwner.generationId}/${firstRecord.id}/${firstRecord.revision.id}`)).toBe(false)
    })
  })

  it('fences retry and acknowledgment with the current lease token', async () => {
    await onBothBackends(async backend => {
      const selectedEmbedder = embedder('a')
      const index = new SharedIndex('c')
      const first = await backend.createContext({ instanceId: 'lease-instance', sessionId: 'lease-first' })
      const second = await backend.createContext({ instanceId: 'lease-instance', sessionId: 'lease-second' })
      const projectionOwner = owner('lease-instance', selectedEmbedder, index)
      await activate(first, projectionOwner, selectedEmbedder, index)
      const record = await first.doppelgangerMemory.remember({ operationId: 'lease-record', subjectKey: 'lease.record', kind: 'fact', content: 'Lease fencing.' })
      const stale = await first.doppelgangerMemory.projectionStore.claim('upsert', projectionOwner, 10, LEASE, BASE)
      await second.doppelgangerMemory.projectionStore.recoverLeases(projectionOwner, LATER)
      const current = await second.doppelgangerMemory.projectionStore.claim('upsert', projectionOwner, 10, TRANSITION, LATER)
      expect(current).toMatchObject({ recordId: record.id, revisionId: record.revision.id })
      expect(current?.leaseToken).not.toBe(stale?.leaseToken)
      const [retried, acknowledged] = await Promise.all([
        first.doppelgangerMemory.projectionStore.retry('upsert', projectionOwner, stale!, TRANSITION, 'backend', LATER),
        first.doppelgangerMemory.projectionStore.acknowledgeUpsert(projectionOwner, stale!, LATER),
      ])
      expect(retried).toBe(false)
      expect(acknowledged).toBe(false)
      expect(await second.doppelgangerMemory.projectionStore.source(projectionOwner, current!, LATER)).toMatchObject({ recordId: record.id })
      expect(await second.doppelgangerMemory.projectionStore.acknowledgeUpsert(projectionOwner, current!, LATER)).toBe(true)
    })
  })

  it('persists generation activation across concurrent canonical clients', async () => {
    await onBothBackends(async backend => {
      const selectedEmbedder = embedder('a')
      const index = new SharedIndex('c')
      const first = await backend.createContext({ instanceId: 'activation-instance', sessionId: 'activation-first', embedder: selectedEmbedder, index })
      const second = await backend.createContext({ instanceId: 'activation-instance', sessionId: 'activation-second', embedder: selectedEmbedder, index })
      await first.doppelgangerMemory.remember({ operationId: 'activation-record', subjectKey: 'activation.record', kind: 'fact', content: 'Persist activation.' })
      const firstCoordinator = backend.createCoordinator(first)
      const secondCoordinator = backend.createCoordinator(second)
      await Promise.all([firstCoordinator.start(), secondCoordinator.start()])
      const projectionOwner = owner('activation-instance', selectedEmbedder, index)
      expect(await first.doppelgangerMemory.projectionStore.activeGeneration('activation-instance')).toMatchObject({ generationId: projectionOwner.generationId })
      expect(await second.doppelgangerMemory.projectionStore.activeGeneration('activation-instance')).toMatchObject({ generationId: projectionOwner.generationId })
      expect((await secondCoordinator.status()).active).toBe(true)
      await Promise.all([firstCoordinator.stop(), secondCoordinator.stop()])
    })
  })

  it('requires an explicit rebuild to replace an incompatible committed generation', async () => {
    await onBothBackends(async backend => {
      const entries = new Map<string, MemoryVectorEntry>()
      const firstEmbedder = embedder('a')
      const secondEmbedder = embedder('b')
      const firstIndex = new SharedIndex('c', entries)
      const secondIndex = new SharedIndex('c', entries)
      const first = await backend.createContext({ instanceId: 'replacement-instance', sessionId: 'replacement-first', embedder: firstEmbedder, index: firstIndex })
      const second = await backend.createContext({ instanceId: 'replacement-instance', sessionId: 'replacement-second', embedder: secondEmbedder, index: secondIndex })
      const record = await first.doppelgangerMemory.remember({ operationId: 'replacement-record', subjectKey: 'replacement.record', kind: 'fact', content: 'Explicit replacement.' })
      const firstOwner = owner('replacement-instance', firstEmbedder, firstIndex)
      const secondOwner = owner('replacement-instance', secondEmbedder, secondIndex)
      const firstCoordinator = backend.createCoordinator(first)
      const secondCoordinator = backend.createCoordinator(second)
      await firstCoordinator.start()
      await firstCoordinator.stop()
      expect(await second.doppelgangerMemory.projectionStore.activeGeneration('replacement-instance')).toMatchObject({ generationId: firstOwner.generationId })

      await secondCoordinator.start()
      expect((await secondCoordinator.status()).active).toBe(false)
      expect(await second.doppelgangerMemory.projectionStore.activeGeneration('replacement-instance')).toMatchObject({ generationId: firstOwner.generationId })
      expect(entries.has(`${secondOwner.generationId}/${record.id}/${record.revision.id}`)).toBe(false)

      await secondCoordinator.rebuild()
      expect((await secondCoordinator.status()).active).toBe(true)
      expect(await second.doppelgangerMemory.projectionStore.activeGeneration('replacement-instance')).toMatchObject({ generationId: secondOwner.generationId })
      expect(await second.doppelgangerMemory.projectionStore.generation(firstOwner)).toMatchObject({ state: 'retained' })
      expect(entries.has(`${secondOwner.generationId}/${record.id}/${record.revision.id}`)).toBe(true)
      await secondCoordinator.stop()
    })
  })

  it('serializes generation activation across concurrent coordinators', async () => {
    await onBothBackends(async backend => {
      const entries = new Map<string, MemoryVectorEntry>()
      const firstEmbedder = embedder('a')
      const secondEmbedder = embedder('b')
      const firstIndex = new SharedIndex('c', entries)
      const secondIndex = new SharedIndex('c', entries)
      const firstEntered = Promise.withResolvers<void>()
      const secondEntered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      firstIndex.beforeUpsert = async () => { firstEntered.resolve(); await release.promise }
      secondIndex.beforeUpsert = async () => { secondEntered.resolve(); await release.promise }
      const first = await backend.createContext({ instanceId: 'cas-instance', sessionId: 'cas-first', embedder: firstEmbedder, index: firstIndex })
      const second = await backend.createContext({ instanceId: 'cas-instance', sessionId: 'cas-second', embedder: secondEmbedder, index: secondIndex })
      await first.doppelgangerMemory.remember({ operationId: 'cas-record', subjectKey: 'cas.record', kind: 'fact', content: 'Serialize activation.' })
      const firstCoordinator = backend.createCoordinator(first)
      const secondCoordinator = backend.createCoordinator(second)
      const firstStart = firstCoordinator.start()
      const secondStart = secondCoordinator.start()
      await Promise.all([firstEntered.promise, secondEntered.promise])
      release.resolve()
      const results = await Promise.allSettled([firstStart, secondStart])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      const active = await first.doppelgangerMemory.projectionStore.activeGeneration('cas-instance')
      const firstOwner = owner('cas-instance', firstEmbedder, firstIndex)
      const secondOwner = owner('cas-instance', secondEmbedder, secondIndex)
      expect([firstOwner.generationId, secondOwner.generationId]).toContain(active?.generationId)
      const inactiveOwner = active?.generationId === firstOwner.generationId ? secondOwner : firstOwner
      expect(await second.doppelgangerMemory.projectionStore.generation(inactiveOwner)).toMatchObject({ state: 'failed' })
      expect(new Set([...entries.values()].map(entry => entry.generationId))).toEqual(new Set([firstOwner.generationId, secondOwner.generationId]))
      await Promise.all([firstCoordinator.stop(), secondCoordinator.stop()])
    })
  })

  it('recovers expired work after restart and cleans retained generations', async () => {
    await onBothBackends(async backend => {
      const entries = new Map<string, MemoryVectorEntry>()
      const firstEmbedder = embedder('a')
      const secondEmbedder = embedder('b')
      const firstIndex = new SharedIndex('c', entries)
      const secondIndex = new SharedIndex('c', entries)
      const first = await backend.createContext({ instanceId: 'restart-instance', sessionId: 'restart-first', embedder: firstEmbedder, index: firstIndex })
      const firstRecord = await first.doppelgangerMemory.remember({ operationId: 'restart-first-record', subjectKey: 'restart.first', kind: 'fact', content: 'First generation.' })
      const firstCoordinator = backend.createCoordinator(first)
      await firstCoordinator.start()
      await firstCoordinator.stop()
      const firstOwner = owner('restart-instance', firstEmbedder, firstIndex)
      expect(entries.has(`${firstOwner.generationId}/${firstRecord.id}/${firstRecord.revision.id}`)).toBe(true)
      await backend.disposeContext(first)

      const second = await backend.createContext({ instanceId: 'restart-instance', sessionId: 'restart-second', embedder: secondEmbedder, index: secondIndex })
      const secondCoordinator = backend.createCoordinator(second)
      await secondCoordinator.start()
      const secondOwner = owner('restart-instance', secondEmbedder, secondIndex)
      expect((await secondCoordinator.status()).active).toBe(false)
      expect(await second.doppelgangerMemory.projectionStore.activeGeneration('restart-instance')).toMatchObject({ generationId: firstOwner.generationId })
      await secondCoordinator.rebuild()
      await secondCoordinator.stop()
      expect(await second.doppelgangerMemory.projectionStore.generation(firstOwner)).toMatchObject({ state: 'retained' })
      const queued = await second.doppelgangerMemory.remember({ operationId: 'restart-queued-record', subjectKey: 'restart.queued', kind: 'fact', content: 'Recover after restart.' })
      expect(await second.doppelgangerMemory.projectionStore.claim('upsert', secondOwner, 10, LEASE, BASE)).toMatchObject({ recordId: queued.id })
      await backend.disposeContext(second)

      const restartedIndex = new SharedIndex('c', entries)
      const restarted = await backend.createContext({ instanceId: 'restart-instance', sessionId: 'restart-third', embedder: secondEmbedder, index: restartedIndex })
      const restartedCoordinator = backend.createCoordinator(restarted)
      await restartedCoordinator.start()
      expect(entries.has(`${secondOwner.generationId}/${queued.id}/${queued.revision.id}`)).toBe(true)
      await expect(restartedCoordinator.maintenance('cleanup-generation')).resolves.toMatchObject({ outcome: 'ran' })
      expect(await restarted.doppelgangerMemory.projectionStore.generation(firstOwner)).toBeUndefined()
      expect(await restarted.doppelgangerMemory.projectionStore.activeGeneration('restart-instance')).toMatchObject({ generationId: secondOwner.generationId })
      expect([...entries.values()].some(entry => entry.generationId === firstOwner.generationId)).toBe(false)
      await restartedCoordinator.stop()
    })
  })
})
