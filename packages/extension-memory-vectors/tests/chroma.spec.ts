import { runMemoryVectorBackendConformance } from './conformance.ts'

import { afterEach, describe, expect, it } from 'vitest'
import {
  ChromaAdapterError,
  ChromaMemoryVectorIndex,
  type ChromaClient,
  type ChromaCollection,
  type ChromaQueryResult,
  type ChromaUpsertEntry,
  type ChromaWhere,
} from '../src/chroma.ts'

const identity = { generationId: 'generation.one', recordId: 'record.one', revisionId: 'revision.one' }
const entry = (overrides: Partial<typeof identity & { instanceId: string; actorId: string; scopeKind: 'relationship' | 'project'; projectId?: string; kind: 'fact'; subjectKey: string; status: 'active'; vector: Float32Array }> = {}) => ({ ...identity,
instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' as const,
kind: 'fact' as const,
subjectKey: 'subject.one',
status: 'active' as const,
vector: new Float32Array([1, 0, 0]),
...overrides, })

class FakeChroma implements ChromaClient {
  readonly rows = new Map<string, Map<string, ChromaUpsertEntry>>()
  readonly whereCalls: ChromaWhere[] = []
  closed = false

  async createCollection(name: string): Promise<ChromaCollection> {
    const id = `collection:${name}`
    this.rows.set(id, this.rows.get(id) ?? new Map())
    return { id, name }
  }

  async getCollection(name: string): Promise<ChromaCollection | undefined> {
    const id = `collection:${name}`
    return this.rows.has(id) ? { id, name } : undefined
  }

  async upsert(collectionId: string, entries: readonly ChromaUpsertEntry[]): Promise<void> {
    const rows = this.rows.get(collectionId) ?? new Map<string, ChromaUpsertEntry>()
    for (const item of entries) rows.set(item.id, item)
    this.rows.set(collectionId, rows)
  }

  async delete(collectionId: string, ids: readonly string[]): Promise<void> {
    const rows = this.rows.get(collectionId)
    for (const id of ids) rows?.delete(id)
  }

  async query(collectionId: string, embedding: readonly number[], limit: number, where: ChromaWhere): Promise<ChromaQueryResult> {
    this.whereCalls.push(where)
    const predicates: readonly Readonly<Record<string, string>>[] = '$and' in where && Array.isArray(where.$and) ? where.$and : [where as Readonly<Record<string, string>>]
    const hits = [...(this.rows.get(collectionId)?.values() ?? [])].filter(item => predicates.every(predicate => Object.entries(predicate).every(([key, value]) => item.metadata[key] === value))).map(item => {
      const score = item.embedding.reduce((sum, value, index) => sum + value * (embedding[index] ?? 0), 0)
      return { item, distance: 1 - score }
    }).sort((left, right) => left.distance - right.distance || left.item.id.localeCompare(right.item.id)).slice(0, limit)
    return { ids: [hits.map(hit => hit.item.id)], distances: [hits.map(hit => hit.distance)], metadatas: [hits.map(hit => hit.item.metadata)] }
  }

  async count(collectionId: string): Promise<number> { return this.rows.get(collectionId)?.size ?? 0 }
  async heartbeat(): Promise<void> {}
  async deleteCollection(collectionName: string): Promise<void> { this.rows.delete(`collection:${collectionName}`) }
  async close(): Promise<void> { this.closed = true }
}

const indexes: ChromaMemoryVectorIndex[] = []
afterEach(async () => { await Promise.all(indexes.splice(0).map(index => index.close())) })

function make(client = new FakeChroma()): ChromaMemoryVectorIndex {
  const index = new ChromaMemoryVectorIndex({ endpoint: 'https://chroma.example.test:8000', dimensions: 3, tenant: 'tenant.one', database: 'db.one', collection: 'memory', tokenEnv: 'CHROMA_TOKEN', client })
  indexes.push(index)
  return index
}

describe('Chroma vector adapter', () => {
  it('uses explicit vectors, generation collections, portable filters, and deterministic ordering', async () => {
    const client = new FakeChroma()
    const index = make(client)
    await index.upsert([
      entry(),
      entry({ recordId: 'record.two', revisionId: 'revision.two', subjectKey: 'subject.two', vector: new Float32Array([0, 1, 0]) }),
      entry({ generationId: 'generation.other', recordId: 'record.other', revisionId: 'revision.other' }),
    ])
    await index.upsert([entry()])
    const hits = await index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' }, limit: 10 })
    expect(hits.map(hit => hit.recordId)).toEqual(['record.one', 'record.two'])
    expect(client.whereCalls[0]).toEqual({ $and: [{ generationId: 'generation.one' }, { instanceId: 'instance.one' }, { actorId: 'actor.one' }, { scopeKind: 'relationship' }, { projectId: '' }] })
    expect(await index.health()).toMatchObject({ state: 'healthy', backend: 'chroma', sanitizedTarget: 'https://chroma.example.test:8000/' })
  })

  it('rejects a malformed dimension batch before remote writes', async () => {
    const client = new FakeChroma()
    const index = make(client)
    await expect(index.upsert([entry(), entry({ recordId: 'invalid', vector: new Float32Array([1, 2]) })])).rejects.toMatchObject({ code: 'dimension' })
    expect(await index.health()).toMatchObject({ counts: { indexed: 0 } })
  })

  it('deletes idempotently, cleans a generation, and closes its client', async () => {
    const client = new FakeChroma()
    const index = make(client)
    await index.upsert([entry()])
    await index.delete([identity, identity])
    await index.upsert([entry()])
    expect((await index.maintenance('cleanup-generation')).outcome).toBe('noop')
    await index.close()
    expect(client.closed).toBe(true)
  })

  it('does not expose an indirect credential in identity or failures', async () => {
    const client = new FakeChroma()
    client.heartbeat = async () => { throw new ChromaAdapterError('unavailable', 'Chroma server is unavailable') }
    const index = make(client)
    expect(JSON.stringify(index.identity)).not.toContain('CHROMA_TOKEN')
    const health = await index.health()
    expect(JSON.stringify(health)).not.toContain('CHROMA_TOKEN')
  })

  it('contains partial responses, recovers health, and rejects operations after disposal', async () => {
    const client = new FakeChroma()
    const index = make(client)
    await index.upsert([entry()])
    const query = client.query.bind(client)
    client.query = async () => ({ ids: [['invalid']], distances: [[]], metadatas: [[null]] })
    await expect(index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 1 }))
      .rejects.toMatchObject({ code: 'partial-response' })
    client.query = query
    client.heartbeat = async () => { throw new ChromaAdapterError('unavailable', 'unavailable') }
    expect(await index.health()).toMatchObject({ state: 'unavailable', lastFailure: { code: 'backend' } })
    client.heartbeat = async () => {}
    expect(await index.health()).toMatchObject({ state: 'healthy' })
    await index.close()
    await expect(index.search({ generationId: 'generation.one', vector: new Float32Array([1, 0, 0]), filter: { instanceId: 'instance.one', actorId: 'actor.one' }, limit: 1 }))
      .rejects.toMatchObject({ code: 'unavailable' })
  })

  it('serializes concurrent generation cleanup', async () => {
    const client = new FakeChroma()
    const index = new ChromaMemoryVectorIndex({ endpoint: 'https://chroma.example.test', dimensions: 3, generationId: 'generation.one', client })
    indexes.push(index)
    await index.upsert([entry()])
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    client.deleteCollection = async () => { enter(); await blocked }
    const first = index.maintenance('cleanup-generation')
    await entered
    expect(await index.maintenance('cleanup-generation')).toMatchObject({ outcome: 'already-running' })
    release()
    expect(await first).toMatchObject({ outcome: 'ran' })
  })

  it('rejects unsupported maintenance explicitly', async () => {
    const index = make()
    await expect(index.maintenance('reindex')).rejects.toMatchObject({ code: 'UNSUPPORTED_MAINTENANCE' })
  })
})

runMemoryVectorBackendConformance('Chroma fake client', async ({ dimensions }) => new ChromaMemoryVectorIndex({ endpoint: 'https://chroma.example.test:8000', dimensions, client: new FakeChroma() }))
