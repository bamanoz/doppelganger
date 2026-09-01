import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService, type InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { MemoryService, type MemorySemanticRetriever, type MemoryServiceConfig } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function semanticRetriever(search: MemorySemanticRetriever['search']): MemorySemanticRetriever {
  return {
    search,
    status() {
      return { active: true, supportedMaintenance: [] }
    },
    async maintenance() {
      throw new Error('maintenance is not used by retrieval tests')
    },
  }
}

async function session(
  instanceHome: string,
  sessionId: string,
  projectId: string,
  semantic?: MemorySemanticRetriever,
  memoryConfig: MemoryServiceConfig = {},
) {
  const context = new Context()
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'aiden',
    sessionId,
    projectId,
    projectRoot: join(instanceHome, projectId),
  }))
  await context.plugin(createActorIdentityPlugin('local-user'))
  if (semantic !== undefined) {
    const provider: Plugin = {
      name: 'fake-semantic-retriever',
      apply(ctx) {
        ctx.provide('doppelgangerMemorySemantic', semantic)
      },
    }
    await context.plugin(provider)
  }
  await context.plugin(InstanceSqliteService, { home: instanceHome })
  await context.plugin(MemoryService, memoryConfig)
  if (semantic !== undefined) {
    const database = (context.doppelgangerMemory as unknown as { database: InstanceSqliteDatabase }).database
    const now = new Date().toISOString()
    database.prepare(`
      INSERT OR IGNORE INTO memory_semantic_generations
      VALUES ('generation-one', 'aiden', '{}', '{}', 'active', ?, ?, ?, NULL)
    `).run(now, now, now)
    database.prepare(`
      INSERT OR REPLACE INTO memory_semantic_active_generation VALUES ('aiden', 'generation-one', ?)
    `).run(now)
  }
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

    const retriever = semanticRetriever(async request => {
      expect(request).toMatchObject({
        query: 'SQLite',
        instanceId: 'aiden',
        actorId: 'local-user',
        projectId: 'project-a',
      })
      return [
        { generationId: 'generation-one', recordId: semantic.id, revisionId: semantic.revision.id, rank: 1 },
        { generationId: 'generation-one', recordId: overlap.id, revisionId: overlap.revision.id, rank: 2 },
      ]
    })
    const hybrid = await session(instanceHome, 'hybrid', 'project-a', retriever)
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
    const retriever = semanticRetriever(async () => {
      rankingStarted()
      await rankingReleased
      return [corrected, deleted, stable].map((record, index) => ({
        generationId: 'generation-one',
        recordId: record.id,
        revisionId: record.revision.id,
        rank: index + 1,
      }))
    })
    const reader = await session(instanceHome, 'reader', 'project-a', retriever)
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

  it('projects only the semantic branch while lexical search keeps complete technical identifiers', async () => {
    const instanceHome = await root()
    const seed = await session(instanceHome, 'projection-seed', 'project-a')
    const lexical = seed.doppelgangerMemory.remember({
      operationId: 'projection-lexical',
      subjectKey: 'runtime.symbol',
      kind: 'fact',
      content: 'The exact symbol is RPC_FRAME_V7.',
    })
    const semantic = seed.doppelgangerMemory.remember({
      operationId: 'projection-semantic',
      subjectKey: 'runtime.transport.intent',
      kind: 'fact',
      content: 'Transport frames isolate message boundaries.',
    })
    await seed.fiber.dispose()

    const retriever = semanticRetriever(async request => {
      expect(request.query).toBe('How are message boundaries isolated?')
      return [{
        generationId: 'generation-one',
        recordId: semantic.id,
        revisionId: semantic.revision.id,
        rank: 1,
      }]
    })
    const reader = await session(instanceHome, 'projection-reader', 'project-a', retriever, {
      semanticQueryMaximumCharacters: 48,
    })
    const query = `RPC_FRAME_V7 ${'background '.repeat(20)}. How are message boundaries isolated?`
    const results = await reader.doppelgangerMemory.search({ query, tokenBudget: 100 })
    expect(results.map(result => result.record.id)).toEqual(expect.arrayContaining([lexical.id, semantic.id]))
    await reader.fiber.dispose()
  })

  it('drops out-of-scope and malformed semantic hits without failing lexical recall', async () => {
    const instanceHome = await root()
    const alpha = await session(instanceHome, 'scope-alpha', 'project-a')
    const lexical = alpha.doppelgangerMemory.remember({
      operationId: 'scope-lexical',
      subjectKey: 'project.alpha.transport',
      kind: 'fact',
      content: 'Project alpha uses framed transport.',
    })
    await alpha.fiber.dispose()
    const beta = await session(instanceHome, 'scope-beta', 'project-b')
    const foreign = beta.doppelgangerMemory.remember({
      operationId: 'scope-foreign',
      subjectKey: 'project.beta.transport',
      kind: 'fact',
      content: 'Project beta uses framed transport.',
    })
    await beta.fiber.dispose()

    const crossScope = semanticRetriever(async () => [{
      generationId: 'generation-one',
      recordId: foreign.id,
      revisionId: foreign.revision.id,
      rank: 1,
    }])
    const scoped = await session(instanceHome, 'scope-reader', 'project-a', crossScope)
    expect((await scoped.doppelgangerMemory.search({ query: 'framed', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([lexical.id])
    await scoped.fiber.dispose()

    const malformed = semanticRetriever(async () => [{
      generationId: 'wrong-generation',
      recordId: lexical.id,
      revisionId: lexical.revision.id,
      rank: 1,
    }])
    const guarded = await session(instanceHome, 'malformed-reader', 'project-a', malformed)
    expect((await guarded.doppelgangerMemory.search({ query: 'framed', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([lexical.id])
    expect(guarded.doppelgangerMemory.semanticFailure()).toMatchObject({ code: 'malformed-hit' })
    expect(JSON.stringify(guarded.doppelgangerMemory.semanticFailure())).not.toContain('framed')
    await guarded.fiber.dispose()
  })

  it('contains semantic timeout and provider exceptions', async () => {
    const instanceHome = await root()
    const seed = await session(instanceHome, 'failure-seed', 'project-a')
    const lexical = seed.doppelgangerMemory.remember({
      operationId: 'failure-lexical',
      subjectKey: 'runtime.failure.fallback',
      kind: 'fact',
      content: 'Lexical fallback remains available.',
    })
    await seed.fiber.dispose()

    const stalled = semanticRetriever(async () => new Promise(() => {}))
    const timed = await session(instanceHome, 'timeout-reader', 'project-a', stalled, { semanticTimeoutMs: 5 })
    expect((await timed.doppelgangerMemory.search({ query: 'fallback', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([lexical.id])
    expect(timed.doppelgangerMemory.semanticFailure()).toMatchObject({ code: 'timeout' })
    await timed.fiber.dispose()

    const throwing = semanticRetriever(async () => {
      throw Object.assign(new Error('secret query and backend credentials'), { code: 'embedder' })
    })
    const failed = await session(instanceHome, 'throw-reader', 'project-a', throwing)
    expect((await failed.doppelgangerMemory.search({ query: 'fallback', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([lexical.id])
    expect(failed.doppelgangerMemory.semanticFailure()).toEqual(expect.objectContaining({
      code: 'embedder',
      message: 'semantic retrieval embedder failure',
    }))
    expect(JSON.stringify(failed.doppelgangerMemory.semanticFailure())).not.toContain('credentials')
    await failed.fiber.dispose()
  })
})
