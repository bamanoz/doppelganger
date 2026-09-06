import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { DriverException } from '@mikro-orm/core'
import { MikroORM as SqlMikroORM, SqliteDriver, type SqlEntityManager } from '@mikro-orm/sql'
import { MikroORM as PostgreSqlMikroORM, type PostgreSqlDriver } from '@mikro-orm/postgresql'
import { memoryEntities } from './entities.ts'
import { migrateMemoryDatabase } from './migrations.ts'
import { MemorySqliteDialect } from './sqlite-dialect.ts'
import { memoryTransaction } from './transaction.ts'
import { resolvePostgresqlConnection, validateMemoryDatabaseConfig, type MemoryDatabaseConfig } from './config.ts'

interface OwnedOrm {
  readonly em: SqlEntityManager
  close(force?: boolean): Promise<void>
}

export class MemoryPersistenceError extends Error {
  readonly code: 'MEMORY_STORAGE_UNAVAILABLE' | 'MEMORY_STORAGE_BUSY' | 'MEMORY_STORAGE_FAILED' | 'MEMORY_STORAGE_CLOSED'
  constructor(code: MemoryPersistenceError['code']) {
    super(code)
    this.code = code
    this.name = 'MemoryPersistenceError'
  }
}

function boundedFailure(error: unknown): unknown {
  const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (error instanceof DriverException || (typeof code === 'string' && (/^[0-9A-Z]{5}$/u.test(code) || code.startsWith('ERR_SQLITE') || code.startsWith('SQLITE_') || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(code)))) {
    const busy = code === '55P03' || code === '40001' || code === 'SQLITE_BUSY' || (error instanceof Error && /database is locked/u.test(error.message))
    return new MemoryPersistenceError(busy ? 'MEMORY_STORAGE_BUSY' : 'MEMORY_STORAGE_FAILED')
  }
  return error
}

/** Internal ORM lifetime; only memory-owned repository implementations may use it. */
export class MemoryDatabase {
  readonly kind: 'sqlite' | 'postgresql'
  readonly schema: string | undefined
  private readonly pending = new Set<Promise<unknown>>()
  private closing: Promise<void> | undefined
  private closed = false
  private readonly orm: OwnedOrm
  private readonly config: MemoryDatabaseConfig

  constructor(orm: OwnedOrm, config: MemoryDatabaseConfig) {
    this.orm = orm
    this.config = config
    this.kind = config.kind
    this.schema = config.kind === 'postgresql' ? config.schema : undefined
  }

  private async configure(em: SqlEntityManager): Promise<void> {
    if (this.config.kind !== 'postgresql') return
    await em.execute(`SET LOCAL search_path TO "${this.config.schema}"`)
    await em.execute(`SET LOCAL statement_timeout = '${this.config.statementTimeoutMs ?? 30_000}ms'`)
    await em.execute(`SET LOCAL lock_timeout = '${this.config.lockTimeoutMs ?? 5_000}ms'`)
  }

  private run<T>(mode: 'read' | 'write', operation: (em: SqlEntityManager) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new MemoryPersistenceError('MEMORY_STORAGE_CLOSED'))
    const promise = memoryTransaction(this.orm.em, mode, async em => {
      await this.configure(em)
      return operation(em)
    }).catch((error: unknown) => { throw boundedFailure(error) })
    this.pending.add(promise)
    // Register both settlement branches without creating an unhandled rejecting tail.
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise))
    return promise
  }

  read<T>(operation: (em: SqlEntityManager) => Promise<T>): Promise<T> {
    return this.run('read', operation)
  }

  write<T>(owner: { readonly instanceId: string; readonly actorId?: string }, operation: (em: SqlEntityManager) => Promise<T>): Promise<T> {
    return this.run('write', async em => {
      if (this.kind === 'postgresql') {
        // A generation transition cannot race a mutation's outbox decision.
        // Every path locks instance first, then the narrower actor partition.
        await em.execute('INSERT INTO memory_instance_locks (instance_id) VALUES (?) ON CONFLICT DO NOTHING', [owner.instanceId])
        await em.execute('SELECT instance_id FROM memory_instance_locks WHERE instance_id = ? FOR UPDATE', [owner.instanceId])
        if (owner.actorId !== undefined) {
          await em.execute('INSERT INTO memory_partition_locks (instance_id, actor_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [owner.instanceId, owner.actorId])
          await em.execute('SELECT instance_id FROM memory_partition_locks WHERE instance_id = ? AND actor_id = ? FOR UPDATE', [owner.instanceId, owner.actorId])
        }
      }
      return operation(em)
    })
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.closing = (async () => {
      await Promise.allSettled([...this.pending])
      await this.orm.close(true)
    })()
    return this.closing
  }
}

export async function openMemoryDatabase(input: MemoryDatabaseConfig, legacyActorId: string): Promise<MemoryDatabase> {
  if (typeof legacyActorId !== 'string' || legacyActorId.trim().length === 0) throw new TypeError('memory storage requires a bound actor')
  const config = validateMemoryDatabaseConfig(input)
  let orm: OwnedOrm | undefined
  try {
    if (config.kind === 'sqlite') {
      const directory = join(config.home, 'storage')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const dbName = join(directory, `${config.namespace ?? 'memory'}.sqlite`)
      const file = await open(dbName, 'a', 0o600)
      try { await file.chmod(0o600) }
      finally { await file.close() }
      orm = await SqlMikroORM.init<SqliteDriver, SqlEntityManager<SqliteDriver>, typeof memoryEntities>({
        driver: SqliteDriver, entities: memoryEntities, dbName,
        driverOptions: new MemorySqliteDialect(dbName), debug: false, logger: () => undefined,
      })
      const setup = orm.em.fork()
      await setup.execute('PRAGMA journal_mode = WAL')
      await setup.execute('PRAGMA synchronous = NORMAL')
      await setup.execute(`PRAGMA busy_timeout = ${config.busyTimeoutMs ?? 5_000}`)
      await memoryTransaction(orm.em, 'write', em => migrateMemoryDatabase(em, 'sqlite', legacyActorId))
    } else {
      orm = await PostgreSqlMikroORM.init<PostgreSqlDriver, SqlEntityManager<PostgreSqlDriver>, typeof memoryEntities>({
        entities: memoryEntities, clientUrl: resolvePostgresqlConnection(config), schema: config.schema,
        pool: { min: 0, max: config.poolSize ?? 4 }, debug: false, logger: () => undefined,
        driverOptions: {
          connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
          statement_timeout: config.statementTimeoutMs ?? 30_000,
          lock_timeout: config.lockTimeoutMs ?? 5_000,
          idle_in_transaction_session_timeout: config.statementTimeoutMs ?? 30_000,
        },
      })
      await memoryTransaction(orm.em, 'write', async em => {
        await em.execute('SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(?))', [`doppelganger.memory.schema:${config.schema}`])
        await em.execute(`CREATE SCHEMA IF NOT EXISTS "${config.schema}"`)
        await em.execute(`SET LOCAL search_path TO "${config.schema}"`)
        await migrateMemoryDatabase(em, 'postgresql', legacyActorId)
      })
    }
    return new MemoryDatabase(orm, config)
  } catch (error) {
    await orm?.close(true)
    if (error instanceof TypeError || error instanceof MemoryPersistenceError) throw error
    // Driver exceptions can contain SQL, row values, or connection credentials.
    throw new MemoryPersistenceError('MEMORY_STORAGE_UNAVAILABLE')
  }
}
