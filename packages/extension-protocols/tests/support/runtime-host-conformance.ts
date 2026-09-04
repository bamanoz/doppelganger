import { describe, expect, it } from 'vitest'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
  digestToolInput,
  type ActorIdentity,
  type RuntimeHostBridge,
  type RuntimeHostCapabilities,
  type ToolDefinition,
  type ToolSetRegistration,
} from '../../src/index.ts'

export interface RuntimeHostConformanceSession {
  readonly bridge: RuntimeHostBridge
  readonly actorIdentity: ActorIdentity | undefined
  readonly catalogChanges: readonly string[]
  registerSet(ownerId: string, definitions: readonly ToolDefinition[]): ToolSetRegistration
  dispose(): Promise<void>
}

export interface RuntimeHostConformanceFactory {
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
    'session-started',
    'session-completed',
    'session-disposed',
    'turn-started',
    'turn-committed',
    'tool-started',
    'tool-completed',
    'pre-compaction',
  ] as const) }),
})

function tool(name: string, value: string, options: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: `Conformance tool ${name}`,
    inputSchema: { type: 'object' },
    invoke: (_input, _context) => ({ value }),
    ...options,
  }
}

function descriptor(bridge: RuntimeHostBridge, name: string) {
  const value = bridge.snapshotTools().tools.find(candidate => candidate.name === name)
  if (value === undefined) throw new Error(`missing conformance descriptor ${name}`)
  return value
}

export function runtimeHostConformance(label: string, factory: RuntimeHostConformanceFactory): void {
  describe(`${label} Runtime Host conformance`, () => {
    it('isolates two sessions and preserves empty optional protocol behavior', async () => {
      const first = await factory.create({ sessionId: 'conformance-first', tools: true })
      const second = await factory.create({ sessionId: 'conformance-second', tools: true })
      first.registerSet('first-owner', [tool('first.read', 'first')])
      second.registerSet('second-owner', [tool('second.read', 'second')])
      expect(first.bridge.snapshotTools().tools.map(value => value.name)).toEqual(['first.read'])
      expect(second.bridge.snapshotTools().tools.map(value => value.name)).toEqual(['second.read'])
      await Promise.all([first.dispose(), second.dispose()])

      const empty = await factory.create({ context: false, tools: false })
      await expect(empty.bridge.resolveContext({
        requestId: 'empty-request',
        turn: { input: 'nothing' },
        tokenBudget: 10,
      })).resolves.toEqual({ content: '', contributions: [], omittedSources: [], tokenCount: 0 })
      expect(empty.bridge.snapshotTools()).toEqual({ revision: 'catalog:0', tools: [] })
      await empty.dispose()
    })

    it('rejects unknown capability fields before attachment', async () => {
      await expect(factory.create({
        capabilities: { ...FULL_CONFORMANCE_CAPABILITIES, features: ['native-hook'] },
      })).rejects.toThrow('unsupported fields')
    })

    it('commits owner replacements atomically and rejects stale descriptors', async () => {
      const session = await factory.create({ tools: true })
      const first = session.registerSet('first-owner', [tool('alpha.read', 'one')])
      session.registerSet('second-owner', [tool('beta.read', 'two')])
      const before = session.bridge.snapshotTools()
      const stale = descriptor(session.bridge, 'alpha.read')
      expect(() => first.replace([
        tool('replacement.read', 'replacement'),
        tool('beta.read', 'collision'),
      ])).toThrow('already registered')
      expect(session.bridge.snapshotTools()).toBe(before)

      first.replace([tool('alpha.read', 'updated')])
      expect(session.catalogChanges).toHaveLength(3)
      await expect(session.bridge.invokeTool({
        callId: 'stale-call',
        name: stale.name,
        toolRevision: stale.revision,
        input: {},
      })).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_REVISION_STALE' } })
      await session.dispose()
    })

    it('consumes exact approval grants once and rejects replay', async () => {
      const session = await factory.create({ tools: true })
      session.registerSet('approval-owner', [tool('approval.write', 'approved', {
        approval: { policy: 'required', reason: 'Confirm exact conformance mutation' },
      })])
      const current = descriptor(session.bridge, 'approval.write')
      const request = {
        callId: 'approved-call',
        name: current.name,
        toolRevision: current.revision,
        input: { exact: true },
      }
      const approval = {
        kind: 'one-shot' as const,
        grantId: 'conformance-grant',
        callId: request.callId,
        toolRevision: current.revision,
        inputDigest: digestToolInput(request.input),
      }
      await expect(session.bridge.invokeTool({ ...request, approval }))
        .resolves.toEqual({ ok: true, value: { value: 'approved' } })
      await expect(session.bridge.invokeTool({ ...request, callId: 'replay-call', approval }))
        .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_APPROVAL_INVALID' } })
      await session.dispose()
    })

    it('forwards cancellation without corrupting completed calls', async () => {
      const session = await factory.create({ tools: true })
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      session.registerSet('cancellation-owner', [
        tool('worker.wait', 'unused', {
          async invoke(_input, context) {
            started.resolve()
            await release.promise
            if (context.signal.aborted) throw context.signal.reason
            return { completed: true }
          },
        }),
        tool('worker.fast', 'fast'),
      ])
      const waiting = descriptor(session.bridge, 'worker.wait')
      const invocation = session.bridge.invokeTool({
        callId: 'waiting-call',
        name: waiting.name,
        toolRevision: waiting.revision,
        input: {},
      })
      await started.promise
      await expect(session.bridge.cancelTool({ callId: 'waiting-call', reason: 'native cancellation' }))
        .resolves.toEqual({ cancelled: true })
      release.resolve()
      await expect(invocation).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })

      const fast = descriptor(session.bridge, 'worker.fast')
      await expect(session.bridge.invokeTool({
        callId: 'fast-call',
        name: fast.name,
        toolRevision: fast.revision,
        input: {},
      })).resolves.toEqual({ ok: true, value: { value: 'fast' } })
      await expect(session.bridge.cancelTool({ callId: 'fast-call' })).resolves.toEqual({ cancelled: false })
      await session.dispose()
    })

    it('rejects undeclared lifecycle events and keeps actor identity independent', async () => {
      const restricted = await factory.create({
        capabilities: {
          ...FULL_CONFORMANCE_CAPABILITIES,
          lifecycle: { events: ['session-started'] },
        },
      })
      await expect(restricted.bridge.publishLifecycle({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-started',
        deliveryId: 'undeclared-delivery',
        sessionId: 'conformance-session',
        turnId: 'turn-one',
        timestamp: 1,
        principalInput: { value: 'input' },
      })).rejects.toThrow('not declared')
      await restricted.dispose()

      const absent = await factory.create({ actor: 'absent' })
      const unbound = await factory.create({ actor: 'unbound' })
      const bound = await factory.create({ actor: { actorId: 'actor-one' } })
      expect(absent.actorIdentity).toBeUndefined()
      expect(unbound.actorIdentity).toEqual({ state: 'unbound' })
      expect(bound.actorIdentity).toEqual({ state: 'bound', actorId: 'actor-one' })
      expect(absent.bridge.capabilities).toEqual(unbound.bridge.capabilities)
      expect(unbound.bridge.capabilities).toEqual(bound.bridge.capabilities)
      await Promise.all([absent.dispose(), unbound.dispose(), bound.dispose()])
    })

    it('aborts active work on disposal and suppresses late callbacks after binding replacement', async () => {
      const session = await factory.create({ tools: true })
      const started = Promise.withResolvers<void>()
      const registration = session.registerSet('dispose-owner', [tool('worker.dispose', 'unused', {
        invoke(_input, context) {
          started.resolve()
          return new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
          })
        },
      })])
      const current = descriptor(session.bridge, 'worker.dispose')
      const invocation = session.bridge.invokeTool({
        callId: 'dispose-call',
        name: current.name,
        toolRevision: current.revision,
        input: {},
      })
      await started.promise
      await session.dispose()
      await expect(invocation).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })

      const successor = await factory.create({ tools: true })
      successor.registerSet('successor-owner', [tool('worker.successor', 'current')])
      const oldChangeCount = session.catalogChanges.length
      const successorChangeCount = successor.catalogChanges.length
      expect(() => registration.replace([tool('worker.late', 'late')])).toThrow('disposed')
      expect(session.catalogChanges).toHaveLength(oldChangeCount)
      expect(successor.catalogChanges).toHaveLength(successorChangeCount)
      expect(successor.bridge.snapshotTools().tools.map(value => value.name)).toEqual(['worker.successor'])
      await successor.dispose()
    })
  })
}
