import { ToolInvocationError, type JsonValue } from '@doppelganger/doppelganger-protocols'

export class RuntimePluginError extends ToolInvocationError {
  constructor(code: string, message: string, data?: JsonValue) {
    super(code, message, data)
    this.name = 'RuntimePluginError'
  }
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (cause !== null && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') {
    return cause.message
  }
  return String(cause)
}

export function errorStack(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.stack
  if (cause !== null && typeof cause === 'object' && 'stack' in cause && typeof cause.stack === 'string') {
    return cause.stack
  }
  return undefined
}

export function inputRecord(
  input: JsonValue,
  allowed: readonly string[],
): Readonly<Record<string, JsonValue>> {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new RuntimePluginError('INVALID_INPUT', 'tool input must be an object')
  }
  const record = input as Readonly<Record<string, JsonValue>>
  const unsupported = Object.keys(record).filter(key => !allowed.includes(key))
  if (unsupported.length > 0) {
    throw new RuntimePluginError('INVALID_INPUT', `unsupported fields: ${unsupported.sort().join(', ')}`)
  }
  return record
}

export function requiredString(
  record: Readonly<Record<string, JsonValue>>,
  field: string,
  maximum: number,
): string {
  const value = record[field]
  if (typeof value !== 'string') throw new RuntimePluginError('INVALID_INPUT', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maximum) {
    throw new RuntimePluginError('INVALID_INPUT', `${field} must contain 1-${maximum} characters`)
  }
  return trimmed
}

export function optionalString(
  record: Readonly<Record<string, JsonValue>>,
  field: string,
  maximum: number,
): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new RuntimePluginError('INVALID_INPUT', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maximum) {
    throw new RuntimePluginError('INVALID_INPUT', `${field} must contain 1-${maximum} characters`)
  }
  return trimmed
}

export function requiredExactString(
  record: Readonly<Record<string, JsonValue>>,
  field: string,
): string {
  const value = record[field]
  if (typeof value !== 'string') throw new RuntimePluginError('INVALID_INPUT', `${field} must be a string`)
  if (value.trim().length === 0) throw new RuntimePluginError('INVALID_INPUT', `${field} must be non-empty`)
  return value
}
