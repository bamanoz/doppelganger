import { ToolInvocationError, type JsonValue } from '@doppelganger/doppelganger-protocols'

export class McpImportError extends Error {
  readonly code: string
  readonly data: JsonValue | undefined

  constructor(code: string, message: string, data?: JsonValue) {
    super(message)
    this.name = 'McpImportError'
    this.code = code
    this.data = data
  }
}

export function toToolInvocationError(cause: unknown, fallbackCode: string, fallbackMessage: string): ToolInvocationError {
  if (cause instanceof ToolInvocationError) return cause
  if (cause instanceof McpImportError) return new ToolInvocationError(cause.code, cause.message, cause.data)
  return new ToolInvocationError(fallbackCode, cause instanceof Error ? cause.message : fallbackMessage)
}
