import {
  canonicalAbsolutePath,
  canonicalNonEmpty,
  canonicalizeCompositionDefinition,
  type CanonicalCompositionDefinition,
  type CanonicalCompositionInput,
} from '@doppelganger/doppelganger-composition-runtime'
import {
  RUNTIME_HOST_PROTOCOL_VERSION,
  createActorIdentity,
  defineRuntimeHostCapabilities,
  type AssembledContext,
  type HostContextRequest,
  type JsonValue,
  type LifecycleEvent,
  type RuntimeHostCapabilities,
  type ToolApprovalGrant,
  type ToolCancellationRequest,
  type ToolCancellationResult,
  type ToolCatalogSnapshot,
  type ToolDescriptor,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@doppelganger/doppelganger-protocols'

export const OMP_RPC_PROTOCOL_VERSION = 4 as const

export const OMP_RUNTIME_HOST_CAPABILITIES: RuntimeHostCapabilities = defineRuntimeHostCapabilities({
  protocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
  context: { delivery: 'per-turn' },
  tools: { delivery: 'dynamic', requiredApproval: true, cancellation: true },
  lifecycle: {
    events: [
      'session-started',
      'session-disposed',
      'turn-started',
      'turn-committed',
      'tool-started',
      'tool-completed',
      'pre-compaction',
    ],
  },
})

export interface SerializedOmpActivation {
  readonly composition: CanonicalCompositionInput
  readonly sessionId: string
  readonly workspaceRoot?: string
  readonly hostKind: 'omp'
  readonly watch?: boolean
  readonly actorId?: string
}

export interface DefinedSerializedOmpActivation {
  readonly composition: CanonicalCompositionDefinition
  readonly sessionId: string
  readonly workspaceRoot?: string
  readonly hostKind: 'omp'
  readonly watch?: boolean
  readonly actorId?: string
}

export interface DefinedSessionActivateParams extends DefinedSerializedOmpActivation {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
  readonly capabilities: RuntimeHostCapabilities
}

export interface SessionActivateParams extends SerializedOmpActivation {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
  readonly capabilities: RuntimeHostCapabilities
}

export interface SessionActivateResult {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
  readonly capabilities: RuntimeHostCapabilities
  readonly diagnostics: unknown
  readonly runtimeRevision: string
  readonly catalog: ToolCatalogSnapshot
}

export interface RuntimeDiagnosticsResult {
  readonly runtimeRevision: string
  readonly diagnostics: unknown
}

export interface ToolCatalogChangedParams {
  readonly revision: string
}

export interface OmpRpcMethods {
  'session.activate': { readonly params: SessionActivateParams; readonly result: SessionActivateResult }
  'session.dispose': { readonly params: undefined; readonly result: null }
  'runtime.diagnostics': { readonly params: undefined; readonly result: RuntimeDiagnosticsResult }
  'context.resolve': { readonly params: HostContextRequest; readonly result: AssembledContext }
  'tools.snapshot': { readonly params: undefined; readonly result: ToolCatalogSnapshot }
  'tools.invoke': { readonly params: ToolInvocationRequest; readonly result: ToolInvocationResult }
  'tools.cancel': { readonly params: ToolCancellationRequest; readonly result: ToolCancellationResult }
  'event.publish': { readonly params: LifecycleEvent; readonly result: null }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const unsupported = Object.keys(value).filter(key => !allowed.has(key)).sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  const missing = required.filter(key => !(key in value))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a non-empty string`)
  return canonicalNonEmpty(label, value)
}

function jsonClone(value: unknown, label: string): JsonValue {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch (cause) {
    throw new TypeError(`${label} must be JSON-compatible`, { cause })
  }
  if (encoded === undefined) throw new TypeError(`${label} must be JSON-compatible`)
  return deepFreeze(JSON.parse(encoded) as JsonValue)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function approval(value: unknown, label: string): ToolDescriptor['approval'] {
  if (value === undefined) return undefined
  const record = object(value, label)
  exactKeys(record, ['policy'], ['reason'], label)
  if (record.policy !== 'required') throw new TypeError(`${label}.policy must be "required"`)
  const reason = record.reason === undefined ? undefined : nonEmpty(record.reason, `${label}.reason`)
  if (reason !== undefined && reason.length > 1_024) {
    throw new TypeError(`${label}.reason must contain 1-1024 characters`)
  }
  return Object.freeze({ policy: 'required', ...(reason === undefined ? {} : { reason }) })
}


function approvalGrant(value: unknown, label: string): ToolApprovalGrant {
  const record = object(value, label)
  exactKeys(record, ['kind', 'grantId', 'callId', 'toolRevision', 'inputDigest'], [], label)
  if (record.kind !== 'one-shot') throw new TypeError(`${label}.kind must be "one-shot"`)
  return Object.freeze({
    kind: 'one-shot',
    grantId: nonEmpty(record.grantId, `${label}.grantId`),
    callId: nonEmpty(record.callId, `${label}.callId`),
    toolRevision: nonEmpty(record.toolRevision, `${label}.toolRevision`),
    inputDigest: nonEmpty(record.inputDigest, `${label}.inputDigest`),
  })
}

export function defineSerializedOmpActivation(input: unknown): DefinedSerializedOmpActivation {
  const record = object(input, 'activation')
  exactKeys(record, ['composition', 'sessionId', 'hostKind'], ['workspaceRoot', 'watch', 'actorId'], 'activation')
  if (record.hostKind !== 'omp') throw new TypeError('activation.hostKind must equal "omp"')
  if (record.watch !== undefined && typeof record.watch !== 'boolean') throw new TypeError('activation.watch must be a boolean')
  const actor = createActorIdentity(record.actorId as string | undefined)
  return Object.freeze({
    composition: canonicalizeCompositionDefinition(
      object(record.composition, 'activation.composition') as unknown as CanonicalCompositionInput,
      'activation.composition',
    ),
    sessionId: nonEmpty(record.sessionId, 'activation.sessionId'),
    ...(record.workspaceRoot === undefined
      ? {}
      : { workspaceRoot: canonicalAbsolutePath('activation.workspaceRoot', nonEmpty(record.workspaceRoot, 'activation.workspaceRoot')) }),
    hostKind: 'omp',
    ...(record.watch === undefined ? {} : { watch: record.watch }),
    ...(actor.state === 'bound' ? { actorId: actor.actorId } : {}),
  })
}

export function defineSessionActivateParams(value: unknown): DefinedSessionActivateParams {
  const record = object(value, 'session.activate params')
  exactKeys(
    record,
    ['protocolVersion', 'capabilities', 'composition', 'sessionId', 'hostKind'],
    ['workspaceRoot', 'watch', 'actorId'],
    'session.activate params',
  )
  if (record.protocolVersion !== OMP_RPC_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported OMP RPC protocol version ${String(record.protocolVersion)}`)
  }
  const capabilities = defineRuntimeHostCapabilities(record.capabilities)
  if (JSON.stringify(capabilities) !== JSON.stringify(OMP_RUNTIME_HOST_CAPABILITIES)) {
    throw new TypeError('session.activate capabilities do not match the OMP capability profile')
  }
  return Object.freeze({
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    capabilities,
    ...defineSerializedOmpActivation({
      composition: record.composition,
      sessionId: record.sessionId,
      hostKind: record.hostKind,
      ...(record.workspaceRoot === undefined ? {} : { workspaceRoot: record.workspaceRoot }),
      ...(record.watch === undefined ? {} : { watch: record.watch }),
      ...(record.actorId === undefined ? {} : { actorId: record.actorId }),
    }),
  })
}

export function defineToolCatalogSnapshot(value: unknown, label = 'tool catalog'): ToolCatalogSnapshot {
  const record = object(value, label)
  exactKeys(record, ['revision', 'tools'], [], label)
  if (!Array.isArray(record.tools)) throw new TypeError(`${label}.tools must be an array`)
  const names = new Set<string>()
  const tools = record.tools.map((candidate, index) => {
    const toolLabel = `${label}.tools[${index}]`
    const tool = object(candidate, toolLabel)
    exactKeys(tool, ['name', 'label', 'description', 'inputSchema', 'revision', 'available'], ['approval'], toolLabel)
    const name = nonEmpty(tool.name, `${toolLabel}.name`)
    if (names.has(name)) throw new TypeError(`${label} contains duplicate tool "${name}"`)
    names.add(name)
    const inputSchema = jsonClone(tool.inputSchema, `${toolLabel}.inputSchema`)
    if (inputSchema === null || Array.isArray(inputSchema) || typeof inputSchema !== 'object') {
      throw new TypeError(`${toolLabel}.inputSchema must be an object`)
    }
    if (typeof tool.available !== 'boolean') throw new TypeError(`${toolLabel}.available must be a boolean`)
    const requiredApproval = approval(tool.approval, `${toolLabel}.approval`)
    return Object.freeze({
      name,
      label: nonEmpty(tool.label, `${toolLabel}.label`),
      description: nonEmpty(tool.description, `${toolLabel}.description`),
      inputSchema: inputSchema as { readonly [key: string]: JsonValue },
      revision: nonEmpty(tool.revision, `${toolLabel}.revision`),
      available: tool.available,
      ...(requiredApproval === undefined ? {} : { approval: requiredApproval }),
    })
  })
  const ordered = [...tools].sort((left, right) => left.name.localeCompare(right.name))
  if (tools.some((tool, index) => tool !== ordered[index])) throw new TypeError(`${label}.tools must be ordered by canonical name`)
  return Object.freeze({ revision: nonEmpty(record.revision, `${label}.revision`), tools: Object.freeze(tools) })
}

export function defineHostContextRequest(value: unknown): HostContextRequest {
  const record = object(value, 'context.resolve params')
  exactKeys(record, ['requestId', 'turn', 'tokenBudget'], [], 'context.resolve params')
  const turn = object(record.turn, 'context.resolve params.turn')
  exactKeys(turn, ['input'], ['turnId'], 'context.resolve params.turn')
  if (typeof turn.input !== 'string') throw new TypeError('context.resolve params.turn.input must be a string')
  if (!Number.isSafeInteger(record.tokenBudget) || (record.tokenBudget as number) < 0) {
    throw new TypeError('context.resolve params.tokenBudget must be a non-negative safe integer')
  }
  return Object.freeze({
    requestId: nonEmpty(record.requestId, 'context.resolve params.requestId'),
    turn: Object.freeze({
      input: turn.input,
      ...(turn.turnId === undefined ? {} : { turnId: nonEmpty(turn.turnId, 'context.resolve params.turn.turnId') }),
    }),
    tokenBudget: record.tokenBudget as number,
  })
}

export function defineToolInvocationRequest(value: unknown): ToolInvocationRequest {
  const record = object(value, 'tools.invoke params')
  exactKeys(record, ['callId', 'name', 'toolRevision', 'input'], ['turnId', 'approval'], 'tools.invoke params')
  return Object.freeze({
    callId: nonEmpty(record.callId, 'tools.invoke params.callId'),
    ...(record.turnId === undefined ? {} : { turnId: nonEmpty(record.turnId, 'tools.invoke params.turnId') }),
    name: nonEmpty(record.name, 'tools.invoke params.name'),
    toolRevision: nonEmpty(record.toolRevision, 'tools.invoke params.toolRevision'),
    input: jsonClone(record.input, 'tools.invoke params.input'),
    ...(record.approval === undefined ? {} : { approval: approvalGrant(record.approval, 'tools.invoke params.approval') }),
  })
}

export function defineToolCancellationRequest(value: unknown): ToolCancellationRequest {
  const record = object(value, 'tools.cancel params')
  exactKeys(record, ['callId'], ['reason'], 'tools.cancel params')
  return Object.freeze({
    callId: nonEmpty(record.callId, 'tools.cancel params.callId'),
    ...(record.reason === undefined ? {} : { reason: nonEmpty(record.reason, 'tools.cancel params.reason') }),
  })
}

export function defineToolInvocationResult(value: unknown): ToolInvocationResult {
  const record = object(value, 'tools.invoke result')
  if (record.ok === true) {
    exactKeys(record, ['ok', 'value'], [], 'tools.invoke result')
    return Object.freeze({ ok: true, value: jsonClone(record.value, 'tools.invoke result.value') })
  }
  if (record.ok !== false) throw new TypeError('tools.invoke result.ok must be a boolean')
  exactKeys(record, ['ok', 'error'], [], 'tools.invoke result')
  const error = object(record.error, 'tools.invoke result.error')
  exactKeys(error, ['code', 'message'], ['data'], 'tools.invoke result.error')
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: nonEmpty(error.code, 'tools.invoke result.error.code'),
      message: nonEmpty(error.message, 'tools.invoke result.error.message'),
      ...(error.data === undefined ? {} : { data: jsonClone(error.data, 'tools.invoke result.error.data') }),
    }),
  })
}

export function defineSessionActivateResult(value: unknown): SessionActivateResult {
  const record = object(value, 'session.activate result')
  exactKeys(record, ['protocolVersion', 'capabilities', 'diagnostics', 'runtimeRevision', 'catalog'], [], 'session.activate result')
  if (record.protocolVersion !== OMP_RPC_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported runtime RPC protocol version ${String(record.protocolVersion)}`)
  }
  const capabilities = defineRuntimeHostCapabilities(record.capabilities)
  if (JSON.stringify(capabilities) !== JSON.stringify(OMP_RUNTIME_HOST_CAPABILITIES)) {
    throw new TypeError('session.activate result capabilities do not match the OMP capability profile')
  }
  return Object.freeze({
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    capabilities,
    diagnostics: jsonClone(record.diagnostics, 'session.activate result.diagnostics'),
    runtimeRevision: nonEmpty(record.runtimeRevision, 'session.activate result.runtimeRevision'),
    catalog: defineToolCatalogSnapshot(record.catalog, 'session.activate result.catalog'),
  })
}

export function defineToolCatalogChangedParams(value: unknown): ToolCatalogChangedParams {
  const record = object(value, 'toolCatalog.changed params')
  exactKeys(record, ['revision'], [], 'toolCatalog.changed params')
  return Object.freeze({ revision: nonEmpty(record.revision, 'toolCatalog.changed params.revision') })
}

export function defineToolCancellationResult(value: unknown): ToolCancellationResult {
  const record = object(value, 'tools.cancel result')
  exactKeys(record, ['cancelled'], [], 'tools.cancel result')
  if (typeof record.cancelled !== 'boolean') throw new TypeError('tools.cancel result.cancelled must be a boolean')
  return Object.freeze({ cancelled: record.cancelled })
}
