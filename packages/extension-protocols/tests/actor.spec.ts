import { Context, type Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  ACTOR_IDENTITY_SERVICE,
  createActorIdentity,
  createActorIdentityPlugin,
  type ActorIdentity,
} from '../src/index.ts'

describe('actor identity protocol', () => {
  it('validates and freezes bound and unbound identities', () => {
    const bound = createActorIdentity(' actor-one ')
    const unbound = createActorIdentity()

    expect(bound).toEqual({ state: 'bound', actorId: 'actor-one' })
    expect(unbound).toEqual({ state: 'unbound' })
    expect(Object.isFrozen(bound)).toBe(true)
    expect(Object.isFrozen(unbound)).toBe(true)
    expect(() => createActorIdentity(' ')).toThrow('actorId must be a non-empty string')
    expect(() => createActorIdentity(42)).toThrow('actorId must be a non-empty string')
  })

  it('isolates immutable actor bindings between concurrent sessions', async () => {
    const root = new Context()
    const firstSession = root.plugin({ name: 'actor-session-one', apply: () => undefined })
    const secondSession = root.plugin({ name: 'actor-session-two', apply: () => undefined })
    await Promise.all([firstSession.await(), secondSession.await()])
    const first = firstSession.ctx.isolate(ACTOR_IDENTITY_SERVICE)
    const second = secondSession.ctx.isolate(ACTOR_IDENTITY_SERVICE)
    await Promise.all([
      first.plugin(createActorIdentityPlugin('actor-one')),
      second.plugin(createActorIdentityPlugin('actor-two')),
    ])

    const observed: ActorIdentity[] = []
    const consumer = (name: string): Plugin => ({
      name,
      inject: [ACTOR_IDENTITY_SERVICE],
      apply(ctx) {
        observed.push(ctx.doppelgangerActor)
      },
    })
    await Promise.all([
      first.plugin(consumer('actor-consumer-one')),
      second.plugin(consumer('actor-consumer-two')),
    ])

    expect(observed).toEqual([
      { state: 'bound', actorId: 'actor-one' },
      { state: 'bound', actorId: 'actor-two' },
    ])
    expect(root.get(ACTOR_IDENTITY_SERVICE)).toBeUndefined()
    expect(observed.every(Object.isFrozen)).toBe(true)
    await Promise.all([firstSession.dispose(), secondSession.dispose()])
  })
})
