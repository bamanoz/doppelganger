import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, type NativeHarness } from './support.ts'

const harnesses: NativeHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

describe('OpenClaw identity custody', () => {
  it('isolates trusted actor and workspace bindings across gateway sessions in one adapter', async () => {
    const harness = await createNativeHarness({
      actorId: 'actor-one',
      secondaryActor: { agentId: 'agent-two', sessionKey: 'route-two', sessionId: 'session-two', actorId: 'actor-two' },
    })
    harnesses.push(harness)
    const first = harness.context()
    const second = harness.context({
      agentId: 'agent-two', sessionKey: 'route-two', sessionId: 'session-two',
      workspaceDir: join(harness.root, 'workspace-secondary'), runId: 'run-two',
    })
    await Promise.all([harness.warm(first), harness.warm(second)])
    const firstTool = harness.tools(first).find(tool => tool.name === harness.nativeNames['fixture.echo'])!
    const secondTool = harness.tools(second).find(tool => tool.name === harness.nativeNames['fixture.echo'])!
    await harness.invoke(firstTool, 'call-one', { value: 'one' }, first)
    await harness.invoke(secondTool, 'call-two', { value: 'two' }, second)
    expect(harness.state.calls.find(call => call.callId === 'call-one')?.actor).toEqual({ state: 'bound', actorId: 'actor-one' })
    expect(harness.state.calls.find(call => call.callId === 'call-two')?.actor).toEqual({ state: 'bound', actorId: 'actor-two' })
  })

  it('keeps sessions without an exact trusted tuple unbound', async () => {
    const harness = await createNativeHarness({ actorId: 'actor-one' })
    harnesses.push(harness)
    const unmatched = harness.context({ sessionKey: 'group:unresolved:shared', sessionId: 'untrusted-session', runId: 'untrusted-run' })
    await harness.warm(unmatched)
    const tool = harness.tools(unmatched).find(candidate => candidate.name === harness.nativeNames['fixture.actor-required'])!
    const result = await harness.invoke(tool, 'unbound-call', {}, unmatched) as { details: unknown }
    expect(result.details).toMatchObject({ ok: false, error: { code: 'ACTOR_REQUIRED' } })
    expect(harness.state.calls.at(-1)?.actor).toEqual({ state: 'unbound' })
  })

  it('allows the prepared Actor Identity extension to be explicitly omitted', async () => {
    const harness = await createNativeHarness({
      actorId: 'configured-but-omitted',
      hostExtensions: [{ id: 'runtime-host' }],
    })
    harnesses.push(harness)
    await harness.warm()
    const tool = harness.tools().find(candidate => candidate.name === harness.nativeNames['fixture.actor-required'])!
    const result = await harness.invoke(tool, 'absent-actor-call', {}) as { details: unknown }
    expect(result.details).toMatchObject({ ok: false, error: { code: 'ACTOR_REQUIRED' } })
    expect(harness.state.calls.at(-1)?.actor).toBeUndefined()
  })

  it('retires prior closures when a route rotates workspace or session identity', async () => {
    const harness = await createNativeHarness({ actorId: 'actor-one' })
    harnesses.push(harness)
    const original = harness.context()
    await harness.warm(original)
    const oldTool = harness.tools(original).find(candidate => candidate.name === harness.nativeNames['fixture.echo'])!
    const rotatedWorkspace = join(harness.root, 'rotated-workspace')
    await mkdir(rotatedWorkspace, { recursive: true })
    const rotated = harness.context({ sessionId: 'rotated-session', workspaceDir: rotatedWorkspace, runId: 'rotated-run' })
    await harness.warm(rotated)
    await expect(oldTool.execute('stale-call', { value: 'stale' })).rejects.toThrow('no longer active')
  })
})
