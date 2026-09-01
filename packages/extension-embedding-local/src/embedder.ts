import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MemoryEmbedder, MemoryEmbedderIdentity } from '@doppelganger/doppelganger-memory'
import { localEmbeddingModel, type LocalEmbeddingModelDefinition, type LocalEmbeddingModelName } from './models.ts'

export type LocalEmbeddingDevice = 'cpu' | 'coreml' | 'cuda' | 'webgpu'
export type LocalEmbeddingFailureCode = 'CORRUPT_CACHE' | 'INVALID_INPUT' | 'MODEL_LOAD' | 'OFFLINE_MODEL_UNAVAILABLE' | 'OUTPUT_DIMENSION'

export interface LocalEmbeddingConfig {
  readonly model?: LocalEmbeddingModelName
  readonly cacheDir?: string
  readonly offline?: boolean
  readonly device?: LocalEmbeddingDevice
  readonly batchSize?: number
  readonly maximumCharacters?: number
  readonly acquisitionTimeoutMs?: number
}

export interface LocalEmbeddingExecutionStatus {
  readonly requestedDevice: LocalEmbeddingDevice
  readonly activeDevice?: LocalEmbeddingDevice
  readonly cpuFallback: boolean
}

export class LocalEmbeddingError extends Error {
  readonly code: LocalEmbeddingFailureCode

  constructor(code: LocalEmbeddingFailureCode, message: string) {
    super(message)
    this.name = 'LocalEmbeddingError'
    this.code = code
  }
}

interface TensorLike {
  readonly data: ArrayLike<number>
  readonly dims: readonly number[]
}

export interface LocalEmbeddingRuntime {
  embed(texts: readonly string[], mode: 'query' | 'document'): Promise<TensorLike>
  close(): Promise<void>
}

export type LocalEmbeddingRuntimeLoader = (
  model: LocalEmbeddingModelDefinition,
  options: Readonly<{
    cacheDir: string
    offline: boolean
    device: LocalEmbeddingDevice
  }>,
) => Promise<LocalEmbeddingRuntime>

export type LocalEmbeddingArtifactValidator = (
  cacheDir: string,
  model: LocalEmbeddingModelDefinition,
  allowMissing: boolean,
) => Promise<void>

function positiveInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function normalizedText(value: string, maximumCharacters: number): string {
  if (typeof value !== 'string') throw new LocalEmbeddingError('INVALID_INPUT', 'embedding input must be a string')
  const normalized = value.toWellFormed().normalize('NFKC').trim()
  const length = [...normalized].length
  if (length === 0 || length > maximumCharacters) {
    throw new LocalEmbeddingError('INVALID_INPUT', `embedding input must contain 1-${maximumCharacters} characters`)
  }
  return normalized
}

function l2Project(data: ArrayLike<number>, offset: number, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions)
  let norm = 0
  for (let index = 0; index < dimensions; index += 1) {
    const value = Number(data[offset + index])
    if (!Number.isFinite(value)) throw new LocalEmbeddingError('OUTPUT_DIMENSION', 'embedder returned a non-finite vector')
    vector[index] = value
    norm += value * value
  }
  if (!(norm > 0)) throw new LocalEmbeddingError('OUTPUT_DIMENSION', 'embedder returned a zero vector')
  const scale = 1 / Math.sqrt(norm)
  for (let index = 0; index < dimensions; index += 1) vector[index] = vector[index]! * scale
  return vector
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function validateCachedArtifacts(
  cacheDir: string,
  model: LocalEmbeddingModelDefinition,
  allowMissing: boolean,
): Promise<void> {
  for (const artifact of model.artifacts) {
    const path = join(cacheDir, model.modelId, model.revision, artifact.path)
    let metadata
    try {
      metadata = await stat(path)
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new LocalEmbeddingError('OFFLINE_MODEL_UNAVAILABLE', 'required local embedding model artifacts are unavailable')
    }
    if (!metadata.isFile() || metadata.size !== artifact.bytes || await sha256(path) !== artifact.sha256) {
      throw new LocalEmbeddingError('CORRUPT_CACHE', 'local embedding model cache failed integrity validation')
    }
  }
}

function tensorFrom(value: unknown, field: string): TensorLike {
  if (typeof value !== 'object' || value === null) {
    throw new LocalEmbeddingError('OUTPUT_DIMENSION', `embedder did not return ${field}`)
  }
  const tensor = value as Partial<TensorLike>
  if (tensor.data === undefined || !Array.isArray(tensor.dims)) {
    throw new LocalEmbeddingError('OUTPUT_DIMENSION', `embedder returned malformed ${field}`)
  }
  return tensor as TensorLike
}

export const loadTransformersRuntime: LocalEmbeddingRuntimeLoader = async (model, options) => {
  // Intentional lazy import: the optional ONNX runtime must not load when this plugin is unselected or unused.
  const transformers = await import('@huggingface/transformers')
  const common = {
    revision: model.revision,
    cache_dir: options.cacheDir,
    local_files_only: options.offline,
    dtype: model.dtype,
    device: options.device,
  } as const

  if (model.name === 'embeddinggemma-300m') {
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(model.modelId, common)
    const runtimeModel = await transformers.AutoModel.from_pretrained(model.modelId, common)
    return {
      async embed(texts, mode) {
        const prefix = mode === 'query' ? model.queryPrefix : model.documentPrefix
        const inputs = await tokenizer(texts.map(text => prefix + text), { padding: true, truncation: true })
        const outputs = await runtimeModel(inputs) as unknown as { sentence_embedding?: unknown }
        return tensorFrom(outputs.sentence_embedding, 'sentence_embedding')
      },
      async close() {
        await runtimeModel.dispose()
      },
    }
  }

  const extractor = await transformers.pipeline('feature-extraction', model.modelId, common)
  return {
    async embed(texts) {
      return tensorFrom(await extractor([...texts], { pooling: 'mean', normalize: true }), 'feature extraction output')
    },
    async close() {
      await extractor.dispose()
    },
  }
}

export class LocalMemoryEmbedder implements MemoryEmbedder {
  readonly identity: MemoryEmbedderIdentity
  private readonly model: LocalEmbeddingModelDefinition
  private readonly cacheDir: string
  private readonly offline: boolean
  private readonly requestedDevice: LocalEmbeddingDevice
  private readonly batchSize: number
  private readonly maximumCharacters: number
  private readonly acquisitionTimeoutMs: number
  private readonly runtimeLoader: LocalEmbeddingRuntimeLoader
  private readonly artifactValidator: LocalEmbeddingArtifactValidator
  private runtimePromise?: Promise<LocalEmbeddingRuntime>
  private activeDevice?: LocalEmbeddingDevice
  private cpuFallback = false
  private acquisitionCandidate: LocalEmbeddingRuntime | undefined
  private readonly closedRuntimes = new WeakSet<LocalEmbeddingRuntime>()
  private closePromise?: Promise<void>
  private closed = false

  constructor(
    config: LocalEmbeddingConfig = {},
    runtimeLoader: LocalEmbeddingRuntimeLoader = loadTransformersRuntime,
    artifactValidator: LocalEmbeddingArtifactValidator = validateCachedArtifacts,
  ) {
    this.model = localEmbeddingModel(config.model ?? 'embeddinggemma-300m')
    this.identity = this.model.identity
    this.cacheDir = config.cacheDir ?? join(homedir(), '.cache', 'doppelganger', 'models')
    this.offline = config.offline ?? false
    this.requestedDevice = config.device ?? 'cpu'
    this.batchSize = positiveInteger('batchSize', config.batchSize ?? 16, 128)
    this.maximumCharacters = positiveInteger('maximumCharacters', config.maximumCharacters ?? 16_384, 1_000_000)
    this.acquisitionTimeoutMs = positiveInteger('acquisitionTimeoutMs', config.acquisitionTimeoutMs ?? 120_000, 600_000)
    this.runtimeLoader = runtimeLoader
    this.artifactValidator = artifactValidator
  }
  executionStatus(): LocalEmbeddingExecutionStatus {
    return Object.freeze({
      requestedDevice: this.requestedDevice,
      ...(this.activeDevice === undefined ? {} : { activeDevice: this.activeDevice }),
      cpuFallback: this.cpuFallback,
    })
  }

  private async closeRuntime(runtime: LocalEmbeddingRuntime): Promise<void> {
    if (this.closedRuntimes.has(runtime)) return
    this.closedRuntimes.add(runtime)
    await runtime.close()
  }
  private async loadOn(device: LocalEmbeddingDevice): Promise<LocalEmbeddingRuntime> {
    await this.artifactValidator(this.cacheDir, this.model, !this.offline)
    let timeout: ReturnType<typeof setTimeout> | undefined
    let accepting = true
    const loading = this.runtimeLoader(
      this.model,
      Object.freeze({ cacheDir: this.cacheDir, offline: this.offline, device }),
    ).then(async runtime => {
      if (!accepting || this.closed) {
        await this.closeRuntime(runtime)
        throw new LocalEmbeddingError('MODEL_LOAD', 'local embedder is closed')
      }
      return runtime
    })
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new LocalEmbeddingError('MODEL_LOAD', 'local embedding model acquisition timed out')), this.acquisitionTimeoutMs)
      })
      const runtime = await Promise.race([loading, deadline])
      this.acquisitionCandidate = runtime
      try {
        await this.artifactValidator(this.cacheDir, this.model, false)
        if (this.closed) throw new LocalEmbeddingError('MODEL_LOAD', 'local embedder is closed')
        this.activeDevice = device
        this.acquisitionCandidate = undefined
        return runtime
      } catch (error) {
        this.acquisitionCandidate = undefined
        await this.closeRuntime(runtime)
        throw error
      }
    } finally {
      accepting = false
      clearTimeout(timeout)
    }
  }

  private runtime(): Promise<LocalEmbeddingRuntime> {
    if (this.closed) return Promise.reject(new LocalEmbeddingError('MODEL_LOAD', 'local embedder is closed'))
    if (this.runtimePromise !== undefined) return this.runtimePromise
    this.runtimePromise = (async () => {
      try {
        return await this.loadOn(this.requestedDevice)
      } catch (error) {
        if (this.closed) throw new LocalEmbeddingError('MODEL_LOAD', 'local embedder is closed')
        if (error instanceof LocalEmbeddingError && (error.code === 'CORRUPT_CACHE' || error.code === 'OFFLINE_MODEL_UNAVAILABLE')) throw error
        if (this.requestedDevice !== 'cpu') {
          this.cpuFallback = true
          return this.loadOn('cpu')
        }
        throw new LocalEmbeddingError(
          this.offline ? 'OFFLINE_MODEL_UNAVAILABLE' : 'MODEL_LOAD',
          this.offline ? 'required local embedding model artifacts are unavailable' : 'local embedding model could not be loaded',
        )
      }
    })()
    return this.runtimePromise
  }

  private async embed(texts: readonly string[], mode: 'query' | 'document'): Promise<readonly Float32Array[]> {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new LocalEmbeddingError('INVALID_INPUT', 'embedding batch must be a non-empty array')
    }
    const normalized = texts.map(text => normalizedText(text, this.maximumCharacters))
    const runtime = await this.runtime()
    const vectors: Float32Array[] = []
    for (let start = 0; start < normalized.length; start += this.batchSize) {
      const batch = normalized.slice(start, start + this.batchSize)
      const tensor = await runtime.embed(batch, mode)
      const expected = batch.length * this.model.sourceDimensions
      if (tensor.data.length !== expected || tensor.dims.at(-1) !== this.model.sourceDimensions) {
        throw new LocalEmbeddingError('OUTPUT_DIMENSION', 'embedder output dimensions do not match its declared identity')
      }
      for (let index = 0; index < batch.length; index += 1) {
        vectors.push(l2Project(tensor.data, index * this.model.sourceDimensions, this.identity.dimensions))
      }
    }
    return Object.freeze(vectors)
  }

  embedDocuments(texts: readonly string[]): Promise<readonly Float32Array[]> {
    return this.embed(texts, 'document')
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.embed([text], 'query')
    if (vector === undefined) throw new LocalEmbeddingError('OUTPUT_DIMENSION', 'embedder returned no query vector')
    return vector
  }

  close(): Promise<void> {
    this.closed = true
    return this.closePromise ??= (async () => {
      const candidate = this.acquisitionCandidate
      if (candidate !== undefined) await this.closeRuntime(candidate)
      const runtime = await this.runtimePromise?.catch(() => undefined)
      if (runtime !== undefined) await this.closeRuntime(runtime)
    })()
  }
}
