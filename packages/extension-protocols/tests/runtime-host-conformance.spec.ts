import { Context } from '@deepseek-ai/cordis'
import {
  ContextProtocol,
  ToolRegistry,
  createActorIdentityPlugin,
  createRuntimeHostPlugin,
  type RuntimeHostBinding,
  type RuntimeHostBridge,
} from '../src/index.ts'
import {
  FULL_CONFORMANCE_CAPABILITIES,
  runtimeHostConformance,
  type RuntimeHostConformanceFactory,
} from './support/runtime-host-conformance.ts'

const directFactory: RuntimeHostConformanceFactory = {
  async create(options = {}) {
    const root = new Context()
    const ctx = [
      'doppelgangerRuntimeSession',
      'doppelgangerHostCapabilities',
      'doppelgangerContext',
      'doppelgangerTools',
      'doppelgangerActor',
    ].reduce((current, service) => current.isolate(service), root)
    await ctx.plugin({
      name: 'conformance-runtime-session',
      apply(pluginContext) {
        pluginContext.provide('doppelgangerRuntimeSession', Object.freeze({
          sessionId: options.sessionId ?? crypto.randomUUID(),
          runtimePresetId: 'direct-conformance',
        }))
      },
    })
    if (options.context !== false) await ctx.plugin(ContextProtocol)
    if (options.tools !== false) await ctx.plugin(ToolRegistry)
    if (options.actor === 'unbound') await ctx.plugin(createActorIdentityPlugin())
    else if (typeof options.actor === 'object') await ctx.plugin(createActorIdentityPlugin(options.actor.actorId))

    let bridge: RuntimeHostBridge | undefined
    const catalogChanges: string[] = []
    const binding: RuntimeHostBinding = {
      attach(candidate) {
        if (bridge !== undefined) throw new Error('Runtime Host is already attached')
        bridge = candidate
      },
      detach(candidate) {
        if (bridge === candidate) bridge = undefined
      },
      toolCatalogChanged(revision) {
        catalogChanges.push(revision)
      },
    }
    try {
      await ctx.plugin(createRuntimeHostPlugin(
        binding,
        options.capabilities ?? FULL_CONFORMANCE_CAPABILITIES,
      ))
    } catch (cause) {
      await root.fiber.dispose()
      throw cause
    }
    if (bridge === undefined) throw new Error('direct conformance bridge did not attach')
    const attached = bridge
    return {
      bridge: attached,
      actorIdentity: ctx.get('doppelgangerActor', false),
      catalogChanges,
      registerSet(ownerId, definitions) {
        const registry = ctx.get('doppelgangerTools', false) as ToolRegistry | undefined
        if (registry === undefined) throw new Error('tools protocol is absent')
        return registry.registerSet(ownerId, definitions)
      },
      async dispose() {
        await root.fiber.dispose()
      },
    }
  },
}

runtimeHostConformance('direct in-process', directFactory)
