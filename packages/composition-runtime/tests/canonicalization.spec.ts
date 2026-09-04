import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalAbsolutePath,
  canonicalNonEmpty,
  canonicalizeCompositionDefinition,
  createCompositionDefinition,
  type CompositionDefinitionInput,
} from '../src/index.ts'

const loaderPath = join(process.cwd(), 'runtime.cordis.yml')

describe('composition canonicalization', () => {
  it('exports host-neutral canonicalization with immutable optional-field omission', () => {
    const canonical = canonicalizeCompositionDefinition({
      id: 'generic-preset',
      revision: ' revision-one ',
      loaderPath,
    }, 'activation.composition')
    expect(canonical).toEqual({
      id: 'generic-preset',
      revision: 'revision-one',
      loaderPath,
      patches: [],
    })
    expect(Object.isFrozen(canonical)).toBe(true)
    expect(Object.isFrozen(canonical.patches)).toBe(true)
    expect(canonical).not.toHaveProperty('hostKind')
    expect(canonical).not.toHaveProperty('workspaceRoot')
  })

  it('canonicalizes equivalent direct and host-decoded composition inputs identically', () => {
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
    const decoded = canonicalizeCompositionDefinition({
      id: 'generic-preset',
      revision: ' revision-one ',
      loaderPath,
      patches,
    }, 'activation.composition')

    expect(decoded).toEqual(direct)
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
    expect(() => canonicalizeCompositionDefinition(composition, 'activation.composition'))
      .toThrow(`activation.composition.${diagnostic}`)
  })

  it('exports generic non-empty and absolute-path primitives without host policy', () => {
    expect(canonicalNonEmpty('field', ' value ')).toBe('value')
    expect(canonicalAbsolutePath('path', join(process.cwd(), 'a', '..', 'b'))).toBe(join(process.cwd(), 'b'))
    expect(() => canonicalAbsolutePath('path', './relative')).toThrow('path must be absolute')
  })
})
