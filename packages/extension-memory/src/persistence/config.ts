import { isAbsolute, normalize } from 'node:path'

export interface SqliteMemoryConfig {
  readonly kind: 'sqlite'
  readonly home: string
  readonly namespace?: string
  readonly busyTimeoutMs?: number
}

export interface PostgresqlMemoryConfig {
  readonly kind: 'postgresql'
  readonly connectionStringEnv: string
  readonly schema: string
  readonly poolSize?: number
  readonly connectionTimeoutMs?: number
  readonly statementTimeoutMs?: number
  readonly lockTimeoutMs?: number
}

export type MemoryDatabaseConfig = SqliteMemoryConfig | PostgresqlMemoryConfig

const SQLITE_KEYS: Readonly<Record<string, true>> = { kind: true, home: true, namespace: true, busyTimeoutMs: true }
const POSTGRESQL_KEYS: Readonly<Record<string, true>> = {
  kind: true, connectionStringEnv: true, schema: true, poolSize: true,
  connectionTimeoutMs: true, statementTimeoutMs: true, lockTimeoutMs: true,
}
const POSTGRESQL_DSN_PARAMETERS = new Set(['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'application_name'])

function boundedInteger(value: unknown, field: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`memory repository ${field} must be an integer between 1 and ${maximum}`)
  }
  return value
}

export function validateMemoryDatabaseConfig(input: MemoryDatabaseConfig): MemoryDatabaseConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('memory repository config must be an object')
  const keys = input.kind === 'sqlite' ? SQLITE_KEYS : POSTGRESQL_KEYS
  if (Object.keys(input).some(key => !Object.hasOwn(keys, key))) throw new TypeError('memory repository config contains unsupported fields')
  if (input.kind === 'sqlite') {
    if (typeof input.home !== 'string' || !isAbsolute(input.home)) {
      throw new TypeError('memory SQLite home must be absolute')
    }
    const namespace = input.namespace === undefined ? 'memory' : typeof input.namespace === 'string' ? input.namespace.trim() : ''
    if (!/^[a-z][a-z0-9-]*$/u.test(namespace)) throw new TypeError('memory SQLite namespace must be lowercase alphanumeric with optional hyphens')
    return Object.freeze({ kind: 'sqlite', home: normalize(input.home), namespace, busyTimeoutMs: input.busyTimeoutMs === 0 ? 0 : boundedInteger(input.busyTimeoutMs, 'busyTimeoutMs', 5_000, 120_000) })
  }
  if (input.kind !== 'postgresql') throw new TypeError('memory repository kind must be sqlite or postgresql')
  if (typeof input.connectionStringEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.connectionStringEnv)) throw new TypeError('memory PostgreSQL credentials require an environment-variable name')
  if (typeof input.schema !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(input.schema) || input.schema === 'public' || input.schema.startsWith('pg_') || input.schema === 'information_schema') {
    throw new TypeError('memory PostgreSQL schema must be a dedicated non-system identifier')
  }
  return Object.freeze({
    kind: 'postgresql', connectionStringEnv: input.connectionStringEnv, schema: input.schema,
    poolSize: boundedInteger(input.poolSize, 'poolSize', 4, 64),
    connectionTimeoutMs: boundedInteger(input.connectionTimeoutMs, 'connectionTimeoutMs', 5_000, 120_000),
    statementTimeoutMs: boundedInteger(input.statementTimeoutMs, 'statementTimeoutMs', 30_000, 600_000),
    lockTimeoutMs: boundedInteger(input.lockTimeoutMs, 'lockTimeoutMs', 5_000, 120_000),
  })
}

export function resolvePostgresqlConnection(config: PostgresqlMemoryConfig): string {
  const value = process.env[config.connectionStringEnv]
  if (!value) throw new TypeError('memory PostgreSQL credential reference is unavailable')
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error()
    const seenParameters = new Set<string>()
    for (const key of url.searchParams.keys()) {
      if (!POSTGRESQL_DSN_PARAMETERS.has(key) || seenParameters.has(key)) throw new Error()
      seenParameters.add(key)
    }
    // Explicit disable is for an operator-secured network; never relax TLS verification.
    const tlsMode = url.searchParams.get('sslmode')
    if (tlsMode !== null && !['disable', 'verify-full'].includes(tlsMode)) throw new Error()
    if (tlsMode === null && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full')
    return url.toString()
  } catch {
    throw new TypeError('memory PostgreSQL credential reference contains an invalid or unsafe connection configuration')
  }
}
