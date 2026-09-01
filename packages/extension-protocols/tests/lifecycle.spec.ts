import { Context, type Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  normalizeLifecycleEvent,
  serializeLifecycleValue,
  type LifecycleEvent,
} from '../src/index.ts'
import { createFakeLifecycleHost } from './support/lifecycle-host.ts'

const bounded = (value: unknown) => serializeLifecycleValue(value)
const base = (deliveryId: string) => ({
  protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
  deliveryId,
  sessionId: 'session-one',
  timestamp: 1,
})

describe('committed lifecycle protocol', () => {
  it('publishes versioned committed work with stable session, turn, call, and delivery identities', async () => {
    const context = new Context()
    const observations: LifecycleEvent[] = []
    const observer: Plugin = {
      name: 'portable-observer',
      apply(ctx) {
        ctx.on('doppelganger/session-started', event => { observations.push(event) })
        ctx.on('doppelganger/turn-started', event => { observations.push(event) })
        ctx.on('doppelganger/tool-completed', event => { observations.push(event) })
        ctx.on('doppelganger/turn-committed', event => { observations.push(event) })
      },
    }
    const host = createFakeLifecycleHost()
    await context.plugin(observer)
    await context.plugin(host.plugin)
    await host.publish({ ...base('session-started'), type: 'session-started' })
    await host.publish({
      ...base('turn-started'),
      type: 'turn-started',
      turnId: 'turn-one',
      principalInput: bounded('hello'),
    })
    await host.publish({
      ...base('tool-completed:call-one'),
      type: 'tool-completed',
      turnId: 'turn-one',
      callId: 'call-one',
      name: 'memory.search',
      outcome: 'failed',
      result: bounded({ partial: true }),
      error: { code: 'SEARCH_FAILED', message: 'search failed' },
    })
    const committed: LifecycleEvent = {
      ...base('turn-committed:turn-one'),
      type: 'turn-committed',
      turnId: 'turn-one',
      principalInput: bounded('hello'),
      assistantOutput: bounded('completed answer'),
      outcome: 'completed',
    }
    await host.publish(committed)
    await host.publish(committed)

    expect(observations.map(event => event.type)).toEqual([
      'session-started',
      'turn-started',
      'tool-completed',
      'turn-committed',
      'turn-committed',
    ])
    expect(observations.at(-1)).toEqual(observations.at(-2))
    expect(observations.at(2)).toMatchObject({
      deliveryId: 'tool-completed:call-one',
      sessionId: 'session-one',
      turnId: 'turn-one',
      callId: 'call-one',
      outcome: 'failed',
      result: { value: { partial: true } },
    })
    expect(Object.isFrozen(observations.at(2))).toBe(true)
    expect(observations.at(-1)).toMatchObject({
      deliveryId: 'turn-committed:turn-one',
      sessionId: 'session-one',
      turnId: 'turn-one',
      assistantOutput: { value: 'completed answer' },
      outcome: 'completed',
    })
    expect(observations.at(-1)).not.toHaveProperty('toolOutcomes')
    expect(Object.isFrozen(observations.at(-1))).toBe(true)
    await context.fiber.dispose()
  })

  it('rejects the prior lifecycle version and legacy turn outcome aggregates', () => {
    expect(() => normalizeLifecycleEvent({
      ...base('old-version'),
      protocolVersion: 1,
      type: 'session-started',
    } as unknown as LifecycleEvent)).toThrow('unsupported lifecycle protocol version 1')
    expect(() => normalizeLifecycleEvent({
      ...base('legacy-turn'),
      type: 'turn-committed',
      turnId: 'turn-one',
      principalInput: bounded('hello'),
      assistantOutput: bounded('completed answer'),
      toolOutcomes: [],
      outcome: 'completed',
    } as unknown as LifecycleEvent)).toThrow('turn-committed toolOutcomes is not supported')
  })

  it('serializes circular, binary, oversized, deep, and unsupported host values within explicit bounds', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const projection = serializeLifecycleValue({
      binary: Buffer.from([1, 2, 3]),
      circular,
      deep: { one: { two: { three: true } } },
      unsupported: Symbol('host'),
      long: 'x'.repeat(50),
    }, {
      maxBytes: 10_000,
      maxDepth: 3,
      maxEntries: 10,
      maxStringLength: 10,
    })
    expect(projection.value).toMatchObject({
      binary: null,
      circular: { self: null },
      deep: { one: { two: null } },
      unsupported: null,
      long: 'xxxxxxxxx…',
    })
    expect(projection.truncation?.reasons).toEqual(['binary', 'circular', 'depth', 'string', 'unsupported'])
    const oversized = serializeLifecycleValue({ content: 'too large' }, { maxBytes: 5 })
    expect(oversized).toMatchObject({
      value: null,
      truncation: { reasons: ['size'], originalBytes: expect.any(Number) },
    })
    expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBeLessThan(200)
  })

  it('contains subscriber failure while independent subscribers observe committed work', async () => {
    const context = new Context()
    const observed: string[] = []
    const diagnostics: string[] = []
    await context.plugin({
      name: 'failing-subscriber',
      apply(ctx) {
        ctx.on('doppelganger/turn-committed', () => { throw new Error('capture failed') })
      },
    })
    await context.plugin({
      name: 'independent-subscriber',
      apply(ctx) {
        ctx.on('doppelganger/turn-committed', event => { observed.push(event.deliveryId) })
        ctx.on('doppelganger/lifecycle-diagnostic', diagnostic => { diagnostics.push(diagnostic.code) })
      },
    })
    const host = createFakeLifecycleHost()
    await context.plugin(host.plugin)
    await expect(host.publish({
      ...base('committed-with-failure'),
      type: 'turn-committed',
      turnId: 'turn-one',
      principalInput: bounded('input'),
      assistantOutput: bounded('output'),
      outcome: 'completed',
    })).resolves.toBeUndefined()
    expect(observed).toEqual(['committed-with-failure'])
    expect(host.diagnostics).toEqual([expect.objectContaining({ code: 'LIFECYCLE_SUBSCRIBER_FAILED' })])
    expect(diagnostics).toEqual(['LIFECYCLE_SUBSCRIBER_FAILED'])
    await context.fiber.dispose()
  })

  it('keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct', async () => {
    const context = new Context()
    const events: LifecycleEvent[] = []
    await context.plugin({
      name: 'outcome-observer',
      apply(ctx) {
        ctx.on('doppelganger/turn-started', event => { events.push(event) })
        ctx.on('doppelganger/turn-committed', event => { events.push(event) })
        ctx.on('doppelganger/session-completed', event => { events.push(event) })
        ctx.on('doppelganger/session-disposed', event => { events.push(event) })
      },
    })
    const host = createFakeLifecycleHost()
    await context.plugin(host.plugin)
    await host.publish({ ...base('partial'), type: 'turn-started', turnId: 'turn-one', principalInput: bounded('partial') })
    for (const outcome of ['completed', 'failed', 'cancelled'] as const) {
      await host.publish({
        ...base(`commit:${outcome}`),
        type: 'turn-committed',
        turnId: `turn-${outcome}`,
        principalInput: bounded('input'),
        assistantOutput: bounded('output'),
        outcome,
        ...(outcome === 'failed' ? { error: { code: 'MODEL_FAILED', message: 'model failed' } } : {}),
      })
    }
    await host.publish({
      ...base('session-failed'),
      type: 'session-completed',
      outcome: 'failed',
      error: { code: 'SESSION_FAILED', message: 'session failed' },
    })
    await host.publish({ ...base('session-disposed'), type: 'session-disposed', reason: 'host teardown without outcome' })

    expect(events.map(event => event.type)).toEqual([
      'turn-started',
      'turn-committed',
      'turn-committed',
      'turn-committed',
      'session-completed',
      'session-disposed',
    ])
    expect(events.filter(event => event.type === 'turn-committed').map(event => event.outcome))
      .toEqual(['completed', 'failed', 'cancelled'])
    expect(events.at(-1)).not.toHaveProperty('outcome')
    await context.fiber.dispose()
  })
})
