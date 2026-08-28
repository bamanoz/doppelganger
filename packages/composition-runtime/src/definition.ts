import { dirname, extname, isAbsolute, normalize } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/
const RESERVED_IMPORTS = new Set(['group', 'include'])
const MOUNT_IMPORT_PREFIX = 'doppelganger-mount-'

export interface MountPointInput {
  readonly target?: string
  readonly required?: boolean
}

export interface MountPoint {
  readonly target?: string
  readonly required: boolean
}

export interface CompositionDefinitionInput {
  readonly id: string
  readonly revision: string
  readonly loaderPath: string
  readonly imports?: Readonly<Record<string, Plugin>>
  readonly mounts?: Readonly<Record<string, MountPointInput>>
}

export interface CompositionDefinition {
  readonly id: string
  readonly revision: string
  readonly loaderPath: string
  readonly root: string
  readonly imports: Readonly<Record<string, Plugin>>
  readonly mounts: Readonly<Record<string, MountPoint>>
}

function nonEmpty(field: string, value: string): string {
  if (value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function validName(field: string, value: string): string {
  value = nonEmpty(field, value)
  if (!NAME_PATTERN.test(value)) throw new TypeError(`${field} must be lowercase kebab-case`)
  return value
}

export function mountImportName(name: string): string {
  return `${MOUNT_IMPORT_PREFIX}${name}`
}

export function createCompositionDefinition(input: CompositionDefinitionInput): CompositionDefinition {
  const id = nonEmpty('composition.id', input.id)
  const revision = nonEmpty('composition.revision', input.revision)
  const loaderPath = normalize(nonEmpty('composition.loaderPath', input.loaderPath))
  if (!isAbsolute(loaderPath)) throw new TypeError('composition.loaderPath must be absolute')
  if (!['.json', '.yaml', '.yml'].includes(extname(loaderPath).toLowerCase())) {
    throw new TypeError('composition.loaderPath must name a .json, .yaml, or .yml Loader tree')
  }

  const imports: Record<string, Plugin> = Object.create(null)
  for (const [rawName, plugin] of Object.entries(input.imports ?? {})) {
    const name = validName(`composition.imports.${rawName}`, rawName)
    if (RESERVED_IMPORTS.has(name) || name.startsWith(MOUNT_IMPORT_PREFIX)) {
      throw new TypeError(`composition import "${name}" is reserved by the runtime`)
    }
    if (plugin === null || (typeof plugin !== 'object' && typeof plugin !== 'function')) {
      throw new TypeError(`composition.imports.${name} must be a Cordis plugin`)
    }
    imports[name] = plugin
  }

  const mounts: Record<string, MountPoint> = Object.create(null)
  for (const [rawName, inputMount] of Object.entries(input.mounts ?? {})) {
    const name = validName(`composition.mounts.${rawName}`, rawName)
    if (inputMount === null || typeof inputMount !== 'object') {
      throw new TypeError(`composition.mounts.${name} must be an object`)
    }
    if (inputMount.required !== undefined && typeof inputMount.required !== 'boolean') {
      throw new TypeError(`composition.mounts.${name}.required must be a boolean`)
    }
    const target = inputMount.target === undefined
      ? undefined
      : nonEmpty(`composition.mounts.${name}.target`, inputMount.target)
    mounts[name] = Object.freeze({
      required: inputMount.required ?? true,
      ...(target === undefined ? {} : { target }),
    })
  }

  return Object.freeze({
    id,
    revision,
    loaderPath,
    root: dirname(loaderPath),
    imports: Object.freeze(imports),
    mounts: Object.freeze(mounts),
  })
}
