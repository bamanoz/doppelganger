import type { Context } from '@deepseek-ai/cordis'
import { isLifecycleEventType, type LifecycleEvent } from './lifecycle.ts'
import { cloneJsonValue, type JsonValue } from './json-value.ts'

export const RUNTIME_HOST_PROTOCOL_VERSION = 2 as const
export const HOST_CAPABILITIES_SERVICE = 'doppelgangerHostCapabilities' as const
const CAPABILITY_JSON_LIMITS = Object.freeze({ maximumBytes: 32 * 1024, maximumDepth: 8 })

export type ContextDelivery = 'none' | 'session-start' | 'per-turn' | 'per-request'
export type ToolDelivery = 'none' | 'session-start' | 'dynamic'

export interface RuntimeHostCapabilities {
  readonly protocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION
  readonly context: {
    readonly delivery: ContextDelivery
  }
  readonly tools: {
    readonly delivery: ToolDelivery
    readonly requiredApproval: boolean
    readonly cancellation: boolean
  }
  readonly lifecycle: {
    readonly events: readonly LifecycleEvent['type'][]
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerHostCapabilities: RuntimeHostCapabilities
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const allowed = new Set(expected)
  const unknown = Object.keys(value).filter(key => !allowed.has(key)).sort()
  if (unknown.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unknown.join(', ')}`)
  const missing = expected.filter(key => !(key in value))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} must be one of ${allowed.map(item => JSON.stringify(item)).join(', ')}`)
  }
  return value as T
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

export function defineRuntimeHostCapabilities(input: unknown): RuntimeHostCapabilities {
  const root = object(
    cloneJsonValue<Record<string, JsonValue>>(input, 'runtime host capabilities', CAPABILITY_JSON_LIMITS),
    'runtime host capabilities',
  )
  exactKeys(root, ['protocolVersion', 'context', 'tools', 'lifecycle'], 'runtime host capabilities')
  if (root.protocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported Runtime Host protocol version ${String(root.protocolVersion)}`)
  }

  const context = object(root.context, 'runtime host capabilities.context')
  exactKeys(context, ['delivery'], 'runtime host capabilities.context')
  const tools = object(root.tools, 'runtime host capabilities.tools')
  exactKeys(tools, ['delivery', 'requiredApproval', 'cancellation'], 'runtime host capabilities.tools')
  const lifecycle = object(root.lifecycle, 'runtime host capabilities.lifecycle')
  exactKeys(lifecycle, ['events'], 'runtime host capabilities.lifecycle')
  if (!Array.isArray(lifecycle.events)) throw new TypeError('runtime host capabilities.lifecycle.events must be an array')

  const events = lifecycle.events.map((event, index) => {
    if (!isLifecycleEventType(event)) {
      throw new TypeError(`runtime host capabilities.lifecycle.events[${index}] is not a supported lifecycle event`)
    }
    return event
  })
  if (new Set(events).size !== events.length) {
    throw new TypeError('runtime host capabilities.lifecycle.events must not contain duplicates')
  }

  return Object.freeze({
    protocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    context: Object.freeze({
      delivery: enumValue(context.delivery, ['none', 'session-start', 'per-turn', 'per-request'], 'runtime host capabilities.context.delivery'),
    }),
    tools: Object.freeze({
      delivery: enumValue(tools.delivery, ['none', 'session-start', 'dynamic'], 'runtime host capabilities.tools.delivery'),
      requiredApproval: boolean(tools.requiredApproval, 'runtime host capabilities.tools.requiredApproval'),
      cancellation: boolean(tools.cancellation, 'runtime host capabilities.tools.cancellation'),
    }),
    lifecycle: Object.freeze({ events: Object.freeze(events) }),
  })
}

export function provideRuntimeHostCapabilities(ctx: Context, input: unknown): RuntimeHostCapabilities {
  const capabilities = defineRuntimeHostCapabilities(input)
  ctx.provide(HOST_CAPABILITIES_SERVICE, capabilities)
  return capabilities
}
