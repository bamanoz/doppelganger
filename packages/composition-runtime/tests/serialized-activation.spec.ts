import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defineSerializedCompositionActivation,
  type SerializedActivationResolver,
} from '../src/index.ts'

const loaderPath = join(process.cwd(), 'minimal-composition.yaml')

describe('serialized composition activation', () => {
  it('describes persona and non-persona compositions without host contracts', async () => {
    const persona = defineSerializedCompositionActivation({
      composition: {
        id: 'aiden',
        revision: 'one',
        loaderPath,
        imports: {
          persona: {
            module: '@doppelganger/extension-persona',
            exportName: 'createPersonaActivationPlugin',
            mode: 'factory',
          },
        },
        mounts: { persona: { required: true }, host: { required: true } },
      },
      sessionId: 'persona-session',
      mounts: {
        persona: {
          module: '@doppelganger/extension-persona',
          exportName: 'createPersonaActivationPlugin',
          mode: 'factory',
          config: { principalId: 'local-user' },
        },
      },
      hostMount: 'host',
    })
    const resolveMinimal: SerializedActivationResolver<{ readonly sessionId: string }> = request => (
      defineSerializedCompositionActivation({
        composition: {
          id: 'minimal',
          revision: 'one',
          loaderPath,
          imports: {},
          mounts: { host: { required: true } },
        },
        sessionId: request.sessionId,
        mounts: {},
        hostMount: 'host',
      })
    )

    const minimal = await resolveMinimal({ sessionId: 'minimal-session' })
    expect(persona).toMatchObject({
      composition: { id: 'aiden' },
      mounts: { persona: { mode: 'factory' } },
      hostMount: 'host',
    })
    expect(minimal).toMatchObject({
      composition: { id: 'minimal', imports: {} },
      sessionId: 'minimal-session',
      mounts: {},
      hostMount: 'host',
    })
    expect(Object.isFrozen(persona)).toBe(true)
  })
})
