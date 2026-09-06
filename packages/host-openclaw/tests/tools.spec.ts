import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, waitUntil, type NativeHarness } from './support.ts'

const harnesses: NativeHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

describe('OpenClaw native tool dispatch', () => {
  it('forwards native cancellation to only the correlated portable call', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const hold = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.hold'])!
    const first = new AbortController()
    const second = new AbortController()
    const firstResult = harness.invoke(hold, 'hold-one', {}, undefined, first.signal)
    const secondResult = harness.invoke(hold, 'hold-two', {}, undefined, second.signal)
    await waitUntil(() => harness.state.calls.filter(call => call.name === 'fixture.hold').length === 2, 'held calls')
    first.abort(new Error('cancel first'))
    await expect(firstResult).resolves.toMatchObject({ details: { ok: false, error: { code: 'TOOL_CANCELLED' } } })
    let secondSettled = false
    void secondResult.finally(() => { secondSettled = true })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
    expect(secondSettled).toBe(false)
    second.abort(new Error('cancel second'))
    await expect(secondResult).resolves.toMatchObject({ details: { ok: false, error: { code: 'TOOL_CANCELLED' } } })
  })

  it('settles a completion-cancellation race exactly once', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const hold = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.hold'])!
    const controller = new AbortController()
    const pending = harness.invoke(hold, 'raced-call', {}, undefined, controller.signal) as Promise<{ details: { ok: boolean; error?: { code: string } } }>
    await waitUntil(() => harness.state.calls.some(call => call.callId === 'raced-call'), 'raced call')
    harness.state.releaseHold?.('raced-call')
    queueMicrotask(() => controller.abort(new Error('raced cancellation')))
    const result = await pending
    expect(result.details.ok ? 'completed' : result.details.error?.code).toMatch(/completed|TOOL_CANCELLED/)
    expect(harness.state.calls.filter(call => call.callId === 'raced-call')).toHaveLength(1)
  })

  it('uses valid final native arguments for tools without approval', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const echo = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.echo'])!
    await harness.beforeTool(echo, 'finalized-input', { value: 'initial' })
    const result = await echo.execute('finalized-input', { value: 'final' })
    expect(result.details).toMatchObject({ ok: true, value: { value: 'final' } })
  })

  it('preserves portable domain errors separately from adapter failures', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const fail = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.fail'])!
    await expect(harness.invoke(fail, 'domain-failure', {})).resolves.toMatchObject({
      details: {
        ok: false,
        error: {
          code: 'FIXTURE_DOMAIN',
          message: 'fixture refused the operation',
          data: { retryable: false },
        },
      },
    })
  })
})
