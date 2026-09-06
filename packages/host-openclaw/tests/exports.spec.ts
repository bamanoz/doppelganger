import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { materializeOpenClawSourcePackageClosure } from './support/native-smoke-package-closure.ts'

const execFileAsync = promisify(execFile)
const hostPackageRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceModules = resolve(hostPackageRoot, '..', '..', 'node_modules')
const openClawLifecyclePaths = new Set([
  '.openclaw-lifecycle-pending',
  join('dist', 'openclaw-install-guard'),
])

function copyableOpenClawPeerPath(source: string, candidate: string): boolean {
  return !openClawLifecyclePaths.has(relative(source, candidate))
}


async function materializeOpenClawPeer(
  artifact: string,
  source = join(sourceModules, 'openclaw'),
): Promise<readonly string[]> {
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
    readonly dependencies?: Readonly<Record<string, string>>
    readonly optionalDependencies?: Readonly<Record<string, string>>
    readonly peerDependencies?: Readonly<Record<string, string>>
  }
  const destination = join(artifact, 'node_modules', 'openclaw')
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: candidate => copyableOpenClawPeerPath(source, candidate),
  })
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]
}


describe('host-openclaw public package entrypoints', () => {
  it('skips transient OpenClaw lifecycle markers while materializing the peer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-openclaw-peer-'))
    try {
      const source = join(root, 'source')
      const artifact = join(root, 'artifact')
      await mkdir(join(source, 'dist'), { recursive: true })
      await writeFile(join(source, 'package.json'), '{"name":"openclaw","dependencies":{}}\n')
      await symlink('removed-during-package-lifecycle', join(source, '.openclaw-lifecycle-pending'))
      await writeFile(join(source, 'dist', 'openclaw-install-guard'), 'pending\n')

      expect(await materializeOpenClawPeer(artifact, source)).toEqual([])
      await expect(readFile(join(artifact, 'node_modules', 'openclaw', '.openclaw-lifecycle-pending')))
        .rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(artifact, 'node_modules', 'openclaw', 'dist', 'openclaw-install-guard')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads the packaged plugin and preparation entrypoint with one Cordis root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-openclaw-exports-'))
    try {
      const artifact = join(root, 'artifact')
      await mkdir(artifact)
      const openClawDependencies = await materializeOpenClawPeer(artifact)
      await materializeOpenClawSourcePackageClosure({
        artifact,
        hostPackageRoot,
        seedPackages: [
          '@doppelganger/doppelganger-host-openclaw',
          '@deepseek-ai/cordis',
          ...openClawDependencies,
        ],
      })

      const hostLink = join(artifact, 'node_modules', '@doppelganger', 'doppelganger-host-openclaw')
      const hostLinkTarget = await readlink(hostLink)
      const artifactRealPath = await realpath(artifact)
      expect(await realpath(resolve(dirname(hostLink), hostLinkTarget))).toBe(join(
        artifactRealPath,
        'runtime-packages',
        '@doppelganger',
        'doppelganger-host-openclaw',
      ))

      const probe = join(artifact, 'probe.mjs')
      await writeFile(probe, [
        "import { createRequire } from 'node:module'",
        "import { fileURLToPath, pathToFileURL } from 'node:url'",
        "import { Context } from '@deepseek-ai/cordis'",
        "import * as publicHost from '@doppelganger/doppelganger-host-openclaw'",
        "import * as publicPlugin from '@doppelganger/doppelganger-host-openclaw/plugin'",
        "import * as publicPrepare from '@doppelganger/doppelganger-host-openclaw/prepare'",
        "const hostEntry = fileURLToPath(import.meta.resolve('@doppelganger/doppelganger-host-openclaw'))",
        "const compositionEntry = fileURLToPath(import.meta.resolve('@doppelganger/doppelganger-composition-runtime'))",
        "const rootCordis = fileURLToPath(import.meta.resolve('@deepseek-ai/cordis'))",
        "const openClawEntry = fileURLToPath(import.meta.resolve('openclaw/plugin-sdk/runtime-store'))",
        "const hostCordis = createRequire(pathToFileURL(hostEntry)).resolve('@deepseek-ai/cordis')",
        "const compositionCordis = createRequire(pathToFileURL(compositionEntry)).resolve('@deepseek-ai/cordis')",
        "const prepared = publicPrepare.prepareCatalog('empty', { revision: 'catalog:0', tools: [] })",
        "const plugin = publicPlugin.createOpenClawPlugin(prepared)",
        "const blockedPrivate = []",
        "for (const specifier of ['@doppelganger/doppelganger-host-openclaw/src/catalog.ts', '@doppelganger/doppelganger-host-openclaw/direct']) {",
        "  try { import.meta.resolve(specifier); blockedPrivate.push(false) } catch { blockedPrivate.push(true) }",
        "}",
        "process.stdout.write(JSON.stringify({",
        "  rootExportsPlugin: publicHost.createOpenClawPlugin === publicPlugin.createOpenClawPlugin,",
        "  rootExportsPreparation: publicHost.prepareOpenClawDeployment === publicPrepare.prepareOpenClawDeployment,",
        "  schemaIdentity: publicHost.OPENCLAW_CONFIG_SCHEMA === publicPlugin.OPENCLAW_PLUGIN_CONFIG_SCHEMA.jsonSchema,",
        "  preparationFunctions: ['prepareOpenClawDeployment', 'prepareCatalog', 'validatePreparedCatalog', 'projectCatalog'].every(name => typeof publicPrepare[name] === 'function'),",
        "  validated: publicPrepare.validatePreparedCatalog(JSON.parse(JSON.stringify(prepared))).fingerprint === prepared.fingerprint,",
        "  plugin: { id: plugin.id, hasRegister: typeof plugin.register === 'function' },",
        "  blockedPrivate,",
        "  oneCordisRoot: rootCordis === hostCordis && rootCordis === compositionCordis,",
        "  contextConstructs: new Context() instanceof Context,",
        "  resolved: { rootCordis, hostCordis, compositionCordis, hostEntry, openClawEntry },",
        "}))",
        '',
      ].join('\n'))

      const { stdout } = await execFileAsync(process.execPath, [probe], {
        cwd: artifact,
        env: { ...process.env, NODE_PATH: '' },
      })
      const result = JSON.parse(stdout) as {
        rootExportsPlugin: boolean
        rootExportsPreparation: boolean
        schemaIdentity: boolean
        preparationFunctions: boolean
        validated: boolean
        plugin: { id: string; hasRegister: boolean }
        blockedPrivate: boolean[]
        oneCordisRoot: boolean
        contextConstructs: boolean
        resolved: Record<string, string>
      }
      expect(result).toMatchObject({
        rootExportsPlugin: true,
        rootExportsPreparation: true,
        schemaIdentity: true,
        preparationFunctions: true,
        validated: true,
        plugin: { id: 'doppelganger', hasRegister: true },
        blockedPrivate: [true, true],
        oneCordisRoot: true,
        contextConstructs: true,
      })
      expect(Object.values(result.resolved).every(path => path.startsWith(artifactRealPath))).toBe(true)

      const cordisManifests = (await readdir(artifact, { recursive: true }))
        .filter(path => path.endsWith(join('@deepseek-ai', 'cordis', 'package.json')))
      expect(cordisManifests).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
