import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCompositionDefinition,
  defineSerializedCompositionActivation,
  type CompositionDefinitionInput,
  type SerializedActivationResolver,
} from '../src/index.ts'

const loaderPath = join(process.cwd(), 'runtime.cordis.yml')

describe('serialized composition activation', () => {
  it('describes only generic layered runtime inputs', async () => {
    const resolveMinimal: SerializedActivationResolver<{ readonly sessionId: string }> = request => (
      defineSerializedCompositionActivation({
        composition: {
          id: 'minimal',
          revision: 'digest',
          loaderPath,
          patches: [{
            source: 'host',
            baseUrl: process.cwd(),
            patches: [{ insert: [{ id: 'noop', name: './noop.mjs' }] }],
          }],
        },
        sessionId: request.sessionId,
        workspaceRoot: process.cwd(),
        hostKind: 'omp',
        watch: false,
      })
    )

    const minimal = await resolveMinimal({ sessionId: 'minimal-session' })
    expect(minimal).toMatchObject({
      composition: { id: 'minimal', revision: 'digest' },
      sessionId: 'minimal-session',
      workspaceRoot: process.cwd(),
      hostKind: 'omp',
      watch: false,
    })
    expect(minimal?.composition).not.toHaveProperty('imports')
    expect(minimal).not.toHaveProperty('mounts')
    expect(Object.isFrozen(minimal)).toBe(true)
    expect(Object.isFrozen(minimal?.composition.patches)).toBe(true)
  })

  it('canonicalizes equivalent direct and serialized composition inputs identically', () => {
    const filename = join(process.cwd(), 'patches', '..', 'project.patch.yml')
    const baseUrl = join(process.cwd(), 'assets', '..', 'runtime')
    const inlinePatches = [{ insert: [{ id: 'feature', name: './feature.mjs', config: { enabled: true } }] }]
    const patches = [
      { source: ' project file ', filename, optional: false },
      { source: ' host layer ', baseUrl, patches: inlinePatches },
    ] as const
    const direct = createCompositionDefinition({
      id: 'generic-preset',
      revision: ' revision-one ',
      loaderPath,
      patches,
    })
    const serialized = defineSerializedCompositionActivation({
      composition: {
        id: 'generic-preset',
        revision: ' revision-one ',
        loaderPath,
        patches,
      },
      sessionId: ' session-one ',
      hostKind: 'omp',
    })

    expect(serialized.composition).toEqual(direct)
    expect(serialized).not.toHaveProperty('workspaceRoot')
    expect(serialized).not.toHaveProperty('watch')
    expect(direct.patches[0]).toMatchObject({ optional: false })
    const inline = direct.patches[1]
    if (inline === undefined || !('patches' in inline)) throw new Error('inline patch was not canonicalized')
    expect(Object.isFrozen(inline.patches)).toBe(true)
    expect(Object.isFrozen(inline.patches[0])).toBe(true)
    expect(Object.isFrozen(inline.patches[0]?.insert?.[0]?.config)).toBe(true)
  })

  it.each<{ name: string; composition: CompositionDefinitionInput; diagnostic: string }>([
    {
      name: 'preset ID',
      composition: { id: 'Bad', revision: 'r', loaderPath },
      diagnostic: 'id must be a lowercase kebab-case Runtime Preset ID',
    },
    {
      name: 'Loader path',
      composition: { id: 'generic-preset', revision: 'r', loaderPath: './runtime.cordis.yml' },
      diagnostic: 'loaderPath must be absolute',
    },
    {
      name: 'Loader extension',
      composition: { id: 'generic-preset', revision: 'r', loaderPath: join(process.cwd(), 'runtime.txt') },
      diagnostic: 'loaderPath must name a .json, .yaml, or .yml Loader tree',
    },
    {
      name: 'file patch path',
      composition: {
        id: 'generic-preset',
        revision: 'r',
        loaderPath,
        patches: [{ source: 'file', filename: './patch.yml', optional: false }],
      },
      diagnostic: 'patches[0].filename must be absolute',
    },
    {
      name: 'inline patch base URL',
      composition: {
        id: 'generic-preset',
        revision: 'r',
        loaderPath,
        patches: [{ source: 'inline', baseUrl: './assets', patches: [] }],
      },
      diagnostic: 'patches[0].baseUrl must be absolute',
    },
  ])('preserves context-specific diagnostics for $name', ({ composition, diagnostic }) => {
    expect(() => createCompositionDefinition(composition)).toThrow(`composition.${diagnostic}`)
    expect(() => defineSerializedCompositionActivation({
      composition: { ...composition, patches: composition.patches ?? [] },
      sessionId: 'session',
      hostKind: 'omp',
    })).toThrow(`activation.composition.${diagnostic}`)
  })
  it('rejects non-absolute boundary paths and unknown hosts', () => {
    expect(() => defineSerializedCompositionActivation({
      composition: { id: 'x', revision: 'r', loaderPath: './relative.yml', patches: [] },
      sessionId: 'x',
      hostKind: 'omp',
    })).toThrow('loaderPath must be absolute')
  })
})
