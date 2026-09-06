import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { EntitySchema } from '@mikro-orm/core'
import { MikroORM as SqlMikroORM, SqliteDriver } from '@mikro-orm/sql'
import { MikroORM as PostgreSqlMikroORM } from '@mikro-orm/postgresql'
import { describe, expect, it } from 'vitest'
import { MemorySqliteDialect } from '../src/persistence/sqlite-dialect.ts'
import { memoryTransaction } from '../src/persistence/transaction.ts'

interface TransactionProbe { id: string; value: string }
const probe = new EntitySchema<TransactionProbe>({
  name: 'MemoryTransactionProbe', tableName: 'memory_transaction_probe',
  properties: { id: { type: 'string', primary: true }, value: { type: 'string' } },
})

async function sqlitePair() {
  const home = await mkdtemp(join(tmpdir(), 'memory-orm-transaction-'))
  const dbName = join(home, 'memory.sqlite')
  const first = await SqlMikroORM.init({ driver: SqliteDriver, entities: [probe], dbName, driverOptions: new MemorySqliteDialect(dbName) })
  try {
    await first.em.fork().execute('PRAGMA journal_mode = WAL')
    await first.em.fork().execute('CREATE TABLE memory_transaction_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const second = await SqlMikroORM.init({ driver: SqliteDriver, entities: [probe], dbName, driverOptions: new MemorySqliteDialect(dbName) })
    await second.em.fork().execute('PRAGMA busy_timeout = 1')
    return { first, second, async close() { await second.close(true); await first.close(true); await rm(home, { recursive: true, force: true }) } }
  } catch (error) {
    await first.close(true)
    await rm(home, { recursive: true, force: true })
    throw error
  }
}

describe('canonical memory ORM transaction prerequisites', () => {
  it('reserves SQLite writes before reads and recovers its connection after a rejected reservation', async () => {
    const fixture = await sqlitePair()
    try {
      await memoryTransaction(fixture.first.em, 'write', async () => {
        await expect(memoryTransaction(fixture.second.em, 'write', async () => 'unexpected'))
          .rejects.toThrow(/locked|busy/i)
        expect(await fixture.second.em.fork().count(probe)).toBe(0)
      })
      await memoryTransaction(fixture.second.em, 'write', async writer => {
        await writer.insert(probe, { id: 'committed', value: 'visible' })
      })
      expect(await fixture.first.em.fork().findOneOrFail(probe, 'committed')).toMatchObject({ value: 'visible' })
    } finally { await fixture.close() }
  })

  it('lets competing SQLite clients yield while the reserved writer commits', async () => {
    const fixture = await sqlitePair()
    const entered = Promise.withResolvers<void>()
    try {
      await fixture.second.em.fork().execute('PRAGMA busy_timeout = 250')
      const owner = memoryTransaction(fixture.first.em, 'write', async writer => {
        entered.resolve()
        await delay(10)
        await writer.insert(probe, { id: 'owner', value: 'committed' })
      })
      const contender = entered.promise.then(() => memoryTransaction(fixture.second.em, 'write', async writer => {
        await writer.insert(probe, { id: 'contender', value: 'committed' })
      }))
      const outcomes = await Promise.allSettled([owner, contender])
      expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await fixture.first.em.fork().count(probe)).toBe(2)
      expect(await fixture.second.em.fork().execute('PRAGMA busy_timeout')).toEqual([{ timeout: 250 }])
    } finally { await fixture.close() }
  })

  it('rolls SQLite ORM entities and dialect SQL back on the same connection', async () => {
    const fixture = await sqlitePair()
    const fault = new Error('injected outbox failure')
    try {
      await expect(memoryTransaction(fixture.first.em, 'write', async writer => {
        writer.persist(writer.create(probe, { id: 'orm', value: 'canonical' }))
        await writer.flush()
        await writer.execute('INSERT INTO memory_transaction_probe (id, value) VALUES (?, ?)', ['sql', 'outbox'])
        expect(await writer.count(probe)).toBe(2)
        expect(await fixture.second.em.fork().count(probe)).toBe(0)
        throw fault
      })).rejects.toBe(fault)
      expect(await fixture.second.em.fork().count(probe)).toBe(0)
    } finally { await fixture.close() }
  })

  it('keeps SQLite read snapshots coherent without reserving a writer', async () => {
    const fixture = await sqlitePair()
    try {
      await fixture.first.em.fork().insert(probe, { id: 'record', value: 'before' })
      await memoryTransaction(fixture.first.em, 'read', async reader => {
        expect((await reader.execute('SELECT value FROM memory_transaction_probe'))[0]?.value).toBe('before')
        await memoryTransaction(fixture.second.em, 'write', async writer => {
          await writer.nativeUpdate(probe, 'record', { value: 'after' })
        })
        expect((await reader.execute('SELECT value FROM memory_transaction_probe'))[0]?.value).toBe('before')
      })
      expect((await fixture.first.em.fork().findOneOrFail(probe, 'record')).value).toBe('after')
    } finally { await fixture.close() }
  })

  it('uses PostgreSQL transaction affinity and database-owned partition locks across clients', async () => {
    const clientUrl = process.env.DOPPELGANGER_TEST_POSTGRESQL_DSN
    if (!clientUrl) throw new Error('DOPPELGANGER_TEST_POSTGRESQL_DSN is required for canonical PostgreSQL evidence')
    const schema = `memory_probe_${randomUUID().replaceAll('-', '')}`
    const first = await PostgreSqlMikroORM.init({ entities: [probe], clientUrl, schema })
    let second: typeof first | undefined
    try {
      await first.em.fork().execute(`CREATE SCHEMA "${schema}"`)
      await first.em.fork().execute(`CREATE TABLE "${schema}".memory_transaction_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)`)
      await first.em.fork().insert(probe, { id: 'partition', value: 'lock' })
      second = await PostgreSqlMikroORM.init({ entities: [probe], clientUrl, schema })
      const competitor = second.em
      const fault = new Error('injected outbox failure')
      await expect(memoryTransaction(first.em, 'write', async writer => {
        await writer.execute(`SELECT id FROM "${schema}".memory_transaction_probe WHERE id = ? FOR UPDATE`, ['partition'])
        await expect(memoryTransaction(competitor, 'write', async competingWriter => {
          await competingWriter.execute("SET LOCAL lock_timeout = '100ms'")
          await competingWriter.execute(`SELECT id FROM "${schema}".memory_transaction_probe WHERE id = ? FOR UPDATE`, ['partition'])
        })).rejects.toThrow(/lock timeout/i)
        writer.persist(writer.create(probe, { id: 'orm', value: 'canonical' }))
        await writer.flush()
        await writer.execute(`INSERT INTO "${schema}".memory_transaction_probe (id, value) VALUES (?, ?)`, ['sql', 'outbox'])
        expect(await writer.count(probe)).toBe(3)
        expect(await competitor.fork().count(probe)).toBe(1)
        throw fault
      })).rejects.toBe(fault)
      expect(await competitor.fork().count(probe)).toBe(1)
      await memoryTransaction(competitor, 'write', async writer => {
        await writer.nativeUpdate(probe, 'partition', { value: 'committed' })
      })
      expect((await first.em.fork().findOneOrFail(probe, 'partition')).value).toBe('committed')
    } finally {
      await second?.close(true)
      try { await first.em.fork().execute(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) }
      finally { await first.close(true) }
    }
  })
})
