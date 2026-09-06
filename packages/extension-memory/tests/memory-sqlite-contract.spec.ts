import { describe, it } from 'vitest'
import {
  assertCompleteCanonicalMemoryContract,
  assertMultilingualLexicalCorpus,
  assertSqliteOutboxRollback,
  assertSqliteProcessCorrectionCas,
  assertSqliteProcessFreshness,
  assertSqliteProcessIdenticalOperation,
  assertSqliteProcessSubjectCreation,
} from './memory-backend-assertions.ts'
import { createMemoryBackendFixture, type MemoryBackendFixture } from './memory-backend-fixture.ts'

async function withSqlite(assertion: (fixture: MemoryBackendFixture) => Promise<void>): Promise<void> {
  const fixture = await createMemoryBackendFixture('sqlite')
  try {
    await assertion(fixture)
  } finally {
    await fixture.close()
  }
}

describe('SQLite canonical memory contract', () => {
  it('rolls back every canonical side effect when outbox persistence fails', async () => {
    await withSqlite(assertSqliteOutboxRollback)
  })

  it('serializes competing first writes for one canonical subject', async () => {
    await withSqlite(assertSqliteProcessSubjectCreation)
  })

  it('allows one correction winner for a shared expected revision', async () => {
    await withSqlite(assertSqliteProcessCorrectionCas)
  })

  it('deduplicates identical concurrent operation delivery', async () => {
    await withSqlite(assertSqliteProcessIdenticalOperation)
  })

  it('observes another process commit without restarting memory', async () => {
    await withSqlite(assertSqliteProcessFreshness)
  })

  it('preserves multilingual and technical lexical retrieval through the ORM adapter', async () => {
    await withSqlite(assertMultilingualLexicalCorpus)
  })

  it('satisfies the complete shared canonical memory contract', async () => {
    await withSqlite(assertCompleteCanonicalMemoryContract)
  })
})
