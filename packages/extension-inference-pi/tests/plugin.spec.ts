import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context as PiContext,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import {
  StructuredInferenceError,
  createStructuredInference,
  type StructuredInferenceRequest,
} from '@doppelganger/doppelganger-protocols'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PiStructuredInferenceProvider,
  normalizePiInferencePluginConfig,
} from '../src/index.ts'

const schema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    score: { type: 'integer', minimum: 0 },
  },
  required: ['title', 'score'],
  additionalProperties: false,
} as const

const environmentKeys = new Set<string>()

afterEach(() => {
  for (const key of environmentKeys) delete process.env[key]
  environmentKeys.clear()
  vi.restoreAllMocks()
})

function request(overrides: Partial<StructuredInferenceRequest> = {}): StructuredInferenceRequest {
  return {
    purpose: 'tests.pi-structured-output',
    system: 'Return one structured result.',
    input: 'Untrusted work material.',
    outputSchema: schema,
    ...overrides,
  }
}

function setup(overrides: Parameters<typeof normalizePiInferencePluginConfig>[0] = {}) {
  const faux = fauxProvider({
    provider: 'test-provider',
    models: [{ id: 'test-model', reasoning: true }],
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const config = normalizePiInferencePluginConfig({
    provider: 'test-provider',
    model: 'test-model',
    ...overrides as Record<string, unknown>,
  })
  const provider = new PiStructuredInferenceProvider(config, models)
  return { faux, models, provider, inference: createStructuredInference(provider) }
}

async function expectCode(promise: Promise<unknown>, code: StructuredInferenceError['code']): Promise<StructuredInferenceError> {
  try {
    await promise
  } catch (cause) {
    expect(cause).toBeInstanceOf(StructuredInferenceError)
    expect((cause as StructuredInferenceError).code).toBe(code)
    return cause as StructuredInferenceError
  }
  throw new Error(`expected ${code}`)
}

describe('Pi inference configuration', () => {
  it('applies documented safe defaults and rejects unknown or invalid values', () => {
    expect(normalizePiInferencePluginConfig({ provider: 'openai', model: 'gpt-5' })).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      requestTimeoutMs: 120_000,
      maximumInputCharacters: 64_000,
      maximumOutputTokens: 2_048,
      maximumResponseCharacters: 100_000,
    })
    expect(() => normalizePiInferencePluginConfig({ provider: 'openai', model: 'gpt-5', extra: true }))
      .toThrow('unsupported fields')
    expect(() => normalizePiInferencePluginConfig({ provider: '', model: 'gpt-5' })).toThrow('provider')
    expect(() => normalizePiInferencePluginConfig({ provider: 'openai', model: 'gpt-5', apiKeyEnv: 'not valid' }))
      .toThrow('apiKeyEnv')
    expect(() => normalizePiInferencePluginConfig({ provider: 'openai', model: 'gpt-5', reasoning: 'extreme' }))
      .toThrow('reasoning')
    expect(() => normalizePiInferencePluginConfig({ provider: 'openai', model: 'gpt-5', requestTimeoutMs: 0 }))
      .toThrow('requestTimeoutMs')
    expect(() => normalizePiInferencePluginConfig({ provider: 'openai', model: 'gpt-5', maximumOutputTokens: 65_537 }))
      .toThrow('maximumOutputTokens')
  })

  it('builds an explicit OpenAI-compatible provider snapshot without exposing credentials', () => {
    const config = normalizePiInferencePluginConfig({
      provider: 'custom-proxy',
      model: 'custom-model',
      baseUrl: 'https://proxy.example.test/v1',
      modelContextWindow: 272_000,
      apiKeyEnv: 'CUSTOM_PROXY_API_KEY',
      reasoning: 'high',
    })
    expect(config).toMatchObject({
      provider: 'custom-proxy',
      model: 'custom-model',
      baseUrl: 'https://proxy.example.test/v1',
      modelContextWindow: 272_000,
      apiKeyEnv: 'CUSTOM_PROXY_API_KEY',
      reasoning: 'high',
    })
    expect(() => new PiStructuredInferenceProvider(config)).not.toThrow()
    expect(() => normalizePiInferencePluginConfig({
      provider: 'custom-proxy', model: 'custom-model', baseUrl: 'relative/path', modelContextWindow: 1,
    })).toThrow('baseUrl')
    expect(() => normalizePiInferencePluginConfig({
      provider: 'custom-proxy', model: 'custom-model', baseUrl: 'https://proxy.example.test/v1',
    })).toThrow('configured together')
    expect(() => normalizePiInferencePluginConfig({
      provider: 'custom-proxy', model: 'custom-model', modelContextWindow: 272_000,
    })).toThrow('configured together')
  })

  it('fails activation for unknown provider routes and models', () => {
    const faux = fauxProvider({ provider: 'known', models: [{ id: 'known-model' }] })
    const models = createModels()
    models.setProvider(faux.provider)

    expect(() => new PiStructuredInferenceProvider(normalizePiInferencePluginConfig({
      provider: 'missing', model: 'known-model',
    }), models)).toThrow('provider')
    expect(() => new PiStructuredInferenceProvider(normalizePiInferencePluginConfig({
      provider: 'known', model: 'missing',
    }), models)).toThrow('model')
  })
})

describe('Pi structured inference provider', () => {
  it('uses the Pi faux provider to return one schema-valid structured value and bounded usage', async () => {
    const { faux, inference } = setup({
      reasoning: 'medium',
      requestTimeoutMs: 5_000,
      maximumOutputTokens: 100,
    })
    faux.setResponses([(
      context: PiContext,
      options: SimpleStreamOptions | undefined,
    ) => {
      expect(context.systemPrompt).toBe('Return one structured result.')
      expect(context.messages).toHaveLength(1)
      expect(context.messages[0]).toMatchObject({ role: 'user', content: 'Untrusted work material.' })
      expect(context.tools).toEqual([expect.objectContaining({
        name: 'return_result',
        parameters: schema,
        constrainedSampling: { type: 'json_schema', strict: 'prefer' },
      })])
      expect(options).toMatchObject({
        reasoning: 'medium',
        timeoutMs: 5_000,
        maxTokens: 50,
        maxRetries: 0,
      })
      return fauxAssistantMessage(
        fauxToolCall('return_result', { title: 'accepted', score: 7 }),
        { stopReason: 'toolUse' },
      )
    }])

    const result = await inference.infer(request({ maxOutputTokens: 50 }))

    expect(result.value).toEqual({ title: 'accepted', score: 7 })
    expect(result.usage?.inputTokens).toBeGreaterThan(0)
    expect(result.usage?.outputTokens).toBeGreaterThan(0)
    expect(result.usage?.totalTokens).toBeGreaterThan(0)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(faux.state.callCount).toBe(1)
  })

  it('rejects missing, conflicting, invalid, oversized, error, and aborted SDK outcomes', async () => {
    const { faux, inference } = setup({ maximumResponseCharacters: 500 })
    faux.setResponses([
      fauxAssistantMessage('no structured call'),
      fauxAssistantMessage([
        fauxToolCall('return_result', { title: 'one', score: 1 }),
        fauxToolCall('return_result', { title: 'two', score: 2 }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('return_result', { title: 'missing score' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('return_result', { title: 'x'.repeat(1_000), score: 1 }), { stopReason: 'toolUse' }),
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'private provider payload' }),
      fauxAssistantMessage([], { stopReason: 'aborted', errorMessage: 'private abort payload' }),
    ])

    await expectCode(inference.infer(request()), 'MISSING_OUTPUT')
    await expectCode(inference.infer(request()), 'INVALID_OUTPUT')
    await expectCode(inference.infer(request()), 'INVALID_OUTPUT')
    await expectCode(inference.infer(request()), 'INVALID_OUTPUT')
    const providerFailure = await expectCode(inference.infer(request()), 'PROVIDER_FAILURE')
    expect(providerFailure.message).not.toContain('private provider payload')
    const aborted = await expectCode(inference.infer(request()), 'ABORTED')
    expect(aborted.message).not.toContain('private abort payload')
  })

  it('resolves a configured credential per call and fails without ambient fallback', async () => {
    const key = 'DOPPELGANGER_TEST_PI_KEY'
    environmentKeys.add(key)
    const { faux, inference } = setup({ apiKeyEnv: key })
    faux.setResponses([(_context, options) => {
      expect(options?.apiKey).toBe('first-secret')
      return fauxAssistantMessage(fauxToolCall('return_result', { title: 'first', score: 1 }), { stopReason: 'toolUse' })
    }, (_context, options) => {
      expect(options?.apiKey).toBe('second-secret')
      return fauxAssistantMessage(fauxToolCall('return_result', { title: 'second', score: 2 }), { stopReason: 'toolUse' })
    }])

    await expectCode(inference.infer(request()), 'AUTH')
    expect(faux.state.callCount).toBe(0)
    process.env[key] = ' first-secret '
    expect(await inference.infer(request())).toMatchObject({ value: { title: 'first' } })
    process.env[key] = 'second-secret'
    expect(await inference.infer(request())).toMatchObject({ value: { title: 'second' } })
    delete process.env[key]
    await expectCode(inference.infer(request()), 'AUTH')
    expect(faux.state.callCount).toBe(2)
  })

  it('uses provider-owned ambient auth only when no credential reference is configured', async () => {
    const { faux, inference } = setup()
    faux.setResponses([(_context, options) => {
      expect(options?.apiKey).toBeUndefined()
      return fauxAssistantMessage(fauxToolCall('return_result', { title: 'ambient', score: 1 }), { stopReason: 'toolUse' })
    }])

    expect(await inference.infer(request())).toMatchObject({ value: { title: 'ambient' } })
  })

  it('times out, honors caller abort, disables SDK retries, and disposes without waiting for the SDK', async () => {
    const timeoutSetup = setup({ requestTimeoutMs: 5 })
    timeoutSetup.faux.setResponses([() => new Promise(() => undefined)])
    await expectCode(timeoutSetup.inference.infer(request()), 'TIMEOUT')
    expect(timeoutSetup.faux.state.callCount).toBe(1)

    const abortSetup = setup({ requestTimeoutMs: 5_000 })
    abortSetup.faux.setResponses([(_context, options) => {
      expect(options?.maxRetries).toBe(0)
      return new Promise(() => undefined)
    }])
    const controller = new AbortController()
    const aborted = abortSetup.inference.infer(request({ signal: controller.signal }))
    controller.abort()
    await expectCode(aborted, 'ABORTED')

    const disposeSetup = setup({ requestTimeoutMs: 5_000 })
    disposeSetup.faux.setResponses([() => new Promise(() => undefined)])
    const disposed = disposeSetup.inference.infer(request())
    await vi.waitFor(() => expect(disposeSetup.faux.state.callCount).toBe(1))
    disposeSetup.provider.close()
    await expectCode(disposed, 'UNAVAILABLE')
    await expectCode(disposeSetup.inference.infer(request()), 'UNAVAILABLE')
  })

  it('retains immutable provider generations across replacement', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const first = setup({ maximumOutputTokens: 11 })
    first.faux.setResponses([async (_context, options) => {
      expect(options?.maxTokens).toBe(11)
      await firstGate
      return fauxAssistantMessage(fauxToolCall('return_result', { title: 'old', score: 1 }), { stopReason: 'toolUse' })
    }])
    const second = setup({ maximumOutputTokens: 22 })
    second.faux.setResponses([(_context, options) => {
      expect(options?.maxTokens).toBe(22)
      return fauxAssistantMessage(fauxToolCall('return_result', { title: 'new', score: 2 }), { stopReason: 'toolUse' })
    }])

    const oldCall = first.inference.infer(request())
    await vi.waitFor(() => expect(first.faux.state.callCount).toBe(1))
    expect(await second.inference.infer(request())).toMatchObject({ value: { title: 'new' } })
    releaseFirst?.()
    expect(await oldCall).toMatchObject({ value: { title: 'old' } })
  })

  it('enforces the configured input limit before SDK dispatch', async () => {
    const { faux, inference } = setup({ maximumInputCharacters: 4 })

    await expectCode(inference.infer(request({ input: '12345' })), 'INVALID_REQUEST')
    expect(faux.state.callCount).toBe(0)
  })
})
