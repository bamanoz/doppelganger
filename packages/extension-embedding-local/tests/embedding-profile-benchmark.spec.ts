import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localEmbeddingModel, type LocalEmbeddingDevice } from '../src/index.ts'
import {
  loadEmbeddingProfileFixture,
  measureEmbeddingProfileQuality,
  runEmbeddingProfileBenchmark,
  validateEmbeddingProfileBenchmarkReport,
  type EmbeddingProfileBenchmarkReport,
  type EmbeddingProfileId,
  type EmbeddingProfileResult,
  type MeasuredEmbeddingProfile,
} from './embedding-profile-benchmark.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function outputPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-embedding-profile-report-'))
  roots.push(root)
  return join(root, 'report.json')
}

function measured(profile: EmbeddingProfileId, device: LocalEmbeddingDevice): MeasuredEmbeddingProfile {
  const current = localEmbeddingModel('embeddinggemma-300m')
  const dimensions = profile === 'q4-256' ? 256 : 384
  return Object.freeze({
    profile,
    state: 'measured',
    identity: Object.freeze({
      ...current.identity,
      artifactDigest: profile === 'q4-256'
        ? '7834419539b0d053ffcdf98223764a8060e12078bb137165f5031b03455b334e'
        : current.identity.artifactDigest,
      projection: profile === 'q4-256' ? 'mrl-truncate-256-l2' : current.identity.projection,
      dimensions,
    }),
    dtype: profile === 'q4-256' ? 'q4' : 'q8',
    device,
    topK: 3,
    iterations: 2,
    quality: Object.freeze({ queryCount: 8, hitCount: 8, recallAtK: 1, reciprocalRankMean: 1, forbiddenHitCount: 0 }),
    qualityByLanguage: Object.freeze({
      en: Object.freeze({ queryCount: 6, hitCount: 6, recallAtK: 1, reciprocalRankMean: 1, forbiddenHitCount: 0 }),
      ru: Object.freeze({ queryCount: 2, hitCount: 2, recallAtK: 1, reciprocalRankMean: 1, forbiddenHitCount: 0 }),
    }),
    coldAcquisitionMs: 100,
    firstQueryMs: 10,
    warmQueryLatencyMs: Object.freeze({ p50: 5, p95: 7, maximum: 8 }),
    warmDocumentBatchLatencyMs: Object.freeze({ p50: 20, p95: 22, maximum: 24 }),
    documentBatchThroughputPerSecond: 500,
    peakRssDeltaBytes: 1024,
    verifiedCacheBytes: profile === 'q4-256' ? 197245082 : 309458498,
    documentVectorBytes: 10 * dimensions * Float32Array.BYTES_PER_ELEMENT,
    querySamples: 16,
    documentBatchSamples: 2,
  })
}

describe('embedding profile benchmark', () => {
  it('loads one versioned bilingual fixture with valid relationships', async () => {
    const fixture = await loadEmbeddingProfileFixture()
    expect(fixture).toMatchObject({ schemaVersion: 1, fixtureId: 'embeddinggemma-profile-bilingual-v1' })
    expect(fixture.documents).toHaveLength(10)
    expect(fixture.queries).toHaveLength(8)
    expect(new Set(fixture.queries.map(query => query.language))).toEqual(new Set(['en', 'ru']))
  })

  it('computes deterministic recall, reciprocal rank, and forbidden-hit metrics', async () => {
    const fixture = await loadEmbeddingProfileFixture()
    const dimensions = fixture.documents.length
    const documentIndex = new Map(fixture.documents.map((document, index) => [document.key, index]))
    const documents = fixture.documents.map((_document, index) => {
      const vector = new Float32Array(dimensions)
      vector[index] = 1
      return vector
    })
    const queries = fixture.queries.map(query => documents[documentIndex.get(query.expectedKey)!]!.slice())
    const result = measureEmbeddingProfileQuality(fixture, documents, queries, 3)
    expect(result.quality).toEqual({
      queryCount: 8,
      hitCount: 8,
      recallAtK: 1,
      reciprocalRankMean: 1,
      forbiddenHitCount: 0,
    })
    expect(result.qualityByLanguage.en.queryCount).toBe(6)
    expect(result.qualityByLanguage.ru.queryCount).toBe(2)
  })

  it('records explicit unavailable profiles when opt-in execution is disabled', async () => {
    const path = await outputPath()
    const report = await runEmbeddingProfileBenchmark({ enabled: false, outputPath: path, environment: {} })
    expect(report.profiles).toEqual([
      { profile: 'q4-256', state: 'unavailable', reason: expect.stringContaining('DOPPELGANGER_RUN_LOCAL_EMBEDDING_BENCHMARK') },
      { profile: 'q8-384', state: 'unavailable', reason: expect.stringContaining('DOPPELGANGER_RUN_LOCAL_EMBEDDING_BENCHMARK') },
    ])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(report)
  })

  it('validates measured reports from an injected profile executor', async () => {
    const calls: EmbeddingProfileId[] = []
    const execute = async (profile: EmbeddingProfileId, input: Readonly<{ device: LocalEmbeddingDevice }>): Promise<EmbeddingProfileResult> => {
      calls.push(profile)
      return measured(profile, input.device)
    }
    const report = await runEmbeddingProfileBenchmark({ enabled: true, iterations: 2, topK: 3 }, execute)
    expect(calls).toEqual(['q4-256', 'q8-384'])
    expect(report.profiles.map(result => result.state)).toEqual(['measured', 'measured'])
    expect(() => validateEmbeddingProfileBenchmarkReport(report)).not.toThrow()

    const invalid = {
      ...report,
      profiles: report.profiles.map((result, index) => index === 0 && result.state === 'measured'
        ? { ...result, peakRssDeltaBytes: -1 }
        : result),
    } as EmbeddingProfileBenchmarkReport
    expect(() => validateEmbeddingProfileBenchmarkReport(invalid)).toThrow('invalid measurements')
  })
})
