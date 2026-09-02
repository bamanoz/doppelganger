import type { JsonValue } from '@doppelganger/doppelganger-protocols'
import { ToolInvocationError } from '@doppelganger/doppelganger-protocols'

export type CodeGraphErrorCode =
  | 'CODEGRAPH_INVALID_INPUT'
  | 'CODEGRAPH_BINARY_UNAVAILABLE'
  | 'CODEGRAPH_BINARY_INCOMPATIBLE'
  | 'CODEGRAPH_WORKSPACE_REQUIRED'
  | 'CODEGRAPH_STATUS_INVALID'
  | 'CODEGRAPH_INDEX_UNINITIALIZED'
  | 'CODEGRAPH_INDEX_UNSAFE'
  | 'CODEGRAPH_SYNC_FAILED'
  | 'CODEGRAPH_QUERY_FAILED'
  | 'CODEGRAPH_TIMEOUT'
  | 'CODEGRAPH_OUTPUT_LIMIT'
  | 'CODEGRAPH_DISPOSED'

export class CodeGraphError extends ToolInvocationError {
  constructor(code: CodeGraphErrorCode, message: string, data?: JsonValue) {
    super(code, message, data)
    this.name = 'CodeGraphError'
  }
}

export function boundedMessage(input: unknown, maximum = 2_048): string {
  const message = input instanceof Error ? input.message : String(input)
  if (Buffer.byteLength(message, 'utf8') <= maximum) return message
  let end = Math.min(message.length, maximum)
  while (end > 0 && Buffer.byteLength(message.slice(0, end), 'utf8') > maximum) end -= 1
  return message.slice(0, end)
}
