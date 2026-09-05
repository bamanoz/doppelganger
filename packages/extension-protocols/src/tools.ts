import { createHash } from 'node:crypto'
import { Context, Service, type Logger } from '@deepseek-ai/cordis'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export interface ToolApprovalRequirement {
  readonly policy: 'required'
  readonly reason?: string
}

export interface ToolInvocationContext {
  readonly sessionId: string
  readonly callId: string
  readonly turnId?: string
  readonly signal: AbortSignal
}

export interface ToolDefinition {
  readonly name: string
  readonly label?: string
  readonly description: string
  readonly inputSchema: { readonly [key: string]: JsonValue }
  readonly approval?: ToolApprovalRequirement
  readonly available?: boolean
  invoke(input: JsonValue, context: ToolInvocationContext): JsonValue | Promise<JsonValue>
}

export interface ToolDescriptor {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly inputSchema: { readonly [key: string]: JsonValue }
  readonly revision: string
  readonly approval?: ToolApprovalRequirement
  readonly available: boolean
}

export interface ToolCatalogSnapshot {
  readonly revision: string
  readonly tools: readonly ToolDescriptor[]
}

export interface ToolApprovalGrant {
  readonly kind: 'one-shot'
  readonly grantId: string
  readonly callId: string
  readonly toolRevision: string
  readonly inputDigest: string
}

export interface ToolInvocationRequest {
  readonly callId: string
  readonly turnId?: string
  readonly name: string
  readonly toolRevision: string
  readonly input: JsonValue
  readonly approval?: ToolApprovalGrant
}

export interface ToolCancellationRequest {
  readonly callId: string
  readonly reason?: string
}

export interface ToolCancellationResult {
  readonly cancelled: boolean
}

export interface ToolInvocationErrorData {
  readonly code: string
  readonly message: string
  readonly data?: JsonValue
}

export type ToolInvocationResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: ToolInvocationErrorData }

export interface ToolRegistration {
  update(definition: ToolDefinition): void
  dispose(): void
}

export interface ToolSetRegistration {
  replace(definitions: readonly ToolDefinition[]): void
  dispose(): void
}

interface ValidatedToolDefinition extends ToolDefinition {
  readonly label: string
  readonly available: boolean
}

interface RevisionedTool {
  readonly definition: ValidatedToolDefinition
  readonly revision: string
}

interface OwnedSet {
  readonly ownerId: string
  readonly token: symbol
  tools: ReadonlyMap<string, RevisionedTool>
}

interface ActiveCall {
  readonly controller: AbortController
  readonly settled: Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerTools: ToolRegistry
  }
  interface Events {
    'doppelganger/tools-changed'(revision: string): void
  }
}

const TOOL_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const MAX_TOOL_APPROVAL_REASON_LENGTH = 1_024

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function jsonClone(value: JsonValue, label: string): JsonValue {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (cause) {
    throw new TypeError(`${label} must be JSON-serializable`, { cause })
  }
  if (serialized === undefined) throw new TypeError(`${label} must be JSON-serializable`)
  return deepFreeze(JSON.parse(serialized) as JsonValue)
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

export function digestToolInput(input: JsonValue): string {
  const cloned = jsonClone(input, 'tool input')
  return createHash('sha256').update(canonicalJson(cloned)).digest('hex')
}

function nonEmpty(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value.trim()
}

function validateApproval(
  input: ToolApprovalRequirement | undefined,
  name: string,
): ToolApprovalRequirement | undefined {
  if (input === undefined) return undefined
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new TypeError(`tool "${name}" approval must be an object`)
  }
  const keys = Object.keys(input)
  if (keys.some(key => key !== 'policy' && key !== 'reason')) {
    throw new TypeError(`tool "${name}" approval contains unsupported fields`)
  }
  if (input.policy !== 'required') throw new TypeError(`tool "${name}" approval policy must be "required"`)
  let reason: string | undefined
  if (input.reason !== undefined) {
    reason = nonEmpty(`tool "${name}" approval reason`, input.reason)
    if (reason.length > MAX_TOOL_APPROVAL_REASON_LENGTH) {
      throw new TypeError(`tool "${name}" approval reason must contain 1-${MAX_TOOL_APPROVAL_REASON_LENGTH} characters`)
    }
  }
  return Object.freeze({ policy: 'required', ...(reason === undefined ? {} : { reason }) })

}

function validateDefinition(definition: ToolDefinition): ValidatedToolDefinition {
  if (definition === null || Array.isArray(definition) || typeof definition !== 'object') {
    throw new TypeError('tool definition must be an object')
  }
  const name = nonEmpty('tool name', definition.name)
  if (!TOOL_NAME.test(name)) {
    throw new TypeError('tool name must be a lowercase plugin-qualified name such as "memory.search"')
  }
  const label = definition.label === undefined ? name : nonEmpty(`tool "${name}" label`, definition.label)
  const description = nonEmpty(`tool "${name}" description`, definition.description)
  const inputSchema = jsonClone(definition.inputSchema, `tool "${name}" input schema`)
  if (inputSchema === null || Array.isArray(inputSchema) || typeof inputSchema !== 'object') {
    throw new TypeError(`tool "${name}" input schema must be a JSON object`)
  }
  if (typeof definition.invoke !== 'function') throw new TypeError(`tool "${name}" invoke must be a function`)
  if (definition.available !== undefined && typeof definition.available !== 'boolean') {
    throw new TypeError(`tool "${name}" available must be a boolean`)
  }
  const approval = validateApproval(definition.approval, name)
  return Object.freeze({
    name,
    label,
    description,
    inputSchema: inputSchema as { readonly [key: string]: JsonValue },
    available: definition.available ?? true,
    invoke: definition.invoke,
    ...(approval === undefined ? {} : { approval }),
  })
}

function definitionsEqual(left: ValidatedToolDefinition, right: ValidatedToolDefinition): boolean {
  return left.invoke === right.invoke
    && left.label === right.label
    && left.description === right.description
    && left.available === right.available
    && canonicalJson(left.inputSchema) === canonicalJson(right.inputSchema)
    && canonicalJson((left.approval ?? null) as JsonValue) === canonicalJson((right.approval ?? null) as JsonValue)
}

function failure(code: string, message: string, data?: JsonValue): ToolInvocationResult {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, ...(data === undefined ? {} : { data }) }),
  })
}

function validateGrant(value: ToolApprovalGrant): ToolApprovalGrant {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('tool approval grant must be an object')
  }
  const keys = Object.keys(value)
  if (keys.length !== 5 || keys.some(key => !['kind', 'grantId', 'callId', 'toolRevision', 'inputDigest'].includes(key))) {
    throw new TypeError('tool approval grant contains unsupported or missing fields')
  }
  if (value.kind !== 'one-shot') throw new TypeError('tool approval grant kind must be "one-shot"')
  return Object.freeze({
    kind: 'one-shot',
    grantId: nonEmpty('tool approval grantId', value.grantId),
    callId: nonEmpty('tool approval callId', value.callId),
    toolRevision: nonEmpty('tool approval toolRevision', value.toolRevision),
    inputDigest: nonEmpty('tool approval inputDigest', value.inputDigest),
  })
}

export class ToolInvocationError extends Error {
  readonly code: string
  readonly data?: JsonValue

  constructor(code: string, message: string, data?: JsonValue) {
    super(message)
    this.code = code
    if (data !== undefined) this.data = data
    this.name = 'ToolInvocationError'
  }
}

export class ToolRegistry extends Service {
  private readonly ownerSets = new Map<symbol, OwnedSet>()
  private readonly ownerIds = new Map<string, symbol>()
  private readonly activeCalls = new Map<string, ActiveCall>()
  private readonly consumedApprovalGrants = new Set<string>()
  private catalogSequence = 0
  private toolSequence = 0
  private singleOwnerSequence = 0
  private currentSnapshot: ToolCatalogSnapshot = Object.freeze({ revision: 'catalog:0', tools: Object.freeze([]) })
  private readonly logger: Logger

  constructor(ctx: Context) {
    super(ctx, 'doppelgangerTools')
    this.logger = ctx.logger('doppelganger-tools')
    this.logger.info('component.active')
    ctx.effect(() => () => {
      this.logger.info('component.disposal.started activeCalls=%d', this.activeCalls.size)
      this.disposeActiveCalls('tool registry disposed')
    }, 'doppelgangerTools.cancelActiveCalls')
  }

  private nextToolRevision(): string {
    return `tool:${++this.toolSequence}`
  }

  private rebuildSnapshot(): string {
    const descriptors = [...this.ownerSets.values()]
      .flatMap(owner => [...owner.tools.values()])
      .map(({ definition, revision }) => Object.freeze({
        name: definition.name,
        label: definition.label,
        description: definition.description,
        inputSchema: definition.inputSchema,
        revision,
        available: definition.available,
        ...(definition.approval === undefined ? {} : { approval: definition.approval }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    const revision = `catalog:${++this.catalogSequence}`
    this.currentSnapshot = Object.freeze({ revision, tools: Object.freeze(descriptors) })
    this.ctx.emit('doppelganger/tools-changed', revision)
    this.logger.debug('tools.catalog.changed tools=%d revision=%s', descriptors.length, revision)
    return revision
  }

  private replaceOwnedSet(owner: OwnedSet, definitions: readonly ToolDefinition[]): void {
    if (this.ownerSets.get(owner.token) !== owner) throw new Error(`tool set "${owner.ownerId}" is disposed`)
    const validated = definitions.map(validateDefinition)
    const names = new Set<string>()
    for (const definition of validated) {
      if (names.has(definition.name)) throw new Error(`tool set "${owner.ownerId}" contains duplicate tool "${definition.name}"`)
      names.add(definition.name)
      for (const other of this.ownerSets.values()) {
        if (other.token !== owner.token && other.tools.has(definition.name)) {
          throw new Error(`tool "${definition.name}" is already registered by owner "${other.ownerId}"`)
        }
      }
    }

    const candidate = new Map<string, RevisionedTool>()
    for (const definition of validated) {
      const previous = owner.tools.get(definition.name)
      candidate.set(definition.name, Object.freeze({
        definition,
        revision: previous !== undefined && definitionsEqual(previous.definition, definition)
          ? previous.revision
          : this.nextToolRevision(),
      }))
    }
    const unchanged = candidate.size === owner.tools.size
      && [...candidate].every(([name, tool]) => owner.tools.get(name)?.revision === tool.revision)
    if (unchanged) return
    owner.tools = candidate
    this.rebuildSnapshot()
  }

  registerSet(ownerIdInput: string, definitions: readonly ToolDefinition[]): ToolSetRegistration {
    const ownerId = nonEmpty('tool set ownerId', ownerIdInput)
    if (this.ownerIds.has(ownerId)) throw new Error(`tool set owner "${ownerId}" is already registered`)
    const owner: OwnedSet = { ownerId, token: Symbol(ownerId), tools: new Map() }
    this.ownerSets.set(owner.token, owner)
    this.ownerIds.set(ownerId, owner.token)
    let disposed = false
    try {
      this.replaceOwnedSet(owner, definitions)
    } catch (cause) {
      this.ownerSets.delete(owner.token)
      this.ownerIds.delete(ownerId)
      throw cause
    }
    const disposeEffect = this.ctx.effect(() => () => {
      if (disposed) return
      disposed = true
      this.ownerSets.delete(owner.token)
      this.ownerIds.delete(ownerId)
      if (owner.tools.size > 0) this.rebuildSnapshot()
      owner.tools = new Map()
    }, `doppelgangerTools.registerSet(${ownerId})`)

    return Object.freeze({
      replace: (next: readonly ToolDefinition[]) => {
        if (disposed) throw new Error(`tool set "${ownerId}" is disposed`)
        this.replaceOwnedSet(owner, next)
      },
      dispose: () => { void disposeEffect() },
    })
  }

  register(definition: ToolDefinition): ToolRegistration {
    const ownerId = `single:${++this.singleOwnerSequence}:${definition.name}`
    const set = this.registerSet(ownerId, [definition])
    return Object.freeze({
      update: (next: ToolDefinition) => {
        if (next.name.trim() !== definition.name.trim()) throw new Error('a tool registration cannot change its name')
        set.replace([next])
        definition = next
      },
      dispose: set.dispose,
    })
  }

  snapshot(): ToolCatalogSnapshot {
    return this.currentSnapshot
  }

  async invoke(request: ToolInvocationRequest, sessionIdInput: string): Promise<ToolInvocationResult> {
    let sessionId: string
    let callId: string
    let name: string
    let toolRevision: string
    let clonedInput: JsonValue
    try {
      sessionId = nonEmpty('tool invocation sessionId', sessionIdInput)
      callId = nonEmpty('tool invocation callId', request.callId)
      name = nonEmpty('tool invocation name', request.name)
      toolRevision = nonEmpty('tool invocation toolRevision', request.toolRevision)
      if (request.turnId !== undefined) nonEmpty('tool invocation turnId', request.turnId)
      clonedInput = jsonClone(request.input, `tool "${name}" input`)
    } catch (cause) {
      this.logger.warn('tools.invoke.rejected tool=unknown code=INVALID_INPUT')
      return failure('INVALID_INPUT', cause instanceof Error ? cause.message : String(cause))
    }

    const rejected = (code: string, message: string): ToolInvocationResult => {
      this.logger.warn('tools.invoke.rejected tool=%s code=%s', name, code)
      return failure(code, message)
    }

    this.logger.debug('tools.invoke.started tool=%s', name)
    const current = [...this.ownerSets.values()].map(owner => owner.tools.get(name)).find(tool => tool !== undefined)
    if (current === undefined) return rejected('TOOL_NOT_FOUND', `tool "${name}" is not registered`)
    if (current.revision !== toolRevision) {
      return rejected('TOOL_REVISION_STALE', `tool "${name}" revision is stale`)
    }
    if (!current.definition.available) return rejected('TOOL_UNAVAILABLE', `tool "${name}" is unavailable`)
    if (this.activeCalls.has(callId)) return rejected('TOOL_CALL_ACTIVE', `tool call "${callId}" is already active`)

    if (current.definition.approval === undefined) {
      if (request.approval !== undefined) {
        return rejected('TOOL_APPROVAL_INVALID', `tool "${name}" does not accept an approval grant`)
      }
    } else {
      if (request.approval === undefined) {
        return rejected('TOOL_APPROVAL_REQUIRED', `tool "${name}" requires explicit approval`)
      }
      let approval: ToolApprovalGrant
      try {
        approval = validateGrant(request.approval)
      } catch (cause) {
        return rejected('TOOL_APPROVAL_INVALID', cause instanceof Error ? cause.message : String(cause))
      }
      if (this.consumedApprovalGrants.has(approval.grantId)) {
        return rejected('TOOL_APPROVAL_INVALID', `tool approval grant "${approval.grantId}" was already consumed`)
      }
      const inputDigest = createHash('sha256').update(canonicalJson(clonedInput)).digest('hex')
      if (approval.callId !== callId || approval.toolRevision !== toolRevision || approval.inputDigest !== inputDigest) {
        return rejected('TOOL_APPROVAL_INVALID', 'tool approval grant does not match the invocation')
      }
      this.consumedApprovalGrants.add(approval.grantId)
    }

    const controller = new AbortController()
    let settle!: () => void
    const settled = new Promise<void>(resolve => { settle = resolve })
    this.activeCalls.set(callId, { controller, settled })
    const invocationContext = Object.freeze({
      sessionId,
      callId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId.trim() }),
      signal: controller.signal,
    })
    try {
      const value = jsonClone(
        await current.definition.invoke(clonedInput, invocationContext),
        `tool "${name}" result`,
      )
      this.logger.debug('tools.invoke.completed tool=%s outcome=completed', name)
      return Object.freeze({ ok: true, value })
    } catch (cause) {
      this.logger.warn('tools.invoke.completed tool=%s outcome=failed code=%s', name, controller.signal.aborted ? 'TOOL_CANCELLED' : cause instanceof ToolInvocationError ? cause.code : 'TOOL_EXECUTION_FAILED')
      if (controller.signal.aborted) return failure('TOOL_CANCELLED', `tool "${name}" was cancelled`)
      if (cause instanceof ToolInvocationError) {
        return failure(
          cause.code,
          cause.message,
          cause.data === undefined ? undefined : jsonClone(cause.data, `tool "${name}" error data`),
        )
      }
      return failure('TOOL_EXECUTION_FAILED', cause instanceof Error ? cause.message : String(cause))
    } finally {
      this.logger.debug('tools.invoke.settled tool=%s', name)
      this.activeCalls.delete(callId)
      settle()
    }
  }

  cancel(request: ToolCancellationRequest): ToolCancellationResult {
    const callId = nonEmpty('tool cancellation callId', request.callId)
    if (request.reason !== undefined) nonEmpty('tool cancellation reason', request.reason)
    const active = this.activeCalls.get(callId)
    if (active === undefined || active.controller.signal.aborted) return Object.freeze({ cancelled: false })
    active.controller.abort(request.reason)
    return Object.freeze({ cancelled: true })
  }

  async disposeActiveCalls(reason: string): Promise<void> {
    const calls = [...this.activeCalls.values()]
    for (const active of calls) {
      if (!active.controller.signal.aborted) active.controller.abort(reason)
    }
    await Promise.all(calls.map(active => active.settled))
  }
}
