import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server, type ServerResponse } from 'node:http'
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
const codeGraphFixtureSource = join(repositoryRoot, 'packages', 'extension-codegraph', 'tests', 'fixtures', 'codegraph-fixture.mjs')

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

interface OmpJsonMessage {
  readonly type?: string
  readonly message?: unknown
}

function decodeOmpStdout(stdout: string): readonly OmpJsonMessage[] {
  return stdout.split('\n').flatMap(line => {
    const trimmed = line.trim()
    return trimmed.length === 0 ? [] : [JSON.parse(trimmed) as OmpJsonMessage]
  })
}

function mountedXdevToolNames(run: LinkedOmpRun): string[] {
  const event = decodeOmpStdout(run.stdout).find(message => {
    if (message.type !== 'message_end' || message.message === null || typeof message.message !== 'object') return false
    return 'customType' in message.message && message.message.customType === 'xdev-mount-notice'
  })
  if (event?.message === null || typeof event?.message !== 'object' || !('content' in event.message)
    || typeof event.message.content !== 'string') {
    throw new Error(`missing OMP xdev mount notice: ${run.stdout}`)
  }
  return [...event.message.content.matchAll(/^- xd:\/\/([a-z0-9_]+)\b/gmu)].map(match => match[1]!)
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
  const preset = join(fixture.doppelgangerHome, '.runtime-presets', 'tool-projection-test')
  await mkdir(preset, { recursive: true })
  await Promise.all([
    writeFile(join(fixture.doppelgangerHome, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: tool-projection-test\n'),
    writeFile(join(preset, 'feature.mjs'), [
      'export default {',
      "  name: 'tool-projection-probe',",
      "  inject: ['doppelgangerActor', 'doppelgangerContext', 'doppelgangerTools'],",
      '  apply(ctx) {',
      '    ctx.doppelgangerContext.register({',
      "      id: 'tool-projection-probe', authority: 'instruction', priority: 100,",
      "      resolve: () => [{ source: 'tool-projection-probe', authority: 'instruction', priority: 100, content: 'Tool projection smoke context.' }],",
      '    })',
      '    ctx.doppelgangerTools.register({',
      "      name: 'test.actor', description: 'Inspect the test actor', available: true,",
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
      '- id: tool-projection-probe',
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

interface CodeGraphOmpFixture {
  readonly activePath: string
  readonly executable: string
  readonly logPath: string
  readonly presetPath: string
  readonly statusPath: string
}

async function writeCodeGraphPreset(fixture: LinkedOmpFixture, workspace: string): Promise<CodeGraphOmpFixture> {
  const preset = join(fixture.doppelgangerHome, '.runtime-presets', 'codegraph-test')
  const executable = join(fixture.root, 'codegraph-fixture')
  const logPath = join(fixture.root, 'codegraph-commands.jsonl')
  const statusPath = join(fixture.root, 'codegraph-status.json')
  const activePath = join(fixture.root, 'codegraph-active')
  const presetPath = join(preset, 'runtime.cordis.yml')
  await mkdir(preset, { recursive: true })
  await mkdir(activePath, { recursive: true })
  await cp(codeGraphFixtureSource, executable)
  await chmod(executable, 0o755)
  await Promise.all([
    writeFile(join(fixture.doppelgangerHome, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: codegraph-test\n'),
    writeFile(statusPath, JSON.stringify({
      initialized: true,
      version: '1.6.0',
      projectPath: workspace,
      indexPath: join(workspace, '.codegraph'),
      lastIndexed: '2026-09-02T12:00:00.000Z',
      fileCount: 1,
      nodeCount: 2,
      edgeCount: 1,
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      worktreeMismatch: null,
      index: {
        builtWithVersion: '1.6.0',
        builtWithExtractionVersion: 7,
        currentExtractionVersion: 7,
        reindexRecommended: false,
        state: 'complete',
        pendingRefs: 0,
      },
    })),
    writeFile(presetPath, [
      '- id: tools',
      '  name: "@doppelganger/doppelganger-protocols/tools"',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: codegraph',
      '  name: "@doppelganger/doppelganger-codegraph/loader"',
      '  inject: [doppelgangerRuntimeSession, doppelgangerTools]',
      '  isolate:',
      '    doppelgangerRuntimeSession: session',
      '    doppelgangerTools: session',
      '  config:',
      `    executable: ${JSON.stringify(executable)}`,
      '',
    ].join('\n')),
  ])
  fixture.environment.CODEGRAPH_FIXTURE_STATUS_PATH = statusPath
  fixture.environment.CODEGRAPH_FIXTURE_LOG = logPath
  fixture.environment.CODEGRAPH_FIXTURE_ACTIVE_PATH = activePath
  fixture.environment.CODEGRAPH_FIXTURE_EXPLORE = 'OMP graph context\n'
  return { activePath, executable, logPath, presetPath, statusPath }
}

async function codeGraphCommandLog(path: string): Promise<readonly Record<string, unknown>[]> {
  const source = await readFile(path, 'utf8').catch(cause => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw cause
  })
  return source.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

function openAiChunk(res: ServerResponse, value: unknown): void {
  res.write(`data: ${JSON.stringify(value)}\n\n`)
}

function openAiToolResponse(res: ServerResponse, id: string, device: string, content: string): void {
  openAiChunk(res, {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{
      index: 0,
      id,
      type: 'function',
      function: { name: 'write', arguments: JSON.stringify({ i: 'Invoking CodeGraph', path: `xd://${device}`, content }) },
    }] }, finish_reason: null }],
  })
  openAiChunk(res, {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  })
  res.end('data: [DONE]\n\n')
}

function openAiTextResponse(res: ServerResponse, text: string): void {
  openAiChunk(res, {
    id: 'chatcmpl-final',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
  })
  openAiChunk(res, {
    id: 'chatcmpl-final',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })
  res.end('data: [DONE]\n\n')
}

interface OpenAiRequestBody {
  readonly messages?: Array<{ readonly role?: string; readonly content?: unknown }>
}

interface CodeGraphModel {
  readonly server: Server
  readonly baseUrl: string
  readonly requests: OpenAiRequestBody[]
}

async function startCodeGraphModel(): Promise<CodeGraphModel> {
  const requests: OpenAiRequestBody[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as OpenAiRequestBody
    requests.push(body)
    const messages = body.messages ?? []
    const lastUser = [...messages].reverse().find(message => message.role === 'user')
    const toolResults = messages.filter(message => message.role === 'tool')
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
    if (JSON.stringify(lastUser?.content).includes('removed CodeGraph')) {
      if (toolResults.length < 4) openAiToolResponse(res, 'call-stale', 'doppelganger_codegraph_status', '{}')
      else openAiTextResponse(res, 'stale checked')
      return
    }
    if (toolResults.length === 0) {
      openAiToolResponse(res, 'call-status', 'doppelganger_codegraph_status', '{}')
    } else if (toolResults.length === 1) {
      openAiToolResponse(res, 'call-explore', 'doppelganger_codegraph_explore', JSON.stringify({ query: 'runtime graph', maxFiles: 2 }))
    } else if (toolResults.length === 2) {
      openAiToolResponse(res, 'call-invalid', 'doppelganger_codegraph_explore', JSON.stringify({ query: 'invalid', maxFiles: 99 }))
    } else {
      openAiTextResponse(res, 'CodeGraph checked')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake OpenAI server did not bind')
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, requests }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function writeEvolutionPreset(fixture: LinkedOmpFixture): Promise<void> {
  const preset = join(fixture.doppelgangerHome, '.runtime-presets', 'evolution-test')
  await mkdir(preset, { recursive: true })
  await Promise.all([
    writeFile(join(fixture.doppelgangerHome, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: evolution-test\n'),
    writeFile(join(preset, 'runtime.cordis.yml'), [
      '- id: context',
      '  name: "@doppelganger/doppelganger-protocols/context"',
      '  isolate:',
      '    doppelgangerContext: session',
      '- id: tools',
      '  name: "@doppelganger/doppelganger-protocols/tools"',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: persona',
      '  name: "@doppelganger/doppelganger-persona"',
      '  inject: [doppelgangerRuntimeSession, doppelgangerContext]',
      '  isolate:',
      '    doppelgangerRuntimeSession: session',
      '    doppelgangerContext: session',
      '    doppelgangerPersona: session',
      '  config:',
      '    instanceId: evolution-test',
      '- id: sqlite',
      '  name: "@doppelganger/doppelganger-sqlite"',
      '  isolate:',
      '    doppelgangerInstanceSqlite: session',
      '  config:',
      `    home: ${JSON.stringify(fixture.doppelgangerHome)}`,
      '- id: evolution',
      '  name: "@doppelganger/doppelganger-evolution"',
      '  inject: [doppelgangerRuntimeSession, doppelgangerActor, doppelgangerPersona, doppelgangerInstanceSqlite, doppelgangerContext, doppelgangerTools]',
      '  isolate:',
      '    doppelgangerRuntimeSession: session',
      '    doppelgangerActor: session',
      '    doppelgangerPersona: session',
      '    doppelgangerInstanceSqlite: session',
      '    doppelgangerContext: session',
      '    doppelgangerTools: session',
      '    doppelgangerEvolution: session',
      '  config:',
      '    remindersEnabled: true',
      '',
    ].join('\n')),
  ])
}

async function seedProjectEvolutionProposal(fixture: LinkedOmpFixture, workspace: string): Promise<void> {
  const script = join(fixture.root, 'seed-evolution.mjs')
  await writeFile(script, [
    `import { Context } from ${JSON.stringify(import.meta.resolve('@deepseek-ai/cordis'))}`,
    `import { createRuntimeSessionMetadataPlugin } from ${JSON.stringify(new URL('../../composition-runtime/src/index.ts', import.meta.url).href)}`,
    `import { EvolutionService } from ${JSON.stringify(new URL('../../extension-evolution/src/index.ts', import.meta.url).href)}`,
    `import { createPersonaActivationPlugin } from ${JSON.stringify(new URL('../../extension-persona/src/index.ts', import.meta.url).href)}`,
    `import { createActorIdentityPlugin } from ${JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)}`,
    `import { InstanceSqliteService } from ${JSON.stringify(new URL('../../extension-sqlite/src/index.ts', import.meta.url).href)}`,
    `const workspace = ${JSON.stringify(workspace)}`,
    `const home = ${JSON.stringify(fixture.doppelgangerHome)}`,
    'const ctx = new Context()',
    `await ctx.plugin(createRuntimeSessionMetadataPlugin({ sessionId: 'seed-session', runtimePresetId: 'evolution-test', workspaceRoot: workspace })).await()`,
    "await ctx.plugin(createActorIdentityPlugin('test-actor')).await()",
    `await ctx.plugin(createPersonaActivationPlugin({ instanceId: 'evolution-test', sessionId: 'seed-session', projectId: workspace, projectRoot: workspace })).await()`,
    'await ctx.plugin(InstanceSqliteService, { home }).await()',
    'await ctx.plugin(EvolutionService).await()',
    'await ctx.doppelgangerEvolution.propose({',
    "  operationId: 'seed-project-proposal', kind: 'capability', scope: 'project',",
    "  dedupeKey: 'project.probe-linked-context', title: 'Probe linked context improvement',",
    "  rationale: 'Probe linked context work repeatedly needs a reusable project capability.',",
    "  tags: ['probe', 'linked', 'context'],",
    '})',
    'await ctx.fiber.dispose()',
    '',
  ].join('\n'))
  await execFileAsync(process.execPath, ['--no-warnings', script], { cwd: repositoryRoot })
}

function activatedToolNames(run: LinkedOmpRun): string[] {
  const request = run.input.find(message => message.method === 'session.activate')
  if (request?.id === undefined) throw new Error(`missing captured session.activate request: ${run.stderr}`)
  const response = run.output.find(message => message.id === request.id)
  if (response?.result === null || typeof response?.result !== 'object' || !('catalog' in response.result)
    || response.result.catalog === null || typeof response.result.catalog !== 'object'
    || !('tools' in response.result.catalog) || !Array.isArray(response.result.catalog.tools)) {
    throw new Error(`missing captured session.activate catalog: ${run.stderr}`)
  }
  return response.result.catalog.tools.flatMap(tool => (
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
  afterContext?: (control: { readonly child: ChildProcessWithoutNullStreams; readonly stdout: () => string }) => Promise<void>,
  awaitXdevMount = false,
  modelName = 'openai/gpt-4o',
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
    '--model', modelName,
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
    if (awaitXdevMount) {
      await eventually('linked OMP xdev mount notice', () => decodeOmpStdout(
        Buffer.concat(stdout).toString('utf8'),
      ).find(message => {
        if (message.type !== 'message_end' || message.message === null || typeof message.message !== 'object') return false
        return 'customType' in message.message && message.message.customType === 'xdev-mount-notice'
      }))
    }
    await afterContext?.({ child, stdout: () => Buffer.concat(stdout).toString('utf8') })
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
    expect(source).not.toMatch(/dev\/doppelganger|DOPPELGANGER_ACTOR_ID|child\.ts|createDoppelgangerOmpExtension/u)
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
      expect(activatedToolNames(run).filter(name => name.startsWith('evolution.'))).toEqual([])
      expect(activatedToolNames(run).filter(name => name.startsWith('codegraph.'))).toEqual([])
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
      const run = await runLinkedOmp(fixture, 'test-actor')
      expect(activationRequest(run).params).toMatchObject({ composition: { id: 'tool-projection-test' }, actorId: 'test-actor' })
      expect(projectedContext(run)).toContain('Tool projection smoke context.')
      expect(activatedToolNames(run)).toContain('test.actor')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('projects opt-in Evolution policy and all seven controls through real OMP', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      await writeEvolutionPreset(fixture)
      const run = await runLinkedOmp(fixture, 'test-actor', fixture.workspace, fixture.doppelgangerHome, undefined, true)
      expect(activationRequest(run).params).toMatchObject({ composition: { id: 'evolution-test' }, actorId: 'test-actor' })
      expect(projectedContext(run)).toContain('[Doppelganger Evolution Policy]')
      expect(activatedToolNames(run).filter(name => name.startsWith('evolution.'))).toEqual([
        'evolution.inspect',
        'evolution.list',
        'evolution.propose',
        'evolution.reject',
        'evolution.reminder.record',
        'evolution.snooze',
        'evolution.transition',
      ])
      expect(mountedXdevToolNames(run).filter(name => name.startsWith('doppelganger_evolution_'))).toEqual([
        'doppelganger_evolution_inspect',
        'doppelganger_evolution_list',
        'doppelganger_evolution_propose',
        'doppelganger_evolution_reject',
        'doppelganger_evolution_reminder_record',
        'doppelganger_evolution_snooze',
        'doppelganger_evolution_transition',
      ])
      expect(run.stderr).toBe('')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('uses the delegated repository extension with a generated test preset', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      await disableLinkedPluginForProjectDogfood(fixture)
      await writeToolBearingPreset(fixture)
      const delegatedWorkspace = join(fixture.root, 'delegated-workspace')
      const extensionDirectory = join(delegatedWorkspace, '.omp', 'extensions')
      const projectDirectory = join(delegatedWorkspace, '.doppelganger')
      await Promise.all([
        mkdir(extensionDirectory, { recursive: true }),
        mkdir(projectDirectory, { recursive: true }),
      ])
      await Promise.all([
        symlink(
          join(repositoryRoot, '.omp', 'extensions', 'doppelganger.ts'),
          join(extensionDirectory, 'doppelganger.ts'),
        ),
        writeFile(join(projectDirectory, 'manifest.yaml'), 'version: 1\nruntimePreset: tool-projection-test\n'),
      ])
      const run = await runLinkedOmp(fixture, 'test-actor', delegatedWorkspace)
      expect(activationRequest(run).params).toMatchObject({
        composition: { id: 'tool-projection-test' },
        actorId: 'test-actor',
      })
      expect(projectedContext(run)).toContain('Tool projection smoke context.')
      expect(activatedToolNames(run)).toContain('test.actor')
      expect(run.stderr).toBe('')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('projects CodeGraph generically through the real OMP extension', async () => {
    const fixture = await createLinkedOmpFixture()
    let model: CodeGraphModel | undefined
    try {
      await disableLinkedPluginForProjectDogfood(fixture)
      const delegatedWorkspace = join(fixture.root, 'codegraph-delegated-workspace')
      const extensionDirectory = join(delegatedWorkspace, '.omp', 'extensions')
      const projectDirectory = join(delegatedWorkspace, '.doppelganger')
      await Promise.all([mkdir(extensionDirectory, { recursive: true }), mkdir(projectDirectory, { recursive: true })])
      await Promise.all([
        symlink(join(repositoryRoot, '.omp', 'extensions', 'doppelganger.ts'), join(extensionDirectory, 'doppelganger.ts')),
        writeFile(join(projectDirectory, 'manifest.yaml'), 'version: 1\nruntimePreset: codegraph-test\n'),
      ])
      const codegraph = await writeCodeGraphPreset(fixture, delegatedWorkspace)
      model = await startCodeGraphModel()
      await mkdir(join(fixture.profileRoot, 'agent'), { recursive: true })
      await writeFile(join(fixture.profileRoot, 'agent', 'models.yml'), [
        'providers:',
        '  codegraph-test:',
        `    baseUrl: ${JSON.stringify(model.baseUrl)}`,
        '    api: openai-completions',
        '    auth: none',
        '    models:',
        '      - id: gpt-4o',
        '        supportsTools: true',
        '',
      ].join('\n'))
      const run = await runLinkedOmp(fixture, 'test-actor', delegatedWorkspace, fixture.doppelgangerHome, async control => {
        const { child } = control
        await eventually('OMP CodeGraph exploration', async () => {
          const commands = await codeGraphCommandLog(codegraph.logPath)
          return commands.some(entry => (entry.args as string[] | undefined)?.[0] === 'explore') ? commands : undefined
        })
        await eventually('OMP CodeGraph structured failure propagation', () => {
          const transcript = JSON.stringify(model?.requests ?? [])
          return transcript.includes('CODEGRAPH_INVALID_INPUT') ? true : undefined
        })
        await eventually('OMP CodeGraph first turn completion', () => control.stdout().includes('"type":"agent_end"') ? true : undefined)
        const beforeRemoval = (await codeGraphCommandLog(codegraph.logPath)).length
        const beforeReload = (await capturedMessages(fixture.captureRoot, '.out.bin'))
          .filter(message => message.method === 'toolCatalog.changed').length
        await writeFile(codegraph.presetPath, [
          '- id: tools',
          '  name: "@doppelganger/doppelganger-protocols/tools"',
          '  isolate:',
          '    doppelgangerTools: session',
          '',
        ].join('\n'))
        await eventually('OMP CodeGraph removal reload', async () => {
          const count = (await capturedMessages(fixture.captureRoot, '.out.bin'))
            .filter(message => message.method === 'toolCatalog.changed').length
          return count > beforeReload ? true : undefined
        })
        child.stdin.write(`${JSON.stringify({ id: 'stale-codegraph', type: 'prompt', message: 'Use the removed CodeGraph status tool.' })}\n`)
        await eventually('OMP CodeGraph stale device rejection', () => {
          const transcript = JSON.stringify(model?.requests ?? [])
          return transcript.includes('call-stale') && /not (?:mounted|found|registered)|unknown xd|unavailable/iu.test(transcript)
            ? true
            : undefined
        })
        expect(await codeGraphCommandLog(codegraph.logPath)).toHaveLength(beforeRemoval)
      }, false, 'codegraph-test/gpt-4o')
      expect(activationRequest(run).params).toMatchObject({
        composition: { id: 'codegraph-test' },
        actorId: 'test-actor',
        workspaceRoot: delegatedWorkspace,
      })
      expect(activatedToolNames(run).filter(name => name.startsWith('codegraph.'))).toEqual([
        'codegraph.explore',
        'codegraph.status',
      ])
      expect(mountedXdevToolNames(run).filter(name => name.includes('codegraph'))).toEqual([
        'doppelganger_codegraph_explore',
        'doppelganger_codegraph_status',
      ])
      const commands = await codeGraphCommandLog(codegraph.logPath)
      expect(commands.map(entry => entry.args)).toEqual([
        ['--version'],
        ['status', delegatedWorkspace, '--json'],
        ['status', delegatedWorkspace, '--json'],
        ['explore', '--path', delegatedWorkspace, '--max-files', '2', '--', 'runtime graph'],
      ])
      expect(await readdir(codegraph.activePath)).toEqual([])
      expect(run.stderr).toBe('')
    } finally {
      if (model !== undefined) await closeServer(model.server)
      await destroyLinkedOmpFixture(fixture)
    }
  }, 45_000)

  it('uses the real project-local extension with Evolution persistence, reminder data, reload, and shutdown', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      await disableLinkedPluginForProjectDogfood(fixture)
      await writeEvolutionPreset(fixture)
      const delegatedWorkspace = join(fixture.root, 'evolution-delegated-workspace')
      const extensionDirectory = join(delegatedWorkspace, '.omp', 'extensions')
      const projectDirectory = join(delegatedWorkspace, '.doppelganger')
      await Promise.all([mkdir(extensionDirectory, { recursive: true }), mkdir(projectDirectory, { recursive: true })])
      await Promise.all([
        symlink(join(repositoryRoot, '.omp', 'extensions', 'doppelganger.ts'), join(extensionDirectory, 'doppelganger.ts')),
        writeFile(join(projectDirectory, 'manifest.yaml'), 'version: 1\nruntimePreset: evolution-test\n'),
      ])
      await seedProjectEvolutionProposal(fixture, delegatedWorkspace)
      const presetPath = join(fixture.doppelgangerHome, '.runtime-presets', 'evolution-test', 'runtime.cordis.yml')
      const run = await runLinkedOmp(fixture, 'test-actor', delegatedWorkspace, fixture.doppelgangerHome, async control => {
        await eventually('Evolution first turn completion', () => control.stdout().includes('"type":"agent_end"') ? true : undefined)
        const before = (await capturedMessages(fixture.captureRoot, '.in.bin'))
          .filter(message => message.method === 'context.resolve').length
        const catalogChanges = (await capturedMessages(fixture.captureRoot, '.out.bin'))
          .filter(message => message.method === 'toolCatalog.changed').length
        const source = await readFile(presetPath, 'utf8')
        await writeFile(presetPath, source.replace('remindersEnabled: true', 'remindersEnabled: false'))
        await eventually('Evolution project-local reload commit', async () => {
          const changes = (await capturedMessages(fixture.captureRoot, '.out.bin'))
            .filter(message => message.method === 'toolCatalog.changed').length
          return changes > catalogChanges ? true : undefined
        })
        control.child.stdin.write(`${JSON.stringify({ id: 'reload-context-probe', type: 'prompt', message: 'Probe reloaded Evolution context.' })}\n`)
        await eventually('Evolution project-local reload', async () => {
          const input = await capturedMessages(fixture.captureRoot, '.in.bin')
          const requests = input.filter(message => message.method === 'context.resolve')
          if (requests.length <= before) return
          const request = requests.at(-1)
          if (request?.id === undefined) return
          const output = await capturedMessages(fixture.captureRoot, '.out.bin')
          const response = output.find(message => message.id === request.id)
          if (response?.result === null || typeof response?.result !== 'object' || !('content' in response.result)
            || typeof response.result.content !== 'string') return
          return response.result.content.includes('[Evolution reminder candidate;') ? undefined : true
        })
      })
      expect(activationRequest(run).params).toMatchObject({
        composition: { id: 'evolution-test' },
        actorId: 'test-actor',
        workspaceRoot: delegatedWorkspace,
      })
      expect(projectedContext(run)).toContain('[Doppelganger Evolution Policy]')
      expect(projectedContext(run)).toContain('[Evolution reminder candidate;')
      expect(activatedToolNames(run).filter(name => name.startsWith('evolution.'))).toHaveLength(7)
      expect(run.input.filter(message => message.method === 'context.resolve')).toHaveLength(2)
      const opportunities = join(delegatedWorkspace, '.doppelganger', 'evolution', 'opportunities')
      const files = (await readdir(opportunities)).filter(name => name.endsWith('.yaml'))
      expect(files).toHaveLength(1)
      expect(await readFile(join(opportunities, files[0]!), 'utf8')).toContain('Probe linked context improvement')
      expect(run.stderr).toBe('')
    } finally {
      await destroyLinkedOmpFixture(fixture)
    }
  }, 30_000)

  it('binds only a non-empty externally configured test actor', async () => {
    const fixture = await createLinkedOmpFixture()
    try {
      const run = await runLinkedOmp(fixture, 'test-actor')
      expect(activationRequest(run).params).toMatchObject({ actorId: 'test-actor' })
      const authoredFiles = [
        new URL('../package.json', import.meta.url),
        new URL('../src/index.ts', import.meta.url),
        new URL('../src/options.ts', import.meta.url),
        join(repositoryRoot, 'packages', 'runtime-presets', 'presets', 'standard', 'runtime.cordis.yml'),
        join(fixture.workspace, 'probe.txt'),
      ]
      for (const path of authoredFiles) expect(await readFile(path, 'utf8')).not.toContain('test-actor')
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

  it('contains the resolvable dependency closure for shipped standard and opt-in Loader plugins', async () => {
    const { root, internalPackages } = await isolatedPluginTree()
    const standardComposition = await readFile(
      join(repositoryRoot, 'packages', 'runtime-presets', 'presets', 'standard', 'runtime.cordis.yml'),
      'utf8',
    )
    const standardModules = [...standardComposition.matchAll(/^\s*name:\s*"([^"]+)"/gmu)]
      .map(match => match[1]!)
    const specifiers = [
      '@doppelganger/doppelganger-omp',
      '@doppelganger/doppelganger-dynamic-runtime-plugins',
      '@doppelganger/doppelganger-evolution',
      '@doppelganger/doppelganger-codegraph',
      '@doppelganger/doppelganger-extension-mcp/loader',
      ...standardModules,
    ]
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
