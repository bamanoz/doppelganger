import { describe, expect, it } from 'vitest'
import {
  assertMemorySemanticGenerationCompatible,
  memoryEmbedderFingerprint,
  memoryProjectionWorkId,
  memorySemanticGenerationId,
  memoryVectorIdentityId,
  memoryVectorIndexFingerprint,
  validateMemoryEmbedderIdentity,
  validateMemoryVector,
  validateMemoryVectorIndexIdentity,
  type MemoryEmbedderIdentity,
  type MemoryVectorIndexIdentity,
} from '../src/index.ts'

const digest = `sha256:${'a'.repeat(64)}`

const embedder: MemoryEmbedderIdentity = {
  provider: 'transformers.js',
  modelId: 'google/embeddinggemma-300m',
  revision: 'model.revision.1',
  artifactDigest: digest,
  pooling: 'mean',
  projection: 'matryoshka-384',
  dimensions: 384,
  normalized: true,
  distanceMetric: 'cosine',
}

const vectorIndex: MemoryVectorIndexIdentity = {
  backend: 'qdrant',
  namespace: 'aiden-memory',
  sanitizedTarget: 'https://vectors.example.test',
  configFingerprint: 'b'.repeat(64),
  dimensions: 384,
  distanceMetric: 'cosine',
}

describe('semantic memory contracts', () => {
  it('normalizes and freezes complete embedder and vector-index identities', () => {
    expect(validateMemoryEmbedderIdentity(embedder)).toEqual(embedder)
    expect(Object.isFrozen(validateMemoryEmbedderIdentity(embedder))).toBe(true)
    expect(validateMemoryVectorIndexIdentity(vectorIndex)).toEqual(vectorIndex)
    expect(Object.isFrozen(validateMemoryVectorIndexIdentity(vectorIndex))).toBe(true)
  })

  it('assigns distinct embedder and generation identities to q4/256, q8/384, and MiniLM', () => {
    const q4: MemoryEmbedderIdentity = {
      provider: 'transformers.js',
      modelId: 'onnx-community/embeddinggemma-300m-ONNX',
      revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
      artifactDigest: '7834419539b0d053ffcdf98223764a8060e12078bb137165f5031b03455b334e',
      pooling: 'sentence_embedding',
      projection: 'mrl-truncate-256-l2',
      dimensions: 256,
      normalized: true,
      distanceMetric: 'cosine',
    }
    const q8: MemoryEmbedderIdentity = {
      ...q4,
      artifactDigest: '925cf7a13b59bc77279b08a78c8f17599939c5ab898d209efc3602b387a01f3e',
      projection: 'mrl-truncate-384-l2',
      dimensions: 384,
    }
    const miniLm: MemoryEmbedderIdentity = {
      provider: 'transformers.js',
      modelId: 'Xenova/all-MiniLM-L6-v2',
      revision: '751bff37182d3f1213fa05d7196b954e230abad9',
      artifactDigest: '3b9988aaab328652187e82c1c8185a7016d4963e81e5214f4c00565f5a44ba1b',
      pooling: 'mean',
      projection: 'identity-384-l2',
      dimensions: 384,
      normalized: true,
      distanceMetric: 'cosine',
    }
    const index256 = { ...vectorIndex, dimensions: 256 }
    const fingerprints = new Set([memoryEmbedderFingerprint(q4), memoryEmbedderFingerprint(q8), memoryEmbedderFingerprint(miniLm)])
    const generations = new Set([
      memorySemanticGenerationId('aiden', q4, index256),
      memorySemanticGenerationId('aiden', q8, vectorIndex),
      memorySemanticGenerationId('aiden', miniLm, vectorIndex),
    ])
    expect(fingerprints.size).toBe(3)
    expect(generations.size).toBe(3)
    expect(() => assertMemorySemanticGenerationCompatible(
      { id: memorySemanticGenerationId('aiden', q4, index256), instanceId: 'aiden', embedder: q4, vectorIndex: index256 },
      'aiden',
      q8,
      vectorIndex,
    )).toThrow('incompatible')
  })

  it('rejects mutable model labels, malformed dimensions, and unusable vectors', () => {
    expect(() => validateMemoryEmbedderIdentity({ ...embedder, artifactDigest: 'main' })).toThrow('immutable SHA-256')
    expect(() => validateMemoryEmbedderIdentity({ ...embedder, dimensions: 0 })).toThrow('dimensions')
    expect(() => validateMemoryVector(new Float32Array([1, 2]), 3)).toThrow('dimensions')
    expect(() => validateMemoryVector(new Float32Array([0, 0]), 2)).toThrow('non-zero norm')
    expect(() => validateMemoryVector(new Float32Array([1, Number.NaN]), 2)).toThrow('finite')
  })

  it('uses deterministic identifiers and excludes undeclared secrets and device settings', () => {
    const secretBearingEmbedder = {
      ...embedder,
      device: 'cuda',
      accessToken: 'model-secret',
    } as MemoryEmbedderIdentity
    const secretBearingIndex = {
      ...vectorIndex,
      apiKey: 'backend-secret',
      connectionString: 'postgres://secret@example.test/memory',
    } as MemoryVectorIndexIdentity
    expect(memoryEmbedderFingerprint(secretBearingEmbedder)).toBe(memoryEmbedderFingerprint(embedder))
    expect(memoryVectorIndexFingerprint(secretBearingIndex)).toBe(memoryVectorIndexFingerprint(vectorIndex))

    const identity = { generationId: 'generation.one', recordId: 'record.one', revisionId: 'revision.one' }
    expect(memoryVectorIdentityId(identity)).toBe(memoryVectorIdentityId(identity))
    expect(memoryProjectionWorkId('upsert', identity)).toBe(memoryProjectionWorkId('upsert', identity))
    const serialized = JSON.stringify({
      embedder: validateMemoryEmbedderIdentity(secretBearingEmbedder),
      vectorIndex: validateMemoryVectorIndexIdentity(secretBearingIndex),
    })
    expect(serialized).not.toContain('model-secret')
    expect(serialized).not.toContain('backend-secret')
    expect(serialized).not.toContain('postgres://')
    expect(serialized).not.toContain('cuda')
  })
})
