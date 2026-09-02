import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimePresetRoster } from '@doppelganger/doppelganger-runtime-presets'
import {
  CompositionLayerError,
  composeCompositionEntries,
  createCompositionDefinition,
  createCompositionRuntime,
  defineCompositionPatchLayer,
  loadCompositionPatchFile,
} from '../src/index.ts'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function layer(source: string, patches: Parameters<typeof defineCompositionPatchLayer>[0]['patches']) {
  return defineCompositionPatchLayer({ source, baseUrl: '/tmp', patches })
}

async function fullStackTestPreset() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-full-stack-preset-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const directory = join(home, '.runtime-presets', 'full-stack-test')
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(join(directory, 'feature.mjs'), "export default { name: 'fixture-feature', apply() {} }\n"),
    writeFile(join(directory, 'runtime.cordis.yml'), [
      '- id: test-context',
      '  name: ./feature.mjs',
      '- id: test-persona',
      '  name: ./feature.mjs',
      '- id: test-storage',
      '  name: ./feature.mjs',
      '- id: test-memory',
      '  name: ./feature.mjs',
      '',
    ].join('\n')),
  ])
  return {
    root,
    preset: await new RuntimePresetRoster({ home, includeShippedRoot: false }).resolve('full-stack-test'),
  }
}

describe('native Cordis patch layers', () => {
  it('applies ordered whole-field replacement and later targets inserted rows', () => {
    const effective = composeCompositionEntries([{
      id: 'base',
      name: 'pkg-base',
      config: { retained: true, value: 'base' },
    }], [
      layer('user', [
        { id: 'base', config: { value: 'user' } },
        { insert: [{ id: 'added', name: 'pkg-added', config: { value: 1 } }] },
      ]),
      layer('project', [
        { id: 'base', config: { value: 'project' } },
        { id: 'added', config: { value: 2 } },
      ]),
    ])
    expect(effective).toEqual([
      { id: 'base', name: 'pkg-base', config: { value: 'project' } },
      { id: 'added', name: 'pkg-added', config: { value: 2 } },
    ])
  })
  it('exposes every test preset feature as an independently patchable Loader row', async () => {
    const { preset } = await fullStackTestPreset()

    expect(preset.entries.map(entry => entry.id)).toEqual([
      'test-context',
      'test-persona',
      'test-storage',
      'test-memory',
    ])

    const effective = composeCompositionEntries(preset.entries, [layer('project', [
      { id: 'test-persona', config: { instanceId: 'patched' } },
      { id: 'test-memory', disabled: true },
      { insert: [{ id: 'test-capture', name: './feature.mjs' }] },
    ])])
    expect(effective.find(entry => entry.id === 'test-persona')?.config).toEqual({ instanceId: 'patched' })
    expect(effective.find(entry => entry.id === 'test-memory')?.disabled).toBe(true)
    expect(effective.at(-1)).toMatchObject({ id: 'test-capture', name: pathToFileURL('/tmp/feature.mjs').href })
  })

  it('activates a generated test Runtime Preset through Loader interpolation', async () => {
    const { root, preset } = await fullStackTestPreset()
    const workspaceRoot = join(root, 'workspace')
    await mkdir(workspaceRoot)
    const runtime = createCompositionRuntime({ watch: false })
    try {
      const session = await runtime.activate({
        composition: createCompositionDefinition({
          id: preset.id,
          revision: preset.revision,
          loaderPath: preset.loaderPath,
        }),
        sessionId: 'generated-test-preset',
        workspaceRoot,
      })
      await session.dispose()
    } finally {
      await runtime.dispose()
    }
  })

  it('does not reindex children introduced by a config replacement', () => {
    expect(() => composeCompositionEntries([{
      id: 'group',
      name: 'cordis:group',
      group: true,
      config: [],
    }], [
      layer('one', [{ id: 'group', config: [{ id: 'child', name: 'pkg-child' }] }]),
      layer('two', [{ id: 'child', config: { value: 2 } }]),
    ])).toThrow('target entry "child" was not produced by earlier layers')
  })

  it('fails loud on absent targets, non-group inserts, and name mismatches', () => {
    const base = [{ id: 'base', name: 'pkg-base' }]
    for (const patches of [
      [{ id: 'missing', config: {} }],
      [{ id: 'base', insert: [{ id: 'child', name: 'pkg-child' }] }],
      [{ id: 'base', name: 'other', config: {} }],
    ]) {
      expect(() => composeCompositionEntries(base, [layer('project', patches)]))
        .toThrow(CompositionLayerError)
    }
  })

  it('rejects malformed patches and runtime-reserved caller identities', () => {
    expect(() => layer('bad', [{}])).toThrow('id: is required')
    expect(() => layer('bad', [{ insert: [{ id: 'doppelganger-runtime-host', name: 'pkg' }] }]))
      .toThrow('reserved prefix')
    expect(() => composeCompositionEntries([
      { id: 'caller', name: 'cordis:doppelganger-runtime-host' },
    ], [])).toThrow('reserved import prefix')
  })

  it('loads optional files, rejects empty documents, and anchors only inserted relative names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-patches-'))
    temporaryRoots.push(root)
    const filename = join(root, 'runtime.cordis.patch.yml')
    await expect(loadCompositionPatchFile({ source: 'optional', filename, optional: true })).resolves.toBeUndefined()
    await writeFile(filename, '')
    await expect(loadCompositionPatchFile({ source: 'project', filename, optional: false }))
      .rejects.toThrow('use [] for no patches')
    await writeFile(filename, [
      '- id: base',
      '  name: ./assertion.mjs',
      '  config: { value: target }',
      '- insert:',
      '    - id: relative',
      '      name: ./plugin.mjs',
      '    - id: package',
      '      name: package-name',
    ].join('\n'))
    const loaded = await loadCompositionPatchFile({ source: 'project', filename, optional: false })
    expect(loaded?.patches[0]?.name).toBe('./assertion.mjs')
    expect(loaded?.patches[1]?.insert?.[0]?.name).toBe(pathToFileURL(join(root, 'plugin.mjs')).href)
    expect(loaded?.patches[1]?.insert?.[1]?.name).toBe('package-name')
  })
})
