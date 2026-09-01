import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService, type InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MemoryService,
  type MemoryKind,
  type MemorySemanticRetriever,
  type MemoryServiceConfig,
} from '../src/index.ts'

type CorpusStatus = 'active' | 'candidate'
type CorpusScope = 'relationship' | 'project'
type CorpusBoundary =
  | 'lexical-only'
  | 'semantic-only-paraphrase'
  | 'technical-identifier'
  | 'conflicting-subject'
  | 'partition-isolation'
  | 'temporal-eligibility'
  | 'current-revision'

interface CorpusCorrection {
  readonly operationId: string
  readonly content: string
  readonly vector: readonly number[]
}

interface CorpusRecord {
  readonly key: string
  readonly projectId: string
  readonly operationId: string
  readonly subjectKey: string
  readonly kind: MemoryKind
  readonly status: CorpusStatus
  readonly scope: CorpusScope
  readonly content: string
  readonly validFrom?: string
  readonly expiresAt?: string
  readonly vector: readonly number[]
  readonly correction?: CorpusCorrection
}

interface CorpusQuery {
  readonly key: string
  readonly language: 'en' | 'ru'
  readonly boundary: CorpusBoundary
  readonly query: string
  readonly vector: readonly number[]
  readonly lexicalExpectedKey: string | null
  readonly hybridExpectedKey: string
  readonly forbiddenKeys: readonly string[]
  readonly expectedContent?: string
}

interface RetrievalCorpus {
  readonly schemaVersion: number
  readonly corpusId: string
  readonly clock: string
  readonly generationId: string
  readonly dimensions: number
  readonly records: readonly CorpusRecord[]
  readonly queries: readonly CorpusQuery[]
}

interface IndexedRevision {
  readonly key: string
  readonly recordId: string
  readonly revisionId: string
  readonly vector: Float32Array
}

const temporaryRoots: string[] = []
let fixturePromise: Promise<RetrievalCorpus> | undefined

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<RetrievalCorpus> {
  fixturePromise ??= readFile(new URL('./fixtures/retrieval-corpus.json', import.meta.url), 'utf8')
    .then(source => JSON.parse(source) as RetrievalCorpus)
  return fixturePromise
}

function vector(values: readonly number[], dimensions: number): Float32Array {
  expect(values).toHaveLength(dimensions)
  const result = new Float32Array(values)
  const norm = Math.hypot(...result)
  expect(norm).toBeCloseTo(1, 5)
  return result
}

function similarity(left: Float32Array, right: Float32Array): number {
  let score = 0
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!
  return score
}

async function root(): Promise<string> {
  const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-retrieval-corpus-'))
  temporaryRoots.push(instanceHome)
  return instanceHome
}

async function session(
  instanceHome: string,
  projectId: string,
  sessionId: string,
  config: MemoryServiceConfig,
  semantic?: MemorySemanticRetriever,
): Promise<Context> {
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
      name: `corpus-semantic-${sessionId}`,
      apply(ctx) {
        ctx.provide('doppelgangerMemorySemantic', semantic)
      },
    }
    await context.plugin(provider)
  }
  await context.plugin(InstanceSqliteService, { home: instanceHome })
  await context.plugin(MemoryService, config)
  return context
}

async function seedCorpus(instanceHome: string, corpus: RetrievalCorpus): Promise<{
  readonly ids: ReadonlyMap<string, string>
  readonly indexed: readonly IndexedRevision[]
}> {
  const ids = new Map<string, string>()
  const indexed: IndexedRevision[] = []
  let id = 0
  const config: MemoryServiceConfig = {
    now: () => new Date(corpus.clock),
    id: () => `corpus-id-${String(++id).padStart(4, '0')}`,
  }
  for (const projectId of [...new Set(corpus.records.map(record => record.projectId))].sort()) {
    const context = await session(instanceHome, projectId, `seed-${projectId}`, config)
    for (const item of corpus.records.filter(record => record.projectId === projectId)) {
      const request = {
        operationId: item.operationId,
        subjectKey: item.subjectKey,
        kind: item.kind,
        content: item.content,
        scope: item.scope,
        ...(item.validFrom === undefined ? {} : { validFrom: item.validFrom }),
        ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }),
      }
      const initial = item.status === 'active'
        ? context.doppelgangerMemory.remember(request)
        : context.doppelgangerMemory.propose(request)
      ids.set(item.key, initial.id)
      indexed.push({
        key: item.key,
        recordId: initial.id,
        revisionId: initial.revision.id,
        vector: vector(item.vector, corpus.dimensions),
      })
      if (item.correction !== undefined) {
        const corrected = context.doppelgangerMemory.correct({
          operationId: item.correction.operationId,
          id: initial.id,
          expectedRevisionId: initial.revision.id,
          content: item.correction.content,
        })
        indexed.push({
          key: item.key,
          recordId: corrected.id,
          revisionId: corrected.revision.id,
          vector: vector(item.correction.vector, corpus.dimensions),
        })
      }
    }
    await context.fiber.dispose()
  }
  return { ids, indexed: Object.freeze(indexed) }
}

function semanticRetriever(corpus: RetrievalCorpus, indexed: readonly IndexedRevision[]): MemorySemanticRetriever {
  const queries = new Map(corpus.queries.map(query => [query.query, query]))
  return {
    async search(request) {
      const query = queries.get(request.query)
      if (query === undefined) throw new Error(`unknown corpus query: ${request.query}`)
      const queryVector = vector(query.vector, corpus.dimensions)
      return indexed
        .map(item => ({ ...item, score: similarity(queryVector, item.vector) }))
        .sort((left, right) => right.score - left.score
          || left.recordId.localeCompare(right.recordId)
          || left.revisionId.localeCompare(right.revisionId))
        .slice(0, request.limit)
        .map((item, index) => Object.freeze({
          generationId: corpus.generationId,
          recordId: item.recordId,
          revisionId: item.revisionId,
          rank: index + 1,
        }))
    },
    status() {
      return { active: true, supportedMaintenance: [] }
    },
    async maintenance() {
      throw new Error('maintenance is outside the retrieval corpus')
    },
  }
}

function activateGeneration(context: Context, corpus: RetrievalCorpus): void {
  const database = (context.doppelgangerMemory as unknown as { database: InstanceSqliteDatabase }).database
  database.prepare(`
    INSERT OR IGNORE INTO memory_semantic_generations
    VALUES (?, 'aiden', '{}', '{}', 'active', ?, ?, ?, NULL)
  `).run(corpus.generationId, corpus.clock, corpus.clock, corpus.clock)
  database.prepare(`
    INSERT OR REPLACE INTO memory_semantic_active_generation VALUES ('aiden', ?, ?)
  `).run(corpus.generationId, corpus.clock)
}

describe('deterministic bilingual retrieval corpus', () => {
  it('declares every required English/Russian and eligibility boundary with normalized vectors', async () => {
    const corpus = await fixture()
    expect(corpus).toMatchObject({ schemaVersion: 1, corpusId: 'memory-retrieval-bilingual-v1' })
    expect(new Set(corpus.queries.map(query => query.language))).toEqual(new Set(['en', 'ru']))
    expect(new Set(corpus.queries.map(query => query.boundary))).toEqual(new Set<CorpusBoundary>([
      'lexical-only',
      'semantic-only-paraphrase',
      'technical-identifier',
      'conflicting-subject',
      'partition-isolation',
      'temporal-eligibility',
      'current-revision',
    ]))
    for (const item of corpus.records) vector(item.vector, corpus.dimensions)
    for (const query of corpus.queries) vector(query.vector, corpus.dimensions)
  })

  it('observes lexical-only behavior and hybrid revalidation across every corpus query', async () => {
    const corpus = await fixture()
    const instanceHome = await root()
    const seeded = await seedCorpus(instanceHome, corpus)
    const config: MemoryServiceConfig = {
      now: () => new Date(corpus.clock),
      lexicalTopK: corpus.records.length,
      semanticTopK: corpus.records.length + 1,
      semanticQueryMaximumCharacters: 48,
    }

    const lexical = await session(instanceHome, 'project-alpha', 'lexical-reader', config)
    for (const query of corpus.queries) {
      const result = await lexical.doppelgangerMemory.search({ query: query.query, tokenBudget: 2_000 })
      if (query.lexicalExpectedKey === null) {
        expect(result, query.key).toHaveLength(0)
      } else {
        expect(result[0]?.record.id, query.key).toBe(seeded.ids.get(query.lexicalExpectedKey))
      }
      for (const forbidden of query.forbiddenKeys) {
        expect(result.map(item => item.record.id), query.key).not.toContain(seeded.ids.get(forbidden))
      }
    }
    await lexical.fiber.dispose()

    const hybrid = await session(
      instanceHome,
      'project-alpha',
      'hybrid-reader',
      config,
      semanticRetriever(corpus, seeded.indexed),
    )
    activateGeneration(hybrid, corpus)
    for (const query of corpus.queries) {
      const result = await hybrid.doppelgangerMemory.search({ query: query.query, tokenBudget: 2_000 })
      expect(result[0]?.record.id, query.key).toBe(seeded.ids.get(query.hybridExpectedKey))
      if (query.expectedContent !== undefined) {
        expect(result[0]?.record.revision.content, query.key).toBe(query.expectedContent)
      }
      for (const forbidden of query.forbiddenKeys) {
        expect(result.map(item => item.record.id), query.key).not.toContain(seeded.ids.get(forbidden))
      }
    }
    await hybrid.fiber.dispose()
  })
})
