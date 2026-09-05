import { describe, expect, it } from 'vitest'
import {
  createPgVectorMemoryVectorIndex,
  type PgVectorConfig,
  type PgVectorRuntime,
} from '../src/pgvector.ts'
import {
  FakePgVectorPool,
  fakePgVectorRuntime,
  StatefulFakePgVectorPool,
} from './fixtures/pgvector.ts'
import { runMemoryVectorBackendConformance } from './conformance.ts'

const secretDsn = 'postgresql://admin:very-secret@database.internal/memory'
const identity = { generationId: 'generation.one', recordId: 'record.one', revisionId: 'revision.one' }
const entry = (overrides: Partial<typeof identity & {
  instanceId: string
  actorId: string
  scopeKind: 'relationship' | 'project'
  projectId?: string
  kind: 'fact'
  subjectKey: string
  status: 'active'
  vector: Float32Array
}> = {}) => ({ ...identity,
instanceId: 'instance.one', actorId: 'actor.one', scopeKind: 'relationship' as const,
kind: 'fact' as const,
subjectKey: 'subject.one',
status: 'active' as const,
vector: new Float32Array([1, 0, 0]),
...overrides, })

function config(pool: FakePgVectorPool, overrides: Partial<PgVectorConfig> = {}): PgVectorConfig {
  return {
    dsnEnv: 'TEST_PGVECTOR_DSN',
    dimensions: 3,
    namespace: 'persona.one/generation.one',
    environment: { TEST_PGVECTOR_DSN: secretDsn },
    runtimeLoader: () => Promise.resolve(fakePgVectorRuntime(pool)),
    ...overrides,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('pgvector vector index', () => {
  it('waits for delayed runtime acquisition to settle before close completes', async () => {
    const loading = deferred<PgVectorRuntime>()
    const started = deferred<void>()
    const pool = new FakePgVectorPool()
    const index = await createPgVectorMemoryVectorIndex(config(pool, {
      runtimeLoader: async () => {
        started.resolve()
        return loading.promise
      },
    }))
    const operation = index.upsert([entry()]).catch((error: unknown) => error)
    await started.promise
    let closed = false
    const closing = index.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    loading.resolve(fakePgVectorRuntime(pool))

    await closing
    expect(await operation).toEqual(expect.objectContaining({ code: 'PGVECTOR_BACKEND' }))
    expect(pool.queries).toHaveLength(0)
    expect(pool.ended).toBe(false)
    await index.close()
  })

  it('ends a setup candidate once when close wins during schema initialization', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    let ends = 0
    let pool!: FakePgVectorPool
    pool = new FakePgVectorPool(async text => {
      if (text.includes('CREATE EXTENSION')) {
        entered.resolve()
        await release.promise
      }
      if (pool.ended) throw new Error('query after pool end')
      return { rows: [] }
    })
    const originalEnd = pool.end.bind(pool)
    pool.end = async () => {
      ends += 1
      await originalEnd()
    }
    const index = await createPgVectorMemoryVectorIndex(config(pool))
    const operation = index.upsert([entry()]).catch((error: unknown) => error)
    await entered.promise
    const closing = index.close()
    release.resolve()

    await closing
    expect(await operation).toEqual(expect.objectContaining({ code: 'PGVECTOR_BACKEND' }))
    expect(ends).toBe(1)
    expect(pool.queries).toHaveLength(1)
    await index.close()
    expect(ends).toBe(1)
  })

  it('retries initialization after setup failure without publishing the failed pool', async () => {
    let firstEnds = 0
    let secondEnds = 0
    const first = new FakePgVectorPool(() => { throw new Error('transient setup failure') })
    const firstEnd = first.end.bind(first)
    first.end = async () => {
      firstEnds += 1
      await firstEnd()
    }
    const second = new FakePgVectorPool()
    const secondEnd = second.end.bind(second)
    second.end = async () => {
      secondEnds += 1
      await secondEnd()
    }
    let attempts = 0
    const index = await createPgVectorMemoryVectorIndex(config(first, {
      runtimeLoader: async () => fakePgVectorRuntime(attempts++ === 0 ? first : second),
    }))

    await expect(index.upsert([entry()])).rejects.toMatchObject({ code: 'PGVECTOR_BACKEND' })
    expect(firstEnds).toBe(1)
    expect(second.queries).toHaveLength(0)
    await expect(index.upsert([entry()])).resolves.toBeUndefined()
    expect(attempts).toBe(2)
    expect(second.queries.some(query => query.text.includes('CREATE TABLE'))).toBe(true)
    await index.close()
    expect(firstEnds).toBe(1)
    expect(secondEnds).toBe(1)
  })

  it('uses hashed quoted storage names, explicit vectors, and idempotent parameterized mutations', async () => {
    const pool = new FakePgVectorPool()
    const index = await createPgVectorMemoryVectorIndex(config(pool))
    expect(index.identity).toMatchObject({
      backend: 'pgvector',
      namespace: 'persona.one/generation.one',
      sanitizedTarget: 'PostgreSQL DSN from TEST_PGVECTOR_DSN',
      dimensions: 3,
      distanceMetric: 'cosine',
    })

    await index.upsert([entry({ subjectKey: "subject'; DROP TABLE memory; --" })])
    await index.upsert([entry()])
    await index.delete([identity, identity])

    const sql = pool.queries.map(query => query.text).join('\n')
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS "doppelganger_[a-f0-9]{24}"/u)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "doppelganger_[a-f0-9]{24}"\."memory_vectors_[a-f0-9]{24}"/u)
    expect(sql).toContain('ON CONFLICT (vector_id) DO UPDATE')
    expect(sql).toContain('$12::vector')
    expect(sql).not.toContain("subject'; DROP TABLE")
    expect(pool.queries.some(query => query.values.includes("subject'; DROP TABLE memory; --"))).toBe(true)
    expect(pool.queries.some(query => query.values.includes('[1,0,0]'))).toBe(true)
    expect(pool.released).toBe(4)
    expect(JSON.stringify(index)).not.toContain('very-secret')
    await index.close()
    expect(pool.ended).toBe(true)
  })

  it('migrates a principal-partition table to actor schema version two transactionally', async () => {
    const pool = new FakePgVectorPool((text) => {
      if (text.includes('SELECT schema_version')) return { rows: [{ schema_version: 1 }] }
      if (text.includes('information_schema.columns')) return { rows: [{ column_name: 'principal_id' }] }
      if (text.includes('SELECT COUNT(*)')) return { rows: [{ count: '0' }] }
      return { rows: [] }
    })
    const index = await createPgVectorMemoryVectorIndex(config(pool))

    await expect(index.upsert([entry({ actorId: 'persisted-actor' })])).resolves.toBeUndefined()

    const sql = pool.queries.map(query => query.text).join('\n')
    expect(sql).toContain('RENAME COLUMN principal_id TO actor_id')
    expect(sql).toContain('schema_version = EXCLUDED.schema_version')
    expect(sql).toContain('instance_id, actor_id')
    expect(sql).toContain('COMMIT')
    await index.close()
  })

  it('rolls back a failed pgvector actor-column migration', async () => {
    const pool = new FakePgVectorPool((text) => {
      if (text.includes('SELECT schema_version')) return { rows: [{ schema_version: 1 }] }
      if (text.includes('information_schema.columns')) return { rows: [{ column_name: 'principal_id' }] }
      if (text.includes('RENAME COLUMN principal_id TO actor_id')) throw new Error('injected migration failure')
      return { rows: [] }
    })
    const index = await createPgVectorMemoryVectorIndex(config(pool))

    await expect(index.upsert([entry()])).rejects.toMatchObject({ code: 'PGVECTOR_BACKEND' })
    expect(pool.queries.map(query => query.text)).toContain('ROLLBACK')
    expect(pool.queries.some(query => query.text.includes('schema_version = EXCLUDED.schema_version'))).toBe(false)
    await index.close()
  })

  it('parameterizes 384-dimensional storage and rejects mismatched vectors', async () => {
    const pool = new FakePgVectorPool()
    const index = await createPgVectorMemoryVectorIndex(config(pool, { dimensions: 384 }))
    const vector = new Float32Array(384)
    vector[0] = 1
    expect(index.identity.dimensions).toBe(384)
    await expect(index.upsert([entry({ vector: new Float32Array(383) })])).rejects.toThrow('dimensions')
    await index.upsert([entry({ vector })])
    expect(pool.queries.some(query => query.text.includes('embedding vector(384)'))).toBe(true)
    expect(pool.queries.some(query => query.values.includes(`[${Array.from(vector).join(',')}]`))).toBe(true)
    await index.close()
  })

  it('performs exact cosine search with portable filters and deterministic tie ordering', async () => {
    const pool = new FakePgVectorPool((text) => {
      if (text.includes('SELECT generation_id')) {
        return {
          rows: [
            { generation_id: 'generation.one', record_id: 'record.z', revision_id: 'revision.z', score: '0.75' },
            { generation_id: 'generation.one', record_id: 'record.a', revision_id: 'revision.a', score: 0.75 },
          ],
        }
      }
      return { rows: [] }
    })
    const index = await createPgVectorMemoryVectorIndex(config(pool))
    const hits = await index.search({
      generationId: 'generation.one',
      vector: new Float32Array([1, 0, 0]),
      filter: {
        instanceId: 'instance.one',
        actorId: 'actor.one',
        scopeKind: 'project',
        projectId: "project'one",
        kind: 'fact',
        status: 'active',
      },
      limit: 5,
    })

    expect(hits.map(hit => hit.recordId)).toEqual(['record.a', 'record.z'])
    const search = pool.queries.find(query => query.text.includes('SELECT generation_id'))
    expect(search?.text).toContain('embedding <=>')
    expect(search?.text).toContain('ORDER BY embedding <=>')
    expect(search?.text).toContain('record_id COLLATE "C" ASC')
    expect(search?.text).not.toContain("project'one")
    expect(search?.values).toEqual([
      'generation.one', 'instance.one', 'actor.one', 'project', "project'one", 'fact', 'active',
      '[1,0,0]', 5,
    ])
    await index.close()
  })

  it('validates whole batches before connecting and contains credential-bearing failures', async () => {
    const pool = new FakePgVectorPool(() => { throw new Error(`connection refused: ${secretDsn}`) })
    const index = await createPgVectorMemoryVectorIndex(config(pool))
    await expect(index.upsert([
      entry(),
      entry({ recordId: 'record.bad', revisionId: 'revision.bad', vector: new Float32Array([1, 0]) }),
    ])).rejects.toThrow('dimensions')
    expect(pool.queries).toHaveLength(0)

    const failure = await index.upsert([entry()]).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'PGVECTOR_BACKEND' })
    expect(String(failure)).not.toContain(secretDsn)
    const health = await index.health()
    expect(health).toMatchObject({
      state: 'unavailable',
      backend: 'pgvector',
      sanitizedTarget: 'PostgreSQL DSN from TEST_PGVECTOR_DSN',
      lastFailure: { message: 'pgvector health check failed' },
    })
    expect(JSON.stringify(health)).not.toContain(secretDsn)
    await index.close()
  })

  it('fails lazily when the indirect DSN is absent and rejects credential-bearing diagnostics', async () => {
    let loaded = false
    const index = await createPgVectorMemoryVectorIndex({
      dsnEnv: 'MISSING_PGVECTOR_DSN',
      dimensions: 3,
      environment: {},
      runtimeLoader: () => {
        loaded = true
        return Promise.resolve(fakePgVectorRuntime(new FakePgVectorPool()))
      },
    })
    expect(loaded).toBe(false)
    await expect(index.search({
      generationId: 'generation.one',
      vector: new Float32Array([1, 0, 0]),
      filter: { instanceId: 'instance.one', actorId: 'actor.one' },
      limit: 1,
    })).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(loaded).toBe(false)
    await expect(createPgVectorMemoryVectorIndex({
      dsnEnv: 'PG_DSN',
      dimensions: 3,
      sanitizedTarget: secretDsn,
    })).rejects.toThrow('must not contain credentials')
    await index.close()
  })

  it('serializes optional HNSW build and reindex maintenance', async () => {
    let releaseBuild: (() => void) | undefined
    const buildBlocked = new Promise<void>(resolve => { releaseBuild = resolve })
    let indexPresent = false
    const pool = new FakePgVectorPool(async text => {
      if (text.includes('FROM pg_indexes')) return { rows: indexPresent ? [{ exists: 1 }] : [] }
      if (text.includes('CREATE INDEX')) {
        await buildBlocked
        indexPresent = true
      }
      return { rows: [] }
    })
    const index = await createPgVectorMemoryVectorIndex(config(pool, {
      hnsw: { m: 12, efConstruction: 80 },
    }))
    expect(index.supportedMaintenance).toEqual(['build-index', 'reindex', 'cleanup-generation'])
    const building = index.maintenance('build-index')
    await Promise.resolve()
    await Promise.resolve()
    expect((await index.maintenance('build-index')).outcome).toBe('already-running')
    releaseBuild?.()
    expect(await building).toMatchObject({ kind: 'build-index', outcome: 'ran' })
    expect(await index.maintenance('build-index')).toMatchObject({ outcome: 'noop' })
    expect(await index.maintenance('reindex')).toMatchObject({ outcome: 'ran' })
    expect(await index.maintenance('cleanup-generation')).toMatchObject({ outcome: 'ran' })
    const sql = pool.queries.map(query => query.text).join('\n')
    expect(sql).toContain('USING hnsw (embedding vector_cosine_ops)')
    expect(sql).toContain('WITH (m = 12, ef_construction = 80)')
    expect(sql).toMatch(/REINDEX INDEX "doppelganger_[a-f0-9]{24}"\."memory_vectors_[a-f0-9]{24}_hnsw"/u)
    expect(sql).toMatch(/DROP SCHEMA IF EXISTS "doppelganger_[a-f0-9]{24}" CASCADE/u)
    await index.close()
  })

  it('reports exact counts and closes idempotently', async () => {
    const pool = new FakePgVectorPool(text => text.includes('COUNT(*)')
      ? { rows: [{ count: '7' }] }
      : { rows: [] })
    const index = await createPgVectorMemoryVectorIndex(config(pool))
    expect(await index.health()).toMatchObject({
      state: 'healthy',
      counts: { indexed: 7, current: 7 },
    })
    await index.close()
    await index.close()
    await expect(index.health()).rejects.toThrow('closed')
  })
})

runMemoryVectorBackendConformance('pgvector', ({ dimensions }) => {
  const pool = new StatefulFakePgVectorPool()
  return createPgVectorMemoryVectorIndex({
    dsnEnv: 'TEST_PGVECTOR_DSN',
    dimensions,
    namespace: 'conformance',
    sanitizedTarget: 'fake PostgreSQL service',
    environment: { TEST_PGVECTOR_DSN: 'postgresql://fake.invalid/test' },
    runtimeLoader: () => Promise.resolve(fakePgVectorRuntime(pool)),
  })
}, {
  async disposeDuringInitialization({ dimensions }) {
    const started = deferred<void>()
    const release = deferred<void>()
    let closes = 0
    const pool = new FakePgVectorPool(async text => {
      if (text.includes('CREATE EXTENSION')) {
        started.resolve()
        await release.promise
      }
      return { rows: [] }
    })
    const originalEnd = pool.end.bind(pool)
    pool.end = async () => {
      closes += 1
      await originalEnd()
    }
    const index = await createPgVectorMemoryVectorIndex({
      dsnEnv: 'TEST_PGVECTOR_DSN',
      dimensions,
      namespace: 'conformance-dispose',
      sanitizedTarget: 'fake PostgreSQL service',
      environment: { TEST_PGVECTOR_DSN: 'postgresql://fake.invalid/test' },
      runtimeLoader: () => Promise.resolve(fakePgVectorRuntime(pool)),
    })
    return {
      index,
      operation: index.health(),
      started: started.promise,
      release: () => { release.resolve() },
      closedCandidates: () => closes,
    }
  },
  async createRetryable({ dimensions }) {
    let closes = 0
    const first = new FakePgVectorPool(() => { throw new Error('transient pgvector setup failure') })
    const originalEnd = first.end.bind(first)
    first.end = async () => {
      closes += 1
      await originalEnd()
    }
    const second = new FakePgVectorPool(text => text.includes('COUNT(*)')
      ? { rows: [{ count: '0' }] }
      : { rows: [] })
    let attempts = 0
    const index = await createPgVectorMemoryVectorIndex({
      dsnEnv: 'TEST_PGVECTOR_DSN',
      dimensions,
      namespace: 'conformance-retry',
      sanitizedTarget: 'fake PostgreSQL service',
      environment: { TEST_PGVECTOR_DSN: 'postgresql://fake.invalid/test' },
      runtimeLoader: async () => fakePgVectorRuntime(attempts++ === 0 ? first : second),
    })
    return {
      index,
      attempts: () => attempts,
      failedCandidateClosures: () => closes,
      expectedFailedCandidateClosures: 1,
    }
  },
}, async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  let underlyingOperations = 0
  let indexPresent = false
  const pool = new FakePgVectorPool(async text => {
    if (text.includes('FROM pg_indexes')) return { rows: indexPresent ? [{ exists: 1 }] : [] }
    if (text.includes('CREATE INDEX')) { underlyingOperations += 1; entered.resolve(); await release.promise; indexPresent = true }
    return { rows: [] }
  })
  const index = await createPgVectorMemoryVectorIndex(config(pool, { hnsw: { m: 12, efConstruction: 80 } }))
  return { kind: 'build-index', async run() { try { const first = index.maintenance('build-index'); await entered.promise; const competing = await index.maintenance('build-index'); release.resolve(); return { first: await first, competing, underlyingOperations } } finally { release.resolve(); await index.close() } } }
})
