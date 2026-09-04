import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve('.')
const temporaryRoots: string[] = []

interface BoundaryManifest {
  readonly packages: Record<string, { readonly directory: string; readonly dependencies: readonly string[] }>
}

interface PackedPackage {
  readonly filename: string
}

async function internalClosure(root: string): Promise<readonly string[]> {
  const boundaries = JSON.parse(await readFile(join(repositoryRoot, 'scripts', 'package-boundaries.json'), 'utf8')) as BoundaryManifest
  const pending = [root]
  const result = new Set<string>()
  while (pending.length > 0) {
    const name = pending.shift()!
    if (result.has(name)) continue
    result.add(name)
    const entry = boundaries.packages[name]
    if (entry === undefined) throw new Error(`missing package boundary for ${name}`)
    pending.push(...entry.dependencies)
  }
  return [...result].sort()
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('packed Evolution package', () => {
  it('installs into an external consumer, resolves the bare Loader export, stays inert until composed, and activates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-consumer-'))
    temporaryRoots.push(root)
    const packs = join(root, 'packs')
    const consumer = join(root, 'consumer')
    const home = join(root, 'home')
    await Promise.all([mkdir(packs), mkdir(consumer), mkdir(home)])

    const boundaries = JSON.parse(await readFile(join(repositoryRoot, 'scripts', 'package-boundaries.json'), 'utf8')) as BoundaryManifest
    const dependencies: Record<string, string> = {}
    for (const name of await internalClosure('@doppelganger/doppelganger-evolution')) {
      const directory = join(repositoryRoot, 'packages', boundaries.packages[name]!.directory)
      const { stdout } = await execFileAsync('npm', ['pack', directory, '--pack-destination', packs, '--json'], {
        cwd: repositoryRoot,
      })
      const packed = JSON.parse(stdout) as PackedPackage[]
      if (packed.length !== 1) throw new Error(`unexpected npm pack result for ${name}`)
      dependencies[name] = `file:${join(packs, packed[0]!.filename)}`
    }
    const { stdout: cordisPackOutput } = await execFileAsync('npm', [
      'pack', join(repositoryRoot, 'node_modules', '@deepseek-ai', 'cordis'), '--pack-destination', packs, '--json',
    ], { cwd: repositoryRoot })
    const cordisPack = JSON.parse(cordisPackOutput) as PackedPackage[]
    if (cordisPack.length !== 1) throw new Error('unexpected npm pack result for Cordis')
    dependencies['@deepseek-ai/cordis'] = `file:${join(packs, cordisPack[0]!.filename)}`
    const { stdout: typescriptPackOutput } = await execFileAsync('npm', [
      'pack', join(repositoryRoot, 'node_modules', 'typescript'), '--pack-destination', packs, '--json',
    ], { cwd: repositoryRoot })
    const typescriptPack = JSON.parse(typescriptPackOutput) as PackedPackage[]
    if (typescriptPack.length !== 1) throw new Error('unexpected npm pack result for TypeScript')
    dependencies.typescript = `file:${join(packs, typescriptPack[0]!.filename)}`

    await writeFile(join(consumer, 'package.json'), JSON.stringify({
      name: 'evolution-external-consumer',
      private: true,
      type: 'module',
      dependencies,
    }, null, 2))
    await execFileAsync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], {
      cwd: consumer,
      env: { ...process.env, npm_config_package_lock: 'false' },
    })

    const probe = join(consumer, 'probe.mjs')
    const loader = join(consumer, 'typescript-loader.mjs')
    await writeFile(loader, [
      "import { readFile } from 'node:fs/promises'",
      "import ts from 'typescript'",
      'export async function load(url, context, nextLoad) {',
      "  if (!url.endsWith('.ts')) return nextLoad(url, context)",
      "  const source = await readFile(new URL(url), 'utf8')",
      '  const transformed = ts.transpileModule(source, { compilerOptions: {',
      '    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024,',
      '    verbatimModuleSyntax: true, sourceMap: false, inlineSourceMap: false,',
      '  } })',
      "  return { format: 'module', shortCircuit: true, source: transformed.outputText }",
      '}',
      '',
    ].join('\n'))

    await writeFile(probe, [
      "import { Context } from '@deepseek-ai/cordis'",
      "import EvolutionPlugin from '@doppelganger/doppelganger-evolution'",
      "import { createRuntimeSessionMetadataPlugin } from '@doppelganger/doppelganger-composition-runtime'",
      "import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'",
      "import { createActorIdentityPlugin, ContextProtocolPlugin, ToolRegistryPlugin } from '@doppelganger/doppelganger-protocols'",
      "import SqlitePlugin from '@doppelganger/doppelganger-sqlite'",
      `const home = ${JSON.stringify(home)}`,
      'const inert = new Context()',
      "const inactiveBeforeComposition = inert.get('doppelgangerEvolution') === undefined",
      'await inert.fiber.dispose()',
      'const ctx = new Context()',
      "await ctx.plugin(createRuntimeSessionMetadataPlugin({ sessionId: 'consumer-session', runtimePresetId: 'consumer-preset', workspaceRoot: home })).await()",
      "await ctx.plugin(createActorIdentityPlugin('consumer-actor')).await()",
      "await ctx.plugin(createPersonaActivationPlugin({ instanceId: 'consumer-persona', sessionId: 'consumer-session', projectId: 'consumer-project', projectRoot: home })).await()",
      'await ctx.plugin(ContextProtocolPlugin).await()',
      'await ctx.plugin(ToolRegistryPlugin).await()',
      'await ctx.plugin(SqlitePlugin, { home }).await()',
      'await ctx.plugin(EvolutionPlugin, { remindersEnabled: false }).await()',
      "const serviceActive = ctx.get('doppelgangerEvolution') !== undefined",
      'const tools = ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)',
      'await ctx.fiber.dispose()',
      'process.stdout.write(JSON.stringify({ inactiveBeforeComposition, serviceActive, tools }))',
      '',
    ].join('\n'))
    const { stdout } = await execFileAsync(process.execPath, ['--no-warnings', '--experimental-loader', loader, probe], { cwd: consumer })
    expect(JSON.parse(stdout)).toEqual({
      inactiveBeforeComposition: true,
      serviceActive: true,
      tools: [
        'evolution.inspect', 'evolution.list', 'evolution.propose', 'evolution.reject',
        'evolution.reminder.record', 'evolution.snooze', 'evolution.transition',
      ],
    })
  }, 60_000)
})
