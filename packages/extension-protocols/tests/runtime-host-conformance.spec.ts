import { Context } from '@deepseek-ai/cordis'
import {
  ContextProtocol,
  ToolRegistry,
  createActorIdentityPlugin,
  createRuntimeHostPlugin,
  type RuntimeHostBinding,
  type RuntimeHostBridge,
  type ToolDefinition,
} from '../src/index.ts'
import {
  FULL_CONFORMANCE_CAPABILITIES,
  runtimeHostConformance,
  type RuntimeHostConformanceFactory,
  type RuntimeHostConformanceTool,
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
    const started = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
    const releases = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
    const signal = (map: typeof started, callId: string) => {
      let gate = map.get(callId)
      if (gate === undefined) { gate = Promise.withResolvers<void>(); map.set(callId, gate) }
      return gate
    }
    const definitionsFor = (definitions: readonly RuntimeHostConformanceTool[]): ToolDefinition[] => definitions.map(({ fixtureResult, fixtureBehavior, ...definition }) => ({
      ...definition,
      async invoke(_input, context) {
        signal(started, context.callId).resolve()
        if (fixtureBehavior === 'hold') {
          const release = signal(releases, context.callId)
          const abort = () => release.resolve()
          context.signal.addEventListener('abort', abort, { once: true })
          try { await release.promise } finally { context.signal.removeEventListener('abort', abort) }
          if (context.signal.aborted) throw context.signal.reason
        }
        return fixtureResult
      },
    }))
    return {
      bridge: attached,
      actorIdentity: ctx.get('doppelgangerActor', false),
      catalogChanges,
      async registerSet(ownerId, definitions) {
        const registry = ctx.get('doppelgangerTools', false) as ToolRegistry | undefined
        if (registry === undefined) throw new Error('tools protocol is absent')
        const registration = registry.registerSet(ownerId, definitionsFor(definitions))
        return {
          async replace(next) { registration.replace(definitionsFor(next)) },
          async dispose() { await registration.dispose() },
        }
      },
      async waitForCall(callId) { await signal(started, callId).promise },
      async releaseCall(callId) { signal(releases, callId).resolve() },
      async dispose() {
        await root.fiber.dispose()
        for (const gate of releases.values()) gate.resolve()
      },
    }
  },
}

runtimeHostConformance('direct in-process', directFactory)
