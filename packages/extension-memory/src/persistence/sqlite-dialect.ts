import { setTimeout as delay } from 'node:timers/promises'
import { NodeSqliteDialect } from '@mikro-orm/sql'
import { CompiledQuery, type Driver } from 'kysely'

/** Reserve the writer before domain reads; read snapshots do not reserve it. */
export class MemorySqliteDialect extends NodeSqliteDialect {
  override createDriver(): Driver {
    const driver = super.createDriver()
    driver.beginTransaction = async (connection, settings) => {
      if (settings.accessMode === 'read only') {
        await connection.executeQuery(CompiledQuery.raw('begin'))
        return
      }
      const timeout = await connection.executeQuery<{ timeout: number }>(CompiledQuery.raw('PRAGMA busy_timeout'))
      const busyTimeoutMs = timeout.rows[0]!.timeout
      const deadline = performance.now() + busyTimeoutMs
      let acquired = false
      // DatabaseSync cannot sleep while another client needs this event loop to commit.
      // Only reservation acquisition retries; a started transaction is never replayed.
      await connection.executeQuery(CompiledQuery.raw('PRAGMA busy_timeout = 0'))
      try {
        for (;;) {
          try {
            await connection.executeQuery(CompiledQuery.raw('begin immediate'))
            acquired = true
            break
          } catch (error) {
            const remaining = deadline - performance.now()
            if (!(error instanceof Error) || !/database is locked/u.test(error.message) || remaining <= 0) throw error
            await delay(Math.min(10, remaining))
          }
        }
      } finally {
        try {
          await connection.executeQuery(CompiledQuery.raw(`PRAGMA busy_timeout = ${busyTimeoutMs}`))
        } catch (error) {
          // Kysely has not observed BEGIN success yet, so it cannot roll this back.
          if (acquired) await driver.rollbackTransaction(connection)
          throw error
        }
      }
    }
    return driver
  }
}
