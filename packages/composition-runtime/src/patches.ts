import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { load } from 'js-yaml'
import {
  RuntimeConfigurationError,
  type RuntimeConfigurationDiagnostic,
} from '@doppelganger/doppelganger-runtime-presets'

export const RUNTIME_ENTRY_PREFIX = 'doppelganger-runtime-'
export const RUNTIME_IMPORT_PREFIX = `cordis:${RUNTIME_ENTRY_PREFIX}`

export interface CompositionPatchLayer {
  readonly source: string
  readonly baseUrl: string
  readonly patches: readonly PatchOptions[]
}

export interface CompositionPatchFile {
  readonly source: string
  readonly filename: string
  readonly optional: boolean
}

export type CompositionPatchInput = CompositionPatchLayer | CompositionPatchFile

export class CompositionLayerError extends Error {
  readonly code = 'INVALID_COMPOSITION_LAYER'
  readonly source: string
  readonly patchIndex?: number
  readonly targetId?: string

  constructor(
    source: string,
    message: string,
    options: { readonly patchIndex?: number; readonly targetId?: string; readonly cause?: unknown } = {},
  ) {
    super(
      `invalid composition layer ${source}`
      + (options.patchIndex === undefined ? '' : ` at patch ${options.patchIndex}`)
      + `: ${message}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.source = source
    if (options.patchIndex !== undefined) this.patchIndex = options.patchIndex
    if (options.targetId !== undefined) this.targetId = options.targetId
    this.name = 'CompositionLayerError'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return
  return value as Record<string, unknown>
}

function reservedEntry(entry: Readonly<Record<string, unknown>>, source: string, path: string): void {
  if (typeof entry.id === 'string' && entry.id.startsWith(RUNTIME_ENTRY_PREFIX)) {
    throw new CompositionLayerError(source, `${path}.id uses reserved prefix "${RUNTIME_ENTRY_PREFIX}"`, {
      targetId: entry.id,
    })
  }
  if (typeof entry.name === 'string' && entry.name.startsWith(RUNTIME_IMPORT_PREFIX)) {
    throw new CompositionLayerError(source, `${path}.name uses reserved import prefix "${RUNTIME_IMPORT_PREFIX}"`)
  }
}

function validateEntryList(
  value: unknown,
  source: string,
  path: string,
  diagnostics: RuntimeConfigurationDiagnostic[],
  checkReserved: boolean,
): value is EntryOptions[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ path, message: 'must be an array of Loader entries' })
    return false
  }
  const initialDiagnosticCount = diagnostics.length
  value.forEach((candidate, index) => {
    const entryPath = `${path}[${index}]`
    const entry = record(candidate)
    if (entry === undefined) {
      diagnostics.push({ path: entryPath, message: 'must be a Loader entry object' })
      return
    }
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      diagnostics.push({ path: `${entryPath}.id`, message: 'must be a non-empty string' })
    }
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      diagnostics.push({ path: `${entryPath}.name`, message: 'must be a non-empty string' })
    }
    if (checkReserved) reservedEntry(entry, source, entryPath)
    if (entry.group === true && entry.config !== undefined) {
      validateEntryList(entry.config, source, `${entryPath}.config`, diagnostics, checkReserved)
    }
  })
  return diagnostics.length === initialDiagnosticCount
}

function anchorInsertedEntries(entries: EntryOptions[], baseUrl: string): void {
  for (const entry of entries) {
    if (entry.name.startsWith('./') || entry.name.startsWith('../')) {
      entry.name = pathToFileURL(resolve(baseUrl, entry.name)).href
    }
    if (entry.group === true && Array.isArray(entry.config)) {
      anchorInsertedEntries(entry.config as EntryOptions[], baseUrl)
    }
  }
}

export function defineCompositionPatchLayer(input: CompositionPatchLayer): CompositionPatchLayer {
  const source = input.source.trim()
  if (source.length === 0) throw new TypeError('composition patch source must be non-empty')
  const baseUrl = normalize(input.baseUrl)
  if (!isAbsolute(baseUrl)) throw new TypeError(`composition patch baseUrl must be absolute: ${input.baseUrl}`)
  const patches = structuredClone(input.patches) as PatchOptions[]
  const diagnostics: RuntimeConfigurationDiagnostic[] = []
  patches.forEach((candidate, index) => {
    const patchPath = `$[${index}]`
    const patch = record(candidate)
    if (patch === undefined) {
      diagnostics.push({ path: patchPath, message: 'must be a patch object' })
      return
    }
    if (patch.id !== undefined && (typeof patch.id !== 'string' || patch.id.trim().length === 0)) {
      diagnostics.push({ path: `${patchPath}.id`, message: 'must be a non-empty string when present' })
    }
    if (patch.name !== undefined && (typeof patch.name !== 'string' || patch.name.trim().length === 0)) {
      diagnostics.push({ path: `${patchPath}.name`, message: 'must be a non-empty string when present' })
    }
    if (patch.insert !== undefined) {
      if (validateEntryList(patch.insert, source, `${patchPath}.insert`, diagnostics, true)) {
        anchorInsertedEntries(patch.insert, baseUrl)
      }
    } else if (patch.id === undefined) {
      diagnostics.push({ path: `${patchPath}.id`, message: 'is required for non-insert patches' })
    }
    if (typeof patch.id === 'string' && patch.id.startsWith(RUNTIME_ENTRY_PREFIX)) {
      throw new CompositionLayerError(source, `${patchPath}.id targets a runtime-reserved entry`, {
        patchIndex: index,
        targetId: patch.id,
      })
    }
  })
  if (diagnostics.length > 0) throw new RuntimeConfigurationError(source, diagnostics)
  return Object.freeze({ source, baseUrl, patches: Object.freeze(patches) })
}

export async function loadCompositionPatchFile(
  input: CompositionPatchFile,
): Promise<CompositionPatchLayer | undefined> {
  const filename = normalize(resolve(input.filename))
  let content: string
  try {
    content = await readFile(filename, 'utf8')
  } catch (cause) {
    if (input.optional && (cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new RuntimeConfigurationError(filename, [{ path: '$', message: 'cannot read patch file' }], cause)
  }
  let value: unknown
  try {
    value = load(content, { schema: entryListSchema })
  } catch (cause) {
    throw new RuntimeConfigurationError(filename, [{ path: '$', message: 'invalid patch YAML' }], cause)
  }
  if (!Array.isArray(value)) {
    throw new RuntimeConfigurationError(filename, [{ path: '$', message: 'must be a top-level patch array; use [] for no patches' }])
  }
  return defineCompositionPatchLayer({ source: input.source, baseUrl: dirname(filename), patches: value as PatchOptions[] })
}

export function validateCompositionEntries(entries: readonly EntryOptions[], source: string): void {
  const diagnostics: RuntimeConfigurationDiagnostic[] = []
  validateEntryList(entries, source, '$', diagnostics, true)
  if (diagnostics.length > 0) throw new RuntimeConfigurationError(source, diagnostics)
  const ids = new Set<string>()
  const visit = (items: readonly EntryOptions[]): void => {
    for (const entry of items) {
      if (ids.has(entry.id)) throw new CompositionLayerError(source, `duplicate entry ID "${entry.id}"`, { targetId: entry.id })
      ids.add(entry.id)
      if (entry.group === true && Array.isArray(entry.config)) visit(entry.config as EntryOptions[])
    }
  }
  visit(entries)
}

function preflightPatches(base: readonly EntryOptions[], layers: readonly CompositionPatchLayer[]): PatchOptions[] {
  const data = structuredClone(base) as EntryOptions[]
  const entries = new Map<string, EntryOptions>()
  const index = (items: readonly EntryOptions[], source: string): void => {
    for (const entry of items) {
      if (entries.has(entry.id)) throw new CompositionLayerError(source, `duplicate entry ID "${entry.id}"`, { targetId: entry.id })
      entries.set(entry.id, entry)
      if (entry.group === true && Array.isArray(entry.config)) index(entry.config as EntryOptions[], source)
    }
  }
  index(data, 'base composition')
  const flattened: PatchOptions[] = []
  for (const layer of layers) {
    for (const [patchIndex, patch] of layer.patches.entries()) {
      flattened.push(patch)
      if (patch.insert !== undefined) {
        const inserted = patch.insert as EntryOptions[]
        if (patch.id === undefined) {
          data.push(...inserted)
        } else {
          const target = entries.get(patch.id)
          if (target === undefined) {
            throw new CompositionLayerError(layer.source, `target entry "${patch.id}" was not produced by earlier layers`, {
              patchIndex,
              targetId: patch.id,
            })
          }
          if (target.group !== true) {
            throw new CompositionLayerError(layer.source, `target entry "${patch.id}" is not a group`, {
              patchIndex,
              targetId: patch.id,
            })
          }
          if (!Array.isArray(target.config)) target.config = []
          ;(target.config as EntryOptions[]).push(...inserted)
        }
        index(inserted, layer.source)
        continue
      }
      const id = patch.id as string
      const target = entries.get(id)
      if (target === undefined) {
        throw new CompositionLayerError(layer.source, `target entry "${id}" was not produced by earlier layers`, {
          patchIndex,
          targetId: id,
        })
      }
      if (patch.name !== undefined && patch.name !== target.name) {
        throw new CompositionLayerError(
          layer.source,
          `target name mismatch for "${id}": expected "${target.name}", got "${patch.name}"`,
          { patchIndex, targetId: id },
        )
      }
      const { id: _id, name: _name, insert: _insert, ...overrides } = patch
      Object.assign(target, overrides)
    }
  }
  return flattened
}

export function flattenCompositionPatches(
  base: readonly EntryOptions[],
  layers: readonly CompositionPatchLayer[],
): PatchOptions[] {
  validateCompositionEntries(base, 'base composition')
  return preflightPatches(base, layers)
}

export function composeCompositionEntries(
  base: readonly EntryOptions[],
  layers: readonly CompositionPatchLayer[],
): EntryOptions[] {
  const flattened = flattenCompositionPatches(base, layers)
  const warnings: string[] = []
  const result = applyEntryPatches(structuredClone(base) as EntryOptions[], flattened, (message, ...args) => {
    let index = 0
    warnings.push(message.replace(/%C/g, () => JSON.stringify(args[index++])))
  })
  if (warnings.length > 0) {
    throw new CompositionLayerError('effective composition', warnings.join('; '))
  }
  return result
}
