import { Context, Service } from '@deepseek-ai/cordis'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]
export interface ToolApprovalRequirement {
  readonly policy: 'required'
  readonly reason: string
}


export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: { readonly [key: string]: JsonValue }
  readonly approval?: ToolApprovalRequirement
  readonly available?: boolean
  invoke(input: JsonValue): JsonValue | Promise<JsonValue>
}

export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  readonly inputSchema: { readonly [key: string]: JsonValue }
  readonly approval?: ToolApprovalRequirement
  readonly available: boolean
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

interface OwnedTool {
  definition: ToolDefinition
  readonly owner: symbol
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerTools: ToolRegistry
  }
  interface Events {
    'doppelganger/tools-changed'(): void
  }
}

function jsonClone(value: JsonValue, label: string): JsonValue {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (cause) {
    throw new TypeError(`${label} must be JSON-serializable`, { cause })
  }
  if (serialized === undefined) throw new TypeError(`${label} must be JSON-serializable`)
  return JSON.parse(serialized) as JsonValue
}
const MAX_TOOL_APPROVAL_REASON_LENGTH = 1_024

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
  if (input.policy !== 'required') {
    throw new TypeError(`tool "${name}" approval policy must be "required"`)
  }
  if (typeof input.reason !== 'string') {
    throw new TypeError(`tool "${name}" approval reason must be a non-empty string`)
  }
  const reason = input.reason.trim()
  if (reason.length === 0 || reason.length > MAX_TOOL_APPROVAL_REASON_LENGTH) {
    throw new TypeError(
      `tool "${name}" approval reason must contain 1-${MAX_TOOL_APPROVAL_REASON_LENGTH} characters`,
    )
  }
  return Object.freeze({ policy: 'required', reason })
}

function validateDefinition(definition: ToolDefinition): ToolDefinition {
  const name = definition.name.trim()
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(name)) {
    throw new TypeError('tool name must be a lowercase plugin-qualified name such as "memory.search"')
  }
  const description = definition.description.trim()
  if (description.length === 0) throw new TypeError(`tool "${name}" description must be non-empty`)
  const inputSchema = jsonClone(definition.inputSchema, `tool "${name}" input schema`)
  if (inputSchema === null || Array.isArray(inputSchema) || typeof inputSchema !== 'object') {
    throw new TypeError(`tool "${name}" input schema must be a JSON object`)
  }
  const schema = inputSchema as { readonly [key: string]: JsonValue }
  const approval = validateApproval(definition.approval, name)
  return Object.freeze({
    name,
    description,
    inputSchema: Object.freeze(schema),
    available: definition.available ?? true,
    invoke: definition.invoke,
    ...(approval === undefined ? {} : { approval }),
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
  private readonly tools = new Map<string, OwnedTool>()

  constructor(ctx: Context) {
    super(ctx, 'doppelgangerTools')
  }

  register(definition: ToolDefinition): ToolRegistration {
    let current = validateDefinition(definition)
    const owner = Symbol(current.name)
    const dispose = this.ctx.effect(() => {
      if (this.tools.has(current.name)) throw new Error(`tool "${current.name}" is already registered`)
      this.tools.set(current.name, { definition: current, owner })
      this.ctx.emit('doppelganger/tools-changed')
      return () => {
        if (this.tools.get(current.name)?.owner === owner) {
          this.tools.delete(current.name)
          this.ctx.emit('doppelganger/tools-changed')
        }
      }
    }, `doppelgangerTools.register(${current.name})`)

    return Object.freeze({
      update: (next: ToolDefinition) => {
        const candidate = validateDefinition(next)
        if (candidate.name !== current.name) throw new Error('a tool registration cannot change its name')
        const active = this.tools.get(current.name)
        if (active?.owner !== owner) throw new Error(`tool "${current.name}" registration is disposed`)
        current = candidate
        active.definition = candidate
        this.ctx.emit('doppelganger/tools-changed')
      },
      dispose: () => { void dispose() },
    })
  }

  list(): readonly ToolDescriptor[] {
    const descriptors = [...this.tools.values()]
      .map(({ definition }) => Object.freeze({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        available: definition.available ?? true,
        ...(definition.approval === undefined ? {} : { approval: definition.approval }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return Object.freeze(descriptors)
  }

  async invoke(name: string, input: JsonValue): Promise<ToolInvocationResult> {
    const owned = this.tools.get(name)
    if (owned === undefined) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({ code: 'TOOL_NOT_FOUND', message: `tool "${name}" is not registered` }),
      })
    }
    if (owned.definition.available === false) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({ code: 'TOOL_UNAVAILABLE', message: `tool "${name}" is unavailable` }),
      })
    }
    try {
      const clonedInput = jsonClone(input, `tool "${name}" input`)
      const value = jsonClone(await owned.definition.invoke(clonedInput), `tool "${name}" result`)
      return Object.freeze({ ok: true, value })
    } catch (cause) {
      if (cause instanceof ToolInvocationError) {
        return Object.freeze({
          ok: false,
          error: Object.freeze({
            code: cause.code,
            message: cause.message,
            ...(cause.data === undefined ? {} : { data: jsonClone(cause.data, `tool "${name}" error data`) }),
          }),
        })
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      return Object.freeze({
        ok: false,
        error: Object.freeze({ code: 'TOOL_EXECUTION_FAILED', message }),
      })
    }
  }
}
