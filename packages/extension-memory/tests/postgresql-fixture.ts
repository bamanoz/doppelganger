import { randomUUID } from 'node:crypto'
import { EntitySchema, type MikroORM } from '@mikro-orm/core'
import {
  MikroORM as PostgreSqlMikroORM,
  type EntityManager as PostgreSqlEntityManager,
  type PostgreSqlDriver,
} from '@mikro-orm/postgresql'

/** Explicit test-only environment variable containing the disposable PostgreSQL server DSN. */
export const POSTGRESQL_TEST_DSN_ENV = 'DOPPELGANGER_TEST_POSTGRESQL_DSN'

const POSTGRESQL_SCHEMA_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
const DEFAULT_POOL_SIZE = 4
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 1_000

type FixtureOrm = MikroORM<PostgreSqlDriver, PostgreSqlEntityManager>
type FixtureEntityManager = FixtureOrm['em']

interface PostgresqlFixtureProbe {
  id: string
}

const postgresqlFixtureProbe = new EntitySchema<PostgresqlFixtureProbe>({
  name: 'PostgresqlFixtureProbe',
  tableName: 'postgresql_fixture_probe',
  properties: {
    id: { type: 'string', primary: true },
  },
})

/** Serializable, credential-free configuration for backend and helper-process tests. */
export interface PostgresqlFixtureConfig {
  readonly connectionStringEnv: typeof POSTGRESQL_TEST_DSN_ENV
  readonly schema: string
  readonly poolSize: number
  readonly connectionTimeoutMs: number
  readonly statementTimeoutMs: number
  readonly lockTimeoutMs: number
}

/** An independently initialized MikroORM PostgreSQL client owned by its fixture. */
export interface PostgresqlFixtureClient {
  readonly orm: FixtureOrm
  readonly em: FixtureEntityManager
  /** Closes this client early; fixture cleanup also closes every tracked client. */
  close(): Promise<void>
}

/** Inputs used only to resolve the explicitly selected disposable test service. */
export interface PostgresqlFixtureOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>
}

/**
 * Disposable PostgreSQL 17 schema fixture.
 *
 * The fixture owns its primary and independent clients. `close()` first closes every
 * tracked client, then drops and verifies removal of the random schema, and is idempotent.
 */
export interface PostgresqlFixture {
  readonly schema: string
  readonly config: PostgresqlFixtureConfig
  readonly client: PostgresqlFixtureClient
  /** Creates a separate MikroORM instance and connection pool for concurrency scenarios. */
  createIndependentClient(): Promise<PostgresqlFixtureClient>
  /**
   * Returns an explicit child-process environment containing the test DSN reference.
   * The returned value contains a credential and must not be logged or persisted.
   */
  subprocessEnv(baseEnvironment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  close(): Promise<void>
}

class SafeFixtureError extends Error {}

function requiredClientUrl(environment: Readonly<Record<string, string | undefined>>): string {
  const clientUrl = environment[POSTGRESQL_TEST_DSN_ENV]?.trim()
  if (!clientUrl) {
    throw new SafeFixtureError(`${POSTGRESQL_TEST_DSN_ENV} is required for the PostgreSQL 17 test fixture`)
  }

  try {
    const parsed = new URL(clientUrl)
    if ((parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
      throw new Error('invalid PostgreSQL URL')
    }
  } catch {
    throw new SafeFixtureError(`${POSTGRESQL_TEST_DSN_ENV} must contain a valid PostgreSQL connection URL`)
  }

  return clientUrl
}

function createSchemaName(): string {
  const schema = `dg_memory_${randomUUID().replaceAll('-', '')}`
  if (!POSTGRESQL_SCHEMA_PATTERN.test(schema)) {
    throw new Error('generated PostgreSQL fixture schema is invalid')
  }
  return schema
}

function quotedSchema(schema: string): string {
  if (!POSTGRESQL_SCHEMA_PATTERN.test(schema)) {
    throw new Error('PostgreSQL fixture schema is invalid')
  }
  return `"${schema}"`
}

function createConfig(schema: string): PostgresqlFixtureConfig {
  return Object.freeze({
    connectionStringEnv: POSTGRESQL_TEST_DSN_ENV,
    schema,
    poolSize: DEFAULT_POOL_SIZE,
    connectionTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
  })
}

async function initializeOrm(clientUrl: string, config: PostgresqlFixtureConfig, useSchema: boolean): Promise<FixtureOrm> {
  return PostgreSqlMikroORM.init({
    entities: [postgresqlFixtureProbe],
    clientUrl,
    ...(useSchema ? { schema: config.schema } : {}),
    pool: {
      min: 0,
      max: config.poolSize,
      idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS,
    },
    driverOptions: {
      application_name: 'doppelganger-memory-postgresql-tests',
      connectionTimeoutMillis: config.connectionTimeoutMs,
      query_timeout: config.statementTimeoutMs,
      statement_timeout: config.statementTimeoutMs,
      lock_timeout: config.lockTimeoutMs,
      idle_in_transaction_session_timeout: config.statementTimeoutMs,
      ...(useSchema ? { options: `-c search_path=${config.schema}` } : {}),
    },
    debug: false,
    logger: () => {},
  })
}

async function closeOrm(orm: FixtureOrm, description: string): Promise<void> {
  try {
    await orm.close(true)
  } catch {
    throw new SafeFixtureError(`failed to close ${description}`)
  }
}

function trackedClient(orm: FixtureOrm, clients: Set<PostgresqlFixtureClient>): PostgresqlFixtureClient {
  let closePromise: Promise<void> | undefined
  const client: PostgresqlFixtureClient = {
    orm,
    em: orm.em.fork(),
    close() {
      closePromise ??= closeOrm(orm, 'a PostgreSQL fixture client').then(() => {
        clients.delete(client)
      })
      return closePromise
    },
  }
  clients.add(client)
  return client
}

async function cleanupFailedInitialization(
  controlOrm: FixtureOrm | undefined,
  clientOrm: FixtureOrm | undefined,
  schema: string,
  schemaCreated: boolean,
): Promise<boolean> {
  let cleaned = true
  let clientClosed = true
  if (clientOrm) {
    try {
      await clientOrm.close(true)
    } catch {
      clientClosed = false
      cleaned = false
    }
  }

  if (controlOrm && schemaCreated && clientClosed) {
    try {
      await controlOrm.em.fork().execute(`DROP SCHEMA IF EXISTS ${quotedSchema(schema)} CASCADE`)
    } catch {
      cleaned = false
    }
  } else if (schemaCreated) {
    cleaned = false
  }

  if (controlOrm) {
    try {
      await controlOrm.close(true)
    } catch {
      cleaned = false
    }
  }
  return cleaned
}

/** Creates one random, dedicated schema on the explicitly configured PostgreSQL 17 test server. */
export async function createPostgresqlFixture(
  options: PostgresqlFixtureOptions = {},
): Promise<PostgresqlFixture> {
  const environment = options.environment ?? process.env
  const clientUrl = requiredClientUrl(environment)
  const schema = createSchemaName()
  const config = createConfig(schema)
  const schemaSql = quotedSchema(schema)
  let controlOrm: FixtureOrm | undefined
  let primaryOrm: FixtureOrm | undefined
  let schemaCreated = false

  try {
    controlOrm = await initializeOrm(clientUrl, config, false)
    const versionRows = await controlOrm.em.fork().execute<Array<{ server_version_num: string }>>(
      `SELECT current_setting('server_version_num') AS server_version_num`,
    )
    const serverVersionNumber = Number.parseInt(versionRows[0]?.server_version_num ?? '', 10)
    const serverMajor = Math.floor(serverVersionNumber / 10_000)
    if (!Number.isSafeInteger(serverVersionNumber) || serverMajor !== 17) {
      const observed = Number.isSafeInteger(serverMajor) ? String(serverMajor) : 'unknown'
      throw new SafeFixtureError(`PostgreSQL fixture requires server major 17; observed ${observed}`)
    }

    await controlOrm.em.fork().execute(`CREATE SCHEMA ${schemaSql}`)
    schemaCreated = true
    primaryOrm = await initializeOrm(clientUrl, config, true)
  } catch (error) {
    const cleaned = await cleanupFailedInitialization(controlOrm, primaryOrm, schema, schemaCreated)
    const cleanupDiagnostic = cleaned ? '' : '; fixture cleanup also failed'
    if (error instanceof SafeFixtureError) {
      throw new SafeFixtureError(`${error.message}${cleanupDiagnostic}`)
    }
    throw new SafeFixtureError(
      `PostgreSQL 17 fixture initialization failed; verify ${POSTGRESQL_TEST_DSN_ENV} and the disposable test server${cleanupDiagnostic}`,
    )
  }
  if (!controlOrm || !primaryOrm) {
    throw new SafeFixtureError('PostgreSQL 17 fixture initialization did not produce usable clients')
  }

  const clients = new Set<PostgresqlFixtureClient>()
  let lateClientCloseFailed = false
  const pendingClients = new Set<Promise<PostgresqlFixtureClient>>()
  const client = trackedClient(primaryOrm, clients)
  let closing = false
  let closed = false
  let closePromise: Promise<void> | undefined

  const fixture: PostgresqlFixture = {
    schema,
    config,
    client,
    createIndependentClient() {
      if (closing || closed) {
        return Promise.reject(new SafeFixtureError('PostgreSQL fixture is closing or closed'))
      }

      const pending = (async () => {
        let orm: FixtureOrm
        try {
          orm = await initializeOrm(clientUrl, config, true)
        } catch {
          throw new SafeFixtureError('failed to initialize an independent PostgreSQL fixture client')
        }
        if (closing || closed) {
          try {
            await closeOrm(orm, 'a late PostgreSQL fixture client')
          } catch {
            lateClientCloseFailed = true
            throw new SafeFixtureError('failed to close a late PostgreSQL fixture client')
          }
          throw new SafeFixtureError('PostgreSQL fixture closed while creating an independent client')
        }
        return trackedClient(orm, clients)
      })()
      pendingClients.add(pending)
      void pending.finally(() => pendingClients.delete(pending)).catch(() => {})
      return pending
    },
    subprocessEnv(baseEnvironment = {}) {
      return {
        ...baseEnvironment,
        [POSTGRESQL_TEST_DSN_ENV]: clientUrl,
      }
    },
    close() {
      closePromise ??= (async () => {
        if (closed) return
        closing = true
        await Promise.allSettled([...pendingClients])
        const failures: string[] = []
        if (lateClientCloseFailed) failures.push('close a late independent client')

        for (const ownedClient of [...clients].reverse()) {
          try {
            await ownedClient.close()
          } catch {
            failures.push('close a tracked client')
          }
        }

        if (clients.size === 0 && failures.length === 0) {
          try {
            await controlOrm.em.fork().execute(`DROP SCHEMA ${schemaSql} CASCADE`)
            const rows = await controlOrm.em.fork().execute<Array<{ schema_exists: boolean }>>(
              'SELECT to_regnamespace(?) IS NOT NULL AS schema_exists',
              [schema],
            )
            if (rows[0]?.schema_exists !== false) failures.push('verify schema removal')
          } catch {
            failures.push('remove the fixture schema')
          }
        } else {
          failures.push('remove the fixture schema after every client closed')
        }

        try {
          await closeOrm(controlOrm, 'the PostgreSQL fixture control client')
        } catch {
          failures.push('close the fixture control client')
        }

        if (failures.length > 0) {
          throw new SafeFixtureError(`PostgreSQL fixture cleanup failed to ${[...new Set(failures)].join(', ')}`)
        }
        closed = true
      })()
      return closePromise
    },
  }

  return fixture
}
