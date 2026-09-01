import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runRetrievalBenchmark, type BackendMeasurement, type RetrievalBenchmarkReport } from './retrieval-benchmark.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function outputPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-retrieval-report-'))
  roots.push(root)
  return join(root, 'report.json')
}

describe('retrieval benchmark harness', () => {
  it('records reproducible lexical and SQLite hybrid quality while distinguishing unavailable servers', async () => {
    const path = await outputPath()
    const report = await runRetrievalBenchmark({
      iterations: 2,
      warmupIterations: 1,
      topKValues: [1, 2, 4],
      batchSizes: [1, 4],
      outputPath: path,
      environment: {},
    })

    expect(report.backends.filter(result => result.state === 'measured').map(result => result.backend))
      .toEqual(['lexical-only', 'sqlite_exact', 'sqlite_exact', 'sqlite_exact'])
    expect(report.backends.filter(result => result.state === 'unavailable'))
      .toMatchObject([
        { backend: 'chroma', gate: 'MEMORY_BENCHMARK_CHROMA_URL' },
        { backend: 'qdrant', gate: 'MEMORY_BENCHMARK_QDRANT_URL' },
        { backend: 'pgvector', gate: 'MEMORY_BENCHMARK_PGVECTOR_DSN_ENV' },
      ])
    expect(report.backends.filter(result => result.state === 'failed')).toHaveLength(0)

    const sqlite = report.backends.filter((result): result is BackendMeasurement =>
      result.state === 'measured' && result.backend === 'sqlite_exact')
    expect(sqlite.at(-1)?.quality).toMatchObject({ recall: 1, forbiddenHitCount: 0 })
    expect(report.derivedDefaults.semanticTopK).toMatchObject({ supported: true, value: 4 })
    expect(report.derivedDefaults.batchSize).toMatchObject({ supported: false, value: null })
    expect(report.sqliteBatchMeasurements).toHaveLength(2)
    expect(report.sqliteBatchMeasurements.every(measurement => measurement.entriesPerSecond >= 0)).toBe(true)
    expect(report.derivedDefaults.queryDeadline).toMatchObject({ supported: false, value: null })
    expect(report.derivedDefaults.generationRetention).toMatchObject({ supported: false, value: null })

    expect(report.backends.filter(result => result.state === 'measured').every(result =>
      result.deadlineMs === report.configuration.queryDeadlineMs && result.deadlineExceededCount === 0)).toBe(true)
    const persisted = JSON.parse(await readFile(path, 'utf8')) as RetrievalBenchmarkReport
    expect(persisted).toEqual(report)
    expect(persisted.backends.every(result => result.state !== 'measured' || result.samples > 0)).toBe(true)
  })
})
