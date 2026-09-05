import { runMemoryVectorBackendConformance } from './conformance.ts'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createQdrantMemoryVectorIndex,
  qdrantPointId,
  type QdrantClientLike,
} from '../src/qdrant.ts'

const clients: FakeQdrant[] = []

const identity = { generationId: 'generation.one', recordId: 'record.one', revisionId: 'revision.one' }
const entry = (overrides: Partial<typeof identity & { instanceId: string; actorId: string; scopeKind: 'relationship' | 'project'; projectId?: string; kind: 'fact'; subjectKey: string; status: 'active'; vector: Float32Array }> = {}) => ({ ...identity, instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' as const,
kind: 'fact' as const, subjectKey: 'subject.one', status: 'active' as const, vector: new Float32Array([1, 0, 0]), ...overrides, })

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

class FakeQdrant implements QdrantClientLike {
  readonly points = new Map<string, { id: string; vector: number[]; payload: Record<string, unknown> }>()
  deleted = false
  closed = 0
  dimensions = 3
  async createCollection(_name: string, request: unknown): Promise<void> {
    this.dimensions = (request as { vectors: { size: number } }).vectors.size
  }
  async getCollection(): Promise<unknown> { return { config: { params: { vectors: { size: this.dimensions, distance: 'Cosine' } } } } }
  async upsert(_name: string, request: unknown): Promise<unknown> {
    const points = (request as { points: readonly { id: string; vector: number[]; payload: Record<string, unknown> }[] }).points
    for (const point of points) this.points.set(point.id, { ...point })
    return { status: 'completed' }
  }
  async delete(_name: string, request: unknown): Promise<void> {
    const value = request as { points?: readonly string[] }
    for (const id of value.points ?? []) this.points.delete(id)
  }
  async query(_name: string, request: unknown): Promise<unknown> {
    const query = request as { query: number[]; limit: number; filter: { must: readonly { key: string; match: { value: string } }[] } }
    const values = [...this.points.values()].filter(point => query.filter.must.every(condition => point.payload[condition.key] === condition.match.value)).map(point => ({ id: point.id, score: point.vector.reduce((sum, value, index) => sum + value * query.query[index]!, 0), payload: point.payload }))
    return { points: values.sort((left, right) => right.score - left.score).slice(0, query.limit) }
  }
  async count(): Promise<unknown> { return { count: this.points.size } }
  async deleteCollection(): Promise<void> { this.deleted = true; this.points.clear() }
  async close(): Promise<void> { this.closed += 1 }
}

runMemoryVectorBackendConformance('Qdrant fake', ({ dimensions }) => {
  const client = new FakeQdrant()
  clients.push(client)
  return createQdrantMemoryVectorIndex({ url: 'https://qdrant.fake.test', dimensions, namespace: `conformance_${clients.length}`, client })
}, {
  async disposeDuringInitialization({ dimensions }) {
    const client = new FakeQdrant()
    clients.push(client)
    const started = deferred<void>()
    const release = deferred<void>()
    client.getCollection = async () => {
      started.resolve()
      await release.promise
      return { config: { params: { vectors: { size: dimensions, distance: 'Cosine' } } } }
    }
    const index = await createQdrantMemoryVectorIndex({
      url: 'https://qdrant.fake.test',
      dimensions,
      namespace: `conformance_dispose_${clients.length}`,
      clientFactory: async () => client,
    })
    return {
      index,
      operation: index.health(),
      started: started.promise,
      release: () => { release.resolve() },
      closedCandidates: () => client.closed,
    }
  },
  async createRetryable({ dimensions }) {
    const client = new FakeQdrant()
    clients.push(client)
    let attempts = 0
    const index = await createQdrantMemoryVectorIndex({
      url: 'https://qdrant.fake.test',
      dimensions,
      namespace: `conformance_retry_${clients.length}`,
      clientFactory: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('transient Qdrant client construction failure')
        return client
      },
    })
    return {
      index,
      attempts: () => attempts,
      failedCandidateClosures: () => 0,
      expectedFailedCandidateClosures: 0,
    }
  },
}, async () => {
  const client = new FakeQdrant()
  clients.push(client)
  const index = await createQdrantMemoryVectorIndex({ url: 'https://qdrant.fake.test', dimensions: 3, generationId: 'generation.one', client })
  await index.health()
  const entered = deferred<void>()
  const release = deferred<void>()
  let underlyingOperations = 0
  client.delete = async (_name, request) => {
    if ('filter' in (request as object)) { underlyingOperations += 1; entered.resolve(); await release.promise }
  }
  return { kind: 'cleanup-generation', async run() { try { const first = index.maintenance('cleanup-generation'); await entered.promise; const competing = await index.maintenance('cleanup-generation'); release.resolve(); return { first: await first, competing, underlyingOperations } } finally { release.resolve(); await index.close() } } }
})

describe('Qdrant vector index', () => {
  afterEach(() => { clients.splice(0).forEach(client => { if (!client.deleted) client.deleted = true }) })

  it('retries one shared client construction after a transient factory rejection', async () => {
    const client = new FakeQdrant()
    clients.push(client)
    const retry = deferred<QdrantClientLike>()
    const retryStarted = deferred<void>()
    let attempts = 0
    const index = await createQdrantMemoryVectorIndex({
      url: 'https://qdrant.example.test',
      dimensions: 3,
      clientFactory: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('transient client factory failure')
        retryStarted.resolve()
        return retry.promise
      },
    })

    await expect(index.health()).resolves.toMatchObject({ state: 'unavailable' })
    const firstRetry = index.health()
    const secondRetry = index.health()
    await retryStarted.promise
    expect(attempts).toBe(2)
    retry.resolve(client)
    await expect(Promise.all([firstRetry, secondRetry])).resolves.toEqual([
      expect.objectContaining({ state: 'healthy' }),
      expect.objectContaining({ state: 'healthy' }),
    ])
    expect(attempts).toBe(2)
    await index.close()
    expect(client.closed).toBe(1)
  })

  it('closes a late owned client once when close wins client construction', async () => {
    const client = new FakeQdrant()
    clients.push(client)
    let collectionCreates = 0
    client.createCollection = async () => { collectionCreates += 1 }
    const construction = deferred<QdrantClientLike>()
    const started = deferred<void>()
    const index = await createQdrantMemoryVectorIndex({
      url: 'https://qdrant.example.test',
      dimensions: 3,
      clientFactory: async () => {
        started.resolve()
        return construction.promise
      },
    })
    const health = index.health()
    await started.promise
    const closing = index.close()
    expect(index.close()).toBe(closing)
    construction.resolve(client)

    await closing
    await expect(health).resolves.toMatchObject({ state: 'unavailable' })
    expect(client.closed).toBe(1)
    expect(collectionCreates).toBe(0)
    await index.close()
    expect(client.closed).toBe(1)
  })

  it('does not commit collection readiness when close wins metadata validation', async () => {
    const client = new FakeQdrant()
    clients.push(client)
    const metadataEntered = deferred<void>()
    const metadataRelease = deferred<void>()
    client.getCollection = async () => {
      metadataEntered.resolve()
      await metadataRelease.promise
      return { config: { params: { vectors: { size: 3, distance: 'Cosine' } } } }
    }
    const index = await createQdrantMemoryVectorIndex({
      url: 'https://qdrant.example.test',
      dimensions: 3,
      cleanupOnClose: true,
      clientFactory: async () => client,
    })
    const health = index.health()
    await metadataEntered.promise
    let closed = false
    const closing = index.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    metadataRelease.resolve()

    await closing
    await expect(health).resolves.toMatchObject({ state: 'unavailable' })
    expect(client.deleted).toBe(false)
    expect(client.closed).toBe(1)
  })

  it('creates cosine collection, filters payload, and converges idempotent writes/deletes', async () => {
    const client = new FakeQdrant(); clients.push(client)
    const index = await createQdrantMemoryVectorIndex({ url: 'https://qdrant.example.test:6333/?api_key=secret', dimensions: 3, namespace: 'test', apiKeyEnv: 'QDRANT_KEY', cleanupOnClose: true, client })
    await index.upsert([entry(), entry(), entry({ recordId: 'record.two', revisionId: 'revision.two', vector: new Float32Array([0, 1, 0]) })])
    expect(client.points.size).toBe(2)
    expect((await index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 10 })).map(hit => hit.recordId)).toEqual(['record.one', 'record.two'])
    expect((await index.health()).counts?.indexed).toBe(2)
    await index.delete([identity, identity])
    expect(client.points.size).toBe(1)
    await index.close()
    expect(client.deleted).toBe(true)
  })

  it('rejects dimensions before writing and exposes deterministic UUID IDs without credentials', async () => {
    const client = new FakeQdrant(); clients.push(client)
    const index = await createQdrantMemoryVectorIndex({ url: 'https://user:password@qdrant.example.test:6333', dimensions: 3, client })
    await expect(index.upsert([entry({ vector: new Float32Array([1, 2]) })])).rejects.toThrow(/dimensions/i)
    expect(client.points.size).toBe(0)
    expect(qdrantPointId(identity)).toMatch(/^[0-9a-f-]{36}$/)
    expect(index.identity.sanitizedTarget).not.toMatch(/password|secret/i)
    await index.close()
  })
  it('contains malformed responses, recovers availability, and rejects operations after disposal', async () => {
    const client = new FakeQdrant(); clients.push(client)
    const getCollection = client.getCollection.bind(client)
    client.getCollection = async () => { throw new Error('credential-bearing unavailable response') }
    const index = await createQdrantMemoryVectorIndex({ url: 'https://qdrant.example.test', dimensions: 3, client })
    expect(await index.health()).toMatchObject({ state: 'unavailable', lastFailure: { code: 'backend' } })
    client.getCollection = getCollection
    expect(await index.health()).toMatchObject({ state: 'healthy' })
    client.query = async () => ({ points: [{ id: 'invalid', score: 1, payload: {} }] })
    await expect(index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 1 }))
      .rejects.toMatchObject({ code: 'malformed-response' })
    await index.close()
    await expect(index.upsert([entry()])).rejects.toMatchObject({ code: 'backend' })
  })

  it('serializes concurrent generation cleanup', async () => {
    const client = new FakeQdrant(); clients.push(client)
    const index = await createQdrantMemoryVectorIndex({ url: 'https://qdrant.example.test', dimensions: 3, generationId: 'generation.one', client })
    await index.health()
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    client.delete = async (_name, request) => {
      if ('filter' in (request as object)) { enter(); await blocked }
    }
    const first = index.maintenance('cleanup-generation')
    await entered
    expect(await index.maintenance('cleanup-generation')).toMatchObject({ outcome: 'already-running' })
    release()
    expect(await first).toMatchObject({ outcome: 'ran' })
    await index.close()
  })
})
