import { createHash } from 'node:crypto'
import type {
  MemoryVectorEntry,
  MemoryVectorHealth,
  MemoryVectorHit,
  MemoryVectorIdentity,
  MemoryVectorIndex,
  MemoryVectorIndexIdentity,
  MemoryVectorMaintenanceKind,
  MemoryVectorMaintenanceResult,
  MemoryVectorSearchRequest,
} from '@doppelganger/doppelganger-memory'
import {
  memoryVectorIdentityId,
  validateMemoryVector,
} from '@doppelganger/doppelganger-memory'

export interface PgVectorQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount?: number | null
}

export interface PgVectorClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PgVectorQueryResult<Row>>
  release(): void
}

export interface PgVectorPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PgVectorQueryResult<Row>>
  connect(): Promise<PgVectorClient>
  end(): Promise<void>
}

export interface PgVectorRuntime {
  createPool(options: {
    readonly connectionString: string
    readonly connectionTimeoutMillis: number
    readonly max: number
  }): PgVectorPool
  encodeVector(vector: readonly number[]): unknown
}

export type PgVectorRuntimeLoader = () => Promise<PgVectorRuntime>

export interface PgVectorHnswConfig {
  readonly m?: number
  readonly efConstruction?: number
}

export interface PgVectorConfig {
  /** Name of the environment variable containing the PostgreSQL DSN. */
  readonly dsnEnv: string
  readonly dimensions: number
  readonly namespace?: string
  readonly sanitizedTarget?: string
  readonly configFingerprint?: string
  readonly connectionTimeoutMs?: number
  readonly poolSize?: number
  readonly hnsw?: PgVectorHnswConfig
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly runtimeLoader?: PgVectorRuntimeLoader
}

interface StorageNames {
  readonly schema: string
  readonly table: string
  readonly index: string
  readonly metadata: string
}

interface SearchRow extends Record<string, unknown> {
  readonly generation_id: unknown
  readonly record_id: unknown
  readonly revision_id: unknown
  readonly score: unknown
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const FINGERPRINT = /^[a-f0-9]{64}$/
const IDENTITY_TEXT = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/

function boundedIdentity(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 256 || !IDENTITY_TEXT.test(normalized)) {
    throw new TypeError(`${field} contains unsupported characters`)
  }
  return normalized
}

function positiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${field} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function storageNames(namespace: string, dimensions: number): StorageNames {
  const suffix = hash(JSON.stringify({ namespace, dimensions })).slice(0, 24)
  return Object.freeze({
    schema: `doppelganger_${suffix}`,
    table: `memory_vectors_${suffix}`,
    index: `memory_vectors_${suffix}_hnsw`,
    metadata: `memory_vectors_${suffix}_metadata`,
  })
}

function qualified(schema: string, object: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(object)}`
}

function sanitizedTarget(value: string | undefined, dsnEnv: string): string {
  const target = (value ?? `PostgreSQL DSN from ${dsnEnv}`).trim()
  if (target.length === 0 || target.length > 512) throw new TypeError('pgvector sanitizedTarget must be non-empty and bounded')
  if (/(?:postgres(?:ql)?:\/\/)[^\s/]*@/iu.test(target) || /(?:password|passfile)\s*=/iu.test(target)) {
    throw new TypeError('pgvector sanitizedTarget must not contain credentials')
  }
  return target
}

function backendError(operation: string): Error & { code: string } {
  return Object.assign(new Error(`pgvector ${operation} failed`), { code: 'PGVECTOR_BACKEND' })
}

function unsupported(kind: MemoryVectorMaintenanceKind): Error & { code: string } {
  return Object.assign(new Error(`pgvector does not support ${kind}`), { code: 'UNSUPPORTED_MAINTENANCE' })
}

async function defaultRuntimeLoader(): Promise<PgVectorRuntime> {
  const [postgres, vectorModule] = await Promise.all([import('pg'), import('pgvector')])
  return {
    createPool: options => new postgres.Pool(options) as unknown as PgVectorPool,
    encodeVector: vector => vectorModule.toSql([...vector]),
  }
}

export class PgVectorMemoryVectorIndex implements MemoryVectorIndex {
  readonly identity: MemoryVectorIndexIdentity
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[]

  private readonly dsnEnv: string
  private readonly dimensions: number
  private readonly names: StorageNames
  private readonly resolveDsn: () => string
  private readonly runtimeLoader: PgVectorRuntimeLoader
  private readonly connectionTimeoutMillis: number
  private readonly poolSize: number
  private readonly hnsw: Readonly<{ m: number; efConstruction: number }> | undefined
  #pool: PgVectorPool | undefined
  #runtime: PgVectorRuntime | undefined
  #initialization: Promise<void> | undefined
  private maintenanceRunning = false
  private closed = false
  private closePromise?: Promise<void>

  constructor(config: PgVectorConfig) {
    if (!ENVIRONMENT_NAME.test(config.dsnEnv)) throw new TypeError('pgvector dsnEnv must be an environment-variable name')
    this.dsnEnv = config.dsnEnv
    this.dimensions = positiveInteger(config.dimensions, 'pgvector dimensions', 65_536)
    const namespace = boundedIdentity(config.namespace ?? 'default', 'pgvector namespace')
    this.names = storageNames(namespace, this.dimensions)
    const environment = config.environment ?? process.env
    this.resolveDsn = () => {
      const dsn = environment[this.dsnEnv]
      if (typeof dsn !== 'string' || dsn.trim().length === 0) {
        throw Object.assign(new Error(`pgvector DSN environment variable ${this.dsnEnv} is not set`), { code: 'MISSING_CREDENTIAL' })
      }
      return dsn
    }
    this.runtimeLoader = config.runtimeLoader ?? defaultRuntimeLoader
    this.connectionTimeoutMillis = positiveInteger(config.connectionTimeoutMs ?? 5_000, 'pgvector connectionTimeoutMs', 300_000)
    this.poolSize = positiveInteger(config.poolSize ?? 4, 'pgvector poolSize', 100)
    this.hnsw = config.hnsw === undefined
      ? undefined
      : Object.freeze({
          m: positiveInteger(config.hnsw.m ?? 16, 'pgvector HNSW m', 100),
          efConstruction: positiveInteger(config.hnsw.efConstruction ?? 64, 'pgvector HNSW efConstruction', 1_000),
        })
    this.supportedMaintenance = Object.freeze(this.hnsw === undefined
      ? ['cleanup-generation']
      : ['build-index', 'reindex', 'cleanup-generation'])
    const target = sanitizedTarget(config.sanitizedTarget, this.dsnEnv)
    const configuredFingerprint = config.configFingerprint ?? hash(JSON.stringify({
      backend: 'pgvector',
      dsnEnv: this.dsnEnv,
      namespace,
      dimensions: this.dimensions,
      hnsw: this.hnsw ?? null,
    }))
    if (!FINGERPRINT.test(configuredFingerprint)) throw new TypeError('pgvector configFingerprint must be a SHA-256 fingerprint')
    const configFingerprint = hash(JSON.stringify({ partitionSchemaVersion: 2, configuredFingerprint }))
    if (!FINGERPRINT.test(configFingerprint)) throw new TypeError('pgvector configFingerprint must be a SHA-256 fingerprint')
    this.identity = Object.freeze({
      backend: 'pgvector',
      namespace,
      sanitizedTarget: target,
      configFingerprint,
      dimensions: this.dimensions,
      distanceMetric: 'cosine',
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('pgvector index is closed')
  }

  private async initialize(): Promise<void> {
    const dsn = this.resolveDsn()
    let pool: PgVectorPool | undefined
    try {
      const runtime = await this.runtimeLoader()
      this.assertOpen()
      pool = runtime.createPool({
        connectionString: dsn,
        connectionTimeoutMillis: this.connectionTimeoutMillis,
        max: this.poolSize,
      })
      const table = qualified(this.names.schema, this.names.table)
      const metadata = qualified(this.names.schema, this.names.metadata)
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
      this.assertOpen()
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(this.names.schema)}`)
      this.assertOpen()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(`CREATE TABLE IF NOT EXISTS ${metadata} (
          singleton smallint PRIMARY KEY CHECK (singleton = 1),
          schema_version integer NOT NULL
        )`)
        const versionRows = await client.query<{ schema_version: number }>(`SELECT schema_version FROM ${metadata} WHERE singleton = 1`)
        const version = versionRows.rows[0]?.schema_version
        if (version !== undefined && version !== 1 && version !== 2) throw new Error(`unsupported pgvector schema version: ${String(version)}`)
        const columns = await client.query<{ column_name: string }>(
          'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
          [this.names.schema, this.names.table],
        )
        const names = new Set(columns.rows.map(row => row.column_name))
        const legacy = version === 1 || (version === undefined && names.has('principal_id'))
        if (legacy) {
          if (!names.has('principal_id') || names.has('actor_id')) throw new Error('pgvector legacy actor migration cannot identify the partition column')
          await client.query(`ALTER TABLE ${table} RENAME COLUMN principal_id TO actor_id`)
        } else if (names.size > 0 && !names.has('actor_id')) {
          throw new Error('pgvector actor partition column is missing')
        }
        await client.query(`CREATE TABLE IF NOT EXISTS ${table} (
          vector_id text PRIMARY KEY,
          generation_id text NOT NULL,
          record_id text NOT NULL,
          revision_id text NOT NULL,
          instance_id text NOT NULL,
          actor_id text NOT NULL,
          scope_kind text NOT NULL,
          project_id text,
          kind text NOT NULL,
          subject_key text NOT NULL,
          status text NOT NULL,
          embedding vector(${this.dimensions}) NOT NULL,
          UNIQUE (generation_id, record_id, revision_id)
        )`)
        await client.query(`INSERT INTO ${metadata}(singleton, schema_version) VALUES (1, 2)
          ON CONFLICT (singleton) DO UPDATE SET schema_version = EXCLUDED.schema_version`)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
      this.assertOpen()
      this.#runtime = runtime
      this.#pool = pool
      pool = undefined
    } catch (error) {
      if (pool !== undefined) await pool.end().catch(() => undefined)
      if (error instanceof Error && 'code' in error && (error.code === 'MISSING_CREDENTIAL' || error.code === 'PGVECTOR_BACKEND')) throw error
      throw backendError('initialization')
    }
  }

  private async ready(): Promise<{ readonly pool: PgVectorPool; readonly runtime: PgVectorRuntime }> {
    this.assertOpen()
    if (this.#initialization === undefined) {
      const initialization = this.initialize()
      this.#initialization = initialization
      void initialization.catch(() => {
        if (this.#initialization === initialization) this.#initialization = undefined
      })
    }
    await this.#initialization
    this.assertOpen()
    if (this.#pool === undefined || this.#runtime === undefined) throw backendError('initialization')
    return { pool: this.#pool, runtime: this.#runtime }
  }

  private encode(runtime: PgVectorRuntime, vector: Float32Array, field: string): unknown {
    validateMemoryVector(vector, this.dimensions, field)
    return runtime.encodeVector(Array.from(vector))
  }

  async upsert(entries: readonly MemoryVectorEntry[]): Promise<void> {
    this.assertOpen()
    for (const entry of entries) {
      memoryVectorIdentityId(entry)
      validateMemoryVector(entry.vector, this.dimensions, 'vector')
    }
    if (entries.length === 0) return
    let client: PgVectorClient | undefined
    try {
      const { pool, runtime } = await this.ready()
      client = await pool.connect()
      await client.query('BEGIN')
      const table = qualified(this.names.schema, this.names.table)
      const statement = `INSERT INTO ${table} (
        vector_id, generation_id, record_id, revision_id, instance_id, actor_id,
        scope_kind, project_id, kind, subject_key, status, embedding
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector)
      ON CONFLICT (vector_id) DO UPDATE SET
        generation_id = EXCLUDED.generation_id,
        record_id = EXCLUDED.record_id,
        revision_id = EXCLUDED.revision_id,
        instance_id = EXCLUDED.instance_id,
        actor_id = EXCLUDED.actor_id,
        scope_kind = EXCLUDED.scope_kind,
        project_id = EXCLUDED.project_id,
        kind = EXCLUDED.kind,
        subject_key = EXCLUDED.subject_key,
        status = EXCLUDED.status,
        embedding = EXCLUDED.embedding`
      for (const entry of entries) {
        await client.query(statement, [
          memoryVectorIdentityId(entry),
          entry.generationId,
          entry.recordId,
          entry.revisionId,
          entry.instanceId,
          entry.actorId,
          entry.scopeKind,
          entry.projectId ?? null,
          entry.kind,
          entry.subjectKey,
          entry.status,
          this.encode(runtime, entry.vector, 'vector'),
        ])
      }
      await client.query('COMMIT')
    } catch (error) {
      if (client !== undefined) await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof Error && 'code' in error && (error.code === 'MISSING_CREDENTIAL' || error.code === 'PGVECTOR_BACKEND')) throw error
      throw backendError('upsert')
    } finally {
      client?.release()
    }
  }

  async delete(identities: readonly MemoryVectorIdentity[]): Promise<void> {
    this.assertOpen()
    const vectorIds = identities.map(identity => memoryVectorIdentityId(identity))
    if (vectorIds.length === 0) return
    let client: PgVectorClient | undefined
    try {
      const { pool } = await this.ready()
      client = await pool.connect()
      await client.query('BEGIN')
      const statement = `DELETE FROM ${qualified(this.names.schema, this.names.table)} WHERE vector_id = $1`
      for (const vectorId of vectorIds) await client.query(statement, [vectorId])
      await client.query('COMMIT')
    } catch (error) {
      if (client !== undefined) await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof Error && 'code' in error && (error.code === 'MISSING_CREDENTIAL' || error.code === 'PGVECTOR_BACKEND')) throw error
      throw backendError('delete')
    } finally {
      client?.release()
    }
  }

  async search(request: MemoryVectorSearchRequest): Promise<readonly MemoryVectorHit[]> {
    this.assertOpen()
    boundedIdentity(request.generationId, 'search generationId')
    positiveInteger(request.limit, 'search limit', 10_000)
    validateMemoryVector(request.vector, this.dimensions, 'search vector')
    try {
      const { pool, runtime } = await this.ready()
      const values: unknown[] = [
        request.generationId,
        request.filter.instanceId,
        request.filter.actorId,
      ]
      const predicates = ['generation_id = $1', 'instance_id = $2', 'actor_id = $3']
      const add = (sql: string, value: unknown): void => {
        values.push(value)
        predicates.push(`${sql} $${values.length}`)
      }
      if (request.filter.scopeKind !== undefined) {
        add('scope_kind =', request.filter.scopeKind)
        if (request.filter.scopeKind === 'relationship') predicates.push('project_id IS NULL')
      }
      if (request.filter.projectId !== undefined) add('project_id =', request.filter.projectId)
      if (request.filter.kind !== undefined) add('kind =', request.filter.kind)
      if (request.filter.status !== undefined) add('status =', request.filter.status)
      values.push(this.encode(runtime, request.vector, 'search vector'))
      const vectorParameter = `$${values.length}::vector`
      values.push(request.limit)
      const result = await pool.query<SearchRow>(`SELECT generation_id, record_id, revision_id,
        1 - (embedding <=> ${vectorParameter}) AS score
        FROM ${qualified(this.names.schema, this.names.table)}
        WHERE ${predicates.join(' AND ')}
        ORDER BY embedding <=> ${vectorParameter} ASC,
          record_id COLLATE "C" ASC, revision_id COLLATE "C" ASC
        LIMIT $${values.length}`, values)
      const hits = result.rows.map(row => {
        if (typeof row.generation_id !== 'string' || typeof row.record_id !== 'string' || typeof row.revision_id !== 'string') {
          throw backendError('search')
        }
        const score = typeof row.score === 'number' ? row.score : Number(row.score)
        if (!Number.isFinite(score)) throw backendError('search')
        return Object.freeze({
          generationId: row.generation_id,
          recordId: row.record_id,
          revisionId: row.revision_id,
          score,
        })
      })
      hits.sort((left, right) => right.score - left.score
        || left.recordId.localeCompare(right.recordId)
        || left.revisionId.localeCompare(right.revisionId))
      return Object.freeze(hits.slice(0, request.limit))
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'MISSING_CREDENTIAL' || error.code === 'PGVECTOR_BACKEND')) throw error
      throw backendError('search')
    }
  }

  async health(): Promise<MemoryVectorHealth> {
    this.assertOpen()
    const checkedAt = new Date().toISOString()
    try {
      const { pool } = await this.ready()
      const result = await pool.query<{ readonly count: unknown }>(
        `SELECT COUNT(*) AS count FROM ${qualified(this.names.schema, this.names.table)}`,
      )
      const indexed = Number(result.rows[0]?.count)
      if (!Number.isSafeInteger(indexed) || indexed < 0) throw backendError('health check')
      return Object.freeze({
        state: 'healthy',
        checkedAt,
        backend: 'pgvector',
        sanitizedTarget: this.identity.sanitizedTarget,
        counts: Object.freeze({ indexed, current: indexed, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 }),
      })
    } catch {
      return Object.freeze({
        state: 'unavailable',
        checkedAt,
        backend: 'pgvector',
        sanitizedTarget: this.identity.sanitizedTarget,
        lastFailure: Object.freeze({ code: 'health', occurredAt: checkedAt, message: 'pgvector health check failed' }),
      })
    }
  }

  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    this.assertOpen()
    if (kind !== 'cleanup-generation' && (this.hnsw === undefined || (kind !== 'build-index' && kind !== 'reindex'))) throw unsupported(kind)
    const startedAt = new Date().toISOString()
    if (this.maintenanceRunning) {
      return Object.freeze({ kind, outcome: 'already-running', startedAt, completedAt: new Date().toISOString() })
    }
    this.maintenanceRunning = true
    try {
      const { pool } = await this.ready()
      if (kind === 'cleanup-generation') {
        await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(this.names.schema)} CASCADE`)
      } else {
        const present = await pool.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
          this.names.schema,
          this.names.index,
        ])
        if (kind === 'build-index') {
          if (present.rows.length > 0) {
            return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: new Date().toISOString() })
          }
          await pool.query(`CREATE INDEX ${quoteIdentifier(this.names.index)}
            ON ${qualified(this.names.schema, this.names.table)}
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = ${this.hnsw!.m}, ef_construction = ${this.hnsw!.efConstruction})`)
        } else {
          if (present.rows.length === 0) {
            return Object.freeze({ kind, outcome: 'noop', startedAt, completedAt: new Date().toISOString() })
          }
          await pool.query(`REINDEX INDEX ${qualified(this.names.schema, this.names.index)}`)
        }
      }
      return Object.freeze({ kind, outcome: 'ran', startedAt, completedAt: new Date().toISOString() })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'MISSING_CREDENTIAL' || error.code === 'PGVECTOR_BACKEND')) throw error
      throw backendError('maintenance')
    } finally {
      this.maintenanceRunning = false
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closed = true
    this.closePromise = (async () => {
      await this.#initialization?.catch(() => undefined)
      const pool = this.#pool
      this.#pool = undefined
      this.#runtime = undefined
      if (pool !== undefined) await pool.end().catch(() => undefined)
    })()
    return this.closePromise
  }
}

export async function createPgVectorMemoryVectorIndex(config: PgVectorConfig): Promise<PgVectorMemoryVectorIndex> {
  return new PgVectorMemoryVectorIndex(config)
}
