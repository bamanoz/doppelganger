import { describe, expect, it } from 'vitest'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
  digestToolInput,
  type ActorIdentity,
  type JsonValue,
  type RuntimeHostBridge,
  type RuntimeHostCapabilities,
  type ToolDefinition,
} from '../../src/index.ts'

export interface RuntimeHostConformanceTool extends Omit<ToolDefinition, 'invoke'> {
  readonly fixtureResult: JsonValue
  readonly fixtureBehavior?: 'hold'
}

export interface RuntimeHostConformanceRegistration {
  replace(definitions: readonly RuntimeHostConformanceTool[]): Promise<void>
  dispose(): Promise<void>
}

export interface RuntimeHostConformanceSession {
  readonly bridge: RuntimeHostBridge
  readonly actorIdentity: ActorIdentity | undefined
  readonly catalogChanges: readonly string[]
  registerSet(ownerId: string, definitions: readonly RuntimeHostConformanceTool[]): Promise<RuntimeHostConformanceRegistration>
  waitForCall(callId: string): Promise<void>
  releaseCall(callId: string): Promise<void>
  dispose(): Promise<void>
}

export interface RuntimeHostConformanceFactory {
  readonly actorStates?: readonly ('absent' | 'unbound' | 'bound')[]
  readonly fixedCapabilities?: boolean
  create(options?: {
    readonly sessionId?: string
    readonly capabilities?: unknown
    readonly actor?: 'absent' | 'unbound' | { readonly actorId: string }
    readonly context?: boolean
    readonly tools?: boolean
  }): Promise<RuntimeHostConformanceSession>
}

export const FULL_CONFORMANCE_CAPABILITIES: RuntimeHostCapabilities = Object.freeze({
  protocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
  context: Object.freeze({ delivery: 'per-request' }),
  tools: Object.freeze({ delivery: 'dynamic', requiredApproval: true, cancellation: true }),
  lifecycle: Object.freeze({ events: Object.freeze([
    'session-started', 'session-completed', 'session-disposed', 'turn-started',
    'turn-committed', 'tool-started', 'tool-completed', 'pre-compaction',
  ] as const) }),
})

function tool(name: string, value: JsonValue, options: Partial<RuntimeHostConformanceTool> = {}): RuntimeHostConformanceTool {
  return { name, description: `Conformance tool ${name}`, inputSchema: { type: 'object' }, fixtureResult: { value }, ...options }
}

function descriptor(bridge: RuntimeHostBridge, name: string) {
  const value = bridge.snapshotTools().tools.find(candidate => candidate.name === name)
  if (value === undefined) throw new Error(`missing conformance descriptor ${name}`)
  return value
}

export async function conformanceCatalog(factory: RuntimeHostConformanceFactory): Promise<void> {
  const session = await factory.create({ tools: true })
  try {
    const first = await session.registerSet('first-owner', [tool('alpha.read', 'one')])
    await session.registerSet('second-owner', [tool('beta.read', 'two')])
    const before = session.bridge.snapshotTools()
    const stale = descriptor(session.bridge, 'alpha.read')
    await expect(first.replace([tool('replacement.read', 'replacement'), tool('beta.read', 'collision')])).rejects.toThrow('already registered')
    expect(session.bridge.snapshotTools()).toBe(before)
    await first.replace([tool('alpha.read', 'updated')])
    expect(session.catalogChanges).toHaveLength(3)
    await expect(session.bridge.invokeTool({ callId: 'stale-call', name: stale.name, toolRevision: stale.revision, input: {} }))
      .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_REVISION_STALE' } })
    const current = descriptor(session.bridge, 'alpha.read')
    await expect(session.bridge.invokeTool({ callId: 'current-call', name: current.name, toolRevision: current.revision, input: {} }))
      .resolves.toEqual({ ok: true, value: { value: 'updated' } })
  } finally { await session.dispose() }
}

export async function conformanceApproval(factory: RuntimeHostConformanceFactory): Promise<void> {
  const session = await factory.create({ tools: true })
  try {
    await session.registerSet('approval-owner', [tool('approval.write', 'approved', { approval: { policy: 'required', reason: 'Confirm exact conformance mutation' } })])
    const current = descriptor(session.bridge, 'approval.write')
    const request = { callId: 'approved-call', name: current.name, toolRevision: current.revision, input: { exact: true } }
    const approval = { kind: 'one-shot' as const, grantId: 'conformance-grant', callId: request.callId, toolRevision: current.revision, inputDigest: digestToolInput(request.input) }
    await expect(session.bridge.invokeTool({ ...request, approval })).resolves.toEqual({ ok: true, value: { value: 'approved' } })
    await expect(session.bridge.invokeTool({ ...request, callId: 'replay-call', approval })).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_APPROVAL_INVALID' } })
  } finally { await session.dispose() }
}

export async function conformanceCallLifecycle(factory: RuntimeHostConformanceFactory): Promise<void> {
  const session = await factory.create({ tools: true })
  try {
    await session.registerSet('cancellation-owner', [tool('worker.wait', 'unused', { fixtureBehavior: 'hold' }), tool('worker.fast', 'fast')])
    const waiting = descriptor(session.bridge, 'worker.wait')
    const invocation = session.bridge.invokeTool({ callId: 'waiting-call', name: waiting.name, toolRevision: waiting.revision, input: {} })
    await session.waitForCall('waiting-call')
    await expect(session.bridge.cancelTool({ callId: 'waiting-call', reason: 'native cancellation' })).resolves.toEqual({ cancelled: true })
    await session.releaseCall('waiting-call')
    await expect(invocation).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })
    const fast = descriptor(session.bridge, 'worker.fast')
    await expect(session.bridge.invokeTool({ callId: 'fast-call', name: fast.name, toolRevision: fast.revision, input: {} })).resolves.toEqual({ ok: true, value: { value: 'fast' } })
    await expect(session.bridge.cancelTool({ callId: 'fast-call' })).resolves.toEqual({ cancelled: false })
  } finally { await session.dispose() }

  const retiring = await factory.create({ tools: true })
  let successor: RuntimeHostConformanceSession | undefined
  try {
    const registration = await retiring.registerSet('dispose-owner', [tool('worker.dispose', 'late', { fixtureBehavior: 'hold' })])
    const current = descriptor(retiring.bridge, 'worker.dispose')
    const invocation = retiring.bridge.invokeTool({ callId: 'dispose-call', name: current.name, toolRevision: current.revision, input: {} })
    await retiring.waitForCall('dispose-call')
    await retiring.dispose()
    await expect(invocation).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })
    successor = await factory.create({ tools: true })
    await successor.registerSet('successor-owner', [tool('worker.successor', 'current')])
    const oldCount = retiring.catalogChanges.length
    const nextCount = successor.catalogChanges.length
    await expect(registration.replace([tool('worker.late', 'late')])).rejects.toThrow('disposed')
    expect(retiring.catalogChanges).toHaveLength(oldCount)
    expect(successor.catalogChanges).toHaveLength(nextCount)
    expect(successor.bridge.snapshotTools().tools.map(value => value.name)).toEqual(['worker.successor'])
  } finally {
    await retiring.dispose()
    await successor?.dispose()
  }
}

export function runtimeHostConformance(label: string, factory: RuntimeHostConformanceFactory): void {
  describe(`${label} Runtime Host conformance`, () => {
    it('isolates two sessions and preserves empty optional protocol behavior', async () => {
      const first = await factory.create({ sessionId: 'conformance-first', tools: true })
      const second = await factory.create({ sessionId: 'conformance-second', tools: true })
      try {
        await first.registerSet('first-owner', [tool('first.read', 'first')])
        await second.registerSet('second-owner', [tool('second.read', 'second')])
        expect(first.bridge.snapshotTools().tools.map(value => value.name)).toEqual(['first.read'])
        expect(second.bridge.snapshotTools().tools.map(value => value.name)).toEqual(['second.read'])
      } finally { await Promise.all([first.dispose(), second.dispose()]) }
      const empty = await factory.create({ context: false, tools: false })
      try {
        await expect(empty.bridge.resolveContext({ requestId: 'empty-request', turn: { input: 'nothing' }, tokenBudget: 10 }))
          .resolves.toEqual({ instructions: '', data: '', contributions: [], omittedSources: [], tokenCount: 0 })
        expect(empty.bridge.snapshotTools()).toEqual({ revision: 'catalog:0', tools: [] })
      } finally { await empty.dispose() }
    })

    it('rejects cross-session lifecycle publication', async () => {
      const session = await factory.create({ sessionId: 'conformance-lifecycle-session' })
      try {
        await expect(session.bridge.publishLifecycle({ protocolVersion: LIFECYCLE_PROTOCOL_VERSION, type: 'session-started', deliveryId: 'cross-session-delivery', sessionId: 'other-session', timestamp: 1 }))
          .rejects.toThrow('must equal Runtime Session "conformance-lifecycle-session"')
      } finally { await session.dispose() }
    })

    it('rejects unknown capability fields before attachment', async () => {
      await expect(factory.create({ capabilities: { ...FULL_CONFORMANCE_CAPABILITIES, features: ['native-hook'] } })).rejects.toThrow('unsupported fields')
    })

    it('commits owner replacements atomically and rejects stale descriptors', async () => { await conformanceCatalog(factory) })
    it('consumes exact approval grants once and rejects replay', async () => { await conformanceApproval(factory) })
    it('forwards cancellation and disposal without corrupting completed calls or successor bindings', async () => { await conformanceCallLifecycle(factory) })

    it('rejects undeclared lifecycle events and keeps actor identity independent', async () => {
      const restricted = await factory.create({
        sessionId: 'conformance-session',
        ...(factory.fixedCapabilities ? {} : { capabilities: { ...FULL_CONFORMANCE_CAPABILITIES, lifecycle: { events: ['session-started'] } } }),
      })
      try {
        const event = factory.fixedCapabilities
          ? { type: 'session-completed' as const, outcome: 'completed' as const }
          : { type: 'turn-started' as const, turnId: 'turn-one', principalInput: { value: 'input' } }
        await expect(restricted.bridge.publishLifecycle({ protocolVersion: LIFECYCLE_PROTOCOL_VERSION, deliveryId: 'undeclared-delivery', sessionId: 'conformance-session', timestamp: 1, ...event })).rejects.toThrow('not declared')
      } finally { await restricted.dispose() }
      const sessions: RuntimeHostConformanceSession[] = []
      try {
        for (const state of factory.actorStates ?? ['absent', 'unbound', 'bound']) {
          const session = await factory.create({ actor: state === 'bound' ? { actorId: 'actor-one' } : state })
          sessions.push(session)
          expect(session.actorIdentity).toEqual(state === 'absent' ? undefined : state === 'bound' ? { state, actorId: 'actor-one' } : { state })
          expect(session.bridge.capabilities).toEqual(sessions[0]!.bridge.capabilities)
        }
      } finally { await Promise.all(sessions.map(session => session.dispose())) }
    })
  })
}
