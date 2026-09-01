import { join, resolve } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createRuntimeSessionMetadataPlugin } from '@doppelganger/doppelganger-composition-runtime'
import {
  ACTOR_IDENTITY_SERVICE,
  ContextProtocol,
  createActorIdentityPlugin,
} from '@doppelganger/doppelganger-protocols'
import { describe, expect, it } from 'vitest'
import {
  PERSONA_ACTIVATION_SERVICE,
  PersonaPlugin,
  createPersonaActivation,
  createPersonaActivationPlugin,
  type PersonaActivation,
  type PersonaPluginConfig,
} from '../src/index.ts'

const absolute = (...parts: string[]): string => resolve(join(...parts))


describe('persona activation metadata', () => {
  it('provides an immutable session-scoped metadata service', async () => {
    const root = new Context()
    const session = root.plugin({ name: 'metadata-session', apply: () => undefined })
    await session.await()
    const sessionContext = session.ctx.isolate(PERSONA_ACTIVATION_SERVICE)
    const input = {
      instanceId: 'persona-aiden',
      sessionId: 'session-1',
      projectId: 'project-1',
      projectRoot: absolute('project'),
    }
    await sessionContext.plugin(createPersonaActivationPlugin(input))

    let observed: PersonaActivation | undefined
    const consumer: Plugin = {
      name: 'metadata-consumer',
      inject: [PERSONA_ACTIVATION_SERVICE],
      apply(ctx) {
        observed = ctx.doppelgangerPersona
      },
    }
    await sessionContext.plugin(consumer)

    expect(observed).toEqual({ ...input, traits: [] })
    expect(Object.isFrozen(observed)).toBe(true)
    expect(root.get(PERSONA_ACTIVATION_SERVICE)).toBeUndefined()
    await session.dispose()
  })

  it('requires project identity and root as one unit', () => {
    const base = {
      instanceId: 'instance',
      sessionId: 'session',
    }
    expect(() => createPersonaActivation({ ...base, projectId: 'project' }))
      .toThrow('projectId and projectRoot must either both be present or both be absent')
    expect(() => createPersonaActivation({ ...base, projectRoot: absolute('project') }))
      .toThrow('projectId and projectRoot must either both be present or both be absent')
    expect(() => createPersonaActivation({ ...base, instanceId: ' ' }))
      .toThrow('instanceId must be a non-empty string')
  })

  it('rejects obsolete and unsupported Persona configuration fields', async () => {
    const context = new Context()
    await context.plugin(createRuntimeSessionMetadataPlugin({
      sessionId: 'strict-session', runtimePresetId: 'strict-persona',
    })).await()
    await context.plugin(ContextProtocol).await()

    const legacy = context.plugin(PersonaPlugin, {
      instanceId: 'persona-aiden', principalId: 'legacy-user',
    } as unknown as PersonaPluginConfig)
    await expect(legacy.await()).rejects.toThrow('persona.principalId is not supported')

    const unsupported = context.plugin(PersonaPlugin, {
      instanceId: 'persona-aiden', unsupported: true,
    } as unknown as PersonaPluginConfig)
    await expect(unsupported.await()).rejects.toThrow('persona.unsupported is not supported')
    await context.fiber.dispose()
  })

  it('reuses unchanged Persona metadata across separate actor bindings', async () => {
    const root = new Context()
    const sessions = ['one', 'two'].map(name => root.plugin({
      name: `persona-actor-session-${name}`, apply: () => undefined,
    }))
    await Promise.all(sessions.map(session => session.await()))
    const contexts = sessions.map(session => (
      session.ctx.isolate(ACTOR_IDENTITY_SERVICE).isolate(PERSONA_ACTIVATION_SERVICE)
    ))
    const input = { instanceId: 'persona-aiden', sessionId: 'persona-session' }
    await Promise.all([
      contexts[0]!.plugin(createActorIdentityPlugin('actor-one')),
      contexts[0]!.plugin(createPersonaActivationPlugin(input)),
      contexts[1]!.plugin(createActorIdentityPlugin('actor-two')),
      contexts[1]!.plugin(createPersonaActivationPlugin(input)),
    ])

    const personas = contexts.map(context => context.get(PERSONA_ACTIVATION_SERVICE) as PersonaActivation)
    const actors = contexts.map(context => context.get(ACTOR_IDENTITY_SERVICE))
    expect(personas[0]).toEqual(personas[1])
    expect(personas[0]).not.toHaveProperty('actorId')
    expect(personas[0]).not.toHaveProperty('principalId')
    expect(actors).toEqual([
      { state: 'bound', actorId: 'actor-one' },
      { state: 'bound', actorId: 'actor-two' },
    ])
    await Promise.all(sessions.map(session => session.dispose()))
  })
})
