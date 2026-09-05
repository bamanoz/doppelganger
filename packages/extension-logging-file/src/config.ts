import { isAbsolute, normalize } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import {
  RUNTIME_LOGGING_LIMITS,
  runtimeLogLevelAllows,
  type RuntimeLogRecord,
  type RuntimeLogSeverity,
} from '@doppelganger/doppelganger-composition-runtime'

export interface FileLoggingConfig {
  readonly path: string
  readonly level?: RuntimeLogSeverity
  readonly levels?: Readonly<Record<string, RuntimeLogSeverity>>
  readonly maxBytes?: number
  readonly maxFiles?: number
  readonly maximumPendingRecords?: number
}

export interface NormalizedFileLoggingConfig {
  readonly path: string
  readonly level: RuntimeLogSeverity
  readonly levels: Readonly<Record<string, RuntimeLogSeverity>>
  readonly maxBytes: number
  readonly maxFiles: number
  readonly maximumPendingRecords: number
}

export const FILE_LOGGING_DEFAULTS = Object.freeze({
  level: 'info' as const,
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  maximumPendingRecords: 2_048,
})

const severitySchema = Schema.union(['error', 'warn', 'info', 'debug'])

export const FileLoggingConfigSchema: Schema<FileLoggingConfig> = Schema.object({
  path: Schema.string().min(1).max(4_096).required(),
  level: severitySchema.default(FILE_LOGGING_DEFAULTS.level),
  levels: Schema.dict(severitySchema).default({}),
  maxBytes: Schema.natural().min(64 * 1024).max(1024 * 1024 * 1024).default(FILE_LOGGING_DEFAULTS.maxBytes),
  maxFiles: Schema.natural().min(1).max(100).default(FILE_LOGGING_DEFAULTS.maxFiles),
  maximumPendingRecords: Schema.natural()
    .min(RUNTIME_LOGGING_LIMITS.minimumPendingRecords)
    .max(RUNTIME_LOGGING_LIMITS.maximumPendingRecords)
    .default(FILE_LOGGING_DEFAULTS.maximumPendingRecords),
})

const allowedKeys = new Set(['path', 'level', 'levels', 'maxBytes', 'maxFiles', 'maximumPendingRecords'])
const severities = new Set<RuntimeLogSeverity>(['error', 'warn', 'info', 'debug'])

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must be a plain object`)
  return value as Record<string, unknown>
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

export function normalizeFileLoggingConfig(input: unknown): NormalizedFileLoggingConfig {
  const object = plainObject(input, 'file logging config')
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) throw new TypeError(`file logging config contains unknown field "${key}"`)
  }
  if (typeof object.path !== 'string' || object.path.length === 0) {
    throw new TypeError('file logging path must be a non-empty string')
  }
  const path = normalize(object.path)
  if (!isAbsolute(path)) throw new TypeError('file logging path must be absolute')
  if (path !== object.path) throw new TypeError('file logging path must be normalized')

  const levelsInput = object.levels === undefined ? {} : plainObject(object.levels, 'file logging levels')
  const levels: Record<string, RuntimeLogSeverity> = Object.create(null)
  for (const [logger, value] of Object.entries(levelsInput)) {
    if (logger.length === 0 || logger !== logger.trim()) {
      throw new TypeError('file logging level logger names must be non-empty exact names')
    }
    if (Buffer.byteLength(logger, 'utf8') > RUNTIME_LOGGING_LIMITS.maximumLoggerBytes) {
      throw new RangeError(`file logging level logger names must not exceed ${RUNTIME_LOGGING_LIMITS.maximumLoggerBytes} UTF-8 bytes`)
    }
    levels[logger] = severity(`file logging level for "${logger}"`, value)
  }

  return Object.freeze({
    path,
    level: severity('file logging level', object.level ?? FILE_LOGGING_DEFAULTS.level),
    levels: Object.freeze(levels),
    maxBytes: integer('file logging maxBytes', object.maxBytes ?? FILE_LOGGING_DEFAULTS.maxBytes, 64 * 1024, 1024 * 1024 * 1024),
    maxFiles: integer('file logging maxFiles', object.maxFiles ?? FILE_LOGGING_DEFAULTS.maxFiles, 1, 100),
    maximumPendingRecords: integer(
      'file logging maximumPendingRecords',
      object.maximumPendingRecords ?? FILE_LOGGING_DEFAULTS.maximumPendingRecords,
      RUNTIME_LOGGING_LIMITS.minimumPendingRecords,
      RUNTIME_LOGGING_LIMITS.maximumPendingRecords,
    ),
  })
}

export function createFileLoggingFilter(config: NormalizedFileLoggingConfig): (record: RuntimeLogRecord) => boolean {
  return record => runtimeLogLevelAllows(record.severity, config.level, config.levels, record.logger)
}
