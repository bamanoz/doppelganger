import {
  StructuredInferenceError,
  type JsonValue,
  type StructuredInferenceProvider,
  type StructuredInferenceRequest,
  type StructuredInferenceResult,
} from '@doppelganger/doppelganger-protocols'
import {
  createModels,
  createProvider,
  type Api,
  type AssistantMessage,
  type Context as PiContext,
  type Model,
  type Models,
  type SimpleStreamOptions,
  type TSchema,
  type ThinkingLevel,
  type Tool,
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { NormalizedPiInferencePluginConfig } from './config.ts'

const RESULT_TOOL_NAME = 'return_result'
const RESULT_TOOL_DESCRIPTION = 'Return the structured result matching the required JSON Schema.'

interface ActiveCall {
  readonly controller: AbortController
  readonly reject: (cause: StructuredInferenceError) => void
}

function responseCharacters(message: AssistantMessage): number {
  try {
    return JSON.stringify(message).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function providerFailureCode(cause: unknown): 'AUTH' | 'PROVIDER_FAILURE' {
  if (cause !== null && typeof cause === 'object' && 'code' in cause && (cause as { code?: unknown }).code === 'auth') {
    return 'AUTH'
  }
  return 'PROVIDER_FAILURE'
}

function resultTool(outputSchema: StructuredInferenceRequest['outputSchema']): Tool {
  return Object.freeze({
    name: RESULT_TOOL_NAME,
    description: RESULT_TOOL_DESCRIPTION,
    parameters: outputSchema as TSchema,
    constrainedSampling: Object.freeze({ type: 'json_schema' as const, strict: 'prefer' as const }),
  })
}

function normalizeResult(message: AssistantMessage, maximumResponseCharacters: number): StructuredInferenceResult {
  if (responseCharacters(message) > maximumResponseCharacters) {
    throw new StructuredInferenceError('INVALID_OUTPUT', 'Pi structured inference response exceeded the configured character limit')
  }
  if (message.stopReason === 'aborted') {
    throw new StructuredInferenceError('ABORTED', 'Pi structured inference request was aborted')
  }
  if (message.stopReason === 'error') {
    throw new StructuredInferenceError('PROVIDER_FAILURE', 'Pi structured inference provider failed')
  }
  const toolCalls = message.content.filter(block => block.type === 'toolCall')
  const matching = toolCalls.filter(call => call.name === RESULT_TOOL_NAME)
  if (matching.length === 0) {
    throw new StructuredInferenceError('MISSING_OUTPUT', 'Pi structured inference returned no result call')
  }
  if (matching.length !== 1 || toolCalls.length !== 1) {
    throw new StructuredInferenceError('INVALID_OUTPUT', 'Pi structured inference returned conflicting result calls')
  }
  const value = matching[0]!.arguments as JsonValue
  return {
    value,
    usage: {
      inputTokens: message.usage.input + message.usage.cacheRead,
      outputTokens: message.usage.output,
      totalTokens: message.usage.totalTokens,
    },
  }
}

function configuredModels(config: NormalizedPiInferencePluginConfig): Models {
  if (config.baseUrl === undefined || config.modelContextWindow === undefined) return builtinModels()
  const model: Model<'openai-completions'> = {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: config.provider,
    baseUrl: config.baseUrl,
    reasoning: config.reasoning !== undefined,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.modelContextWindow,
    maxTokens: config.maximumOutputTokens,
  }
  const models = createModels()
  models.setProvider(createProvider({
    id: config.provider,
    name: config.provider,
    baseUrl: config.baseUrl,
    auth: { apiKey: { name: config.provider, resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: openAICompletionsApi(),
  }))
  return models
}

export class PiStructuredInferenceProvider implements StructuredInferenceProvider {
  readonly #config: NormalizedPiInferencePluginConfig
  readonly #models: Models
  readonly #model: Model<Api>
  readonly #active = new Set<ActiveCall>()
  #closed = false

  constructor(config: NormalizedPiInferencePluginConfig, models: Models = configuredModels(config)) {
    const provider = models.getProvider(config.provider)
    if (provider === undefined) throw new TypeError(`Pi inference provider ${JSON.stringify(config.provider)} is not installed`)
    const model = models.getModel(config.provider, config.model)
    if (model === undefined) {
      throw new TypeError(`Pi inference model ${JSON.stringify(config.provider)}/${JSON.stringify(config.model)} is not installed`)
    }
    this.#config = Object.freeze({ ...config })
    this.#models = models
    this.#model = Object.freeze(structuredClone(model)) as Model<Api>
  }

  async infer(request: StructuredInferenceRequest): Promise<StructuredInferenceResult> {
    if (this.#closed) throw new StructuredInferenceError('UNAVAILABLE', 'Pi structured inference provider is closed')
    if (request.input.length > this.#config.maximumInputCharacters) {
      throw new StructuredInferenceError(
        'INVALID_REQUEST',
        `Pi structured inference input exceeds ${this.#config.maximumInputCharacters} characters`,
      )
    }

    const apiKey = this.#resolveApiKey()
    const controller = new AbortController()
    let timedOut = false
    let rejectCancellation: ((cause: StructuredInferenceError) => void) | undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject
    })
    const active: ActiveCall = {
      controller,
      reject: cause => rejectCancellation?.(cause),
    }
    this.#active.add(active)

    const abortFromCaller = (): void => {
      controller.abort()
      active.reject(new StructuredInferenceError('ABORTED', 'Pi structured inference request was aborted'))
    }
    request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    if (request.signal?.aborted === true) abortFromCaller()
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      active.reject(new StructuredInferenceError('TIMEOUT', 'Pi structured inference request timed out'))
    }, this.#config.requestTimeoutMs)

    const context = Object.freeze({
      systemPrompt: request.system,
      messages: Object.freeze([Object.freeze({
        role: 'user' as const,
        content: request.input,
        timestamp: Date.now(),
      })]),
      tools: Object.freeze([resultTool(request.outputSchema)]),
    }) as unknown as PiContext
    const configuredMaximum = this.#config.maximumOutputTokens
    const maxTokens = Math.min(request.maxOutputTokens ?? configuredMaximum, configuredMaximum)
    const options: SimpleStreamOptions = {
      signal: controller.signal,
      maxTokens,
      timeoutMs: this.#config.requestTimeoutMs,
      maxRetries: 0,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(this.#config.reasoning === undefined ? {} : { reasoning: this.#config.reasoning as ThinkingLevel }),
    }

    const completion = this.#models.completeSimple(this.#model, context, options)
    try {
      const message = await Promise.race([completion, cancellation])
      if (timedOut) throw new StructuredInferenceError('TIMEOUT', 'Pi structured inference request timed out')
      if (request.signal?.aborted === true) {
        throw new StructuredInferenceError('ABORTED', 'Pi structured inference request was aborted')
      }
      return normalizeResult(message, this.#config.maximumResponseCharacters)
    } catch (cause) {
      if (cause instanceof StructuredInferenceError) throw cause
      throw new StructuredInferenceError(providerFailureCode(cause), 'Pi structured inference provider failed')
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abortFromCaller)
      this.#active.delete(active)
      void completion.catch(() => undefined)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const active of this.#active) {
      active.controller.abort()
      active.reject(new StructuredInferenceError('UNAVAILABLE', 'Pi structured inference provider was disposed'))
    }
    this.#active.clear()
  }

  #resolveApiKey(): string | undefined {
    if (this.#config.apiKeyEnv === undefined) return undefined
    const value = process.env[this.#config.apiKeyEnv]?.trim()
    if (value === undefined || value.length === 0) {
      throw new StructuredInferenceError(
        'AUTH',
        `Pi structured inference credential environment variable ${this.#config.apiKeyEnv} is missing`,
      )
    }
    return value
  }
}
