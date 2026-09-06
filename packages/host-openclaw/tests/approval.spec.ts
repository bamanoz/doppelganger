import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, type NativeHarness } from './support.ts'

const harnesses: NativeHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.dispose())) })

type ApprovalResult = {
  requireApproval?: {
    allowedDecisions?: string[]
    onResolution?: (decision: 'allow-once' | 'deny' | 'timeout' | 'cancelled') => void
  }
}

describe('OpenClaw exact native approval', () => {
  it('dispatches one exact call after native allow-once resolution', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const tool = harness.tools().find(candidate => candidate.name === harness.nativeNames['fixture.approved'])!
    const approval = await harness.beforeTool(tool, 'approved-call', { value: 'one' }) as ApprovalResult
    expect(approval.requireApproval?.allowedDecisions).toEqual(['allow-once', 'deny'])
    approval.requireApproval?.onResolution?.('allow-once')
    await expect(tool.execute('approved-call', { value: 'one' })).resolves.toMatchObject({
      details: { ok: true },
    })
    expect(harness.state.calls.filter(call => call.name === 'fixture.approved')).toHaveLength(1)
  })

  it('rejects final input changes after native approval', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const tool = harness.tools().find(candidate => candidate.name === harness.nativeNames['fixture.approved'])!
    const approval = await harness.beforeTool(tool, 'changed-call', { value: 'reviewed' }) as ApprovalResult
    approval.requireApproval?.onResolution?.('allow-once')
    await expect(tool.execute('changed-call', { value: 'changed' })).rejects.toThrow('does not match final input')
    expect(harness.state.calls.some(call => call.callId === 'changed-call')).toBe(false)
  })

  it('revokes allow-once when the catalog generation changes before dispatch', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const tool = harness.tools().find(candidate => candidate.name === harness.nativeNames['fixture.approved'])!
    const approval = await harness.beforeTool(tool, 'revision-call', { value: 'reviewed' }) as ApprovalResult
    approval.requireApproval?.onResolution?.('allow-once')
    harness.state.replaceEcho?.()
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    await expect(tool.execute('revision-call', { value: 'reviewed' })).resolves.toMatchObject({
      details: { ok: false, error: { code: 'TOOL_REVISION_STALE' } },
    })
    expect(harness.state.calls.some(call => call.callId === 'revision-call')).toBe(false)
  })

  it('fails closed on denial timeout absent route and cancellation', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const tool = harness.tools().find(candidate => candidate.name === harness.nativeNames['fixture.approved'])!
    for (const resolution of ['deny', 'timeout', 'cancelled'] as const) {
      const callId = `${resolution}-call`
      const approval = await harness.beforeTool(tool, callId, { value: resolution }) as ApprovalResult
      approval.requireApproval?.onResolution?.(resolution)
      await expect(tool.execute(callId, { value: resolution })).rejects.toThrow(/absent|stale|cancelled|unresolved/)
    }
    await harness.beforeTool(tool, 'absent-route-call', { value: 'absent' })
    await expect(tool.execute('absent-route-call', { value: 'absent' })).rejects.toThrow(/absent|stale|cancelled|unresolved/)
    const controller = new AbortController()
    const cancelled = await harness.beforeTool(tool, 'abort-call', { value: 'abort' }, undefined, controller.signal) as ApprovalResult
    controller.abort(new Error('cancel approval'))
    cancelled.requireApproval?.onResolution?.('allow-once')
    await expect(tool.execute('abort-call', { value: 'abort' })).rejects.toThrow(/absent|stale|cancelled|unresolved/)
  })

  it('rejects replayed native approval across repeated calls and bindings', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const tool = harness.tools().find(candidate => candidate.name === harness.nativeNames['fixture.approved'])!
    const approval = await harness.beforeTool(tool, 'single-call', { value: 'once' }) as ApprovalResult
    approval.requireApproval?.onResolution?.('allow-once')
    await tool.execute('single-call', { value: 'once' })
    await expect(tool.execute('single-call', { value: 'once' })).rejects.toThrow(/absent|stale|cancelled|unresolved/)
    const rotated = harness.context({ sessionId: 'session-two', runId: 'run-two' })
    await harness.warm(rotated)
    const replacement = harness.tools(rotated).find(candidate => candidate.name === harness.nativeNames['fixture.approved'])!
    await expect(replacement.execute('single-call', { value: 'once' })).rejects.toThrow(/absent|stale|cancelled|unresolved/)
  })

})
