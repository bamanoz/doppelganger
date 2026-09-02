export interface DynamicRuntimePluginsConfig {
  readonly vmTimeoutMs?: number
  readonly maximumSourceBytes?: number
  readonly maximumNameLength?: number
  readonly maximumPurposeLength?: number
  readonly maximumPlugins?: number
  readonly maximumPackagesPerPlugin?: number
  readonly maximumTotalSourceBytes?: number
  readonly maximumInspectionBytes?: number
  readonly maximumDiagnosticMessageLength?: number
  readonly maximumDiagnosticStackLength?: number
}

export interface NormalizedDynamicRuntimePluginsConfig {
  readonly vmTimeoutMs: number
  readonly maximumSourceBytes: number
  readonly maximumNameLength: number
  readonly maximumPurposeLength: number
  readonly maximumPlugins: number
  readonly maximumPackagesPerPlugin: number
  readonly maximumTotalSourceBytes: number
  readonly maximumInspectionBytes: number
  readonly maximumDiagnosticMessageLength: number
  readonly maximumDiagnosticStackLength: number
}

const LIMITS = Object.freeze({
  vmTimeoutMs: Object.freeze({ defaultValue: 1_000, maximum: 10_000 }),
  maximumSourceBytes: Object.freeze({ defaultValue: 64 * 1_024, maximum: 1_024 * 1_024 }),
  maximumNameLength: Object.freeze({ defaultValue: 128, maximum: 1_024 }),
  maximumPurposeLength: Object.freeze({ defaultValue: 1_024, maximum: 8_192 }),
  maximumPlugins: Object.freeze({ defaultValue: 32, maximum: 256 }),
  maximumPackagesPerPlugin: Object.freeze({ defaultValue: 32, maximum: 256 }),
  maximumTotalSourceBytes: Object.freeze({ defaultValue: 512 * 1_024, maximum: 8 * 1_024 * 1_024 }),
  maximumInspectionBytes: Object.freeze({ defaultValue: 64 * 1_024, maximum: 1_024 * 1_024 }),
  maximumDiagnosticMessageLength: Object.freeze({ defaultValue: 2_048, maximum: 16_384 }),
  maximumDiagnosticStackLength: Object.freeze({ defaultValue: 8_192, maximum: 65_536 }),
})

function record(input: unknown): Readonly<Record<string, unknown>> {
  if (input === undefined) return Object.freeze({})
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new TypeError('dynamic runtime plugins configuration must be an object')
  }
  const value = input as Readonly<Record<string, unknown>>
  const allowed = new Set(Object.keys(LIMITS))
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new TypeError(`dynamic runtime plugins configuration contains unsupported fields: ${unknown.sort().join(', ')}`)
  }
  return value
}

function boundedInteger(
  input: unknown,
  field: keyof typeof LIMITS,
): number {
  const limit = LIMITS[field]
  if (input === undefined) return limit.defaultValue
  if (typeof input !== 'number' || !Number.isFinite(input) || !Number.isSafeInteger(input)) {
    throw new TypeError(`${field} must be a finite safe integer`)
  }
  if (input <= 0 || input > limit.maximum) {
    throw new RangeError(`${field} must be between 1 and ${limit.maximum}`)
  }
  return input
}

export function normalizeDynamicRuntimePluginsConfig(
  input: DynamicRuntimePluginsConfig | unknown = {},
): NormalizedDynamicRuntimePluginsConfig {
  const value = record(input)
  const normalized = {
    vmTimeoutMs: boundedInteger(value.vmTimeoutMs, 'vmTimeoutMs'),
    maximumSourceBytes: boundedInteger(value.maximumSourceBytes, 'maximumSourceBytes'),
    maximumNameLength: boundedInteger(value.maximumNameLength, 'maximumNameLength'),
    maximumPurposeLength: boundedInteger(value.maximumPurposeLength, 'maximumPurposeLength'),
    maximumPlugins: boundedInteger(value.maximumPlugins, 'maximumPlugins'),
    maximumPackagesPerPlugin: boundedInteger(value.maximumPackagesPerPlugin, 'maximumPackagesPerPlugin'),
    maximumTotalSourceBytes: boundedInteger(value.maximumTotalSourceBytes, 'maximumTotalSourceBytes'),
    maximumInspectionBytes: boundedInteger(value.maximumInspectionBytes, 'maximumInspectionBytes'),
    maximumDiagnosticMessageLength: boundedInteger(
      value.maximumDiagnosticMessageLength,
      'maximumDiagnosticMessageLength',
    ),
    maximumDiagnosticStackLength: boundedInteger(value.maximumDiagnosticStackLength, 'maximumDiagnosticStackLength'),
  }
  if (normalized.maximumSourceBytes > normalized.maximumTotalSourceBytes) {
    throw new RangeError('maximumSourceBytes must not exceed maximumTotalSourceBytes')
  }
  return Object.freeze(normalized)
}
export const DynamicRuntimePluginsConfigSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1 as const,
    vendor: 'doppelganger',
    validate(value: unknown) {
      try {
        return { value: normalizeDynamicRuntimePluginsConfig(value) }
      } catch (cause) {
        return {
          issues: [{ message: cause instanceof Error ? cause.message : String(cause) }],
        }
      }
    },
  }),
})
