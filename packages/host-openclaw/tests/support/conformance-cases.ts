import { setTimeout as delay } from 'node:timers/promises'
import { expect } from 'vitest'
import {
  expectRuntimeHostActorState,
  expectRuntimeHostApprovalReplay,
  expectRuntimeHostCancellationAndCompletion,
  expectRuntimeHostCatalogSnapshot,
  expectRuntimeHostCatalogUnchanged,
  expectRuntimeHostFailure,
  expectRuntimeHostFixedCapabilities,
  expectRuntimeHostSuccess,
  type RuntimeHostConformanceTool,
} from '@doppelganger/doppelganger-protocols/test-support/runtime-host-conformance'
import { OPENCLAW_RUNTIME_HOST_CAPABILITIES } from '../../src/index.ts'
import {
  OPENCLAW_CONFORMANCE_TOOL_NAMES,
  conformanceTool,
  createOpenClawConformanceHarness,
  waitForConformance,
  type OpenClawConformanceHarness,
} from './conformance-harness.ts'

async function disposeAll(harnesses: readonly OpenClawConformanceHarness[]): Promise<void> {
  await Promise.all(harnesses.map(harness => harness.dispose()))
}

export async function checkNativeRegistrationIsolationAndOptionalProtocols(): Promise<void> {
  const first = await createOpenClawConformanceHarness({ nativeSessionId: 'conformance-native-first' })
  const second = await createOpenClawConformanceHarness({ nativeSessionId: 'conformance-native-second' })
  const empty = await createOpenClawConformanceHarness({ context: false, tools: false })
  try {
    expect(first.plugin.toolNames).toEqual(first.prepared.tools.map(tool => tool.nativeName))
    expect(first.plugin.toolNames).toHaveLength(OPENCLAW_CONFORMANCE_TOOL_NAMES.length)
    expect(first.plugin.hooks.has('before_model_resolve')).toBe(true)
    expect(first.plugin.hooks.has('before_tool_call')).toBe(true)

    await first.registerSet('first-owner', [conformanceTool('first.read', 'first')])
    await second.registerSet('second-owner', [conformanceTool('second.read', 'second')])
    await Promise.all([
      waitForConformance(
        () => first.nativeTools().some(tool => tool.name === first.nativeNames['first.read']),
        'first native session projection',
      ),
      waitForConformance(
        () => second.nativeTools().some(tool => tool.name === second.nativeNames['second.read']),
        'second native session projection',
      ),
    ])

    expectRuntimeHostCatalogSnapshot(first.portableSnapshot(), ['first.read'])
    expectRuntimeHostCatalogSnapshot(second.portableSnapshot(), ['second.read'])
    expect(first.nativeTools().map(tool => tool.name)).toEqual([first.nativeNames['first.read']])
    expect(second.nativeTools().map(tool => tool.name)).toEqual([second.nativeNames['second.read']])
    await expectRuntimeHostSuccess(first.execute(first.nativeTool('first.read'), 'first-call', {}), { value: 'first' })
    await expectRuntimeHostSuccess(second.execute(second.nativeTool('second.read'), 'second-call', {}), { value: 'second' })
    expect(first.runtimeSessionId).not.toBe(second.runtimeSessionId)

    expect(empty.portableSnapshot()).toEqual({ revision: 'catalog:0', tools: [] })
    expect(empty.nativeTools()).toEqual([])
    const prompt = empty.plugin.hooks.get('before_prompt_build')
    expect(prompt).toBeDefined()
    await expect(prompt!({ prompt: 'nothing', messages: [] }, { ...empty.context, runId: empty.runId })).resolves.toEqual({})
  } finally {
    await disposeAll([first, second, empty])
  }
}

export async function checkPortableSnapshotAndFixedNativeProjection(): Promise<void> {
  const harness = await createOpenClawConformanceHarness()
  try {
    const first = await harness.registerSet('first-owner', [conformanceTool('alpha.read', 'one')])
    await harness.registerSet('second-owner', [conformanceTool('beta.read', 'two')])
    await waitForConformance(() => harness.state.catalogChanges.length === 2, 'initial portable catalog notifications')
    await waitForConformance(
      () => harness.nativeTools().some(tool => tool.name === harness.nativeNames['alpha.read']),
      'initial fixed-catalog projection',
    )

    const before = harness.portableSnapshot()
    const portableAlpha = before.tools.find(tool => tool.name === 'alpha.read')
    expect(portableAlpha).toBeDefined()
    const staleNativeAlpha = harness.nativeTool('alpha.read')
    expect(staleNativeAlpha.name).toBe(harness.nativeNames['alpha.read'])
    expect(staleNativeAlpha.name).not.toBe(portableAlpha!.name)
    expect(staleNativeAlpha.parameters).toEqual(portableAlpha!.inputSchema)
    expect(staleNativeAlpha).not.toHaveProperty('revision')

    await expect(first.replace([
      conformanceTool('replacement.read', 'replacement'),
      conformanceTool('beta.read', 'collision'),
    ])).rejects.toThrow('already registered')
    expectRuntimeHostCatalogUnchanged(before, harness.portableSnapshot())

    await first.replace([conformanceTool('alpha.read', 'updated')])
    await waitForConformance(() => harness.state.catalogChanges.length === 3, 'replacement catalog notification')
    await waitForConformance(
      () => harness.nativeTools().some(tool => tool.name === harness.nativeNames['alpha.read']),
      'replacement fixed-catalog projection',
    )
    const current = harness.portableSnapshot().tools.find(tool => tool.name === 'alpha.read')
    expect(current?.revision).not.toBe(portableAlpha!.revision)
    expect(harness.beforeTool(staleNativeAlpha, 'stale-call', {})?.block).not.toBe(true)
    await expectRuntimeHostFailure(
      harness.executeRetained(staleNativeAlpha, 'stale-call', {}),
      { kind: 'result', code: 'TOOL_REVISION_STALE' },
    )
    const currentNativeAlpha = harness.nativeTool('alpha.read')
    await expectRuntimeHostSuccess(
      harness.execute(currentNativeAlpha, 'current-call', {}),
      { value: 'updated' },
    )

    await first.replace([])
    await waitForConformance(() => harness.state.catalogChanges.length === 4, 'removal catalog notification')
    await waitForConformance(
      () => harness.nativeTools().every(tool => tool.name !== harness.nativeNames['alpha.read']),
      'removed descriptor withdrawal',
    )
    expect(harness.beforeTool(currentNativeAlpha, 'removed-call', {})).toMatchObject({
      block: true,
      blockReason: expect.stringMatching(/unavailable|incompatible/i),
    })
    await expectRuntimeHostFailure(
      harness.executeRetained(currentNativeAlpha, 'removed-call', {}),
      { kind: 'result', code: 'TOOL_UNAVAILABLE' },
    )
    expect(harness.nativeTools().map(tool => tool.name)).not.toContain(harness.nativeNames['alpha.read'])

    await first.replace([conformanceTool('alpha.read', 'updated-again')])
    await waitForConformance(() => harness.state.catalogChanges.length === 5, 're-added catalog notification')
    await waitForConformance(
      () => harness.nativeTools().some(tool => tool.name === harness.nativeNames['alpha.read']),
      're-added fixed-catalog projection',
    )

    const undeclared: RuntimeHostConformanceTool = {
      name: 'extra.read',
      description: 'Undeclared conformance tool',
      inputSchema: { type: 'object' },
      fixtureResult: { value: 'extra' },
    }
    await harness.registerSet('undeclared-owner', [undeclared])
    await waitForConformance(() => harness.state.catalogChanges.length === 6, 'undeclared catalog notification')
    await waitForConformance(
      () => harness.plugin.diagnostics.some(message => message.includes('extra.read') && message.includes('regenerate')),
      'undeclared descriptor diagnostic',
    )
    expect(harness.portableSnapshot().tools.map(tool => tool.name)).toContain('extra.read')
    expect(harness.nativeTools().map(tool => tool.name)).not.toContain('dg_extra__read')
    expect(harness.plugin.toolNames).not.toContain('dg_extra__read')
    expect(harness.plugin.diagnostics.join('\n')).toContain('regenerate')

    await first.replace([{
      ...conformanceTool('alpha.read', 'drifted'),
      inputSchema: { type: 'object', properties: { count: { type: 'integer' } } },
    }])
    await waitForConformance(() => harness.state.catalogChanges.length === 7, 'schema drift catalog notification')
    await waitForConformance(
      () => harness.plugin.diagnostics.some(message => message.includes('alpha.read') && message.includes('no longer matches')),
      'schema drift diagnostic',
    )
    expect(harness.nativeTools().map(tool => tool.name)).not.toContain(harness.nativeNames['alpha.read'])
    expect(harness.plugin.diagnostics.join('\n')).toContain('no longer matches its prepared descriptor contract')
  } finally {
    await harness.dispose()
  }
}

export async function checkExactNativeApprovalAndReplay(): Promise<void> {
  const first = await createOpenClawConformanceHarness()
  const second = await createOpenClawConformanceHarness()
  try {
    const definition = conformanceTool('approval.write', 'approved', {
      approval: { policy: 'required', reason: 'Confirm exact conformance mutation' },
    })
    await first.registerSet('approval-owner', [definition])
    await second.registerSet('approval-owner', [definition])
    await Promise.all([
      waitForConformance(
        () => first.nativeTools().some(tool => tool.name === first.nativeNames['approval.write']),
        'first approval projection',
      ),
      waitForConformance(
        () => second.nativeTools().some(tool => tool.name === second.nativeNames['approval.write']),
        'second approval projection',
      ),
    ])
    const firstTool = first.nativeTool('approval.write')
    const secondTool = second.nativeTool('approval.write')
    const exactInput = { exact: true }
    const approval = first.beforeTool(firstTool, 'approved-call', exactInput)?.requireApproval
    expect(approval).toMatchObject({
      title: 'approval.write',
      description: 'Confirm exact conformance mutation',
      allowedDecisions: ['allow-once', 'deny'],
    })
    if (approval === undefined) throw new Error('native approval request was not created')
    approval.onResolution('allow-once')
    await expectRuntimeHostApprovalReplay(
      () => first.execute(firstTool, 'approved-call', exactInput),
      { value: 'approved' },
      () => {
        approval.onResolution('allow-once')
        return first.execute(firstTool, 'approved-call', exactInput)
      },
      { kind: 'rejection', message: /approval|absent|stale|cancelled/i },
    )
    expect(first.state.calls).toHaveLength(1)
    expect(first.state.calls[0]).toMatchObject({
      name: 'approval.write',
      input: exactInput,
      callId: 'approved-call',
      turnId: first.runId,
    })

    await expectRuntimeHostFailure(
      first.execute(firstTool, 'replay-call', exactInput),
      { kind: 'rejection', message: /approval|absent|stale|cancelled/i },
    )
    await expectRuntimeHostFailure(
      second.execute(secondTool, 'approved-call', exactInput),
      { kind: 'rejection', message: /approval|absent|stale|cancelled/i },
    )
    expect(first.state.calls).toHaveLength(1)
    expect(second.state.calls).toHaveLength(0)

    const changed = first.beforeTool(firstTool, 'changed-call', { exact: 'before' })
    changed!.requireApproval!.onResolution('allow-once')
    await expectRuntimeHostFailure(
      first.execute(firstTool, 'changed-call', { exact: 'after' }),
      { kind: 'rejection', message: /approval|absent|stale|cancelled/i },
    )

    const denied = first.beforeTool(firstTool, 'denied-call', exactInput)
    denied!.requireApproval!.onResolution('deny')
    await expectRuntimeHostFailure(
      first.execute(firstTool, 'denied-call', exactInput),
      { kind: 'rejection', message: /approval|absent|stale|cancelled/i },
    )

    const controller = new AbortController()
    const cancelled = first.beforeTool(firstTool, 'cancelled-call', exactInput, controller.signal)
    cancelled!.requireApproval!.onResolution('allow-once')
    controller.abort(new Error('native approval cancelled'))
    await expectRuntimeHostFailure(
      first.execute(firstTool, 'cancelled-call', exactInput),
      { kind: 'rejection', message: /approval|absent|stale|cancelled/i },
    )
    expect(first.state.calls).toHaveLength(1)
  } finally {
    await disposeAll([first, second])
  }
}

export async function checkNativeCancellationCompletionAndDisposal(): Promise<void> {
  const active = await createOpenClawConformanceHarness()
  try {
    await active.registerSet('worker-owner', [
      conformanceTool('worker.wait', 'unused', { fixtureBehavior: 'hold' }),
      conformanceTool('worker.fast', 'fast'),
    ])
    await delay(50)
    const controller = new AbortController()
    const waiting = active.execute(active.nativeTool('worker.wait'), 'waiting-call', {}, controller.signal)
    await active.waitForCall('waiting-call')
    controller.abort(new Error('native cancellation'))
    const fastController = new AbortController()
    await expectRuntimeHostCancellationAndCompletion(
      waiting,
      { kind: 'result', code: 'TOOL_CANCELLED' },
      () => active.execute(active.nativeTool('worker.fast'), 'fast-call', {}, fastController.signal),
      { value: 'fast' },
    )
    fastController.abort(new Error('late native cancellation'))
    expect(active.state.calls.filter(call => call.callId === 'fast-call')).toHaveLength(1)
  } finally {
    await active.dispose()
  }

  const retiring = await createOpenClawConformanceHarness()
  const successor = await createOpenClawConformanceHarness()
  try {
    const registration = await retiring.registerSet('dispose-owner', [
      conformanceTool('worker.dispose', 'late', { fixtureBehavior: 'hold' }),
    ])
    await successor.registerSet('successor-owner', [conformanceTool('worker.successor', 'current')])
    await delay(50)
    const staleTool = retiring.nativeTool('worker.dispose')
    const invocation = retiring.execute(staleTool, 'dispose-call', {})
    await retiring.waitForCall('dispose-call')
    const nextCatalogCount = successor.state.catalogChanges.length
    const disposal = retiring.dispose()
    await expectRuntimeHostFailure(invocation, { kind: 'result', code: 'TOOL_CANCELLED' })
    await disposal
    const oldCatalogCount = retiring.state.catalogChanges.length

    await expect(staleTool.execute('late-call', {})).rejects.toThrow(/active|binding|disposed/i)
    await expect(registration.replace([conformanceTool('worker.late', 'late')])).rejects.toThrow('disposed')
    retiring.releaseCall('dispose-call')
    expect(retiring.state.catalogChanges).toHaveLength(oldCatalogCount)
    expect(successor.state.catalogChanges).toHaveLength(nextCatalogCount)
    await expectRuntimeHostSuccess(
      successor.execute(successor.nativeTool('worker.successor'), 'successor-call', {}),
      { value: 'current' },
    )
    await retiring.dispose()
  } finally {
    await disposeAll([retiring, successor])
  }
}

export async function checkFixedCapabilitiesActorStatesAndLifecycleBoundary(): Promise<void> {
  const unbound = await createOpenClawConformanceHarness({ actor: 'unbound' })
  const bound = await createOpenClawConformanceHarness({ actor: { actorId: 'actor-one' } })
  try {
    expectRuntimeHostFixedCapabilities(unbound.capabilities, OPENCLAW_RUNTIME_HOST_CAPABILITIES)
    expectRuntimeHostFixedCapabilities(bound.capabilities, OPENCLAW_RUNTIME_HOST_CAPABILITIES)
    expect(unbound.capabilities).toEqual({
      protocolVersion: 2,
      context: { delivery: 'per-turn' },
      tools: { delivery: 'session-start', requiredApproval: true, cancellation: true },
      lifecycle: { events: [] },
    })
    expectRuntimeHostActorState(unbound.actorIdentity, 'unbound')
    expectRuntimeHostActorState(bound.actorIdentity, { actorId: 'actor-one' })
    expect(unbound.plugin.hooks.has('agent_end')).toBe(false)
    expect(unbound.plugin.hooks.has('turn-committed')).toBe(false)
    expect(() => unbound.requireLifecycle('session-completed')).toThrow('not declared')
  } finally {
    await disposeAll([unbound, bound])
  }
}
