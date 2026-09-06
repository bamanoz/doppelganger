import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, waitUntil, type NativeHarness } from './support.ts'
import {
  createReloadDisposalHarness,
  type ReloadDisposalBinding,
  type ReloadDisposalHarness,
} from './support/reload-disposal-harness.ts'

const harnesses: NativeHarness[] = []
const lifecycleHarnesses: ReloadDisposalHarness[] = []
afterEach(async () => {
  await Promise.allSettled([
    ...harnesses.splice(0).map(harness => harness.dispose()),
    ...lifecycleHarnesses.splice(0).map(harness => harness.dispose()),
  ])
})

function nestedErrorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) return [String(error)]
  return error instanceof AggregateError
    ? [error.message, ...error.errors.flatMap(nestedErrorMessages)]
    : [error.message]
}

describe('OpenClaw native disposal', () => {
  it('cancels held calls, fences late callbacks and disposes session ownership', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const hold = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.hold'])!
    const pending = harness.invoke(hold, 'held-during-disposal', {})
    await waitUntil(() => harness.state.calls.some(call => call.callId === 'held-during-disposal'), 'held tool invocation')
    await harness.plugin.cleanup?.({ reason: 'disable' })
    await expect(pending).resolves.toMatchObject({ details: { ok: false } })
    expect(harness.state.disposals).toBe(1)
    await expect(hold.execute('late-call', {})).rejects.toThrow('no longer active')
  })

  it('makes repeated cleanup idempotent without reviving bindings', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    await harness.plugin.cleanup?.({ reason: 'disable' })
    await harness.plugin.cleanup?.({ reason: 'disable' })
    expect(harness.state.disposals).toBe(1)
    expect(harness.tools()).toEqual([])
  })

  it('retires only the named session route and preserves a sibling binding', async () => {
    const first = await createNativeHarness({ sessionKey: 'route-one' })
    const second = await createNativeHarness({ agentId: 'agent-two', sessionKey: 'route-two', sessionId: 'session-two' })
    harnesses.push(first, second)
    await Promise.all([first.warm(), second.warm()])
    await first.plugin.cleanup?.({ reason: 'reset', sessionKey: 'route-one' })
    expect(first.tools()).toEqual([])
    expect(second.tools()).toHaveLength(second.prepared.tools.length)
  })

  it('exhausts native and Cordis cleanup after one disposer fails', async () => {
    const failing: ReloadDisposalBinding = {
      actorId: 'failing-owner',
      agentId: 'failing-agent',
      sessionKey: 'failing-route',
      sessionId: 'failing-session',
    }
    const healthy: ReloadDisposalBinding = {
      actorId: 'healthy-owner',
      agentId: 'healthy-agent',
      sessionKey: 'healthy-route',
      sessionId: 'healthy-session',
    }
    const activating: ReloadDisposalBinding = {
      actorId: 'activating-owner',
      agentId: 'activating-agent',
      sessionKey: 'activating-route',
      sessionId: 'activating-session',
    }
    const harness = await createReloadDisposalHarness({ bindings: [failing, healthy, activating] })
    lifecycleHarnesses.push(harness)
    const failingContext = harness.context(failing)
    const healthyContext = harness.context(healthy)
    const activatingContext = harness.context(activating)

    harness.state.heldActivations.add(activating.actorId)
    const pendingWarmup = harness.warm(activatingContext)
    await harness.waitForActivation(activating.actorId)
    let activatingCleanupSettled = false
    const activatingCleanup = harness.cleanup(activating.sessionKey).finally(() => { activatingCleanupSettled = true })
    await Promise.resolve()
    expect(activatingCleanupSettled).toBe(false)
    harness.releaseActivation(activating.actorId)
    await Promise.all([pendingWarmup, activatingCleanup])
    expect(harness.state.resumedActivations).toContain(activating.actorId)
    expect(harness.tools(activatingContext)).toEqual([])

    harness.state.throwingDisposers.add(failing.actorId)
    await Promise.all([harness.warm(failingContext), harness.warm(healthyContext)])
    const failingHold = harness.tools(failingContext).find(tool => tool.name === harness.nativeNames['reload.hold'])!
    const healthyProbe = harness.tools(healthyContext).find(tool => tool.name === harness.nativeNames['reload.probe'])!
    const lateCallbackId = harness.state.latestLateCallback.get(failing.actorId)!
    const pendingCall = harness.invoke(failingHold, 'held-through-failing-disposal', {}, failingContext)
    await harness.waitForCall('held-through-failing-disposal')

    const failingCleanup = harness.cleanup(failing.sessionKey).catch(error => error)
    await harness.waitForCancellation('held-through-failing-disposal')
    expect(harness.state.settledCalls).not.toContain('held-through-failing-disposal')
    harness.releaseCall('held-through-failing-disposal')
    await expect(pendingCall).resolves.toMatchObject({
      details: { ok: false, error: { code: 'TOOL_CANCELLED' } },
    })
    const cleanupFailure = await failingCleanup
    expect(cleanupFailure).toBeInstanceOf(AggregateError)
    expect(nestedErrorMessages(cleanupFailure)).toContain('fixture disposer failed for failing-owner')
    expect(harness.state.cleanupStages.filter(stage => stage.startsWith('failing-owner:'))).toEqual([
      'failing-owner:throwing',
      'failing-owner:observable',
    ])
    await expect(failingHold.execute('late-native-call', {})).rejects.toThrow('no longer active')

    harness.releaseLatestLateCallback(failing.actorId)
    await waitUntil(
      () => harness.state.lateCallbackOutcomes.some(outcome => outcome.callbackId === lateCallbackId),
      'retired fixture late callback',
    )
    expect(harness.state.lateCallbackOutcomes.find(outcome => outcome.callbackId === lateCallbackId)?.outcome)
      .toMatch(/disposed|inactive|closed/i)
    expect(harness.tools(failingContext)).toEqual([])

    await expect(harness.invoke(healthyProbe, 'healthy-sibling-call', { value: 'still-live' }, healthyContext))
      .resolves.toMatchObject({
        details: {
          ok: true,
          value: { actorId: 'healthy-owner', generation: 'one', value: 'still-live' },
        },
      })
    const failedCleanupStages = harness.state.cleanupStages.filter(stage => stage.startsWith('failing-owner:'))
    await expect(harness.cleanup(failing.sessionKey)).resolves.toBeUndefined()
    expect(harness.state.cleanupStages.filter(stage => stage.startsWith('failing-owner:'))).toEqual(failedCleanupStages)
  })
})
