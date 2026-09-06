import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, type NativeHarness } from './support.ts'

const harnesses: NativeHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

describe('OpenClaw native activation', () => {
  it('activates an empty preset through the native plugin', async () => {
    const harness = await createNativeHarness({ empty: true })
    harnesses.push(harness)
    await harness.warm()
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.diagnostics.join('\n')).not.toContain('OPENCLAW_ACTIVATION_FAILED')
  })

  it('shares one activation across concurrent warmups for the same binding', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await Promise.all([harness.warm(), harness.warm(), harness.warm()])
    expect(harness.state.activations).toBe(1)
    expect(harness.tools()).toHaveLength(harness.prepared.tools.length)
    expect(harness.plugin.diagnostics.filter(message => message.includes('OPENCLAW_ACTIVATION_FAILED'))).toEqual([])
  })

  it('keeps a defaultless deployment inactive without blocking OpenClaw', async () => {
    const harness = await createNativeHarness({ defaultless: true })
    harnesses.push(harness)
    await expect(harness.warm()).resolves.toBeUndefined()
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.diagnostics.join('\n')).not.toContain('OPENCLAW_ACTIVATION_FAILED')
  })

  it('times out held embedded activation and fences late completion', async () => {
    const harness = await createNativeHarness({ holdActivation: true, warmupTimeoutMs: 100 })
    harnesses.push(harness)
    const started = Date.now()
    await harness.warm()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.diagnostics.join('\n')).toContain('OPENCLAW_WARMUP_FAILED')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
    expect(harness.tools()).toEqual([])
  })

  it('rejects a selected preset that conflicts with prepared deployment metadata', async () => {
    const harness = await createNativeHarness({ preparedRuntimePresetId: 'other-preset' })
    harnesses.push(harness)
    await expect(harness.warm()).resolves.toBeUndefined()
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.diagnostics.join('\n')).toContain('does not match prepared deployment')
  })

  it('rejects runtime Host Extension IDs absent from the prepared artifact', async () => {
    const harness = await createNativeHarness({ hostExtensions: [{ id: 'not-prepared' }] })
    harnesses.push(harness)
    await expect(harness.warm()).resolves.toBeUndefined()
    expect(harness.tools()).toEqual([])
    expect(harness.plugin.diagnostics.join('\n')).toContain('unknown Host Extension id "not-prepared"; regenerate the artifact and restart the OpenClaw plugin')
  })

  it('retires a late binding when the native session generation rotates', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    const original = harness.context()
    await harness.warm(original)
    const oldTool = harness.tools(original)[0]!
    const replacement = harness.context({ sessionId: 'session-two', runId: 'run-two' })
    await Promise.all([harness.warm(replacement), harness.warm(replacement)])
    await expect(oldTool.execute('old-call', { value: 'stale' })).rejects.toThrow('no longer active')
    expect(harness.tools(replacement)).toHaveLength(harness.prepared.tools.length)
  })
})
