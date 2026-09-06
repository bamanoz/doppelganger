import { spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'

const wrapper = fileURLToPath(new URL('../with-memory-postgresql.mjs', import.meta.url))
const temporaryRoots: string[] = []
const fixtureProcesses: ChildProcess[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-memory-postgresql-gate-'))
  temporaryRoots.push(root)
  return root
}

async function put(root: string, path: string, content: string, executable = false): Promise<string> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  if (executable) await chmod(target, 0o755)
  return target
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      await access(path)
      return await readFile(path, 'utf8')
    } catch {
      await delay(20)
    }
  }
  throw new Error(`Timed out waiting for fixture file ${path}`)
}

function runWrapper(args: string[], env: NodeJS.ProcessEnv) {
  const { promise, resolve, reject } = Promise.withResolvers<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>()
  const child = spawn(process.execPath, [wrapper, '--', ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  return promise
}

async function fakeDocker(root: string): Promise<{ bin: string, log: string }> {
  const log = join(root, 'docker-calls.jsonl')
  const bin = await put(root, 'bin/docker', `#!/usr/bin/env ${process.execPath}
import { appendFile } from 'node:fs/promises'
const log = ${JSON.stringify(log)}
const args = process.argv.slice(2)
await appendFile(log, JSON.stringify(args) + '\\n')
switch (args[0]) {
  case 'version':
    console.log('27.0.0')
    break
  case 'run':
    if (process.env.FAKE_DOCKER_RUN_EXIT) process.exitCode = Number(process.env.FAKE_DOCKER_RUN_EXIT)
    else console.log('fixture-container-id')
    break
  case 'port':
    console.log('127.0.0.1:55432')
    break
  case 'exec':
    console.log('1')
    break
  case 'rm':
    break
  default:
    process.exitCode = 64
}
`, true)
  return { bin: dirname(bin), log }
}

async function fixtureCommand(root: string, exitCode: number, readyFile?: string): Promise<string> {
  return put(root, 'fixture-command.mjs', `#!/usr/bin/env ${process.execPath}
import { writeFile } from 'node:fs/promises'
await writeFile(process.argv[2], process.env.DOPPELGANGER_TEST_POSTGRESQL_DSN ?? '')
${readyFile ? `await writeFile(${JSON.stringify(readyFile)}, 'ready')
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
await new Promise(() => {})` : `process.exitCode = ${exitCode}`}
`, true)
}

async function startPostgreSqlProtocolFixture(root: string): Promise<{ dsn: string, process: ChildProcess }> {
  const portFile = join(root, 'postgresql-port')
  const server = await put(root, 'postgresql-fixture.mjs', `
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

function int16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeInt16BE(value)
  return buffer
}
function int32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value)
  return buffer
}
function message(type, payload) {
  return Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload])
}

const server = createServer(socket => {
  let startup = true
  let input = Buffer.alloc(0)
  socket.on('data', chunk => {
    input = Buffer.concat([input, chunk])
    while (true) {
      if (startup) {
        if (input.length < 4) return
        const length = input.readInt32BE(0)
        if (input.length < length) return
        input = input.subarray(length)
        startup = false
        socket.write(message('R', int32(0)))
        socket.write(message('Z', Buffer.from('I')))
        continue
      }
      if (input.length < 5) return
      const length = input.readInt32BE(1)
      const total = length + 1
      if (input.length < total) return
      const type = input.subarray(0, 1).toString('utf8')
      input = input.subarray(total)
      if (type === 'Q') {
        socket.write(message('C', Buffer.from('SELECT 1\\0')))
        socket.write(message('Z', Buffer.from('I')))
      } else if (type === 'X') {
        socket.end()
        return
      }
    }
  })
})
server.listen(0, '127.0.0.1', async () => {
  const address = server.address()
  await writeFile(${JSON.stringify(portFile)}, String(address.port))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`)
  const child = spawn(process.execPath, [server], { stdio: 'ignore' })
  fixtureProcesses.push(child)
  const port = (await waitForFile(portFile)).trim()
  return {
    dsn: `postgresql://fixture_user:fixture-secret@127.0.0.1:${port}/fixture?sslmode=disable`,
    process: child,
  }
}

afterEach(async () => {
  for (const child of fixtureProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('required PostgreSQL memory backend gate', () => {
  it('fails the required backend gate when PostgreSQL is unavailable', async () => {
    const root = await fixture()
    const childMarker = join(root, 'child-ran')
    const command = await fixtureCommand(root, 0)
    const env = { ...process.env, PATH: join(root, 'empty-bin') }
    delete env.DOPPELGANGER_TEST_POSTGRESQL_DSN

    const result = await runWrapper([command, childMarker], env)

    expect(result.code).toBe(1)
    expect(result.signal).toBeNull()
    expect(result.stderr).toContain('Docker with a reachable daemon is required for the PostgreSQL backend gate.')
    expect(result.stderr).not.toContain('skip')
    await expect(access(childMarker)).rejects.toThrow()
  })

  it('passes an explicitly supplied ready test DSN to the command without invoking Docker', async () => {
    const root = await fixture()
    const { bin, log } = await fakeDocker(root)
    const { dsn } = await startPostgreSqlProtocolFixture(root)
    const observedDsn = join(root, 'observed-dsn')
    const command = await fixtureCommand(root, 0)

    const result = await runWrapper([command, observedDsn], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DOPPELGANGER_TEST_POSTGRESQL_DSN: dsn,
    })

    expect(result).toMatchObject({ code: 0, signal: null, stdout: '', stderr: '' })
    expect(await readFile(observedDsn, 'utf8')).toBe(dsn)
    expect(result.stdout + result.stderr).not.toContain('fixture-secret')
    await expect(access(log)).rejects.toThrow()
  })

  it('rejects an unavailable explicit test DSN without invoking the command or Docker', async () => {
    const root = await fixture()
    const { bin, log } = await fakeDocker(root)
    const childMarker = join(root, 'child-ran')
    const command = await fixtureCommand(root, 0)
    const dsn = 'postgresql://fixture_user:unavailable-secret@127.0.0.1:1/fixture?sslmode=disable'

    const result = await runWrapper([command, childMarker], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DOPPELGANGER_TEST_POSTGRESQL_DSN: dsn,
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('The PostgreSQL service supplied through DOPPELGANGER_TEST_POSTGRESQL_DSN is unavailable.')
    expect(result.stdout + result.stderr).not.toContain('unavailable-secret')
    await expect(access(childMarker)).rejects.toThrow()
    await expect(access(log)).rejects.toThrow()
  })

  it('removes the allocated fixture name when Docker fails during container startup', async () => {
    const root = await fixture()
    const { bin, log } = await fakeDocker(root)
    const childMarker = join(root, 'child-ran')
    const command = await fixtureCommand(root, 0)
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_DOCKER_RUN_EXIT: '125',
    }
    delete env.DOPPELGANGER_TEST_POSTGRESQL_DSN

    const result = await runWrapper([command, childMarker], env)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unable to start the disposable PostgreSQL 17 backend fixture.')
    expect(calls.filter(call => call[0] === 'run')).toHaveLength(1)
    expect(calls.filter(call => call[0] === 'rm')).toHaveLength(1)
    await expect(access(childMarker)).rejects.toThrow()
  })

  it('provisions PostgreSQL 17 on loopback, preserves child status, and removes the failed command fixture once', async () => {
    const root = await fixture()
    const { bin, log } = await fakeDocker(root)
    const observedDsn = join(root, 'observed-dsn')
    const command = await fixtureCommand(root, 23)
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
    delete env.DOPPELGANGER_TEST_POSTGRESQL_DSN

    const result = await runWrapper([command, observedDsn], env)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    const run = calls.find(call => call[0] === 'run')
    const removes = calls.filter(call => call[0] === 'rm')
    const dsn = await readFile(observedDsn, 'utf8')

    expect(result.code).toBe(23)
    expect(run).toContain('postgres@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675')
    expect(run).toContain('127.0.0.1::5432/tcp')
    expect(run).not.toContain('5432:5432')
    expect(run).not.toContain('--volume')
    expect(run).not.toContain('-v')
    expect(calls.some(call => call[0] === 'exec' && call.includes('SELECT 1;'))).toBe(true)
    expect(removes).toHaveLength(1)
    expect(removes[0]).toEqual(expect.arrayContaining(['rm', '--force']))
    expect(dsn).toMatch(/^postgresql:\/\/doppelganger_[a-f0-9]{10}:[a-f0-9]+@127\.0\.0\.1:55432\/memory_[a-f0-9]{10}$/u)
    expect(result.stdout + result.stderr).not.toContain(dsn)
  })

  it('reports a missing verification command and still removes the disposable fixture once', async () => {
    const root = await fixture()
    const { bin, log } = await fakeDocker(root)
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
    delete env.DOPPELGANGER_TEST_POSTGRESQL_DSN

    const result = await runWrapper(['missing-memory-backend-verification-command'], env)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unable to start backend verification command: ENOENT.')
    expect(calls.filter(call => call[0] === 'rm')).toHaveLength(1)
  })

  it('forwards interruption to the command and removes the disposable fixture exactly once', async () => {
    const root = await fixture()
    const { bin, log } = await fakeDocker(root)
    const observedDsn = join(root, 'observed-dsn')
    const ready = join(root, 'child-ready')
    const command = await fixtureCommand(root, 0, ready)
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
    delete env.DOPPELGANGER_TEST_POSTGRESQL_DSN
    const wrapperProcess = spawn(process.execPath, [wrapper, '--', command, observedDsn], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    fixtureProcesses.push(wrapperProcess)
    const { promise: closed, resolve, reject } = Promise.withResolvers<{ code: number | null, signal: NodeJS.Signals | null }>()
    wrapperProcess.on('error', reject)
    wrapperProcess.on('close', (code, signal) => resolve({ code, signal }))

    await waitForFile(ready)
    wrapperProcess.kill('SIGTERM')
    const result = await closed
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])

    expect(result).toEqual({ code: null, signal: 'SIGTERM' })
    expect(calls.filter(call => call[0] === 'rm')).toHaveLength(1)
  })
})
