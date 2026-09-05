import {
  RUNTIME_LOGGING_LIMITS,
  runtimeLogLevelAllows,
  type RuntimeLogRecord,
  type RuntimeLogSeverity,
} from '@doppelganger/doppelganger-composition-runtime'

export interface SentryLoggingConfig {
  readonly dsnEnv: string
  readonly level?: RuntimeLogSeverity
  readonly levels?: Readonly<Record<string, RuntimeLogSeverity>>
  readonly environment?: string
  readonly release?: string
  readonly flushTimeoutMs?: number
  readonly maximumPendingRecords?: number
}

export interface NormalizedSentryLoggingConfig {
  readonly dsnEnv: string
  readonly level: RuntimeLogSeverity
  readonly levels: Readonly<Record<string, RuntimeLogSeverity>>
  readonly environment?: string
  readonly release?: string
  readonly flushTimeoutMs: number
  readonly maximumPendingRecords: number
}

export interface ResolvedSentryLoggingConfig extends NormalizedSentryLoggingConfig {
  readonly dsn: string
}

export const SENTRY_LOGGING_DEFAULTS = Object.freeze({
  level: 'info' as const,
  flushTimeoutMs: 2_000,
  maximumPendingRecords: 1_024,
})

export const SentryLoggingConfigSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1 as const,
    vendor: 'doppelganger',
    validate(value: unknown) {
      try {
        return { value: normalizeSentryLoggingConfig(value) }
      } catch (cause) {
        return { issues: [{ message: cause instanceof Error ? cause.message : String(cause) }] }
      }
    },
  }),
})

const allowedKeys = new Set([
  'dsnEnv',
  'level',
  'levels',
  'environment',
  'release',
  'flushTimeoutMs',
  'maximumPendingRecords',
])
const severities = new Set<RuntimeLogSeverity>(['error', 'warn', 'info', 'debug'])
const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/u

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must be a plain object`)
  return value as Record<string, unknown>
}

function validDsn(value: string): boolean {
  try {
    const url = new URL(value)
    const projectId = url.pathname.split('/').filter(Boolean).at(-1)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username.length > 0
      && url.hostname.length > 0
      && projectId !== undefined
      && url.search.length === 0
      && url.hash.length === 0
  } catch {
    return false
  }
}

function integer(field: string, value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${field} must be an integer from ${minimum} through ${maximum}`)
  }
  return value as number
}

function severity(field: string, value: unknown): RuntimeLogSeverity {
  if (typeof value !== 'string' || !severities.has(value as RuntimeLogSeverity)) {
    throw new TypeError(`${field} must be error, warn, info, or debug`)
  }
  return value as RuntimeLogSeverity
}

function boundedOptional(field: string, value: unknown, maximumBytes: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  if (Buffer.byteLength(value, 'utf8') > maximumBytes) throw new RangeError(`${field} must not exceed ${maximumBytes} UTF-8 bytes`)
  return value
}

export function normalizeSentryLoggingConfig(input: unknown): NormalizedSentryLoggingConfig {
  const object = plainObject(input, 'Sentry logging config')
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Sentry logging config contains unknown field "${key}"`)
  }
  if (typeof object.dsnEnv !== 'string' || object.dsnEnv.length > 256 || !environmentName.test(object.dsnEnv)) {
    throw new TypeError('Sentry logging dsnEnv must name one environment variable of at most 256 characters')
  }
  const levelsInput = object.levels === undefined ? {} : plainObject(object.levels, 'Sentry logging levels')
  const levels: Record<string, RuntimeLogSeverity> = Object.create(null)
  for (const [logger, value] of Object.entries(levelsInput)) {
    if (logger.length === 0 || logger !== logger.trim()) {
      throw new TypeError('Sentry logging level logger names must be non-empty exact names')
    }
    if (Buffer.byteLength(logger, 'utf8') > RUNTIME_LOGGING_LIMITS.maximumLoggerBytes) {
      throw new RangeError(`Sentry logging level logger names must not exceed ${RUNTIME_LOGGING_LIMITS.maximumLoggerBytes} UTF-8 bytes`)
    }
    levels[logger] = severity(`Sentry logging level for "${logger}"`, value)
  }
  const environment = boundedOptional('Sentry logging environment', object.environment, 64)
  if (environment !== undefined && (/\s|\//u.test(environment) || environment === 'None')) {
    throw new TypeError('Sentry logging environment must be a valid Sentry environment name')
  }
  const release = boundedOptional('Sentry logging release', object.release, 200)
  return Object.freeze({
    dsnEnv: object.dsnEnv,
    level: severity('Sentry logging level', object.level ?? SENTRY_LOGGING_DEFAULTS.level),
    levels: Object.freeze(levels),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
    flushTimeoutMs: integer('Sentry logging flushTimeoutMs', object.flushTimeoutMs ?? SENTRY_LOGGING_DEFAULTS.flushTimeoutMs, 100, 60_000),
    maximumPendingRecords: integer(
      'Sentry logging maximumPendingRecords',
      object.maximumPendingRecords ?? SENTRY_LOGGING_DEFAULTS.maximumPendingRecords,
      RUNTIME_LOGGING_LIMITS.minimumPendingRecords,
      RUNTIME_LOGGING_LIMITS.maximumPendingRecords,
    ),
  })
}

export function resolveSentryLoggingConfig(
  config: NormalizedSentryLoggingConfig,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedSentryLoggingConfig {
  const value = environment[config.dsnEnv]
  if (typeof value !== 'string' || value.trim().length === 0 || !validDsn(value)) {
    throw new Error(`Sentry logging DSN environment variable "${config.dsnEnv}" is unavailable or invalid`)
  }
  return Object.freeze({ ...config, dsn: value })
}

export function createSentryLoggingFilter(config: NormalizedSentryLoggingConfig): (record: RuntimeLogRecord) => boolean {
  return record => runtimeLogLevelAllows(record.severity, config.level, config.levels, record.logger)
}
