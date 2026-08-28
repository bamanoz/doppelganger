import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { MountPointInput } from '@doppelganger/composition-runtime'
import type { JsonValue } from '@doppelganger/extension-protocols'
import { load } from 'js-yaml'

export interface ConfigDiagnostic {
  readonly path: string
  readonly message: string
}

export class PersonaConfigError extends Error {
  readonly code = 'INVALID_CONFIGURATION'
  constructor(
    public readonly filename: string,
    public readonly diagnostics: readonly ConfigDiagnostic[],
    cause?: unknown,
  ) {
    super(
      `invalid Doppelganger configuration at ${filename}:\n${diagnostics.map(diagnostic => (
        `${diagnostic.path}: ${diagnostic.message}`
      )).join('\n')}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'PersonaConfigError'
  }
}

export interface UserPersonaConfig {
  readonly version: 1
  readonly principalId: string
  readonly defaultInstance?: string
  readonly instances: Readonly<Record<string, string>>
}

export interface ProjectPersonaManifest {
  readonly version: 1
  readonly projectId: string
  readonly instanceId: string
  readonly traits: readonly string[]
}

export interface PersonaInstanceMetadata {
  readonly version: 1
  readonly id: string
  readonly definition: string
  readonly settings: Readonly<Record<string, JsonValue>>
}

export interface PersonaAssetDefinition {
  readonly path: string
  readonly priority?: number
}

export interface PersonaDefinitionMetadata {
  readonly version: 1
  readonly id: string
  readonly revision: string
  readonly loader: string
  readonly identity?: PersonaAssetDefinition
  readonly traits: Readonly<Record<string, PersonaAssetDefinition>>
  readonly mounts: Readonly<Record<string, MountPointInput>>
}

export interface LoadedPersonaDefinition extends PersonaDefinitionMetadata {
  readonly root: string
  readonly metadataPath: string
  readonly loaderPath: string
  readonly entries: readonly EntryOptions[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return
  return value as Record<string, unknown>
}
function jsonValue(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    diagnostics.push({ path, message: 'must be a finite JSON number' })
    return
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = []
    value.forEach((item, index) => {
      const parsed = jsonValue(item, `${path}[${index}]`, diagnostics)
      if (parsed !== undefined) result.push(parsed)
    })
    return result
  }
  const object = record(value)
  if (object !== undefined) {
    const result: Record<string, JsonValue> = Object.create(null)
    for (const [key, item] of Object.entries(object)) {
      const parsed = jsonValue(item, `${path}.${key}`, diagnostics)
      if (parsed !== undefined) result[key] = parsed
    }
    return result
  }
  diagnostics.push({ path, message: 'must be JSON-compatible' })
  return
}


function validateKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  const known = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!known.has(key)) diagnostics.push({ path: `${path}.${key}`, message: 'unknown field' })
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: ConfigDiagnostic[],
): string {
  const candidate = value[key]
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    diagnostics.push({ path: `${path}.${key}`, message: 'must be a non-empty string' })
    return ''
  }
  return candidate.trim()
}

function versionOne(
  value: Record<string, unknown>,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (value.version !== 1) diagnostics.push({ path: `${path}.version`, message: 'must equal 1' })
}

async function readYaml(filename: string): Promise<unknown> {
  let content: string
  try {
    content = await readFile(filename, 'utf8')
  } catch (cause) {
    throw new PersonaConfigError(filename, [{ path: '$', message: 'cannot read file' }], cause)
  }
  try {
    return load(content, { schema: entryListSchema })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new PersonaConfigError(filename, [{ path: '$', message: `cannot parse YAML: ${message}` }], cause)
  }
}

function checkedRoot(filename: string, value: unknown): {
  root: Record<string, unknown>
  diagnostics: ConfigDiagnostic[]
} {
  const root = record(value)
  if (root === undefined) {
    throw new PersonaConfigError(filename, [{ path: '$', message: 'must be an object' }])
  }
  return { root, diagnostics: [] }
}

function throwDiagnostics(filename: string, diagnostics: ConfigDiagnostic[]): void {
  if (diagnostics.length > 0) throw new PersonaConfigError(filename, Object.freeze(diagnostics))
}

function resolveFrom(filename: string, target: string): string {
  return isAbsolute(target) ? resolve(target) : resolve(dirname(filename), target)
}

export async function loadUserPersonaConfig(filename: string): Promise<UserPersonaConfig> {
  filename = resolve(filename)
  const { root, diagnostics } = checkedRoot(filename, await readYaml(filename))
  validateKeys(root, ['version', 'principalId', 'defaultInstance', 'instances'], '$', diagnostics)
  versionOne(root, '$', diagnostics)
  const principalId = requiredString(root, 'principalId', '$', diagnostics)
  const instancesValue = record(root.instances)
  const instances: Record<string, string> = Object.create(null)
  if (instancesValue === undefined) {
    diagnostics.push({ path: '$.instances', message: 'must be an object mapping instance IDs to metadata paths' })
  } else {
    for (const [id, target] of Object.entries(instancesValue)) {
      if (id.trim().length === 0) diagnostics.push({ path: '$.instances', message: 'instance IDs must be non-empty' })
      if (typeof target !== 'string' || target.trim().length === 0) {
        diagnostics.push({ path: `$.instances.${id}`, message: 'must be a non-empty path string' })
      } else {
        instances[id] = resolveFrom(filename, target)
      }
    }
  }
  let defaultInstance: string | undefined
  if (root.defaultInstance !== undefined) {
    if (typeof root.defaultInstance !== 'string' || root.defaultInstance.trim().length === 0) {
      diagnostics.push({ path: '$.defaultInstance', message: 'must be a non-empty instance ID' })
    } else {
      defaultInstance = root.defaultInstance.trim()
      if (instancesValue !== undefined && !(defaultInstance in instances)) {
        diagnostics.push({ path: '$.defaultInstance', message: `unknown instance "${defaultInstance}"` })
      }
    }
  }
  throwDiagnostics(filename, diagnostics)
  return Object.freeze({
    version: 1,
    principalId,
    ...(defaultInstance === undefined ? {} : { defaultInstance }),
    instances: Object.freeze(instances),
  })
}

export async function loadProjectPersonaManifest(filename: string): Promise<ProjectPersonaManifest> {
  filename = resolve(filename)
  const { root, diagnostics } = checkedRoot(filename, await readYaml(filename))
  validateKeys(root, ['version', 'projectId', 'instanceId', 'traits'], '$', diagnostics)
  versionOne(root, '$', diagnostics)
  const projectId = requiredString(root, 'projectId', '$', diagnostics)
  const instanceId = requiredString(root, 'instanceId', '$', diagnostics)
  const traits: string[] = []
  const seen = new Set<string>()
  if (root.traits !== undefined && !Array.isArray(root.traits)) {
    diagnostics.push({ path: '$.traits', message: 'must be an array of trait names' })
  } else {
    for (const [index, trait] of (root.traits ?? []).entries()) {
      if (typeof trait !== 'string' || trait.trim().length === 0) {
        diagnostics.push({ path: `$.traits[${index}]`, message: 'must be a non-empty string' })
        continue
      }
      const name = trait.trim()
      if (seen.has(name)) {
        diagnostics.push({ path: `$.traits[${index}]`, message: `duplicate trait "${name}"` })
        continue
      }
      seen.add(name)
      traits.push(name)
    }
  }
  throwDiagnostics(filename, diagnostics)
  return Object.freeze({ version: 1, projectId, instanceId, traits: Object.freeze(traits) })
}

export async function loadPersonaInstanceMetadata(filename: string): Promise<PersonaInstanceMetadata> {
  filename = resolve(filename)
  const { root, diagnostics } = checkedRoot(filename, await readYaml(filename))
  validateKeys(root, ['version', 'id', 'definition', 'settings'], '$', diagnostics)
  versionOne(root, '$', diagnostics)
  const id = requiredString(root, 'id', '$', diagnostics)
  const definition = requiredString(root, 'definition', '$', diagnostics)
  const settingsValue = root.settings === undefined ? {} : jsonValue(root.settings, '$.settings', diagnostics)
  const settings = settingsValue !== null && !Array.isArray(settingsValue) && typeof settingsValue === 'object'
    ? settingsValue as Readonly<Record<string, JsonValue>>
    : {}
  if (root.settings !== undefined && settingsValue === undefined) {
    diagnostics.push({ path: '$.settings', message: 'must be a JSON object' })
  } else if (root.settings !== undefined && (settingsValue === null || Array.isArray(settingsValue) || typeof settingsValue !== 'object')) {
    diagnostics.push({ path: '$.settings', message: 'must be a JSON object' })
  }
  throwDiagnostics(filename, diagnostics)
  return Object.freeze({
    version: 1,
    id,
    definition: resolveFrom(filename, definition),
    settings: Object.freeze(settings),
  })
}

function assetDefinition(
  filename: string,
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): PersonaAssetDefinition | undefined {
  const object = record(value)
  if (object === undefined) {
    diagnostics.push({ path, message: 'must be an object' })
    return
  }
  validateKeys(object, ['path', 'priority'], path, diagnostics)
  const assetPath = requiredString(object, 'path', path, diagnostics)
  let priority: number | undefined
  if (object.priority !== undefined) {
    if (typeof object.priority !== 'number' || !Number.isFinite(object.priority)) {
      diagnostics.push({ path: `${path}.priority`, message: 'must be a finite number' })
    } else {
      priority = object.priority
    }
  }
  return Object.freeze({
    path: resolveFrom(filename, assetPath),
    ...(priority === undefined ? {} : { priority }),
  })
}

function validateLoaderEntries(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
  seen: Set<string>,
): EntryOptions[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ path, message: 'must be a top-level array of Loader entries' })
    return []
  }
  const entries: EntryOptions[] = []
  for (const [index, candidate] of value.entries()) {
    const entryPath = `${path}[${index}]`
    const object = record(candidate)
    if (object === undefined) {
      diagnostics.push({ path: entryPath, message: 'must be an object' })
      continue
    }
    const id = requiredString(object, 'id', entryPath, diagnostics)
    requiredString(object, 'name', entryPath, diagnostics)
    if (id.length > 0 && seen.has(id)) diagnostics.push({ path: `${entryPath}.id`, message: `duplicate entry ID "${id}"` })
    seen.add(id)
    if (object.group === true) validateLoaderEntries(object.config, `${entryPath}.config`, diagnostics, seen)
    entries.push(candidate as EntryOptions)
  }
  return entries
}

export async function loadPersonaDefinitionMetadata(filename: string): Promise<LoadedPersonaDefinition> {
  filename = resolve(filename)
  const { root, diagnostics } = checkedRoot(filename, await readYaml(filename))
  validateKeys(root, ['version', 'id', 'revision', 'loader', 'identity', 'traits', 'mounts'], '$', diagnostics)
  versionOne(root, '$', diagnostics)
  const id = requiredString(root, 'id', '$', diagnostics)
  const revision = requiredString(root, 'revision', '$', diagnostics)
  const loaderTarget = requiredString(root, 'loader', '$', diagnostics)
  const identity = root.identity === undefined
    ? undefined
    : assetDefinition(filename, root.identity, '$.identity', diagnostics)
  const traitsValue = record(root.traits)
  const traits: Record<string, PersonaAssetDefinition> = Object.create(null)
  if (root.traits !== undefined && traitsValue === undefined) {
    diagnostics.push({ path: '$.traits', message: 'must be an object mapping trait names to assets' })
  } else if (traitsValue !== undefined) {
    for (const [name, value] of Object.entries(traitsValue)) {
      if (name.trim().length === 0) diagnostics.push({ path: '$.traits', message: 'trait names must be non-empty' })
      const asset = assetDefinition(filename, value, `$.traits.${name}`, diagnostics)
      if (asset !== undefined) traits[name] = asset
    }
  }
  const mountsValue = record(root.mounts)
  const mounts: Record<string, MountPointInput> = Object.create(null)
  if (root.mounts !== undefined && mountsValue === undefined) {
    diagnostics.push({ path: '$.mounts', message: 'must be an object mapping mount names to declarations' })
  } else if (mountsValue !== undefined) {
    for (const [name, value] of Object.entries(mountsValue)) {
      const mountPath = `$.mounts.${name}`
      const mount = record(value)
      if (name.trim().length === 0) diagnostics.push({ path: '$.mounts', message: 'mount names must be non-empty' })
      if (mount === undefined) {
        diagnostics.push({ path: mountPath, message: 'must be an object' })
        continue
      }
      validateKeys(mount, ['target', 'required'], mountPath, diagnostics)
      let target: string | undefined
      if (mount.target !== undefined) target = requiredString(mount, 'target', mountPath, diagnostics)
      if (mount.required !== undefined && typeof mount.required !== 'boolean') {
        diagnostics.push({ path: `${mountPath}.required`, message: 'must be a boolean' })
      }
      mounts[name] = Object.freeze({
        ...(target === undefined ? {} : { target }),
        ...(typeof mount.required === 'boolean' ? { required: mount.required } : {}),
      })
    }
  }
  throwDiagnostics(filename, diagnostics)

  const loaderPath = resolveFrom(filename, loaderTarget)
  const loaderValue = await readYaml(loaderPath)
  const loaderDiagnostics: ConfigDiagnostic[] = []
  const entries = validateLoaderEntries(loaderValue, '$', loaderDiagnostics, new Set())
  throwDiagnostics(loaderPath, loaderDiagnostics)
  return Object.freeze({
    version: 1,
    id,
    revision,
    loader: loaderTarget,
    ...(identity === undefined ? {} : { identity }),
    traits: Object.freeze(traits),
    mounts: Object.freeze(mounts),
    root: dirname(filename),
    metadataPath: filename,
    loaderPath,
    entries: Object.freeze(entries),
  })
}

export function selectPersonaTraits(
  definition: PersonaDefinitionMetadata,
  selected: readonly string[],
  filename = definition.id,
): readonly PersonaAssetDefinition[] {
  const diagnostics: ConfigDiagnostic[] = []
  const traits: PersonaAssetDefinition[] = []
  const seen = new Set<string>()
  for (const [index, name] of selected.entries()) {
    if (seen.has(name)) {
      diagnostics.push({ path: `$.traits[${index}]`, message: `duplicate trait "${name}"` })
      continue
    }
    seen.add(name)
    const trait = definition.traits[name]
    if (trait === undefined) {
      diagnostics.push({ path: `$.traits[${index}]`, message: `unknown trait "${name}"` })
    } else {
      traits.push(trait)
    }
  }
  throwDiagnostics(filename, diagnostics)
  return Object.freeze(traits)
}
