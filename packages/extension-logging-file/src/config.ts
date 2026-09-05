import { basename, isAbsolute, normalize } from 'node:path'
import {
  RUNTIME_LOGGING_LIMITS,
  runtimeLogLevelAllows,
  type RuntimeLoggingScope,
  type RuntimeLogRecord,
  type RuntimeLogSeverity,
} from '@doppelganger/doppelganger-composition-runtime'

export interface FileLogRetentionConfig {
  readonly maxAgeDays?: number
  readonly maxTotalBytes?: number
  readonly cleanupIntervalMs?: number
}

export interface NormalizedFileLogRetentionConfig {
  readonly maxAgeDays: number
  readonly maxTotalBytes: number
  readonly cleanupIntervalMs: number
}

interface FileLoggingCommonConfig {
  readonly level?: RuntimeLogSeverity
  readonly levels?: Readonly<Record<string, RuntimeLogSeverity>>
  readonly maxBytes?: number
  readonly maxFiles?: number
  readonly maximumPendingRecords?: number
}

export type FileLoggingConfig = FileLoggingCommonConfig & (
  | { readonly path: string; readonly pathTemplate?: never; readonly retention?: never }
  | { readonly path?: never; readonly pathTemplate: string; readonly retention?: FileLogRetentionConfig }
)

interface NormalizedFileLoggingCommonConfig {
  readonly level: RuntimeLogSeverity
  readonly levels: Readonly<Record<string, RuntimeLogSeverity>>
  readonly maxBytes: number
  readonly maxFiles: number
  readonly maximumPendingRecords: number
}

export type NormalizedFileLoggingConfig = NormalizedFileLoggingCommonConfig & (
  | { readonly path: string; readonly pathTemplate?: never; readonly retention?: never }
  | { readonly path?: never; readonly pathTemplate: string; readonly retention?: NormalizedFileLogRetentionConfig }
)

export type ResolvedFileLoggingConfig = NormalizedFileLoggingCommonConfig & {
  readonly path: string
} & (
  | { readonly retention?: never; readonly pathTemplate?: never }
  | { readonly retention: NormalizedFileLogRetentionConfig; readonly pathTemplate: string }
)

export const FILE_LOGGING_DEFAULTS = Object.freeze({
  level: 'info' as const,
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  maximumPendingRecords: 2_048,
  retention: Object.freeze({
    maxAgeDays: 7,
    maxTotalBytes: 512 * 1024 * 1024,
    cleanupIntervalMs: 60_000,
  }),
})

export const FileLoggingConfigSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1 as const,
    vendor: 'doppelganger',
    validate(value: unknown) {
      try {
        return { value: normalizeFileLoggingConfig(value) }
      } catch (cause) {
        return { issues: [{ message: cause instanceof Error ? cause.message : String(cause) }] }
      }
    },
  }),
})

const allowedKeys = new Set(['path', 'pathTemplate', 'level', 'levels', 'maxBytes', 'maxFiles', 'maximumPendingRecords', 'retention'])
const allowedRetentionKeys = new Set(['maxAgeDays', 'maxTotalBytes', 'cleanupIntervalMs'])
const severities = new Set<RuntimeLogSeverity>(['error', 'warn', 'info', 'debug'])
const runtimeActivationIdToken = '{runtimeActivationId}'
const runtimeActivationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

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

function absoluteNormalizedPath(field: string, value: unknown, enforceLength = true): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  if (enforceLength && value.length > 4_096) throw new RangeError(`${field} must not exceed 4096 characters`)
  const path = normalize(value)
  if (!isAbsolute(path)) throw new TypeError(`${field} must be absolute`)
  if (path !== value) throw new TypeError(`${field} must be normalized`)
  return path
}

function activationPathTemplate(value: unknown): string {
  const template = absoluteNormalizedPath('file logging pathTemplate', value)
  const first = template.indexOf(runtimeActivationIdToken)
  if (first < 0 || template.indexOf(runtimeActivationIdToken, first + runtimeActivationIdToken.length) >= 0) {
    throw new TypeError(`file logging pathTemplate must contain exactly one ${runtimeActivationIdToken} placeholder`)
  }
  const remainder = template.slice(0, first) + template.slice(first + runtimeActivationIdToken.length)
  if (remainder.includes('{') || remainder.includes('}')) {
    throw new TypeError(`file logging pathTemplate supports only the ${runtimeActivationIdToken} placeholder`)
  }
  return template
}

function retentionConfig(value: unknown): NormalizedFileLogRetentionConfig {
  const object = plainObject(value, 'file logging retention')
  for (const key of Object.keys(object)) {
    if (!allowedRetentionKeys.has(key)) throw new TypeError(`file logging retention contains unknown field "${key}"`)
  }
  return Object.freeze({
    maxAgeDays: integer('file logging retention maxAgeDays', object.maxAgeDays ?? FILE_LOGGING_DEFAULTS.retention.maxAgeDays, 1, 3_650),
    maxTotalBytes: integer('file logging retention maxTotalBytes', object.maxTotalBytes ?? FILE_LOGGING_DEFAULTS.retention.maxTotalBytes, 64 * 1024, Number.MAX_SAFE_INTEGER),
    cleanupIntervalMs: integer('file logging retention cleanupIntervalMs', object.cleanupIntervalMs ?? FILE_LOGGING_DEFAULTS.retention.cleanupIntervalMs, 1_000, 86_400_000),
  })
}

export function normalizeFileLoggingConfig(input: unknown): NormalizedFileLoggingConfig {
  const object = plainObject(input, 'file logging config')
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) throw new TypeError(`file logging config contains unknown field "${key}"`)
  }
  const hasPath = object.path !== undefined
  const hasPathTemplate = object.pathTemplate !== undefined
  if (hasPath === hasPathTemplate) {
    throw new TypeError('file logging config must define exactly one of path or pathTemplate')
  }
  const destination = hasPath
    ? { path: absoluteNormalizedPath('file logging path', object.path) }
    : { pathTemplate: activationPathTemplate(object.pathTemplate) }
  const retention = object.retention === undefined ? undefined : retentionConfig(object.retention)
  if (retention !== undefined) {
    if (!('pathTemplate' in destination)) throw new TypeError('file logging retention requires pathTemplate')
    if (!basename(destination.pathTemplate).includes(runtimeActivationIdToken)) {
      throw new TypeError(`file logging retention requires ${runtimeActivationIdToken} in the pathTemplate basename`)
    }
  }
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

  const common = {
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
  }
  if ('path' in destination) return Object.freeze({ ...destination, ...common })
  return Object.freeze({ ...destination, ...common, ...(retention === undefined ? {} : { retention }) })
}

export function resolveFileLoggingConfig(
  config: NormalizedFileLoggingConfig,
  scope: RuntimeLoggingScope,
): ResolvedFileLoggingConfig {
  if (!runtimeActivationIdPattern.test(scope.runtimeActivationId)) {
    throw new TypeError('runtime logging scope runtimeActivationId must be a canonical lowercase UUID')
  }
  const path = 'path' in config
    ? config.path
    : config.pathTemplate.replace(runtimeActivationIdToken, scope.runtimeActivationId)
  const resolvedPath = absoluteNormalizedPath('resolved file logging path', path)
  return Object.freeze({
    path: resolvedPath,
    level: config.level,
    levels: config.levels,
    maxBytes: config.maxBytes,
    maxFiles: config.maxFiles,
    maximumPendingRecords: config.maximumPendingRecords,
    ...(config.retention === undefined ? {} : {
      pathTemplate: config.pathTemplate,
      retention: config.retention,
    }),
  })
}

export function createFileLoggingFilter(config: Pick<NormalizedFileLoggingConfig, 'level' | 'levels'>): (record: RuntimeLogRecord) => boolean {
  return record => runtimeLogLevelAllows(record.severity, config.level, config.levels, record.logger)
}
