import { createHash } from 'node:crypto'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalEmbeddingError,
  LocalEmbeddingPlugin,
  LocalMemoryEmbedder,
  localEmbeddingModel,
  type LocalEmbeddingRuntime,
  type LocalEmbeddingRuntimeLoader,
} from '../src/index.ts'

const temporaryRoots: string[] = []

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'doppelganger-embedder-'))
  temporaryRoots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function fakeLoader(calls: string[], failDevice?: string): LocalEmbeddingRuntimeLoader {
  return async (model, options) => {
    calls.push(options.device)
    if (options.device === failDevice) throw new Error('accelerator unavailable')
    return {
      async embed(texts) {
        const data = new Float32Array(texts.length * model.sourceDimensions)
        texts.forEach((text, index) => {
          const offset = index * model.sourceDimensions
          data[offset] = 1
          data[offset + 1] = text.length / 100
        })
        return { data, dims: [texts.length, model.sourceDimensions] }
      },
      async close() {},
    }
  }
}

const acceptArtifacts = async () => {}

function artifactSetDigest(model: ReturnType<typeof localEmbeddingModel>): string {
  const manifest = model.artifacts.map(artifact => ({
    bytes: artifact.bytes,
    path: artifact.path,
    sha256: artifact.sha256,
  }))
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('local memory embedder', () => {
  it('declares immutable model identities and supported dimensions', () => {
    const gemma = localEmbeddingModel('embeddinggemma-300m')
    expect(gemma).toMatchObject({
      dtype: 'q8',
      sourceDimensions: 768,
      queryPrefix: 'task: search result | query: ',
      documentPrefix: 'title: none | text: ',
      identity: {
        dimensions: 384,
        normalized: true,
        distanceMetric: 'cosine',
        projection: 'mrl-truncate-384-l2',
      },
      artifacts: [
        {
          path: 'onnx/model_quantized.onnx',
          sha256: '172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8',
          bytes: 567874,
        },
        {
          path: 'onnx/model_quantized.onnx_data',
          sha256: '705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0',
          bytes: 308890624,
        },
      ],
    })
    expect(gemma.identity.artifactDigest).toBe(artifactSetDigest(gemma))
    expect(gemma.revision).toMatch(/^[a-f0-9]{40}$/)

    expect(localEmbeddingModel('all-MiniLM-L6-v2')).toMatchObject({
      dtype: 'q8',
      sourceDimensions: 384,
      queryPrefix: '',
      documentPrefix: '',
      identity: {
        dimensions: 384,
        normalized: true,
        distanceMetric: 'cosine',
        projection: 'identity-384-l2',
        artifactDigest: '3b9988aaab328652187e82c1c8185a7016d4963e81e5214f4c00565f5a44ba1b',
      },
    })
    expect(() => localEmbeddingModel('unknown' as never)).toThrow('unsupported local embedding model')
  })

  it('normalizes output and executes bounded document batches', async () => {
    const calls: string[] = []
    const embedder = new LocalMemoryEmbedder(
      { model: 'all-MiniLM-L6-v2', batchSize: 2 },
      fakeLoader(calls),
      acceptArtifacts,
    )
    const vectors = await embedder.embedDocuments(['one', 'two', 'three'])
    expect(vectors).toHaveLength(3)
    expect(vectors.every(vector => vector.length === 384)).toBe(true)
    for (const vector of vectors) {
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
      expect(norm).toBeCloseTo(1, 6)
    }
    expect(calls).toEqual(['cpu'])
    await embedder.close()
  })

  it('falls back to CPU without changing vector-space identity', async () => {
    const calls: string[] = []
    const embedder = new LocalMemoryEmbedder(
      { model: 'embeddinggemma-300m', device: 'coreml' },
      fakeLoader(calls, 'coreml'),
      acceptArtifacts,
    )
    const before = embedder.identity
    expect((await embedder.embedQuery('Как восстановить индекс?')).length).toBe(384)
    expect(embedder.identity).toBe(before)
    expect(calls).toEqual(['coreml', 'cpu'])
    expect(embedder.executionStatus()).toEqual({
      requestedDevice: 'coreml',
      activeDevice: 'cpu',
      cpuFallback: true,
    })
    await embedder.close()
  })


  it('closes a late runtime exactly once when close wins acquisition', async () => {
    const acquisition = deferred<LocalEmbeddingRuntime>()
    const started = deferred<void>()
    let closes = 0
    const runtime: LocalEmbeddingRuntime = {
      async embed() { return { data: new Float32Array(384), dims: [1, 384] } },
      async close() { closes += 1 },
    }
    const embedder = new LocalMemoryEmbedder(
      { model: 'all-MiniLM-L6-v2' },
      async () => {
        started.resolve()
        return acquisition.promise
      },
      acceptArtifacts,
    )
    const embedding = embedder.embedQuery('pending acquisition')
    await started.promise
    const closing = embedder.close()
    acquisition.resolve(runtime)

    await expect(embedding).rejects.toThrow(/closed/i)
    await closing
    await embedder.close()
    expect(closes).toBe(1)
    expect(embedder.executionStatus()).toEqual({ requestedDevice: 'cpu', cpuFallback: false })
    await expect(embedder.embedQuery('after close')).rejects.toThrow(/closed/i)
  })

  it('closes a loaded candidate when post-load artifact validation fails', async () => {
    let validations = 0
    let closes = 0
    const embedder = new LocalMemoryEmbedder(
      { model: 'all-MiniLM-L6-v2' },
      async model => ({
        async embed() { return { data: new Float32Array(model.sourceDimensions), dims: [1, model.sourceDimensions] } },
        async close() { closes += 1 },
      }),
      async () => {
        validations += 1
        if (validations === 2) throw new LocalEmbeddingError('CORRUPT_CACHE', 'post-load validation failed')
      },
    )

    await expect(embedder.embedQuery('validate candidate')).rejects.toMatchObject({ code: 'CORRUPT_CACHE' })
    expect(closes).toBe(1)
    expect(embedder.executionStatus()).toEqual({ requestedDevice: 'cpu', cpuFallback: false })
    await embedder.close()
    expect(closes).toBe(1)
  })

  it('closes a failed accelerator candidate before CPU fallback begins', async () => {
    const events: string[] = []
    let postLoadValidations = 0
    const embedder = new LocalMemoryEmbedder(
      { model: 'embeddinggemma-300m', device: 'coreml' },
      async (model, options) => {
        events.push(`load:${options.device}`)
        return {
          async embed() {
            const data = new Float32Array(model.sourceDimensions)
            data[0] = 1
            return { data, dims: [1, model.sourceDimensions] }
          },
          async close() { events.push(`close:${options.device}`) },
        }
      },
      async (_cacheDir, _model, allowMissing) => {
        if (allowMissing) return
        postLoadValidations += 1
        if (postLoadValidations === 1) throw new Error('accelerator validation failed')
      },
    )

    await expect(embedder.embedQuery('fallback after cleanup')).resolves.toHaveLength(384)
    expect(events).toEqual(['load:coreml', 'close:coreml', 'load:cpu'])
    expect(embedder.executionStatus()).toEqual({ requestedDevice: 'coreml', activeDevice: 'cpu', cpuFallback: true })
    await embedder.close()
    expect(events).toEqual(['load:coreml', 'close:coreml', 'load:cpu', 'close:cpu'])
  })
  it('rejects malformed input and output dimensions', async () => {
    const embedder = new LocalMemoryEmbedder({}, fakeLoader([]), acceptArtifacts)
    await expect(embedder.embedQuery('   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const malformed: LocalEmbeddingRuntimeLoader = async () => ({
      async embed() {
        return { data: new Float32Array(3), dims: [1, 3] }
      },
      async close() {},
    })
    const invalid = new LocalMemoryEmbedder({}, malformed, acceptArtifacts)
    await expect(invalid.embedQuery('valid input')).rejects.toMatchObject({ code: 'OUTPUT_DIMENSION' })
    await Promise.all([embedder.close(), invalid.close()])
  })

  it('reports offline and corrupt model caches without invoking the runtime', async () => {
    const cacheDir = await root()
    const offline = new LocalMemoryEmbedder({ model: 'all-MiniLM-L6-v2', cacheDir, offline: true }, async () => {
      throw new Error('runtime must not load')
    })
    await expect(offline.embedQuery('query')).rejects.toMatchObject({ code: 'OFFLINE_MODEL_UNAVAILABLE' })

    const model = localEmbeddingModel('all-MiniLM-L6-v2')
    const artifact = model.artifacts[0]!
    const artifactPath = join(cacheDir, model.modelId, model.revision, artifact.path)
    await mkdir(dirname(artifactPath), { recursive: true })
    await writeFile(artifactPath, 'corrupt')
    const corrupt = new LocalMemoryEmbedder({ model: model.name, cacheDir }, async () => {
      throw new Error('runtime must not load')
    })
    await expect(corrupt.embedQuery('query')).rejects.toEqual(expect.objectContaining<Partial<LocalEmbeddingError>>({
      code: 'CORRUPT_CACHE',
    }))
    await Promise.all([offline.close(), corrupt.close()])
  })

  it('does not accept legacy q4 artifacts as the q8 profile cache', async () => {
    const cacheDir = await root()
    const model = localEmbeddingModel('embeddinggemma-300m')
    const modelRoot = join(cacheDir, model.modelId, model.revision, 'onnx')
    await mkdir(modelRoot, { recursive: true })
    await Promise.all([
      writeFile(join(modelRoot, 'model_q4.onnx'), 'legacy graph'),
      writeFile(join(modelRoot, 'model_q4.onnx_data'), 'legacy weights'),
    ])
    const offline = new LocalMemoryEmbedder({ model: model.name, cacheDir, offline: true }, async () => {
      throw new Error('runtime must not load')
    })
    await expect(offline.embedQuery('query')).rejects.toMatchObject({ code: 'OFFLINE_MODEL_UNAVAILABLE' })
    await offline.close()

    const graph = model.artifacts[0]!
    await writeFile(join(cacheDir, model.modelId, model.revision, graph.path), 'corrupt q8 graph')
    const corrupt = new LocalMemoryEmbedder({ model: model.name, cacheDir }, async () => {
      throw new Error('runtime must not load')
    })
    await expect(corrupt.embedQuery('query')).rejects.toMatchObject({ code: 'CORRUPT_CACHE' })
    await corrupt.close()
  })

  it('does not acquire model artifacts during plugin activation', async () => {
    const cacheDir = join(await root(), 'unused-cache')
    const context = new Context()
    await context.plugin(LocalEmbeddingPlugin, { cacheDir, offline: true })
    await expect(access(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(context.doppelgangerMemoryEmbedder.identity.dimensions).toBe(384)
    await context.fiber.dispose()
  })

  it.skipIf(process.env.DOPPELGANGER_RUN_LOCAL_EMBEDDING_SMOKE !== '1')(
    'runs real MiniLM and multilingual EmbeddingGemma inference',
    async () => {
      const cacheDir = process.env.DOPPELGANGER_LOCAL_EMBEDDING_SMOKE_CACHE_DIR ?? join(await root(), 'model-cache')
      const cosine = (left: Float32Array, right: Float32Array) => left.reduce((sum, value, index) => sum + value * right[index]!, 0)
      const mini = new LocalMemoryEmbedder({
        model: 'all-MiniLM-L6-v2',
        cacheDir,
        acquisitionTimeoutMs: 120_000,
      })
      const englishQuery = await mini.embedQuery('How do I persist data safely?')
      const [englishNear, englishFar] = await mini.embedDocuments([
        'Use a short database transaction for durable writes.',
        'The sky is clear above the mountain.',
      ])
      expect(cosine(englishQuery, englishNear!)).toBeGreaterThan(cosine(englishQuery, englishFar!))
      await mini.close()
      const miniOffline = new LocalMemoryEmbedder({ model: 'all-MiniLM-L6-v2', cacheDir, offline: true })
      await expect(miniOffline.embedQuery('offline durable storage')).resolves.toHaveLength(384)
      await miniOffline.close()

      const gemma = new LocalMemoryEmbedder({
        model: 'embeddinggemma-300m',
        cacheDir,
        acquisitionTimeoutMs: 300_000,
      })
      const russianQuery = await gemma.embedQuery('Как безопасно сохранять данные?')
      const [russianNear, russianFar] = await gemma.embedDocuments([
        'Используйте короткую транзакцию базы данных для надёжной записи.',
        'Над горой сегодня ясное небо.',
      ])
      expect(cosine(russianQuery, russianNear!)).toBeGreaterThan(cosine(russianQuery, russianFar!))
      const englishCrossLanguage = await gemma.embedQuery('How should durable writes be stored?')
      expect(cosine(englishCrossLanguage, russianNear!)).toBeGreaterThan(cosine(englishCrossLanguage, russianFar!))
      await gemma.close()
      const gemmaOffline = new LocalMemoryEmbedder({ model: 'embeddinggemma-300m', cacheDir, offline: true })
      await expect(gemmaOffline.embedQuery('офлайн сохранение данных')).resolves.toHaveLength(384)
      await gemmaOffline.close()

      if (process.platform === 'darwin' && process.arch === 'arm64') {
        const fallback = new LocalMemoryEmbedder({
          model: 'embeddinggemma-300m',
          cacheDir,
          offline: true,
          device: 'cuda',
          acquisitionTimeoutMs: 300_000,
        })
        await expect(fallback.embedQuery('accelerator fallback')).resolves.toHaveLength(384)
        expect(fallback.executionStatus()).toEqual({ requestedDevice: 'cuda', activeDevice: 'cpu', cpuFallback: true })
        await fallback.close()
      }
    },
    600_000,
  )
})
