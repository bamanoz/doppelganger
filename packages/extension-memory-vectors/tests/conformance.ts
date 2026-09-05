import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  MemoryVectorEntry,
  MemoryVectorIndex,
  MemoryVectorMaintenanceKind,
  MemoryVectorMaintenanceResult,
} from '@doppelganger/doppelganger-memory'

export interface MemoryVectorMaintenanceOverlapFixture {
  readonly kind: MemoryVectorMaintenanceKind
  run(): Promise<Readonly<{ first: MemoryVectorMaintenanceResult; competing: MemoryVectorMaintenanceResult; underlyingOperations: number }>>
}

export interface MemoryVectorBackendFixture {
  readonly root: string
  readonly dimensions: number
}

export type MemoryVectorBackendFactory = (context: MemoryVectorBackendFixture) => Promise<MemoryVectorIndex>

export type MemoryVectorMaintenanceOverlapFactory = (index: MemoryVectorIndex) => Promise<MemoryVectorMaintenanceOverlapFixture>

export interface MemoryVectorInitializationRaceFixture {
  readonly index: MemoryVectorIndex
  readonly operation: Promise<unknown>
  readonly started: Promise<void>
  release(): void
  closedCandidates(): number
}

export interface MemoryVectorInitializationLifecycle {
  disposeDuringInitialization?(context: MemoryVectorBackendFixture): Promise<MemoryVectorInitializationRaceFixture>
  createRetryable?(context: MemoryVectorBackendFixture): Promise<Readonly<{
    index: MemoryVectorIndex
    attempts(): number
    failedCandidateClosures(): number
    expectedFailedCandidateClosures: number
  }>>
}

/**
 * Run the backend contract shared by local and server-backed vector indexes.
 * A factory owns backend-specific configuration; `root` is a disposable fixture root.
 */
export function runMemoryVectorBackendConformance(
  name: string,
  createIndex: MemoryVectorBackendFactory,
  initializationLifecycle: MemoryVectorInitializationLifecycle = {},
  createMaintenanceOverlap?: MemoryVectorMaintenanceOverlapFactory,
): void {
  describe(`${name} vector backend conformance`, () => {
    const indexes: MemoryVectorIndex[] = []
    const roots: string[] = []

    afterEach(async () => {
      await Promise.all(indexes.splice(0).map(index => index.close()))
      await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
    })

    async function open(dimensions = 3): Promise<MemoryVectorIndex> {
      const root = await mkdtemp(join(tmpdir(), 'doppelganger-vector-conformance-'))
      roots.push(root)
      const index = await createIndex({ root, dimensions })
      indexes.push(index)
      return index
    }

    function basis(dimensions: number, activeIndex = 0): Float32Array {
      const vector = new Float32Array(dimensions)
      vector[activeIndex] = 1
      return vector
    }

    const makeEntry = (overrides: Partial<MemoryVectorEntry> = {}): MemoryVectorEntry => ({ generationId: 'generation.one',
    recordId: 'record.one',
    revisionId: 'revision.one',
    instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship',
    kind: 'fact',
    subjectKey: 'subject.one',
    status: 'active',
    vector: new Float32Array([1, 0, 0]),
    ...overrides, })

    const search = (index: MemoryVectorIndex, overrides: Partial<Parameters<MemoryVectorIndex['search']>[0]> = {}) => index.search({
      generationId: 'generation.one',
      vector: new Float32Array([1, 0, 0]),
      filter: { instanceId: 'instance.one', actorId: 'actor.one' },
      limit: 10,
      ...overrides,
    })

    it('accepts explicit vectors, enforces dimensions, and rolls back invalid batches', async () => {
      const index = await open()
      await expect(index.upsert([makeEntry({ vector: new Float32Array([1, 2]) })])).rejects.toThrow(/dimension/i)
      expect((await index.health()).counts?.indexed).toBe(0)
      await expect(index.upsert([makeEntry(), makeEntry({ recordId: 'bad', vector: new Float32Array([1, 2, Number.NaN]) })])).rejects.toThrow(/finite/i)
      expect((await index.health()).counts?.indexed).toBe(0)
      await index.upsert([makeEntry()])
      expect((await search(index)).map(hit => hit.recordId)).toEqual(['record.one'])
    })

    it('keeps dimensions parameterized and generation-isolated at 384', async () => {
      const index = await open(384)
      const vector = basis(384)
      expect(index.identity.dimensions).toBe(384)
      await expect(index.upsert([makeEntry({ vector: basis(383) })])).rejects.toThrow(/dimension/i)
      await index.upsert([
        makeEntry({ vector }),
        makeEntry({ generationId: 'generation.two', recordId: 'record.two', revisionId: 'revision.two', vector }),
      ])
      expect((await search(index, { vector })).map(hit => hit.recordId)).toEqual(['record.one'])
      expect((await search(index, { generationId: 'generation.two', vector })).map(hit => hit.recordId)).toEqual(['record.two'])
    })

    it('isolates generations and all required eligibility filters', async () => {
      const index = await open()
      await index.upsert([
        makeEntry(),
        makeEntry({ generationId: 'generation.two', recordId: 'other-generation', revisionId: 'revision.two' }),
        makeEntry({ recordId: 'other-instance', revisionId: 'revision.three', instanceId: 'instance.two' }),
        makeEntry({ recordId: 'other-actor', revisionId: 'revision.four', actorId: 'actor.two' }),
        makeEntry({ recordId: 'project', revisionId: 'revision.five', scopeKind: 'project', projectId: 'project.one' }),
        makeEntry({ recordId: 'different-project', revisionId: 'revision.six', scopeKind: 'project', projectId: 'project.two' }),
        makeEntry({ recordId: 'candidate', revisionId: 'revision.seven', status: 'candidate' }),
      ])
      expect((await search(index, { filter: { instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' } })).map(hit => hit.recordId)).toEqual(['candidate', 'record.one'])
      expect((await search(index, { filter: { instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'project', projectId: 'project.one' } })).map(hit => hit.recordId)).toEqual(['project'])
      expect((await search(index, { filter: { instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship', status: 'active' } })).map(hit => hit.recordId)).toEqual(['record.one'])
      expect(await search(index, { generationId: 'generation.two' })).toMatchObject([{ recordId: 'other-generation' }])
    })

    it('orders equal scores by canonical identity and applies top-K', async () => {
      const index = await open()
      await index.upsert([
        makeEntry({ recordId: 'record.z', revisionId: 'revision.z' }),
        makeEntry({ recordId: 'record.a', revisionId: 'revision.a' }),
        makeEntry({ recordId: 'record.m', revisionId: 'revision.m' }),
      ])
      expect((await search(index, { limit: 2 })).map(hit => hit.recordId)).toEqual(['record.a', 'record.m'])
      expect((await search(index, { limit: 10 })).map(hit => hit.recordId)).toEqual(['record.a', 'record.m', 'record.z'])
      expect((await search(index, { vector: new Float32Array([0, 1, 0]) })).map(hit => hit.recordId)).toEqual(['record.a', 'record.m', 'record.z'])
    })

    it('converges idempotent upserts and deletes', async () => {
      const index = await open()
      const value = makeEntry()
      await index.upsert([value, value])
      await index.upsert([value])
      expect((await index.health()).counts?.indexed).toBe(1)
      await index.delete([value, value])
      await index.delete([value])
      expect((await search(index)).length).toBe(0)
      expect((await index.health()).counts?.indexed).toBe(0)
    })

    it('reports health, supports declared maintenance, rejects unsupported operations, and closes', async () => {
      const index = await open()
      const health = await index.health()
      expect(health.state).toBe('healthy')
      for (const kind of index.supportedMaintenance) {
        const first = await index.maintenance(kind)
        expect(first.kind).toBe(kind)
        expect(['ran', 'noop']).toContain(first.outcome)
        const second = await index.maintenance(kind)
        expect(second.kind).toBe(kind)
        expect(['ran', 'noop']).toContain(second.outcome)
        expect(second.outcome).not.toBe('already-running')
      }
      const unsupported = (['compact', 'build-index', 'reindex', 'cleanup-generation'] as const).find(kind => !index.supportedMaintenance.includes(kind))
      if (unsupported !== undefined) await expect(index.maintenance(unsupported)).rejects.toMatchObject({ code: 'UNSUPPORTED_MAINTENANCE' })
      await index.close()
      await expect(index.health()).rejects.toThrow(/closed/iu)
      await expect(search(index)).rejects.toThrow(/closed/iu)
    })

    if (createMaintenanceOverlap !== undefined) {
      it('proves one exclusive maintenance operation while a second request overlaps', async () => {
        const index = await open()
        const overlap = await createMaintenanceOverlap(index)
        const result = await overlap.run()
        expect(result.first.kind).toBe(overlap.kind)
        expect(result.first.outcome).toBe('ran')
        expect(result.competing.kind).toBe(overlap.kind)
        expect(result.competing.outcome).toBe('already-running')
        expect(result.underlyingOperations).toBe(1)
      })
    }

    if (initializationLifecycle.disposeDuringInitialization !== undefined) {
      it('closes owned candidates when disposed during initialization', async () => {
        const root = await mkdtemp(join(tmpdir(), 'doppelganger-vector-conformance-'))
        roots.push(root)
        const fixture = await initializationLifecycle.disposeDuringInitialization!({ root, dimensions: 3 })
        indexes.push(fixture.index)
        await fixture.started
        const closing = fixture.index.close()
        fixture.release()
        await Promise.allSettled([fixture.operation, closing])
        expect(fixture.closedCandidates()).toBe(1)
        await expect(fixture.index.health()).rejects.toThrow(/closed/i)
        await fixture.index.close()
        expect(fixture.closedCandidates()).toBe(1)
      })
    }

    if (initializationLifecycle.createRetryable !== undefined) {
      it('retries initialization after a transient failure', async () => {
        const root = await mkdtemp(join(tmpdir(), 'doppelganger-vector-conformance-'))
        roots.push(root)
        const fixture = await initializationLifecycle.createRetryable!({ root, dimensions: 3 })
        indexes.push(fixture.index)
        expect((await fixture.index.health()).state).not.toBe('healthy')
        expect((await fixture.index.health()).state).toBe('healthy')
        expect(fixture.attempts()).toBe(2)
        expect(fixture.failedCandidateClosures()).toBe(fixture.expectedFailedCandidateClosures)
      })
    }
  })
}
