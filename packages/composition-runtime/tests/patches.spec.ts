import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context, Plugin } from '@deepseek-ai/cordis'
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
  it('exposes every Mark feature as an independently patchable Loader row', async () => {
    const home = fileURLToPath(new URL('../../../dev/doppelganger', import.meta.url))
    const preset = await new RuntimePresetRoster({ home, includeShippedRoot: false }).resolve('mark')

    expect(preset.entries.map(entry => entry.id)).toEqual([
      'doppelganger-context',
      'doppelganger-tools',
      'doppelganger-persona',
      'doppelganger-persona-authoring',
      'doppelganger-sqlite',
      'doppelganger-memory',
      'doppelganger-embedding-local',
      'doppelganger-vectors-sqlite-exact',
      'doppelganger-memory-semantic',
    ])

    const effective = composeCompositionEntries(preset.entries, [layer('project', [
      { id: 'doppelganger-persona', config: { instanceId: 'patched', identity: { path: 'patched-identity.md' } } },
      { id: 'doppelganger-memory', disabled: true },
      { insert: [{ id: 'doppelganger-memory-capture', name: '@doppelganger/doppelganger-memory/capture' }] },
    ])])
    expect(effective.find(entry => entry.id === 'doppelganger-persona')?.config).toEqual({
      instanceId: 'patched',
      identity: { path: 'patched-identity.md' },
    })
    expect(effective.find(entry => entry.id === 'doppelganger-memory')?.disabled).toBe(true)
    expect(effective.at(-1)).toMatchObject({
      id: 'doppelganger-memory-capture',
      name: '@doppelganger/doppelganger-memory/capture',
    })
  })

  it('activates the checked-in Mark Runtime Preset through Loader interpolation', async () => {
    const home = fileURLToPath(new URL('../../../dev/doppelganger', import.meta.url))
    const preset = await new RuntimePresetRoster({ home, includeShippedRoot: false }).resolve('mark')

    const workspaceRoot = await mkdtemp(join(tmpdir(), 'doppelganger-mark-preset-'))
    temporaryRoots.push(workspaceRoot)
    const runtime = createCompositionRuntime({ watch: false })
    const hostActor: Plugin = {
      name: 'checked-in-mark-host-actor',
      apply(ctx: Context) {
        ctx.provide('doppelgangerActor', Object.freeze({ state: 'bound', actorId: 'integration-actor' }))
      },
    }
    try {
      const session = await runtime.activate({
        composition: createCompositionDefinition({
          id: preset.id,
          revision: preset.revision,
          loaderPath: preset.loaderPath,
        }),
        sessionId: 'checked-in-mark',
        workspaceRoot,
        runtimePlugins: { 'host-actor': hostActor },
        runtimePluginIsolation: { 'host-actor': ['doppelgangerActor'] },
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
