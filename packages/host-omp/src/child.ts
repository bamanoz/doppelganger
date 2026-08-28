import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { Plugin } from '@deepseek-ai/cordis'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionRuntime,
  type CompositionSession,
} from '@doppelganger/composition-runtime'
import type {
  ContextResolveParams,
  SerializedCompositionDefinition,
  SerializedPluginReference,
  SessionActivateParams,
  ToolsInvokeParams,
} from './contracts.ts'
import { OMP_RPC_PROTOCOL_VERSION } from './contracts.ts'
import { FramedJsonRpcPeer } from './protocol.ts'
import {
  createOmpRuntimeHostPlugin,
  type OmpLifecycleEvent,
  type OmpRuntimeHost,
  type RuntimeNotification,
} from './runtime-host.ts'

export interface OmpRuntimeChild {
  dispose(): Promise<void>
}

function objectParams<T>(value: unknown, method: string): T {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${method} params must be an object`)
  }
  return value as T
}

async function loadPlugin(reference: SerializedPluginReference, label: string): Promise<Plugin> {
  if (reference.module.trim().length === 0 || reference.exportName.trim().length === 0) {
    throw new TypeError(`${label} needs non-empty module and exportName`)
  }
  // Plugin modules are selected by the serialized composition, so static imports cannot represent this boundary.
  const loaded = await import(reference.module) as Record<string, unknown>
  const exported = loaded[reference.exportName]
  if (reference.mode === 'factory') {
    if (typeof exported !== 'function') throw new TypeError(`${label} factory export is not a function`)
    const plugin = (exported as (config?: unknown) => unknown)(reference.config)
    if (plugin === null || (typeof plugin !== 'object' && typeof plugin !== 'function')) {
      throw new TypeError(`${label} factory did not return a Cordis plugin`)
    }
    return plugin as Plugin
  }
  if (exported === null || (typeof exported !== 'object' && typeof exported !== 'function')) {
    throw new TypeError(`${label} export is not a Cordis plugin`)
  }
  return exported as Plugin
}

async function loadPlugins(
  references: Readonly<Record<string, SerializedPluginReference>>,
  label: string,
): Promise<Readonly<Record<string, Plugin>>> {
  const entries = await Promise.all(Object.entries(references).map(async ([name, reference]) => (
    [name, await loadPlugin(reference, `${label}.${name}`)] as const
  )))
  return Object.freeze(Object.fromEntries(entries))
}

async function materializeComposition(input: SerializedCompositionDefinition) {
  return createCompositionDefinition({
    id: input.id,
    revision: input.revision,
    loaderPath: input.loaderPath,
    imports: await loadPlugins(input.imports, 'composition.imports'),
    mounts: input.mounts,
  })
}

export function serveOmpRuntime(
  reader: Readable,
  writer: Writable,
  onSessionDisposed?: () => void,
): OmpRuntimeChild {
  const peer = new FramedJsonRpcPeer(reader, writer)
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
    const params = objectParams<SessionActivateParams>(value, 'session.activate')
    if (params.protocolVersion !== OMP_RPC_PROTOCOL_VERSION) {
      throw new TypeError(`unsupported OMP RPC protocol version ${String(params.protocolVersion)}`)
    }
    const composition = await materializeComposition(params.composition)
    if (params.hostMount.trim().length === 0) throw new TypeError('session.activate hostMount must be non-empty')
    if (params.mounts[params.hostMount] !== undefined) {
      throw new TypeError(`session.activate mounts already supplies host mount "${params.hostMount}"`)
    }
    const mounts = {
      ...await loadPlugins(params.mounts, 'activation.mounts'),
      [params.hostMount]: createOmpRuntimeHostPlugin(binding),
    }
    runtime = createCompositionRuntime(params.watch === false
      ? {
          watch: false,
          onReload: event => binding.notify({
            method: 'profile.changed',
            params: { revision: event.compositionRevision },
          }),
        }
      : {
          watch: { base: composition.root, root: ['.'] },
          onReload: event => binding.notify({
            method: 'profile.changed',
            params: { revision: event.compositionRevision },
          }),
        })
    try {
      const activated = await runtime.activate({
        composition,
        sessionId: params.sessionId,
        mounts,
      })
      session = activated
      if (host === undefined) {
        throw new Error(`runtime activated without the OMP host services: ${JSON.stringify(activated.diagnostics())}`)
      }
      binding.notify({ method: 'tools.changed', params: host.listTools() })
      return {
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        diagnostics: activated.diagnostics(),
        tools: host.listTools(),
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
  const child = serveOmpRuntime(process.stdin, process.stdout, () => process.exit())
  const shutdown = () => { void child.dispose().finally(() => process.exit()) }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
