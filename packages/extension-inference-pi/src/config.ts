export type PiReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface PiInferencePluginConfig {
  readonly provider: string
  readonly model: string
  readonly baseUrl?: string
  readonly modelContextWindow?: number
  readonly apiKeyEnv?: string
  readonly reasoning?: PiReasoningLevel
  readonly requestTimeoutMs?: number
  readonly maximumInputCharacters?: number
  readonly maximumOutputTokens?: number
  readonly maximumResponseCharacters?: number
}

export interface NormalizedPiInferencePluginConfig {
  readonly provider: string
  readonly model: string
  readonly baseUrl?: string
  readonly modelContextWindow?: number
  readonly apiKeyEnv?: string
  readonly reasoning?: PiReasoningLevel
  readonly requestTimeoutMs: number
  readonly maximumInputCharacters: number
  readonly maximumOutputTokens: number
  readonly maximumResponseCharacters: number
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAXIMUM_BASE_URL_CHARACTERS = 2_048
const MAXIMUM_CONTEXT_WINDOW = 10_000_000
const MAXIMUM_IDENTIFIER_CHARACTERS = 256
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const MAXIMUM_REQUEST_TIMEOUT_MS = 600_000
const DEFAULT_MAXIMUM_INPUT_CHARACTERS = 64_000
const MAXIMUM_INPUT_CHARACTERS = 1_000_000
const DEFAULT_MAXIMUM_OUTPUT_TOKENS = 2_048
const MAXIMUM_OUTPUT_TOKENS = 65_536
const DEFAULT_MAXIMUM_RESPONSE_CHARACTERS = 100_000
const MAXIMUM_RESPONSE_CHARACTERS = 2_000_000
const REASONING_LEVELS = new Set<PiReasoningLevel>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function record(value: unknown, label: string, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${label} must be an object`)
  const input = value as Readonly<Record<string, unknown>>
  const unsupported = Object.keys(input).filter(key => !allowed.includes(key)).sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  return input
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAXIMUM_IDENTIFIER_CHARACTERS) {
    throw new TypeError(`${label} must contain 1-${MAXIMUM_IDENTIFIER_CHARACTERS} characters`)
  }
  const normalized = value.trim()
  if (!IDENTIFIER.test(normalized)) throw new TypeError(`${label} contains unsupported characters`)
  return normalized
}

function boundedInteger(value: unknown, label: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}`)
  }
  return value as number
}

function baseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAXIMUM_BASE_URL_CHARACTERS) {
    throw new TypeError(`Pi inference baseUrl must contain 1-${MAXIMUM_BASE_URL_CHARACTERS} characters`)
  }
  const normalized = value.trim()
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new TypeError('Pi inference baseUrl must be an absolute HTTP(S) URL')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('Pi inference baseUrl must be an absolute HTTP(S) URL without credentials')
  }
  return normalized
}

export function normalizePiInferencePluginConfig(value: unknown): NormalizedPiInferencePluginConfig {
  const input = record(value, 'Pi inference configuration', [
    'provider',
    'model',
    'apiKeyEnv',
    'baseUrl',
    'modelContextWindow',
    'reasoning',
    'requestTimeoutMs',
    'maximumInputCharacters',
    'maximumOutputTokens',
    'maximumResponseCharacters',
  ])
  const provider = identifier(input.provider, 'Pi inference provider')
  const model = identifier(input.model, 'Pi inference model')
  let apiKeyEnv: string | undefined
  if (input.apiKeyEnv !== undefined) {
    apiKeyEnv = identifier(input.apiKeyEnv, 'Pi inference apiKeyEnv')
    if (!ENVIRONMENT_NAME.test(apiKeyEnv)) throw new TypeError('Pi inference apiKeyEnv must be an environment variable name')
  }
  const configuredBaseUrl = baseUrl(input.baseUrl)
  let modelContextWindow: number | undefined
  if (input.modelContextWindow !== undefined) {
    modelContextWindow = boundedInteger(
      input.modelContextWindow,
      'Pi inference modelContextWindow',
      1,
      MAXIMUM_CONTEXT_WINDOW,
    )
  }
  if ((configuredBaseUrl === undefined) !== (modelContextWindow === undefined)) {
    throw new TypeError('Pi inference baseUrl and modelContextWindow must be configured together')
  }
  let reasoning: PiReasoningLevel | undefined
  if (input.reasoning !== undefined) {
    if (typeof input.reasoning !== 'string' || !REASONING_LEVELS.has(input.reasoning as PiReasoningLevel)) {
      throw new TypeError('Pi inference reasoning must be minimal, low, medium, high, xhigh, or max')
    }
    reasoning = input.reasoning as PiReasoningLevel
  }
  return Object.freeze({
    provider,
    model,
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(configuredBaseUrl === undefined ? {} : { baseUrl: configuredBaseUrl, modelContextWindow: modelContextWindow! }),
    ...(reasoning === undefined ? {} : { reasoning }),
    requestTimeoutMs: boundedInteger(
      input.requestTimeoutMs,
      'Pi inference requestTimeoutMs',
      DEFAULT_REQUEST_TIMEOUT_MS,
      MAXIMUM_REQUEST_TIMEOUT_MS,
    ),
    maximumInputCharacters: boundedInteger(
      input.maximumInputCharacters,
      'Pi inference maximumInputCharacters',
      DEFAULT_MAXIMUM_INPUT_CHARACTERS,
      MAXIMUM_INPUT_CHARACTERS,
    ),
    maximumOutputTokens: boundedInteger(
      input.maximumOutputTokens,
      'Pi inference maximumOutputTokens',
      DEFAULT_MAXIMUM_OUTPUT_TOKENS,
      MAXIMUM_OUTPUT_TOKENS,
    ),
    maximumResponseCharacters: boundedInteger(
      input.maximumResponseCharacters,
      'Pi inference maximumResponseCharacters',
      DEFAULT_MAXIMUM_RESPONSE_CHARACTERS,
      MAXIMUM_RESPONSE_CHARACTERS,
    ),
  })
}

export const PiInferencePluginConfigSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1 as const,
    vendor: 'doppelganger',
    validate(value: unknown) {
      try {
        return { value: normalizePiInferencePluginConfig(value) }
      } catch (cause) {
        return { issues: [{ message: cause instanceof Error ? cause.message : String(cause) }] }
      }
    },
  }),
})
