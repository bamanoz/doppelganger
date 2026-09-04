import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextProtocol,
  LIFECYCLE_PROTOCOL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
  ToolRegistry,
  createActorIdentityPlugin,
  createRuntimeHostPlugin,
  type RuntimeHostBinding,
  type RuntimeHostBridge,
} from '../src/index.ts'

const capabilities = () => ({
  protocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
  context: { delivery: 'per-request' as const },
  tools: { delivery: 'dynamic' as const, requiredApproval: true, cancellation: true },
  lifecycle: { events: ['session-started', 'turn-committed'] as const },
})

function binding() {
  let active: RuntimeHostBridge | undefined
  const changed: string[] = []
  const value: RuntimeHostBinding = {
    attach(bridge) {
      if (active !== undefined) throw new Error('Runtime Host is already attached')
      active = bridge
    },
    detach(bridge) {
      if (active === bridge) active = undefined
    },
    toolCatalogChanged(revision) {
      changed.push(revision)
    },
  }
  return { value, changed, bridge: () => active }
}

async function session() {
  const root = new Context()
  const ctx = [
    'doppelgangerRuntimeSession',
    'doppelgangerHostCapabilities',
    'doppelgangerContext',
    'doppelgangerTools',
    'doppelgangerActor',
  ].reduce((current, service) => current.isolate(service), root)
  await ctx.plugin({
    name: 'test-runtime-session',
    apply(pluginContext) {
      pluginContext.provide('doppelgangerRuntimeSession', Object.freeze({
        sessionId: 'session-one',
        runtimePresetId: 'test',
      }))
    },
  })
  return { root, ctx }
}

describe('shared Runtime Host bridge', () => {
  it('attaches without actor identity and preserves canonical empty optional protocols', async () => {
    const { root, ctx } = await session()
    const hostBinding = binding()
    const owner = await ctx.plugin(createRuntimeHostPlugin(hostBinding.value, capabilities()))
    const bridge = hostBinding.bridge()
    expect(bridge).toBeDefined()
    expect(bridge?.capabilities).toEqual(capabilities())
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(ctx.get('doppelgangerActor', false)).toBeUndefined()
    expect(root.get('doppelgangerHostCapabilities')).toBeUndefined()

    await expect(bridge?.resolveContext({
      requestId: 'request-one',
      turn: { input: 'hello' },
      tokenBudget: 100,
    })).resolves.toEqual({ content: '', contributions: [], omittedSources: [], tokenCount: 0 })
    expect(bridge?.snapshotTools()).toEqual({ revision: 'catalog:0', tools: [] })
    const unavailable = await bridge?.invokeTool({
      callId: 'call-one',
      name: 'memory.search',
      toolRevision: 'tool:1',
      input: {},
    })
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'TOOL_PROTOCOL_UNAVAILABLE' } })

    await owner.dispose()
    expect(hostBinding.bridge()).toBeUndefined()
    await expect(bridge?.resolveContext({
      requestId: 'late-request',
      turn: { input: 'late' },
      tokenBudget: 1,
    })).rejects.toThrow('detached')
    await root.fiber.dispose()
  })

  it('resolves installed context, snapshots tools, and emits one revision callback per commit', async () => {
    const { root, ctx } = await session()
    await ctx.plugin(ContextProtocol)
    await ctx.plugin(ToolRegistry)
    ctx.doppelgangerContext.register({
      id: 'identity',
      resolve: request => [{
        source: 'identity',
        content: `Current input: ${request.turn.input}`,
        priority: 10,
        authority: 'instruction',
      }],
    })
    const hostBinding = binding()
    await ctx.plugin(createRuntimeHostPlugin(hostBinding.value, capabilities()))
    const bridge = hostBinding.bridge()!

    await expect(bridge.resolveContext({
      requestId: 'request-one',
      turn: { input: 'hello', turnId: 'turn-one' },
      tokenBudget: 100,
    })).resolves.toMatchObject({ content: 'Current input: hello' })
    const set = ctx.doppelgangerTools.registerSet('memory', [{
      name: 'memory.search',
      description: 'Search memory',
      inputSchema: { type: 'object' },
      invoke: (_input, invocation) => ({ callId: invocation.callId }),
    }])
    const snapshot = bridge.snapshotTools()
    expect(snapshot.tools).toHaveLength(1)
    expect(hostBinding.changed).toEqual([snapshot.revision])

    set.replace([{
      name: 'memory.search',
      description: 'Search current memory',
      inputSchema: { type: 'object' },
      invoke: (_input, invocation) => ({ callId: invocation.callId }),
    }])
    expect(hostBinding.changed).toHaveLength(2)
    await root.fiber.dispose()
  })

  it('rejects a second attachment and keeps actor absence, unbound, and bound states independent', async () => {
    const { root, ctx } = await session()
    const hostBinding = binding()
    const first = await ctx.plugin(createRuntimeHostPlugin(hostBinding.value, capabilities()))
    const competing = await session()
    await expect(competing.ctx.plugin(createRuntimeHostPlugin(hostBinding.value, capabilities())).await())
      .rejects.toThrow('already attached')
    expect(ctx.get('doppelgangerActor', false)).toBeUndefined()

    await ctx.plugin(createActorIdentityPlugin())
    expect(ctx.doppelgangerActor).toEqual({ state: 'unbound' })
    await first.dispose()
    await root.fiber.dispose()
    await competing.root.fiber.dispose()

    const boundSession = await session()
    await boundSession.ctx.plugin(createActorIdentityPlugin('actor-one'))
    const separateBinding = binding()
    await boundSession.ctx.plugin(createRuntimeHostPlugin(separateBinding.value, capabilities()))
    expect(boundSession.ctx.doppelgangerActor).toEqual({ state: 'bound', actorId: 'actor-one' })
    expect(separateBinding.bridge()?.capabilities).toEqual(capabilities())
    await boundSession.root.fiber.dispose()
  })

  it('publishes only declared lifecycle events', async () => {
    const { root, ctx } = await session()
    const observed = vi.fn()
    ctx.on('doppelganger/session-started', observed)
    const hostBinding = binding()
    await ctx.plugin(createRuntimeHostPlugin(hostBinding.value, capabilities()))
    const bridge = hostBinding.bridge()!
    await bridge.publishLifecycle({
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'session-started',
      deliveryId: 'delivery-one',
      sessionId: 'session-one',
      timestamp: 1,
    })
    expect(observed).toHaveBeenCalledOnce()
    await expect(bridge.publishLifecycle({
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'tool-started',
      deliveryId: 'delivery-two',
      sessionId: 'session-one',
      turnId: 'turn-one',
      callId: 'call-one',
      name: 'memory.search',
      timestamp: 2,
      input: { value: {} },
    })).rejects.toThrow('not declared')
    await root.fiber.dispose()
  })
})
