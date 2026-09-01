import { dirname, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionRuntime,
  type CompositionSession,
  type SerializedCompositionDefinition,
} from '@doppelganger/doppelganger-composition-runtime'
import {
  OMP_RPC_PROTOCOL_VERSION,
  defineSerializedOmpActivation,
  type ContextResolveParams,
  type SessionActivateParams,
  type ToolsInvokeParams,
} from './contracts.ts'
import { FramedJsonRpcPeer, type RpcNotificationObserverDiagnostic } from './protocol.ts'
import {
  createOmpRuntimeHostPlugin,
  type OmpLifecycleEvent,
  type OmpRuntimeHost,
  type RuntimeNotification,
} from './runtime-host.ts'

export interface OmpRuntimeChild {
  dispose(): Promise<void>
}

export interface OmpRuntimeChildOptions {
  readonly onNotificationObserverError?: (
    diagnostic: RpcNotificationObserverDiagnostic,
  ) => void | Promise<void>
}

function objectParams<T>(value: unknown, method: string): T {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${method} params must be an object`)
  }
  return value as T
}

function materializeComposition(input: SerializedCompositionDefinition) {
  return createCompositionDefinition({
    id: input.id,
    revision: input.revision,
    loaderPath: input.loaderPath,
    patches: input.patches,
  })
}

export function serveOmpRuntime(
  reader: Readable,
  writer: Writable,
  onSessionDisposed?: () => void,
  options: OmpRuntimeChildOptions = {},
): OmpRuntimeChild {
  const peer = new FramedJsonRpcPeer(reader, writer, options.onNotificationObserverError === undefined
    ? {}
    : { onNotificationObserverError: options.onNotificationObserverError })
  let runtime: CompositionRuntime | undefined
  let session: CompositionSession | undefined
  let host: OmpRuntimeHost | undefined
  let disposing: Promise<void> | undefined

  const binding = {
    attach(next: OmpRuntimeHost) {
      if (host !== undefined) throw new Error('OMP runtime host is already attached')
      host = next
    },
    detach(current: OmpRuntimeHost) {
      if (host === current) host = undefined
    },
    notify(notification: RuntimeNotification) {
      peer.notify(notification.method, notification.params)
    },
  }

  peer.expose('session.activate', async (value) => {
    if (runtime !== undefined || session !== undefined) throw new Error('runtime session is already activated')
    const request = objectParams<SessionActivateParams>(value, 'session.activate')
    if (request.protocolVersion !== OMP_RPC_PROTOCOL_VERSION) {
      throw new TypeError(`unsupported OMP RPC protocol version ${String(request.protocolVersion)}`)
    }
    const params = defineSerializedOmpActivation(request)
    const composition = materializeComposition(params.composition)
    const notifyRuntimeChanged = (event: { compositionRevision: string; diagnostics: unknown }) => {
      const activeHost = host
      if (activeHost === undefined) return
      binding.notify({
        method: 'runtime.changed',
        params: {
          runtimeRevision: event.compositionRevision,
          diagnostics: event.diagnostics,
          tools: activeHost.listTools(),
        },
      })
    }
    runtime = createCompositionRuntime(params.watch === false
      ? { watch: false, onReload: notifyRuntimeChanged, onReloadFailure: notifyRuntimeChanged }
      : {
          watch: { base: dirname(composition.loaderPath), root: ['.'] },
          onReload: notifyRuntimeChanged,
          onReloadFailure: notifyRuntimeChanged,
        })
    try {
      const activated = await runtime.activate({
        composition,
        sessionId: params.sessionId,
        ...(params.workspaceRoot === undefined ? {} : { workspaceRoot: params.workspaceRoot }),
        runtimePlugins: { 'omp-host': createOmpRuntimeHostPlugin(binding, params.actorId) },
        runtimePluginIsolation: {
          'omp-host': ['doppelgangerActor', 'doppelgangerContext', 'doppelgangerTools', 'doppelgangerLifecycle'],
        },
      })
      session = activated
      const activeHost = host
      if (activeHost === undefined) {
        throw new Error(`runtime activated without the OMP host bridge: ${JSON.stringify(activated.diagnostics())}`)
      }
      const diagnostics = activated.diagnostics()
      return {
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        diagnostics,
        runtimeRevision: diagnostics.compositionRevision,
        tools: activeHost.listTools(),
      }
    } catch (cause) {
      await runtime.dispose()
      runtime = undefined
      session = undefined
      host = undefined
      throw cause
    }
  })

  peer.expose('context.resolve', async (value) => {
    const params = objectParams<ContextResolveParams>(value, 'context.resolve')
    if (host === undefined) throw new Error('runtime session is not active')
    return host.resolveContext(params.input, params.turnId, params.tokenBudget)
  })
  peer.expose('tools.list', () => {
    if (host === undefined) throw new Error('runtime session is not active')
    return host.listTools()
  })
  peer.expose('tools.invoke', async (value) => {
    const params = objectParams<ToolsInvokeParams>(value, 'tools.invoke')
    if (host === undefined) throw new Error('runtime session is not active')
    return host.invokeTool(params.name, params.input)
  })
  peer.expose('event.publish', async (value) => {
    if (host === undefined) throw new Error('runtime session is not active')
    await host.publishEvent(objectParams<OmpLifecycleEvent>(value, 'event.publish'))
    return null
  })

  const dispose = async () => {
    if (disposing !== undefined) return disposing
    disposing = (async () => {
      const activeSession = session
      session = undefined
      if (activeSession !== undefined) await activeSession.dispose()
      const activeRuntime = runtime
      runtime = undefined
      if (activeRuntime !== undefined) await activeRuntime.dispose()
      host = undefined
    })()
    return disposing
  }
  peer.expose('session.dispose', async () => {
    await dispose()
    if (onSessionDisposed !== undefined) setImmediate(onSessionDisposed)
    return null
  })
  reader.once('end', () => { void dispose() })

  return Object.freeze({ dispose })
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const child = serveOmpRuntime(process.stdin, process.stdout, () => process.exit(), {
    onNotificationObserverError: diagnostic => {
      process.stderr.write(`[rpc notification observer] ${diagnostic.method}: ${diagnostic.message}\n`)
    },
  })
  const shutdown = () => { void child.dispose().finally(() => process.exit()) }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
