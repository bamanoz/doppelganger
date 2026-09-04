import { dirname, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CanonicalCompositionDefinition,
  type CompositionRuntime,
  type CompositionSession,
} from '@doppelganger/doppelganger-composition-runtime'
import {
  createActorIdentityPlugin,
  createRuntimeHostPlugin,
  type LifecycleEvent,
  type RuntimeHostBridge,
} from '@doppelganger/doppelganger-protocols'
import {
  OMP_RPC_PROTOCOL_VERSION,
  defineHostContextRequest,
  defineSessionActivateParams,
  defineToolCancellationRequest,
  defineToolInvocationRequest,
} from './contracts.ts'
import {
  createOmpHostEventPlugin,
  defineOmpTodoReminderEvent,
  type OmpHostEventSink,
} from './omp-host-events.ts'
import { FramedJsonRpcPeer, type RpcNotificationObserverDiagnostic } from './protocol.ts'

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

function materializeComposition(input: CanonicalCompositionDefinition) {
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
  let bridge: RuntimeHostBridge | undefined
  let ompHostEvents: OmpHostEventSink | undefined
  let disposing: Promise<void> | undefined

  const binding = {
    attach(next: RuntimeHostBridge) {
      if (bridge !== undefined) throw new Error('Runtime Host bridge is already attached')
      bridge = next
    },
    detach(current: RuntimeHostBridge) {
      if (bridge === current) bridge = undefined
    },
    toolCatalogChanged(revision: string) {
      peer.notify('toolCatalog.changed', { revision })
    },
  }
  const ompHostEventBinding = {
    attach(next: OmpHostEventSink) {
      if (ompHostEvents !== undefined) throw new Error('OMP host event provider is already attached')
      ompHostEvents = next
    },
    detach(current: OmpHostEventSink) {
      if (ompHostEvents === current) ompHostEvents = undefined
    },
  }

  peer.expose('session.activate', async (value) => {
    if (runtime !== undefined || session !== undefined) throw new Error('runtime session is already activated')
    const params = defineSessionActivateParams(value)
    const composition = materializeComposition(params.composition)
    runtime = createCompositionRuntime(params.watch === false
      ? { watch: false }
      : { watch: { base: dirname(composition.loaderPath), root: ['.'] } })
    try {
      const activated = await runtime.activate({
        composition,
        sessionId: params.sessionId,
        ...(params.workspaceRoot === undefined ? {} : { workspaceRoot: params.workspaceRoot }),
        runtimePlugins: {
          actor: createActorIdentityPlugin(params.actorId),
          'omp-host-events': createOmpHostEventPlugin(ompHostEventBinding),
          'runtime-host': createRuntimeHostPlugin(binding, params.capabilities),
        },
        runtimePluginIsolation: {
          actor: ['doppelgangerActor'],
          'omp-host-events': ['doppelgangerRuntimeSession'],
          'runtime-host': [
            'doppelgangerRuntimeSession',
            'doppelgangerContext',
            'doppelgangerHostCapabilities',
            'doppelgangerLifecycle',
            'doppelgangerTools',
          ],
        },
      })
      session = activated
      const activeBridge = bridge
      if (activeBridge === undefined) {
        throw new Error(`runtime activated without the shared Runtime Host bridge: ${JSON.stringify(activated.diagnostics())}`)
      }
      const diagnostics = activated.diagnostics()
      return {
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        capabilities: activeBridge.capabilities,
        diagnostics,
        runtimeRevision: diagnostics.compositionRevision,
        catalog: activeBridge.snapshotTools(),
      }
    } catch (cause) {
      await runtime.dispose()
      runtime = undefined
      session = undefined
      bridge = undefined
      ompHostEvents = undefined
      throw cause
    }
  })

  peer.expose('runtime.diagnostics', () => {
    if (session === undefined) throw new Error('runtime session is not active')
    const diagnostics = session.diagnostics()
    return { runtimeRevision: diagnostics.compositionRevision, diagnostics }
  })
  peer.expose('context.resolve', (value) => {
    if (bridge === undefined) throw new Error('runtime session is not active')
    return bridge.resolveContext(defineHostContextRequest(value))
  })
  peer.expose('tools.snapshot', () => {
    if (bridge === undefined) throw new Error('runtime session is not active')
    return bridge.snapshotTools()
  })
  peer.expose('tools.invoke', (value) => {
    if (bridge === undefined) throw new Error('runtime session is not active')
    return bridge.invokeTool(defineToolInvocationRequest(value))
  })
  peer.expose('tools.cancel', (value) => {
    if (bridge === undefined) throw new Error('runtime session is not active')
    return bridge.cancelTool(defineToolCancellationRequest(value))
  })
  peer.expose('event.publish', async (value) => {
    if (bridge === undefined) throw new Error('runtime session is not active')
    await bridge.publishLifecycle(objectParams<LifecycleEvent>(value, 'event.publish'))
    return null
  })
  peer.expose('omp.todo-reminder', async (value) => {
    if (ompHostEvents === undefined) throw new Error('OMP host event provider is not active')
    await ompHostEvents.publishTodoReminder(defineOmpTodoReminderEvent(value))
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
      bridge = undefined
      ompHostEvents = undefined
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
