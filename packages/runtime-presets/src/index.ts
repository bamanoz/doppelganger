import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  access,
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import enhancedResolve from 'enhanced-resolve'
import { dump, load } from 'js-yaml'

export const RUNTIME_PRESET_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const SHIPPED_RUNTIME_PRESET_ROOT = fileURLToPath(new URL('../presets/', import.meta.url))
export const STANDARD_RUNTIME_PRESET_ID = 'standard'

const USER_CONFIG_FIELDS: Readonly<Record<string, true>> = { version: true, defaultRuntimePreset: true }
const PROJECT_MANIFEST_FIELDS: Readonly<Record<string, true>> = { version: true, runtimePreset: true }
const PRESET_METADATA_FILE = 'preset.yml'
const RUNTIME_PRESET_FILE = 'runtime.cordis.yml'
const USER_PRESET_DIRECTORY = '.runtime-presets'
const USER_CONFIG_TEMPLATE = `# Shipped Runtime Presets stay with the installed Doppelganger package.
# Put copied or custom presets under .runtime-presets and select one with defaultRuntimePreset.
version: 1
`

const USER_PATCH_TEMPLATE = `# Your patch layer for this Doppelganger home, applied after the selected Runtime Preset:
# a top-level YAML array of Cordis Loader patch entries.
[]
`

export interface RuntimeConfigurationDiagnostic {
  readonly path: string
  readonly message: string
}

export class RuntimeConfigurationError extends Error {
  readonly code = 'INVALID_CONFIGURATION'
  readonly filename: string
  readonly diagnostics: readonly RuntimeConfigurationDiagnostic[]

  constructor(
    filename: string,
    diagnostics: readonly RuntimeConfigurationDiagnostic[],
    cause?: unknown,
  ) {
    super(
      `invalid Doppelganger configuration at ${filename}:\n${diagnostics.map(diagnostic => (
        `${diagnostic.path}: ${diagnostic.message}`
      )).join('\n')}`,
      cause === undefined ? undefined : { cause },
    )
    this.filename = filename
    this.diagnostics = diagnostics
    this.name = 'RuntimeConfigurationError'
  }
}

export class InvalidRuntimePresetIdError extends Error {
  readonly code = 'INVALID_RUNTIME_PRESET_ID'
  readonly runtimePresetId: string

  constructor(runtimePresetId: string) {
    super(`Runtime Preset ID ${JSON.stringify(runtimePresetId)} must be lowercase kebab-case`)
    this.runtimePresetId = runtimePresetId
    this.name = 'InvalidRuntimePresetIdError'
  }
}

export class RuntimePresetExistsError extends Error {
  readonly code = 'RUNTIME_PRESET_EXISTS'
  readonly runtimePresetId: string

  constructor(runtimePresetId: string) {
    super(`Runtime Preset "${runtimePresetId}" already exists; copying never overwrites an occupied ID`)
    this.runtimePresetId = runtimePresetId
    this.name = 'RuntimePresetExistsError'
  }
}

export class RuntimePresetNotWritableError extends Error {
  readonly code = 'RUNTIME_PRESET_NOT_WRITABLE'
  readonly runtimePresetId: string

  constructor(runtimePresetId: string, reason: string) {
    super(`Runtime Preset "${runtimePresetId}" is not writable: ${reason}`)
    this.runtimePresetId = runtimePresetId
    this.name = 'RuntimePresetNotWritableError'
  }
}

export interface RuntimeUserConfig {
  readonly version: 1
  readonly defaultRuntimePreset?: string
}

export interface RuntimeProjectManifest {
  readonly version: 1
  readonly runtimePreset?: string
}

export type RuntimePresetTrust = 'system' | 'user'

export interface RuntimePresetRoot {
  readonly path: string
  readonly trust: RuntimePresetTrust
}

export interface RuntimePresetRosterConfig {
  readonly home?: string
  readonly defaultRuntimePreset?: string | null
  readonly roots?: readonly RuntimePresetRoot[]
  readonly includeShippedRoot?: boolean
  readonly includeUserRoot?: boolean
}

export interface RuntimePresetMetadata {
  readonly name: string
  readonly description?: string
}

interface RuntimePresetDescriptorBase extends RuntimePresetMetadata {
  readonly id: string
  readonly directory: string
  readonly loaderPath: string
  readonly root: RuntimePresetRoot
  readonly trust: RuntimePresetTrust
}

export interface HealthyRuntimePreset extends RuntimePresetDescriptorBase {
  readonly status: 'healthy'
  readonly revision: string
  readonly entries: readonly EntryOptions[]
}

export interface BrokenRuntimePreset extends RuntimePresetDescriptorBase {
  readonly status: 'broken'
  readonly diagnostics: readonly RuntimeConfigurationDiagnostic[]
}

export type RuntimePreset = HealthyRuntimePreset | BrokenRuntimePreset

export interface RuntimePresetSelectionRequest {
  readonly explicitRuntimePreset?: string
  readonly projectManifestPath?: string
}

export interface ResolvedRuntimePresetSelection {
  readonly home: string
  readonly source: 'explicit' | 'project' | 'user' | 'deployment'
  readonly preset: HealthyRuntimePreset
  readonly userPatchPath: string
  readonly projectPatchPath?: string
}

export interface CopyRuntimePresetRequest {
  readonly from: string
  readonly id: string
  readonly name?: string
}

export class RuntimePresetSelectionError extends Error {
  readonly code = 'RUNTIME_PRESET_SELECTION_FAILED'
  readonly runtimePresetId: string
  readonly presets: readonly RuntimePreset[]

  constructor(runtimePresetId: string, presets: readonly RuntimePreset[]) {
    const available = presets.filter(preset => preset.status === 'healthy').map(preset => preset.id)
    const selected = presets.find(preset => preset.id === runtimePresetId)
    const detail = selected?.status === 'broken'
      ? selected.diagnostics.map(diagnostic => `${diagnostic.path}: ${diagnostic.message}`).join('; ')
      : 'preset was not discovered'
    super(
      `Runtime Preset "${runtimePresetId}" is unavailable: ${detail}. `
      + `Available presets: ${available.length === 0 ? '(none)' : available.join(', ')}`,
    )
    this.runtimePresetId = runtimePresetId
    this.presets = presets
    this.name = 'RuntimePresetSelectionError'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return
  return value as Record<string, unknown>
}

function runtimePresetId(value: unknown, path: string, diagnostics: RuntimeConfigurationDiagnostic[]): string | undefined {
  if (value === undefined) return
  if (typeof value !== 'string' || !RUNTIME_PRESET_ID_PATTERN.test(value)) {
    diagnostics.push({ path, message: 'must be a lowercase kebab-case Runtime Preset ID' })
    return
  }
  return value
}

function requireRuntimePresetId(value: string): string {
  if (!RUNTIME_PRESET_ID_PATTERN.test(value)) throw new InvalidRuntimePresetIdError(value)
  return value
}

function validateDocument(
  value: unknown,
  filename: string,
  allowed: Readonly<Record<string, true>>,
  selectionField: 'defaultRuntimePreset' | 'runtimePreset',
): RuntimeUserConfig | RuntimeProjectManifest {
  const diagnostics: RuntimeConfigurationDiagnostic[] = []
  const object = record(value)
  if (object === undefined) {
    throw new RuntimeConfigurationError(filename, [{ path: '$', message: 'must be an object' }])
  }
  for (const key of Object.keys(object)) {
    if (allowed[key] !== true) diagnostics.push({ path: `$.${key}`, message: 'unknown field' })
  }
  if (object.version !== 1) diagnostics.push({ path: '$.version', message: 'must equal 1' })
  const selection = runtimePresetId(object[selectionField], `$.${selectionField}`, diagnostics)
  if (diagnostics.length > 0) throw new RuntimeConfigurationError(filename, diagnostics)
  return Object.freeze({
    version: 1 as const,
    ...(selection === undefined ? {} : { [selectionField]: selection }),
  })
}

async function readOptionalText(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new RuntimeConfigurationError(filename, [{ path: '$', message: 'cannot read file' }], cause)
  }
}

async function readOptionalYaml(filename: string): Promise<unknown | undefined> {
  const content = await readOptionalText(filename)
  if (content === undefined) return
  try {
    return load(content, { schema: entryListSchema })
  } catch (cause) {
    throw new RuntimeConfigurationError(filename, [{ path: '$', message: 'invalid YAML' }], cause)
  }
}

async function readRuntimePresetMetadata(directory: string, id: string): Promise<RuntimePresetMetadata> {
  try {
    const value = await readOptionalYaml(join(directory, PRESET_METADATA_FILE))
    const metadata = record(value)
    if (metadata === undefined) return Object.freeze({ name: id })
    const name = typeof metadata.name === 'string' && metadata.name.trim().length > 0
      ? metadata.name.trim()
      : id
    const description = typeof metadata.description === 'string' && metadata.description.trim().length > 0
      ? metadata.description.trim()
      : undefined
    return Object.freeze({
      name,
      ...(description === undefined ? {} : { description }),
    })
  } catch {
    return Object.freeze({ name: id })
  }
}

function normalizeRoot(input: RuntimePresetRoot, index: number): RuntimePresetRoot {
  if (input.trust !== 'system' && input.trust !== 'user') {
    throw new TypeError(`runtime preset root at index ${index} must have system or user trust`)
  }
  if (typeof input.path !== 'string' || input.path.trim().length === 0) {
    throw new TypeError(`runtime preset root at index ${index} must have a non-empty path`)
  }
  return Object.freeze({ path: normalize(resolve(input.path)), trust: input.trust })
}

export function resolveDoppelgangerHome(explicit?: string): string {
  if (explicit !== undefined) {
    if (explicit.trim().length === 0) throw new TypeError('Doppelganger home must be a non-empty path')
    return normalize(resolve(explicit))
  }
  const configured = process.env.DOPPELGANGER_HOME?.trim()
  return normalize(resolve(configured === undefined || configured.length === 0
    ? join(homedir(), '.doppelganger')
    : configured))
}

export function resolveRuntimePresetRoots(config: RuntimePresetRosterConfig = {}): readonly RuntimePresetRoot[] {
  const home = resolveDoppelgangerHome(config.home)
  return Object.freeze([
    ...(config.includeShippedRoot === false
      ? []
      : [Object.freeze({ path: normalize(resolve(SHIPPED_RUNTIME_PRESET_ROOT)), trust: 'system' as const })]),
    ...(config.roots ?? []).map(normalizeRoot),
    ...(config.includeUserRoot === false
      ? []
      : [Object.freeze({ path: join(home, USER_PRESET_DIRECTORY), trust: 'user' as const })]),
  ])
}

export async function loadRuntimeUserConfig(filename: string): Promise<RuntimeUserConfig> {
  const absolute = normalize(resolve(filename))
  const value = await readOptionalYaml(absolute)
  if (value === undefined) return Object.freeze({ version: 1 })
  return validateDocument(value, absolute, USER_CONFIG_FIELDS, 'defaultRuntimePreset') as RuntimeUserConfig
}

export async function loadRuntimeProjectManifest(filename: string): Promise<RuntimeProjectManifest> {
  const absolute = normalize(resolve(filename))
  const value = await readOptionalYaml(absolute)
  if (value === undefined) return Object.freeze({ version: 1 })
  return validateDocument(value, absolute, PROJECT_MANIFEST_FIELDS, 'runtimePreset') as RuntimeProjectManifest
}

/** Validate complete, portable Cordis Loader entry structure without interpreting plugin config. */
export function validateLoaderEntries(value: unknown, filename: string, rootPath = '$'): readonly EntryOptions[] {
  const diagnostics: RuntimeConfigurationDiagnostic[] = []
  if (!Array.isArray(value)) {
    throw new RuntimeConfigurationError(filename, [{ path: rootPath, message: 'must be a top-level Loader entry array' }])
  }
  const ids = new Set<string>()
  const visit = (entries: readonly unknown[], path: string): void => {
    entries.forEach((candidate, index) => {
      const entryPath = `${path}[${index}]`
      const entry = record(candidate)
      if (entry === undefined) {
        diagnostics.push({ path: entryPath, message: 'must be a Loader entry object' })
        return
      }
      if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
        diagnostics.push({ path: `${entryPath}.id`, message: 'must be a non-empty string' })
      } else if (ids.has(entry.id)) {
        diagnostics.push({ path: `${entryPath}.id`, message: `duplicate entry ID "${entry.id}"` })
      } else ids.add(entry.id)
      if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
        diagnostics.push({ path: `${entryPath}.name`, message: 'must be a non-empty string' })
      }
      if (entry.group === true && entry.config !== undefined) {
        if (!Array.isArray(entry.config)) {
          diagnostics.push({ path: `${entryPath}.config`, message: 'must be an array of Loader entries when supplied for a group' })
        } else visit(entry.config, `${entryPath}.config`)
      }
    })
  }
  visit(value, rootPath)
  if (diagnostics.length > 0) throw new RuntimeConfigurationError(filename, diagnostics)
  return Object.freeze(value as EntryOptions[])
}

export async function loadRuntimePresetEntries(filename: string): Promise<readonly EntryOptions[]> {
  const absolute = normalize(resolve(filename))
  const value = await readOptionalYaml(absolute)
  if (value === undefined) {
    throw new RuntimeConfigurationError(absolute, [{ path: '$', message: `${RUNTIME_PRESET_FILE} is missing` }])
  }
  return validateLoaderEntries(value, absolute)
}

function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/', 3)
    return scope !== undefined && name !== undefined ? `${scope}/${name}` : undefined
  }
  const [name] = specifier.split('/', 1)
  return name === undefined || name.startsWith('#') ? undefined : name
}

function findPackageDirectory(packageName: string, baseUrl: string | URL): string | undefined {
  let directory = dirname(fileURLToPath(baseUrl))
  const packagePath = packageName.split('/')
  while (true) {
    const candidate = join(directory, 'node_modules', ...packagePath)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

const resolvePackageImport = enhancedResolve.create.sync({
  conditionNames: ['import', 'node', 'default'],
  extensions: ['.ts', '.mts', '.cts', '.mjs', '.js', '.json', '.node'],
  mainFields: ['module', 'main'],
})

function resolveBareImport(name: string, baseUrl: string | URL): string {
  const resolved = resolvePackageImport(dirname(fileURLToPath(baseUrl)), name)
  if (resolved === false) throw new Error(`Package import ${JSON.stringify(name)} was ignored by the resolver`)
  return pathToFileURL(resolved).href
}

export function resolveRuntimePresetImport(name: string, authoredBaseUrl: string | URL): string {
  if (name.startsWith('cordis:')) return name
  if (name.startsWith('.')) return new URL(name, authoredBaseUrl).href
  if (name.startsWith('/')) return pathToFileURL(name).href
  if (/^[a-z][a-z0-9+.-]*:/iu.test(name)) return name
  const packageName = barePackageName(name)
  const baseUrl = packageName !== undefined && findPackageDirectory(packageName, authoredBaseUrl) !== undefined
    ? authoredBaseUrl
    : import.meta.url
  return resolveBareImport(name, baseUrl)
}

async function validateImport(name: string, loaderPath: string): Promise<void> {
  if (name.startsWith('cordis:')) return
  try {
    const resolved = resolveRuntimePresetImport(name, pathToFileURL(loaderPath))
    if (resolved.startsWith('file:')) await access(fileURLToPath(resolved))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Cannot resolve Runtime Preset import ${JSON.stringify(name)} from ${JSON.stringify(loaderPath)}: ${detail}`, { cause })
  }
}

async function validateEntryImports(entries: readonly EntryOptions[], loaderPath: string): Promise<void> {
  for (const entry of entries) {
    await validateImport(entry.name, loaderPath)
    if (entry.group === true && Array.isArray(entry.config)) {
      await validateEntryImports(entry.config as EntryOptions[], loaderPath)
    }
  }
}

async function scanRuntimePresetRoot(root: RuntimePresetRoot): Promise<readonly RuntimePreset[]> {
  let candidates
  try {
    candidates = await readdir(root.path, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([])
    throw new RuntimeConfigurationError(root.path, [{ path: '$', message: 'cannot read Runtime Preset root' }], cause)
  }
  const directories = candidates
    .filter(candidate => candidate.isDirectory() && RUNTIME_PRESET_ID_PATTERN.test(candidate.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  return Object.freeze(await Promise.all(directories.map(async (candidate): Promise<RuntimePreset> => {
    const directory = join(root.path, candidate.name)
    const loaderPath = join(directory, RUNTIME_PRESET_FILE)
    const metadata = await readRuntimePresetMetadata(directory, candidate.name)
    const base = {
      id: candidate.name,
      ...metadata,
      directory,
      loaderPath,
      root,
      trust: root.trust,
    }
    try {
      const entries = await loadRuntimePresetEntries(loaderPath)
      await validateEntryImports(entries, loaderPath)
      const source = await readFile(loaderPath)
      const revision = createHash('sha256').update(source).digest('hex')
      return Object.freeze({ ...base, revision, status: 'healthy', entries })
    } catch (cause) {
      const diagnostics = cause instanceof RuntimeConfigurationError
        ? cause.diagnostics
        : [{ path: '$', message: cause instanceof Error ? cause.message : String(cause) }]
      return Object.freeze({ ...base, status: 'broken', diagnostics: Object.freeze([...diagnostics]) })
    }
  })))
}

async function pathOccupied(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    return true
  }
}

async function tightenModes(directory: string): Promise<void> {
  await chmod(directory, 0o700)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) {
      await tightenModes(target)
    } else {
      await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
    }
  }
}

async function atomicWrite(filename: string, content: string, mode = 0o600): Promise<void> {
  const directory = dirname(filename)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${filename.slice(directory.length + 1)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { mode, flag: 'wx' })
    await rename(temporary, filename)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
}

function renderUserConfig(config: RuntimeUserConfig): string {
  return dump(config, { noRefs: true, lineWidth: -1, sortKeys: false })
}

async function writeInitialFile(filename: string, content: string): Promise<void> {
  try {
    await writeFile(filename, content, { mode: 0o600, flag: 'wx' })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
  }
}

function renderCopiedMetadata(source: RuntimePreset, name: string | undefined): string | undefined {
  const metadata = {
    ...(name === undefined ? {} : { name }),
    ...(source.description === undefined ? {} : { description: source.description }),
  }
  return Object.keys(metadata).length === 0
    ? undefined
    : dump(metadata, { noRefs: true, lineWidth: -1, sortKeys: false })
}

export class RuntimePresetRoster {
  readonly home: string
  readonly roots: readonly RuntimePresetRoot[]
  readonly defaultRuntimePreset: string | undefined

  constructor(config: RuntimePresetRosterConfig = {}) {
    this.home = resolveDoppelgangerHome(config.home)
    this.roots = resolveRuntimePresetRoots({ ...config, home: this.home })
    if (config.defaultRuntimePreset !== undefined && config.defaultRuntimePreset !== null) {
      requireRuntimePresetId(config.defaultRuntimePreset)
    }
    this.defaultRuntimePreset = config.defaultRuntimePreset ?? undefined
  }

  async #initializeHome(): Promise<void> {
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    const userConfigPath = join(this.home, 'config.yaml')
    if (await pathOccupied(userConfigPath)) return
    const userRoot = join(this.home, USER_PRESET_DIRECTORY)
    if (this.roots.some(root => root.trust === 'user' && root.path === userRoot)) {
      await mkdir(userRoot, { recursive: true, mode: 0o700 })
    }
    await writeInitialFile(join(this.home, 'runtime.cordis.patch.yml'), USER_PATCH_TEMPLATE)
    await writeInitialFile(userConfigPath, USER_CONFIG_TEMPLATE)
  }

  async list(): Promise<readonly RuntimePreset[]> {
    const discovered = await Promise.all(this.roots.map(scanRuntimePresetRoot))
    const winners = new Map<string, RuntimePreset>()
    for (const presets of discovered) {
      for (const preset of presets) if (!winners.has(preset.id)) winners.set(preset.id, preset)
    }
    return Object.freeze([...winners.values()].sort((left, right) => left.id.localeCompare(right.id)))
  }

  async resolve(id = this.defaultRuntimePreset): Promise<HealthyRuntimePreset> {
    if (id === undefined) {
      throw new RuntimePresetSelectionError('', await this.list())
    }
    requireRuntimePresetId(id)
    const presets = await this.list()
    const selected = presets.find(preset => preset.id === id)
    if (selected?.status !== 'healthy') throw new RuntimePresetSelectionError(id, presets)
    return selected
  }

  async select(request: RuntimePresetSelectionRequest = {}): Promise<ResolvedRuntimePresetSelection | undefined> {
    await this.#initializeHome()
    const userConfigPath = join(this.home, 'config.yaml')
    const resolveSelection = async (
      choice: unknown,
      source: ResolvedRuntimePresetSelection['source'],
      filename: string,
      path: string,
    ): Promise<ResolvedRuntimePresetSelection> => {
      const diagnostics: RuntimeConfigurationDiagnostic[] = []
      const id = runtimePresetId(choice, path, diagnostics)
      if (id === undefined) throw new RuntimeConfigurationError(filename, diagnostics)
      const preset = await this.resolve(id)
      return Object.freeze({
        home: this.home,
        source,
        preset,
        userPatchPath: join(this.home, 'runtime.cordis.patch.yml'),
        ...(request.projectManifestPath === undefined
          ? {}
          : { projectPatchPath: join(dirname(request.projectManifestPath), 'runtime.cordis.patch.yml') }),
      })
    }

    if (request.explicitRuntimePreset !== undefined) {
      return resolveSelection(request.explicitRuntimePreset, 'explicit', 'explicit Runtime Preset selection', '$.explicitRuntimePreset')
    }
    if (request.projectManifestPath !== undefined) {
      const project = await loadRuntimeProjectManifest(request.projectManifestPath)
      if (project.runtimePreset !== undefined) {
        return resolveSelection(project.runtimePreset, 'project', request.projectManifestPath, '$.runtimePreset')
      }
    }
    const user = await loadRuntimeUserConfig(userConfigPath)
    if (user.defaultRuntimePreset !== undefined) {
      return resolveSelection(user.defaultRuntimePreset, 'user', userConfigPath, '$.defaultRuntimePreset')
    }
    if (this.defaultRuntimePreset !== undefined) {
      return resolveSelection(this.defaultRuntimePreset, 'deployment', 'deployment Runtime Preset default', '$.defaultRuntimePreset')
    }
  }

  writableRoot(): string {
    const root = this.roots.find(candidate => candidate.trust === 'user')
    if (root === undefined) {
      throw new RuntimePresetNotWritableError('', 'the roster configures no user-writable root')
    }
    return root.path
  }

  async copy(request: CopyRuntimePresetRequest): Promise<string> {
    const source = await this.resolve(requireRuntimePresetId(request.from))
    const id = requireRuntimePresetId(request.id)
    const root = this.writableRoot()
    const destination = join(root, id)
    if ((await this.list()).some(preset => preset.id === id) || await pathOccupied(destination)) {
      throw new RuntimePresetExistsError(id)
    }
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temporary = join(root, `.${id}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await cp(source.directory, temporary, {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: true,
      })
      await tightenModes(temporary)
      const metadata = renderCopiedMetadata(source, request.name)
      const metadataPath = join(temporary, PRESET_METADATA_FILE)
      if (metadata === undefined) await rm(metadataPath, { force: true })
      else await atomicWrite(metadataPath, metadata)
      await rename(temporary, destination)
      return destination
    } catch (cause) {
      await rm(temporary, { recursive: true, force: true })
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST' || (cause as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
        throw new RuntimePresetExistsError(id)
      }
      throw cause
    }
  }

  async remove(id: string): Promise<void> {
    id = requireRuntimePresetId(id)
    const preset = (await this.list()).find(candidate => candidate.id === id)
    if (preset === undefined) throw new RuntimePresetSelectionError(id, await this.list())
    const writableRoot = this.writableRoot()
    const expectedDirectory = join(writableRoot, id)
    if (preset.trust !== 'user' || preset.root.path !== writableRoot || preset.directory !== expectedDirectory) {
      throw new RuntimePresetNotWritableError(id, 'it is not owned by the first writable Runtime Preset root')
    }

    const staged = join(writableRoot, `.${id}.${process.pid}.${randomUUID()}.remove`)
    const userConfigPath = join(this.home, 'config.yaml')
    const originalConfigText = await readOptionalText(userConfigPath)
    const originalConfig = await loadRuntimeUserConfig(userConfigPath)
    let configChanged = false
    await rename(expectedDirectory, staged)
    try {
      if (originalConfig.defaultRuntimePreset === id) {
        await atomicWrite(userConfigPath, renderUserConfig({ version: 1 }))
        configChanged = true
      }
      await rm(staged, { recursive: true })
    } catch (cause) {
      const rollbackErrors: unknown[] = []
      if (configChanged) {
        try {
          if (originalConfigText === undefined) await rm(userConfigPath, { force: true })
          else await atomicWrite(userConfigPath, originalConfigText)
        } catch (rollbackCause) {
          rollbackErrors.push(rollbackCause)
        }
      }
      try {
        if (await pathOccupied(staged)) await rename(staged, expectedDirectory)
      } catch (rollbackCause) {
        rollbackErrors.push(rollbackCause)
      }
      if (rollbackErrors.length > 0) throw new AggregateError([cause, ...rollbackErrors], `failed to remove Runtime Preset "${id}" and roll back`)
      throw cause
    }
  }
}

export function createRuntimePresetRoster(config: RuntimePresetRosterConfig = {}): RuntimePresetRoster {
  return new RuntimePresetRoster({
    ...config,
    defaultRuntimePreset: config.defaultRuntimePreset === undefined
      ? STANDARD_RUNTIME_PRESET_ID
      : config.defaultRuntimePreset,
  })
}

export function createStandardRuntimePresetRoster(
  config: Omit<RuntimePresetRosterConfig, 'defaultRuntimePreset'> = {},
): RuntimePresetRoster {
  return new RuntimePresetRoster({ ...config, defaultRuntimePreset: STANDARD_RUNTIME_PRESET_ID })
}

