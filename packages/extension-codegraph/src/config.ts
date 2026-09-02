import { isAbsolute, normalize } from 'node:path'

export interface CodeGraphPluginConfig {
  readonly executable?: string
  readonly statusTimeoutMs?: number
  readonly syncTimeoutMs?: number
  readonly exploreTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
  readonly maximumExploreOutputBytes?: number
  readonly defaultMaxFiles?: number
  readonly maximumConcurrentExplorations?: number
  readonly maximumQueuedExplorations?: number
}

export interface NormalizedCodeGraphPluginConfig {
  readonly executable: string
  readonly statusTimeoutMs: number
  readonly syncTimeoutMs: number
  readonly exploreTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly maximumExploreOutputBytes: number
  readonly defaultMaxFiles: number
  readonly maximumConcurrentExplorations: number
  readonly maximumQueuedExplorations: number
}

export const CODEGRAPH_LIMITS = Object.freeze({
  maximumQueryBytes: 4_096,
  maximumMaxFiles: 32,
  statusOutputBytes: 256 * 1_024,
  stderrBytes: 32 * 1_024,
  statusTimeoutMs: Object.freeze({ defaultValue: 10_000, maximum: 30_000 }),
  syncTimeoutMs: Object.freeze({ defaultValue: 120_000, maximum: 600_000 }),
  exploreTimeoutMs: Object.freeze({ defaultValue: 30_000, maximum: 120_000 }),
  shutdownTimeoutMs: Object.freeze({ defaultValue: 2_000, maximum: 10_000 }),
  maximumExploreOutputBytes: Object.freeze({ defaultValue: 128 * 1_024, maximum: 1_024 * 1_024 }),
  defaultMaxFiles: Object.freeze({ defaultValue: 8, maximum: 32 }),
  maximumConcurrentExplorations: Object.freeze({ defaultValue: 2, maximum: 8 }),
  maximumQueuedExplorations: Object.freeze({ defaultValue: 32, maximum: 256 }),
})

const CONFIG_KEYS: Readonly<Record<string, true>> = Object.freeze({
  executable: true,
  statusTimeoutMs: true,
  syncTimeoutMs: true,
  exploreTimeoutMs: true,
  shutdownTimeoutMs: true,
  maximumExploreOutputBytes: true,
  defaultMaxFiles: true,
  maximumConcurrentExplorations: true,
  maximumQueuedExplorations: true,
})

function record(input: unknown): Readonly<Record<string, unknown>> {
  if (input === undefined) return Object.freeze({})
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new TypeError('CodeGraph configuration must be an object')
  }
  const value = input as Readonly<Record<string, unknown>>
  const unknown = Object.keys(value).filter(key => CONFIG_KEYS[key] !== true).sort()
  if (unknown.length > 0) throw new TypeError(`CodeGraph configuration contains unsupported fields: ${unknown.join(', ')}`)
  return value
}

function boundedInteger(
  input: unknown,
  field: Exclude<keyof typeof CODEGRAPH_LIMITS, 'maximumQueryBytes' | 'maximumMaxFiles' | 'statusOutputBytes' | 'stderrBytes'>,
): number {
  const limit = CODEGRAPH_LIMITS[field]
  if (input === undefined) return limit.defaultValue
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0 || input > limit.maximum) {
    throw new RangeError(`${field} must be an integer between 1 and ${limit.maximum}`)
  }
  return input
}

export function normalizeCodeGraphPluginConfig(input: CodeGraphPluginConfig | unknown = {}): NormalizedCodeGraphPluginConfig {
  const value = record(input)
  let executable = 'codegraph'
  if (value.executable !== undefined) {
    if (typeof value.executable !== 'string' || value.executable.trim().length === 0) {
      throw new TypeError('executable must be a non-empty absolute path')
    }
    executable = normalize(value.executable.trim())
    if (!isAbsolute(executable)) throw new TypeError('executable must be an absolute path')
  }
  return Object.freeze({
    executable,
    statusTimeoutMs: boundedInteger(value.statusTimeoutMs, 'statusTimeoutMs'),
    syncTimeoutMs: boundedInteger(value.syncTimeoutMs, 'syncTimeoutMs'),
    exploreTimeoutMs: boundedInteger(value.exploreTimeoutMs, 'exploreTimeoutMs'),
    shutdownTimeoutMs: boundedInteger(value.shutdownTimeoutMs, 'shutdownTimeoutMs'),
    maximumExploreOutputBytes: boundedInteger(value.maximumExploreOutputBytes, 'maximumExploreOutputBytes'),
    defaultMaxFiles: boundedInteger(value.defaultMaxFiles, 'defaultMaxFiles'),
    maximumConcurrentExplorations: boundedInteger(value.maximumConcurrentExplorations, 'maximumConcurrentExplorations'),
    maximumQueuedExplorations: boundedInteger(value.maximumQueuedExplorations, 'maximumQueuedExplorations'),
  })
}

export const CodeGraphPluginConfigSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1 as const,
    vendor: 'doppelganger',
    validate(value: unknown) {
      try {
        normalizeCodeGraphPluginConfig(value)
        return { value: value === undefined ? Object.freeze({}) : value }
      } catch (cause) {
        return { issues: [{ message: cause instanceof Error ? cause.message : String(cause) }] }
      }
    },
  }),
})
