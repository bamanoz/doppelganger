import type { SqlEntityManager } from '@mikro-orm/sql'

/**
 * Keep connection acquisition/release inside Kysely's callback lifetime.
 * Its controlled-transaction builder in 0.29.5 leaks acquisition when BEGIN
 * rejects; MikroORM 7.1.15's em.begin/transactional use that builder.
 * ORM operations and dialect SQL use the same explicit transaction context.
 */
export async function memoryTransaction<T>(
  manager: SqlEntityManager,
  mode: 'read' | 'write',
  operation: (transaction: SqlEntityManager) => Promise<T>,
): Promise<T> {
  const transactionManager = manager.fork({ clear: true, useContext: false })
  let builder = transactionManager.getKysely().transaction()
  if (mode === 'read') builder = builder.setAccessMode('read only').setIsolationLevel('repeatable read')
  return builder.execute(async transaction => {
    transactionManager.setTransactionContext(transaction)
    try {
      const result = await operation(transactionManager)
      if (mode === 'write') await transactionManager.flush()
      return result
    } finally {
      transactionManager.resetTransactionContext()
      transactionManager.clear()
    }
  })
}
