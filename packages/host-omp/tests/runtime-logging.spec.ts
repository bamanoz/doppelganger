import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeLogRecord } from '@doppelganger/doppelganger-composition-runtime'
import { OMP_RPC_PROTOCOL_VERSION, OMP_RUNTIME_HOST_CAPABILITIES } from '../src/contracts.ts'
import { OmpAdapterSession, type OmpChildConnection } from '../src/adapter.ts'
import { ContentLengthDecoder, FramedJsonRpcPeer, type RpcMessage } from '../src/protocol.ts'

const temporaryRoots: string[] = []

interface ChildHarness {
  readonly child: ChildProcessWithoutNullStreams
  readonly peer: FramedJsonRpcPeer
  readonly stdout: Buffer[]
  readonly stderr: Buffer[]
}

interface AdapterHarness {
  readonly adapter: OmpAdapterSession
  readonly child: ChildHarness
}

interface RetentionConfig {
  readonly maxAgeDays: number
  readonly maxTotalBytes: number
  readonly cleanupIntervalMs: number
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>()
  const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 3_000)
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

async function harness(): Promise<ChildHarness> {
  const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
  const child = spawn(process.execPath, ['--no-warnings', childPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  if (child.stdin === null || child.stdout === null || child.stderr === null) throw new Error('child stdio unavailable')
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', chunk => { stdout.push(Buffer.from(chunk)) })
  child.stderr.on('data', chunk => { stderr.push(Buffer.from(chunk)) })
  return { child, peer: new FramedJsonRpcPeer(child.stdout, child.stdin), stdout, stderr }
}

async function dispose(child: ChildHarness): Promise<void> {
  if (child.child.killed || child.child.exitCode !== null || child.child.signalCode !== null) return
  const exited = once(child.child, 'exit')
  await timeout(child.peer.request('session.dispose'), 'session.dispose')
  await timeout(exited.then(() => undefined), 'child exit')
}

async function waitFor<T>(label: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`${label} timed out`)
}

async function preset(retentionPayloadRecords = 0): Promise<{ root: string; pathTemplate: string }> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-logging-'))
  temporaryRoots.push(root)
  const pathTemplate = join(root, 'runtime-{runtimeActivationId}.jsonl')
  await Promise.all([
    writeFile(join(root, 'producer.mjs'), [
      'export default {',
      "  name: 'omp-logging-producer',",
      '  apply(ctx) {',
      "    const logger = ctx.logger('omp-runtime')",
      "    logger.info('ordinary child log %s', 'record')",
      `    for (let index = 0; index < ${retentionPayloadRecords}; index += 1) logger.info('retention payload %s', 'x'.repeat(8192))`,
      '  },',
      '}',
      '',
    ].join('\n')),
    writeFile(join(root, 'runtime.cordis.yml'), [
      '- id: producer',
      '  name: ./producer.mjs',
      '',
    ].join('\n')),
  ])
  return { root, pathTemplate }
}

function serializedActivation(
  root: string,
  sessionId: string,
  pathTemplate?: string,
  retention?: RetentionConfig,
) {
  return {
    composition: {
      id: 'omp-logging-test',
      revision: 'authored-one',
      loaderPath: join(root, 'runtime.cordis.yml'),
      patches: pathTemplate === undefined ? [] : [{
        source: 'explicit logging patch',
        baseUrl: root,
        patches: [{ insert: [{
          id: 'runtime-logs-file',
          name: '@doppelganger/doppelganger-logging-file/loader',
          inject: ['doppelgangerLogging'],
          isolate: { doppelgangerLogging: 'session' },
          config: {
            pathTemplate,
            level: 'info',
            maxBytes: 65_536,
            maxFiles: 1,
            maximumPendingRecords: 16,
            ...(retention === undefined ? {} : { retention }),
          },
        }] }],
      }],
    },
    sessionId,
    workspaceRoot: root,
    hostKind: 'omp' as const,
    watch: false,
    hostExtensions: {
      modules: [],
      selections: [
        { id: 'actor', config: null },
        { id: 'omp-host-events', config: null },
        { id: 'runtime-host', config: null },
      ],
      facts: { hostKind: 'omp' as const },
    },
  }
}

function activation(root: string, sessionId: string, pathTemplate?: string, retention?: RetentionConfig) {
  return {
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
    ...serializedActivation(root, sessionId, pathTemplate, retention),
  }
}

async function adapterHarness(
  root: string,
  sessionId: string,
  pathTemplate: string,
  retention: RetentionConfig,
): Promise<AdapterHarness> {
  const child = await harness()
  if (child.child.pid === undefined) throw new Error('real child has no process ID')
  const connection: OmpChildConnection = {
    processId: child.child.pid,
    request: (method, params) => child.peer.request(method, params),
    onNotification: (method, handler) => child.peer.onNotification(method, handler),
    async dispose() {
      const running = !child.child.killed && child.child.exitCode === null && child.child.signalCode === null
      await dispose(child)
      return { outcome: 'graceful', sessionDisposeAcknowledged: running }
    },
  }
  const adapter = new OmpAdapterSession({
    activation: serializedActivation(root, sessionId, pathTemplate, retention),
    childFactory: { start: async () => connection },
  })
  const started = await adapter.start()
  if (started.state !== 'active') {
    await adapter.dispose()
    throw new Error(started.diagnostic?.message ?? 'OMP logging adapter did not activate')
  }
  return { adapter, child }
}

async function disposeAdapter(harness: AdapterHarness | undefined): Promise<void> {
  if (harness === undefined) return
  try {
    await harness.adapter.dispose()
  } finally {
    await dispose(harness.child)
  }
}

async function records(path: string): Promise<RuntimeLogRecord[] | undefined> {
  try {
    const source = await readFile(path, 'utf8')
    if (!source.endsWith('\n')) return undefined
    return source.trimEnd().split('\n').map(line => JSON.parse(line) as RuntimeLogRecord)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function activationFiles(root: string): Promise<Array<{ path: string; records: RuntimeLogRecord[] }>> {
  const names = (await readdir(root)).filter(name => name.endsWith('.jsonl')).sort()
  const files: Array<{ path: string; records: RuntimeLogRecord[] }> = []
  for (const name of names) {
    const path = join(root, name)
    const parsed = await records(path)
    if (parsed !== undefined) files.push({ path, records: parsed })
  }
  return files
}

async function familyFiles(root: string, activePath: string): Promise<string[]> {
  const family = basename(activePath)
  return (await readdir(root))
    .filter(name => name === family || name.startsWith(`${family}.`))
    .sort()
}

async function completeRotatedFamily(root: string, activePath: string): Promise<boolean> {
  const names = await familyFiles(root, activePath)
  if (names.length <= 1) return false
  for (const name of names) {
    if (await records(join(root, name)) === undefined) return false
  }
  return true
}

function decodedStdout(child: ChildHarness): readonly RpcMessage[] {
  const decoder = new ContentLengthDecoder()
  return decoder.push(Buffer.concat(child.stdout))
}

function expectLoggingNeutralTransport(child: ChildHarness): void {
  const raw = Buffer.concat(child.stdout).toString('utf8')
  const decoded = decodedStdout(child)
  expect(decoded.length).toBeGreaterThan(0)
  expect(raw).not.toContain('ordinary child log')
  expect(decoded.some(message => 'method' in message && /log/iu.test(message.method))).toBe(false)
  expect(Buffer.concat(child.stderr).toString('utf8')).toBe('')
}

describe('OMP runtime logging', () => {
  it('writes configured child file logs without changing framed RPC or host reports', async () => {
    const fixture = await preset()
    const child = await harness()
    try {
      await timeout(child.peer.request('session.activate', activation(fixture.root, 'configured-child', fixture.pathTemplate)), 'logging activation')
      const written = await waitFor('configured child log', async () => {
        const files = await activationFiles(fixture.root)
        const file = files.find(candidate => candidate.records.some(record => record.logger === 'omp-runtime' && record.message === 'ordinary child log record'))
        return file
      })
      const record = written.records.find(candidate => candidate.logger === 'omp-runtime' && candidate.message === 'ordinary child log record')!
      expect(record).toMatchObject({
        logger: 'omp-runtime',
        message: 'ordinary child log record',
        sessionId: 'configured-child',
        runtimePresetId: 'omp-logging-test',
      })
      expect(written.path).toBe(fixture.pathTemplate.replace('{runtimeActivationId}', record.runtimeActivationId))
      await expect(child.peer.request('runtime.diagnostics')).resolves.toMatchObject({
        diagnostics: { entries: expect.any(Array) },
      })
    } finally {
      await dispose(child)
    }
    expectLoggingNeutralTransport(child)
  })

  it('keeps exporter-omitting OMP sessions silent and preserves stdout framing', async () => {
    const fixture = await preset()
    const child = await harness()
    try {
      await timeout(child.peer.request('session.activate', activation(fixture.root, 'silent-child')), 'silent activation')
      await expect(child.peer.request('runtime.diagnostics')).resolves.toMatchObject({
        diagnostics: { entries: expect.any(Array) },
      })
      expect(await activationFiles(fixture.root)).toEqual([])
    } finally {
      await dispose(child)
    }
    expectLoggingNeutralTransport(child)
  })

  it('isolates concurrent OMP children using one authored path template and logical session ID', async () => {
    const fixture = await preset()
    const children = await Promise.all([harness(), harness()])
    try {
      await Promise.all(children.map(child => child.peer.request(
        'session.activate',
        activation(fixture.root, 'shared-child-session', fixture.pathTemplate),
      )))
      const files = await waitFor('isolated child logs', async () => {
        const candidates = (await activationFiles(fixture.root)).filter(file => (
          file.records.some(record => record.logger === 'omp-runtime' && record.message === 'ordinary child log record')
        ))
        return candidates.length === 2 ? candidates : undefined
      })
      const activationIds = files.map(file => file.records.find(record => record.logger === 'omp-runtime')!.runtimeActivationId)
      expect(new Set(activationIds).size).toBe(2)
      expect(files.every(file => file.records.every(record => record.sessionId === 'shared-child-session'))).toBe(true)
      expect(files.every((file, index) => file.path === fixture.pathTemplate.replace('{runtimeActivationId}', activationIds[index]!))).toBe(true)
    } finally {
      await Promise.all(children.map(dispose))
    }
    for (const child of children) expectLoggingNeutralTransport(child)
  })

  it('cleans an exited activation on real-child startup while retaining a concurrent live family and framed transport', async () => {
    const fixture = await preset(10)
    const retention = { maxAgeDays: 3_650, maxTotalBytes: 65_536, cleanupIntervalMs: 60_000 }
    const sessionId = 'raw-shared-session-id'
    const activationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    let exited: AdapterHarness | undefined
    let live: AdapterHarness | undefined
    let collector: AdapterHarness | undefined
    try {
      exited = await adapterHarness(fixture.root, sessionId, fixture.pathTemplate, retention)
      const exitedFile = await waitFor('exited activation rotation', async () => {
        const files = await activationFiles(fixture.root)
        const file = files.length === 1 && files[0]!.records.length > 0 ? files[0] : undefined
        return file !== undefined && await completeRotatedFamily(fixture.root, file.path) ? file : undefined
      })
      const exitedActivationId = exitedFile.records[0]!.runtimeActivationId
      expect(exitedActivationId).toMatch(activationIdPattern)
      expect(exitedFile.path).toBe(fixture.pathTemplate.replace('{runtimeActivationId}', exitedActivationId))
      expect(basename(exitedFile.path)).not.toContain(sessionId)

      live = await adapterHarness(fixture.root, sessionId, fixture.pathTemplate, retention)
      const liveFile = await waitFor('live activation rotation', async () => {
        const files = await activationFiles(fixture.root)
        const file = files.find(candidate => candidate.path !== exitedFile.path && candidate.records.length > 0)
        return file !== undefined && await completeRotatedFamily(fixture.root, file.path) ? file : undefined
      })
      const liveActivationId = liveFile.records[0]!.runtimeActivationId
      expect(liveActivationId).toMatch(activationIdPattern)
      expect(liveFile.path).toBe(fixture.pathTemplate.replace('{runtimeActivationId}', liveActivationId))
      expect(basename(liveFile.path)).not.toContain(sessionId)
      expect(await familyFiles(fixture.root, exitedFile.path)).not.toEqual([])

      await exited.adapter.dispose()
      expect(await familyFiles(fixture.root, exitedFile.path)).not.toEqual([])

      collector = await adapterHarness(fixture.root, sessionId, fixture.pathTemplate, retention)
      const retained = await waitFor('startup retention cleanup', async () => {
        const files = await activationFiles(fixture.root)
        const collectorFile = files.find(file => file.path !== liveFile.path && file.records.length > 0)
        if (collectorFile === undefined || await familyFiles(fixture.root, exitedFile.path).then(paths => paths.length > 0)) return undefined
        if (await familyFiles(fixture.root, liveFile.path).then(paths => paths.length === 0)) return undefined
        return { files, collectorFile }
      })
      const collectorActivationId = retained.collectorFile.records[0]!.runtimeActivationId
      expect(collectorActivationId).toMatch(activationIdPattern)
      expect(new Set([exitedActivationId, liveActivationId, collectorActivationId]).size).toBe(3)
      expect(retained.collectorFile.path).toBe(fixture.pathTemplate.replace('{runtimeActivationId}', collectorActivationId))
      expect(basename(retained.collectorFile.path)).not.toContain(sessionId)
      expect(retained.files.every(file => file.records.every(record => record.sessionId === sessionId))).toBe(true)
      await expect(live.adapter.connection()!.request('runtime.diagnostics')).resolves.toMatchObject({
        diagnostics: { entries: expect.any(Array) },
      })
      await expect(collector.adapter.connection()!.request('runtime.diagnostics')).resolves.toMatchObject({
        diagnostics: { entries: expect.any(Array) },
      })
    } finally {
      await Promise.all([disposeAdapter(exited), disposeAdapter(live), disposeAdapter(collector)])
    }
    for (const harness of [exited, live, collector]) {
      if (harness !== undefined) expectLoggingNeutralTransport(harness.child)
    }
  })
})
