import { Logger, Service, type Context, type Fiber, type LoggerType, type Message } from '@deepseek-ai/cordis'
import type { RuntimeSessionMetadata } from './session-metadata.ts'

export type RuntimeLogSeverity = 'error' | 'warn' | 'info' | 'debug'

export interface RuntimeLogError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

export interface RuntimeLogRecord {
  readonly sequence: number
  readonly timestamp: number
  readonly severity: RuntimeLogSeverity
  readonly logger: string
  readonly message: string
  readonly sessionId: string
  readonly runtimePresetId: string
  readonly error?: RuntimeLogError
}

export interface RuntimeLogSink {
  write(record: RuntimeLogRecord): void | Promise<void>
}

export interface RuntimeLogSinkOptions {
  readonly maximumPendingRecords: number
  readonly filter?: (record: RuntimeLogRecord) => boolean
}

export interface RuntimeLoggingService {
  register(sink: RuntimeLogSink, options: RuntimeLogSinkOptions): () => Promise<void>
}

export interface RuntimeLoggingLimits {
  readonly maximumLoggerBytes: number
  readonly maximumMessageBytes: number
  readonly maximumErrorNameBytes: number
  readonly maximumErrorMessageBytes: number
  readonly maximumErrorStackBytes: number
  readonly maximumActivationRecords: number
  readonly minimumPendingRecords: number
  readonly maximumPendingRecords: number
}

export const RUNTIME_LOGGING_SERVICE = 'doppelgangerLogging' as const
export const RUNTIME_LOGGING_LIMITS: RuntimeLoggingLimits = Object.freeze({
  maximumLoggerBytes: 256,
  maximumMessageBytes: 16 * 1024,
  maximumErrorNameBytes: 256,
  maximumErrorMessageBytes: 4 * 1024,
  maximumErrorStackBytes: 32 * 1024,
  maximumActivationRecords: 256,
  minimumPendingRecords: 1,
  maximumPendingRecords: 16_384,
})

const severityOrder: Readonly<Record<RuntimeLogSeverity, number>> = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
})
const renderingMarker = '[unrenderable value]'
const syntheticLogger = 'doppelganger-logging'

interface SinkState {
  readonly sink: RuntimeLogSink
  readonly maximumPendingRecords: number
  readonly filter: ((record: RuntimeLogRecord) => boolean) | undefined
  readonly queue: RuntimeLogRecord[]
  accepting: boolean
  failed: boolean
  dropped: number
  droppedSequence: number | undefined
  drain: Promise<void> | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerLogging: RuntimeLoggingService
  }
}

export function compareRuntimeLogSeverity(left: RuntimeLogSeverity, right: RuntimeLogSeverity): number {
  return severityOrder[left] - severityOrder[right]
}

export function runtimeLogLevelAllows(
  severity: RuntimeLogSeverity,
  defaultLevel: RuntimeLogSeverity,
  levels: Readonly<Record<string, RuntimeLogSeverity>> = {},
  logger = '',
): boolean {
  const threshold = levels[logger] ?? defaultLevel
  return compareRuntimeLogSeverity(severity, threshold) <= 0
}

export function truncateRuntimeLogUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value
  if (maximumBytes <= 0) return ''
  const suffix = Buffer.byteLength('…', 'utf8') <= maximumBytes ? '…' : ''
  const target = maximumBytes - Buffer.byteLength(suffix, 'utf8')
  let result = ''
  let used = 0
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > target) break
    result += character
    used += bytes
  }
  return result + suffix
}

function boundedString(value: unknown, maximumBytes: number, fallback: string): string {
  try {
    return truncateRuntimeLogUtf8(String(value), maximumBytes)
  } catch {
    return fallback
  }
}

function errorFrom(value: unknown): RuntimeLogError | undefined {
  try {
    if (!(value instanceof Error)) return undefined
    const name = boundedString(value.name || 'Error', RUNTIME_LOGGING_LIMITS.maximumErrorNameBytes, 'Error')
    const message = boundedString(value.message, RUNTIME_LOGGING_LIMITS.maximumErrorMessageBytes, renderingMarker)
    let stack: string | undefined
    try {
      if (typeof value.stack === 'string' && value.stack.length > 0) {
        stack = truncateRuntimeLogUtf8(value.stack, RUNTIME_LOGGING_LIMITS.maximumErrorStackBytes)
      }
    } catch {
      stack = undefined
    }
    return Object.freeze({ name, message, ...(stack === undefined ? {} : { stack }) })
  } catch {
    return undefined
  }
}

function safeValue(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return typeof value === 'string' ? truncateRuntimeLogUtf8(value, RUNTIME_LOGGING_LIMITS.maximumMessageBytes) : value
  }
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return boundedString(value, 256, '[symbol]')
  if (typeof value === 'function') return `[function ${boundedString(value.name || 'anonymous', 128, 'anonymous')}]`
  if (value === undefined) return '[undefined]'
  if (typeof value !== 'object') return renderingMarker

  const error = errorFrom(value)
  if (error !== undefined) return error.stack ?? `${error.name}: ${error.message}`
  if (depth >= 6) return '[maximum depth]'
  try {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    if (Array.isArray(value)) {
      const output = value.slice(0, 64).map(item => safeValue(item, seen, depth + 1))
      if (value.length > output.length) output.push(`[${value.length - output.length} more items]`)
      return output
    }
    const output: Record<string, unknown> = Object.create(null)
    let count = 0
    for (const key of Reflect.ownKeys(value)) {
      if (count >= 64) {
        output['[more properties]'] = true
        break
      }
      if (typeof key !== 'string') continue
      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key)
      } catch {
        output[truncateRuntimeLogUtf8(key, 256)] = '[unreadable property]'
        count += 1
        continue
      }
      const normalizedKey = truncateRuntimeLogUtf8(key, 256)
      output[normalizedKey] = descriptor !== undefined && 'value' in descriptor
        ? safeValue(descriptor.value, seen, depth + 1)
        : '[accessor]'
      count += 1
    }
    return output
  } catch {
    return renderingMarker
  } finally {
    try {
      seen.delete(value)
    } catch {
      // A hostile proxy cannot make rendering fail.
    }
  }
}

function renderMessage(message: Message, error: RuntimeLogError | undefined): string {
  try {
    const args = message.args.map(value => safeValue(value, new WeakSet<object>()))
    if (error !== undefined && args.length > 0) args.splice(0, 1, error.stack ?? `${error.name}: ${error.message}`)
    return truncateRuntimeLogUtf8(Logger.format({
      colors: false,
      maxLength: RUNTIME_LOGGING_LIMITS.maximumMessageBytes,
      formatters: {
        o: value => JSON.stringify(value),
        O: value => JSON.stringify(value),
      },
      export: () => undefined,
    }, { ...message, args }), RUNTIME_LOGGING_LIMITS.maximumMessageBytes)
  } catch {
    return renderingMarker
  }
}

function severityFrom(type: LoggerType): RuntimeLogSeverity {
  return type
}

function freezeRecord(record: RuntimeLogRecord): RuntimeLogRecord {
  if (record.error !== undefined && !Object.isFrozen(record.error)) Object.freeze(record.error)
  return Object.freeze(record)
}

function syntheticDropRecord(
  metadata: RuntimeSessionMetadata,
  sequence: number,
  dropped: number,
  queue: 'activation' | 'sink',
): RuntimeLogRecord {
  return freezeRecord({
    sequence,
    timestamp: Date.now(),
    severity: 'warn',
    logger: syntheticLogger,
    message: `${queue} logging queue dropped ${dropped} oldest record${dropped === 1 ? '' : 's'}`,
    sessionId: metadata.sessionId,
    runtimePresetId: metadata.runtimePresetId,
  })
}

export class RuntimeLoggingRouter extends Service implements RuntimeLoggingService {
  private readonly sinks = new Set<SinkState>()
  private readonly activationRecords: RuntimeLogRecord[] = []
  private readonly removeExporter: () => Promise<void>
  private readonly metadata: RuntimeSessionMetadata
  private readonly sessionFibers: WeakSet<Fiber>
  private readonly onSessionError: ((args: readonly unknown[]) => void) | undefined
  private activationDropped = 0
  private sequence = 0
  private activationSettled = false
  private closed = false
  private disposal: Promise<void> | undefined

  constructor(
    ctx: Context,
    metadata: RuntimeSessionMetadata,
    sessionFibers: WeakSet<Fiber>,
    onSessionError?: (args: readonly unknown[]) => void,
    exporterContext: Context = ctx,
  ) {
    super(ctx, RUNTIME_LOGGING_SERVICE)
    this.metadata = metadata
    this.sessionFibers = sessionFibers
    this.onSessionError = onSessionError
    this.removeExporter = exporterContext.logger.exporter({
      levels: { default: 3 },
      export: message => { this.observe(message) },
    })
  }

  register(sink: RuntimeLogSink, options: RuntimeLogSinkOptions): () => Promise<void> {
    if (this.closed) throw new Error('runtime logging router is disposed')
    if (sink === null || typeof sink !== 'object' || typeof sink.write !== 'function') {
      throw new TypeError('runtime logging sink must define write(record)')
    }
    const maximumPendingRecords = options.maximumPendingRecords
    if (!Number.isSafeInteger(maximumPendingRecords)
      || maximumPendingRecords < RUNTIME_LOGGING_LIMITS.minimumPendingRecords
      || maximumPendingRecords > RUNTIME_LOGGING_LIMITS.maximumPendingRecords) {
      throw new RangeError(`maximumPendingRecords must be an integer from ${RUNTIME_LOGGING_LIMITS.minimumPendingRecords} through ${RUNTIME_LOGGING_LIMITS.maximumPendingRecords}`)
    }
    if (options.filter !== undefined && typeof options.filter !== 'function') {
      throw new TypeError('runtime logging sink filter must be a function')
    }
    const state: SinkState = {
      sink,
      maximumPendingRecords,
      filter: options.filter,
      queue: [],
      accepting: true,
      failed: false,
      dropped: 0,
      droppedSequence: undefined,
      drain: undefined,
    }
    return this.ctx.effect(() => {
      this.sinks.add(state)
      if (!this.activationSettled) {
        const first = this.activationRecords[0]
        if (this.activationDropped > 0) {
          this.enqueue(state, syntheticDropRecord(
            this.metadata,
            first === undefined ? 0 : Math.max(0, first.sequence - 1),
            this.activationDropped,
            'activation',
          ))
        }
        for (const record of this.activationRecords) this.enqueue(state, record)
      }
      return async () => { await this.unregister(state) }
    }, 'doppelgangerLogging.register()')
  }

  settleActivation(): void {
    if (this.closed || this.activationSettled) return
    this.activationSettled = true
    this.activationRecords.length = 0
    this.activationDropped = 0
  }

  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      if (this.closed) return
      this.closed = true
      await this.removeExporter()
      this.activationRecords.length = 0
      this.activationDropped = 0
      const sinks = [...this.sinks]
      await Promise.allSettled(sinks.map(state => this.unregister(state)))
    })()
  }

  private observe(message: Message): void {
    if (this.closed) return
    const fiber = message.fiber?.deref()
    if (fiber === undefined || !this.sessionFibers.has(fiber)) return
    try {
      if (message.type === 'error') this.onSessionError?.(message.args)
      if (this.activationSettled && this.sinks.size === 0) return
      const record = this.normalize(message)
      if (!this.activationSettled) {
        if (this.activationRecords.length >= RUNTIME_LOGGING_LIMITS.maximumActivationRecords) {
          this.activationRecords.shift()
          this.activationDropped += 1
        }
        this.activationRecords.push(record)
      }
      for (const state of this.sinks) this.enqueue(state, record)
    } catch {
      // Runtime logging cannot make the source Cordis logger call fail.
    }
  }

  private normalize(message: Message): RuntimeLogRecord {
    const error = errorFrom(message.args[0])
    return freezeRecord({
      sequence: this.sequence += 1,
      timestamp: Number.isFinite(message.ts) ? message.ts : Date.now(),
      severity: severityFrom(message.type),
      logger: truncateRuntimeLogUtf8(boundedString(message.name, RUNTIME_LOGGING_LIMITS.maximumLoggerBytes, renderingMarker), RUNTIME_LOGGING_LIMITS.maximumLoggerBytes),
      message: renderMessage(message, error),
      sessionId: this.metadata.sessionId,
      runtimePresetId: this.metadata.runtimePresetId,
      ...(error === undefined ? {} : { error }),
    })
  }

  private enqueue(state: SinkState, record: RuntimeLogRecord): void {
    if (!state.accepting || state.failed) return
    if (state.filter !== undefined) {
      try {
        if (!state.filter(record)) return
      } catch {
        state.failed = true
        state.accepting = false
        this.sinks.delete(state)
        return
      }
    }
    if (state.queue.length >= state.maximumPendingRecords) {
      const dropped = state.queue.shift()
      state.dropped += 1
      state.droppedSequence ??= dropped?.sequence ?? record.sequence
    }
    state.queue.push(record)
    this.scheduleDrain(state)
  }

  private scheduleDrain(state: SinkState): void {
    if (state.drain !== undefined || state.failed) return
    state.drain = Promise.resolve().then(async () => {
      while (!state.failed && (state.dropped > 0 || state.queue.length > 0)) {
        let record: RuntimeLogRecord
        if (state.dropped > 0) {
          record = syntheticDropRecord(
            this.metadata,
            state.droppedSequence ?? state.queue[0]?.sequence ?? this.sequence,
            state.dropped,
            'sink',
          )
          state.dropped = 0
          state.droppedSequence = undefined
        } else {
          record = state.queue.shift()!
        }
        try {
          await state.sink.write(record)
        } catch {
          state.failed = true
          state.accepting = false
          state.queue.length = 0
          state.dropped = 0
          state.droppedSequence = undefined
          this.sinks.delete(state)
        }
      }
    }).finally(() => {
      state.drain = undefined
      if (!state.failed && (state.dropped > 0 || state.queue.length > 0)) this.scheduleDrain(state)
    })
  }

  private async unregister(state: SinkState): Promise<void> {
    if (state.accepting) {
      state.accepting = false
      this.sinks.delete(state)
    }
    while (state.drain !== undefined) await state.drain
  }
}
