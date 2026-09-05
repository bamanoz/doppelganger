import type { Context } from '@deepseek-ai/cordis'
import { cloneJsonValue, isJsonObjectPrototype, type JsonValue } from './json-value.ts'

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
  return typeof value === 'string' && Object.hasOwn(EVENT_NAMES, value)
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
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const propertyNames = Object.getOwnPropertyNames(value)
        if (propertyNames.some(name => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
          reasons.add('unsupported')
        }
        if (Object.getOwnPropertySymbols(value).length > 0) reasons.add('unsupported')
        if (value.length > maxEntries) reasons.add('entries')
        const result: JsonValue[] = []
        for (let index = 0; index < Math.min(value.length, maxEntries); index += 1) {
          const descriptor = descriptors[String(index)]
          if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
            reasons.add('unsupported')
            result.push(null)
          } else {
            result.push(visit(descriptor.value, depth + 1))
          }
        }
        return Object.freeze(result)
      }

      const prototype = Object.getPrototypeOf(value)
      if (!isJsonObjectPrototype(prototype)) {
        reasons.add('unsupported')
        return null
      }
      if (Object.getOwnPropertySymbols(value).length > 0) reasons.add('unsupported')
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const keys = Object.keys(descriptors).sort()
      if (keys.length > maxEntries) reasons.add('entries')
      const result = Object.create(null) as Record<string, JsonValue>
      for (const key of keys.slice(0, maxEntries)) {
        const descriptor = descriptors[key]!
        const child = !('value' in descriptor) || descriptor.enumerable !== true
          ? (reasons.add('unsupported'), null)
          : visit(descriptor.value, depth + 1)
        Object.defineProperty(result, key, {
          value: child,
          enumerable: true,
          configurable: false,
          writable: false,
        })
      }
      return Object.freeze(result)
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
  const truncation = reasons.size === 0
    ? undefined
    : Object.freeze({
        reasons: Object.freeze([...reasons].sort()),
        ...(reasons.has('size') ? { originalBytes } : {}),
      })
  return Object.freeze({ value, ...(truncation === undefined ? {} : { truncation }) })
}

const LIFECYCLE_EVENT_LIMITS = Object.freeze({ maximumBytes: 1024 * 1024, maximumDepth: 16 })
const LIFECYCLE_OUTCOMES: readonly LifecycleOutcome[] = ['cancelled', 'completed', 'failed']
const LIFECYCLE_TRUNCATION_REASONS: readonly LifecycleTruncationReason[] = [
  'binary', 'circular', 'depth', 'entries', 'size', 'string', 'unsupported',
]
const LIFECYCLE_FIELDS = {
  'pre-compaction': { required: ['material'], optional: ['turnId'] },
  'session-completed': { required: ['outcome'], optional: ['error'] },
  'session-disposed': { required: [], optional: ['reason'] },
  'session-started': { required: [], optional: [] },
  'tool-completed': { required: ['turnId', 'callId', 'name', 'outcome'], optional: ['result', 'error'] },
  'tool-started': { required: ['turnId', 'callId', 'name', 'input'], optional: [] },
  'turn-committed': { required: ['turnId', 'principalInput', 'assistantOutput', 'outcome'], optional: ['error'] },
  'turn-started': { required: ['turnId'], optional: ['principalInput'] },
} as const satisfies Record<LifecycleEvent['type'], {
  readonly required: readonly string[]
  readonly optional: readonly string[]
}>
const LIFECYCLE_BASE_FIELDS = ['protocolVersion', 'deliveryId', 'sessionId', 'timestamp', 'type'] as const

function lifecycleRecord(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${label} must be an object`)
  return value as Readonly<Record<string, JsonValue>>
}

function exactLifecycleKeys(
  value: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value)
    .filter(key => !required.includes(key) && !optional.includes(key))
    .sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  const missing = required.filter(key => !Object.hasOwn(value, key))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

function lifecycleText(value: JsonValue | undefined, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
}

function validateBoundedLifecycleValue(value: JsonValue | undefined, label: string): void {
  const bounded = lifecycleRecord(value ?? null, label)
  exactLifecycleKeys(bounded, ['value'], ['truncation'], label)
  if (bounded.truncation === undefined) return
  const truncation = lifecycleRecord(bounded.truncation, `${label}.truncation`)
  exactLifecycleKeys(truncation, ['reasons'], ['originalBytes'], `${label}.truncation`)
  if (!Array.isArray(truncation.reasons) || truncation.reasons.length === 0) {
    throw new TypeError(`${label}.truncation.reasons must be a non-empty array`)
  }
  const reasons = truncation.reasons
  if (reasons.some(reason => typeof reason !== 'string' || !LIFECYCLE_TRUNCATION_REASONS.includes(reason as LifecycleTruncationReason))) {
    throw new TypeError(`${label}.truncation.reasons contains an unsupported reason`)
  }
  if (new Set(reasons).size !== reasons.length) throw new TypeError(`${label}.truncation.reasons must not contain duplicates`)
  const hasSize = reasons.includes('size')
  if (hasSize !== (truncation.originalBytes !== undefined)) {
    throw new TypeError(`${label}.truncation.originalBytes must be present exactly when size truncation is reported`)
  }
  if (truncation.originalBytes !== undefined
    && (!Number.isSafeInteger(truncation.originalBytes) || (truncation.originalBytes as number) <= 0)) {
    throw new TypeError(`${label}.truncation.originalBytes must be a positive safe integer`)
  }
}

function validateLifecycleError(value: JsonValue | undefined, label: string): void {
  const error = lifecycleRecord(value ?? null, label)
  exactLifecycleKeys(error, ['code', 'message'], ['data'], label)
  lifecycleText(error.code, `${label}.code`)
  lifecycleText(error.message, `${label}.message`)
  if (error.data !== undefined) validateBoundedLifecycleValue(error.data, `${label}.data`)
}

export function normalizeLifecycleEvent(input: unknown): LifecycleEvent {
  const value = cloneJsonValue(input, 'lifecycle event', LIFECYCLE_EVENT_LIMITS)
  const event = lifecycleRecord(value, 'lifecycle event')
  if (event.protocolVersion !== LIFECYCLE_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported lifecycle protocol version ${String(event.protocolVersion)}`)
  }
  if (!isLifecycleEventType(event.type)) throw new TypeError(`unsupported lifecycle event type ${String(event.type)}`)
  const fields = LIFECYCLE_FIELDS[event.type]
  exactLifecycleKeys(
    event,
    [...LIFECYCLE_BASE_FIELDS, ...fields.required],
    fields.optional,
    `lifecycle ${event.type}`,
  )
  lifecycleText(event.deliveryId, 'lifecycle deliveryId')
  lifecycleText(event.sessionId, 'lifecycle sessionId')
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
    throw new TypeError('lifecycle timestamp must be finite')
  }
  if (event.turnId !== undefined) lifecycleText(event.turnId, 'lifecycle turnId')
  if (event.callId !== undefined) lifecycleText(event.callId, 'lifecycle callId')
  if (event.name !== undefined) lifecycleText(event.name, 'lifecycle tool name')
  if (event.reason !== undefined) lifecycleText(event.reason, 'lifecycle disposal reason')
  if (event.outcome !== undefined
    && (typeof event.outcome !== 'string' || !LIFECYCLE_OUTCOMES.includes(event.outcome as LifecycleOutcome))) {
    throw new TypeError(`invalid lifecycle outcome "${String(event.outcome)}"`)
  }
  if (event.principalInput !== undefined) validateBoundedLifecycleValue(event.principalInput, 'lifecycle principalInput')
  if (event.assistantOutput !== undefined) validateBoundedLifecycleValue(event.assistantOutput, 'lifecycle assistantOutput')
  if (event.input !== undefined) validateBoundedLifecycleValue(event.input, 'lifecycle tool input')
  if (event.result !== undefined) validateBoundedLifecycleValue(event.result, 'lifecycle tool result')
  if (event.material !== undefined) validateBoundedLifecycleValue(event.material, 'lifecycle compaction material')
  if (event.error !== undefined) validateLifecycleError(event.error, 'lifecycle error')
  return value as unknown as LifecycleEvent
}

export async function publishLifecycleEvent(
  context: Context,
  input: LifecycleEvent,
  options: PublishLifecycleOptions = {},
): Promise<void> {
  const logger = context.logger('doppelganger-lifecycle')
  logger.debug('lifecycle.publish.started type=%s', input.type)
  let event: LifecycleEvent
  try {
    event = normalizeLifecycleEvent(input)
  } catch (cause) {
    const diagnostic: LifecycleDiagnostic = Object.freeze({
      code: 'INVALID_LIFECYCLE_EVENT',
      message: cause instanceof Error ? cause.message : String(cause),
    })
    logger.warn('lifecycle.publish.rejected reason=%s', cause instanceof Error ? cause.name : typeof cause)
    options.onDiagnostic?.(diagnostic)
    throw cause
  }
  try {
    await context.parallel(EVENT_NAMES[event.type], event as never)
    logger.debug('lifecycle.publish.completed type=%s', event.type)
  } catch (cause) {
    logger.warn('lifecycle.publish.failed type=%s reason=%s', event.type, cause instanceof Error ? cause.name : typeof cause)
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
