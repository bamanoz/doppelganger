import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, registerNativePlugin, type NativeHarness } from './support.ts'

const harnesses: NativeHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

describe('OpenClaw public native lifecycle', () => {
  it('registers finite hooks, declared names, synchronous factory and cleanup', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    expect([...harness.plugin.hooks.keys()].sort()).toEqual([
      'before_model_resolve',
      'before_prompt_build',
      'before_reset',
      'before_tool_call',
      'session_end',
    ])
    expect(harness.plugin.toolNames).toEqual(harness.prepared.tools.map(tool => tool.nativeName))
    const factoryResult = harness.plugin.toolFactory?.(harness.context())
    expect(factoryResult).not.toBeInstanceOf(Promise)
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.cleanup).toBeTypeOf('function')
  })

  it('awaits embedded warmup before synchronous tool construction', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    expect(harness.tools()).toHaveLength(harness.prepared.tools.length)
  })

  it('keeps tools unavailable when warmup is skipped', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.diagnostics.join('\n')).toContain('OPENCLAW_TOOLS_UNAVAILABLE')
  })

  it('retires a binding through reset and session-end hooks', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const reset = harness.plugin.hooks.get('before_reset')!
    await reset({}, { sessionKey: 'route-one' })
    expect(harness.tools()).toEqual([])
    await harness.warm(harness.context({ sessionId: 'session-two', runId: 'run-two' }))
    const end = harness.plugin.hooks.get('session_end')!
    await end({}, { sessionKey: 'route-one' })
    expect(harness.tools(harness.context({ sessionId: 'session-two', runId: 'run-two' }))).toEqual([])
  })

  it('shares discovery bindings with full lifecycle leases without late recreation', async () => {
    const discovery = await createNativeHarness({ registrationMode: 'discovery' })
    harnesses.push(discovery)
    const firstFull = registerNativePlugin(discovery.prepared, { ...discovery.pluginConfig })
    const toolDiscovery = registerNativePlugin(discovery.prepared, { ...discovery.pluginConfig }, 'tool-discovery')
    const secondFull = registerNativePlugin(discovery.prepared, { ...discovery.pluginConfig })

    await discovery.warm()
    expect(discovery.tools()).toHaveLength(discovery.prepared.tools.length)
    expect(toolDiscovery.toolFactory?.(discovery.context())).toHaveLength(discovery.prepared.tools.length)

    await firstFull.cleanup?.({ reason: 'reset', sessionKey: 'route-one' })
    expect(discovery.tools()).toEqual([])

    await discovery.warm()
    expect(discovery.tools()).toHaveLength(discovery.prepared.tools.length)
    await firstFull.service?.stop?.()
    expect(discovery.tools()).toHaveLength(discovery.prepared.tools.length)

    await secondFull.service?.stop?.()
    expect(discovery.tools()).toEqual([])
    expect(toolDiscovery.toolFactory?.(discovery.context())).toBeNull()
    await discovery.warm()
    expect(discovery.tools()).toEqual([])
    expect(discovery.state.activations).toBe(2)
  })
})
