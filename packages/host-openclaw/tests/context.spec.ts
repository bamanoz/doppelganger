import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, type NativeHarness } from './support.ts'

const harnesses: NativeHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

describe('OpenClaw per-turn context', () => {
  it('preserves instruction and transient data authority across tool continuation', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const first = await harness.prompt('principal input')
    const continuation = await harness.prompt('principal input')
    expect(first).toEqual({ appendSystemContext: 'FIXTURE INSTRUCTION', appendContext: 'FIXTURE DATA' })
    expect(continuation).toEqual(first)
    expect(harness.state.contextRequests).toHaveLength(1)
    expect(harness.state.contextRequests[0]).toMatchObject({ input: 'principal input', turnId: 'run-one' })
  })

  it('reuses one context assembly across retries without cross-turn leakage', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    await Promise.all([
      harness.prompt('retry input'),
      harness.prompt('retry input'),
      harness.prompt('retry input'),
    ])
    expect(harness.state.contextRequests).toHaveLength(1)
    const later = harness.context({ runId: 'run-two' })
    expect(await harness.prompt('later input', later)).toEqual({
      appendSystemContext: 'FIXTURE INSTRUCTION',
      appendContext: 'FIXTURE DATA',
    })
    expect(harness.state.contextRequests).toHaveLength(2)
    expect(harness.state.contextRequests[1]?.input).toBe('later input')
  })

  it('omits failed context without leaking another session assembly', async () => {
    const harness = await createNativeHarness({
      actorId: 'actor-one',
      secondaryActor: { agentId: 'agent-two', sessionKey: 'route-two', sessionId: 'session-two', actorId: 'actor-two' },
    })
    harnesses.push(harness)
    const healthy = harness.context()
    const failing = harness.context({
      agentId: 'agent-two', sessionKey: 'route-two', sessionId: 'session-two',
      workspaceDir: join(harness.root, 'workspace-secondary'), runId: 'failed-turn',
    })
    await Promise.all([harness.warm(healthy), harness.warm(failing)])
    expect(await harness.prompt('healthy', healthy)).toBeDefined()
    harness.state.failContext = true
    expect(await harness.prompt('failure', failing)).toBeUndefined()
    expect(harness.state.contextRequests).toHaveLength(2)
    expect(harness.state.contextRequests[1]?.actor).toEqual({ state: 'bound', actorId: 'actor-two' })
    expect(harness.plugin.diagnostics.join('\n')).toContain('OPENCLAW_CONTEXT_RESOLUTION_FAILED')
  })
})
