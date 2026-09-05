import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  HOST_CAPABILITIES_SERVICE,
  RUNTIME_HOST_PROTOCOL_VERSION,
  defineRuntimeHostCapabilities,
  provideRuntimeHostCapabilities,
} from '../src/index.ts'

const valid = () => ({
  protocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
  context: { delivery: 'per-turn' as const },
  tools: { delivery: 'dynamic' as const, requiredApproval: true, cancellation: true },
  lifecycle: { events: ['session-started', 'turn-committed'] as const },
})

describe('Runtime Host capabilities', () => {
  it('validates, deeply freezes, and provides the closed session capability value', async () => {
    const capabilities = defineRuntimeHostCapabilities(valid())
    expect(capabilities).toEqual(valid())
    expect(Object.isFrozen(capabilities)).toBe(true)
    expect(Object.isFrozen(capabilities.context)).toBe(true)
    expect(Object.isFrozen(capabilities.tools)).toBe(true)
    expect(Object.isFrozen(capabilities.lifecycle)).toBe(true)
    expect(Object.isFrozen(capabilities.lifecycle.events)).toBe(true)
    expect(defineRuntimeHostCapabilities({ ...valid(), context: { delivery: 'per-request' } }).context.delivery)
      .toBe('per-request')

    const context = new Context()
    const isolated = context.isolate(HOST_CAPABILITIES_SERVICE)
    await isolated.plugin({
      name: 'runtime-host-capabilities',
      apply(ctx) {
        provideRuntimeHostCapabilities(ctx, valid())
      },
    })
    expect(isolated.doppelgangerHostCapabilities).toEqual(capabilities)
    expect(context.get(HOST_CAPABILITIES_SERVICE)).toBeUndefined()
    await context.fiber.dispose()
  })

  it('rejects unknown, missing, malformed, duplicate, and unsupported version fields', () => {
    expect(() => defineRuntimeHostCapabilities({ ...valid(), features: ['native-hook'] }))
      .toThrow('contains unsupported fields: features')
    expect(() => defineRuntimeHostCapabilities({
      ...valid(),
      tools: { delivery: 'dynamic', requiredApproval: true },
    })).toThrow('is missing required fields: cancellation')
    expect(() => defineRuntimeHostCapabilities({
      ...valid(),
      context: { delivery: 'sometimes' },
    })).toThrow('context.delivery must be one of')
    expect(() => defineRuntimeHostCapabilities({
      ...valid(),
      lifecycle: { events: ['turn-committed', 'turn-committed'] },
    })).toThrow('must not contain duplicates')
    expect(() => defineRuntimeHostCapabilities({ ...valid(), protocolVersion: 3 }))
      .toThrow('unsupported Runtime Host protocol version 3')
  })

  it('rejects inherited object property names as lifecycle events', () => {
    for (const event of ['constructor', 'toString', '__proto__']) {
      expect(() => defineRuntimeHostCapabilities({
        ...valid(), lifecycle: { events: [event] },
      })).toThrow('is not a supported lifecycle event')
    }
  })

  it('rejects non-plain capability values without executing accessors or coercion hooks', () => {
    const getter = vi.fn(() => ({ delivery: 'per-turn' }))
    const withGetter = Object.defineProperty(valid(), 'context', { enumerable: true, get: getter })
    expect(() => defineRuntimeHostCapabilities(withGetter)).toThrow('accessor')
    expect(getter).not.toHaveBeenCalled()

    const coercion = vi.fn(() => valid())
    expect(() => defineRuntimeHostCapabilities({ ...valid(), toJSON: coercion })).toThrow('JSON-compatible')
    expect(coercion).not.toHaveBeenCalled()
  })
})
