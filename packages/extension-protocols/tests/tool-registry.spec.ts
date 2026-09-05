import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  ToolInvocationError,
  ToolRegistry,
  digestToolInput,
  type ToolDefinition,
  type ToolInvocationRequest,
} from '../src/index.ts'

async function setup() {
  const context = new Context()
  await context.plugin(ToolRegistry)
  return context
}

function request(
  registry: ToolRegistry,
  name: string,
  input: ToolInvocationRequest['input'] = {},
  callId = 'call-one',
): ToolInvocationRequest {
  const descriptor = registry.snapshot().tools.find(tool => tool.name === name)
  if (descriptor === undefined) throw new Error(`missing descriptor ${name}`)
  return { callId, name, toolRevision: descriptor.revision, input }
}

const definition = (name: string, invoke: ToolDefinition['invoke']): ToolDefinition => ({
  name,
  label: `Label for ${name}`,
  description: `Description for ${name}`,
  inputSchema: { type: 'object' },
  invoke,
})

describe('tool registry', () => {
  it('commits deterministic immutable snapshots and retains unchanged tool revisions', async () => {
    const context = await setup()
    const changed: string[] = []
    context.on('doppelganger/tools-changed', revision => { changed.push(revision) })
    const stableHandler = () => ({ stable: true })
    const first = context.doppelgangerTools.registerSet('first-owner', [
      definition('zeta.read', () => ({ zeta: true })),
      definition('alpha.read', stableHandler),
    ])
    const initial = context.doppelgangerTools.snapshot()
    expect(initial.tools.map(tool => tool.name)).toEqual(['alpha.read', 'zeta.read'])
    expect(initial.tools[0]?.label).toBe('Label for alpha.read')
    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(initial.tools)).toBe(true)
    expect(Object.isFrozen(initial.tools[0])).toBe(true)

    const second = context.doppelgangerTools.registerSet('second-owner', [
      definition('middle.read', () => ({ middle: true })),
    ])
    const afterUnrelated = context.doppelgangerTools.snapshot()
    expect(afterUnrelated.revision).not.toBe(initial.revision)
    expect(afterUnrelated.tools.find(tool => tool.name === 'alpha.read')?.revision)
      .toBe(initial.tools.find(tool => tool.name === 'alpha.read')?.revision)

    first.replace([
      definition('alpha.read', stableHandler),
      definition('zeta.read', () => ({ zeta: 2 })),
    ])
    const replaced = context.doppelgangerTools.snapshot()
    expect(replaced.tools.find(tool => tool.name === 'alpha.read')?.revision)
      .toBe(initial.tools.find(tool => tool.name === 'alpha.read')?.revision)
    expect(replaced.tools.find(tool => tool.name === 'zeta.read')?.revision)
      .not.toBe(initial.tools.find(tool => tool.name === 'zeta.read')?.revision)
    expect(changed).toEqual([initial.revision, afterUnrelated.revision, replaced.revision])

    const firstDisposal = first.dispose()
    expect(first.dispose()).toBe(firstDisposal)
    await Promise.all([firstDisposal, second.dispose()])
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    await context.fiber.dispose()
  })

  it('contains catalog observer failure after an atomic commit', async () => {
    const context = await setup()
    const observed: string[] = []
    const diagnostics: Array<{ code: string; revision: string; message: string }> = []
    context.on('doppelganger/tools-changed', () => { throw new Error('observer failed') })
    context.on('doppelganger/tools-changed', revision => { observed.push(revision) })
    context.on('doppelganger/tools-diagnostic', diagnostic => { diagnostics.push(diagnostic) })

    const registration = context.doppelgangerTools.registerSet('contained-owner', [
      definition('contained.read', () => ({ committed: true })),
    ])
    const committed = context.doppelgangerTools.snapshot()
    expect(committed.tools.map(tool => tool.name)).toEqual(['contained.read'])
    await vi.waitFor(() => {
      expect(observed).toEqual([committed.revision])
      expect(diagnostics).toEqual([expect.objectContaining({
        code: 'TOOL_CATALOG_OBSERVER_FAILED',
        revision: committed.revision,
        message: expect.stringContaining('observer failed'),
      })])
    })

    await registration.dispose()
    await context.fiber.dispose()
  })

  it('aborts and settles active calls when their owner is disposed', async () => {
    const context = await setup()
    const started = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<void>()
    const registration = context.doppelgangerTools.registerSet('retiring-owner', [
      definition('worker.retire', async (_input, invocation) => {
        started.resolve(invocation.signal)
        await release.promise
        return { stale: true }
      }),
    ])
    const running = context.doppelgangerTools.invoke(request(context.doppelgangerTools, 'worker.retire'), 'session-one')
    const signal = await started.promise

    const disposal = registration.dispose()
    expect(registration.dispose()).toBe(disposal)
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    expect(signal.aborted).toBe(true)
    let disposed = false
    void disposal.then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    release.resolve()
    await expect(running).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })
    await expect(disposal).resolves.toBeUndefined()
    await context.fiber.dispose()
  })

  it('retains active calls only for unchanged definitions during owner replacement', async () => {
    const context = await setup()
    const stableStarted = Promise.withResolvers<AbortSignal>()
    const revisedStarted = Promise.withResolvers<AbortSignal>()
    const stableRelease = Promise.withResolvers<void>()
    const revisedRelease = Promise.withResolvers<void>()
    const stableHandler: ToolDefinition['invoke'] = async (_input, invocation) => {
      stableStarted.resolve(invocation.signal)
      await stableRelease.promise
      return { stable: true }
    }
    const revisedHandler: ToolDefinition['invoke'] = async (_input, invocation) => {
      revisedStarted.resolve(invocation.signal)
      await revisedRelease.promise
      return { stale: true }
    }
    const registration = context.doppelgangerTools.registerSet('replacement-owner', [
      definition('worker.stable', stableHandler),
      definition('worker.revised', revisedHandler),
    ])
    const stable = context.doppelgangerTools.invoke(request(context.doppelgangerTools, 'worker.stable'), 'session-one')
    const revised = context.doppelgangerTools.invoke(
      request(context.doppelgangerTools, 'worker.revised', {}, 'call-two'),
      'session-one',
    )
    const [stableSignal, revisedSignal] = await Promise.all([stableStarted.promise, revisedStarted.promise])

    registration.replace([
      definition('worker.stable', stableHandler),
      definition('worker.revised', () => ({ replacement: true })),
    ])
    expect(stableSignal.aborted).toBe(false)
    expect(revisedSignal.aborted).toBe(true)

    stableRelease.resolve()
    revisedRelease.resolve()
    await expect(stable).resolves.toEqual({ ok: true, value: { stable: true } })
    await expect(revised).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })
    await registration.dispose()
    await context.fiber.dispose()
  })

  it('replaces complete owner sets atomically and preserves the old set on validation failure', async () => {
    const context = await setup()
    const first = context.doppelgangerTools.registerSet('first-owner', [definition('first.read', () => null)])
    context.doppelgangerTools.registerSet('second-owner', [definition('second.read', () => null)])
    const before = context.doppelgangerTools.snapshot()

    expect(() => first.replace([
      definition('replacement.read', () => null),
      definition('second.read', () => null),
    ])).toThrow('already registered by owner "second-owner"')
    expect(context.doppelgangerTools.snapshot()).toBe(before)
    expect(context.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toEqual(['first.read', 'second.read'])

    expect(() => first.replace([
      definition('duplicate.read', () => null),
      definition('duplicate.read', () => null),
    ])).toThrow('contains duplicate tool')
    expect(context.doppelgangerTools.snapshot()).toBe(before)
    await context.fiber.dispose()
  })

  it('rejects stale revisions, correlates active calls, and forwards cancellation context', async () => {
    const context = await setup()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const observed = vi.fn()
    const registration = context.doppelgangerTools.register(definition('worker.wait', async (_input, invocation) => {
      observed(invocation)
      await wait
      if (invocation.signal.aborted) throw invocation.signal.reason
      return { completed: true }
    }))
    const invocation = request(context.doppelgangerTools, 'worker.wait')
    const running = context.doppelgangerTools.invoke(invocation, 'session-one')
    await vi.waitFor(() => expect(observed).toHaveBeenCalledOnce())
    expect(Object.isFrozen(observed.mock.calls[0]?.[0])).toBe(true)
    expect(observed.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'session-one', callId: 'call-one' })
    await expect(context.doppelgangerTools.invoke(invocation, 'session-one')).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_CALL_ACTIVE' },
    })
    expect(context.doppelgangerTools.cancel({ callId: 'call-one', reason: 'host cancelled' })).toEqual({ cancelled: true })
    expect(context.doppelgangerTools.cancel({ callId: 'call-one' })).toEqual({ cancelled: false })
    release()
    await expect(running).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })

    const stale = invocation.toolRevision
    registration.update(definition('worker.wait', () => ({ replacement: true })))
    await expect(context.doppelgangerTools.invoke({ ...invocation, callId: 'call-two', toolRevision: stale }, 'session-one'))
      .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_REVISION_STALE' } })
    expect(observed).toHaveBeenCalledOnce()
    await registration.dispose()
    await context.fiber.dispose()
  })

  it('revalidates exact one-shot approval grants and rejects replay or unexpected authority', async () => {
    const context = await setup()
    const invoked = vi.fn(() => ({ changed: true }))
    context.doppelgangerTools.register({
      ...definition('memory.correct', invoked),
      approval: { policy: 'required' },
    })
    expect(context.doppelgangerTools.snapshot().tools[0]?.approval).toEqual({ policy: 'required' })
    const approved = request(context.doppelgangerTools, 'memory.correct', { value: 1 })
    const approval = {
      kind: 'one-shot' as const,
      grantId: 'grant-one',
      callId: approved.callId,
      toolRevision: approved.toolRevision,
      inputDigest: digestToolInput(approved.input),
    }
    await expect(context.doppelgangerTools.invoke({ ...approved, approval }, 'session-one'))
      .resolves.toEqual({ ok: true, value: { changed: true } })
    await expect(context.doppelgangerTools.invoke({ ...approved, callId: 'call-two', approval }, 'session-one'))
      .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_APPROVAL_INVALID' } })
    expect(invoked).toHaveBeenCalledOnce()

    const unprotected = context.doppelgangerTools.register(definition('memory.search', () => null))
    const plain = request(context.doppelgangerTools, 'memory.search', {})
    await expect(context.doppelgangerTools.invoke({ ...plain, approval: { ...approval, callId: plain.callId } }, 'session-one'))
      .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_APPROVAL_INVALID' } })
    await unprotected.dispose()
    await context.fiber.dispose()
  })

  it('rejects malformed approval metadata before registration', async () => {
    const context = await setup()
    const candidate = (approval: unknown) => ({
      ...definition('memory.correct', () => null),
      approval,
    }) as ToolDefinition

    expect(() => context.doppelgangerTools.register(candidate({ policy: 'optional' }))).toThrow('must be "required"')
    expect(() => context.doppelgangerTools.register(candidate({ policy: 'required', reason: ' ' }))).toThrow('non-empty string')
    expect(() => context.doppelgangerTools.register(candidate({ policy: 'required', reason: 'x'.repeat(1_025) }))).toThrow('1-1024')
    expect(() => context.doppelgangerTools.register(candidate({ policy: 'required', prompt: true }))).toThrow('unsupported fields')
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    const schemaGetter = vi.fn(() => ({ type: 'object' }))
    const withSchemaGetter = Object.defineProperty(definition('memory.inspect', () => null), 'inputSchema', {
      enumerable: true,
      get: schemaGetter,
    })
    expect(() => context.doppelgangerTools.register(withSchemaGetter)).toThrow('accessor')
    expect(schemaGetter).not.toHaveBeenCalled()

    const approvalGetter = vi.fn(() => 'required')
    const withApprovalGetter = {
      ...definition('memory.inspect', () => null),
      approval: Object.defineProperty({}, 'policy', { enumerable: true, get: approvalGetter }),
    } as ToolDefinition
    expect(() => context.doppelgangerTools.register(withApprovalGetter)).toThrow('accessor')
    expect(approvalGetter).not.toHaveBeenCalled()
    await context.fiber.dispose()
  })

  it('rejects non-plain tool input before cloning or approval digesting', async () => {
    const context = await setup()
    const invoked = vi.fn((input: ToolInvocationRequest['input']) => {
      expect(Object.isFrozen(input)).toBe(true)
      return input
    })
    context.doppelgangerTools.register(definition('memory.inspect', invoked))

    const coercion = vi.fn(() => ({ approved: true }))
    const withCoercion = { value: 1, toJSON: coercion } as unknown as ToolInvocationRequest['input']
    await expect(context.doppelgangerTools.invoke(request(context.doppelgangerTools, 'memory.inspect', withCoercion), 'session-one'))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(() => digestToolInput(withCoercion)).toThrow('must be JSON-compatible')
    expect(coercion).not.toHaveBeenCalled()

    const getter = vi.fn(() => 'secret')
    const withGetter = Object.defineProperty({ value: 1 }, 'secret', { enumerable: true, get: getter })
    expect(() => digestToolInput(withGetter as never)).toThrow('accessor')
    expect(getter).not.toHaveBeenCalled()

    class CustomValue { readonly value = 1 }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const nonEnumerable = Object.defineProperty({ visible: true }, 'hidden', { value: true })
    const withSymbol = { visible: true } as Record<PropertyKey, unknown>
    withSymbol[Symbol('hidden')] = true
    const deep = Array.from({ length: 66 }).reduce<Record<string, unknown>>(value => ({ value }), {})
    const invalid = [
      new CustomValue(), cycle, nonEnumerable, withSymbol, [1, , 3], { value: Number.NaN }, deep,
    ]
    for (const candidate of invalid) expect(() => digestToolInput(candidate as never)).toThrow()
    expect(() => digestToolInput({ value: 'x'.repeat(1024 * 1024) })).toThrow('exceeds')

    expect(digestToolInput({ alpha: 1, beta: [true, null] }))
      .toBe(digestToolInput({ beta: [true, null], alpha: 1 }))
    const valid = request(context.doppelgangerTools, 'memory.inspect', { nested: { value: 1 } }, 'call-valid')
    await expect(context.doppelgangerTools.invoke(valid, 'session-one')).resolves.toEqual({
      ok: true,
      value: { nested: { value: 1 } },
    })
    expect(invoked).toHaveBeenCalledOnce()
    await context.fiber.dispose()
  })


  it('returns structured domain and execution errors', async () => {
    const context = await setup()
    context.doppelgangerTools.registerSet('errors', [
      definition('memory.correct', () => { throw new ToolInvocationError('REVISION_CONFLICT', 'memory changed', { expected: 2 }) }),
      definition('memory.broken', () => { throw new Error('database unavailable') }),
    ])
    await expect(context.doppelgangerTools.invoke(request(context.doppelgangerTools, 'memory.correct'), 'session-one'))
      .resolves.toEqual({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'memory changed', data: { expected: 2 } } })
    await expect(context.doppelgangerTools.invoke(request(context.doppelgangerTools, 'memory.broken', {}, 'call-two'), 'session-one'))
      .resolves.toEqual({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED', message: 'database unavailable' } })
    await context.fiber.dispose()
  })
})
