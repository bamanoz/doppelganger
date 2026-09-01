import type { MemoryEmbedderIdentity } from '@doppelganger/doppelganger-memory'

export type LocalEmbeddingModelName = 'embeddinggemma-300m' | 'all-MiniLM-L6-v2'
export type LocalEmbeddingDtype = 'q4' | 'q8'

export interface LocalEmbeddingArtifact {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export interface LocalEmbeddingModelDefinition {
  readonly name: LocalEmbeddingModelName
  readonly modelId: string
  readonly revision: string
  readonly dtype: LocalEmbeddingDtype
  readonly identity: MemoryEmbedderIdentity
  readonly artifacts: readonly LocalEmbeddingArtifact[]
  readonly sourceDimensions: number
  readonly queryPrefix: string
  readonly documentPrefix: string
}

const EMBEDDING_GEMMA: LocalEmbeddingModelDefinition = Object.freeze({
  name: 'embeddinggemma-300m',
  modelId: 'onnx-community/embeddinggemma-300m-ONNX',
  revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
  dtype: 'q8',
  identity: Object.freeze({
    provider: 'transformers.js',
    modelId: 'onnx-community/embeddinggemma-300m-ONNX',
    revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
    artifactDigest: '925cf7a13b59bc77279b08a78c8f17599939c5ab898d209efc3602b387a01f3e',
    pooling: 'sentence_embedding',
    projection: 'mrl-truncate-384-l2',
    dimensions: 384,
    normalized: true,
    distanceMetric: 'cosine',
  }),
  artifacts: Object.freeze([
    Object.freeze({
      path: 'onnx/model_quantized.onnx',
      sha256: '172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8',
      bytes: 567874,
    }),
    Object.freeze({
      path: 'onnx/model_quantized.onnx_data',
      sha256: '705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0',
      bytes: 308890624,
    }),
  ]),
  sourceDimensions: 768,
  queryPrefix: 'task: search result | query: ',
  documentPrefix: 'title: none | text: ',
})

const MINI_LM: LocalEmbeddingModelDefinition = Object.freeze({
  name: 'all-MiniLM-L6-v2',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dtype: 'q8',
  identity: Object.freeze({
    provider: 'transformers.js',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    artifactDigest: '3b9988aaab328652187e82c1c8185a7016d4963e81e5214f4c00565f5a44ba1b',
    pooling: 'mean',
    projection: 'identity-384-l2',
    dimensions: 384,
    normalized: true,
    distanceMetric: 'cosine',
  }),
  artifacts: Object.freeze([
    Object.freeze({
      path: 'onnx/model_quantized.onnx',
      sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
      bytes: 22972370,
    }),
  ]),
  sourceDimensions: 384,
  queryPrefix: '',
  documentPrefix: '',
})

export const LOCAL_EMBEDDING_MODELS: Readonly<Record<LocalEmbeddingModelName, LocalEmbeddingModelDefinition>> = Object.freeze({
  'embeddinggemma-300m': EMBEDDING_GEMMA,
  'all-MiniLM-L6-v2': MINI_LM,
})

export function localEmbeddingModel(name: LocalEmbeddingModelName): LocalEmbeddingModelDefinition {
  const model = LOCAL_EMBEDDING_MODELS[name]
  if (model === undefined) throw new TypeError(`unsupported local embedding model: ${String(name)}`)
  return model
}
