import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RuntimePresetRoster,
  SHIPPED_RUNTIME_PRESET_ROOT,
  STANDARD_RUNTIME_PRESET_ID,
  createRuntimePresetRoster,
  loadRuntimeUserConfig,
} from '../src/index.ts'
import {
  RUNTIME_PRESETS_SERVICE,
  RuntimePresetsPlugin,
} from '../src/plugin.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('shipped standard Runtime Preset', () => {
  it('is package-owned, healthy, actor-neutral, and selected by the standard deployment default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-standard-preset-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    await expect(access(home)).rejects.toMatchObject({ code: 'ENOENT' })
    const roster = createRuntimePresetRoster({ home })
    const selected = await roster.select()
    expect(selected).toMatchObject({
      source: 'deployment',
      preset: {
        id: STANDARD_RUNTIME_PRESET_ID,
        status: 'healthy',
        trust: 'system',
        name: 'Standard',
        directory: join(SHIPPED_RUNTIME_PRESET_ROOT, STANDARD_RUNTIME_PRESET_ID),
      },
    })
    const composition = await readFile(selected!.preset.loaderPath, 'utf8')
    await expect(loadRuntimeUserConfig(join(home, 'config.yaml'))).resolves.toEqual({ version: 1 })
    expect(await readFile(join(home, 'runtime.cordis.patch.yml'), 'utf8')).toContain('[]')
    await expect(readdir(join(home, '.runtime-presets'))).resolves.toEqual([])
    await expect(access(join(home, '.runtime-presets', STANDARD_RUNTIME_PRESET_ID))).rejects.toMatchObject({ code: 'ENOENT' })
    await Promise.all([
      writeFile(join(home, 'config.yaml'), '# user selection\nversion: 1\n'),
      writeFile(join(home, 'runtime.cordis.patch.yml'), '- id: custom\n  disabled: true\n'),
    ])
    await roster.select()
    expect(await readFile(join(home, 'config.yaml'), 'utf8')).toContain('# user selection')
    expect(await readFile(join(home, 'runtime.cordis.patch.yml'), 'utf8')).toContain('id: custom')
    const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      files?: string[]
      exports?: Record<string, unknown>
    }
    expect(packageManifest.files).toContain('presets')
    expect(packageManifest.exports).toHaveProperty('./plugin')
    expect(composition).toContain('@doppelganger/doppelganger-persona')
    expect(composition).not.toMatch(/\b(?:actorId|principalId)\b/u)
    expect(composition).not.toContain('@doppelganger/doppelganger-dynamic-runtime-plugins')
    expect(composition).not.toContain('@doppelganger/doppelganger-logging-file')
    expect(composition).not.toContain('@doppelganger/doppelganger-logging-sentry')
  })
})

describe('Cordis Runtime Preset facade', () => {
  it('provides the same roster API and removes it with the plugin fiber', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-roster-plugin-'))
    temporaryRoots.push(home)
    const context = new Context()
    const fiber = await context.plugin(RuntimePresetsPlugin, { home })
    expect(context.doppelgangerRuntimePresets).toBeInstanceOf(RuntimePresetRoster)
    await expect(context.doppelgangerRuntimePresets.resolve()).resolves.toMatchObject({
      id: STANDARD_RUNTIME_PRESET_ID,
      trust: 'system',
    })
    await fiber.dispose()
    expect((context as unknown as Record<string, unknown>)[RUNTIME_PRESETS_SERVICE]).toBeUndefined()
  })

  it('can explicitly disable the deployment default without changing roster semantics', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-roster-plugin-inactive-'))
    temporaryRoots.push(home)
    const context = new Context()
    const fiber = await context.plugin(RuntimePresetsPlugin, { home, defaultRuntimePreset: null })
    await expect(context.doppelgangerRuntimePresets.select()).resolves.toBeUndefined()
    expect((await context.doppelgangerRuntimePresets.list()).some(preset => preset.id === STANDARD_RUNTIME_PRESET_ID)).toBe(true)
    await fiber.dispose()
  })
})
