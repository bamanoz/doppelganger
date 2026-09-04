import type { Context, Plugin } from '@deepseek-ai/cordis'

export const OMP_HOST_EVENT_PROTOCOL_VERSION = 1 as const

export type OmpTodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked'

export interface OmpTodoItem {
  readonly content: string
  readonly status: OmpTodoStatus
  readonly blocker?: string
}

export interface OmpTodoReminderEvent {
  readonly protocolVersion: typeof OMP_HOST_EVENT_PROTOCOL_VERSION
  readonly type: 'todo-reminder'
  readonly deliveryId: string
  readonly sessionId: string
  readonly timestamp: number
  readonly todos: readonly OmpTodoItem[]
  readonly attempt: number
  readonly maxAttempts: number
}

export interface OmpHostEventSink {
  publishTodoReminder(event: OmpTodoReminderEvent): Promise<void>
}

export interface OmpHostEventBinding {
  attach(sink: OmpHostEventSink): void
  detach(sink: OmpHostEventSink): void
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'doppelganger/host/omp/todo-reminder'(event: OmpTodoReminderEvent): void
  }
}

interface RuntimeSessionService {
  readonly sessionId: string
}

function runtimeSessionId(ctx: Context): string {
  const session = ctx.get('doppelgangerRuntimeSession', false) as RuntimeSessionService | undefined
  if (session === undefined) throw new Error('OMP host event provider requires doppelgangerRuntimeSession')
  return nonEmpty(session.sessionId, 'runtime sessionId')
}

const TODO_STATUSES = new Set<OmpTodoStatus>(['pending', 'in_progress', 'completed', 'abandoned', 'blocked'])
const MAX_TODOS = 256
const MAX_TEXT_LENGTH = 4_096

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional])
  const unsupported = Object.keys(value).filter(key => !allowed.has(key)).sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  const missing = required.filter(key => !(key in value))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
  const normalized = value.trim()
  if (normalized.length > MAX_TEXT_LENGTH) throw new TypeError(`${label} exceeds ${MAX_TEXT_LENGTH} characters`)
  return normalized
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`)
  return value as number
}

export function defineOmpTodoReminderEvent(value: unknown): OmpTodoReminderEvent {
  const event = object(value, 'OMP todo reminder')
  exactKeys(
    event,
    ['protocolVersion', 'type', 'deliveryId', 'sessionId', 'timestamp', 'todos', 'attempt', 'maxAttempts'],
    [],
    'OMP todo reminder',
  )
  if (event.protocolVersion !== OMP_HOST_EVENT_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported OMP host event protocol version ${String(event.protocolVersion)}`)
  }
  if (event.type !== 'todo-reminder') throw new TypeError('OMP todo reminder.type must be "todo-reminder"')
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
    throw new TypeError('OMP todo reminder.timestamp must be a finite number')
  }
  if (!Array.isArray(event.todos) || event.todos.length > MAX_TODOS) {
    throw new TypeError(`OMP todo reminder.todos must be an array with at most ${MAX_TODOS} entries`)
  }
  const todos = event.todos.map((value, index) => {
    const label = `OMP todo reminder.todos[${index}]`
    const item = object(value, label)
    exactKeys(item, ['content', 'status'], ['blocker'], label)
    if (typeof item.status !== 'string' || !TODO_STATUSES.has(item.status as OmpTodoStatus)) {
      throw new TypeError(`${label}.status is unsupported`)
    }
    return Object.freeze({
      content: nonEmpty(item.content, `${label}.content`),
      status: item.status as OmpTodoStatus,
      ...(item.blocker === undefined ? {} : { blocker: nonEmpty(item.blocker, `${label}.blocker`) }),
    })
  })
  const attempt = nonNegativeInteger(event.attempt, 'OMP todo reminder.attempt')
  const maxAttempts = nonNegativeInteger(event.maxAttempts, 'OMP todo reminder.maxAttempts')
  if (attempt > maxAttempts) throw new TypeError('OMP todo reminder.attempt must not exceed maxAttempts')
  return Object.freeze({
    protocolVersion: OMP_HOST_EVENT_PROTOCOL_VERSION,
    type: 'todo-reminder',
    deliveryId: nonEmpty(event.deliveryId, 'OMP todo reminder.deliveryId'),
    sessionId: nonEmpty(event.sessionId, 'OMP todo reminder.sessionId'),
    timestamp: event.timestamp,
    todos: Object.freeze(todos),
    attempt,
    maxAttempts,
  })
}

export function createOmpHostEventPlugin(binding: OmpHostEventBinding): Plugin {
  return {
    name: 'doppelganger-omp-host-events',
    apply(ctx: Context) {
      const sessionId = runtimeSessionId(ctx)
      let attached = true
      const sink: OmpHostEventSink = Object.freeze({
        async publishTodoReminder(value: OmpTodoReminderEvent) {
          if (!attached) throw new Error('OMP host event provider is detached')
          const event = defineOmpTodoReminderEvent(value)
          if (event.sessionId !== sessionId) {
            throw new Error(`OMP todo reminder sessionId ${JSON.stringify(event.sessionId)} does not match Runtime Session ${JSON.stringify(sessionId)}`)
          }
          ctx.emit('doppelganger/host/omp/todo-reminder', event)
        },
      })
      binding.attach(sink)
      ctx.effect(() => () => {
        if (!attached) return
        attached = false
        binding.detach(sink)
      }, 'doppelgangerOmpHostEvents.detach')
    },
  }
}
