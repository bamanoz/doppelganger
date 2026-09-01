import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { optionsFromEnvironment } from '../src/options.ts'

const captureExtensionOptions = vi.hoisted(() => vi.fn((options: unknown) => options))

vi.mock('@doppelganger/doppelganger-host-omp', () => ({
  createDoppelgangerOmpExtension: captureExtensionOptions,
}))

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const ompPath = join(repositoryRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'omp.cmd' : 'omp')
const temporaryRoots: string[] = []
const activeOmpProcesses = new Set<ChildProcessWithoutNullStreams>()

interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly private?: boolean
  readonly files?: readonly string[]
  readonly exports?: Record<string, unknown>
  readonly omp?: {
    readonly name?: string
    readonly description?: string
    readonly extensions?: readonly string[]
  }
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly publishConfig?: unknown
}

interface BoundaryManifest {
  readonly packages: Record<string, { readonly directory: string }>
}

async function json<T>(path: string | URL): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function packageName(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
}

async function isolatedPluginTree(): Promise<{ root: string; internalPackages: ReadonlySet<string> }> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-package-'))
  temporaryRoots.push(root)
  const nodeModules = join(root, 'node_modules')
  const boundaries = await json<BoundaryManifest>(join(repositoryRoot, 'scripts', 'package-boundaries.json'))
  const internalPackages = new Set<string>()
  const externalPackages = new Set<string>()
  const pending = ['@doppelganger/doppelganger-omp']

  while (pending.length > 0) {
    const name = pending.shift()!
    if (internalPackages.has(name)) continue
    const boundary = boundaries.packages[name]
    if (boundary === undefined) throw new Error(`missing boundary entry for ${name}`)
    internalPackages.add(name)
    const source = join(repositoryRoot, 'packages', boundary.directory)
    const destination = join(nodeModules, ...name.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true })
    const manifest = await json<PackageManifest>(join(source, 'package.json'))
    const declared = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }
    for (const dependency of Object.keys(declared)) {
      if (dependency.startsWith('@doppelganger/')) pending.push(dependency)
      else externalPackages.add(dependency)
    }
  }

  for (const name of externalPackages) {
    const source = await realpath(join(repositoryRoot, 'node_modules', ...name.split('/')))
    const destination = join(nodeModules, ...name.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await symlink(source, destination, 'junction')
  }

  return { root, internalPackages }
}

interface LinkedOmpFixture {
  readonly root: string
  readonly home: string
  readonly profileRoot: string
  readonly sessionRoot: string
  readonly workspace: string
  readonly doppelgangerHome: string
  readonly captureRoot: string
  readonly environment: NodeJS.ProcessEnv
}

interface CapturedRpcMessage {
  readonly jsonrpc: '2.0'
  readonly id?: number | string
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

interface LinkedOmpRun {
  readonly input: readonly CapturedRpcMessage[]
  readonly output: readonly CapturedRpcMessage[]
  readonly childArguments: readonly string[]
  readonly stdout: string
  readonly stderr: string
}

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, milliseconds)
  return promise
}
async function eventually<T>(label: string, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await delay(25)
  }
  throw new Error(`${label} timed out`)
}

function decodeCapturedRpc(buffer: Buffer): CapturedRpcMessage[] {
  const messages: CapturedRpcMessage[] = []
  let offset = 0
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'ascii')
    if (headerEnd < 0) break
    const header = buffer.subarray(offset, headerEnd).toString('ascii')
    const match = /^Content-Length:\s*(\d+)\s*$/imu.exec(header)
    if (match === null) throw new Error(`captured child frame has no Content-Length: ${header}`)
    const contentLength = Number(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + contentLength
    if (bodyEnd > buffer.length) break
    messages.push(JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8')) as CapturedRpcMessage)
    offset = bodyEnd
  }
  return messages
}

async function capturedPath(root: string, suffix: string): Promise<string | undefined> {
  const names = await readdir(root).catch(() => [])
  const name = names.find(candidate => candidate.endsWith(suffix))
  return name === undefined ? undefined : join(root, name)
}

async function capturedMessages(root: string, suffix: '.in.bin' | '.out.bin'): Promise<CapturedRpcMessage[]> {
  const path = await capturedPath(root, suffix)
  return path === undefined ? [] : decodeCapturedRpc(await readFile(path))
}

async function stopOmpProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin.end()
  const exited = once(child, 'exit').then(() => undefined)
  if (await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) return
  child.kill('SIGTERM')
  if (await Promise.race([exited.then(() => true), delay(2_000).then(() => false)])) return
  child.kill('SIGKILL')
  await exited
}

async function createLinkedOmpFixture(): Promise<LinkedOmpFixture> {
  if (process.platform === 'win32') throw new Error('real OMP link smoke requires a POSIX executable wrapper')
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-link-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const profileName = 'isolated'
  const profileRoot = join(home, '.omp', 'profiles', profileName)
  const sessionRoot = join(root, 'sessions')
  const workspace = join(root, 'workspace')
  const doppelgangerHome = join(root, 'doppelganger-home')
  const captureRoot = join(root, 'child-capture')
  const binRoot = join(root, 'bin')
  await Promise.all([
    mkdir(sessionRoot, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(captureRoot, { recursive: true }),
    mkdir(binRoot, { recursive: true }),
  ])
  await writeFile(join(workspace, 'probe.txt'), 'isolated OMP workspace\n')
  const nodeWrapper = join(binRoot, 'node')
  await writeFile(nodeWrapper, [
    `#!${process.execPath}`,
    "import { appendFileSync, writeFileSync } from 'node:fs'",
    "import { spawn } from 'node:child_process'",
    "import { join } from 'node:path'",
    'const captureRoot = process.env.DOPPELGANGER_CHILD_CAPTURE_DIR',
    'const realNode = process.env.DOPPELGANGER_REAL_NODE',
    "if (!captureRoot || !realNode) throw new Error('missing child capture environment')",
    'const prefix = join(captureRoot, String(process.pid))',
    "writeFileSync(`${prefix}.argv.json`, JSON.stringify(process.argv.slice(2)))",
    "const child = spawn(realNode, process.argv.slice(2), { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })",
    "process.stdin.on('data', chunk => { appendFileSync(`${prefix}.in.bin`, chunk); child.stdin.write(chunk) })",
    "process.stdin.on('end', () => child.stdin.end())",
    "child.stdout.on('data', chunk => { appendFileSync(`${prefix}.out.bin`, chunk); process.stdout.write(chunk) })",
    "child.stderr.on('data', chunk => { appendFileSync(`${prefix}.err.bin`, chunk); process.stderr.write(chunk) })",
    "child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === null ? 0 : 1) })",
    '',
  ].join('\n'))
  await chmod(nodeWrapper, 0o755)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OMP_PROFILE: profileName,
    PI_CONFIG_DIR: '.omp',
    PI_NOTIFICATIONS: 'off',
    DOPPELGANGER_HOME: doppelgangerHome,
    DOPPELGANGER_CHILD_CAPTURE_DIR: captureRoot,
    DOPPELGANGER_REAL_NODE: process.execPath,
    PATH: `${binRoot}${delimiter}${process.env.PATH ?? ''}`,
  }
  delete environment.DOPPELGANGER_ACTOR_ID
  delete environment.XDG_CACHE_HOME
  delete environment.XDG_CONFIG_HOME
  delete environment.XDG_DATA_HOME
  delete environment.XDG_STATE_HOME
  for (const name of Object.keys(environment)) {
    if (/(?:API_KEY|OAUTH_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|GITHUB_TOKEN)$/u.test(name)) delete environment[name]
  }
  environment.OPENAI_API_KEY = 'doppelganger-smoke-only'
  environment.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1'

  const { stdout } = await execFileAsync(ompPath, ['plugin', 'link', packageRoot, '--json'], {
    cwd: workspace,
    env: environment,
  })
  const linked = JSON.parse(stdout) as { name: string; enabled: boolean }
  expect(linked).toMatchObject({ name: '@doppelganger/doppelganger-omp', enabled: true })
  return { root, home, profileRoot, sessionRoot, workspace, doppelgangerHome, captureRoot, environment }
}

async function destroyLinkedOmpFixture(fixture: LinkedOmpFixture): Promise<void> {
  await Promise.all([...activeOmpProcesses].map(stopOmpProcess))
  await rm(fixture.root, { recursive: true, force: true })
  const index = temporaryRoots.indexOf(fixture.root)
  if (index >= 0) temporaryRoots.splice(index, 1)
}

async function writeToolBearingPreset(fixture: LinkedOmpFixture): Promise<void> {
  const preset = join(fixture.doppelgangerHome, '.runtime-presets', 'mark')
  await mkdir(preset, { recursive: true })
  await Promise.all([
    writeFile(join(fixture.doppelgangerHome, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: mark\n'),
    writeFile(join(preset, 'feature.mjs'), [
      'export default {',
      "  name: 'mark-probe',",
      "  inject: ['doppelgangerActor', 'doppelgangerContext', 'doppelgangerTools'],",
      '  apply(ctx) {',
      '    ctx.doppelgangerContext.register({',
      "      id: 'mark-probe', authority: 'instruction', priority: 100,",
      "      resolve: () => [{ source: 'mark-probe', authority: 'instruction', priority: 100, content: 'Repository Mark smoke context.' }],",
      '    })',
      '    ctx.doppelgangerTools.register({',
      "      name: 'mark.actor', description: 'Inspect the Mark smoke actor', available: true,",
      "      inputSchema: { type: 'object', properties: {}, additionalProperties: false },",
      '      invoke: () => ({ actorId: ctx.doppelgangerActor.actorId }),',
      '    })',
      '  },',
      '}',
      '',
    ].join('\n')),
    writeFile(join(preset, 'runtime.cordis.yml'), [
      '- id: context',
      '  name: "@doppelganger/doppelganger-protocols/context"',
      '  isolate:',
      '    doppelgangerContext: session',
      '- id: tools',
      '  name: "@doppelganger/doppelganger-protocols/tools"',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: mark-probe',
      '  name: ./feature.mjs',
      '  inject: [doppelgangerActor, doppelgangerContext, doppelgangerTools]',
      '  isolate:',
      '    doppelgangerActor: session',
      '    doppelgangerContext: session',
      '    doppelgangerTools: session',
      '',
    ].join('\n')),
  ])
}

function activatedToolNames(run: LinkedOmpRun): string[] {
  const request = run.input.find(message => message.method === 'session.activate')
  if (request?.id === undefined) throw new Error(`missing captured session.activate request: ${run.stderr}`)
  const response = run.output.find(message => message.id === request.id)
  if (response?.result === null || typeof response?.result !== 'object' || !('tools' in response.result)
    || !Array.isArray(response.result.tools)) {
    throw new Error(`missing captured session.activate tools: ${run.stderr}`)
  }
  return response.result.tools.flatMap(tool => (
    tool !== null && typeof tool === 'object' && 'name' in tool && typeof tool.name === 'string' ? [tool.name] : []
  ))
}

async function disableLinkedPluginForProjectDogfood(fixture: LinkedOmpFixture): Promise<void> {
  await execFileAsync(ompPath, ['plugin', 'uninstall', '@doppelganger/doppelganger-omp', '--json'], {
    cwd: fixture.workspace,
    env: fixture.environment,
  })
}

async function runLinkedOmp(
  fixture: LinkedOmpFixture,
  actorId?: string,
  workspace = fixture.workspace,
  doppelgangerHome = fixture.doppelgangerHome,
): Promise<LinkedOmpRun> {
  const environment = {
    ...fixture.environment,
    DOPPELGANGER_HOME: doppelgangerHome,
    ...(actorId === undefined ? {} : { DOPPELGANGER_ACTOR_ID: actorId }),
  }
  const args = [
    '--mode', 'rpc',
    '--cwd', workspace,
    '--session-dir', fixture.sessionRoot,
    '--model', 'openai/gpt-4o',
    '--no-skills',
    '--no-rules',
    '--no-lsp',
    '--no-pty',
  ]
  expect(args).not.toContain('-e')
  expect(args).not.toContain('--extension')
  const child = spawn(ompPath, args, {
    cwd: workspace,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  activeOmpProcesses.add(child)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
  const exited = once(child, 'exit')
  try {
    try {
      await eventually('linked OMP activation', async () => {
        const messages = await capturedMessages(fixture.captureRoot, '.in.bin')
        return messages.some(message => message.method === 'session.activate') ? messages : undefined
      })
    } catch (cause) {
      const captures = await readdir(fixture.captureRoot).catch(() => [])
      throw new Error([
        cause instanceof Error ? cause.message : String(cause),
        `exitCode=${String(child.exitCode)} signalCode=${String(child.signalCode)}`,
        `captures=${JSON.stringify(captures)}`,
        `stdout=${Buffer.concat(stdout).toString('utf8')}`,
        `stderr=${Buffer.concat(stderr).toString('utf8')}`,
      ].join('\n'))
    }
    child.stdin.write(`${JSON.stringify({ id: 'context-probe', type: 'prompt', message: 'Probe linked context.' })}\n`)
    await eventually('linked OMP context projection', async () => {
      const messages = await capturedMessages(fixture.captureRoot, '.in.bin')
      return messages.some(message => message.method === 'context.resolve') ? messages : undefined
    })
    await eventually('linked OMP context response', async () => {
      const input = await capturedMessages(fixture.captureRoot, '.in.bin')
      const request = input.find(message => message.method === 'context.resolve')
      if (request?.id === undefined) return
      const output = await capturedMessages(fixture.captureRoot, '.out.bin')
      return output.some(message => message.id === request.id) ? output : undefined
    })
    child.stdin.write(`${JSON.stringify({ id: 'abort-probe', type: 'abort' })}\n`)
    child.stdin.end()
    await Promise.race([
      exited,
      delay(10_000).then(() => { throw new Error('linked OMP shutdown timed out') }),
    ])
    const argumentPath = await eventually('linked child argv capture', () => capturedPath(fixture.captureRoot, '.argv.json'))
    return {
      input: await capturedMessages(fixture.captureRoot, '.in.bin'),
      output: await capturedMessages(fixture.captureRoot, '.out.bin'),
      childArguments: JSON.parse(await readFile(argumentPath, 'utf8')) as string[],
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }
  } finally {
    await stopOmpProcess(child)
    activeOmpProcesses.delete(child)
  }
}

function activationRequest(run: LinkedOmpRun): CapturedRpcMessage & { params: Record<string, unknown> } {
  const request = run.input.find(message => message.method === 'session.activate')
  if (request === undefined || request.params === null || typeof request.params !== 'object') {
    throw new Error(`missing captured session.activate request: ${run.stderr}`)
  }
  return request as CapturedRpcMessage & { params: Record<string, unknown> }
}

function projectedContext(run: LinkedOmpRun): string {
  const request = run.input.find(message => message.method === 'context.resolve')
  if (request?.id === undefined) throw new Error(`missing captured context.resolve request: ${run.stderr}`)
  const response = run.output.find(message => message.id === request.id)
  if (response?.result === null || typeof response?.result !== 'object' || !('content' in response.result)) {
    throw new Error(`missing captured context.resolve response: ${run.stderr}`)
  }
  const content = response.result.content
  if (typeof content !== 'string') throw new Error('captured context content is not a string')
  return content
}

afterEach(async () => {
  vi.unstubAllEnvs()
  captureExtensionOptions.mockClear()
  await Promise.all([...activeOmpProcesses].map(stopOmpProcess))
  activeOmpProcesses.clear()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('local OMP plugin package', () => {
  it('declares one private OMP extension entry at the repository version', async () => {
    const manifest = await json<PackageManifest>(new URL('../package.json', import.meta.url))
    expect(manifest).toMatchObject({
      name: '@doppelganger/doppelganger-omp',
      version: '0.0.0',
      private: true,
      omp: {
        name: 'Doppelganger',
        description: expect.any(String),
        extensions: ['./src/index.ts'],
      },
    })
    expect(manifest.omp?.extensions).toHaveLength(1)
    expect(manifest.exports).toHaveProperty('.')
  })

  it('uses the same package entrypoint for project discovery and plugin linking', async () => {
    const source = await readFile(join(repositoryRoot, '.omp', 'extensions', 'doppelganger.ts'), 'utf8')
    expect(source).toBe("export { default } from '@doppelganger/doppelganger-omp'\n")
    expect(source).not.toMatch(/dev\/doppelganger|valera|child\.ts|createDoppelgangerOmpExtension/u)
  })

  it('is discovered through real isolated OMP local plugin linking', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      const { stdout } = await execFileAsync(ompPath, ['plugin', 'list', '--json'], {
        cwd: fixture.workspace,
        env: fixture.environment,
      })
      const listed = JSON.parse(stdout) as { npm: Array<{ name: string; enabled: boolean; path: string }> }
      expect(listed.npm).toContainEqual(expect.objectContaining({
        name: '@doppelganger/doppelganger-omp',
        enabled: true,
        path: join(fixture.profileRoot, 'plugins', 'node_modules', '@doppelganger', 'doppelganger-omp'),
      }))
      const run = await runLinkedOmp(fixture)
      expect(run.childArguments).toEqual(['--no-warnings', join(repositoryRoot, 'packages', 'host-omp', 'src', 'child.ts')])
      expect(run.stderr).toBe('')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('activates shipped standard from a fresh home without authored package defaults', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      const run = await runLinkedOmp(fixture)
      const activation = activationRequest(run).params
      expect(activation).toMatchObject({
        composition: { id: 'standard' },
        hostKind: 'omp',
      })
      expect(activation).not.toHaveProperty('actorId')
      expect(await readFile(join(fixture.doppelgangerHome, 'config.yaml'), 'utf8')).toContain('version: 1')
      expect(await readFile(join(fixture.doppelgangerHome, 'runtime.cordis.patch.yml'), 'utf8')).toContain('[]')
      await expect(readdir(join(fixture.doppelgangerHome, '.runtime-presets'))).resolves.toEqual([])
      expect(projectedContext(run)).toContain('durable personal and technical assistant')
      await expect(access(join(fixture.doppelgangerHome, '.runtime-presets', 'standard'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(fixture.doppelgangerHome, 'config.yml'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('projects runtime tools through real OMP without blocking session startup', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      await writeToolBearingPreset(fixture)
      const run = await runLinkedOmp(fixture, 'valera')
      expect(activationRequest(run).params).toMatchObject({ composition: { id: 'mark' }, actorId: 'valera' })
      expect(projectedContext(run)).toContain('Repository Mark smoke context.')
      expect(activatedToolNames(run)).toContain('mark.actor')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('dogfoods Mark through the delegated repository extension', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      await disableLinkedPluginForProjectDogfood(fixture)
      const dogfoodWorkspace = join(fixture.root, 'dogfood-workspace')
      const extensionDirectory = join(dogfoodWorkspace, '.omp', 'extensions')
      const projectDirectory = join(dogfoodWorkspace, '.doppelganger')
      await Promise.all([
        mkdir(extensionDirectory, { recursive: true }),
        mkdir(projectDirectory, { recursive: true }),
      ])
      await Promise.all([
        symlink(
          join(repositoryRoot, '.omp', 'extensions', 'doppelganger.ts'),
          join(extensionDirectory, 'doppelganger.ts'),
        ),
        writeFile(join(projectDirectory, 'manifest.yaml'), 'version: 1\nruntimePreset: mark\n'),
      ])
      const run = await runLinkedOmp(
        fixture,
        'valera',
        dogfoodWorkspace,
        join(repositoryRoot, 'dev', 'doppelganger'),
      )
      expect(activationRequest(run).params).toMatchObject({ composition: { id: 'mark' }, actorId: 'valera' })
      expect(projectedContext(run)).toContain('You are Mark')
      expect(activatedToolNames(run)).toContain('memory.search')
      expect(run.stderr).toBe('')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('binds only a non-empty externally configured development actor', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      const run = await runLinkedOmp(fixture, 'valera')
      expect(activationRequest(run).params).toMatchObject({ actorId: 'valera' })
      const authoredFiles = [
        new URL('../package.json', import.meta.url),
        new URL('../src/index.ts', import.meta.url),
        new URL('../src/options.ts', import.meta.url),
        join(repositoryRoot, 'packages', 'runtime-presets', 'presets', 'standard', 'runtime.cordis.yml'),
        join(fixture.workspace, 'probe.txt'),
      ]
      for (const path of authoredFiles) expect(await readFile(path, 'utf8')).not.toContain('valera')
      await expect(access(join(fixture.workspace, '.doppelganger', 'manifest.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('omits authored defaults and binds only a non-empty actor environment value', async () => {
    expect(optionsFromEnvironment({})).toEqual({})
    expect(optionsFromEnvironment({ DOPPELGANGER_ACTOR_ID: '   ' })).toEqual({})
    expect(optionsFromEnvironment({ DOPPELGANGER_ACTOR_ID: ' actor-one ' })).toEqual({ actorId: 'actor-one' })

    vi.stubEnv('DOPPELGANGER_ACTOR_ID', '')
    // Dynamic import intentionally reloads the environment-bound plugin entry after each stub change.
    vi.resetModules()
    await import('../src/index.ts')
    expect(captureExtensionOptions).toHaveBeenLastCalledWith({})

    vi.stubEnv('DOPPELGANGER_ACTOR_ID', ' actor-two ')
    // Dynamic import intentionally reloads the environment-bound plugin entry after each stub change.
    vi.resetModules()
    await import('../src/index.ts')
    expect(captureExtensionOptions).toHaveBeenLastCalledWith({ actorId: 'actor-two' })
  })

  it('contains the resolvable dependency closure for shipped standard', async () => {
    const { root, internalPackages } = await isolatedPluginTree()
    const standardComposition = await readFile(
      join(repositoryRoot, 'packages', 'runtime-presets', 'presets', 'standard', 'runtime.cordis.yml'),
      'utf8',
    )
    const standardModules = [...standardComposition.matchAll(/^\s*name:\s*"([^"]+)"/gmu)]
      .map(match => match[1]!)
    const specifiers = ['@doppelganger/doppelganger-omp', ...standardModules]
    const probePath = join(root, 'probe.mjs')
    await writeFile(probePath, [
      `const specifiers = ${JSON.stringify(specifiers)}`,
      'const resolved = {}',
      'for (const specifier of specifiers) {',
      '  resolved[specifier] = import.meta.resolve(specifier)',
      '}',
      'process.stdout.write(JSON.stringify(resolved))',
      '',
    ].join('\n'))

    const { stdout } = await execFileAsync(process.execPath, ['--no-warnings', probePath], { cwd: root })
    const resolved = JSON.parse(stdout) as Record<string, string>
    expect(Object.keys(resolved)).toEqual(specifiers)
    for (const [specifier, url] of Object.entries(resolved)) {
      if (!internalPackages.has(packageName(specifier))) continue
      expect(fileURLToPath(new URL(url))).toContain(join(root, 'node_modules'))
      expect(url).not.toContain(join(repositoryRoot, 'node_modules', '@doppelganger'))
    }
  })

  it('remains private while exposing only local source package contents', async () => {
    const manifest = await json<PackageManifest>(new URL('../package.json', import.meta.url))
    const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '.'], { cwd: packageRoot })
    const [inspection] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>
    expect(manifest).toMatchObject({ private: true, version: '0.0.0', files: ['src'] })
    expect(manifest.publishConfig).toBeUndefined()
    expect(inspection!.files.map(file => file.path).sort()).toEqual([
      'package.json',
      'src/index.ts',
      'src/options.ts',
    ])
    expect(pathToFileURL(join(packageRoot, manifest.omp!.extensions![0]!)).href).toMatch(/\/src\/index\.ts$/u)
  })
})
