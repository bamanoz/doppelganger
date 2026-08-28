import { access } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import {
  defineSerializedCompositionActivation,
  type SerializedCompositionActivation,
} from '@doppelganger/composition-runtime'
import type { ToolDescriptor } from '@doppelganger/extension-protocols'
import {
  OMP_RPC_PROTOCOL_VERSION,
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
  readonly activation?: SerializedCompositionActivation
  readonly childFactory: OmpChildFactory
  readonly onToolsChanged?: (tools: readonly ToolDescriptor[]) => void | Promise<void>
  readonly onProfileChanged?: (revision: string) => void | Promise<void>
  readonly notifyDiagnostic?: (diagnostic: OmpAdapterDiagnostic) => void
}

export interface OmpAdapterSnapshot {
  readonly state: OmpAdapterState
  readonly initializationAvailable: boolean
  readonly diagnostic?: OmpAdapterDiagnostic
  readonly tools: readonly ToolDescriptor[]
}

export interface OmpAdapterDisposal {
  readonly outcome: 'not-started' | OmpChildDisposal['outcome']
  readonly sessionDisposeAcknowledged: boolean
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function discoverProjectManifest(cwd: string): Promise<string | undefined> {
  let current = cwd
  const root = parse(current).root
  while (true) {
    const manifest = join(current, '.doppelganger', 'manifest.yaml')
    if (await exists(manifest)) return manifest
    if (await exists(join(current, '.git'))) return
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

function activationParams(input: SerializedCompositionActivation): SessionActivateParams {
  const activation = defineSerializedCompositionActivation(input)
  return Object.freeze({
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    ...activation,
  })
}

function toolDescriptors(value: unknown): readonly ToolDescriptor[] {
  if (!Array.isArray(value)) throw new TypeError('runtime tools must be an array')
  return Object.freeze([...value] as ToolDescriptor[])
}

export class OmpAdapterSession {
  readonly #options: OmpAdapterOptions
  #state: OmpAdapterState = 'inactive'
  #diagnostic: OmpAdapterDiagnostic | undefined
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
      connection.onNotification('profile.changed', params => {
        if (this.#state !== 'active' || params === null || typeof params !== 'object' || !('revision' in params)) return
        if (typeof params.revision === 'string') void this.#options.onProfileChanged?.(params.revision)
      })
      connection.onNotification('runtime.failed', params => {
        const message = params !== null && typeof params === 'object' && 'message' in params
          ? String(params.message)
          : 'runtime reported an unspecified failure'
        void this.fail({ code: 'RUNTIME_FAILED', message })
      })
      const activated = await connection.request('session.activate', activate) as SessionActivateResult
      if (activated.protocolVersion !== OMP_RPC_PROTOCOL_VERSION) {
        throw new TypeError(`unsupported runtime RPC protocol version ${String(activated.protocolVersion)}`)
      }
      this.#tools = toolDescriptors(activated.tools)
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
