import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { defineAssembledContext, type ActorIdentity, type RuntimeHostBridge } from '@doppelganger/doppelganger-protocols'
import {
  conformanceApproval, conformanceCallLifecycle, conformanceCatalog, runtimeHostConformance,
  type RuntimeHostConformanceFactory,
} from '@doppelganger/doppelganger-protocols/test-support/runtime-host-conformance'
import { OmpAdapterSession, type OmpChildConnection } from '../src/adapter.ts'
import { NodeOmpChildFactory } from '../src/process.ts'
import { defineToolCancellationResult, defineToolInvocationResult } from '../src/contracts.ts'

const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
const controlPath = fileURLToPath(new URL('./fixtures/conformance-control.mjs', import.meta.url))

const ompFactory: RuntimeHostConformanceFactory = {
  actorStates: ['unbound', 'bound'],
  fixedCapabilities: true,
  async create(options = {}) {
    if (options.actor === 'absent') throw new Error('OMP always mounts an Actor Identity provider')
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-conformance-'))
    const loaderPath = join(root, 'runtime.cordis.yml')
    const endpointPath = join(root, 'control.endpoint')
    const entries = [
      ...(options.context === false ? [] : [{ id: 'context', name: '@doppelganger/doppelganger-protocols/context', isolate: { doppelgangerContext: 'session' } }]),
      ...(options.tools === false ? [] : [{ id: 'tools', name: '@doppelganger/doppelganger-protocols/tools', isolate: { doppelgangerTools: 'session' } }]),
      { id: 'control', name: controlPath, config: { endpointPath }, isolate: { doppelgangerActor: 'session', doppelgangerTools: 'session' } },
    ]
    await writeFile(loaderPath, JSON.stringify(entries))
    const catalogChanges: string[] = []
    const catalogWaiters = new Set<() => void>()
    const realFactory = new NodeOmpChildFactory({ childPath, shutdownTimeoutMs: 2000 })
    let disposed = false
    const adapter = new OmpAdapterSession({
      activation: {
        composition: { id: 'omp-conformance', revision: 'one', loaderPath, patches: [] },
        hostKind: 'omp', sessionId: options.sessionId ?? crypto.randomUUID(), workspaceRoot: root, watch: false,
        ...(typeof options.actor === 'object' ? { actorId: options.actor.actorId } : {}),
      },
      childFactory: {
        async start() {
          const child = await realFactory.start()
          // Malformed capability injection exercises the actual child handshake decoder.
          if (options.capabilities === undefined) return child
          return {
            request(method, params) {
              return child.request(method, method === 'session.activate' ? { ...(params as Record<string, unknown>), capabilities: options.capabilities } : params)
            },
            onNotification: (method, callback) => child.onNotification(method, callback),
            dispose: () => child.dispose(),
          } satisfies OmpChildConnection
        },
      },
      onCatalogChanged(catalog) {
        if (disposed) return
        catalogChanges.push(catalog.revision)
        for (const wake of catalogWaiters) wake()
      },
    })
    const dispose = async () => {
      if (disposed) return
      disposed = true
      try { await adapter.dispose() } finally { await rm(root, { recursive: true, force: true }) }
    }
    try {
      const started = await adapter.start()
      if (started.state !== 'active' || started.capabilities === undefined) throw new Error(started.diagnostic?.message ?? 'OMP did not activate')
      const connection = adapter.connection()!
      if (connection.processId === undefined) throw new Error('conformance must own an actual child process')
      const endpoint = await readFile(endpointPath, 'utf8')
      async function control(command: Record<string, unknown>): Promise<{ revision: string; actor: ActorIdentity }> {
        if (disposed) throw new Error('conformance session is disposed')
        const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(command), signal: AbortSignal.timeout(5000) })
        const result = await response.json() as { revision: string; actor: ActorIdentity; error?: string }
        if (!response.ok) throw new Error(result.error)
        return result
      }
      async function waitCatalog(revision: string): Promise<void> {
        if (adapter.snapshot().catalog.revision === revision) return
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { catalogWaiters.delete(wake); reject(new Error(`catalog ${revision} did not arrive`)) }, 5000)
          const wake = () => {
            if (adapter.snapshot().catalog.revision !== revision) return
            clearTimeout(timer)
            catalogWaiters.delete(wake)
            resolve()
          }
          catalogWaiters.add(wake)
          wake()
        })
      }
      const observed = await control({ op: 'snapshot' })
      catalogChanges.length = 0
      const bridge: RuntimeHostBridge = {
        capabilities: started.capabilities,
        snapshotTools: () => adapter.snapshot().catalog,
        resolveContext: async request => defineAssembledContext(await connection.request('context.resolve', request)),
        invokeTool: async request => defineToolInvocationResult(await connection.request('tools.invoke', request)),
        cancelTool: async request => defineToolCancellationResult(await connection.request('tools.cancel', request)),
        publishLifecycle: async event => { await connection.request('event.publish', event) },
      }
      return {
        bridge, actorIdentity: observed.actor, catalogChanges,
        async registerSet(ownerId, definitions) {
          const result = await control({ op: 'register', owner: ownerId, definitions })
          await waitCatalog(result.revision)
          return {
            async replace(next) { const result = await control({ op: 'replace', owner: ownerId, definitions: next }); await waitCatalog(result.revision) },
            async dispose() { const result = await control({ op: 'dispose-owner', owner: ownerId }); await waitCatalog(result.revision) },
          }
        },
        async waitForCall(callId) { await control({ op: 'started', callId }) },
        async releaseCall(callId) { await control({ op: 'release', callId }) },
        dispose,
      }
    } catch (error) { await dispose(); throw error }
  },
}

runtimeHostConformance('OMP adapter', ompFactory)

it('preserves catalog and stale-revision semantics through the real OMP adapter', async () => { await conformanceCatalog(ompFactory) })
it('enforces one-shot approval through the real OMP adapter', async () => { await conformanceApproval(ompFactory) })
it('settles cancellation and disposal through the real OMP adapter', async () => { await conformanceCallLifecycle(ompFactory) })
