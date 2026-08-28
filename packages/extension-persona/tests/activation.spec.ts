import { join, resolve } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  PERSONA_ACTIVATION_SERVICE,
  createPersonaActivation,
  createPersonaActivationPlugin,
  type PersonaActivation,
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
      principalId: 'principal-one',
      sessionId: 'session-1',
      projectId: 'project-1',
      projectRoot: absolute('project'),
      instanceHome: absolute('home', 'personas', 'persona-aiden'),
      definitionRoot: absolute('definitions', 'aiden'),
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

    expect(observed).toEqual({ ...input, settings: {}, traits: [] })
    expect(Object.isFrozen(observed)).toBe(true)
    expect(root.get(PERSONA_ACTIVATION_SERVICE)).toBeUndefined()
    await session.dispose()
  })

  it('requires project identity and root as one unit', () => {
    const base = {
      instanceId: 'instance',
      principalId: 'principal-one',
      sessionId: 'session',
      instanceHome: absolute('home'),
      definitionRoot: absolute('definition'),
    }
    expect(() => createPersonaActivation({ ...base, projectId: 'project' }))
      .toThrow('projectId and projectRoot must either both be present or both be absent')
    expect(() => createPersonaActivation({ ...base, projectRoot: absolute('project') }))
      .toThrow('projectId and projectRoot must either both be present or both be absent')
    expect(() => createPersonaActivation({ ...base, principalId: ' ' }))
      .toThrow('principalId must be a non-empty string')
  })
})
