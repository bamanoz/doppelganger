import type { Context, Plugin } from '@deepseek-ai/cordis'
const MEMORY_EMBEDDER_SERVICE = 'doppelgangerMemoryEmbedder'
const artifactDigest = `sha256:${'d'.repeat(64)}`

function vector(text: string): Float32Array {
  const normalized = text.toLocaleLowerCase('en-US')
  if (/transport|framing|envelope|rpc|communication|message/u.test(normalized)) {
    return new Float32Array([1, 0, 0])
  }
  if (/database|storage|sqlite|persist/u.test(normalized)) {
    return new Float32Array([0, 1, 0])
  }
  return new Float32Array([0, 0, 1])
}
const embedder = Object.freeze({
  identity: Object.freeze({
    provider: 'doppelganger-test',
    modelId: 'deterministic-semantic-fixture',
    revision: '1',
    artifactDigest,
    pooling: 'fixture-keywords',
    projection: 'none',
    dimensions: 3,
    normalized: true,
    distanceMetric: 'cosine',
  }),
  async embedDocuments(texts: readonly string[]) {
    return Object.freeze(texts.map(vector))
  },
  async embedQuery(text: string) {
    if (text.includes('FAIL_SEMANTIC')) throw new Error('deterministic semantic fixture failure')
    return vector(text)
  },
})

const DeterministicEmbedderPlugin: Plugin = {
  name: 'doppelganger-test-deterministic-embedder',
  provide: MEMORY_EMBEDDER_SERVICE,
  apply(ctx: Context) {
    ctx.provide(MEMORY_EMBEDDER_SERVICE, embedder)
  },
}

export default DeterministicEmbedderPlugin
