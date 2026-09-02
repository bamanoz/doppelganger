import { access } from 'node:fs/promises'
import { dirname, join, normalize, parse, resolve } from 'node:path'
import type { ToolDescriptor } from '@doppelganger/doppelganger-protocols'
import {
  OMP_RPC_PROTOCOL_VERSION,
  defineSerializedOmpActivation,
  type RuntimeChangedParams,
  type SerializedOmpActivation,
  type SessionActivateParams,
  type SessionActivateResult,
} from './contracts.ts'

export type OmpAdapterState = 'inactive' | 'starting' | 'active' | 'failed' | 'disposed'

export interface OmpAdapterDiagnostic {
  readonly code: string
  readonly message: string
}

export interface OmpChildDisposal {
  readonly outcome: 'graceful' | 'terminated' | 'killed'
  readonly sessionDisposeAcknowledged: boolean
  readonly diagnostic?: string
}

export interface OmpChildConnection {
  readonly processId?: number
  request(method: string, params?: unknown): Promise<unknown>
  onNotification(method: string, handler: (params: unknown) => void): () => void
  dispose(): Promise<OmpChildDisposal>
}

export interface OmpChildFactory {
  start(): Promise<OmpChildConnection>
}

export interface OmpAdapterOptions {
  readonly activation?: SerializedOmpActivation
  readonly childFactory: OmpChildFactory
  readonly onToolsChanged?: (tools: readonly ToolDescriptor[]) => void | Promise<void>
  readonly onRuntimeChanged?: (revision: string, diagnostics: unknown) => void | Promise<void>
  readonly notifyDiagnostic?: (diagnostic: OmpAdapterDiagnostic) => void
}

export interface OmpAdapterSnapshot {
  readonly state: OmpAdapterState
  readonly initializationAvailable: boolean
  readonly diagnostic?: OmpAdapterDiagnostic
  readonly runtimeRevision?: string
  readonly runtimeDiagnostics?: unknown
  readonly tools: readonly ToolDescriptor[]
}

export interface OmpAdapterDisposal {
  readonly outcome: 'not-started' | OmpChildDisposal['outcome']
  readonly sessionDisposeAcknowledged: boolean
  readonly diagnostic?: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export interface OmpProjectDiscovery {
  readonly workspaceRoot: string
  readonly manifestPath?: string
}

export async function discoverOmpProject(cwd: string): Promise<OmpProjectDiscovery | undefined> {
  let current = normalize(resolve(cwd))
  const root = parse(current).root
  while (true) {
    const manifestPath = join(current, '.doppelganger', 'manifest.yaml')
    if (await exists(manifestPath)) return Object.freeze({ workspaceRoot: current, manifestPath })
    if (await exists(join(current, '.git'))) return Object.freeze({ workspaceRoot: current })
    if (current === root) return
    current = dirname(current)
  }
}

function diagnostic(cause: unknown): OmpAdapterDiagnostic {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : 'RUNTIME_START_FAILED'
  return Object.freeze({
    code,
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

function activationParams(input: SerializedOmpActivation): SessionActivateParams {
  const activation = defineSerializedOmpActivation(input)
  return Object.freeze({
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    ...activation,
  })
}

function toolApproval(value: unknown, label: string): ToolDescriptor['approval'] {
  if (value === undefined) return undefined
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'policy' && key !== 'reason')) {
    throw new TypeError(`${label} contains unsupported fields`)
  }
  if (!('policy' in value) || value.policy !== 'required') {
    throw new TypeError(`${label}.policy must be "required"`)
  }
  if (!('reason' in value) || typeof value.reason !== 'string'
    || value.reason.trim().length === 0 || value.reason.trim().length > 1_024) {
    throw new TypeError(`${label}.reason must contain 1-1024 characters`)
  }
  return Object.freeze({ policy: 'required', reason: value.reason.trim() })
}

function toolDescriptors(value: unknown): readonly ToolDescriptor[] {
  if (!Array.isArray(value)) throw new TypeError('runtime tools must be an array')
  const tools = value.map((item, index) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      throw new TypeError(`runtime tools[${index}] must be an object`)
    }
    if (!('name' in item) || typeof item.name !== 'string' || item.name.length === 0) {
      throw new TypeError(`runtime tools[${index}].name must be a non-empty string`)
    }
    if (!('description' in item) || typeof item.description !== 'string' || item.description.length === 0) {
      throw new TypeError(`runtime tools[${index}].description must be a non-empty string`)
    }
    if (!('inputSchema' in item) || item.inputSchema === null || Array.isArray(item.inputSchema)
      || typeof item.inputSchema !== 'object') {
      throw new TypeError(`runtime tools[${index}].inputSchema must be an object`)
    }
    if (!('available' in item) || typeof item.available !== 'boolean') {
      throw new TypeError(`runtime tools[${index}].available must be a boolean`)
    }
    const approval = toolApproval('approval' in item ? item.approval : undefined, `runtime tools[${index}].approval`)
    const descriptor: ToolDescriptor = {
      name: item.name,
      description: item.description,
      inputSchema: item.inputSchema,
      available: item.available,
      ...(approval === undefined ? {} : { approval }),
    }
    return Object.freeze(descriptor)
  })
  return Object.freeze(tools)
}

function sessionActivateResult(value: unknown): SessionActivateResult {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('session.activate result must be an object')
  }
  if (!('protocolVersion' in value) || value.protocolVersion !== OMP_RPC_PROTOCOL_VERSION) {
    const version = 'protocolVersion' in value ? value.protocolVersion : undefined
    throw new TypeError(`unsupported runtime RPC protocol version ${String(version)}`)
  }
  if (!('runtimeRevision' in value) || typeof value.runtimeRevision !== 'string' || value.runtimeRevision.length === 0) {
    throw new TypeError('session.activate result runtimeRevision must be a non-empty string')
  }
  if (!('diagnostics' in value)) throw new TypeError('session.activate result must include diagnostics')
  if (!('tools' in value)) throw new TypeError('session.activate result must include tools')
  return Object.freeze({
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    runtimeRevision: value.runtimeRevision,
    diagnostics: value.diagnostics,
    tools: toolDescriptors(value.tools),
  })
}

function runtimeChangedParams(value: unknown): RuntimeChangedParams {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('runtime.changed params must be an object')
  }
  if (!('runtimeRevision' in value) || typeof value.runtimeRevision !== 'string' || value.runtimeRevision.length === 0) {
    throw new TypeError('runtime.changed runtimeRevision must be a non-empty string')
  }
  if (!('diagnostics' in value)) throw new TypeError('runtime.changed must include diagnostics')
  if (!('tools' in value)) throw new TypeError('runtime.changed must include tools')
  return Object.freeze({
    runtimeRevision: value.runtimeRevision,
    diagnostics: value.diagnostics,
    tools: toolDescriptors(value.tools),
  })
}

export class OmpAdapterSession {
  readonly #options: OmpAdapterOptions
  #state: OmpAdapterState = 'inactive'
  #diagnostic: OmpAdapterDiagnostic | undefined
  #runtimeRevision: string | undefined
  #runtimeDiagnostics: unknown
  #tools: readonly ToolDescriptor[] = Object.freeze([])
  #connection: OmpChildConnection | undefined

  constructor(options: OmpAdapterOptions) {
    this.#options = options
  }

  snapshot(): OmpAdapterSnapshot {
    return Object.freeze({
      state: this.#state,
      initializationAvailable: this.#state === 'inactive',
      ...(this.#diagnostic === undefined ? {} : { diagnostic: this.#diagnostic }),
      ...(this.#runtimeRevision === undefined ? {} : { runtimeRevision: this.#runtimeRevision }),
      ...(this.#runtimeDiagnostics === undefined ? {} : { runtimeDiagnostics: this.#runtimeDiagnostics }),
      tools: this.#tools,
    })
  }

  async start(): Promise<OmpAdapterSnapshot> {
    if (this.#state === 'disposed') throw new Error('OMP adapter session is disposed')
    if (this.#state !== 'inactive') throw new Error(`OMP adapter cannot start from ${this.#state} state`)
    this.#state = 'starting'
    try {
      if (this.#options.activation === undefined) {
        this.#state = 'inactive'
        return this.snapshot()
      }
      const activate = activationParams(this.#options.activation)
      const connection = await this.#options.childFactory.start()
      this.#connection = connection
      connection.onNotification('tools.changed', params => {
        if (this.#state !== 'active') return
        try {
          this.#tools = toolDescriptors(params)
          void Promise.resolve(this.#options.onToolsChanged?.(this.#tools)).catch(cause => this.fail(diagnostic(cause)))
        } catch (cause) {
          void this.fail(diagnostic(cause))
        }
      })
      connection.onNotification('runtime.changed', params => {
        if (this.#state !== 'active') return
        try {
          const changed = runtimeChangedParams(params)
          this.#runtimeRevision = changed.runtimeRevision
          this.#runtimeDiagnostics = changed.diagnostics
          this.#tools = changed.tools
          void Promise.resolve(this.#options.onToolsChanged?.(this.#tools))
            .then(() => this.#options.onRuntimeChanged?.(changed.runtimeRevision, changed.diagnostics))
            .catch(cause => this.fail(diagnostic(cause)))
        } catch (cause) {
          void this.fail(diagnostic(cause))
        }
      })
      connection.onNotification('runtime.failed', params => {
        const message = params !== null && typeof params === 'object' && 'message' in params
          ? String(params.message)
          : 'runtime reported an unspecified failure'
        void this.fail({ code: 'RUNTIME_FAILED', message })
      })
      const activated = sessionActivateResult(await connection.request('session.activate', activate))
      this.#runtimeRevision = activated.runtimeRevision
      this.#runtimeDiagnostics = activated.diagnostics
      this.#tools = activated.tools
      this.#state = 'active'
      await this.#options.onToolsChanged?.(this.#tools)
      return this.snapshot()
    } catch (cause) {
      await this.fail(diagnostic(cause))
      return this.snapshot()
    }
  }

  connection(): OmpChildConnection | undefined {
    return this.#state === 'active' ? this.#connection : undefined
  }

  async fail(problem: OmpAdapterDiagnostic): Promise<void> {
    if (this.#state === 'disposed' || this.#state === 'failed') return
    this.#state = 'failed'
    this.#diagnostic = Object.freeze({ ...problem })
    this.#runtimeRevision = undefined
    this.#runtimeDiagnostics = undefined
    this.#tools = Object.freeze([])
    await this.#options.onToolsChanged?.(this.#tools)
    const connection = this.#connection
    this.#connection = undefined
    if (connection !== undefined) await connection.dispose().catch(() => undefined)
    this.#options.notifyDiagnostic?.(this.#diagnostic)
  }

  async dispose(): Promise<OmpAdapterDisposal> {
    if (this.#state === 'disposed') return Object.freeze({ outcome: 'not-started', sessionDisposeAcknowledged: false })
    this.#state = 'disposed'
    this.#tools = Object.freeze([])
    const connection = this.#connection
    this.#connection = undefined
    if (connection === undefined) return Object.freeze({ outcome: 'not-started', sessionDisposeAcknowledged: false })
    return connection.dispose()
  }
}
