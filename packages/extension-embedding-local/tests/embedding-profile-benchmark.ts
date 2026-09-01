import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAbsolute, join } from 'node:path'
import {
  LocalEmbeddingError,
  loadTransformersRuntime,
  localEmbeddingModel,
  type LocalEmbeddingDevice,
  type LocalEmbeddingModelDefinition,
} from '../src/index.ts'

export type EmbeddingProfileId = 'q4-256' | 'q8-384'

type FixtureLanguage = 'en' | 'ru'

interface BenchmarkDocument {
  readonly key: string
  readonly text: string
}

interface BenchmarkQuery {
  readonly key: string
  readonly language: FixtureLanguage
  readonly text: string
  readonly expectedKey: string
  readonly forbiddenKeys: readonly string[]
}

export interface EmbeddingProfileFixture {
  readonly schemaVersion: 1
  readonly fixtureId: string
  readonly documents: readonly BenchmarkDocument[]
  readonly queries: readonly BenchmarkQuery[]
}

export interface Percentiles {
  readonly p50: number
  readonly p95: number
  readonly maximum: number
}

export interface EmbeddingQualityMetrics {
  readonly queryCount: number
  readonly hitCount: number
  readonly recallAtK: number
  readonly reciprocalRankMean: number
  readonly forbiddenHitCount: number
}

export interface MeasuredEmbeddingProfile {
  readonly profile: EmbeddingProfileId
  readonly state: 'measured'
  readonly identity: LocalEmbeddingModelDefinition['identity']
  readonly dtype: LocalEmbeddingModelDefinition['dtype']
  readonly device: LocalEmbeddingDevice
  readonly topK: number
  readonly iterations: number
  readonly quality: EmbeddingQualityMetrics
  readonly qualityByLanguage: Readonly<Record<FixtureLanguage, EmbeddingQualityMetrics>>
  readonly coldAcquisitionMs: number
  readonly firstQueryMs: number
  readonly warmQueryLatencyMs: Percentiles
  readonly warmDocumentBatchLatencyMs: Percentiles
  readonly documentBatchThroughputPerSecond: number
  readonly peakRssDeltaBytes: number
  readonly verifiedCacheBytes: number
  readonly documentVectorBytes: number
  readonly querySamples: number
  readonly documentBatchSamples: number
}

export interface UnavailableEmbeddingProfile {
  readonly profile: EmbeddingProfileId
  readonly state: 'unavailable'
  readonly reason: string
}

export interface FailedEmbeddingProfile {
  readonly profile: EmbeddingProfileId
  readonly state: 'failed'
  readonly failureCategory: 'acquisition' | 'execution' | 'fixture'
}

export type EmbeddingProfileResult = MeasuredEmbeddingProfile | UnavailableEmbeddingProfile | FailedEmbeddingProfile

export interface EmbeddingProfileBenchmarkReport {
  readonly schemaVersion: 1
  readonly benchmarkId: 'embeddinggemma-profile-benchmark-v1'
  readonly fixtureId: string
  readonly measuredAt: string
  readonly runtime: {
    readonly node: string
    readonly platform: NodeJS.Platform
    readonly arch: string
  }
  readonly configuration: {
    readonly device: LocalEmbeddingDevice
    readonly iterations: number
    readonly topK: number
  }
  readonly profiles: readonly EmbeddingProfileResult[]
}

export interface EmbeddingProfileBenchmarkOptions {
  readonly enabled?: boolean
  readonly cacheDir?: string
  readonly device?: LocalEmbeddingDevice
  readonly iterations?: number
  readonly topK?: number
  readonly outputPath?: string
  readonly environment?: NodeJS.ProcessEnv
}

type ProfileExecutor = (
  profile: EmbeddingProfileId,
  input: Readonly<{
    cacheDir: string
    device: LocalEmbeddingDevice
    iterations: number
    topK: number
  }>,
) => Promise<EmbeddingProfileResult>

interface WorkerInput {
  readonly profile: EmbeddingProfileId
  readonly cacheDir: string
  readonly device: LocalEmbeddingDevice
  readonly iterations: number
  readonly topK: number
}

const FIXTURE_URL = new URL('./fixtures/embedding-profile-corpus.json', import.meta.url)
const WORKER_SENTINEL = 'DOPPELGANGER_EMBEDDING_PROFILE_RESULT='
const PROFILE_IDS: readonly EmbeddingProfileId[] = Object.freeze(['q4-256', 'q8-384'])

const Q4_BASELINE: LocalEmbeddingModelDefinition = Object.freeze({
  name: 'embeddinggemma-300m',
  modelId: 'onnx-community/embeddinggemma-300m-ONNX',
  revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
  dtype: 'q4',
  identity: Object.freeze({
    provider: 'transformers.js',
    modelId: 'onnx-community/embeddinggemma-300m-ONNX',
    revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
    artifactDigest: '7834419539b0d053ffcdf98223764a8060e12078bb137165f5031b03455b334e',
    pooling: 'sentence_embedding',
    projection: 'mrl-truncate-256-l2',
    dimensions: 256,
    normalized: true,
    distanceMetric: 'cosine',
  }),
  artifacts: Object.freeze([
    Object.freeze({
      path: 'onnx/model_q4.onnx',
      sha256: 'ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043',
      bytes: 519322,
    }),
    Object.freeze({
      path: 'onnx/model_q4.onnx_data',
      sha256: '599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02',
      bytes: 196725760,
    }),
  ]),
  sourceDimensions: 768,
  queryPrefix: 'task: search result | query: ',
  documentPrefix: 'title: none | text: ',
})

function profileDefinition(profile: EmbeddingProfileId): LocalEmbeddingModelDefinition {
  return profile === 'q4-256' ? Q4_BASELINE : localEmbeddingModel('embeddinggemma-300m')
}

function boundedInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

function requiredString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string`)
  return value
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

function l2Project(data: ArrayLike<number>, offset: number, dimensions: number): Float32Array {
  const result = new Float32Array(dimensions)
  let squaredNorm = 0
  for (let index = 0; index < dimensions; index += 1) {
    const value = Number(data[offset + index])
    if (!Number.isFinite(value)) throw new TypeError('embedding output contains a non-finite value')
    result[index] = value
    squaredNorm += value * value
  }
  if (!(squaredNorm > 0)) throw new TypeError('embedding output contains a zero vector')
  const scale = 1 / Math.sqrt(squaredNorm)
  for (let index = 0; index < dimensions; index += 1) result[index] = result[index]! * scale
  return result
}

function projectRows(
  tensor: Readonly<{ data: ArrayLike<number>; dims: readonly number[] }>,
  rows: number,
  model: LocalEmbeddingModelDefinition,
): readonly Float32Array[] {
  if (tensor.dims.at(-1) !== model.sourceDimensions || tensor.data.length !== rows * model.sourceDimensions) {
    throw new TypeError('embedding runtime output dimensions do not match the profile')
  }
  return Object.freeze(Array.from({ length: rows }, (_value, index) =>
    l2Project(tensor.data, index * model.sourceDimensions, model.identity.dimensions)))
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new TypeError('quality vectors have different dimensions')
  let score = 0
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!
  return score
}

function qualityForQueries(
  fixture: EmbeddingProfileFixture,
  documentVectors: readonly Float32Array[],
  queryVectors: readonly Float32Array[],
  topK: number,
  languages?: ReadonlySet<FixtureLanguage>,
): EmbeddingQualityMetrics {
  let queryCount = 0
  let hitCount = 0
  let reciprocalRank = 0
  let forbiddenHitCount = 0
  fixture.queries.forEach((query, queryIndex) => {
    if (languages !== undefined && !languages.has(query.language)) return
    queryCount += 1
    const queryVector = queryVectors[queryIndex]
    if (queryVector === undefined) throw new TypeError('quality query vector is missing')
    const ranking = fixture.documents
      .map((document, documentIndex) => ({
        key: document.key,
        score: cosine(queryVector, documentVectors[documentIndex]!),
      }))
      .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    const expectedRank = ranking.findIndex(item => item.key === query.expectedKey)
    if (expectedRank >= 0) {
      reciprocalRank += 1 / (expectedRank + 1)
      if (expectedRank < topK) hitCount += 1
    }
    const forbidden = new Set(query.forbiddenKeys)
    forbiddenHitCount += ranking.slice(0, topK).filter(item => forbidden.has(item.key)).length
  })
  return Object.freeze({
    queryCount,
    hitCount,
    recallAtK: queryCount === 0 ? 1 : Number((hitCount / queryCount).toFixed(6)),
    reciprocalRankMean: queryCount === 0 ? 1 : Number((reciprocalRank / queryCount).toFixed(6)),
    forbiddenHitCount,
  })
}

export function measureEmbeddingProfileQuality(
  fixture: EmbeddingProfileFixture,
  documentVectors: readonly Float32Array[],
  queryVectors: readonly Float32Array[],
  topK: number,
): Readonly<{
  quality: EmbeddingQualityMetrics
  qualityByLanguage: Readonly<Record<FixtureLanguage, EmbeddingQualityMetrics>>
}> {
  if (documentVectors.length !== fixture.documents.length || queryVectors.length !== fixture.queries.length) {
    throw new TypeError('quality vector counts do not match the fixture')
  }
  return Object.freeze({
    quality: qualityForQueries(fixture, documentVectors, queryVectors, topK),
    qualityByLanguage: Object.freeze({
      en: qualityForQueries(fixture, documentVectors, queryVectors, topK, new Set(['en'])),
      ru: qualityForQueries(fixture, documentVectors, queryVectors, topK, new Set(['ru'])),
    }),
  })
}

export async function loadEmbeddingProfileFixture(): Promise<EmbeddingProfileFixture> {
  const candidate = JSON.parse(await readFile(FIXTURE_URL, 'utf8')) as Partial<EmbeddingProfileFixture>
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.documents) || !Array.isArray(candidate.queries)) {
    throw new TypeError('embedding benchmark fixture schema is unsupported')
  }
  const documents = candidate.documents.map((document, index) => Object.freeze({
    key: requiredString(`documents[${index}].key`, document.key),
    text: requiredString(`documents[${index}].text`, document.text),
  }))
  const documentKeys = new Set(documents.map(document => document.key))
  if (documents.length === 0 || documentKeys.size !== documents.length) throw new TypeError('fixture document keys must be unique')
  const queries = candidate.queries.map((query, index) => {
    if (query.language !== 'en' && query.language !== 'ru') throw new TypeError(`queries[${index}].language is unsupported`)
    const expectedKey = requiredString(`queries[${index}].expectedKey`, query.expectedKey)
    if (!documentKeys.has(expectedKey)) throw new TypeError(`queries[${index}].expectedKey is absent from documents`)
    if (!Array.isArray(query.forbiddenKeys) || query.forbiddenKeys.some((key: unknown) => typeof key !== 'string' || !documentKeys.has(key))) {
      throw new TypeError(`queries[${index}].forbiddenKeys are invalid`)
    }
    return Object.freeze({
      key: requiredString(`queries[${index}].key`, query.key),
      language: query.language,
      text: requiredString(`queries[${index}].text`, query.text),
      expectedKey,
      forbiddenKeys: Object.freeze([...query.forbiddenKeys]),
    })
  })
  if (queries.length === 0 || !queries.some(query => query.language === 'en') || !queries.some(query => query.language === 'ru')) {
    throw new TypeError('fixture must contain English and Russian queries')
  }
  return Object.freeze({
    schemaVersion: 1,
    fixtureId: requiredString('fixtureId', candidate.fixtureId),
    documents: Object.freeze(documents),
    queries: Object.freeze(queries),
  })
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function verifiedCacheBytes(cacheDir: string, model: LocalEmbeddingModelDefinition): Promise<number> {
  let bytes = 0
  for (const artifact of model.artifacts) {
    const path = join(cacheDir, model.modelId, model.revision, artifact.path)
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size !== artifact.bytes || await sha256(path) !== artifact.sha256) {
      throw new TypeError('benchmark cache artifact failed integrity validation')
    }
    bytes += metadata.size
  }
  return bytes
}

function updatePeak(current: number): number {
  return Math.max(current, process.memoryUsage().rss)
}

async function measureProfile(input: WorkerInput): Promise<MeasuredEmbeddingProfile> {
  const fixture = await loadEmbeddingProfileFixture()
  const model = profileDefinition(input.profile)
  const baselineRss = process.memoryUsage().rss
  let peakRss = baselineRss
  const acquisitionStarted = performance.now()
  const runtime = await loadTransformersRuntime(model, {
    cacheDir: input.cacheDir,
    offline: false,
    device: input.device,
  })
  const coldAcquisitionMs = performance.now() - acquisitionStarted
  peakRss = updatePeak(peakRss)
  try {
    const firstQueryStarted = performance.now()
    const firstQueryTensor = await runtime.embed([fixture.queries[0]!.text], 'query')
    projectRows(firstQueryTensor, 1, model)
    const firstQueryMs = performance.now() - firstQueryStarted
    peakRss = updatePeak(peakRss)

    const documentTensor = await runtime.embed(fixture.documents.map(document => document.text), 'document')
    const documentVectors = projectRows(documentTensor, fixture.documents.length, model)
    peakRss = updatePeak(peakRss)
    const queryTensor = await runtime.embed(fixture.queries.map(query => query.text), 'query')
    const queryVectors = projectRows(queryTensor, fixture.queries.length, model)
    peakRss = updatePeak(peakRss)
    const quality = measureEmbeddingProfileQuality(fixture, documentVectors, queryVectors, input.topK)

    const queryLatencies: number[] = []
    const documentBatchLatencies: number[] = []
    for (let iteration = 0; iteration < input.iterations; iteration += 1) {
      for (const query of fixture.queries) {
        const started = performance.now()
        const tensor = await runtime.embed([query.text], 'query')
        projectRows(tensor, 1, model)
        queryLatencies.push(performance.now() - started)
        peakRss = updatePeak(peakRss)
      }
      const started = performance.now()
      const tensor = await runtime.embed(fixture.documents.map(document => document.text), 'document')
      projectRows(tensor, fixture.documents.length, model)
      documentBatchLatencies.push(performance.now() - started)
      peakRss = updatePeak(peakRss)
    }
    const totalBatchMs = documentBatchLatencies.reduce((sum, value) => sum + value, 0)
    const cacheBytes = await verifiedCacheBytes(input.cacheDir, model)
    return Object.freeze({
      profile: input.profile,
      state: 'measured',
      identity: model.identity,
      dtype: model.dtype,
      device: input.device,
      topK: input.topK,
      iterations: input.iterations,
      quality: quality.quality,
      qualityByLanguage: quality.qualityByLanguage,
      coldAcquisitionMs: Number(coldAcquisitionMs.toFixed(3)),
      firstQueryMs: Number(firstQueryMs.toFixed(3)),
      warmQueryLatencyMs: percentiles(queryLatencies),
      warmDocumentBatchLatencyMs: percentiles(documentBatchLatencies),
      documentBatchThroughputPerSecond: totalBatchMs === 0
        ? 0
        : Number((fixture.documents.length * input.iterations * 1_000 / totalBatchMs).toFixed(3)),
      peakRssDeltaBytes: Math.max(0, peakRss - baselineRss),
      verifiedCacheBytes: cacheBytes,
      documentVectorBytes: fixture.documents.length * model.identity.dimensions * Float32Array.BYTES_PER_ELEMENT,
      querySamples: queryLatencies.length,
      documentBatchSamples: documentBatchLatencies.length,
    })
  } finally {
    await runtime.close()
  }
}

function failedProfile(profile: EmbeddingProfileId, failureCategory: FailedEmbeddingProfile['failureCategory']): FailedEmbeddingProfile {
  return Object.freeze({ profile, state: 'failed', failureCategory })
}

async function executeProfileInChild(
  profile: EmbeddingProfileId,
  input: Omit<WorkerInput, 'profile'>,
): Promise<EmbeddingProfileResult> {
  const childInput: WorkerInput = Object.freeze({ profile, ...input })
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), '--profile-worker'], {
    env: { ...process.env, DOPPELGANGER_EMBEDDING_PROFILE_WORKER_INPUT: JSON.stringify(childInput) },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 900_000,
    killSignal: 'SIGKILL',
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  const line = stdout.split('\n').find(candidate => candidate.startsWith(WORKER_SENTINEL))
  if (exitCode !== 0 || line === undefined) {
    const category = /download|cache|model|artifact|offline/iu.test(stderr) ? 'acquisition' : 'execution'
    return failedProfile(profile, category)
  }
  return JSON.parse(line.slice(WORKER_SENTINEL.length)) as EmbeddingProfileResult
}

export function validateEmbeddingProfileBenchmarkReport(report: EmbeddingProfileBenchmarkReport): void {
  if (report.schemaVersion !== 1 || report.benchmarkId !== 'embeddinggemma-profile-benchmark-v1') {
    throw new TypeError('embedding profile benchmark report schema is unsupported')
  }
  if (report.profiles.length !== PROFILE_IDS.length) throw new TypeError('benchmark report must contain both profiles')
  for (const profile of PROFILE_IDS) {
    const result = report.profiles.find(candidate => candidate.profile === profile)
    if (result === undefined) throw new TypeError(`benchmark report is missing ${profile}`)
    if (result.state !== 'measured') continue
    const numbers = [
      result.coldAcquisitionMs,
      result.firstQueryMs,
      result.warmQueryLatencyMs.p50,
      result.warmQueryLatencyMs.p95,
      result.warmQueryLatencyMs.maximum,
      result.warmDocumentBatchLatencyMs.p50,
      result.warmDocumentBatchLatencyMs.p95,
      result.warmDocumentBatchLatencyMs.maximum,
      result.documentBatchThroughputPerSecond,
      result.peakRssDeltaBytes,
      result.verifiedCacheBytes,
      result.documentVectorBytes,
      result.querySamples,
      result.documentBatchSamples,
    ]
    if (numbers.some(value => !Number.isFinite(value) || value < 0)) throw new TypeError('benchmark report contains invalid measurements')
    if (result.quality.queryCount === 0 || result.quality.recallAtK < 0 || result.quality.recallAtK > 1) {
      throw new TypeError('benchmark report contains invalid quality metrics')
    }
  }
}

export async function runEmbeddingProfileBenchmark(
  options: EmbeddingProfileBenchmarkOptions = {},
  executeProfile: ProfileExecutor = executeProfileInChild,
): Promise<EmbeddingProfileBenchmarkReport> {
  const environment = options.environment ?? process.env
  const enabled = options.enabled ?? environment.DOPPELGANGER_RUN_LOCAL_EMBEDDING_BENCHMARK === '1'
  const cacheDir = options.cacheDir ?? environment.DOPPELGANGER_EMBEDDING_BENCHMARK_CACHE_DIR ?? join(homedir(), '.cache', 'doppelganger', 'models')
  const device = options.device ?? 'cpu'
  const iterations = boundedInteger('iterations', options.iterations ?? 3, 100)
  const topK = boundedInteger('topK', options.topK ?? 3, 100)
  const fixture = await loadEmbeddingProfileFixture()
  const profiles: EmbeddingProfileResult[] = []
  for (const profile of PROFILE_IDS) {
    profiles.push(enabled
      ? await executeProfile(profile, Object.freeze({ cacheDir, device, iterations, topK }))
      : Object.freeze({ profile, state: 'unavailable', reason: 'set DOPPELGANGER_RUN_LOCAL_EMBEDDING_BENCHMARK=1 to run local model inference' }))
  }
  const report: EmbeddingProfileBenchmarkReport = Object.freeze({
    schemaVersion: 1,
    benchmarkId: 'embeddinggemma-profile-benchmark-v1',
    fixtureId: fixture.fixtureId,
    measuredAt: new Date().toISOString(),
    runtime: Object.freeze({ node: process.version, platform: process.platform, arch: process.arch }),
    configuration: Object.freeze({ device, iterations, topK }),
    profiles: Object.freeze(profiles),
  })
  validateEmbeddingProfileBenchmarkReport(report)
  if (options.outputPath !== undefined) {
    if (!isAbsolute(options.outputPath)) throw new TypeError('benchmark outputPath must be absolute')
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  return report
}

async function runWorker(): Promise<void> {
  const encoded = process.env.DOPPELGANGER_EMBEDDING_PROFILE_WORKER_INPUT
  if (encoded === undefined) throw new TypeError('embedding profile worker input is missing')
  const input = JSON.parse(encoded) as WorkerInput
  try {
    const result = await measureProfile(input)
    process.stdout.write(`${WORKER_SENTINEL}${JSON.stringify(result)}\n`)
  } catch (error) {
    const category: FailedEmbeddingProfile['failureCategory'] = error instanceof TypeError
      ? 'fixture'
      : error instanceof LocalEmbeddingError && ['CORRUPT_CACHE', 'MODEL_LOAD', 'OFFLINE_MODEL_UNAVAILABLE'].includes(error.code)
        ? 'acquisition'
        : 'execution'
    process.stdout.write(`${WORKER_SENTINEL}${JSON.stringify(failedProfile(input.profile, category))}\n`)
  }
}

function environmentInteger(name: string): number | undefined {
  const value = process.env[name]
  return value === undefined ? undefined : Number(value)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--profile-worker') {
    await runWorker()
  } else {
    const iterations = environmentInteger('DOPPELGANGER_EMBEDDING_BENCHMARK_ITERATIONS')
    const topK = environmentInteger('DOPPELGANGER_EMBEDDING_BENCHMARK_TOP_K')
    const outputPath = process.env.DOPPELGANGER_EMBEDDING_BENCHMARK_OUTPUT
    const device = process.env.DOPPELGANGER_EMBEDDING_BENCHMARK_DEVICE as LocalEmbeddingDevice | undefined
    const report = await runEmbeddingProfileBenchmark({
      ...(iterations === undefined ? {} : { iterations }),
      ...(topK === undefined ? {} : { topK }),
      ...(outputPath === undefined ? {} : { outputPath }),
      ...(device === undefined ? {} : { device }),
    })
    process.stdout.write(`${JSON.stringify(report)}\n`)
  }
}
