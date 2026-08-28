import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'

export interface InstanceSqliteConfig {
  readonly home: string
  readonly busyTimeoutMs?: number
}

export interface InstanceSqliteDatabase {
  readonly filename: string
  exec(sql: string): void
  prepare(sql: string): StatementSync
  transaction<T>(operation: (database: InstanceSqliteDatabase) => T): T
  close(): void
}

interface OpenDatabase {
  readonly handle: InstanceSqliteDatabase
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerInstanceSqlite: InstanceSqliteService
  }
}

function validateNamespace(namespace: string): string {
  namespace = namespace.trim()
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    throw new TypeError('storage namespace must be lowercase alphanumeric with optional hyphens')
  }
  return namespace
}

export class InstanceSqliteService extends Service {
  private readonly databases = new Map<string, OpenDatabase>()
  private readonly home: string
  private readonly busyTimeoutMs: number

  constructor(ctx: Context, config: InstanceSqliteConfig) {
    super(ctx, 'doppelgangerInstanceSqlite')
    this.home = normalize(config.home)
    if (!isAbsolute(this.home)) throw new TypeError('instance SQLite home must be absolute')
    this.busyTimeoutMs = config.busyTimeoutMs ?? 5000
    if (!Number.isSafeInteger(this.busyTimeoutMs) || this.busyTimeoutMs < 0) {
      throw new RangeError('instance SQLite busy timeout must be a non-negative safe integer')
    }
  }

  async open(namespace: string): Promise<InstanceSqliteDatabase> {
    namespace = validateNamespace(namespace)
    if (this.databases.has(namespace)) throw new Error(`storage namespace "${namespace}" is already open`)
    const directory = join(this.home, 'storage')
    await mkdir(directory, { recursive: true })
    if (this.databases.has(namespace)) throw new Error(`storage namespace "${namespace}" is already open`)
    const filename = join(directory, `${namespace}.sqlite`)
    const database = new DatabaseSync(filename, {
      timeout: this.busyTimeoutMs,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    })
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    let closed = false
    let dispose: (() => void) | undefined
    const handle: InstanceSqliteDatabase = {
      filename,
      exec(sql) {
        if (closed) throw new Error(`storage namespace "${namespace}" is closed`)
        database.exec(sql)
      },
      prepare(sql) {
        if (closed) throw new Error(`storage namespace "${namespace}" is closed`)
        return database.prepare(sql)
      },
      transaction<T>(operation: (storage: InstanceSqliteDatabase) => T): T {
        if (closed) throw new Error(`storage namespace "${namespace}" is closed`)
        database.exec('BEGIN IMMEDIATE')
        try {
          const result = operation(handle)
          if (result !== null && typeof result === 'object' && 'then' in result) {
            throw new TypeError('storage transaction callback must be synchronous')
          }
          database.exec('COMMIT')
          return result
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      },
      close() {
        dispose?.()
      },
    }
    try {
      dispose = this.ctx.effect(() => {
        this.databases.set(namespace, { handle })
        return () => {
          if (closed) return
          closed = true
          if (this.databases.get(namespace)?.handle === handle) this.databases.delete(namespace)
          database.close()
        }
      }, `doppelgangerInstanceSqlite.open(${namespace})`)
    } catch (error) {
      closed = true
      database.close()
      throw error
    }
    return Object.freeze(handle)
  }
}
