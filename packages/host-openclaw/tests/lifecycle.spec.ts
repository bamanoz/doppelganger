import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { expectRuntimeHostSuccess } from '@doppelganger/doppelganger-protocols/test-support/runtime-host-conformance'
import { OPENCLAW_RUNTIME_HOST_CAPABILITIES } from '../src/direct.ts'
import {
  conformanceTool,
  createOpenClawConformanceHarness,
  type OpenClawConformanceHarness,
} from './support/conformance-harness.ts'

const harnesses: OpenClawConformanceHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

describe('OpenClaw lifecycle fidelity', () => {
  it('never publishes committed turns from attempt or transcript observations', async () => {
    const harness = await createOpenClawConformanceHarness({ lifecycleConsumer: true })
    harnesses.push(harness)
    const attemptObservationHooks = [
      'agent_end',
      'before_message_write',
      'after_message_write',
      'message_sent',
    ]

    expect(OPENCLAW_RUNTIME_HOST_CAPABILITIES.lifecycle.events).toEqual([])
    for (const hook of attemptObservationHooks) expect(harness.plugin.hooks.has(hook)).toBe(false)
    expect(harness.state.lifecycleEvents).toEqual([])
  })

  it('reports missing committed-turn capability without replacing the context engine', async () => {
    const harness = await createOpenClawConformanceHarness({ lifecycleConsumer: true })
    harnesses.push(harness)
    await harness.registerSet('explicit-tools', [conformanceTool('first.read', 'available')])
    await delay(50)

    expect(harness.state.lifecycleRequirement).toEqual({
      active: false,
      missing: 'turn-committed',
      diagnostic: 'turn-committed lifecycle capability is required for automatic capture',
    })
    expect(() => harness.requireLifecycle('turn-committed')).toThrow('not declared')
    expect(harness.plugin.selectedContextEngine).toBe('existing-context-engine')
    expect(harness.plugin.contextEngineRegistrations).toEqual([])
    await expectRuntimeHostSuccess(
      harness.execute(harness.nativeTool('first.read'), 'explicit-tool-call', {}),
      { value: 'available' },
    )
  })
})
