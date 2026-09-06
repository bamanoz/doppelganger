import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolRegistry, type ToolRegistry as ToolRegistryService } from '@doppelganger/doppelganger-protocols'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionReloadEvent,
} from '@doppelganger/doppelganger-composition-runtime'
import {
  CODEGRAPH_LIMITS,
  CodeGraphPlugin,
  normalizeCodeGraphPluginConfig,
  type CodeGraphPluginConfig,
} from '../src/index.ts'
import { CodeGraphProcessRunner } from '../src/process.ts'

const fixtureExecutable = fileURLToPath(new URL('./fixtures/codegraph-fixture.mjs', import.meta.url))
const codeGraphModule = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const temporaryRoots: string[] = []

interface Harness {
  readonly root: string
  readonly workspace: string
  readonly statusPath: string
  readonly logPath: string
  readonly ctx: Context
  readonly plugin: Fiber
  readonly tools: ToolRegistryService
}

function healthyStatus(workspace: string): Record<string, unknown> {
  return {
    initialized: true,
    version: '1.6.0',
    projectPath: workspace,
    indexPath: join(workspace, '.codegraph'),
    lastIndexed: '2026-09-02T12:00:00.000Z',
    fileCount: 12,
    nodeCount: 48,
    edgeCount: 96,
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
  }
}

async function setup(config: CodeGraphPluginConfig = {}, workspaceAvailable = true): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-codegraph-'))
  temporaryRoots.push(root)
  const workspacePath = join(root, 'workspace')
  const statusPath = join(root, 'status.json')
  const logPath = join(root, 'commands.jsonl')
  await mkdir(workspacePath)
  const workspace = await realpath(workspacePath)
  await writeFile(statusPath, JSON.stringify(healthyStatus(workspace)))
  await chmod(fixtureExecutable, 0o755)
  vi.stubEnv('CODEGRAPH_FIXTURE_STATUS_PATH', statusPath)
  vi.stubEnv('CODEGRAPH_FIXTURE_LOG', logPath)
  vi.stubEnv('CODEGRAPH_FIXTURE_ACTIVE_PATH', join(root, 'active'))
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({
    sessionId: 'codegraph-test',
    runtimePresetId: 'test',
    ...(workspaceAvailable ? { workspaceRoot: workspace } : {}),
  }))
  await ctx.plugin(ToolRegistry)
  const tools = ctx.doppelgangerTools
  const plugin = await ctx.plugin(CodeGraphPlugin, { executable: fixtureExecutable, ...config })
  return { root, workspace, statusPath, logPath, ctx, plugin, tools }
}

async function dispose(harness: Harness): Promise<void> {
  await harness.plugin.dispose()
  await harness.ctx.fiber.dispose()
}

function invokePortable(tools: ToolRegistryService, name: string, input: Parameters<ToolRegistryService['invoke']>[0]['input']) {
  const descriptor = tools.snapshot().tools.find(tool => tool.name === name)
  if (descriptor === undefined) {
    return Promise.resolve({
      ok: false as const,
      error: { code: 'TOOL_NOT_FOUND', message: `tool "${name}" is not registered` },
    })
  }
  return tools.invoke({
    callId: crypto.randomUUID(),
    name,
    toolRevision: descriptor.revision,
    input,
  }, 'test-session')
}

async function commandLog(path: string): Promise<readonly Record<string, unknown>[]> {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
}

function reloadEvents() {
  const queued: CompositionReloadEvent[] = []
  const waiters: Array<{ resolve(value: CompositionReloadEvent): void; reject(cause: Error): void; timer: NodeJS.Timeout }> = []
  return {
    push(value: CompositionReloadEvent) {
      const waiter = waiters.shift()
      if (waiter === undefined) queued.push(value)
      else {
        clearTimeout(waiter.timer)
        waiter.resolve(value)
      }
    },
    next(label: string): Promise<CompositionReloadEvent> {
      const ready = queued.shift()
      if (ready !== undefined) return Promise.resolve(ready)
      const { promise, resolve, reject } = Promise.withResolvers<CompositionReloadEvent>()
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error(`${label} timed out`))
        }, 3_000),
      }
      waiters.push(waiter)
      return promise
    },
  }
}

function codeGraphLoader(executable: string, defaultMaxFiles?: number): string {
  return JSON.stringify([
    {
      id: 'tools',
      name: '@doppelganger/doppelganger-protocols/tools',
      isolate: { doppelgangerTools: 'session' },
    },
    {
      id: 'codegraph',
      name: codeGraphModule,
      config: { executable, ...(defaultMaxFiles === undefined ? {} : { defaultMaxFiles }) },
      isolate: { doppelgangerRuntimeSession: 'session', doppelgangerTools: 'session' },
    },
  ])
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('CodeGraph portable extension', () => {
  it('leaves a runtime unchanged when CodeGraph is omitted', async () => {
    const ctx = new Context()
    await ctx.plugin(ToolRegistry)
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await ctx.fiber.dispose()
  })

  it('registers the bounded CodeGraph tool surface only when composed', async () => {
    const harness = await setup()
    expect(harness.ctx.doppelgangerTools.snapshot().tools).toEqual([
      expect.objectContaining({ name: 'codegraph.explore', available: true }),
      expect.objectContaining({ name: 'codegraph.status', available: true }),
    ])
    expect(harness.ctx.doppelgangerTools.snapshot().tools.every(tool => tool.approval === undefined)).toBe(true)
    await dispose(harness)
    expect(harness.tools.snapshot().tools).toEqual([])
  })

  it('normalizes strict bounded configuration and rejects unsupported values', () => {
    expect(normalizeCodeGraphPluginConfig()).toEqual({
      executable: 'codegraph',
      statusTimeoutMs: 10_000,
      syncTimeoutMs: 120_000,
      exploreTimeoutMs: 30_000,
      shutdownTimeoutMs: 2_000,
      maximumExploreOutputBytes: 131_072,
      defaultMaxFiles: 8,
      maximumConcurrentExplorations: 2,
      maximumQueuedExplorations: 32,
    })
    expect(() => normalizeCodeGraphPluginConfig({ executable: 'relative' })).toThrow('absolute path')
    expect(() => normalizeCodeGraphPluginConfig({ maximumConcurrentExplorations: 9 })).toThrow('between 1 and 8')
    expect(() => normalizeCodeGraphPluginConfig({ unknown: true })).toThrow('unsupported fields')
  })

  it('activates through Cordis with the default executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-codegraph-default-'))
    temporaryRoots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const ctx = new Context()
    ctx.provide('doppelgangerRuntimeSession', Object.freeze({
      sessionId: 'codegraph-default-test',
      runtimePresetId: 'test',
      workspaceRoot: workspace,
    }))
    await ctx.plugin(ToolRegistry)
    const plugin = await ctx.plugin(CodeGraphPlugin, {})
    expect(ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toEqual([
      'codegraph.explore',
      'codegraph.status',
    ])
    await plugin.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts the tested standalone CodeGraph compatibility line', async () => {
    const harness = await setup()
    const first = await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')
    const second = await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')
    expect(first).toMatchObject({ ok: true, value: { binary: { available: true, version: '1.6.0', compatible: true } } })
    expect(second).toMatchObject({ ok: true })
    const log = await commandLog(harness.logPath)
    expect(log.filter(entry => (entry.args as string[])[0] === '--version')).toHaveLength(1)
    await dispose(harness)
  })

  it('diagnoses absent malformed and unsupported CodeGraph binaries without installation', async () => {
    const absent = await setup({ executable: join(tmpdir(), 'missing-codegraph') })
    expect(await absent.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: absent.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')).toMatchObject({
      ok: true,
      value: { binary: { available: false }, diagnosticCode: 'binary-unavailable' },
    })
    expect(await absent.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: absent.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'x' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_BINARY_UNAVAILABLE' },
    })
    await dispose(absent)

    vi.stubEnv('CODEGRAPH_FIXTURE_VERSION', '2.0.0')
    const unsupported = await setup()
    expect(await unsupported.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: unsupported.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')).toMatchObject({
      ok: true,
      value: { binary: { version: '2.0.0', compatible: false }, diagnosticCode: 'binary-incompatible' },
    })
    expect(await unsupported.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: unsupported.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'x' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_BINARY_INCOMPATIBLE' },
    })
    await dispose(unsupported)

    vi.stubEnv('CODEGRAPH_FIXTURE_VERSION', 'not-a-version')
    const malformed = await setup()
    expect(await malformed.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: malformed.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')).toMatchObject({
      ok: true,
      value: { binary: { available: true, version: 'not-a-version', compatible: false }, diagnosticCode: 'binary-incompatible' },
    })
    await dispose(malformed)
  })
  it('preserves status and exploration policy in both discovery call orders', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'version')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '100')
    for (const mode of ['missing', 'unavailable', 'incompatible'] as const) {
      vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', mode === 'unavailable' ? 'version' : '')
      vi.stubEnv('CODEGRAPH_FIXTURE_VERSION', mode === 'incompatible' ? '2.0.0' : '1.6.0')
      if (mode === 'unavailable') vi.stubEnv('CODEGRAPH_FIXTURE_STDERR', 'version unavailable')
      for (const statusFirst of [true, false]) {
        const config = mode === 'missing' ? { executable: join(tmpdir(), `missing-codegraph-${crypto.randomUUID()}`) } : {}
        const harness = await setup(config)
        const status = () => invokePortable(harness.tools, 'codegraph.status', {})
        const explore = () => invokePortable(harness.tools, 'codegraph.explore', { query: 'overlap' })
        const [first, second] = statusFirst ? await Promise.all([status(), explore()]) : await Promise.all([explore(), status()])
        const statusResult = statusFirst ? first : second
        const exploreResult = statusFirst ? second : first
        const unavailable = mode !== 'incompatible'
        expect(statusResult).toMatchObject({ ok: true, value: { diagnosticCode: unavailable ? 'binary-unavailable' : 'binary-incompatible' } })
        expect(exploreResult).toMatchObject({ ok: false, error: { code: unavailable ? 'CODEGRAPH_BINARY_UNAVAILABLE' : 'CODEGRAPH_BINARY_INCOMPATIBLE' } })
        const expectedCommands = mode === 'missing' ? [] : [['--version']]
        expect((await commandLog(harness.logPath)).map(entry => entry.args)).toEqual(expectedCommands)
        await dispose(harness)
      }
    }
  })

  it('retries failed shared discovery without publishing after disposal', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', 'version')
    const harness = await setup()
    expect(await invokePortable(harness.tools, 'codegraph.status', {})).toMatchObject({ ok: true, value: { diagnosticCode: 'binary-unavailable' } })
    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', '')
    expect(await invokePortable(harness.tools, 'codegraph.status', {})).toMatchObject({ ok: true, value: { binary: { compatible: true } } })
    await dispose(harness)

    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'version')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '250')
    const disposing = await setup()
    const pending = invokePortable(disposing.tools, 'codegraph.status', {})
    await vi.waitFor(async () => expect(await commandLog(disposing.logPath)).toHaveLength(1))
    await disposing.plugin.dispose()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CODEGRAPH_DISPOSED' } })
    expect(await invokePortable(disposing.tools, 'codegraph.status', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    expect((await commandLog(disposing.logPath)).map(entry => entry.args)).toEqual([['--version']])
    await disposing.ctx.fiber.dispose()
  })

  it('retries failed discovery and maps non-zero CodeGraph commands', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', 'version')
    vi.stubEnv('CODEGRAPH_FIXTURE_STDERR', 'version unavailable')
    const harness = await setup()
    expect(await invokePortable(harness.tools, 'codegraph.status', {})).toMatchObject({
      ok: true,
      value: { binary: { available: false }, diagnosticCode: 'binary-unavailable' },
    })
    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', '')
    expect(await invokePortable(harness.tools, 'codegraph.status', {})).toMatchObject({
      ok: true,
      value: { binary: { available: true, compatible: true }, explorationSafe: true },
    })
    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', 'explore')
    vi.stubEnv('CODEGRAPH_FIXTURE_STDERR', 'query failed locally')
    expect(await invokePortable(harness.tools, 'codegraph.explore', { query: 'failure' })).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_QUERY_FAILED', data: { stderr: 'query failed locally' } },
    })
    const log = await commandLog(harness.logPath)
    expect(log.filter(entry => (entry.args as string[])[0] === '--version')).toHaveLength(2)
    await dispose(harness)
  })

  it('binds every CodeGraph command to Runtime Session workspace metadata', async () => {
    const harness = await setup()
    await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')
    await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: '--path /tmp/escape', maxFiles: 3 } }, 'test-session')
    const log = await commandLog(harness.logPath)
    for (const entry of log) expect(entry.cwd).toBe(harness.workspace)
    expect(log.map(entry => entry.args)).toEqual([
      ['--version'],
      ['status', harness.workspace, '--json'],
      ['status', harness.workspace, '--json'],
      ['explore', '--path', harness.workspace, '--max-files', '3', '--', '--path /tmp/escape'],
    ])
    await dispose(harness)
  })

  it('rejects exploration without host-owned workspace metadata', async () => {
    const harness = await setup({}, false)
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')).toMatchObject({
      ok: true,
      value: { workspaceAvailable: false, diagnosticCode: 'workspace-unavailable' },
    })
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'memory flow' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_WORKSPACE_REQUIRED' },
    })
    expect(await commandLog(harness.logPath)).toEqual([])
    await dispose(harness)
  })

  it('normalizes a healthy machine-readable CodeGraph status', async () => {
    const harness = await setup()
    const status = healthyStatus(harness.workspace)
    status.futureField = { ignored: true }
    await writeFile(harness.statusPath, JSON.stringify(status))
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')).toMatchObject({
      ok: true,
      value: {
        workspaceAvailable: true,
        workspaceRoot: harness.workspace,
        explorationSafe: true,
        index: { fileCount: 12, nodeCount: 48, edgeCount: 96, state: 'complete', pendingRefs: 0 },
      },
    })
    await dispose(harness)
  })

  it('rejects invalid or oversized CodeGraph status output', async () => {
    const invalid = await setup()
    await writeFile(invalid.statusPath, '{not json')
    expect(await invokePortable(invalid.tools, 'codegraph.status', {})).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_STATUS_INVALID' },
    })
    await dispose(invalid)

    vi.stubEnv('CODEGRAPH_FIXTURE_FLOOD_COMMAND', 'status')
    vi.stubEnv('CODEGRAPH_FIXTURE_FLOOD_BYTES', String(CODEGRAPH_LIMITS.statusOutputBytes + 1))
    const oversized = await setup()
    expect(await invokePortable(oversized.tools, 'codegraph.status', {})).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_OUTPUT_LIMIT' },
    })
    await dispose(oversized)

    vi.stubEnv('CODEGRAPH_FIXTURE_FLOOD_COMMAND', '')
    vi.stubEnv('CODEGRAPH_FIXTURE_FLOOD_BYTES', '0')
    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', 'status')
    vi.stubEnv('CODEGRAPH_FIXTURE_STDERR', 'status failed')
    const unsuccessful = await setup()
    expect(await invokePortable(unsuccessful.tools, 'codegraph.status', {})).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_STATUS_INVALID', data: { stderr: 'status failed' } },
    })
    await dispose(unsuccessful)

    vi.stubEnv('CODEGRAPH_FIXTURE_FAIL_COMMAND', '')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'status')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '250')
    const timedOut = await setup({ statusTimeoutMs: 100, shutdownTimeoutMs: 20 })
    expect(await invokePortable(timedOut.tools, 'codegraph.status', {})).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_TIMEOUT' },
    })
    await dispose(timedOut)
  })

  it('refuses initialization rebuild and unsafe index states', async () => {
    const harness = await setup()
    const cases: Array<(status: Record<string, unknown>) => void> = [
      status => { status.initialized = false },
      status => { status.projectPath = dirname(harness.workspace) },
      status => { status.worktreeMismatch = { worktreeRoot: harness.workspace, indexRoot: dirname(harness.workspace) } },
      status => { (status.index as Record<string, unknown>).reindexRecommended = true },
      status => { (status.index as Record<string, unknown>).state = 'partial' },
      status => { (status.index as Record<string, unknown>).state = 'indexing' },
      status => { (status.index as Record<string, unknown>).state = 'failed' },
      status => { (status.index as Record<string, unknown>).state = null },
      status => { (status.index as Record<string, unknown>).builtWithVersion = '1.5.0' },
      status => { (status.index as Record<string, unknown>).builtWithExtractionVersion = 6 },
    ]
    for (const mutate of cases) {
      const status = healthyStatus(harness.workspace)
      mutate(status)
      await writeFile(harness.statusPath, JSON.stringify(status))
      const result = await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'unsafe' } }, 'test-session')
      expect(result).toMatchObject({ ok: false })
    }
    expect((await commandLog(harness.logPath)).every(entry => (entry.args as string[])[0] !== 'init' && (entry.args as string[])[0] !== 'index')).toBe(true)
    await dispose(harness)
  })

  it('synchronizes an existing changed index before exploration', async () => {
    const harness = await setup()
    const status = healthyStatus(harness.workspace)
    status.pendingChanges = { added: 1, modified: 2, removed: 0 }
    await writeFile(harness.statusPath, JSON.stringify(status))
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'capture path' } }, 'test-session')).toMatchObject({
      ok: true,
      value: { workspaceRoot: harness.workspace, maxFiles: 8, content: 'graph context' },
    })
    expect((await commandLog(harness.logPath)).map(entry => entry.args)).toEqual([
      ['--version'],
      ['status', harness.workspace, '--json'],
      ['sync', harness.workspace, '--quiet'],
      ['status', harness.workspace, '--json'],
      ['explore', '--path', harness.workspace, '--max-files', '8', '--', 'capture path'],
    ])
    await dispose(harness)
  })

  it('deduplicates concurrent synchronization and revalidates every waiting exploration', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'explore')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '75')
    const harness = await setup({ maximumConcurrentExplorations: 2 })
    const status = healthyStatus(harness.workspace)
    status.pendingChanges = { added: 0, modified: 1, removed: 0 }
    await writeFile(harness.statusPath, JSON.stringify(status))
    const [first, second] = await Promise.all([
      harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'one' } }, 'test-session'),
      harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'two' } }, 'test-session'),
    ])
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: true })
    const log = await commandLog(harness.logPath)
    const args = log.map(entry => entry.args as string[])
    expect(args.filter(value => value[0] === 'sync')).toHaveLength(1)
    expect(args.filter(value => value[0] === 'status').length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...log.filter(entry => (entry.args as string[])[0] === 'explore').map(entry => Number(entry.activeCount)))).toBe(2)
    await dispose(harness)
  })

  it('returns bounded graph-ranked source and call-path context', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_EXPLORE', '# Symbol\nsource\n\nCalls: a -> b\n')
    const harness = await setup()
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: '  memory write path  ', maxFiles: 4 } }, 'test-session')).toEqual({
      ok: true,
      value: { workspaceRoot: harness.workspace, maxFiles: 4, content: '# Symbol\nsource\n\nCalls: a -> b' },
    })
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: '' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_INVALID_INPUT' },
    })
    expect(await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'x', path: '/tmp' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_INVALID_INPUT' },
    })
    await dispose(harness)
  })

  it('fails closed on query timeout output and process bounds', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'explore')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '100')
    const timeout = await setup({ exploreTimeoutMs: 10, shutdownTimeoutMs: 10 })
    expect(await timeout.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: timeout.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'slow' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_TIMEOUT' },
    })
    await dispose(timeout)

    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '0')
    vi.stubEnv('CODEGRAPH_FIXTURE_FLOOD_COMMAND', 'explore')
    vi.stubEnv('CODEGRAPH_FIXTURE_FLOOD_BYTES', '2048')
    const output = await setup({ maximumExploreOutputBytes: 1024 })
    expect(await output.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: output.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'large' } }, 'test-session')).toMatchObject({
      ok: false,
      error: { code: 'CODEGRAPH_OUTPUT_LIMIT' },
    })
    await dispose(output)
  })

  it('spawns CodeGraph without a shell telemetry or caller-controlled arguments', async () => {
    const harness = await setup()
    await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: '$(touch /tmp/never)', maxFiles: 2 } }, 'test-session')
    const log = await commandLog(harness.logPath)
    expect(log).not.toEqual([])
    for (const entry of log) {

      expect(entry.cwd).toBe(harness.workspace)
      expect(entry.env).toEqual({ NO_COLOR: '1', FORCE_COLOR: '0', DO_NOT_TRACK: '1', CODEGRAPH_TELEMETRY: '0' })
      expect((entry.args as string[])[0]).not.toMatch(/^(?:init|index|uninit|install|upgrade|serve|daemon|ui|mcp)$/u)
    }
    await dispose(harness)
  })
  it('maps spawn failures and terminates a graceful child to settlement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-codegraph-runner-'))
    temporaryRoots.push(root)
    const workspace = await realpath(root)
    const missing = new CodeGraphProcessRunner(20)
    await expect(missing.run({
      executable: join(root, 'missing-executable'),
      args: [],
      cwd: workspace,
      timeoutMs: 100,
      maximumStdoutBytes: 1_024,
      maximumStderrBytes: 1_024,
    })).rejects.toMatchObject({ kind: 'spawn' })
    await missing.dispose()

    const logPath = join(root, 'graceful.jsonl')
    const runner = new CodeGraphProcessRunner(100, {
      ...process.env,
      CODEGRAPH_FIXTURE_LOG: logPath,
      CODEGRAPH_FIXTURE_DELAY_COMMAND: 'explore',
      CODEGRAPH_FIXTURE_DELAY_MS: '10000',
    })
    const operation = runner.run({
      executable: fixtureExecutable,
      args: ['explore'],
      cwd: workspace,
      timeoutMs: 20_000,
      maximumStdoutBytes: 1_024,
      maximumStderrBytes: 1_024,
    })
    await vi.waitFor(async () => expect(await commandLog(logPath)).toHaveLength(1))
    const processEntry = (await commandLog(logPath))[0]
    if (processEntry === undefined) throw new Error('fixture process was not recorded')
    const pid = processEntry.pid
    await runner.dispose()
    await expect(operation).rejects.toMatchObject({ kind: 'disposed' })
    expect(() => process.kill(Number(pid), 0)).toThrow()
  })

  it('bounds exploration concurrency and rejects excess queued work', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'explore')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '100')
    const harness = await setup({ maximumConcurrentExplorations: 1, maximumQueuedExplorations: 1 })
    const first = harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'one' } }, 'test-session')
    await new Promise(resolve => setTimeout(resolve, 25))
    const second = harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'two' } }, 'test-session')
    const third = await harness.ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: harness.ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: { query: 'three' } }, 'test-session')
    expect(third).toMatchObject({ ok: false, error: { code: 'CODEGRAPH_QUERY_FAILED' } })
    expect(await first).toMatchObject({ ok: true })
    expect(await second).toMatchObject({ ok: true })
    await dispose(harness)
  })

  it('terminates outstanding CodeGraph work and removes registrations on disposal', async () => {
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_COMMAND', 'explore')
    vi.stubEnv('CODEGRAPH_FIXTURE_DELAY_MS', '10000')
    vi.stubEnv('CODEGRAPH_FIXTURE_IGNORE_SIGTERM', '1')
    const harness = await setup({ shutdownTimeoutMs: 20, maximumConcurrentExplorations: 1, maximumQueuedExplorations: 1 })
    const invocation = invokePortable(harness.tools, 'codegraph.explore', { query: 'long running' })
    await vi.waitFor(async () => {
      const log = await commandLog(harness.logPath)
      expect(log.some(entry => (entry.args as string[] | undefined)?.[0] === 'explore')).toBe(true)
    })
    const queued = invokePortable(harness.tools, 'codegraph.explore', { query: 'queued' })
    await harness.plugin.dispose()
    expect(await invocation).toMatchObject({ ok: false, error: { code: 'CODEGRAPH_DISPOSED' } })
    expect(await queued).toMatchObject({ ok: false, error: { code: 'CODEGRAPH_DISPOSED' } })
    expect(await invokePortable(harness.tools, 'codegraph.status', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    expect(harness.tools.snapshot().tools).toEqual([])
    const log = await commandLog(harness.logPath)
    expect(log.filter(entry => (entry.args as string[] | undefined)?.[0] === 'explore')).toHaveLength(1)
    expect(log.some(entry => entry.signal === 'SIGTERM' && entry.command === 'explore')).toBe(true)
    await harness.ctx.fiber.dispose()
  })

  it('cuts over CodeGraph configuration only after committed reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-codegraph-reload-'))
    temporaryRoots.push(root)
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath)
    const workspace = await realpath(workspacePath)
    const loaderPath = join(root, 'runtime.cordis.json')
    const statusPath = join(root, 'status.json')
    const logPath = join(root, 'commands.jsonl')
    await writeFile(statusPath, JSON.stringify(healthyStatus(workspace)))
    await writeFile(loaderPath, codeGraphLoader(fixtureExecutable, 3))
    vi.stubEnv('CODEGRAPH_FIXTURE_STATUS_PATH', statusPath)
    vi.stubEnv('CODEGRAPH_FIXTURE_LOG', logPath)
    const reloads = reloadEvents()
    const failures = reloadEvents()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReload: reloads.push,
      onReloadFailure: failures.push,
    })
    let tools: ToolRegistryService | undefined
    const host: Plugin = {
      name: 'codegraph-reload-host',
      inject: ['doppelgangerTools'],
      apply(ctx: Context) { tools = ctx.doppelgangerTools },
    }
    const session = await runtime.activate({
      composition: createCompositionDefinition({ id: 'codegraph-reload', revision: 'one', loaderPath }),
      sessionId: 'codegraph-reload',
      workspaceRoot: workspace,
      protectedComposition: {
        entries: [
          { id: 'host', plugin: host },
        ],
      },
    })
    if (tools === undefined) throw new Error('host tools did not activate')
    expect(await invokePortable(tools, 'codegraph.explore', { query: 'before' })).toMatchObject({ ok: true, value: { maxFiles: 3 } })

    const committed = reloads.next('valid CodeGraph replacement')
    await writeFile(loaderPath, codeGraphLoader(fixtureExecutable, 5))
    const valid = await committed
    expect(await invokePortable(tools, 'codegraph.explore', { query: 'after' })).toMatchObject({ ok: true, value: { maxFiles: 5 } })

    const rejected = failures.next('invalid CodeGraph replacement')
    await writeFile(loaderPath, codeGraphLoader(fixtureExecutable, 0))
    const invalid = await rejected
    expect(invalid.compositionRevision).toBe(valid.compositionRevision)
    expect(invalid.diagnostics.reload).toMatchObject({ state: 'failed', error: expect.stringContaining('defaultMaxFiles') })
    expect(await invokePortable(tools, 'codegraph.explore', { query: 'retained' })).toMatchObject({ ok: true, value: { maxFiles: 5 } })

    const removed = reloads.next('CodeGraph removal')
    await writeFile(loaderPath, JSON.stringify([{
      id: 'tools',
      name: '@doppelganger/doppelganger-protocols/tools',
      isolate: { doppelgangerTools: 'session' },
    }]))
    await removed
    expect(tools.snapshot().tools).toEqual([])
    expect(await invokePortable(tools, 'codegraph.status', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    await session.dispose()
    await runtime.dispose()
  })

  it('is Loader-visible with isolated protocol services', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    let projected: readonly string[] = []
    const metadata: Plugin = {
      name: 'codegraph-test-metadata',
      apply(child) {
        child.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: 'loader', runtimePresetId: 'test' }))
      },
    }
    const observer: Plugin = {
      name: 'codegraph-test-observer',
      inject: ['doppelgangerTools'],
      apply(child) { projected = child.doppelgangerTools.snapshot().tools.map(tool => tool.name) },
    }
    ctx.loader.builtins.metadata = metadata
    ctx.loader.builtins.tools = ToolRegistry
    ctx.loader.builtins.codegraph = CodeGraphPlugin
    ctx.loader.builtins.observer = observer
    await ctx.loader.create({ name: 'cordis:metadata', isolate: { doppelgangerRuntimeSession: 'session' } })
    await ctx.loader.create({ name: 'cordis:tools', isolate: { doppelgangerTools: 'session' } })
    await ctx.loader.create({ name: 'cordis:codegraph', isolate: { doppelgangerRuntimeSession: 'session', doppelgangerTools: 'session' }, config: { executable: fixtureExecutable } })
    await ctx.loader.create({ name: 'cordis:observer', isolate: { doppelgangerTools: 'session' } })
    expect(projected).toEqual(['codegraph.explore', 'codegraph.status'])
    await ctx.fiber.dispose()
  })
})
