import { isAbsolute, normalize } from 'node:path'
import type { MountPoint } from './definition.ts'

export type SerializedPrimitive = boolean | number | string | null
export type SerializedValue =
  | SerializedPrimitive
  | { readonly [key: string]: SerializedValue }
  | readonly SerializedValue[]

export interface SerializedPluginReference {
  readonly module: string
  readonly exportName: string
  readonly mode: 'plugin' | 'factory'
  readonly config?: SerializedValue
}

export interface SerializedCompositionDefinition {
  readonly id: string
  readonly revision: string
  readonly loaderPath: string
  readonly imports: Readonly<Record<string, SerializedPluginReference>>
  readonly mounts: Readonly<Record<string, MountPoint>>
}

export interface SerializedCompositionActivation {
  readonly composition: SerializedCompositionDefinition
  readonly sessionId: string
  readonly mounts: Readonly<Record<string, SerializedPluginReference>>
  readonly hostMount: string
  readonly watch?: boolean
}

export type SerializedActivationResolver<Request = void> = (
  request: Request,
) => SerializedCompositionActivation | undefined | Promise<SerializedCompositionActivation | undefined>

function nonEmpty(field: string, value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return normalized
}

function cloneValue(value: SerializedValue, field: string): SerializedValue {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch (cause) {
    throw new TypeError(`${field} must be JSON-serializable`, { cause })
  }
  if (encoded === undefined) throw new TypeError(`${field} must be JSON-serializable`)
  return JSON.parse(encoded) as SerializedValue
}

function reference(input: SerializedPluginReference, field: string): SerializedPluginReference {
  if (input === null || typeof input !== 'object') throw new TypeError(`${field} must be an object`)
  if (input.mode !== 'plugin' && input.mode !== 'factory') {
    throw new TypeError(`${field}.mode must be "plugin" or "factory"`)
  }
  return Object.freeze({
    module: nonEmpty(`${field}.module`, input.module),
    exportName: nonEmpty(`${field}.exportName`, input.exportName),
    mode: input.mode,
    ...(input.config === undefined ? {} : { config: cloneValue(input.config, `${field}.config`) }),
  })
}

export function defineSerializedCompositionActivation(
  input: SerializedCompositionActivation,
): SerializedCompositionActivation {
  const loaderPath = normalize(nonEmpty('activation.composition.loaderPath', input.composition.loaderPath))
  if (!isAbsolute(loaderPath)) throw new TypeError('activation.composition.loaderPath must be absolute')
  const imports = Object.fromEntries(Object.entries(input.composition.imports).map(([name, value]) => [
    nonEmpty(`activation.composition.imports.${name}`, name),
    reference(value, `activation.composition.imports.${name}`),
  ]))
  const mounts = Object.fromEntries(Object.entries(input.mounts).map(([name, value]) => [
    nonEmpty(`activation.mounts.${name}`, name),
    reference(value, `activation.mounts.${name}`),
  ]))
  const hostMount = nonEmpty('activation.hostMount', input.hostMount)
  if (input.composition.mounts[hostMount] === undefined) {
    throw new TypeError(`activation host mount "${hostMount}" is not declared by the composition`)
  }
  return Object.freeze({
    composition: Object.freeze({
      id: nonEmpty('activation.composition.id', input.composition.id),
      revision: nonEmpty('activation.composition.revision', input.composition.revision),
      loaderPath,
      imports: Object.freeze(imports),
      mounts: Object.freeze(Object.fromEntries(Object.entries(input.composition.mounts).map(([name, point]) => [
        name,
        Object.freeze({ ...point }),
      ]))),
    }),
    sessionId: nonEmpty('activation.sessionId', input.sessionId),
    mounts: Object.freeze(mounts),
    hostMount,
    ...(input.watch === undefined ? {} : { watch: input.watch }),
  })
}
