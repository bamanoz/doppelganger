import { Ajv, type AnySchema, type ValidateFunction } from 'ajv'
import type { JsonValue } from './tools.ts'

export const STRUCTURED_INFERENCE_SERVICE = 'doppelgangerInference' as const

export type StructuredInferenceErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAVAILABLE'
  | 'AUTH'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'PROVIDER_FAILURE'
  | 'MISSING_OUTPUT'
  | 'INVALID_OUTPUT'

export interface StructuredInferenceUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
}

export interface StructuredInferenceRequest {
  readonly purpose: string
  readonly system: string
  readonly input: string
  readonly outputSchema: Readonly<Record<string, JsonValue>>
  readonly maxOutputTokens?: number
  readonly signal?: AbortSignal
}

export interface StructuredInferenceResult {
  readonly value: JsonValue
  readonly usage?: StructuredInferenceUsage
}

export interface StructuredInferenceProvider {
  infer(request: StructuredInferenceRequest): Promise<StructuredInferenceResult>
}

export interface StructuredInference {
  infer(request: StructuredInferenceRequest): Promise<StructuredInferenceResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerInference: StructuredInference
  }
}

const PURPOSE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const MAX_PURPOSE_CHARACTERS = 128
const MAX_SYSTEM_CHARACTERS = 64_000
const MAX_INPUT_CHARACTERS = 256_000
const MAX_OUTPUT_TOKENS = 1_000_000
const MAX_SCHEMA_BYTES = 64 * 1024
const MAX_SCHEMA_DEPTH = 24
const MAX_SCHEMA_NODES = 512
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_OUTPUT_DEPTH = 64
const MAX_ERROR_MESSAGE_CHARACTERS = 1_024
const MAX_PATTERN_CHARACTERS = 1_024

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$comment', '$defs', '$id', '$ref', '$schema',
  'additionalProperties', 'allOf', 'anyOf', 'const', 'default', 'definitions',
  'deprecated', 'description', 'enum', 'examples', 'exclusiveMaximum',
  'exclusiveMinimum', 'format', 'items', 'maximum', 'maxItems', 'maxLength',
  'minimum', 'minItems', 'minLength', 'multipleOf', 'not', 'prefixItems',
  'properties', 'readOnly', 'required', 'title', 'type', 'writeOnly',
])
const SUPPORTED_SCHEMA_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'])
const SUPPORTED_STRING_FORMATS = new Set([
  'date', 'date-time', 'email', 'ipv4', 'ipv6', 'regex', 'uri', 'url', 'uuid',
])
const ERROR_CODES = new Set<StructuredInferenceErrorCode>([
  'INVALID_REQUEST',
  'UNAVAILABLE',
  'AUTH',
  'TIMEOUT',
  'ABORTED',
  'PROVIDER_FAILURE',
  'MISSING_OUTPUT',
  'INVALID_OUTPUT',
])

const schemaValidator = new Ajv({ strict: false, allErrors: true, validateFormats: false })

export class StructuredInferenceError extends Error {
  readonly code: StructuredInferenceErrorCode

  constructor(code: StructuredInferenceErrorCode, message: string) {
    super(boundedErrorMessage(message, code))
    this.name = 'StructuredInferenceError'
    this.code = code
  }
}

function boundedErrorMessage(message: string, code: StructuredInferenceErrorCode): string {
  const normalized = typeof message === 'string' ? message.trim() : ''
  if (normalized.length === 0) return `Structured inference failed with ${code}`
  return normalized.length <= MAX_ERROR_MESSAGE_CHARACTERS
    ? normalized
    : `${normalized.slice(0, MAX_ERROR_MESSAGE_CHARACTERS - 1)}…`
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const unsupported = Object.keys(value).filter(key => !allowed.has(key))
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  const missing = required.filter(key => !(key in value))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

function boundedString(value: unknown, label: string, maximum: number, nonEmpty = true): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  if (nonEmpty && value.trim().length === 0) throw new TypeError(`${label} must be non-empty`)
  if (value.length > maximum) throw new TypeError(`${label} must contain at most ${maximum} characters`)
  return value
}

function positiveSafeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}`)
  }
  return value as number
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value as number
}

function finiteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`)
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return value !== null
    && typeof value === 'object'
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
    && typeof (value as AbortSignal).removeEventListener === 'function'
}

function validateJsonValue(
  value: unknown,
  label: string,
  maximumDepth: number,
  seen = new WeakSet<object>(),
  depth = 0,
): asserts value is JsonValue {
  if (depth > maximumDepth) throw new TypeError(`${label} exceeds maximum depth ${maximumDepth}`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be JSON-compatible`)
  if (seen.has(value)) throw new TypeError(`${label} must not contain cycles`)
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateJsonValue(child, `${label}[${index}]`, maximumDepth, seen, depth + 1))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must contain only JSON objects`)
    for (const [key, child] of Object.entries(value)) {
      validateJsonValue(child, `${label}.${key}`, maximumDepth, seen, depth + 1)
    }
  }
  seen.delete(value)
}

function jsonClone<T extends JsonValue>(value: T, label: string, maximumBytes: number): T {
  validateJsonValue(value, label, MAX_OUTPUT_DEPTH)
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    throw new TypeError(`${label} exceeds ${maximumBytes} bytes`)
  }
  return deepFreeze(JSON.parse(encoded) as T)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function schemaArray(value: unknown, path: string, allowEmpty = false): readonly unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`)
  }
  return value
}

function validatePortableSchemaNode(schema: unknown, path: string, state: { nodes: number }, depth: number): void {
  state.nodes += 1
  if (state.nodes > MAX_SCHEMA_NODES) throw new TypeError(`output schema exceeds ${MAX_SCHEMA_NODES} nodes`)
  if (depth > MAX_SCHEMA_DEPTH) throw new TypeError(`output schema exceeds maximum depth ${MAX_SCHEMA_DEPTH}`)
  if (typeof schema === 'boolean') return

  const node = object(schema, path)
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) throw new TypeError(`${path}.${key} is not supported`)
  }
  if (node.$ref !== undefined) {
    if (typeof node.$ref !== 'string' || !/^#(?:$|\/(?:\$defs|definitions)\/[^/]+$)/.test(node.$ref)) {
      throw new TypeError(`${path}.$ref must be a local root or definition reference`)
    }
    const structuralSiblings = Object.keys(node).filter(key => ![
      '$comment', '$defs', '$id', '$ref', '$schema', 'definitions', 'description', 'title',
    ].includes(key))
    if (structuralSiblings.length > 0) throw new TypeError(`${path}.$ref cannot have structural sibling keywords`)
  }
  if (node.type !== undefined) {
    const types = typeof node.type === 'string' ? [node.type] : schemaArray(node.type, `${path}.type`)
    for (const type of types) {
      if (typeof type !== 'string' || !SUPPORTED_SCHEMA_TYPES.has(type)) {
        throw new TypeError(`${path}.type contains an unsupported type`)
      }
    }
    if (new Set(types).size !== types.length) throw new TypeError(`${path}.type must not contain duplicates`)
  }
  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const) {
    if (node[keyword] !== undefined) finiteNumber(node[keyword], `${path}.${keyword}`)
  }
  if (typeof node.multipleOf === 'number' && node.multipleOf <= 0) {
    throw new TypeError(`${path}.multipleOf must be greater than zero`)
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (node[keyword] !== undefined) nonNegativeSafeInteger(node[keyword], `${path}.${keyword}`)
  }
  if (node.pattern !== undefined) {
    const pattern = boundedString(node.pattern, `${path}.pattern`, MAX_PATTERN_CHARACTERS, false)
    try {
      new RegExp(pattern)
    } catch {
      throw new TypeError(`${path}.pattern must be a valid regular expression`)
    }
  }
  if (node.format !== undefined && (typeof node.format !== 'string' || !SUPPORTED_STRING_FORMATS.has(node.format))) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (node.required !== undefined) {
    const required = schemaArray(node.required, `${path}.required`, true)
    if (required.some(value => typeof value !== 'string')) throw new TypeError(`${path}.required must contain only strings`)
    if (new Set(required).size !== required.length) throw new TypeError(`${path}.required must not contain duplicates`)
  }
  for (const keyword of ['enum', 'examples'] as const) {
    if (node[keyword] !== undefined) {
      const values = schemaArray(node[keyword], `${path}.${keyword}`, keyword === 'examples')
      validateJsonValue(values, `${path}.${keyword}`, MAX_SCHEMA_DEPTH)
    }
  }
  for (const keyword of ['const', 'default'] as const) {
    if (node[keyword] !== undefined) validateJsonValue(node[keyword], `${path}.${keyword}`, MAX_SCHEMA_DEPTH)
  }
  if (node.properties !== undefined) {
    const properties = object(node.properties, `${path}.properties`)
    for (const [name, child] of Object.entries(properties)) {
      validatePortableSchemaNode(child, `${path}.properties.${name}`, state, depth + 1)
    }
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    validatePortableSchemaNode(node.additionalProperties, `${path}.additionalProperties`, state, depth + 1)
  }
  for (const keyword of ['$defs', 'definitions'] as const) {
    if (node[keyword] === undefined) continue
    const definitions = object(node[keyword], `${path}.${keyword}`)
    for (const [name, child] of Object.entries(definitions)) {
      validatePortableSchemaNode(child, `${path}.${keyword}.${name}`, state, depth + 1)
    }
  }
  for (const keyword of ['allOf', 'anyOf'] as const) {
    if (node[keyword] === undefined) continue
    schemaArray(node[keyword], `${path}.${keyword}`).forEach((child, index) => {
      validatePortableSchemaNode(child, `${path}.${keyword}[${index}]`, state, depth + 1)
    })
  }
  if (node.not !== undefined) {
    const negated = object(node.not, `${path}.not`)
    if (Object.keys(negated).length !== 0) throw new TypeError(`${path}.not only supports the empty schema`)
  }
  if (node.prefixItems !== undefined) {
    schemaArray(node.prefixItems, `${path}.prefixItems`, true).forEach((child, index) => {
      validatePortableSchemaNode(child, `${path}.prefixItems[${index}]`, state, depth + 1)
    })
  }
  if (node.items !== undefined) {
    if (Array.isArray(node.items)) throw new TypeError(`${path}.items tuple arrays are not supported; use prefixItems`)
    validatePortableSchemaNode(node.items, `${path}.items`, state, depth + 1)
  }
}

function compileOutputSchema(value: unknown): { schema: Readonly<Record<string, JsonValue>>; validate: ValidateFunction } {
  validateJsonValue(value, 'structured inference output schema', MAX_SCHEMA_DEPTH)
  const schema = jsonClone(value as Record<string, JsonValue>, 'structured inference output schema', MAX_SCHEMA_BYTES)
  if (schema === null || Array.isArray(schema) || typeof schema !== 'object') {
    throw new TypeError('structured inference output schema must be an object')
  }
  validatePortableSchemaNode(schema, '$', { nodes: 0 }, 0)
  if (!schemaValidator.validateSchema(schema as AnySchema)) {
    throw new TypeError(`structured inference output schema is invalid: ${schemaValidator.errorsText()}`)
  }
  try {
    return { schema, validate: schemaValidator.compile(schema as AnySchema) }
  } catch {
    throw new TypeError('structured inference output schema could not be compiled')
  }
}

function normalizeRequest(request: StructuredInferenceRequest): {
  request: StructuredInferenceRequest
  validate: ValidateFunction
} {
  const candidate = object(request, 'structured inference request')
  exactKeys(candidate, ['purpose', 'system', 'input', 'outputSchema'], ['maxOutputTokens', 'signal'], 'structured inference request')
  const purpose = boundedString(candidate.purpose, 'structured inference purpose', MAX_PURPOSE_CHARACTERS).trim()
  if (!PURPOSE_PATTERN.test(purpose)) {
    throw new TypeError('structured inference purpose must be a lowercase dot-or-hyphen separated identifier')
  }
  const system = boundedString(candidate.system, 'structured inference system instruction', MAX_SYSTEM_CHARACTERS)
  const input = boundedString(candidate.input, 'structured inference input', MAX_INPUT_CHARACTERS, false)
  const { schema: outputSchema, validate } = compileOutputSchema(candidate.outputSchema)
  const maxOutputTokens = candidate.maxOutputTokens === undefined
    ? undefined
    : positiveSafeInteger(candidate.maxOutputTokens, 'structured inference maxOutputTokens', MAX_OUTPUT_TOKENS)
  if (candidate.signal !== undefined && !isAbortSignal(candidate.signal)) {
    throw new TypeError('structured inference signal must be an AbortSignal')
  }
  return {
    request: Object.freeze({
      purpose,
      system,
      input,
      outputSchema,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(candidate.signal === undefined ? {} : { signal: candidate.signal }),
    }),
    validate,
  }
}

function normalizeUsage(value: unknown): StructuredInferenceUsage | undefined {
  if (value === undefined) return undefined
  const usage = object(value, 'structured inference usage')
  exactKeys(usage, ['inputTokens', 'outputTokens'], ['totalTokens'], 'structured inference usage')
  const inputTokens = nonNegativeSafeInteger(usage.inputTokens, 'structured inference usage.inputTokens')
  const outputTokens = nonNegativeSafeInteger(usage.outputTokens, 'structured inference usage.outputTokens')
  const totalTokens = usage.totalTokens === undefined
    ? undefined
    : nonNegativeSafeInteger(usage.totalTokens, 'structured inference usage.totalTokens')
  return Object.freeze({
    inputTokens,
    outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
  })
}

function normalizeProviderError(cause: unknown): StructuredInferenceError {
  if (cause instanceof StructuredInferenceError && ERROR_CODES.has(cause.code)) {
    return new StructuredInferenceError(cause.code, cause.message)
  }
  return new StructuredInferenceError('PROVIDER_FAILURE', 'Structured inference provider failed')
}

export function createStructuredInference(provider: StructuredInferenceProvider): StructuredInference {
  if (provider === null || typeof provider !== 'object' || typeof provider.infer !== 'function') {
    throw new TypeError('structured inference provider must define infer(request)')
  }
  return Object.freeze({
    async infer(request: StructuredInferenceRequest): Promise<StructuredInferenceResult> {
      let normalized: ReturnType<typeof normalizeRequest>
      try {
        normalized = normalizeRequest(request)
      } catch (cause) {
        throw new StructuredInferenceError(
          'INVALID_REQUEST',
          cause instanceof Error ? cause.message : 'Structured inference request is invalid',
        )
      }
      if (normalized.request.signal?.aborted === true) {
        throw new StructuredInferenceError('ABORTED', 'Structured inference request was aborted')
      }

      let result: StructuredInferenceResult
      try {
        result = await provider.infer(normalized.request)
      } catch (cause) {
        throw normalizeProviderError(cause)
      }
      if (result === null || typeof result !== 'object' || !('value' in result)) {
        throw new StructuredInferenceError('MISSING_OUTPUT', 'Structured inference provider returned no structured output')
      }
      const resultObject = result as unknown as Record<string, unknown>
      try {
        exactKeys(resultObject, ['value'], ['usage'], 'structured inference result')
        const value = jsonClone(resultObject.value as JsonValue, 'structured inference result value', MAX_OUTPUT_BYTES)
        if (!normalized.validate(value)) {
          throw new TypeError(`structured inference result does not match output schema: ${schemaValidator.errorsText(normalized.validate.errors)}`)
        }
        const usage = normalizeUsage(resultObject.usage)
        return Object.freeze({ value, ...(usage === undefined ? {} : { usage }) })
      } catch (cause) {
        throw new StructuredInferenceError(
          'INVALID_OUTPUT',
          cause instanceof Error ? cause.message : 'Structured inference result is invalid',
        )
      }
    },
  })
}
