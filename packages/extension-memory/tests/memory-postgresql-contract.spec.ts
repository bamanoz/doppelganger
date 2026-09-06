import { describe, expect, it } from 'vitest'
import {
  assertCompleteCanonicalMemoryContract,
  assertConcurrentCorrectionCas,
  assertConcurrentIdenticalOperation,
  assertConcurrentSubjectCreation,
  assertCurrentReadFreshness,
  assertDeletionFreshness,
  assertMultilingualLexicalCorpus,
  assertPostgresqlInstanceBeforePartitionLockOrder,
  assertPostgresqlLexicalRollback,
} from './memory-backend-assertions.ts'
import { createMemoryBackendFixture, type MemoryBackendFixture } from './memory-backend-fixture.ts'
import { createPostgresqlCommitDropProxy } from './postgresql-commit-proxy.ts'
import { createPostgresqlFixture } from './postgresql-fixture.ts'

async function withPostgresql(assertion: (fixture: MemoryBackendFixture) => Promise<void>): Promise<void> {
  const fixture = await createMemoryBackendFixture('postgresql')
  try {
    await assertion(fixture)
  } finally {
    await fixture.close()
  }
}

describe('PostgreSQL canonical memory contract', () => {
  it('rolls back every canonical side effect when lexical persistence fails', async () => {
    await withPostgresql(assertPostgresqlLexicalRollback)
  })

  it('serializes competing first writes for one canonical subject', async () => {
    await withPostgresql(assertConcurrentSubjectCreation)
  })

  it('allows one correction winner for a shared expected revision', async () => {
    await withPostgresql(assertConcurrentCorrectionCas)
  })

  it('deduplicates identical concurrent operation delivery', async () => {
    await withPostgresql(assertConcurrentIdenticalOperation)
  })

  it('acquires the instance lock before the actor partition lock', async () => {
    await withPostgresql(assertPostgresqlInstanceBeforePartitionLockOrder)
  })

  it('recovers an uncertain commit through the original operation receipt', async () => {
    const postgresql = await createPostgresqlFixture()
    const target = process.env[postgresql.config.connectionStringEnv]
    if (target === undefined) throw new Error(`missing ${postgresql.config.connectionStringEnv}`)
    const proxy = await createPostgresqlCommitDropProxy(target)
    const proxyEnvironment = 'DOPPELGANGER_MEMORY_TEST_PROXY_DSN'
    const previous = process.env[proxyEnvironment]
    process.env[proxyEnvironment] = proxy.connectionString
    const fixture = await createMemoryBackendFixture('postgresql', {
      postgresqlFixture: postgresql,
      connectionStringEnv: proxyEnvironment,
    })
    const request = {
      operationId: 'postgresql-uncertain-commit',
      subjectKey: 'project.postgresql.uncertain',
      kind: 'fact' as const,
      content: 'A committed response can be recovered exactly.',
      evidence: { turnId: 'postgresql-uncertain-turn', role: 'principal' as const },
    }
    try {
      const uncertain = await fixture.createSession({ sessionId: 'postgresql-uncertain-first' })
      proxy.arm()
      await expect(uncertain.memory.remember(request)).rejects.toBeDefined()
      await proxy.committedResponseDropped()
      await uncertain.dispose()

      const replay = await fixture.createSession({ sessionId: 'postgresql-uncertain-replay' })
      try {
        const record = await replay.memory.remember(request)
        expect(record.revision.content).toBe(request.content)
        expect(await replay.memory.history(record.id)).toHaveLength(1)
        expect(await replay.memory.evidence(record.id)).toHaveLength(1)
        const operations = await replay.database.read(async em => await em.execute(
          'SELECT operation_id, result_kind FROM memory_operations WHERE operation_id = ?',
          [request.operationId],
          'all',
        ) as readonly Record<string, unknown>[])
        expect(operations).toEqual([{ operation_id: request.operationId, result_kind: 'record' }])
      } finally {
        await replay.dispose()
      }
    } finally {
      await fixture.close()
      await proxy.close()
      if (previous === undefined) delete process.env[proxyEnvironment]
      else process.env[proxyEnvironment] = previous
    }
  })

  it('returns exact committed state to already-initialized readers', async () => {
    await withPostgresql(assertCurrentReadFreshness)
  })

  it('observes another client deletion without restarting memory', async () => {
    await withPostgresql(assertDeletionFreshness)
  })

  it('fails canonical reads instead of serving a stale ORM cache', async () => {
    const postgresql = await createPostgresqlFixture()
    const target = process.env[postgresql.config.connectionStringEnv]
    if (target === undefined) throw new Error(`missing ${postgresql.config.connectionStringEnv}`)
    const proxy = await createPostgresqlCommitDropProxy(target)
    const proxyEnvironment = 'DOPPELGANGER_MEMORY_TEST_OUTAGE_PROXY_DSN'
    const previous = process.env[proxyEnvironment]
    process.env[proxyEnvironment] = proxy.connectionString
    const fixture = await createMemoryBackendFixture('postgresql', {
      postgresqlFixture: postgresql,
      connectionStringEnv: proxyEnvironment,
    })
    try {
      const session = await fixture.createSession({ sessionId: 'postgresql-outage-reader' })
      const record = await session.memory.remember({
        operationId: 'postgresql-outage-seed',
        subjectKey: 'project.postgresql.outage',
        kind: 'fact',
        content: 'Canonical outage must not return cached state.',
      })
      expect((await session.memory.inspect(record.id)).id).toBe(record.id)
      await proxy.close()
      await expect(session.memory.inspect(record.id)).rejects.toBeDefined()
      await session.dispose()
    } finally {
      await fixture.close()
      await proxy.close()
      if (previous === undefined) delete process.env[proxyEnvironment]
      else process.env[proxyEnvironment] = previous
    }
  })

  it('retrieves multilingual and technical lexical evidence without semantic dependencies', async () => {
    await withPostgresql(assertMultilingualLexicalCorpus)
  })

  it('satisfies the complete shared canonical memory contract', async () => {
    await withPostgresql(assertCompleteCanonicalMemoryContract)
  })
})
