import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeLogRecord } from '@doppelganger/doppelganger-composition-runtime'
import { OMP_RPC_PROTOCOL_VERSION, OMP_RUNTIME_HOST_CAPABILITIES } from '../src/contracts.ts'
import { ContentLengthDecoder, FramedJsonRpcPeer, type RpcMessage } from '../src/protocol.ts'

const temporaryRoots: string[] = []

interface ChildHarness {
  readonly child: ChildProcessWithoutNullStreams
  readonly peer: FramedJsonRpcPeer
  readonly stdout: Buffer[]
  readonly stderr: Buffer[]
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

async function preset(sessionId: string): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-logging-'))
  temporaryRoots.push(root)
  const path = join(root, `${sessionId}.jsonl`)
  await Promise.all([
    writeFile(join(root, 'producer.mjs'), [
      'export default {',
      "  name: 'omp-logging-producer',",
      "  apply(ctx) { ctx.logger('omp-runtime').info('ordinary child log %s', 'record') },",
      '}',
      '',
    ].join('\n')),
    writeFile(join(root, 'runtime.cordis.yml'), [
      '- id: producer',
      '  name: ./producer.mjs',
      '',
    ].join('\n')),
  ])
  return { root, path }
}

function activation(root: string, sessionId: string, path?: string) {
  return {
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
    composition: {
      id: 'omp-logging-test',
      revision: 'authored-one',
      loaderPath: join(root, 'runtime.cordis.yml'),
      patches: path === undefined ? [] : [{
        source: 'explicit logging patch',
        baseUrl: root,
        patches: [{ insert: [{
          id: 'runtime-logs-file',
          name: '@doppelganger/doppelganger-logging-file/loader',
          inject: ['doppelgangerLogging'],
          isolate: { doppelgangerLogging: 'session' },
          config: {
            path,
            level: 'info',
            maxBytes: 65_536,
            maxFiles: 1,
            maximumPendingRecords: 16,
          },
        }] }],
      }],
    },
    sessionId,
    workspaceRoot: root,
    hostKind: 'omp' as const,
    watch: false,
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
    const fixture = await preset('configured-child')
    const child = await harness()
    try {
      await timeout(child.peer.request('session.activate', activation(fixture.root, 'configured-child', fixture.path)), 'logging activation')
      const written = await waitFor('configured child log', async () => {
        const value = await records(fixture.path)
        return value?.some(record => record.logger === 'omp-runtime' && record.message === 'ordinary child log record') ? value : undefined
      })
      expect(written.find(record => record.logger === 'omp-runtime' && record.message === 'ordinary child log record')).toMatchObject({
        logger: 'omp-runtime',
        message: 'ordinary child log record',
        sessionId: 'configured-child',
        runtimePresetId: 'omp-logging-test',
      })
      await expect(child.peer.request('runtime.diagnostics')).resolves.toMatchObject({
        diagnostics: { entries: expect.any(Array) },
      })
    } finally {
      await dispose(child)
    }
    expectLoggingNeutralTransport(child)
  })

  it('keeps exporter-omitting OMP sessions silent and preserves stdout framing', async () => {
    const fixture = await preset('silent-child')
    const child = await harness()
    try {
      await timeout(child.peer.request('session.activate', activation(fixture.root, 'silent-child')), 'silent activation')
      await expect(child.peer.request('runtime.diagnostics')).resolves.toMatchObject({
        diagnostics: { entries: expect.any(Array) },
      })
      await expect(readFile(fixture.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await dispose(child)
    }
    expectLoggingNeutralTransport(child)
  })

  it('isolates separate OMP children to distinct configured paths', async () => {
    const fixtures = await Promise.all([preset('first-child'), preset('second-child')])
    const children = await Promise.all([harness(), harness()])
    try {
      await Promise.all(children.map((child, index) => child.peer.request(
        'session.activate',
        activation(fixtures[index]!.root, index === 0 ? 'first-child' : 'second-child', fixtures[index]!.path),
      )))
      const results = await Promise.all(fixtures.map(fixture => waitFor('isolated child log', async () => {
        const value = await records(fixture.path)
        return value?.some(record => record.logger === 'omp-runtime' && record.message === 'ordinary child log record') ? value : undefined
      })))
      expect(results[0]!.every(record => record.sessionId === 'first-child')).toBe(true)
      expect(results[1]!.every(record => record.sessionId === 'second-child')).toBe(true)
    } finally {
      await Promise.all(children.map(dispose))
    }
    for (const child of children) expectLoggingNeutralTransport(child)
  })
})
