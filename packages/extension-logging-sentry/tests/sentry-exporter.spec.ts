import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { getClient } from '@sentry/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RuntimeLoggingService,
  RuntimeLogRecord,
  RuntimeLogSink,
  RuntimeLogSinkOptions,
} from '@doppelganger/doppelganger-composition-runtime'

const sentryLoaderTransport = vi.hoisted(() => ({
  envelopes: [] as unknown[],
  events: [] as string[],
  flushTimeouts: [] as Array<number | undefined>,
}))

vi.mock(import('@sentry/node'), async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    makeNodeTransport: () => ({
      send(envelope: unknown) {
        sentryLoaderTransport.envelopes.push(envelope)
        return Promise.resolve({ statusCode: 200 })
      },
      flush(timeout?: number) {
        sentryLoaderTransport.events.push('flush')
        sentryLoaderTransport.flushTimeouts.push(timeout)
        return Promise.resolve(true)
      },
    }),
  }
})
import {
  SentryLoggingConfigSchema,
  createSentryLoggingFilter,
  normalizeSentryLoggingConfig,
  resolveSentryLoggingConfig,
} from '../src/index.ts'
import {
  createOwnedSentryClient,
  type SentryTransportFactory,
} from '../src/client.ts'
import SentryLoggingPlugin from '../src/plugin.ts'

const validDsn = 'https://public@example.com/1'
const runtimeActivationId = '123e4567-e89b-42d3-a456-426614174000'

afterEach(() => {
  delete process.env.DOPPELGANGER_TEST_SENTRY_DSN
  sentryLoaderTransport.envelopes.length = 0
  sentryLoaderTransport.events.length = 0
  sentryLoaderTransport.flushTimeouts.length = 0
})

function record(
  sequence: number,
  severity: RuntimeLogRecord['severity'],
  message: string,
  logger = 'sentry-test',
  error?: RuntimeLogRecord['error'],
): RuntimeLogRecord {
  return Object.freeze({
    runtimeActivationId,
    sequence,
    timestamp: 1_700_000_000_000 + sequence,
    severity,
    logger,
    message,
    sessionId: 'sentry-session',
    runtimePresetId: 'sentry-preset',
    ...(error === undefined ? {} : { error: Object.freeze(error) }),
  })
}

function resolved(overrides: Record<string, unknown> = {}) {
  return resolveSentryLoggingConfig(normalizeSentryLoggingConfig({
    dsnEnv: 'DOPPELGANGER_TEST_SENTRY_DSN',
    level: 'debug',
    flushTimeoutMs: 100,
    maximumPendingRecords: 16,
    ...overrides,
  }), { DOPPELGANGER_TEST_SENTRY_DSN: validDsn })
}

function transportHarness(options: {
  readonly rejectSend?: boolean
  readonly flush?: (timeout?: number) => PromiseLike<boolean>
} = {}): {
  readonly envelopes: Array<Parameters<ReturnType<SentryTransportFactory>['send']>[0]>
  readonly factory: SentryTransportFactory
  readonly flushTimeouts: Array<number | undefined>
} {
  const envelopes: Array<Parameters<ReturnType<SentryTransportFactory>['send']>[0]> = []
  const flushTimeouts: Array<number | undefined> = []
  const factory: SentryTransportFactory = () => ({
    send(envelope) {
      envelopes.push(envelope)
      return options.rejectSend
        ? Promise.reject(new Error('transport rejected'))
        : Promise.resolve({ statusCode: 200 })
    },
    flush(timeout?: number) {
      flushTimeouts.push(timeout)
      return options.flush?.(timeout) ?? Promise.resolve(true)
    },
  })
  return { envelopes, factory, flushTimeouts }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('Sentry logging configuration', () => {
  it('fails activation when the exact configured DSN environment variable is unavailable', () => {
    const config = normalizeSentryLoggingConfig({ dsnEnv: 'EXACT_DSN' })
    expect(() => resolveSentryLoggingConfig(config, { SENTRY_DSN: validDsn })).toThrow('EXACT_DSN')
    expect(() => resolveSentryLoggingConfig(config, { EXACT_DSN: '   ' })).toThrow('unavailable or invalid')
    expect(() => resolveSentryLoggingConfig(config, { EXACT_DSN: 'not-a-dsn' })).toThrow('unavailable or invalid')
  })

  it('rejects unknown fields, invalid levels, bounds, environment names, and metadata overflow', () => {
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', unknown: true })).toThrow('unknown field')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'not valid' })).toThrow('environment variable')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', level: 'trace' })).toThrow('error, warn, info, or debug')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', flushTimeoutMs: 99 })).toThrow('flushTimeoutMs')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', maximumPendingRecords: 0 })).toThrow('maximumPendingRecords')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', environment: 'not valid' })).toThrow('valid Sentry environment')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', environment: 'x'.repeat(65) })).toThrow('64 UTF-8 bytes')
    expect(() => normalizeSentryLoggingConfig({ dsnEnv: 'X', release: 'x'.repeat(201) })).toThrow('200 UTF-8 bytes')
  })

  it('applies exact independent level filters', () => {
    const filter = createSentryLoggingFilter(normalizeSentryLoggingConfig({
      dsnEnv: 'X',
      level: 'error',
      levels: { noisy: 'debug' },
    }))
    expect(filter(record(1, 'debug', 'accepted', 'noisy'))).toBe(true)
    expect(filter(record(2, 'debug', 'rejected', 'other'))).toBe(false)
    expect(filter(record(3, 'error', 'accepted', 'other'))).toBe(true)
  })
  it('uses identical direct and Loader Sentry configuration admission', () => {
    const valid = {
      dsnEnv: 'DOPPELGANGER_TEST_SENTRY_DSN',
      level: 'debug',
      levels: { worker: 'warn' },
      environment: 'production',
      release: 'release-1',
      flushTimeoutMs: 60_000,
      maximumPendingRecords: 16_384,
    }
    const direct = normalizeSentryLoggingConfig(valid)
    const admitted = SentryLoggingConfigSchema['~standard'].validate(valid)
    expect('issues' in admitted ? admitted.issues : undefined).toBeUndefined()
    if ('value' in admitted) expect(admitted.value).toEqual(direct)
    expect(normalizeSentryLoggingConfig({ dsnEnv: 'X' })).toEqual({
      dsnEnv: 'X', level: 'info', levels: {}, flushTimeoutMs: 2_000, maximumPendingRecords: 1_024,
    })
    const invalid = [
      null,
      { dsnEnv: 'X', unknown: true },
      { dsnEnv: 'X'.repeat(257) },
      { dsnEnv: 'not valid' },
      { dsnEnv: 'X', level: 'trace' },
      { dsnEnv: 'X', flushTimeoutMs: 99 },
      { dsnEnv: 'X', maximumPendingRecords: 0 },
    ]
    for (const input of invalid) {
      expect(() => normalizeSentryLoggingConfig(input)).toThrow()
      expect(SentryLoggingConfigSchema['~standard'].validate(input)).toHaveProperty('issues')
    }
  })

  it('exposes public and Loader entries with pinned Sentry and one internal edge', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      readonly exports: Record<string, unknown>
      readonly dependencies: Record<string, string>
    }

    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './loader'])
    expect(manifest.dependencies['@sentry/node']).toBe('10.73.0')
    expect(Object.keys(manifest.dependencies).filter(name => name.startsWith('@doppelganger/'))).toEqual([
      '@doppelganger/doppelganger-composition-runtime',
    ])
  })
})

describe('private Sentry client', () => {
  it('uses a private client without mutating global Sentry state', async () => {
    const before = getClient()
    const transport = transportHarness()
    const client = createOwnedSentryClient(resolved(), transport.factory)

    client.write(record(1, 'error', 'private event'))
    await client.close(100)

    expect(getClient()).toBe(before)
    expect(transport.envelopes).toHaveLength(1)
  })

  it('attaches admitted breadcrumbs and runtime correlation to an error event', async () => {
    const transport = transportHarness()
    const client = createOwnedSentryClient(resolved({ environment: 'test', release: 'release-1' }), transport.factory)
    client.write(record(1, 'warn', 'warning breadcrumb', 'worker'))
    client.write(record(2, 'error', 'bounded error', 'worker', {
      name: 'RuntimeFailure',
      message: 'operation failed',
      stack: 'RuntimeFailure: operation failed\n at worker',
    }))
    await client.close(100)

    const payload = JSON.stringify(transport.envelopes)
    expect(payload).toContain('warning breadcrumb')
    expect(payload).toContain('bounded error')
    expect(payload).toContain('RuntimeFailure')
    expect(payload).toContain(runtimeActivationId)
    expect(payload).toContain('runtime_activation_id')
    expect(payload).toContain('sentry-session')
    expect(payload).toContain('sentry-preset')
    expect(payload).toContain('release-1')
    expect(payload).not.toContain('rawArgs')
    expect(transport.envelopes).toHaveLength(1)
  })

  it('maps error records without error descriptions to bounded message events', async () => {
    const transport = transportHarness()
    const client = createOwnedSentryClient(resolved(), transport.factory)
    client.write(record(1, 'error', 'message-only failure'))
    await client.close(100)

    const payload = JSON.stringify(transport.envelopes)
    expect(payload).toContain('message-only failure')
    expect(payload).toContain('runtime_session_id')
    expect(payload).toContain('sequence')
  })

  it('contains rejected transport delivery without affecting the caller', async () => {
    const transport = transportHarness({ rejectSend: true })
    const client = createOwnedSentryClient(resolved(), transport.factory)

    expect(() => client.write(record(1, 'error', 'rejected event'))).not.toThrow()
    await expect(client.close(100)).resolves.toBeTypeOf('boolean')
    expect(transport.envelopes).toHaveLength(1)
  })

  it('flushes and closes only the private client during disposal', async () => {
    const transport = transportHarness()
    const client = createOwnedSentryClient(resolved(), transport.factory)
    client.write(record(1, 'error', 'pending event'))

    await expect(client.close(100)).resolves.toBe(true)
    await expect(client.close(100)).resolves.toBe(true)
    expect(transport.flushTimeouts).toEqual([100])
    expect(() => client.write(record(2, 'error', 'late'))).toThrow('not accepting records')
  })

  it('bounds shutdown when the private transport does not drain', async () => {
    const transport = transportHarness({ flush: () => new Promise<boolean>(() => undefined) })
    const client = createOwnedSentryClient(resolved(), transport.factory)
    client.write(record(1, 'error', 'pending forever'))
    const started = Date.now()

    await expect(client.close(100)).resolves.toBe(false)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('keeps private clients and breadcrumbs isolated across activations sharing one logical session', async () => {
    const firstTransport = transportHarness()
    const secondTransport = transportHarness()
    const first = createOwnedSentryClient(resolved(), firstTransport.factory)
    const second = createOwnedSentryClient(resolved(), secondTransport.factory)
    const secondActivationId = '123e4567-e89b-42d3-b456-426614174001'
    first.write(record(1, 'warn', 'first breadcrumb', 'first'))
    second.write({ ...record(1, 'warn', 'second breadcrumb', 'second'), runtimeActivationId: secondActivationId })
    first.write(record(2, 'error', 'first error', 'first'))
    second.write({ ...record(2, 'error', 'second error', 'second'), runtimeActivationId: secondActivationId })
    await Promise.all([first.close(100), second.close(100)])

    const firstPayload = JSON.stringify(firstTransport.envelopes)
    const secondPayload = JSON.stringify(secondTransport.envelopes)
    expect(firstPayload).toContain(runtimeActivationId)
    expect(firstPayload).not.toContain(secondActivationId)
    expect(secondPayload).toContain(secondActivationId)
    expect(secondPayload).not.toContain(runtimeActivationId)
    expect(firstPayload).toContain('first breadcrumb')
    expect(firstPayload).not.toContain('second breadcrumb')
    expect(secondPayload).toContain('second breadcrumb')
    expect(secondPayload).not.toContain('first breadcrumb')
  })
})

describe('Sentry Loader lifecycle', () => {
  it('registers the actual private client, drains accepted records, flushes, and closes on disposal', async () => {
    process.env.DOPPELGANGER_TEST_SENTRY_DSN = validDsn
    const order: string[] = []
    let registeredSink: RuntimeLogSink | undefined
    let registeredOptions: RuntimeLogSinkOptions | undefined
    const logging: RuntimeLoggingService = {
      scope: Object.freeze({
        runtimeActivationId,
        sessionId: 'sentry-session',
        runtimePresetId: 'sentry-preset',
      }),
      register(sink, options) {
        registeredSink = sink
        registeredOptions = options
        return async () => { order.push('unregister') }
      },
    }
    const root = new Context().isolate('doppelgangerLogging')
    root.provide('doppelgangerLogging', logging)
    const fiber = root.plugin(SentryLoggingPlugin, {
      dsnEnv: 'DOPPELGANGER_TEST_SENTRY_DSN',
      level: 'error',
      flushTimeoutMs: 250,
      maximumPendingRecords: 7,
    })
    await fiber.await()

    expect(registeredSink).toBeDefined()
    expect(registeredOptions?.maximumPendingRecords).toBe(7)
    expect(registeredOptions?.filter?.(record(1, 'info', 'filtered'))).toBe(false)
    registeredSink?.write(record(2, 'error', 'accepted'))
    await settle()
    expect(JSON.stringify(sentryLoaderTransport.envelopes)).toContain('accepted')

    await Promise.all([fiber.dispose(), fiber.dispose()])
    await settle()

    expect(order).toEqual(['unregister'])
    expect(sentryLoaderTransport.events).toEqual(['flush'])
    expect(sentryLoaderTransport.flushTimeouts).toEqual([250])
    expect(() => registeredSink!.write(record(3, 'error', 'late'))).toThrow('not accepting records')
    await root.fiber.dispose()
  })
})
