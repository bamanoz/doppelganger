import { extname, isAbsolute, normalize } from 'node:path'
import type { CompositionPatchInput } from './patches.ts'

const RUNTIME_PRESET_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const LOADER_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])

export interface CanonicalCompositionInput {
  readonly id: string
  readonly revision: string
  readonly loaderPath: string
  readonly patches?: readonly CompositionPatchInput[]
}

export interface CanonicalCompositionDefinition {
  readonly id: string
  readonly revision: string
  readonly loaderPath: string
  readonly patches: readonly CompositionPatchInput[]
}

export function canonicalNonEmpty(field: string, value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return normalized
}

export function canonicalAbsolutePath(field: string, value: string): string {
  const path = normalize(canonicalNonEmpty(field, value))
  if (!isAbsolute(path)) throw new TypeError(`${field} must be absolute`)
  return path
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function canonicalPatch(input: CompositionPatchInput, index: number, prefix: string): CompositionPatchInput {
  const field = `${prefix}.patches[${index}]`
  const source = canonicalNonEmpty(`${field}.source`, input.source)
  if ('filename' in input) {
    return Object.freeze({
      source,
      filename: canonicalAbsolutePath(`${field}.filename`, input.filename),
      optional: input.optional,
    })
  }
  return Object.freeze({
    source,
    baseUrl: canonicalAbsolutePath(`${field}.baseUrl`, input.baseUrl),
    patches: deepFreeze(structuredClone(input.patches)),
  })
}

export function canonicalizeCompositionDefinition(
  input: CanonicalCompositionInput,
  prefix: string,
): CanonicalCompositionDefinition {
  const id = canonicalNonEmpty(`${prefix}.id`, input.id)
  if (!RUNTIME_PRESET_ID_PATTERN.test(id)) {
    throw new TypeError(`${prefix}.id must be a lowercase kebab-case Runtime Preset ID`)
  }
  const loaderPath = canonicalAbsolutePath(`${prefix}.loaderPath`, input.loaderPath)
  if (!LOADER_EXTENSIONS.has(extname(loaderPath).toLowerCase())) {
    throw new TypeError(`${prefix}.loaderPath must name a .json, .yaml, or .yml Loader tree`)
  }
  return Object.freeze({
    id,
    revision: canonicalNonEmpty(`${prefix}.revision`, input.revision),
    loaderPath,
    patches: Object.freeze((input.patches ?? []).map((patch, index) => canonicalPatch(patch, index, prefix))),
  })
}
