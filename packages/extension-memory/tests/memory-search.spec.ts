import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/extension-persona'
import { InstanceSqliteService } from '@doppelganger/extension-sqlite'
import { MemoryService, type MemoryEmbeddingProvider } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function session(
  instanceHome: string,
  sessionId: string,
  projectId: string,
  embedding?: MemoryEmbeddingProvider,
) {
  const context = new Context()
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'aiden',
    principalId: 'local-user',
    sessionId,
    projectId,
    projectRoot: join(instanceHome, projectId),
    instanceHome,
    definitionRoot: instanceHome,
  }))
  if (embedding !== undefined) {
    const provider: Plugin = {
      name: 'fake-embedding',
      apply(ctx) {
        ctx.provide('doppelgangerEmbedding', embedding)
      },
    }
    await context.plugin(provider)
  }
  await context.plugin(InstanceSqliteService, { home: instanceHome })
  await context.plugin(MemoryService)
  return context
}

async function root(): Promise<string> {
  const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-search-'))
  temporaryRoots.push(instanceHome)
  return instanceHome
}

describe('memory retrieval', () => {
  it('uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets', async () => {
    const instanceHome = await root()
    const first = await session(instanceHome, 'session-a', 'project-a')
    const relationship = first.doppelgangerMemory.remember({
      operationId: 'relationship',
      subjectKey: 'preference.response.evidence',
      kind: 'preference',
      content: 'Always state evidence.',
      scope: 'relationship',
    })
    first.doppelgangerMemory.pin({ operationId: 'pin-relationship', id: relationship.id, pinned: true })
    first.doppelgangerMemory.remember({
      operationId: 'alpha-decision',
      subjectKey: 'project.loader.engine',
      kind: 'decision',
      content: 'Project alpha uses Cordis Loader.',
    })
    first.doppelgangerMemory.remember({
      operationId: 'alpha-overlap',
      subjectKey: 'preference.response.evidence',
      kind: 'preference',
      content: 'Project alpha evidence uses citations.',
    })
    first.doppelgangerMemory.remember({
      operationId: 'alpha-other',
      subjectKey: 'project.database.engine',
      kind: 'fact',
      content: 'Project alpha evidence is in SQLite.',
    })
    await first.fiber.dispose()

    const other = await session(instanceHome, 'session-b', 'project-b')
    other.doppelgangerMemory.remember({
      operationId: 'beta-decision',
      subjectKey: 'project.loader.engine',
      kind: 'decision',
      content: 'Project beta uses Cordis Loader.',
    })
    await other.fiber.dispose()

    const current = await session(instanceHome, 'session-c', 'project-a')
    const results = await current.doppelgangerMemory.search({ query: 'evidence Cordis Loader', tokenBudget: 100 })
    expect(results[0]?.record.id).toBe(relationship.id)
    expect(results.map(result => result.record.revision.content)).toEqual([
      'Always state evidence.',
      'Project alpha uses Cordis Loader.',
      'Project alpha evidence is in SQLite.',
      'Project alpha evidence uses citations.',
    ])
    expect(results.every(result => result.record.scope.projectId !== 'project-b')).toBe(true)
    const constrained = await current.doppelgangerMemory.search({ query: 'evidence Cordis Loader', tokenBudget: 7 })
    expect(constrained.map(result => result.record.revision.content)).toEqual(['Always state evidence.'])
    await current.fiber.dispose()
  })

  it('uses deterministic reciprocal rank fusion and keeps lexical-only operation without a provider', async () => {
    const instanceHome = await root()
    const seed = await session(instanceHome, 'seed', 'project-a')
    const lexical = seed.doppelgangerMemory.remember({
      operationId: 'lexical',
      subjectKey: 'runtime.storage.engine',
      kind: 'fact',
      content: 'SQLite stores canonical memory.',
      salience: 0.2,
    })
    const semantic = seed.doppelgangerMemory.remember({
      operationId: 'semantic',
      subjectKey: 'runtime.transaction.policy',
      kind: 'procedure',
      content: 'Persist writes in short transactions.',
      salience: 0.8,
    })
    const overlap = seed.doppelgangerMemory.remember({
      operationId: 'overlap',
      subjectKey: 'runtime.sqlite.policy',
      kind: 'procedure',
      content: 'SQLite writes use short transactions.',
      salience: 0.5,
    })
    await seed.fiber.dispose()

    const lexicalOnly = await session(instanceHome, 'lexical-only', 'project-a')
    expect((await lexicalOnly.doppelgangerMemory.search({ query: 'SQLite', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([lexical.id, overlap.id])
    await lexicalOnly.fiber.dispose()

    const embedding: MemoryEmbeddingProvider = {
      async rank(_query, candidates) {
        expect(candidates).toEqual(expect.arrayContaining([
          expect.objectContaining({ recordId: lexical.id, revisionId: lexical.revision.id }),
          expect.objectContaining({ recordId: semantic.id, revisionId: semantic.revision.id }),
          expect.objectContaining({ recordId: overlap.id, revisionId: overlap.revision.id }),
        ]))
        return [
          { recordId: semantic.id, revisionId: semantic.revision.id, rank: 1 },
          { recordId: overlap.id, revisionId: overlap.revision.id, rank: 2 },
        ]
      },
    }
    const hybrid = await session(instanceHome, 'hybrid', 'project-a', embedding)
    const results = await hybrid.doppelgangerMemory.search({ query: 'SQLite', tokenBudget: 100 })
    expect(results.map(result => result.record.id)).toEqual([overlap.id, semantic.id, lexical.id])
    expect(results[0]).toMatchObject({ lexicalRank: 2, semanticRank: 2 })
    expect(results[1]).toMatchObject({ semanticRank: 1 })
    expect(results[2]).toMatchObject({ lexicalRank: 1 })
    await hybrid.fiber.dispose()
  })

  it('revalidates record and revision identity after asynchronous semantic ranking', async () => {
    const instanceHome = await root()
    const seed = await session(instanceHome, 'seed', 'project-a')
    const corrected = seed.doppelgangerMemory.remember({
      operationId: 'corrected-seed',
      subjectKey: 'stale.corrected',
      kind: 'fact',
      content: 'Stale corrected value.',
    })
    const deleted = seed.doppelgangerMemory.remember({
      operationId: 'deleted-seed',
      subjectKey: 'stale.deleted',
      kind: 'fact',
      content: 'Stale deleted value.',
    })
    const stable = seed.doppelgangerMemory.remember({
      operationId: 'stable-seed',
      subjectKey: 'stale.stable',
      kind: 'fact',
      content: 'Stale query stable value.',
    })
    await seed.fiber.dispose()

    let releaseRanking!: () => void
    const rankingReleased = new Promise<void>(resolve => { releaseRanking = resolve })
    let rankingStarted!: () => void
    const started = new Promise<void>(resolve => { rankingStarted = resolve })
    const embedding: MemoryEmbeddingProvider = {
      async rank(_query, candidates) {
        rankingStarted()
        await rankingReleased
        return candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }))
      },
    }
    const reader = await session(instanceHome, 'reader', 'project-a', embedding)
    const pending = reader.doppelgangerMemory.search({ query: 'Stale', tokenBudget: 100 })
    await started

    const writer = await session(instanceHome, 'writer', 'project-a')
    writer.doppelgangerMemory.correct({
      operationId: 'correct-during-rank',
      id: corrected.id,
      expectedRevisionId: corrected.revision.id,
      content: 'Fresh corrected value.',
    })
    writer.doppelgangerMemory.forget({ operationId: 'delete-during-rank', id: deleted.id })
    await writer.fiber.dispose()
    releaseRanking()

    expect((await pending).map(result => result.record.id)).toEqual([stable.id])
    await reader.fiber.dispose()
  })
})
