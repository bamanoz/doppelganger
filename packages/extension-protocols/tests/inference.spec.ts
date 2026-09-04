import { Context, type Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  STRUCTURED_INFERENCE_SERVICE,
  StructuredInferenceError,
  createStructuredInference,
  type StructuredInference,
  type StructuredInferenceProvider,
  type StructuredInferenceRequest,
  type StructuredInferenceResult,
} from '../src/index.ts'

const outputSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['answer', 'confidence'],
  additionalProperties: false,
} as const

function request(overrides: Partial<StructuredInferenceRequest> = {}): StructuredInferenceRequest {
  return {
    purpose: 'tests.structured-output',
    system: 'Return one structured result.',
    input: 'Untrusted input material.',
    outputSchema,
    ...overrides,
  }
}

function service(provider: StructuredInferenceProvider['infer']): StructuredInference {
  return createStructuredInference({ infer: provider })
}

async function expectError(
  promise: Promise<unknown>,
  code: StructuredInferenceError['code'],
): Promise<StructuredInferenceError> {
  try {
    await promise
  } catch (cause) {
    expect(cause).toBeInstanceOf(StructuredInferenceError)
    expect((cause as StructuredInferenceError).code).toBe(code)
    return cause as StructuredInferenceError
  }
  throw new Error(`expected ${code}`)
}

describe('structured inference protocol', () => {
  it('validates and freezes one structured request and result', async () => {
    const infer = vi.fn(async (received: StructuredInferenceRequest): Promise<StructuredInferenceResult> => {
      expect(received).toEqual(request({ purpose: 'tests.structured-output' }))
      expect(Object.isFrozen(received)).toBe(true)
      expect(Object.isFrozen(received.outputSchema)).toBe(true)
      expect(Object.isFrozen(received.outputSchema.properties)).toBe(true)
      return {
        value: { answer: 'accepted', confidence: 0.9 },
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      }
    })
    const inference = service(infer)

    const result = await inference.infer(request({ purpose: ' tests.structured-output ' }))

    expect(infer).toHaveBeenCalledOnce()
    expect(result).toEqual({
      value: { answer: 'accepted', confidence: 0.9 },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    })
    expect(Object.isFrozen(inference)).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.usage)).toBe(true)
  })

  it.each([
    ['non-object request', null],
    ['unknown request field', { ...request(), provider: 'forbidden' }],
    ['missing purpose', { system: 'x', input: 'x', outputSchema }],
    ['invalid purpose', request({ purpose: 'Provider Choice' })],
    ['empty system', request({ system: ' ' })],
    ['invalid token limit', request({ maxOutputTokens: 0 })],
    ['non-signal cancellation', request({ signal: {} as AbortSignal })],
  ])('rejects malformed requests before provider dispatch: %s', async (_name, candidate) => {
    const infer = vi.fn<StructuredInferenceProvider['infer']>()
    const error = await expectError(service(infer).infer(candidate as StructuredInferenceRequest), 'INVALID_REQUEST')

    expect(error.message.length).toBeLessThanOrEqual(1_024)
    expect(infer).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown keyword', { type: 'object', unevaluatedProperties: false }],
    ['remote reference', { $ref: 'https://example.invalid/schema.json' }],
    ['unsupported union form', { oneOf: [{ type: 'string' }, { type: 'number' }] }],
    ['invalid regular expression', { type: 'string', pattern: '[' }],
  ])('rejects unsupported output schemas before provider dispatch: %s', async (_name, schema) => {
    const infer = vi.fn<StructuredInferenceProvider['infer']>()
    const error = await expectError(service(infer).infer(request({
      outputSchema: schema as StructuredInferenceRequest['outputSchema'],
    })), 'INVALID_REQUEST')

    expect(error.message).toMatch(/schema|supported|pattern|reference/i)
    expect(infer).not.toHaveBeenCalled()
  })

  it('rejects pathological schema depth and size before provider dispatch', async () => {
    let deep: Record<string, unknown> = { type: 'string' }
    for (let index = 0; index < 30; index += 1) deep = { type: 'array', items: deep }
    const infer = vi.fn<StructuredInferenceProvider['infer']>()

    await expectError(service(infer).infer(request({
      outputSchema: deep as StructuredInferenceRequest['outputSchema'],
    })), 'INVALID_REQUEST')
    await expectError(service(infer).infer(request({
      outputSchema: {
        type: 'string',
        description: 'x'.repeat(70_000),
      },
    })), 'INVALID_REQUEST')
    expect(infer).not.toHaveBeenCalled()
  })

  it('rejects invalid, non-JSON, oversized, and missing provider output', async () => {
    await expectError(service(async () => ({
      value: { answer: 'missing confidence' },
    })).infer(request()), 'INVALID_OUTPUT')
    await expectError(service(async () => ({
      value: { answer: 'invalid', confidence: Number.NaN },
    })).infer(request()), 'INVALID_OUTPUT')
    await expectError(service(async () => ({
      value: { answer: 'x'.repeat(1024 * 1024), confidence: 1 },
    })).infer(request()), 'INVALID_OUTPUT')
    await expectError(service(async () => ({} as StructuredInferenceResult)).infer(request()), 'MISSING_OUTPUT')
  })

  it('honors pre-dispatch cancellation and preserves bounded shared errors', async () => {
    const controller = new AbortController()
    controller.abort()
    const infer = vi.fn<StructuredInferenceProvider['infer']>()

    await expectError(service(infer).infer(request({ signal: controller.signal })), 'ABORTED')
    expect(infer).not.toHaveBeenCalled()

    const unavailable = await expectError(service(async () => {
      throw new StructuredInferenceError('UNAVAILABLE', 'x'.repeat(10_000))
    }).infer(request()), 'UNAVAILABLE')
    expect(unavailable.message.length).toBeLessThanOrEqual(1_024)

    const hidden = await expectError(service(async () => {
      throw new Error('secret provider payload')
    }).infer(request()), 'PROVIDER_FAILURE')
    expect(hidden.message).not.toContain('secret provider payload')
  })

  it('accepts provider substitution and rejects duplicate providers in one realm', async () => {
    const first = service(async () => ({ value: { answer: 'first', confidence: 1 } }))
    const second = service(async () => ({ value: { answer: 'second', confidence: 1 } }))
    expect(await first.infer(request())).toMatchObject({ value: { answer: 'first' } })
    expect(await second.infer(request())).toMatchObject({ value: { answer: 'second' } })

    const root = new Context()
    const provider = (name: string, inference: StructuredInference): Plugin => ({
      name,
      apply(ctx) {
        ctx.provide(STRUCTURED_INFERENCE_SERVICE, inference)
      },
    })
    const firstFiber = root.plugin(provider('first-inference-provider', first))
    await firstFiber
    await expect(root.plugin(provider('duplicate-inference-provider', second))).rejects.toThrow()
    expect(root.doppelgangerInference).toBe(first)
    await firstFiber.dispose()
  })

  it('remains absent when no inference provider is composed', () => {
    const root = new Context()

    expect(root.get(STRUCTURED_INFERENCE_SERVICE)).toBeUndefined()
  })
})
