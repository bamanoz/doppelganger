import { describe, it } from 'vitest'
import {
  assertActorPartitionRestart,
  assertCompleteLexicalQueryProjection,
  assertFinalRecallRevalidation,
  assertHybridFusion,
  assertLexicalFallback,
  assertNoProjectionWorkWithoutGeneration,
  assertProjectionAtomicCommit,
  assertScopedLexicalRecall,
  assertStaleSemanticRevalidation,
} from './memory-backend-assertions.ts'
import { createMemoryBackendFixture, type MemoryBackendFixture } from './memory-backend-fixture.ts'

async function acrossBoth(assertion: (fixture: MemoryBackendFixture) => Promise<void>): Promise<void> {
  for (const kind of ['sqlite', 'postgresql'] as const) {
    const fixture = await createMemoryBackendFixture(kind)
    try {
      await assertion(fixture)
    } finally {
      await fixture.close()
    }
  }
}

describe('canonical memory backend conformance', () => {
  it('preserves scoped lexical recall across SQLite and PostgreSQL', async () => {
    await acrossBoth(assertScopedLexicalRecall)
  })

  it('falls back to canonical lexical retrieval across SQLite and PostgreSQL', async () => {
    await acrossBoth(assertLexicalFallback)
  })

  it('searches the complete lexical query while bounding semantic projection on both providers', async () => {
    await acrossBoth(assertCompleteLexicalQueryProjection)
  })

  it('bulk revalidates final recall after awaited semantic work on both providers', async () => {
    await acrossBoth(assertFinalRecallRevalidation)
  })

  it('provides lexical-only recall through SQLite and PostgreSQL', async () => {
    await acrossBoth(assertScopedLexicalRecall)
  })

  it('preserves deterministic hybrid fusion invariants across both canonical providers', async () => {
    await acrossBoth(assertHybridFusion)
  })

  it('preserves complete lexical evidence while bounding semantic queries on both providers', async () => {
    await acrossBoth(assertCompleteLexicalQueryProjection)
  })

  it('preserves actor-partitioned memory across SQLite and PostgreSQL restarts', async () => {
    await acrossBoth(assertActorPartitionRestart)
  })

  it('revalidates stale semantic content against both canonical providers', async () => {
    await acrossBoth(assertStaleSemanticRevalidation)
  })

  it('atomically commits canonical mutations and projection work on both providers', async () => {
    await acrossBoth(assertProjectionAtomicCommit)
  })

  it('commits canonical and lexical state without projection work on both providers', async () => {
    await acrossBoth(assertNoProjectionWorkWithoutGeneration)
  })
})
