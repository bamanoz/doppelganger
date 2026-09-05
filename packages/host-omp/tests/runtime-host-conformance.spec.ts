import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import {
  createActorIdentityPlugin,
  createRuntimeHostPlugin,
  defineRuntimeHostCapabilities,
  type ActorIdentity,
  type RuntimeHostBridge,
  type RuntimeHostBinding,
  type ToolRegistry,
} from '@doppelganger/doppelganger-protocols'
import {
  runtimeHostConformance,
  type RuntimeHostConformanceFactory,
} from '@doppelganger/doppelganger-protocols/test-support/runtime-host-conformance'
import {
  createCompositionDefinition,
  createCompositionRuntime,
} from '@doppelganger/doppelganger-composition-runtime'
import { OMP_RUNTIME_HOST_CAPABILITIES } from '../src/contracts.ts'

const ompFactory: RuntimeHostConformanceFactory = {
  async create(options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-conformance-'))
    const loaderPath = join(root, 'runtime.cordis.yml')
    const entries = [
      ...(options.context === false
        ? []
        : [
            '- id: conformance-context',
            '  name: "@doppelganger/doppelganger-protocols/context"',
            '  isolate:',
            '    doppelgangerContext: session',
          ]),
      ...(options.tools === false
        ? []
        : [
            '- id: conformance-tools',
            '  name: "@doppelganger/doppelganger-protocols/tools"',
            '  isolate:',
            '    doppelgangerTools: session',
          ]),
    ]
    await mkdir(root, { recursive: true })
    await writeFile(loaderPath, entries.length === 0 ? '[]\n' : `${entries.join('\n')}\n`)

    let bridge: RuntimeHostBridge | undefined
    let registry: ToolRegistry | undefined
    let actorIdentity: ActorIdentity | undefined
    const catalogChanges: string[] = []
    const binding: RuntimeHostBinding = {
      attach(candidate) {
        if (bridge !== undefined) throw new Error('OMP conformance bridge is already attached')
        bridge = candidate
      },
      detach(candidate) {
        if (bridge === candidate) bridge = undefined
      },
      toolCatalogChanged(revision) {
        catalogChanges.push(revision)
      },
    }
    const controlServices = [
      ...(options.tools === false ? [] : ['doppelgangerTools']),
      ...(options.actor === undefined || options.actor === 'absent' ? [] : ['doppelgangerActor']),
    ]
    const control: Plugin = {
      name: 'omp-runtime-host-conformance-control',
      inject: controlServices,
      apply(ctx) {
        registry = ctx.get('doppelgangerTools', false) as ToolRegistry | undefined
        actorIdentity = ctx.get('doppelgangerActor', false) as ActorIdentity | undefined
      },
    }
    const capabilities = defineRuntimeHostCapabilities(options.capabilities ?? OMP_RUNTIME_HOST_CAPABILITIES)
    const runtime = createCompositionRuntime({ watch: false })
    const actor = options.actor === 'unbound'
      ? createActorIdentityPlugin()
      : typeof options.actor === 'object'
        ? createActorIdentityPlugin(options.actor.actorId)
        : undefined
    try {
      const session = await runtime.activate({
        composition: createCompositionDefinition({
          id: 'omp-runtime-host-conformance',
          revision: 'conformance-one',
          loaderPath,
        }),
        sessionId: options.sessionId ?? crypto.randomUUID(),
        workspaceRoot: root,
        runtimePlugins: {
          ...(actor === undefined ? {} : { actor }),
          'runtime-host': createRuntimeHostPlugin(binding, capabilities),
          'conformance-control': control,
        },
        runtimePluginIsolation: {
          ...(actor === undefined ? {} : { actor: ['doppelgangerActor'] }),
          'runtime-host': [
            'doppelgangerRuntimeSession',
            'doppelgangerContext',
            'doppelgangerHostCapabilities',
            'doppelgangerLifecycle',
            'doppelgangerTools',
          ],
          'conformance-control': controlServices,
        },
      })
      if (bridge === undefined) throw new Error('OMP conformance bridge did not attach')
      const attached = bridge
      return {
        bridge: attached,
        actorIdentity,
        catalogChanges,
        registerSet(ownerId, definitions) {
          if (registry === undefined) throw new Error('OMP conformance tools protocol is absent')
          return registry.registerSet(ownerId, definitions)
        },
        async dispose() {
          await session.dispose()
          await runtime.dispose()
          await rm(root, { recursive: true, force: true })
        },
      }
    } catch (cause) {
      await runtime.dispose().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
      throw cause
    }
  },
}

runtimeHostConformance('OMP adapter', ompFactory)
