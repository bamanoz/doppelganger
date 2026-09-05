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

const sentrySeverity: Readonly<Record<RuntimeLogSeverity, SeverityLevel>> = Object.freeze({
  error: 'error',
  warn: 'warning',
  info: 'info',
  debug: 'debug',
})

function runtimeContext(record: RuntimeLogRecord): Record<string, string | number> {
  return {
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
    level: sentrySeverity[record.severity],
    message: record.message,
    data: runtimeContext(record),
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
  private closing: Promise<boolean> | undefined
  private accepting = true

  constructor(config: ResolvedSentryLoggingConfig, transport: SentryTransportFactory) {
    this.client = new NodeClient({
      dsn: config.dsn,
      ...(config.environment === undefined ? {} : { environment: config.environment }),
      ...(config.release === undefined ? {} : { release: config.release }),
      integrations: [],
      transport,
      stackParser: defaultStackParser,
      sendClientReports: false,
      sendDefaultPii: false,
      enableLogs: false,
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

export type OwnedSentryClientFactory = (config: ResolvedSentryLoggingConfig) => OwnedSentryClient

let ownedSentryClientFactory: OwnedSentryClientFactory = config => createOwnedSentryClient(config)

export function currentOwnedSentryClientFactory(): OwnedSentryClientFactory {
  return ownedSentryClientFactory
}

export function replaceOwnedSentryClientFactoryForTests(factory: OwnedSentryClientFactory): () => void {
  const previous = ownedSentryClientFactory
  ownedSentryClientFactory = factory
  return () => { ownedSentryClientFactory = previous }
}
