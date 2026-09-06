import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { runPrepareCli } from '../src/cli.ts'
import { prepareOpenClawDeployment, validatePreparedCatalog } from '../src/prepare.ts'
import {
  createOpenClawHostExtensionRuntime,
  validatePreparedOpenClawHostExtensions,
  type OpenClawHostExtensionConfiguration,
} from '../src/host-extensions.ts'
import { OPENCLAW_RUNTIME_HOST_CAPABILITIES } from '../src/direct.ts'

const temporaryRoots: string[] = []
const toolsPlugin = fileURLToPath(new URL('../../extension-protocols/src/tools-plugin.ts', import.meta.url))
const mcpPlugin = fileURLToPath(new URL('../../extension-mcp/src/plugin.ts', import.meta.url))
const mcpServer = fileURLToPath(new URL('../../extension-mcp/tests/fixtures/stdio-server.mjs', import.meta.url))
const execFileAsync = promisify(execFile)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface PresetFixture {
  readonly root: string
  readonly home: string
  readonly systemRoot: string
  readonly presetDirectory: string
  readonly output: string
  readonly cleanupMarker: string
}

async function fixture(entries: readonly unknown[]): Promise<PresetFixture> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-openclaw-prepare-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const systemRoot = join(root, 'system')
  const presetDirectory = join(systemRoot, 'prepared')
  const output = join(root, 'generated-plugin')
  const cleanupMarker = join(root, 'disposed.txt')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(presetDirectory, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(home, 'config.yaml'), 'version: 1\n'),
    writeFile(join(home, 'runtime.cordis.patch.yml'), '[]\n'),
    writeFile(join(presetDirectory, 'preset.yml'), 'name: Prepared test\n'),
    writeFile(join(presetDirectory, 'runtime.cordis.yml'), JSON.stringify(entries, null, 2)),
  ])
  return { root, home, systemRoot, presetDirectory, output, cleanupMarker }
}

async function toolFixture(options: { readonly invalidSchema?: boolean; readonly expectedActor?: string } = {}): Promise<PresetFixture> {
  const pending = await fixture([])
  const featurePath = join(pending.presetDirectory, 'fixture-tools.mjs')
  await writeFile(featurePath, [
    "import { appendFile } from 'node:fs/promises'",
    'export default {',
    "  name: 'prepared-tools-fixture',",
    options.expectedActor === undefined
      ? "  inject: ['doppelgangerTools'],"
      : "  inject: ['doppelgangerTools', 'doppelgangerActor'],",
    '  apply(ctx, config) {',
    ...(options.expectedActor === undefined
      ? []
      : [`    if (ctx.doppelgangerActor?.state !== 'bound' || ctx.doppelgangerActor.actorId !== ${JSON.stringify(options.expectedActor)}) throw new Error('expected bound preparation actor')`]),
    "    const registration = ctx.doppelgangerTools.registerSet('prepared-tools', [{",
    "      name: 'fixture.echo-value',",
    "      label: 'Echo value',",
    "      description: 'Returns one supplied value.',",
    options.invalidSchema
      ? "      inputSchema: { type: 'object', properties: { value: { $dynamicRef: '#value' } } },"
      : "      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },",
    "      approval: { policy: 'required', reason: 'Echo the value once' },",
    '      invoke(input) { return input },',
    '    }])',
    '    ctx.effect(() => async () => {',
    '      await registration.dispose()',
    "      await appendFile(config.cleanupMarker, 'disposed\\n')",
    '    })',
    '  },',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(pending.presetDirectory, 'runtime.cordis.yml'), JSON.stringify([
    { id: 'tools', name: toolsPlugin, isolate: { doppelgangerTools: 'session' } },
    {
      id: 'fixture-tools',
      name: featurePath,
      inject: options.expectedActor === undefined ? ['doppelgangerTools'] : ['doppelgangerTools', 'doppelgangerActor'],
      isolate: options.expectedActor === undefined
        ? { doppelgangerTools: 'session' }
        : { doppelgangerTools: 'session', doppelgangerActor: 'session' },
      config: { cleanupMarker: pending.cleanupMarker },
    },
  ], null, 2))
  return pending
}

function prepare(fixture: PresetFixture, hostExtensions?: OpenClawHostExtensionConfiguration) {
  return prepareOpenClawDeployment({
    output: fixture.output,
    explicitRuntimePreset: 'prepared',
    roster: {
      home: fixture.home,
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: fixture.systemRoot, trust: 'system' }],
    },
    workspaceRoot: fixture.root,
    ...(hostExtensions === undefined ? {} : { hostExtensions }),
  })
}

describe('OpenClaw deployment preparation', () => {
  it('prepares exact native declarations from an audited catalog', async () => {
    const files = await toolFixture()
    const authoredBefore = await Promise.all([
      readFile(join(files.home, 'config.yaml'), 'utf8'),
      readFile(join(files.home, 'runtime.cordis.patch.yml'), 'utf8'),
      readFile(join(files.presetDirectory, 'runtime.cordis.yml'), 'utf8'),
    ])

    const result = await prepare(files)
    const [packageJson, manifest, prepared, wrapper, cleanup] = await Promise.all([
      readFile(join(files.output, 'package.json'), 'utf8').then(JSON.parse),
      readFile(join(files.output, 'openclaw.plugin.json'), 'utf8').then(JSON.parse),
      readFile(join(files.output, 'prepared-catalog.json'), 'utf8').then(JSON.parse),
      readFile(join(files.output, 'index.js'), 'utf8'),
      readFile(files.cleanupMarker, 'utf8'),
    ])

    expect(validatePreparedCatalog(prepared)).toEqual(result.catalog)
    expect(manifest.contracts.tools).toEqual(['dg_fixture__echo-value'])
    expect(manifest.configSchema).toEqual(expect.objectContaining({ type: 'object', additionalProperties: false }))
    expect(packageJson.openclaw.extensions).toEqual(['./index.js'])
    expect(wrapper).toContain('@doppelganger/doppelganger-host-openclaw/plugin')
    expect(wrapper).toContain('@doppelganger/doppelganger-host-openclaw/prepare')
    expect(cleanup).toBe('disposed\n')
    expect(JSON.stringify(prepared)).not.toContain('revision')
    await expect(Promise.all([
      readFile(join(files.home, 'config.yaml'), 'utf8'),
      readFile(join(files.home, 'runtime.cordis.patch.yml'), 'utf8'),
      readFile(join(files.presetDirectory, 'runtime.cordis.yml'), 'utf8'),
    ])).resolves.toEqual(authoredBefore)
  })

  it('publishes a valid empty composition without inventing native tools', async () => {
    const files = await fixture([])
    const result = await prepare(files)
    expect(result.catalog.tools).toEqual([])
    await expect(readFile(join(files.output, 'openclaw.plugin.json'), 'utf8').then(JSON.parse))
      .resolves.toMatchObject({ contracts: { tools: [] } })
  })

  it('bundles prepared Host Extension modules with separate validated metadata', async () => {
    const files = await fixture([])
    const modulePath = join(files.root, 'fixture-host-extension.mjs')
    await writeFile(modulePath, [
      'export const hostExtension = {',
      '  apiVersion: 1,',
      "  hostKind: 'openclaw',",
      "  id: 'fixture-host',",
      '  normalizeConfig(input) { return { label: input.label.trim() } },',
      '  createFactory(config) {',
      '    return context => ({ plugin: { name: `fixture-${context.sessionId}-${config.label}`, apply() {} } })',
      '  },',
      '}',
    ].join('\n'))
    const result = await prepare(files, {
      modules: [modulePath],
      enabled: [
        { id: 'actor' },
        { id: 'fixture-host', config: { label: ' bundled ' } },
        { id: 'runtime-host' },
      ],
    })
    const [metadata, bundle, wrapper, packageJson, preparedCatalog] = await Promise.all([
      readFile(join(files.output, 'prepared-host-extensions.json'), 'utf8').then(JSON.parse),
      readFile(join(files.output, 'host-extensions', '000-fixture-host.js'), 'utf8'),
      readFile(join(files.output, 'index.js'), 'utf8'),
      readFile(join(files.output, 'package.json'), 'utf8').then(JSON.parse),
      readFile(join(files.output, 'prepared-catalog.json'), 'utf8'),
    ])

    expect(validatePreparedOpenClawHostExtensions(metadata)).toEqual(result.hostExtensions)
    expect(metadata.defaultSelection).toEqual([
      { id: 'actor', config: null },
      { id: 'fixture-host', config: { label: 'bundled' } },
      { id: 'runtime-host', config: null },
    ])
    expect(bundle).toContain('fixture-host')
    expect(wrapper).toContain("import * as hostExtension0 from \"./host-extensions/000-fixture-host.js\"")
    expect(wrapper).toContain('createOpenClawPlugin(prepared, hostExtensions)')
    expect(packageJson.files).toContain('host-extensions')
    expect(preparedCatalog).not.toContain('fixture-host')
    const imported = await import(`${pathToFileURL(join(files.output, 'host-extensions', '000-fixture-host.js')).href}?test=${Date.now()}`)
    const runtime = createOpenClawHostExtensionRuntime(metadata, [imported])
    const plan = runtime.plan({
      binding: { attach() {}, detach() {}, toolCatalogChanged() {} },
      capabilities: OPENCLAW_RUNTIME_HOST_CAPABILITIES,
      resolveActor: () => 'runtime-actor',
    })
    const first = plan.instantiate({
      sessionId: 'first',
      runtimePresetId: 'prepared',
      workspaceRoot: files.root,
      facts: {
        hostKind: 'openclaw', agentId: 'main', sessionKey: 'route', sessionId: 'first', workspaceRoot: files.root,
      },
    })
    const second = plan.instantiate({
      sessionId: 'second',
      runtimePresetId: 'prepared',
      workspaceRoot: files.root,
      facts: {
        hostKind: 'openclaw', agentId: 'main', sessionKey: 'route', sessionId: 'second', workspaceRoot: files.root,
      },
    })
    expect(first.entries.map(entry => entry.id)).toEqual(['actor', 'fixture-host', 'runtime-host'])
    expect(first.entries[1]?.plugin).not.toBe(second.entries[1]?.plugin)
  })

  it('rejects unrepresentable tool contracts without replacing prior output', async () => {
    const files = await toolFixture({ invalidSchema: true })
    await mkdir(files.output)
    await writeFile(join(files.output, 'sentinel.txt'), 'prior artifact')
    const authored = await readFile(join(files.presetDirectory, 'runtime.cordis.yml'), 'utf8')

    await expect(prepare(files)).rejects.toThrow('$dynamicRef')
    await expect(readFile(join(files.output, 'sentinel.txt'), 'utf8')).resolves.toBe('prior artifact')
    await expect(readFile(files.cleanupMarker, 'utf8')).resolves.toBe('disposed\n')
    await expect(readFile(join(files.presetDirectory, 'runtime.cordis.yml'), 'utf8')).resolves.toBe(authored)
  })

  it('includes awaited MCP tools without host knowledge of MCP services', async () => {
    const files = await fixture([])
    await writeFile(join(files.presetDirectory, 'runtime.cordis.yml'), JSON.stringify([
      { id: 'tools', name: toolsPlugin, isolate: { doppelgangerTools: 'session' } },
      {
        id: 'mcp',
        name: mcpPlugin,
        inject: ['doppelgangerTools'],
        isolate: { doppelgangerTools: 'session', doppelgangerMcp: 'session' },
        config: {
          startupMode: 'await-ready',
          servers: {
            fixture: {
              transport: { type: 'stdio', command: process.execPath, args: [mcpServer] },
              tools: { ['a'.repeat(200)]: { enabled: false } },
            },
          },
        },
      },
    ], null, 2))

    const result = await prepare(files)
    expect(result.catalog.tools.map(tool => tool.descriptor.name)).toEqual(expect.arrayContaining([
      'mcp-fixture.echo-value',
      'mcp-fixture.wait-forever',
    ]))
    await expect(access(files.output)).resolves.toBeUndefined()
  })

  it('runs the CLI with explicit roots and actor-aware preparation without persisting the actor', async () => {
    const files = await toolFixture({ expectedActor: 'actor-for-preparation' })
    const stdout: string[] = []
    await expect(runPrepareCli([
      '--output', files.output,
      '--home', files.home,
      '--preset', 'prepared',
      '--workspace', files.root,
      '--actor', 'actor-for-preparation',
      '--roots', `system:${files.systemRoot}`,
      '--no-shipped-root',
      '--no-user-root',
    ], {
      stdout: { write(value) { stdout.push(value); return true } },
      stderr: { write() { return true } },
    })).resolves.toBe(0)

    const prepared = await readFile(join(files.output, 'prepared-catalog.json'), 'utf8')
    expect(prepared).not.toContain('actor-for-preparation')
    expect(stdout.join('')).toContain('dg_fixture__echo-value')
    expect(stdout.join('')).not.toContain('actor-for-preparation')
  })

  it('documents every supported preparation flag without activating a Runtime Preset', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    await expect(runPrepareCli(['--help'], {
      stdout: { write(value) { stdout.push(value); return true } },
      stderr: { write(value) { stderr.push(value); return true } },
    })).resolves.toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('')).toContain('--output <directory>')
    expect(stdout.join('')).toContain('--home <directory>')
    expect(stdout.join('')).toContain('--preset <id>')
    expect(stdout.join('')).toContain('--workspace <directory>')
    expect(stdout.join('')).toContain('--roots <list>')
    expect(stdout.join('')).toContain('--root <trust:path>')
    expect(stdout.join('')).toContain('--default-preset <id>')
    expect(stdout.join('')).toContain('--defaultless')
    expect(stdout.join('')).toContain('--no-shipped-root')
    expect(stdout.join('')).toContain('--no-user-root')
    expect(stdout.join('')).toContain('--help')
    expect(stdout.join('')).toContain('--actor <id>')
    expect(stdout.join('')).toContain('--host-extension <module>')
    expect(stdout.join('')).toContain('--enable-host-extension <selection>')
    expect(stdout.join('')).toContain('startupMode: await-ready')
  })

  it('rejects unknown or incomplete CLI options before starting preparation', async () => {
    await expect(runPrepareCli(['--future-option'], {
      stdout: { write() { return true } },
      stderr: { write() { return true } },
    })).rejects.toThrow('unknown option')
    await expect(runPrepareCli(['--output'], {
      stdout: { write() { return true } },
      stderr: { write() { return true } },
    })).rejects.toThrow('--output requires a value')
    await expect(runPrepareCli([], {
      stdout: { write() { return true } },
      stderr: { write() { return true } },
    })).rejects.toThrow('--output is required')
    await expect(runPrepareCli(['--output', 'generated', '--defaultless', '--default-preset', 'standard'], {
      stdout: { write() { return true } },
      stderr: { write() { return true } },
    })).rejects.toThrow('mutually exclusive')
  })

  it('executes the symlinked package bin while direct imports remain inert', async () => {
    const imported = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(join(packageRoot, 'src', 'cli.ts')).href)})`,
    ], { cwd: packageRoot })
    expect(imported.stdout).toBe('')
    expect(imported.stderr).toBe('')

    const help = await execFileAsync('npm', [
      'exec',
      '--workspace', '@doppelganger/doppelganger-host-openclaw',
      '--',
      'doppelganger-openclaw-prepare',
      '--help',
    ], { cwd: repositoryRoot })
    expect(help.stdout).toContain('Usage: doppelganger-openclaw-prepare')

    const files = await toolFixture()
    const prepared = await execFileAsync('npm', [
      'exec',
      '--workspace', '@doppelganger/doppelganger-host-openclaw',
      '--',
      'doppelganger-openclaw-prepare',
      '--output', files.output,
      '--home', files.home,
      '--preset', 'prepared',
      '--workspace', files.root,
      '--roots', `system:${files.systemRoot}`,
      '--no-shipped-root',
      '--no-user-root',
    ], { cwd: repositoryRoot })
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      output: files.output,
      runtimePresetId: 'prepared',
      tools: [{ nativeName: 'dg_fixture__echo-value', canonicalName: 'fixture.echo-value' }],
    })
    await expect(readFile(files.cleanupMarker, 'utf8')).resolves.toBe('disposed\n')
    await expect(access(join(files.output, 'openclaw.plugin.json'))).resolves.toBeUndefined()
  }, 60_000)
})
