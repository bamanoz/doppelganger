import type { Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  HOST_EXTENSION_API_VERSION,
  createActorIdentityHostExtension,
  createHostExtensionCatalog,
  createRuntimeHostExtension,
  defineHostExtension,
  defineHostExtensionModule,
  readHostExtensionModule,
  type HostExtensionDefinition,
  type HostSessionFacts,
} from '../src/index.ts'

interface TestFacts extends HostSessionFacts {
  readonly hostKind: 'test'
  readonly actorId?: string
  readonly route: string
}

function definition(id: string, created: Plugin[]): HostExtensionDefinition<TestFacts> {
  return defineHostExtension({
    apiVersion: HOST_EXTENSION_API_VERSION,
    hostKind: 'test',
    id,
    normalizeConfig(input) {
      if (input === undefined) return null
      if (typeof input !== 'string') throw new TypeError(`${id} config must be a string`)
      return input.trim()
    },
    createFactory(config) {
      return context => {
        const plugin = { name: `${id}-${context.sessionId}-${String(config)}`, apply() {} }
        created.push(plugin)
        return { plugin }
      }
    },
  })
}

describe('Host Extension catalog', () => {
  it('builds an immutable available catalog and validates module exports', () => {
    const created: Plugin[] = []
    const beta = definition('beta', created)
    const alpha = definition('alpha', created)
    const catalog = createHostExtensionCatalog('test', [beta, alpha])

    expect(catalog.ids).toEqual(['alpha', 'beta'])
    expect(catalog.definitions.map(item => item.id)).toEqual(['alpha', 'beta'])
    expect(catalog.hostKind).toBe('test')
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.definitions)).toBe(true)
    expect(readHostExtensionModule(defineHostExtensionModule(alpha))).toBe(alpha)
    expect(() => readHostExtensionModule({})).toThrow('must export hostExtension')
    expect(() => defineHostExtension({ ...alpha, apiVersion: 2 as 1 })).toThrow('unsupported Host Extension API version 2')
    expect(() => createHostExtensionCatalog('test', [alpha, alpha])).toThrow('duplicate available Host Extension id "alpha"')
    expect(() => createHostExtensionCatalog('other', [alpha])).toThrow('targets host "test" instead of "other"')
  })

  it('resolves ordered normalized frozen selections and rejects ambiguity', () => {
    const created: Plugin[] = []
    const catalog = createHostExtensionCatalog('test', [definition('alpha', created), definition('beta', created)])
    const plan = catalog.plan([{ id: 'beta', config: '  B  ' }, { id: 'alpha' }])

    expect(plan.selections).toEqual([{ id: 'beta', config: 'B' }, { id: 'alpha', config: null }])
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.selections)).toBe(true)
    expect(() => catalog.plan([{ id: 'missing' }])).toThrow('unknown Host Extension id "missing"')
    expect(() => catalog.plan([{ id: 'alpha' }, { id: 'alpha' }])).toThrow('duplicate selected Host Extension id "alpha"')
  })

  it('provides factories only frozen closed session facts without host transport authority', () => {
    let observed: unknown
    const closed = defineHostExtension<TestFacts>({
      apiVersion: HOST_EXTENSION_API_VERSION,
      hostKind: 'test',
      id: 'closed',
      normalizeConfig: () => null,
      createFactory: () => context => {
        observed = context
        return { plugin: { name: 'closed-context', apply() {} } }
      },
    })
    createHostExtensionCatalog('test', [closed]).plan([{ id: 'closed' }]).instantiate({
      sessionId: 'closed-session',
      runtimePresetId: 'aiden',
      workspaceRoot: '/workspace/closed',
      facts: { hostKind: 'test', route: 'direct' },
    })

    expect(observed).toEqual({
      sessionId: 'closed-session',
      runtimePresetId: 'aiden',
      workspaceRoot: '/workspace/closed',
      facts: { hostKind: 'test', route: 'direct' },
    })
    expect(Object.isFrozen(observed)).toBe(true)
    expect(Object.isFrozen((observed as { readonly facts: unknown }).facts)).toBe(true)
    expect(observed).not.toHaveProperty('binding')
    expect(observed).not.toHaveProperty('transport')
    expect(observed).not.toHaveProperty('runtime')
  })

  it('instantiates fresh protected entries for each Runtime Session', () => {
    const created: Plugin[] = []
    const plan = createHostExtensionCatalog('test', [definition('alpha', created)]).plan([{ id: 'alpha', config: 'x' }])
    const firstFacts: TestFacts = { hostKind: 'test', route: 'one' }
    const first = plan.instantiate({
      sessionId: 'first',
      runtimePresetId: 'aiden',
      workspaceRoot: '/workspace/first',
      facts: firstFacts,
    })
    const second = plan.instantiate({
      sessionId: 'second',
      runtimePresetId: 'aiden',
      facts: { hostKind: 'test', route: 'two' },
    })

    expect(first.entries.map(entry => entry.id)).toEqual(['alpha'])
    expect(first.entries[0]?.plugin).not.toBe(second.entries[0]?.plugin)
    expect(created).toHaveLength(2)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.entries)).toBe(true)
    expect(Object.isFrozen(first.entries[0])).toBe(true)
    expect(Object.isFrozen(firstFacts)).toBe(false)
    expect(() => plan.instantiate({
      sessionId: 'wrong-host',
      runtimePresetId: 'aiden',
      facts: { hostKind: 'other', route: 'three' } as unknown as TestFacts,
    })).toThrow('session facts target host "other" instead of "test"')
  })

  it('rejects a factory that reuses mutable plugin state across sessions', () => {
    const shared: Plugin = { name: 'shared', apply() {} }
    const reusable = defineHostExtension<TestFacts>({
      apiVersion: HOST_EXTENSION_API_VERSION,
      hostKind: 'test',
      id: 'reusable',
      normalizeConfig: () => null,
      createFactory: () => () => ({ plugin: shared }),
    })
    const plan = createHostExtensionCatalog('test', [reusable]).plan([{ id: 'reusable' }])
    plan.instantiate({ sessionId: 'first', runtimePresetId: 'aiden', facts: { hostKind: 'test', route: 'one' } })

    expect(() => plan.instantiate({ sessionId: 'second', runtimePresetId: 'aiden', facts: { hostKind: 'test', route: 'two' } }))
      .toThrow('reused a plugin object across Runtime Sessions')
  })
})

describe('standard Host Extensions', () => {
  it('projects bound and unbound Actor Identity through the shared protocol', () => {
    const actor = createActorIdentityHostExtension<TestFacts>({ hostKind: 'test', actorId: context => context.facts.actorId })
    const plan = createHostExtensionCatalog('test', [actor]).plan([{ id: 'actor' }])
    const bound = plan.instantiate({
      sessionId: 'bound',
      runtimePresetId: 'aiden',
      facts: { hostKind: 'test', actorId: 'valera', route: 'direct' },
    })
    const unbound = plan.instantiate({
      sessionId: 'unbound',
      runtimePresetId: 'aiden',
      facts: { hostKind: 'test', route: 'direct' },
    })

    expect(bound.entries[0]?.id).toBe('actor')
    expect(bound.entries[0]?.plugin).not.toBe(unbound.entries[0]?.plugin)
    expect(bound.entries[0]?.isolate).toEqual({ doppelgangerActor: 'session' })
  })

  it('builds an actor-neutral Runtime Host bridge entry', () => {
    const binding = { attach() {}, detach() {}, toolCatalogChanged() {} }
    const runtimeHost = createRuntimeHostExtension<TestFacts>({
      hostKind: 'test',
      binding: () => binding,
      capabilities: () => ({
        protocolVersion: 2,
        context: { delivery: 'per-turn' },
        tools: { delivery: 'session-start', requiredApproval: true, cancellation: true },
        lifecycle: { events: [] },
      }),
    })
    const entry = createHostExtensionCatalog('test', [runtimeHost])
      .plan([{ id: 'runtime-host' }])
      .instantiate({ sessionId: 'bridge', runtimePresetId: 'aiden', facts: { hostKind: 'test', route: 'direct' } })
      .entries[0]

    expect(entry?.id).toBe('runtime-host')
    expect(entry?.isolate).toEqual({
      doppelgangerContext: 'session',
      doppelgangerHostCapabilities: 'session',
      doppelgangerLifecycle: 'session',
      doppelgangerRuntimeSession: 'session',
      doppelgangerTools: 'session',
    })
    const plugin = entry?.plugin
    if (plugin === undefined || typeof plugin !== 'object' || plugin === null) {
      throw new Error('Runtime Host extension did not create a Cordis object plugin')
    }
    expect('inject' in plugin).toBe(false)
  })
})
