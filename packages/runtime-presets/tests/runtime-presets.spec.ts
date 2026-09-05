import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RuntimeConfigurationError,
  RuntimePresetExistsError,
  RuntimePresetNotWritableError,
  RuntimePresetRoster,
  RuntimePresetSelectionError,
  loadRuntimeProjectManifest,
  loadRuntimeUserConfig,
  resolveDoppelgangerHome,
} from '../src/index.ts'

const temporaryRoots: string[] = []
const originalHome = process.env.DOPPELGANGER_HOME

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DOPPELGANGER_HOME
  else process.env.DOPPELGANGER_HOME = originalHome
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-runtime-presets-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'project')
  await Promise.all([
    mkdir(join(home, '.runtime-presets', 'alpha'), { recursive: true }),
    mkdir(join(home, '.runtime-presets', 'broken'), { recursive: true }),
    mkdir(join(home, '.runtime-presets', 'zeta'), { recursive: true }),
    mkdir(join(home, '.runtime-presets', 'Bad_Name'), { recursive: true }),
    mkdir(join(project, '.doppelganger'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(home, '.runtime-presets', 'alpha', 'runtime.cordis.yml'), '[]\n'),
    writeFile(join(home, '.runtime-presets', 'zeta', 'runtime.cordis.yml'), '- id: noop\n  name: ./noop.mjs\n'),
    writeFile(join(home, '.runtime-presets', 'zeta', 'noop.mjs'), 'export default { name: "noop", apply() {} }\n'),
    writeFile(join(home, '.runtime-presets', 'broken', 'runtime.cordis.yml'), '- insert: []\n'),
    writeFile(join(home, '.runtime-presets', 'Bad_Name', 'runtime.cordis.yml'), '[]\n'),
  ])
  return {
    root,
    home,
    project,
    userConfig: join(home, 'config.yaml'),
    manifest: join(project, '.doppelganger', 'manifest.yaml'),
    roster: new RuntimePresetRoster({ home, includeShippedRoot: false }),
  }
}

describe('Doppelganger home', () => {
  it('uses explicit, environment, and conventional paths in order', () => {
    process.env.DOPPELGANGER_HOME = './from-environment'
    expect(resolveDoppelgangerHome('./explicit')).toBe(resolve('./explicit'))
    expect(resolveDoppelgangerHome()).toBe(resolve('./from-environment'))
    process.env.DOPPELGANGER_HOME = '   '
    expect(resolveDoppelgangerHome()).toBe(resolve(homedir(), '.doppelganger'))
    expect(() => resolveDoppelgangerHome(' ')).toThrow('non-empty path')
  })
})

describe('runtime-owned selection documents', () => {
  it('loads strict optional user and project documents', async () => {
    const files = await fixture()
    await expect(loadRuntimeUserConfig(files.userConfig)).resolves.toEqual({ version: 1 })
    await expect(loadRuntimeProjectManifest(files.manifest)).resolves.toEqual({ version: 1 })
    await Promise.all([
      writeFile(files.userConfig, 'version: 1\ndefaultRuntimePreset: alpha\n'),
      writeFile(files.manifest, 'version: 1\nruntimePreset: zeta\n'),
    ])
    await expect(loadRuntimeUserConfig(files.userConfig)).resolves.toEqual({
      version: 1,
      defaultRuntimePreset: 'alpha',
    })
    await expect(loadRuntimeProjectManifest(files.manifest)).resolves.toEqual({
      version: 1,
      runtimePreset: 'zeta',
    })
  })

  it('rejects legacy and malformed fields with file-level diagnostics', async () => {
    const files = await fixture()
    await writeFile(files.userConfig, 'version: 1\nprincipalId: test-actor\ninstances: {}\n')
    await writeFile(files.manifest, 'version: 2\nprojectId: project\ninstanceId: test-persona\n')
    for (const [filename, paths] of [
      [files.userConfig, ['$.principalId', '$.instances']],
      [files.manifest, ['$.version', '$.projectId', '$.instanceId']],
    ] as const) {
      await expect(filename === files.userConfig
        ? loadRuntimeUserConfig(filename)
        : loadRuntimeProjectManifest(filename)).rejects.toMatchObject({
          filename: resolve(filename),
          diagnostics: expect.arrayContaining(paths.map(path => expect.objectContaining({ path }))),
        })
    }
    await expect(loadRuntimeUserConfig(files.userConfig)).rejects.toBeInstanceOf(RuntimeConfigurationError)
  })
})

describe('Runtime Preset roster', () => {
  it('discovers healthy and broken occupied IDs deterministically', async () => {
    const files = await fixture()
    const presets = await files.roster.list()
    expect(presets.map(preset => [preset.id, preset.status])).toEqual([
      ['alpha', 'healthy'],
      ['broken', 'broken'],
      ['zeta', 'healthy'],
    ])
    expect(presets[0]).toMatchObject({
      loaderPath: join(files.home, '.runtime-presets', 'alpha', 'runtime.cordis.yml'),
      entries: [],
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      trust: 'user',
    })
    expect(presets[1]).toMatchObject({
      diagnostics: expect.arrayContaining([expect.objectContaining({ path: '$[0].name' })]),
    })
  })

  it('validates bare package subpath exports without depending on process cwd', async () => {
    const files = await fixture()
    const packageDirectory = join(files.root, 'node_modules', 'runtime-export-fixture')
    const invalid = join(files.home, '.runtime-presets', 'invalid-export')
    await Promise.all([
      mkdir(packageDirectory, { recursive: true }),
      mkdir(invalid, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: 'runtime-export-fixture',
        type: 'module',
        exports: { '.': './index.mjs' },
      })),
      writeFile(join(packageDirectory, 'index.mjs'), 'export default {}\n'),
      writeFile(join(invalid, 'runtime.cordis.yml'), [
        '- id: invalid-export',
        '  name: runtime-export-fixture/not-exported',
        '',
      ].join('\n')),
    ])
    expect((await files.roster.list()).find(preset => preset.id === 'invalid-export')).toMatchObject({
      status: 'broken',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('is not exported') }),
      ]),
    })
  })

  it('marks nonexistent deep imports in packages without exports as broken', async () => {
    const files = await fixture()
    const packageDirectory = join(files.root, 'node_modules', 'legacy-runtime-fixture')
    const presetDirectory = join(files.home, '.runtime-presets', 'legacy-deep-import')
    await Promise.all([
      mkdir(packageDirectory, { recursive: true }),
      mkdir(presetDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'legacy-runtime-fixture', type: 'module', main: './index.mjs' })),
      writeFile(join(packageDirectory, 'index.mjs'), 'export default {}\n'),
      writeFile(join(presetDirectory, 'runtime.cordis.yml'), '- id: missing-deep\n  name: legacy-runtime-fixture/missing\n'),
    ])

    expect((await files.roster.list()).find(preset => preset.id === 'legacy-deep-import')).toMatchObject({
      status: 'broken',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('Cannot resolve Runtime Preset import') }),
      ]),
    })
  })

  it('validates bare package targets with Node resolution independent of process cwd', async () => {
    const files = await fixture()
    const packageDirectory = join(files.root, 'node_modules', 'node-resolvable-runtime-fixture')
    const presetDirectory = join(files.home, '.runtime-presets', 'node-resolvable')
    await Promise.all([
      mkdir(packageDirectory, { recursive: true }),
      mkdir(presetDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: 'node-resolvable-runtime-fixture',
        type: 'module',
        exports: { '.': './index.mjs', './feature': './feature.mjs' },
      })),
      writeFile(join(packageDirectory, 'index.mjs'), 'export default {}\n'),
      writeFile(join(packageDirectory, 'feature.mjs'), 'export default {}\n'),
      writeFile(join(presetDirectory, 'runtime.cordis.yml'), '- id: feature\n  name: node-resolvable-runtime-fixture/feature\n'),
    ])

    expect((await files.roster.list()).find(preset => preset.id === 'node-resolvable')).toMatchObject({
      status: 'healthy',
      entries: [{ id: 'feature', name: 'node-resolvable-runtime-fixture/feature' }],
    })
  })

  it('uses first-root-wins shadowing without falling through broken winners', async () => {
    const files = await fixture()
    const system = join(files.root, 'system')
    await mkdir(join(system, 'alpha'), { recursive: true })
    await writeFile(join(system, 'alpha', 'runtime.cordis.yml'), '- insert: []\n')
    const roster = new RuntimePresetRoster({
      home: files.home,
      includeShippedRoot: false,
      roots: [{ path: system, trust: 'system' }],
    })
    const alpha = (await roster.list()).find(preset => preset.id === 'alpha')
    expect(alpha).toMatchObject({ status: 'broken', trust: 'system', directory: join(system, 'alpha') })
    await expect(roster.resolve('alpha')).rejects.toMatchObject({ runtimePresetId: 'alpha' })
  })

  it('respects explicit root opt-outs and configured trust', async () => {
    const files = await fixture()
    const configured = join(files.root, 'configured')
    await mkdir(join(configured, 'configured-only'), { recursive: true })
    await writeFile(join(configured, 'configured-only', 'runtime.cordis.yml'), '[]\n')
    const roster = new RuntimePresetRoster({
      home: files.home,
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: configured, trust: 'system' }],
    })
    expect(await roster.list()).toMatchObject([{
      id: 'configured-only',
      trust: 'system',
      directory: join(configured, 'configured-only'),
    }])
  })

  it('keeps optional display metadata separate from composition health and revision', async () => {
    const files = await fixture()
    const directory = join(files.home, '.runtime-presets', 'alpha')
    const loaderPath = join(directory, 'runtime.cordis.yml')
    const initial = (await files.roster.list()).find(preset => preset.id === 'alpha')!
    expect(initial).toMatchObject({ name: 'alpha', status: 'healthy' })
    expect(initial.description).toBeUndefined()

    await writeFile(join(directory, 'preset.yml'), 'name: Alpha Runtime\ndescription: Portable test runtime.\n')
    const described = (await files.roster.list()).find(preset => preset.id === 'alpha')!
    expect(described).toMatchObject({
      name: 'Alpha Runtime',
      description: 'Portable test runtime.',
      status: 'healthy',
    })
    if (initial.status !== 'healthy' || described.status !== 'healthy') throw new Error('alpha should be healthy')
    expect(described.revision).toBe(initial.revision)

    await writeFile(join(directory, 'preset.yml'), '[invalid')
    expect((await files.roster.list()).find(preset => preset.id === 'alpha')).toMatchObject({
      name: 'alpha',
      status: 'healthy',
    })

    await writeFile(loaderPath, '[]\n# composition revision two\n')
    const changed = (await files.roster.list()).find(preset => preset.id === 'alpha')!
    if (changed.status !== 'healthy') throw new Error('alpha should remain healthy')
    expect(changed.revision).not.toBe(initial.revision)
  })

  it('applies explicit, project, user, deployment, and inactive precedence', async () => {
    const files = await fixture()
    await writeFile(files.userConfig, 'version: 1\ndefaultRuntimePreset: alpha\n')
    await writeFile(files.manifest, 'version: 1\nruntimePreset: zeta\n')
    await expect(files.roster.select({
      projectManifestPath: files.manifest,
      explicitRuntimePreset: 'alpha',
    })).resolves.toMatchObject({ source: 'explicit', preset: { id: 'alpha' } })
    await expect(files.roster.select({ projectManifestPath: files.manifest })).resolves.toMatchObject({
      source: 'project',
      preset: { id: 'zeta' },
    })
    await writeFile(files.manifest, 'version: 1\n')
    await expect(files.roster.select({ projectManifestPath: files.manifest })).resolves.toMatchObject({
      source: 'user',
      preset: { id: 'alpha' },
      projectPatchPath: join(files.project, '.doppelganger', 'runtime.cordis.patch.yml'),
    })
    await writeFile(files.userConfig, 'version: 1\n')
    await expect(files.roster.select()).resolves.toBeUndefined()
    await expect(new RuntimePresetRoster({
      home: files.home,
      includeShippedRoot: false,
      defaultRuntimePreset: 'zeta',
    }).select()).resolves.toMatchObject({ source: 'deployment', preset: { id: 'zeta' } })
  })

  it('explicit selection ignores malformed lower-precedence documents', async () => {
    const files = await fixture()
    await writeFile(files.userConfig, '[malformed')
    await writeFile(files.manifest, '[malformed')

    await expect(files.roster.select({
      projectManifestPath: files.manifest,
      explicitRuntimePreset: 'alpha',
    })).resolves.toMatchObject({ source: 'explicit', preset: { id: 'alpha' } })
  })

  it('project selection ignores malformed lower-precedence user configuration', async () => {
    const files = await fixture()
    await writeFile(files.userConfig, '[malformed')
    await writeFile(files.manifest, 'version: 1\nruntimePreset: zeta\n')

    await expect(files.roster.select({ projectManifestPath: files.manifest })).resolves.toMatchObject({
      source: 'project',
      preset: { id: 'zeta' },
    })
  })

  it('does not fall through from a missing or broken winner', async () => {
    const files = await fixture()
    await writeFile(files.userConfig, 'version: 1\ndefaultRuntimePreset: alpha\n')
    for (const explicitRuntimePreset of ['missing', 'broken']) {
      await expect(files.roster.select({ explicitRuntimePreset })).rejects.toMatchObject({
        runtimePresetId: explicitRuntimePreset,
        presets: expect.arrayContaining([expect.objectContaining({ id: 'alpha', status: 'healthy' })]),
      })
    }
    await expect(files.roster.select({ explicitRuntimePreset: 'missing' })).rejects.toBeInstanceOf(RuntimePresetSelectionError)
  })
})

describe('Runtime Preset authoring', () => {
  it('copies a complete tree into the first writable root and rewrites metadata', async () => {
    const files = await fixture()
    const system = join(files.root, 'system')
    const source = join(system, 'source')
    await mkdir(join(source, 'traits'), { recursive: true })
    await Promise.all([
      writeFile(join(source, 'runtime.cordis.yml'), '[]\n'),
      writeFile(join(source, 'preset.yml'), 'name: Source\ndescription: Preserved.\n'),
      writeFile(join(source, 'traits', 'one.md'), 'trait\n'),
      writeFile(join(source, 'asset.txt'), 'asset\n'),
    ])
    await symlink(join(source, 'asset.txt'), join(source, 'asset-link.txt'))
    const roster = new RuntimePresetRoster({
      home: files.home,
      includeShippedRoot: false,
      roots: [{ path: system, trust: 'system' }],
    })
    const destination = await roster.copy({ from: 'source', id: 'copy', name: 'My Copy' })
    await expect(readFile(join(destination, 'traits', 'one.md'), 'utf8')).resolves.toBe('trait\n')
    await expect(readFile(join(destination, 'asset-link.txt'), 'utf8')).resolves.toBe('asset\n')
    await expect(readFile(join(destination, 'preset.yml'), 'utf8')).resolves.toBe('name: My Copy\ndescription: Preserved.\n')
    await expect(roster.resolve('copy')).resolves.toMatchObject({ trust: 'user', name: 'My Copy' })
  })

  it('copies shipped standard to a new user identity in the first writable root', async () => {
    const files = await fixture()
    const writable = join(files.root, 'custom-user')
    const roster = new RuntimePresetRoster({
      home: files.home,
      roots: [{ path: writable, trust: 'user' }],
      includeUserRoot: false,
    })
    const destination = await roster.copy({ from: 'standard', id: 'standard-copy-test', name: 'Standard Copy Test' })
    expect(destination).toBe(join(writable, 'standard-copy-test'))
    await expect(readFile(join(destination, 'identity.md'), 'utf8')).resolves.toContain('durable personal and technical assistant')
    await expect(readFile(join(destination, 'traits', 'engineer.md'), 'utf8')).resolves.toContain('production engineer')
    await expect(readFile(join(destination, 'preset.yml'), 'utf8')).resolves.toBe(
      'name: Standard Copy Test\ndescription: Neutral personal and technical assistant with concise production-engineering guidance.\n',
    )
    await expect(roster.resolve('standard-copy-test')).resolves.toMatchObject({
      status: 'healthy',
      trust: 'user',
      name: 'Standard Copy Test',
    })
  })

  it('fails explicitly without a writable root', async () => {
    const files = await fixture()
    const roster = new RuntimePresetRoster({
      includeUserRoot: false,
      roots: [{ path: join(files.root, 'system'), trust: 'system' }],
    })
    expect(() => roster.writableRoot()).toThrow(RuntimePresetNotWritableError)
    await expect(roster.copy({ from: 'standard', id: 'copy' })).rejects.toBeInstanceOf(RuntimePresetNotWritableError)
  })

  it('never overwrites occupied IDs under concurrent copying', async () => {
    const files = await fixture()
    const results = await Promise.allSettled([
      files.roster.copy({ from: 'alpha', id: 'copy' }),
      files.roster.copy({ from: 'alpha', id: 'copy' }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(result => result.status === 'rejected')
    expect(rejection).toMatchObject({ reason: expect.any(RuntimePresetExistsError) })
  })

  it('rejects invalid and filesystem-occupied IDs and cleans failed staging trees', async () => {
    const files = await fixture()
    await expect(files.roster.copy({ from: 'alpha', id: '../escape' })).rejects.toMatchObject({
      code: 'INVALID_RUNTIME_PRESET_ID',
    })
    const occupied = join(files.home, '.runtime-presets', 'occupied')
    await mkdir(occupied, { recursive: true })
    await expect(files.roster.copy({ from: 'alpha', id: 'occupied' })).rejects.toBeInstanceOf(RuntimePresetExistsError)

    const source = join(files.home, '.runtime-presets', 'copy-source')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'runtime.cordis.yml'), '[]\n')
    await symlink(join(source, 'missing.txt'), join(source, 'broken-link.txt'))
    await expect(files.roster.copy({ from: 'copy-source', id: 'failed-copy' })).rejects.toBeDefined()
    expect((await readdir(join(files.home, '.runtime-presets'))).some(name => name.includes('failed-copy'))).toBe(false)
  })

  it('restricts removal to user-owned winners and clears their selected default', async () => {
    const files = await fixture()
    const system = join(files.root, 'system')
    await mkdir(join(system, 'system-only'), { recursive: true })
    await writeFile(join(system, 'system-only', 'runtime.cordis.yml'), '[]\n')
    const roster = new RuntimePresetRoster({
      home: files.home,
      includeShippedRoot: false,
      roots: [{ path: system, trust: 'system' }],
    })
    await expect(roster.remove('system-only')).rejects.toBeInstanceOf(RuntimePresetNotWritableError)
    await writeFile(files.userConfig, 'version: 1\ndefaultRuntimePreset: alpha\n')
    await roster.remove('alpha')
    await expect(loadRuntimeUserConfig(files.userConfig)).resolves.toEqual({ version: 1 })
    expect((await roster.list()).some(preset => preset.id === 'alpha')).toBe(false)
  })

  it('refuses presets owned by a later foreign user root', async () => {
    const files = await fixture()
    const owned = join(files.root, 'owned-user')
    const foreign = join(files.root, 'foreign-user')
    await mkdir(join(foreign, 'foreign'), { recursive: true })
    await writeFile(join(foreign, 'foreign', 'runtime.cordis.yml'), '[]\n')
    const roster = new RuntimePresetRoster({
      home: files.home,
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [
        { path: owned, trust: 'user' },
        { path: foreign, trust: 'user' },
      ],
    })
    await expect(roster.remove('foreign')).rejects.toBeInstanceOf(RuntimePresetNotWritableError)
    await expect(readFile(join(foreign, 'foreign', 'runtime.cordis.yml'), 'utf8')).resolves.toBe('[]\n')
  })
})
