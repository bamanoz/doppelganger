import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPackageBoundaries } from '../lib/package-boundaries.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(
  packages: Record<string, { directory: string; dependencies: string[]; declared?: string[]; source?: string }>,
  manifestOverride?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-boundaries-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'scripts'), { recursive: true })
  await mkdir(join(root, 'packages'), { recursive: true })
  const manifestPackages = Object.fromEntries(Object.entries(packages).map(([name, value]) => [name, {
    directory: value.directory,
    dependencies: value.dependencies,
  }]))
  await writeFile(join(root, 'scripts', 'package-boundaries.json'), JSON.stringify(
    manifestOverride ?? { version: 1, packages: manifestPackages },
    null,
    2,
  ))
  for (const [name, value] of Object.entries(packages)) {
    const packageRoot = join(root, 'packages', value.directory)
    await mkdir(join(packageRoot, 'src'), { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name,
      dependencies: Object.fromEntries((value.declared ?? []).map(dependency => [dependency, '0.0.0'])),
    }))
    await writeFile(join(packageRoot, 'src', 'index.ts'), value.source ?? 'export const value = 1\n')
  }
  return root
}

const base = {
  '@doppelganger/a': { directory: 'a', dependencies: ['@doppelganger/b'] },
  '@doppelganger/b': { directory: 'b', dependencies: [] },
}

describe('package boundary checker', () => {
  it('accepts manifest-declared dependency and source edges', async () => {
    const root = await fixture({
      ...base,
      '@doppelganger/a': {
        ...base['@doppelganger/a'],
        declared: ['@doppelganger/b'],
        source: "import { value } from '@doppelganger/b'\nexport { value }\n",
      },
    })
    await expect(checkPackageBoundaries(root)).resolves.toEqual([])
  })

  it('reports forbidden manifest and source edges', async () => {
    const root = await fixture({
      ...base,
      '@doppelganger/a': {
        directory: 'a',
        dependencies: [],
        declared: ['@doppelganger/b'],
        source: "export { value } from '@doppelganger/b'\n",
      },
    })
    await expect(checkPackageBoundaries(root)).resolves.toEqual([
      'a/package.json: forbidden dependencies edge @doppelganger/a -> @doppelganger/b',
      'packages/a/src/index.ts: forbidden source edge @doppelganger/a -> @doppelganger/b',
    ])
  })

  it('rejects an unregistered workspace package', async () => {
    const root = await fixture(base)
    await mkdir(join(root, 'packages', 'new-package'))
    await expect(checkPackageBoundaries(root)).resolves.toContain(
      'packages/new-package: workspace package is missing from boundary manifest',
    )
  })

  it('rejects malformed manifest data', async () => {
    const root = await fixture(base, { version: 2, packages: [] })
    await expect(checkPackageBoundaries(root)).resolves.toEqual([
      'boundary manifest: version must be 1',
      'boundary manifest: packages must be an object',
    ])
  })

  it('sorts diagnostics deterministically', async () => {
    const root = await fixture({
      '@doppelganger/a': {
        directory: 'a',
        dependencies: [],
        declared: ['@doppelganger/z', '@doppelganger/y'],
      },
    })
    const first = await checkPackageBoundaries(root)
    const second = await checkPackageBoundaries(root)
    expect(second).toEqual(first)
    expect(first).toEqual([...first].sort())
  })

  it('keeps product dependencies at the OMP package boundary', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package-boundaries.json', import.meta.url), 'utf8')) as {
      packages: Record<string, { dependencies: string[] }>
    }
    const hostManifest = JSON.parse(await readFile(
      new URL('../../packages/host-omp/package.json', import.meta.url),
      'utf8',
    )) as { dependencies: Record<string, string> }
    expect(manifest.packages['@doppelganger/doppelganger-host-omp']?.dependencies).toEqual([
      '@doppelganger/doppelganger-composition-runtime',
      '@doppelganger/doppelganger-protocols',
      '@doppelganger/doppelganger-runtime-presets',
    ])
    expect(manifest.packages['@doppelganger/doppelganger-omp']?.dependencies).toEqual([
      '@doppelganger/doppelganger-codegraph',
      '@doppelganger/doppelganger-dynamic-runtime-plugins',
      '@doppelganger/doppelganger-evolution',
      '@doppelganger/doppelganger-host-omp',
      '@doppelganger/doppelganger-persona',
      '@doppelganger/doppelganger-persona-authoring',
      '@doppelganger/doppelganger-protocols',
      '@doppelganger/doppelganger-runtime-presets',
    ])
    expect(Object.keys(hostManifest.dependencies).filter(name => name.startsWith('@doppelganger/')).sort()).toEqual([
      '@doppelganger/doppelganger-composition-runtime',
      '@doppelganger/doppelganger-protocols',
      '@doppelganger/doppelganger-runtime-presets',
    ])
  })
})
