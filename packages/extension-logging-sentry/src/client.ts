import {
  _INTERNAL_captureSerializedLog,
  type LogSeverityLevel,
  type SerializedLog,
} from '@sentry/core'
import {
  NodeClient,
  Scope,
  defaultStackParser,
  makeNodeTransport,
  type Breadcrumb,
  type Event,
  type SeverityLevel,
} from '@sentry/node'
import type {
  RuntimeLogRecord,
  RuntimeLogSeverity,
  RuntimeLogSink,
} from '@doppelganger/doppelganger-composition-runtime'
import type { ResolvedSentryLoggingConfig } from './config.ts'

export interface OwnedSentryClient extends RuntimeLogSink {
  close(timeoutMs: number): Promise<boolean>
}

export type SentryTransportFactory = typeof makeNodeTransport

const sentryEventSeverity: Readonly<Record<RuntimeLogSeverity, SeverityLevel>> = Object.freeze({
  error: 'error',
  warn: 'warning',
  info: 'info',
  debug: 'debug',
})

const sentryLogSeverity: Readonly<Record<RuntimeLogSeverity, LogSeverityLevel>> = Object.freeze({
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
})

const sentryLogSeverityNumber: Readonly<Record<RuntimeLogSeverity, number>> = Object.freeze({
  error: 17,
  warn: 13,
  info: 9,
  debug: 5,
})

function runtimeContext(record: RuntimeLogRecord): Record<string, string | number> {
  return {
    runtimeActivationId: record.runtimeActivationId,
    sessionId: record.sessionId,
    runtimePresetId: record.runtimePresetId,
    logger: record.logger,
    severity: record.severity,
    sequence: record.sequence,
  }
}

function breadcrumb(record: RuntimeLogRecord): Breadcrumb {
  return {
    timestamp: record.timestamp / 1_000,
    category: record.logger,
    level: sentryEventSeverity[record.severity],
    message: record.message,
    data: runtimeContext(record),
  }
}

function serializedLog(
  record: RuntimeLogRecord,
  config: ResolvedSentryLoggingConfig,
): SerializedLog {
  return {
    timestamp: record.timestamp / 1_000,
    level: sentryLogSeverity[record.severity],
    body: record.message,
    severity_number: sentryLogSeverityNumber[record.severity],
    attributes: {
      runtimeActivationId: { type: 'string', value: record.runtimeActivationId },
      sessionId: { type: 'string', value: record.sessionId },
      runtimePresetId: { type: 'string', value: record.runtimePresetId },
      logger: { type: 'string', value: record.logger },
      severity: { type: 'string', value: record.severity },
      sequence: { type: 'integer', value: record.sequence },
      ...(config.environment === undefined
        ? {}
        : { 'sentry.environment': { type: 'string', value: config.environment } }),
      ...(config.release === undefined
        ? {}
        : { 'sentry.release': { type: 'string', value: config.release } }),
    },
  }
}

function errorEvent(record: RuntimeLogRecord): Event {
  const context = runtimeContext(record)
  if (record.error === undefined) {
    return {
      timestamp: record.timestamp / 1_000,
      level: 'error',
      message: record.message,
      tags: {
        runtime_activation_id: record.runtimeActivationId,
        runtime_session_id: record.sessionId,
        runtime_preset_id: record.runtimePresetId,
        logger: record.logger,
        severity: record.severity,
        sequence: String(record.sequence),
      },
      contexts: { doppelganger_runtime: context },
    }
  }
  return {
    timestamp: record.timestamp / 1_000,
    level: 'error',
    message: record.message,
    exception: {
      values: [{
        type: record.error.name,
        value: record.error.message,
        ...(record.error.stack === undefined ? {} : { mechanism: { type: 'doppelganger_runtime_log', handled: true, data: { stack: record.error.stack } } }),
      }],
    },
    tags: {
      runtime_activation_id: record.runtimeActivationId,
      runtime_session_id: record.sessionId,
      runtime_preset_id: record.runtimePresetId,
      logger: record.logger,
      severity: record.severity,
      sequence: String(record.sequence),
    },
    contexts: { doppelganger_runtime: context },
  }
}

class NodeOwnedSentryClient implements OwnedSentryClient {
  private readonly client: NodeClient
  private readonly scope: Scope
  private readonly config: ResolvedSentryLoggingConfig
  private closing: Promise<boolean> | undefined
  private accepting = true

  constructor(config: ResolvedSentryLoggingConfig, transport: SentryTransportFactory) {
    this.config = config
    this.client = new NodeClient({
      dsn: config.dsn,
      ...(config.environment === undefined ? {} : { environment: config.environment }),
      ...(config.release === undefined ? {} : { release: config.release }),
      integrations: [],
      transport,
      stackParser: defaultStackParser,
      sendClientReports: false,
      sendDefaultPii: false,
      enableLogs: true,
      skipOpenTelemetrySetup: true,
      registerEsmLoaderHooks: false,
      includeServerName: false,
      maxBreadcrumbs: 100,
      maxValueLength: 32 * 1024,
      normalizeDepth: 4,
      normalizeMaxBreadth: 100,
    })
    this.client.init()
    this.scope = new Scope()
    this.scope.setClient(this.client)
  }

  write(record: RuntimeLogRecord): void {
    if (!this.accepting) throw new Error('Sentry logging client is not accepting records')
    const log = serializedLog(record, this.config)
    _INTERNAL_captureSerializedLog(this.client, log)
    this.client.emit('afterCaptureLog', {
      level: sentryLogSeverity[record.severity],
      message: record.message,
      attributes: runtimeContext(record),
      severityNumber: sentryLogSeverityNumber[record.severity],
    })
    if (record.severity !== 'error') {
      this.scope.addBreadcrumb(breadcrumb(record), 100)
      return
    }
    this.scope.captureEvent(errorEvent(record))
  }

  close(timeoutMs: number): Promise<boolean> {
    return this.closing ??= (async () => {
      this.accepting = false
      const close = Promise.resolve(this.client.close(timeoutMs)).catch(() => false)
      const timeout = new Promise<false>(resolve => setTimeout(resolve, timeoutMs, false))
      return Promise.race([close, timeout])
    })()
  }
}

export function createOwnedSentryClient(
  config: ResolvedSentryLoggingConfig,
  transport: SentryTransportFactory = makeNodeTransport,
): OwnedSentryClient {
  return new NodeOwnedSentryClient(config, transport)
}
