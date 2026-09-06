import { EntitySchema } from '@mikro-orm/core'
import { MikroORM as PostgreSqlMikroORM } from '@mikro-orm/postgresql'
import { afterEach, describe, expect, it } from 'vitest'
import {
  POSTGRESQL_TEST_DSN_ENV,
  createPostgresqlFixture,
  type PostgresqlFixture,
} from './postgresql-fixture.ts'

interface TeardownProbe {
  id: string
}

const teardownProbe = new EntitySchema<TeardownProbe>({
  name: 'PostgresqlFixtureTeardownProbe',
  tableName: 'postgresql_fixture_teardown_probe',
  properties: {
    id: { type: 'string', primary: true },
  },
})

const fixtures: PostgresqlFixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
})

describe('PostgreSQL 17 test fixture', () => {
  it('creates an isolated schema through a real MikroORM PostgreSQL connection', async () => {
    const fixture = await createPostgresqlFixture()
    fixtures.push(fixture)

    expect(fixture.schema).toMatch(/^dg_memory_[a-f0-9]{32}$/)
    expect(fixture.config).toEqual({
      connectionStringEnv: POSTGRESQL_TEST_DSN_ENV,
      schema: fixture.schema,
      poolSize: 4,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
    })
    const subprocessEnvironment = fixture.subprocessEnv({ FIXTURE_SENTINEL: 'present' })
    const resolvedDsn = subprocessEnvironment[POSTGRESQL_TEST_DSN_ENV]
    if (!resolvedDsn) throw new Error('fixture did not provide its explicit subprocess credential')
    expect(subprocessEnvironment.FIXTURE_SENTINEL).toBe('present')
    expect(JSON.stringify(fixture.config)).not.toContain(resolvedDsn)

    const rows = await fixture.client.em.execute<Array<{
      server_major: number
      schema_exists: boolean
      current_schema: string
    }>>(
      `SELECT current_setting('server_version_num')::integer / 10000 AS server_major,
              to_regnamespace(?) IS NOT NULL AS schema_exists,
              current_schema() AS current_schema`,
      [fixture.schema],
    )
    expect(rows).toEqual([{
      server_major: 17,
      schema_exists: true,
      current_schema: fixture.schema,
    }])
  })

  it('provides separately initialized tracked clients for concurrency scenarios', async () => {
    const fixture = await createPostgresqlFixture()
    fixtures.push(fixture)
    const second = await fixture.createIndependentClient()

    expect(second.orm).not.toBe(fixture.client.orm)
    expect(second.em).not.toBe(fixture.client.em)
    await fixture.client.em.execute(
      'CREATE TABLE postgresql_fixture_shared (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
    await fixture.client.em.execute(
      'INSERT INTO postgresql_fixture_shared (id, value) VALUES (?, ?)',
      ['shared', 'visible'],
    )
    expect(await fixture.client.em.execute<Array<{ current_schema: string; public_table_exists: boolean }>>(
      `SELECT current_schema() AS current_schema,
              to_regclass('public.postgresql_fixture_shared') IS NOT NULL AS public_table_exists`,
    )).toEqual([{ current_schema: fixture.schema, public_table_exists: false }])
    expect(await second.em.execute<Array<{ value: string }>>(
      'SELECT value FROM postgresql_fixture_shared WHERE id = ?',
      ['shared'],
    )).toEqual([{ value: 'visible' }])
  })

  it('closes tracked clients before removing its schema and supports idempotent teardown', async () => {
    const fixture = await createPostgresqlFixture()
    fixtures.push(fixture)
    const schema = fixture.schema
    const second = await fixture.createIndependentClient()
    const observerEnvironment = fixture.subprocessEnv()
    const primarySessions = await fixture.client.em.execute<Array<{ pid: number }>>('SELECT pg_backend_pid() AS pid')
    const secondarySessions = await second.em.execute<Array<{ pid: number }>>('SELECT pg_backend_pid() AS pid')
    const primaryPid = primarySessions[0]?.pid
    const secondaryPid = secondarySessions[0]?.pid
    expect(primaryPid).toBeTypeOf('number')
    expect(secondaryPid).toBeTypeOf('number')
    expect(secondaryPid).not.toBe(primaryPid)

    const clientUrl = observerEnvironment[POSTGRESQL_TEST_DSN_ENV]
    if (!clientUrl) throw new Error('fixture did not provide its explicit observer credential')
    const observer = await PostgreSqlMikroORM.init({
      entities: [teardownProbe],
      clientUrl,
      pool: { min: 0, max: 1, idleTimeoutMillis: 1_000 },
      driverOptions: {
        connectionTimeoutMillis: 5_000,
        query_timeout: 10_000,
        statement_timeout: 10_000,
      },
      debug: false,
      logger: () => {},
    })
    try {
      const observerEm = observer.em.fork()
      const observerSessions = await observerEm.execute<Array<{ pid: number }>>('SELECT pg_backend_pid() AS pid')
      const observerPid = observerSessions[0]?.pid
      expect(observerPid).toBeTypeOf('number')
      expect(observerPid).not.toBe(primaryPid)
      expect(observerPid).not.toBe(secondaryPid)

      await fixture.close()
      await fixture.close()
      await expect(fixture.createIndependentClient()).rejects.toThrow('closing or closed')
      const rows = await observerEm.execute<Array<{ schema_exists: boolean; open_client_count: number }>>(
        `SELECT to_regnamespace(?) IS NOT NULL AS schema_exists,
                (SELECT count(*)::integer FROM pg_stat_activity WHERE pid IN (?, ?)) AS open_client_count`,
        [schema, primaryPid, secondaryPid],
      )
      expect(rows).toEqual([{ schema_exists: false, open_client_count: 0 }])
    } finally {
      await observer.close(true)
    }
  })

  it('rejects a missing DSN instead of skipping PostgreSQL coverage', async () => {
    await expect(createPostgresqlFixture({ environment: {} })).rejects.toThrow(
      `${POSTGRESQL_TEST_DSN_ENV} is required for the PostgreSQL 17 test fixture`,
    )
  })

  it('rejects an invalid DSN without echoing credential-like input', async () => {
    const secretInput = 'not-a-postgresql-url-with-secret-material'
    let message = ''
    try {
      await createPostgresqlFixture({
        environment: { [POSTGRESQL_TEST_DSN_ENV]: secretInput },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('must contain a valid PostgreSQL connection URL')
    expect(message).not.toContain(secretInput)
  })
})
