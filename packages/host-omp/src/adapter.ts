import { access } from 'node:fs/promises'
import { dirname, join, normalize, parse, resolve } from 'node:path'
import type { RuntimeHostCapabilities, ToolCatalogSnapshot } from '@doppelganger/doppelganger-protocols'
import {
  OMP_RPC_PROTOCOL_VERSION,
  OMP_RUNTIME_HOST_CAPABILITIES,
  defineSerializedOmpActivation,
  defineSessionActivateResult,
  defineToolCatalogChangedParams,
  defineToolCatalogSnapshot,
  type SerializedOmpActivation,
  type SessionActivateParams,
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
  readonly onCatalogChanged?: (catalog: ToolCatalogSnapshot) => void | Promise<void>
  readonly notifyDiagnostic?: (diagnostic: OmpAdapterDiagnostic) => void
}

export interface OmpAdapterSnapshot {
  readonly state: OmpAdapterState
  readonly initializationAvailable: boolean
  readonly diagnostic?: OmpAdapterDiagnostic
  readonly capabilities?: RuntimeHostCapabilities
  readonly runtimeRevision?: string
  readonly runtimeDiagnostics?: unknown
  readonly catalog: ToolCatalogSnapshot
}

export interface OmpAdapterDisposal {
  readonly outcome: 'not-started' | OmpChildDisposal['outcome']
  readonly sessionDisposeAcknowledged: boolean
  readonly diagnostic?: string
}

const EMPTY_CATALOG: ToolCatalogSnapshot = Object.freeze({ revision: 'catalog:0', tools: Object.freeze([]) })

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
    capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
    ...activation,
  })
}

export class OmpAdapterSession {
  readonly #options: OmpAdapterOptions
  #state: OmpAdapterState = 'inactive'
  #diagnostic: OmpAdapterDiagnostic | undefined
  #capabilities: RuntimeHostCapabilities | undefined
  #runtimeRevision: string | undefined
  #runtimeDiagnostics: unknown
  #catalog: ToolCatalogSnapshot = EMPTY_CATALOG
  #connection: OmpChildConnection | undefined
  #catalogQueue = Promise.resolve()
  #pendingCatalogRevision: string | undefined

  constructor(options: OmpAdapterOptions) {
    this.#options = options
  }

  snapshot(): OmpAdapterSnapshot {
    return Object.freeze({
      state: this.#state,
      initializationAvailable: this.#state === 'inactive',
      ...(this.#diagnostic === undefined ? {} : { diagnostic: this.#diagnostic }),
      ...(this.#capabilities === undefined ? {} : { capabilities: this.#capabilities }),
      ...(this.#runtimeRevision === undefined ? {} : { runtimeRevision: this.#runtimeRevision }),
      ...(this.#runtimeDiagnostics === undefined ? {} : { runtimeDiagnostics: this.#runtimeDiagnostics }),
      catalog: this.#catalog,
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
      connection.onNotification('toolCatalog.changed', params => {
        let revision: string
        try {
          revision = defineToolCatalogChangedParams(params).revision
        } catch (cause) {
          if (this.#state === 'active') void this.fail(diagnostic(cause))
          return
        }
        if (this.#state === 'starting') {
          this.#pendingCatalogRevision = revision
          return
        }
        if (this.#state !== 'active') return
        this.#catalogQueue = this.#catalogQueue.then(
          () => this.#refreshCatalog(revision),
          () => this.#refreshCatalog(revision),
        )
      })
      connection.onNotification('runtime.failed', params => {
        const message = params !== null && typeof params === 'object' && 'message' in params
          ? String(params.message)
          : 'runtime reported an unspecified failure'
        void this.fail({ code: 'RUNTIME_FAILED', message })
      })
      const activated = defineSessionActivateResult(await connection.request('session.activate', activate))
      if (this.#state !== 'starting' || connection !== this.#connection) return this.snapshot()
      this.#capabilities = activated.capabilities
      this.#runtimeRevision = activated.runtimeRevision
      this.#runtimeDiagnostics = activated.diagnostics
      this.#catalog = activated.catalog
      while (this.#pendingCatalogRevision !== undefined) {
        const revision = this.#pendingCatalogRevision
        this.#pendingCatalogRevision = undefined
        await this.#refreshCatalog(revision, true)
        if (this.#state !== 'starting' || connection !== this.#connection) return this.snapshot()
      }
      this.#state = 'active'
      await this.#options.onCatalogChanged?.(this.#catalog)
      return this.snapshot()
    } catch (cause) {
      await this.fail(diagnostic(cause))
      return this.snapshot()
    }
  }

  connection(): OmpChildConnection | undefined {
    return this.#state === 'active' ? this.#connection : undefined
  }

  async #refreshCatalog(expectedRevision: string, duringStart = false): Promise<void> {
    const expectedState = duringStart ? 'starting' : 'active'
    if (this.#state !== expectedState || expectedRevision === this.#catalog.revision) return
    const connection = this.#connection
    if (connection === undefined) return
    try {
      const catalog = defineToolCatalogSnapshot(await connection.request('tools.snapshot'))
      if (this.#state !== expectedState || connection !== this.#connection) return
      if (catalog.revision !== expectedRevision) return
      this.#catalog = catalog
      if (!duringStart) await this.#options.onCatalogChanged?.(catalog)
    } catch (cause) {
      if (duringStart) throw cause
      await this.fail(diagnostic(cause))
    }
  }

  async fail(problem: OmpAdapterDiagnostic): Promise<void> {
    if (this.#state === 'disposed' || this.#state === 'failed') return
    this.#state = 'failed'
    this.#diagnostic = Object.freeze({ ...problem })
    this.#capabilities = undefined
    this.#runtimeRevision = undefined
    this.#runtimeDiagnostics = undefined
    this.#catalog = EMPTY_CATALOG
    this.#pendingCatalogRevision = undefined
    await this.#options.onCatalogChanged?.(this.#catalog)
    const connection = this.#connection
    this.#connection = undefined
    if (connection !== undefined) await connection.dispose().catch(() => undefined)
    this.#options.notifyDiagnostic?.(this.#diagnostic)
  }

  async dispose(): Promise<OmpAdapterDisposal> {
    if (this.#state === 'disposed') return Object.freeze({ outcome: 'not-started', sessionDisposeAcknowledged: false })
    this.#state = 'disposed'
    this.#pendingCatalogRevision = undefined
    this.#catalog = EMPTY_CATALOG
    const connection = this.#connection
    this.#connection = undefined
    if (connection === undefined) return Object.freeze({ outcome: 'not-started', sessionDisposeAcknowledged: false })
    return connection.dispose()
  }
}
