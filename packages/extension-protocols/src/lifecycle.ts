import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from './tools.ts'

export const LIFECYCLE_PROTOCOL_VERSION = 2 as const

export type LifecycleOutcome = 'cancelled' | 'completed' | 'failed'
export type LifecycleTruncationReason = 'binary' | 'circular' | 'depth' | 'entries' | 'size' | 'string' | 'unsupported'

export interface LifecycleTruncation {
  readonly reasons: readonly LifecycleTruncationReason[]
  readonly originalBytes?: number
}

export interface BoundedLifecycleValue {
  readonly value: JsonValue
  readonly truncation?: LifecycleTruncation
}

export interface LifecycleError {
  readonly code: string
  readonly message: string
  readonly data?: BoundedLifecycleValue
}

export interface LifecycleEventBase {
  readonly protocolVersion: typeof LIFECYCLE_PROTOCOL_VERSION
  readonly deliveryId: string
  readonly sessionId: string
  readonly timestamp: number
}

export interface SessionStartedEvent extends LifecycleEventBase {
  readonly type: 'session-started'
}

export interface SessionCompletedEvent extends LifecycleEventBase {
  readonly type: 'session-completed'
  readonly outcome: LifecycleOutcome
  readonly error?: LifecycleError
}

export interface SessionDisposedEvent extends LifecycleEventBase {
  readonly type: 'session-disposed'
  readonly reason?: string
}

export interface TurnStartedEvent extends LifecycleEventBase {
  readonly type: 'turn-started'
  readonly turnId: string
  readonly principalInput?: BoundedLifecycleValue
}


export interface TurnCommittedEvent extends LifecycleEventBase {
  readonly type: 'turn-committed'
  readonly turnId: string
  readonly principalInput: BoundedLifecycleValue
  readonly assistantOutput: BoundedLifecycleValue
  readonly outcome: LifecycleOutcome
  readonly error?: LifecycleError
}

export interface ToolStartedEvent extends LifecycleEventBase {
  readonly type: 'tool-started'
  readonly turnId: string
  readonly callId: string
  readonly name: string
  readonly input: BoundedLifecycleValue
}

export interface ToolCompletedEvent extends LifecycleEventBase {
  readonly type: 'tool-completed'
  readonly turnId: string
  readonly callId: string
  readonly name: string
  readonly outcome: LifecycleOutcome
  readonly result?: BoundedLifecycleValue
  readonly error?: LifecycleError
}

export interface PreCompactionEvent extends LifecycleEventBase {
  readonly type: 'pre-compaction'
  readonly turnId?: string
  readonly material: BoundedLifecycleValue
}

export type LifecycleEvent =
  | PreCompactionEvent
  | SessionCompletedEvent
  | SessionDisposedEvent
  | SessionStartedEvent
  | ToolCompletedEvent
  | ToolStartedEvent
  | TurnCommittedEvent
  | TurnStartedEvent

export interface LifecycleDiagnostic {
  readonly code: 'INVALID_LIFECYCLE_EVENT' | 'LIFECYCLE_SUBSCRIBER_FAILED'
  readonly deliveryId?: string
  readonly eventType?: LifecycleEvent['type']
  readonly message: string
}

export interface LifecycleSerializationOptions {
  readonly maxBytes?: number
  readonly maxDepth?: number
  readonly maxEntries?: number
  readonly maxStringLength?: number
}

export interface PublishLifecycleOptions {
  readonly onDiagnostic?: (diagnostic: LifecycleDiagnostic) => void
}

const EVENT_NAMES = {
  'pre-compaction': 'doppelganger/pre-compaction',
  'session-completed': 'doppelganger/session-completed',
  'session-disposed': 'doppelganger/session-disposed',
  'session-started': 'doppelganger/session-started',
  'tool-completed': 'doppelganger/tool-completed',
  'tool-started': 'doppelganger/tool-started',
  'turn-committed': 'doppelganger/turn-committed',
  'turn-started': 'doppelganger/turn-started',
} as const

export function isLifecycleEventType(value: unknown): value is LifecycleEvent['type'] {
  return typeof value === 'string' && value in EVENT_NAMES
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function serializeLifecycleValue(
  input: unknown,
  options: LifecycleSerializationOptions = {},
): BoundedLifecycleValue {
  const maxBytes = options.maxBytes ?? 32_768
  const maxDepth = options.maxDepth ?? 8
  const maxEntries = options.maxEntries ?? 100
  const maxStringLength = options.maxStringLength ?? 16_000
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('lifecycle maxBytes must be a positive integer')
  if (!Number.isSafeInteger(maxDepth) || maxDepth <= 0) throw new TypeError('lifecycle maxDepth must be a positive integer')
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new TypeError('lifecycle maxEntries must be a positive integer')
  if (!Number.isSafeInteger(maxStringLength) || maxStringLength <= 0) throw new TypeError('lifecycle maxStringLength must be a positive integer')
  const reasons = new Set<LifecycleTruncationReason>()
  const ancestors = new WeakSet<object>()

  const visit = (value: unknown, depth: number): JsonValue => {
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.length <= maxStringLength) return value
      reasons.add('string')
      return `${value.slice(0, maxStringLength - 1)}…`
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value
      reasons.add('unsupported')
      return null
    }
    if (typeof value !== 'object') {
      reasons.add('unsupported')
      return null
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      reasons.add('binary')
      return null
    }
    if (ancestors.has(value)) {
      reasons.add('circular')
      return null
    }
    if (depth >= maxDepth) {
      reasons.add('depth')
      return null
    }
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (value.length > maxEntries) reasons.add('entries')
        return value.slice(0, maxEntries).map(item => visit(item, depth + 1))
      }
      const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      if (entries.length > maxEntries) reasons.add('entries')
      return Object.fromEntries(entries.slice(0, maxEntries).map(([key, item]) => [key, visit(item, depth + 1)]))
    } finally {
      ancestors.delete(value)
    }
  }

  let value = visit(input, 0)
  const originalBytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (originalBytes > maxBytes) {
    reasons.add('size')
    value = null
  }
  return deepFreeze({
    value,
    ...(reasons.size === 0 ? {} : {
      truncation: {
        reasons: [...reasons].sort(),
        ...(reasons.has('size') ? { originalBytes } : {}),
      },
    }),
  })
}

function nonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string`)
}

function assertOutcome(outcome: LifecycleOutcome): void {
  if (!['cancelled', 'completed', 'failed'].includes(outcome)) throw new TypeError(`invalid lifecycle outcome "${outcome}"`)
}

export function normalizeLifecycleEvent(event: LifecycleEvent): LifecycleEvent {
  if (event.protocolVersion !== LIFECYCLE_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported lifecycle protocol version ${String(event.protocolVersion)}`)
  }
  nonEmpty('lifecycle deliveryId', event.deliveryId)
  nonEmpty('lifecycle sessionId', event.sessionId)
  if (!Number.isFinite(event.timestamp)) throw new TypeError('lifecycle timestamp must be finite')
  if (event.type === 'turn-started' || event.type === 'turn-committed' || event.type === 'tool-started' || event.type === 'tool-completed') {
    nonEmpty('lifecycle turnId', event.turnId)
  }
  if (event.type === 'tool-started' || event.type === 'tool-completed') {
    nonEmpty('lifecycle callId', event.callId)
    nonEmpty('lifecycle tool name', event.name)
  }
  if (event.type === 'session-completed' || event.type === 'turn-committed' || event.type === 'tool-completed') {
    assertOutcome(event.outcome)
  }
  if (event.type === 'turn-committed' && 'toolOutcomes' in event) {
    throw new TypeError('turn-committed toolOutcomes is not supported')
  }
  const encoded = JSON.stringify(event)
  if (encoded === undefined) throw new TypeError('lifecycle event must be JSON-serializable')
  return deepFreeze(JSON.parse(encoded) as LifecycleEvent)
}

export async function publishLifecycleEvent(
  context: Context,
  input: LifecycleEvent,
  options: PublishLifecycleOptions = {},
): Promise<void> {
  let event: LifecycleEvent
  try {
    event = normalizeLifecycleEvent(input)
  } catch (cause) {
    const diagnostic: LifecycleDiagnostic = Object.freeze({
      code: 'INVALID_LIFECYCLE_EVENT',
      message: cause instanceof Error ? cause.message : String(cause),
    })
    options.onDiagnostic?.(diagnostic)
    throw cause
  }
  try {
    await context.parallel(EVENT_NAMES[event.type], event as never)
  } catch (cause) {
    const diagnostic: LifecycleDiagnostic = Object.freeze({
      code: 'LIFECYCLE_SUBSCRIBER_FAILED',
      deliveryId: event.deliveryId,
      eventType: event.type,
      message: cause instanceof Error ? cause.message : String(cause),
    })
    options.onDiagnostic?.(diagnostic)
    try {
      await context.parallel('doppelganger/lifecycle-diagnostic', diagnostic)
    } catch {
      // Diagnostics must not reintroduce subscriber failure into committed host work.
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'doppelganger/session-started'(event: SessionStartedEvent): Promise<void> | void
    'doppelganger/session-completed'(event: SessionCompletedEvent): Promise<void> | void
    'doppelganger/session-disposed'(event: SessionDisposedEvent): Promise<void> | void
    'doppelganger/turn-started'(event: TurnStartedEvent): Promise<void> | void
    'doppelganger/turn-committed'(event: TurnCommittedEvent): Promise<void> | void
    'doppelganger/tool-started'(event: ToolStartedEvent): Promise<void> | void
    'doppelganger/tool-completed'(event: ToolCompletedEvent): Promise<void> | void
    'doppelganger/pre-compaction'(event: PreCompactionEvent): Promise<void> | void
    'doppelganger/lifecycle-diagnostic'(diagnostic: LifecycleDiagnostic): Promise<void> | void
  }
}
