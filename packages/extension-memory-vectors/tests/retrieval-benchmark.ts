import { performance } from 'node:perf_hooks'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import {
  MemoryService,
  type MemoryKind,
  type MemorySemanticRetriever,
  type MemoryServiceConfig,
  type MemoryVectorEntry,
  type MemoryVectorIndex,
} from '@doppelganger/doppelganger-memory'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService, type InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { createSQLiteExactMemoryVectorIndex } from '../src/index.ts'

type BackendName = 'lexical-only' | 'sqlite_exact' | 'chroma' | 'qdrant' | 'pgvector'
type ServerBackendName = Exclude<BackendName, 'lexical-only' | 'sqlite_exact'>

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
  readonly status: 'active' | 'candidate'
  readonly scope: 'relationship' | 'project'
  readonly content: string
  readonly validFrom?: string
  readonly expiresAt?: string
  readonly vector: readonly number[]
  readonly correction?: CorpusCorrection
}

interface CorpusQuery {
  readonly key: string
  readonly query: string
  readonly vector: readonly number[]
  readonly lexicalExpectedKey: string | null
  readonly hybridExpectedKey: string
  readonly forbiddenKeys: readonly string[]
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
  readonly entry: MemoryVectorEntry
}

interface Percentiles {
  readonly p50: number
  readonly p95: number
  readonly maximum: number
}

interface QualityMetrics {
  readonly queryCount: number
  readonly expectedRecallCount: number
  readonly hitCount: number
  readonly recall: number
  readonly reciprocalRankMean: number
  readonly forbiddenHitCount: number
}

export interface BackendMeasurement {
  readonly backend: BackendName
  readonly state: 'measured'
  readonly iterations: number
  readonly semanticTopK: number | null
  readonly quality: QualityMetrics
  readonly latencyMs: Percentiles
  readonly samples: number
  readonly deadlineMs: number
  readonly deadlineExceededCount: number
}

export interface BackendUnavailable {
  readonly backend: ServerBackendName
  readonly state: 'unavailable'
  readonly gate: string
  readonly reason: string
}

export interface BackendFailed {
  readonly backend: ServerBackendName
  readonly state: 'failed'
  readonly gate: string
  readonly failureCategory: 'configuration' | 'connection'
}

export type BackendResult = BackendMeasurement | BackendUnavailable | BackendFailed

export interface BatchMeasurement {
  readonly batchSize: number
  readonly entries: number
  readonly latencyMs: Percentiles
  readonly entriesPerSecond: number
}

export interface DerivedDefault {
  readonly supported: boolean
  readonly value: number | null
  readonly unit: string
  readonly evidence: string
}

export interface RetrievalBenchmarkReport {
  readonly schemaVersion: 1
  readonly benchmarkId: 'memory-retrieval-benchmark-v1'
  readonly corpusId: string
  readonly measuredAt: string
  readonly runtime: { readonly node: string; readonly platform: string; readonly arch: string }
  readonly configuration: {
    readonly iterations: number
    readonly warmupIterations: number
    readonly topKValues: readonly number[]
    readonly queryDeadlineMs: number
    readonly batchSizes: readonly number[]
  }
  readonly backends: readonly BackendResult[]
  readonly sqliteBatchMeasurements: readonly BatchMeasurement[]
  readonly derivedDefaults: {
    readonly semanticTopK: DerivedDefault
    readonly queryDeadline: DerivedDefault
    readonly batchSize: DerivedDefault
    readonly generationRetention: DerivedDefault
  }
}

interface SeededCorpus {
  readonly ids: ReadonlyMap<string, string>
  readonly indexed: readonly IndexedRevision[]
}

export interface RetrievalBenchmarkOptions {
  readonly iterations?: number
  readonly warmupIterations?: number
  readonly queryDeadlineMs?: number
  readonly topKValues?: readonly number[]
  readonly batchSizes?: readonly number[]
  readonly outputPath?: string
  readonly environment?: NodeJS.ProcessEnv
}

interface ServerGate {
  readonly backend: ServerBackendName
  readonly gate: string
  readonly module: string
  readonly factory: string
  readonly config: (environment: NodeJS.ProcessEnv, dimensions: number) => Record<string, unknown>
}

const CORPUS_URL = new URL('../../extension-memory/tests/fixtures/retrieval-corpus.json', import.meta.url)
const SERVER_GATES: readonly ServerGate[] = Object.freeze([
  {
    backend: 'chroma',
    gate: 'MEMORY_BENCHMARK_CHROMA_URL',
    module: '../src/chroma.ts',
    factory: 'createChromaMemoryVectorIndex',
    config: (environment, dimensions) => ({
      endpoint: environment.MEMORY_BENCHMARK_CHROMA_URL,
      dimensions,
      namespace: 'retrieval_benchmark',
      ...(environment.MEMORY_BENCHMARK_CHROMA_TOKEN_ENV === undefined
        ? {}
        : { tokenEnv: environment.MEMORY_BENCHMARK_CHROMA_TOKEN_ENV }),
    }),
  },
  {
    backend: 'qdrant',
    gate: 'MEMORY_BENCHMARK_QDRANT_URL',
    module: '../src/qdrant.ts',
    factory: 'createQdrantMemoryVectorIndex',
    config: (environment, dimensions) => ({
      url: environment.MEMORY_BENCHMARK_QDRANT_URL,
      dimensions,
      namespace: 'retrieval_benchmark',
      ...(environment.MEMORY_BENCHMARK_QDRANT_API_KEY_ENV === undefined
        ? {}
        : { apiKeyEnv: environment.MEMORY_BENCHMARK_QDRANT_API_KEY_ENV }),
    }),
  },
  {
    backend: 'pgvector',
    gate: 'MEMORY_BENCHMARK_PGVECTOR_DSN_ENV',
    module: '../src/pgvector.ts',
    factory: 'createPgVectorMemoryVectorIndex',
    config: (environment, dimensions) => ({
      dsnEnv: environment.MEMORY_BENCHMARK_PGVECTOR_DSN_ENV,
      dimensions,
      namespace: 'retrieval_benchmark',
      environment,
    }),
  },
])

function boundedInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

function nonNegativeInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${name} must be a non-negative integer no greater than ${maximum}`)
  }
  return value
}

function numericList(name: string, values: readonly number[], maximum: number): readonly number[] {
  if (values.length === 0) throw new TypeError(`${name} must not be empty`)
  return Object.freeze([...new Set(values.map(value => boundedInteger(name, value, maximum)))].sort((a, b) => a - b))
}

function normalizedVector(values: readonly number[], dimensions: number): Float32Array {
  if (values.length !== dimensions) throw new TypeError(`corpus vector must contain ${dimensions} dimensions`)
  const result = new Float32Array(values)
  const norm = Math.hypot(...result)
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.0001) throw new TypeError('corpus vectors must be normalized')
  return result
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)
  return Number(ordered[index]!.toFixed(3))
}

function percentiles(values: readonly number[]): Percentiles {
  return Object.freeze({
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: Number(Math.max(0, ...values).toFixed(3)),
  })
}

async function loadCorpus(): Promise<RetrievalCorpus> {
  const corpus = JSON.parse(await readFile(CORPUS_URL, 'utf8')) as RetrievalCorpus
  if (corpus.schemaVersion !== 1 || corpus.records.length === 0 || corpus.queries.length === 0) {
    throw new TypeError('retrieval corpus schema is unsupported or empty')
  }
  for (const record of corpus.records) {
    normalizedVector(record.vector, corpus.dimensions)
    if (record.correction !== undefined) normalizedVector(record.correction.vector, corpus.dimensions)
  }
  for (const query of corpus.queries) normalizedVector(query.vector, corpus.dimensions)
  return corpus
}

async function memorySession(
  home: string,
  corpus: RetrievalCorpus,
  sessionId: string,
  config: MemoryServiceConfig,
  semantic?: MemorySemanticRetriever,
): Promise<Context> {
  const context = new Context()
  const persona: Plugin = {
    name: `benchmark-persona-${sessionId}`,
    apply(ctx) {
      ctx.provide('doppelgangerPersona', Object.freeze({
        instanceId: 'aiden',
        sessionId,
        projectId: 'project-alpha',
        projectRoot: join(home, 'project-alpha'),
        traits: Object.freeze([]),
      }))
    },
  }
  await context.plugin(persona)
  await context.plugin(createActorIdentityPlugin('local-user'))
  if (semantic !== undefined) {
    const provider: Plugin = {
      name: `benchmark-semantic-${sessionId}`,
      apply(ctx) {
        ctx.provide('doppelgangerMemorySemantic', semantic)
      },
    }
    await context.plugin(provider)
  }
  await context.plugin(InstanceSqliteService, { home })
  await context.plugin(MemoryService, { ...config, now: () => new Date(corpus.clock) })
  return context
}

async function seedCorpus(home: string, corpus: RetrievalCorpus): Promise<SeededCorpus> {
  const ids = new Map<string, string>()
  const indexed: IndexedRevision[] = []
  let id = 0
  for (const projectId of [...new Set(corpus.records.map(record => record.projectId))].sort()) {
    const context = new Context()
    const persona: Plugin = {
      name: `benchmark-seed-persona-${projectId}`,
      apply(ctx) {
        ctx.provide('doppelgangerPersona', Object.freeze({
          instanceId: 'aiden',
          sessionId: `benchmark-seed-${projectId}`,
          projectId,
          projectRoot: join(home, projectId),
          traits: Object.freeze([]),
        }))
      },
    }
    await context.plugin(persona)
    await context.plugin(createActorIdentityPlugin('local-user'))
    await context.plugin(InstanceSqliteService, { home })
    await context.plugin(MemoryService, {
      now: () => new Date(corpus.clock),
      id: () => `benchmark-id-${String(++id).padStart(4, '0')}`,
    })
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
        entry: Object.freeze({
          generationId: corpus.generationId,
          recordId: initial.id,
          revisionId: initial.revision.id,
          instanceId: 'aiden',
          actorId: 'local-user',
          scopeKind: item.scope,
          ...(item.scope === 'project' ? { projectId } : {}),
          kind: item.kind,
          subjectKey: item.subjectKey,
          status: item.status,
          vector: normalizedVector(item.vector, corpus.dimensions),
        }),
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
          entry: Object.freeze({
            generationId: corpus.generationId,
            recordId: corrected.id,
            revisionId: corrected.revision.id,
            instanceId: 'aiden',
            actorId: 'local-user',
            scopeKind: item.scope,
            ...(item.scope === 'project' ? { projectId } : {}),
            kind: item.kind,
            subjectKey: item.subjectKey,
            status: item.status,
            vector: normalizedVector(item.correction.vector, corpus.dimensions),
          }),
        })
      }
    }
    await context.fiber.dispose()
  }
  return Object.freeze({ ids, indexed: Object.freeze(indexed) })
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

function semanticRetriever(
  corpus: RetrievalCorpus,
  index: MemoryVectorIndex,
): MemorySemanticRetriever {
  const vectors = new Map(corpus.queries.map(query => [query.query, normalizedVector(query.vector, corpus.dimensions)]))
  return {
    async search(request) {
      const vector = vectors.get(request.query)
      if (vector === undefined) throw Object.assign(new Error('benchmark query is absent from the corpus'), { code: 'embedder' })
      const hits = await index.search({
        generationId: corpus.generationId,
        vector,
        filter: { instanceId: request.instanceId, actorId: request.actorId, status: 'active' },
        limit: request.limit,
      })
      return hits.map((hit, rank) => Object.freeze({
        generationId: hit.generationId,
        recordId: hit.recordId,
        revisionId: hit.revisionId,
        rank: rank + 1,
      }))
    },
    status() {
      return { active: true, backend: index.identity.backend, generationId: corpus.generationId, supportedMaintenance: index.supportedMaintenance }
    },
    maintenance(kind) {
      return index.maintenance(kind)
    },
  }
}

async function measureQueries(
  backend: BackendName,
  context: Context,
  corpus: RetrievalCorpus,
  ids: ReadonlyMap<string, string>,
  iterations: number,
  warmupIterations: number,
  semanticTopK: number | null,
  queryDeadlineMs: number,
): Promise<BackendMeasurement> {
  const samples: number[] = []
  let expectedRecallCount = 0
  let hitCount = 0
  let reciprocalRank = 0
  let forbiddenHitCount = 0
  let deadlineExceededCount = 0
  for (let iteration = -warmupIterations; iteration < iterations; iteration += 1) {
    for (const query of corpus.queries) {
      const started = performance.now()
      const results = await context.doppelgangerMemory.search({ query: query.query, tokenBudget: 2_000 })
      const elapsed = performance.now() - started
      if (iteration < 0) continue
      samples.push(elapsed)
      if (elapsed > queryDeadlineMs) deadlineExceededCount += 1
      const expectedKey = backend === 'lexical-only' ? query.lexicalExpectedKey : query.hybridExpectedKey
      if (expectedKey !== null) {
        expectedRecallCount += 1
        const expectedId = ids.get(expectedKey)
        const rank = results.findIndex(result => result.record.id === expectedId)
        if (rank >= 0) {
          hitCount += 1
          reciprocalRank += 1 / (rank + 1)
        }
      }
      const forbiddenIds = new Set(query.forbiddenKeys.map(key => ids.get(key)))
      forbiddenHitCount += results.filter(result => forbiddenIds.has(result.record.id)).length
    }
  }
  return Object.freeze({
    backend,
    state: 'measured',
    iterations,
    semanticTopK,
    quality: Object.freeze({
      queryCount: corpus.queries.length * iterations,
      expectedRecallCount,
      hitCount,
      recall: expectedRecallCount === 0 ? 1 : Number((hitCount / expectedRecallCount).toFixed(6)),
      reciprocalRankMean: expectedRecallCount === 0 ? 1 : Number((reciprocalRank / expectedRecallCount).toFixed(6)),
      forbiddenHitCount,
    }),
    latencyMs: percentiles(samples),
    samples: samples.length,
    deadlineMs: queryDeadlineMs,
    deadlineExceededCount,
  })
}

async function measureBackend(
  backend: Exclude<BackendName, 'lexical-only'>,
  index: MemoryVectorIndex,
  home: string,
  corpus: RetrievalCorpus,
  seeded: SeededCorpus,
  iterations: number,
  warmupIterations: number,
  topK: number,
  queryDeadlineMs: number,
): Promise<BackendMeasurement> {
  await index.upsert(seeded.indexed.map(item => item.entry))
  const context = await memorySession(home, corpus, `${backend}-${topK}`, {
    lexicalTopK: corpus.records.length,
    semanticTopK: topK,
    semanticTimeoutMs: queryDeadlineMs,
  }, semanticRetriever(corpus, index))
  try {
    activateGeneration(context, corpus)
    return await measureQueries(backend, context, corpus, seeded.ids, iterations, warmupIterations, topK, queryDeadlineMs)
  } finally {
    await context.fiber.dispose()
  }
}

async function sqliteIndex(path: string, corpus: RetrievalCorpus, namespace: string): Promise<MemoryVectorIndex> {
  return createSQLiteExactMemoryVectorIndex({
    databasePath: path,
    dimensions: corpus.dimensions,
    namespace,
    sanitizedTarget: 'local benchmark SQLite',
  })
}

async function measureSQLiteBatches(
  root: string,
  corpus: RetrievalCorpus,
  entries: readonly MemoryVectorEntry[],
  batchSizes: readonly number[],
): Promise<readonly BatchMeasurement[]> {
  const measurements: BatchMeasurement[] = []
  for (const batchSize of batchSizes) {
    const samples: number[] = []
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const index = await sqliteIndex(join(root, `batch-${batchSize}-${repetition}.sqlite`), corpus, `batch_${batchSize}_${repetition}`)
      const started = performance.now()
      for (let offset = 0; offset < entries.length; offset += batchSize) {
        await index.upsert(entries.slice(offset, offset + batchSize))
      }
      samples.push(performance.now() - started)
      await index.close()
    }
    const latency = percentiles(samples)
    measurements.push(Object.freeze({
      batchSize,
      entries: entries.length,
      latencyMs: latency,
      entriesPerSecond: latency.p50 === 0 ? 0 : Number((entries.length * 1_000 / latency.p50).toFixed(3)),
    }))
  }
  return Object.freeze(measurements)
}

async function loadServerIndex(
  gate: ServerGate,
  environment: NodeJS.ProcessEnv,
  dimensions: number,
): Promise<MemoryVectorIndex> {
  const moduleUrl = new URL(gate.module, import.meta.url)
  const imported = await import(moduleUrl.href) as Record<string, unknown>
  const candidate = imported[gate.factory]
  if (typeof candidate !== 'function') throw new TypeError(`${gate.factory} is not exported`)
  const factory = candidate as (config: Record<string, unknown>) => Promise<MemoryVectorIndex>
  return factory(gate.config(environment, dimensions))
}

function unavailable(gate: ServerGate): BackendUnavailable {
  return Object.freeze({
    backend: gate.backend,
    state: 'unavailable',
    gate: gate.gate,
    reason: `environment gate ${gate.gate} is not set`,
  })
}

function failed(gate: ServerGate, category: BackendFailed['failureCategory']): BackendFailed {
  return Object.freeze({ backend: gate.backend, state: 'failed', gate: gate.gate, failureCategory: category })
}

function deriveDefaults(
  topKMeasurements: readonly BackendMeasurement[],
  batches: readonly BatchMeasurement[],
): RetrievalBenchmarkReport['derivedDefaults'] {
  const supportedTopK = topKMeasurements
    .filter(measurement => measurement.quality.recall === 1 && measurement.quality.forbiddenHitCount === 0)
    .sort((left, right) => (left.semanticTopK ?? Infinity) - (right.semanticTopK ?? Infinity))[0]
  const bestBatch = [...batches].sort((left, right) => right.entriesPerSecond - left.entriesPerSecond || left.batchSize - right.batchSize)[0]
  return Object.freeze({
    semanticTopK: Object.freeze({
      supported: supportedTopK !== undefined,
      value: supportedTopK?.semanticTopK ?? null,
      unit: 'candidates',
      evidence: supportedTopK === undefined
        ? 'No measured SQLite exact top-K achieved complete corpus recall without forbidden hits.'
        : 'Smallest measured SQLite exact top-K with complete corpus recall and no forbidden hits.',
    }),
    queryDeadline: Object.freeze({
      supported: false,
      value: null,
      unit: 'milliseconds',
      evidence: 'In-process deterministic corpus latency does not represent loaded local-model or server tail latency.',
    }),
    batchSize: Object.freeze({
      supported: false,
      value: null,
      unit: 'entries',
      evidence: bestBatch === undefined
        ? 'No SQLite batch measurements were recorded.'
        : `Measured SQLite exact best throughput at batch size ${bestBatch.batchSize}; corpus is too small to establish a bounded production default.`,
    }),
    generationRetention: Object.freeze({
      supported: false,
      value: null,
      unit: 'milliseconds',
      evidence: 'Retrieval quality and latency measurements contain no rollback-frequency or storage-pressure evidence.',
    }),
  })
}

export async function runRetrievalBenchmark(options: RetrievalBenchmarkOptions = {}): Promise<RetrievalBenchmarkReport> {
  const iterations = boundedInteger('iterations', options.iterations ?? 25, 10_000)
  const warmupIterations = nonNegativeInteger('warmupIterations', options.warmupIterations ?? 3, 1_000)
  const queryDeadlineMs = boundedInteger('queryDeadlineMs', options.queryDeadlineMs ?? 1_500, 60_000)
  const topKValues = numericList('topKValues', options.topKValues ?? [1, 2, 4, 8, 16], 1_000)
  const batchSizes = numericList('batchSizes', options.batchSizes ?? [1, 4, 8, 16], 128)
  const environment = options.environment ?? process.env
  const corpus = await loadCorpus()
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-retrieval-benchmark-'))
  try {
    const seeded = await seedCorpus(root, corpus)
    const backends: BackendResult[] = []
    const lexicalContext = await memorySession(root, corpus, 'lexical-only', { lexicalTopK: corpus.records.length, semanticTimeoutMs: queryDeadlineMs })
    try {
      backends.push(await measureQueries('lexical-only', lexicalContext, corpus, seeded.ids, iterations, warmupIterations, null, queryDeadlineMs))
    } finally {
      await lexicalContext.fiber.dispose()
    }

    const sqliteMeasurements: BackendMeasurement[] = []
    for (const topK of topKValues) {
      const index = await sqliteIndex(join(root, `sqlite-${topK}.sqlite`), corpus, `retrieval_${topK}`)
      try {
        const measurement = await measureBackend('sqlite_exact', index, root, corpus, seeded, iterations, warmupIterations, topK, queryDeadlineMs)
        sqliteMeasurements.push(measurement)
        backends.push(measurement)
      } finally {
        await index.close()
      }
    }

    for (const gate of SERVER_GATES) {
      if (environment[gate.gate]?.trim() === undefined || environment[gate.gate]?.trim() === '') {
        backends.push(unavailable(gate))
        continue
      }
      let index: MemoryVectorIndex | undefined
      try {
        index = await loadServerIndex(gate, environment, corpus.dimensions)
        backends.push(await measureBackend(
          gate.backend,
          index,
          root,
          corpus,
          seeded,
          iterations,
          warmupIterations,
          topKValues.at(-1)!,
          queryDeadlineMs,
        ))
      } catch (error) {
        const category: BackendFailed['failureCategory'] = error instanceof TypeError ? 'configuration' : 'connection'
        backends.push(failed(gate, category))
      } finally {
        await index?.close().catch(() => undefined)
      }
    }

    const batchMeasurements = await measureSQLiteBatches(
      root,
      corpus,
      seeded.indexed.map(item => item.entry),
      batchSizes,
    )
    const report: RetrievalBenchmarkReport = Object.freeze({
      schemaVersion: 1,
      benchmarkId: 'memory-retrieval-benchmark-v1',
      corpusId: corpus.corpusId,
      measuredAt: new Date().toISOString(),
      runtime: Object.freeze({ node: process.version, platform: process.platform, arch: process.arch }),
      configuration: Object.freeze({ iterations, warmupIterations, queryDeadlineMs, topKValues, batchSizes }),
      backends: Object.freeze(backends),
      sqliteBatchMeasurements: batchMeasurements,
      derivedDefaults: deriveDefaults(sqliteMeasurements, batchMeasurements),
    })
    if (options.outputPath !== undefined) {
      if (!isAbsolute(options.outputPath)) throw new TypeError('benchmark outputPath must be absolute')
      await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }
    return report
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function environmentInteger(name: string): number | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  return Number(value)
}

function environmentList(name: string): readonly number[] | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  return value.split(',').map(item => Number(item.trim()))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputPath = process.env.MEMORY_BENCHMARK_OUTPUT
  const iterations = environmentInteger('MEMORY_BENCHMARK_ITERATIONS')
  const warmupIterations = environmentInteger('MEMORY_BENCHMARK_WARMUP_ITERATIONS')
  const queryDeadlineMs = environmentInteger('MEMORY_BENCHMARK_QUERY_DEADLINE_MS')
  const topKValues = environmentList('MEMORY_BENCHMARK_TOP_K')
  const batchSizes = environmentList('MEMORY_BENCHMARK_BATCH_SIZES')
  const report = await runRetrievalBenchmark({
    ...(iterations === undefined ? {} : { iterations }),
    ...(warmupIterations === undefined ? {} : { warmupIterations }),
    ...(queryDeadlineMs === undefined ? {} : { queryDeadlineMs }),
    ...(topKValues === undefined ? {} : { topKValues }),
    ...(batchSizes === undefined ? {} : { batchSizes }),
    ...(outputPath === undefined ? {} : { outputPath }),
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
}
