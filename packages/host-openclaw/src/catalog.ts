import { createHash } from 'node:crypto'
import {
  canonicalJson,
  cloneJsonValue,
  type JsonValue,
  type ToolCatalogSnapshot,
  type ToolDescriptor,
} from '@doppelganger/doppelganger-protocols'
import { RUNTIME_PRESET_ID_PATTERN } from '@doppelganger/doppelganger-runtime-presets'

const PREPARED_JSON_LIMITS = Object.freeze({ maximumBytes: 2 * 1024 * 1024, maximumDepth: 64 })
const CANONICAL_TOOL_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u
const NATIVE_TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/u
const FINGERPRINT = /^[a-f0-9]{64}$/u
const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependencies',
  'dependentSchemas',
  'patternProperties',
  'properties',
])


export interface PreparedTool {
  readonly nativeName: string
  readonly descriptor: Omit<ToolDescriptor, 'revision'>
}

export interface PreparedCatalog {
  readonly version: 1
  readonly runtimePresetId: string
  readonly tools: readonly PreparedTool[]
  readonly fingerprint: string
}
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}


function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value)
}

function record(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || isJsonArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function exactKeys(
  value: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const missing = required.filter(key => !(key in value))
  const extra = Object.keys(value).filter(key => !allowed.has(key))
  if (missing.length > 0) throw new TypeError(`${label} is missing fields: ${missing.join(', ')}`)
  if (extra.length > 0) throw new TypeError(`${label} contains unsupported fields: ${extra.join(', ')}`)
}

function nonEmpty(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty trimmed string`)
  }
  return value
}

function schemaCompatibility(schema: JsonValue, label: string): void {
  const root = record(schema, label)
  if (root.type !== undefined && root.type !== 'object') {
    throw new TypeError(`${label}.type must be "object" when present`)
  }
  const visit = (value: JsonValue, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`))
      return
    }
    if (value === null || typeof value !== 'object') return
    if ('$dynamicRef' in value) throw new TypeError(`${path}.$dynamicRef is unsupported by the OpenClaw runtime schema projection`)
    if ('$dynamicAnchor' in value) throw new TypeError(`${path}.$dynamicAnchor is unsupported by the OpenClaw runtime schema projection`)
    for (const [key, child] of Object.entries(value)) {
      if (child === null || typeof child !== 'object') continue
      if (SCHEMA_MAP_KEYWORDS.has(key) && !Array.isArray(child)) {
        for (const [schemaName, childSchema] of Object.entries(child)) {
          visit(childSchema, `${path}.${key}.${schemaName}`)
        }
      } else {
        visit(child, `${path}.${key}`)
      }
    }
  }
  visit(root, label)
}

function approval(value: JsonValue | undefined, label: string): ToolDescriptor['approval'] {
  if (value === undefined) return undefined
  const candidate = record(value, label)
  exactKeys(candidate, ['policy'], ['reason'], label)
  if (candidate.policy !== 'required') throw new TypeError(`${label}.policy must equal "required"`)
  const reason = candidate.reason === undefined ? undefined : nonEmpty(candidate.reason, `${label}.reason`)
  if (reason !== undefined && reason.length > 1_024) throw new TypeError(`${label}.reason exceeds 1024 characters`)
  return Object.freeze({ policy: 'required', ...(reason === undefined ? {} : { reason }) })
}

function descriptorWithoutRevision(value: JsonValue, label: string): Omit<ToolDescriptor, 'revision'> {
  const candidate = record(value, label)
  exactKeys(candidate, ['name', 'label', 'description', 'inputSchema', 'available'], ['approval'], label)
  const name = nonEmpty(candidate.name, `${label}.name`)
  if (!CANONICAL_TOOL_NAME.test(name)) throw new TypeError(`${label}.name is not a portable qualified tool name`)
  const toolLabel = nonEmpty(candidate.label, `${label}.label`)
  const description = nonEmpty(candidate.description, `${label}.description`)
  const inputSchema = record(candidate.inputSchema!, `${label}.inputSchema`)
  schemaCompatibility(inputSchema, `${label}.inputSchema`)
  if (typeof candidate.available !== 'boolean') throw new TypeError(`${label}.available must be a boolean`)
  const requirement = approval(candidate.approval, `${label}.approval`)
  return Object.freeze({
    name,
    label: toolLabel,
    description,
    inputSchema,
    ...(requirement === undefined ? {} : { approval: requirement }),
    available: candidate.available,
  })
}

function preparedTool(value: JsonValue, index: number): PreparedTool {
  const label = `prepared catalog.tools[${index}]`
  const candidate = record(value, label)
  exactKeys(candidate, ['nativeName', 'descriptor'], [], label)
  const nativeName = nonEmpty(candidate.nativeName, `${label}.nativeName`)
  if (!NATIVE_TOOL_NAME.test(nativeName)) throw new TypeError(`${label}.nativeName is not an OpenClaw tool name of at most 64 characters`)
  return Object.freeze({ nativeName, descriptor: descriptorWithoutRevision(candidate.descriptor!, `${label}.descriptor`) })
}

function descriptorFingerprintValue(descriptor: Omit<ToolDescriptor, 'revision'>): JsonValue {
  return {
    name: descriptor.name,
    label: descriptor.label,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    ...(descriptor.approval === undefined
      ? {}
      : {
          approval: {
            policy: descriptor.approval.policy,
            ...(descriptor.approval.reason === undefined ? {} : { reason: descriptor.approval.reason }),
          },
        }),
    available: descriptor.available,
  }
}

function fingerprintInput(runtimePresetId: string, tools: readonly PreparedTool[]): JsonValue {
  return {
    runtimePresetId,
    tools: tools.map(tool => ({
      nativeName: tool.nativeName,
      descriptor: descriptorFingerprintValue(tool.descriptor),
    })),
  }
}

function catalogFingerprint(runtimePresetId: string, tools: readonly PreparedTool[]): string {
  return createHash('sha256').update(canonicalJson(fingerprintInput(runtimePresetId, tools))).digest('hex')
}

export function nativeToolName(canonicalName: string): string {
  if (!CANONICAL_TOOL_NAME.test(canonicalName)) throw new TypeError(`unsupported portable tool name ${JSON.stringify(canonicalName)}`)
  const nativeName = `dg_${canonicalName.replaceAll('.', '__')}`
  if (!NATIVE_TOOL_NAME.test(nativeName)) {
    throw new TypeError(`portable tool ${JSON.stringify(canonicalName)} maps to an OpenClaw name longer than 64 characters`)
  }
  return nativeName
}
function displayToolName(name: string): string {
  return JSON.stringify(name.length <= 256 ? name : `${name.slice(0, 253)}...`)
}
function displayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 512 ? message : `${message.slice(0, 509)}...`
}

function snapshotTools(snapshot: ToolCatalogSnapshot): readonly JsonValue[] {
  const cloned = cloneJsonValue<JsonValue>(snapshot, 'tool catalog', PREPARED_JSON_LIMITS)
  const candidate = record(cloned, 'tool catalog')
  exactKeys(candidate, ['revision', 'tools'], [], 'tool catalog')
  nonEmpty(candidate.revision, 'tool catalog.revision')
  if (!Array.isArray(candidate.tools)) throw new TypeError('tool catalog.tools must be an array')
  return candidate.tools
}

function snapshotDescriptor(value: JsonValue, index: number): { descriptor: Omit<ToolDescriptor, 'revision'>; revision: string } {
  const candidate = record(value, `tool catalog.tools[${index}]`)
  exactKeys(candidate, ['name', 'label', 'description', 'inputSchema', 'revision', 'available'], ['approval'], `tool catalog.tools[${index}]`)
  const revision = nonEmpty(candidate.revision, `tool catalog.tools[${index}].revision`)
  const { revision: _revision, ...contract } = candidate
  return { descriptor: descriptorWithoutRevision(contract, `tool catalog.tools[${index}]`), revision }
}

export function prepareCatalog(runtimePresetId: string, snapshot: ToolCatalogSnapshot): PreparedCatalog {
  if (typeof runtimePresetId !== 'string' || !RUNTIME_PRESET_ID_PATTERN.test(runtimePresetId)) {
    throw new TypeError('runtimePresetId must be a lowercase kebab-case Runtime Preset ID')
  }
  const preset = runtimePresetId
  const tools = snapshotTools(snapshot).map((descriptor, index) => {
    const contract = snapshotDescriptor(descriptor, index).descriptor
    return Object.freeze({ nativeName: nativeToolName(contract.name), descriptor: contract })
  }).sort((left, right) => compareStrings(left.descriptor.name, right.descriptor.name))
  const canonicalNames = new Set<string>()
  const nativeNames = new Set<string>()
  for (const tool of tools) {
    if (canonicalNames.has(tool.descriptor.name)) throw new TypeError(`duplicate portable tool ${JSON.stringify(tool.descriptor.name)}`)
    if (nativeNames.has(tool.nativeName)) throw new TypeError(`portable tools collide at OpenClaw name ${JSON.stringify(tool.nativeName)}`)
    canonicalNames.add(tool.descriptor.name)
    nativeNames.add(tool.nativeName)
  }
  const frozen = Object.freeze(tools)
  return Object.freeze({ version: 1, runtimePresetId: preset, tools: frozen, fingerprint: catalogFingerprint(preset, frozen) })
}

export function validatePreparedCatalog(input: unknown): PreparedCatalog {
  const cloned = cloneJsonValue<JsonValue>(input, 'prepared catalog', PREPARED_JSON_LIMITS)
  const candidate = record(cloned, 'prepared catalog')
  exactKeys(candidate, ['version', 'runtimePresetId', 'tools', 'fingerprint'], [], 'prepared catalog')
  if (candidate.version !== 1) throw new TypeError('prepared catalog.version must equal 1')
  const runtimePresetId = nonEmpty(candidate.runtimePresetId, 'prepared catalog.runtimePresetId')
  if (!RUNTIME_PRESET_ID_PATTERN.test(runtimePresetId)) {
    throw new TypeError('prepared catalog.runtimePresetId must be a lowercase kebab-case Runtime Preset ID')
  }
  if (!Array.isArray(candidate.tools)) throw new TypeError('prepared catalog.tools must be an array')
  const tools = Object.freeze(candidate.tools.map(preparedTool).sort((left, right) => compareStrings(left.descriptor.name, right.descriptor.name)))
  const canonicalNames = new Set<string>()
  const nativeNames = new Set<string>()
  for (const tool of tools) {
    if (tool.nativeName !== nativeToolName(tool.descriptor.name)) {
      throw new TypeError(`prepared catalog mapping for ${JSON.stringify(tool.descriptor.name)} is not canonical`)
    }
    if (canonicalNames.has(tool.descriptor.name)) throw new TypeError(`prepared catalog contains duplicate portable tool ${JSON.stringify(tool.descriptor.name)}`)
    if (nativeNames.has(tool.nativeName)) throw new TypeError(`prepared catalog contains colliding OpenClaw tool ${JSON.stringify(tool.nativeName)}`)
    canonicalNames.add(tool.descriptor.name)
    nativeNames.add(tool.nativeName)
  }
  const fingerprint = nonEmpty(candidate.fingerprint, 'prepared catalog.fingerprint')
  if (!FINGERPRINT.test(fingerprint)) throw new TypeError('prepared catalog.fingerprint must be a lowercase SHA-256 digest')
  const expected = catalogFingerprint(runtimePresetId, tools)
  if (fingerprint !== expected) throw new TypeError('prepared catalog.fingerprint does not match its durable contract')
  return Object.freeze({ version: 1, runtimePresetId, tools, fingerprint })
}

export function projectCatalog(
  preparedInput: PreparedCatalog,
  snapshot: ToolCatalogSnapshot,
  report: (message: string) => void,
): readonly { nativeName: string; descriptor: ToolDescriptor }[] {
  const prepared = validatePreparedCatalog(preparedInput)
  const current = new Map<string, ToolDescriptor>()
  const incompatible = new Set<string>()
  snapshotTools(snapshot).forEach((descriptor, index) => {
    let name: string | undefined
    try {
      const candidate = record(descriptor, `tool catalog.tools[${index}]`)
      name = typeof candidate.name === 'string' ? candidate.name : undefined
      const parsed = snapshotDescriptor(descriptor, index)
      if (current.has(parsed.descriptor.name) || incompatible.has(parsed.descriptor.name)) {
        current.delete(parsed.descriptor.name)
        incompatible.add(parsed.descriptor.name)
        report(`Portable tool ${displayToolName(parsed.descriptor.name)} has duplicate current descriptors and cannot be projected; regenerate the artifact and restart OpenClaw.`)
        return
      }
      current.set(parsed.descriptor.name, Object.freeze({ ...parsed.descriptor, revision: parsed.revision }))
    } catch (error) {
      if (name !== undefined) incompatible.add(name)
      report(`Portable tool ${name === undefined ? `at catalog index ${index}` : displayToolName(name)} is incompatible with OpenClaw projection: ${displayError(error)}; regenerate the artifact and restart OpenClaw.`)
    }
  })
  const declared = new Set(prepared.tools.map(tool => tool.descriptor.name))
  for (const name of [...current.keys()].filter(name => !declared.has(name)).sort(compareStrings)) {
    report(`Portable tool ${displayToolName(name)} is not declared by the prepared OpenClaw artifact; regenerate the artifact and restart OpenClaw.`)
  }
  const projected: { nativeName: string; descriptor: ToolDescriptor }[] = []
  for (const tool of prepared.tools) {
    const descriptor = current.get(tool.descriptor.name)
    if (descriptor === undefined) {
      if (!incompatible.has(tool.descriptor.name)) {
        report(`Prepared OpenClaw tool ${displayToolName(tool.descriptor.name)} is unavailable in the current Runtime Session.`)
      }
      continue
    }
    if (!descriptor.available) {
      report(`Prepared OpenClaw tool ${displayToolName(tool.descriptor.name)} is currently unavailable.`)
      continue
    }
    const { revision: _revision, ...contract } = descriptor
    if (canonicalJson(descriptorFingerprintValue(contract)) !== canonicalJson(descriptorFingerprintValue(tool.descriptor))) {
      report(`Prepared OpenClaw tool ${displayToolName(tool.descriptor.name)} no longer matches its prepared descriptor contract; regenerate the artifact and restart OpenClaw.`)
      continue
    }
    projected.push(Object.freeze({ nativeName: tool.nativeName, descriptor }))
  }
  return Object.freeze(projected)
}
