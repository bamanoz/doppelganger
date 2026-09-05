import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { access, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RuntimeLoggingService } from '@doppelganger/doppelganger-composition-runtime'
import { FileLoggingPlugin } from '../src/plugin.ts'
import { normalizeFileLoggingConfig, resolveFileLoggingConfig, RollingJsonlWriter, type FileLogRetentionStatus } from '../src/index.ts'
import { FileLogRetention } from '../src/retention.ts'

const roots: string[] = []
const writers: RollingJsonlWriter[] = []
const children: ChildProcess[] = []
const dayMs = 86_400_000
let commandId = 0

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'doppelganger-log-retention-'))
  roots.push(path)
  return path
}

function config(directory: string, activationId = randomUUID(), retention = {}) {
  return resolveFileLoggingConfig(normalizeFileLoggingConfig({
    pathTemplate: join(directory, 'runtime-{runtimeActivationId}.jsonl'),
    maxBytes: 65_536, maxFiles: 2, retention,
  }), { runtimeActivationId: activationId, sessionId: 'retention-session', runtimePresetId: 'retention-test' })
}

async function openWriter(directory: string, retention = {}, activationId = randomUUID()) {
  const resolved = config(directory, activationId, retention)
  const writer = await RollingJsonlWriter.open(resolved)
  writers.push(writer)
  return { writer, path: resolved.path, activationId }
}

interface Message {
  readonly id?: number
  readonly ready?: boolean
  readonly ok?: boolean
  readonly path?: string
  readonly error?: string
  readonly status?: FileLogRetentionStatus
}

function receive(child: ChildProcess, accepts: (message: Message) => boolean): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('retention worker response timed out')), 10_000)
    const onMessage = (message: Message) => { if (accepts(message)) finish(undefined, message) }
    const onExit = (code: number | null, signal: string | null) => finish(new Error(`retention worker exited: ${code}/${signal}`))
    const onError = (error: Error) => finish(error)
    function finish(error?: Error, message?: Message) {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error !== undefined) reject(error)
      else resolve(message!)
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function command(child: ChildProcess, operation: string, options: Record<string, unknown> = {}) {
  const id = ++commandId
  const response = receive(child, message => message.id === id)
  child.send({ id, operation, ...options })
  const message = await response
  if (!message.ok) throw new Error(message.error)
  return message
}

async function worker(directory: string, retention = {}, activationId = randomUUID()) {
  const child = fork(fileURLToPath(new URL('./fixtures/retention-worker.mjs', import.meta.url)), [JSON.stringify({
    activationId,
    config: { pathTemplate: join(directory, 'runtime-{runtimeActivationId}.jsonl'), maxBytes: 65_536, maxFiles: 2, retention },
  })], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] })
  children.push(child)
  let diagnostics = ''
  child.stderr?.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-8_192) })
  child.stdout?.resume()
  try {
    const ready = await receive(child, message => message.ready === true)
    return { child, path: ready.path!, activationId, status: ready.status }
  } catch (error) {
    throw new Error(`${String(error)}\n${diagnostics}`)
  }
}

async function exitWorker(child: ChildProcess, signal?: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (signal !== undefined) child.kill(signal)
  else await command(child, 'exit')
  await exited
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function age(path: string, days: number) {
  const time = new Date(Date.now() - days * dayMs)
  await utimes(path, time, time)
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(child => exitWorker(child, 'SIGKILL')))
  await Promise.all(writers.splice(0).map(writer => writer.close()))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('activation log retention', () => {
  it('removes expired exited-owner families and all numbered generations at startup', async () => {
    const directory = await root()
    const old = await worker(directory)
    await command(old.child, 'write', { count: 8, message: 'x'.repeat(20_000) })
    await exitWorker(old.child)
    for (const path of [old.path, `${old.path}.1`, `${old.path}.2`]) await age(path, 8)
    // A generation left by an older, larger maxFiles setting belongs to the same family.
    await writeFile(`${old.path}.99`, 'old backup')
    await age(`${old.path}.99`, 8)
    const current = await openWriter(directory)
    expect(await exists(current.path)).toBe(true)
    for (const path of [old.path, `${old.path}.1`, `${old.path}.2`, `${old.path}.99`]) expect(await exists(path)).toBe(false)
    expect(current.writer.retentionStatus?.removedFiles).toBe(4)
    expect(current.writer.retentionStatus?.overBudgetBytes).toBe(0)
  })

  it('evicts whole exited-owner families oldest first to meet the aggregate byte budget', async () => {
    const directory = await root()
    const older = await worker(directory)
    const newer = await worker(directory)
    await command(older.child, 'write', { message: 'a'.repeat(40_000) })
    await command(newer.child, 'write', { message: 'b'.repeat(40_000) })
    await Promise.all([exitWorker(older.child), exitWorker(newer.child)])
    await age(older.path, 2)
    await age(newer.path, 1)
    const current = await openWriter(directory, { maxTotalBytes: 65_536 })
    expect(await exists(older.path)).toBe(false)
    expect(await exists(newer.path)).toBe(true)
    expect(current.writer.retentionStatus?.totalBytes).toBeLessThanOrEqual(65_536)
    expect(current.writer.retentionStatus?.removedFiles).toBe(1)
  })

  it('protects silent live owners across close and HMR gaps even above the budget', async () => {
    const directory = await root()
    const active = await worker(directory)
    await command(active.child, 'write', { count: 3, message: 'live'.repeat(10_000) })
    await command(active.child, 'close')
    for (const name of await readdir(directory)) if (name.startsWith(basename(active.path))) await age(join(directory, name), 20)
    const collector = await openWriter(directory, { maxTotalBytes: 65_536 })
    expect(await exists(active.path)).toBe(true)
    expect(await exists(`${active.path}.1`)).toBe(true)
    expect(collector.writer.retentionStatus?.protectedBytes).toBeGreaterThan(65_536)
    expect(collector.writer.retentionStatus?.overBudgetBytes).toBeGreaterThan(0)
    await exitWorker(active.child, 'SIGKILL')
    await collector.writer.cleanup()
    expect(await exists(active.path)).toBe(false)
    expect(collector.writer.retentionStatus?.overBudgetBytes).toBe(0)

    const local = await openWriter(directory)
    await local.writer.close()
    const reopened = await RollingJsonlWriter.open(config(directory, local.activationId))
    writers.push(reopened)
    await reopened.write({ runtimeActivationId: local.activationId, sessionId: 's', runtimePresetId: 'p',
      sequence: 1, timestamp: Date.now(), severity: 'info', logger: 'hmr', message: 'reopened' })
    expect(await readFile(local.path, 'utf8')).toContain('reopened')
  })

  it('serializes competing collectors and recovers ownership after an abrupt process exit', async () => {
    const directory = await root()
    const crashed = await worker(directory)
    await command(crashed.child, 'write', { message: 'crash record' })
    await exitWorker(crashed.child, 'SIGKILL')
    await age(crashed.path, 8)
    const [first, second] = await Promise.all([worker(directory), worker(directory)])
    await Promise.all([command(first.child, 'cleanup'), command(second.child, 'cleanup')])
    expect(await exists(crashed.path)).toBe(false)
    await Promise.all([command(first.child, 'write'), command(second.child, 'write')])
    expect(JSON.parse((await readFile(first.path, 'utf8')).trim()).message).toBe('worker record')
    expect(JSON.parse((await readFile(second.path, 'utf8')).trim()).message).toBe('worker record')
  })

  it('preserves unregistered legacy logs unrelated files and unsafe families', async () => {
    const directory = await root()
    const legacy = join(directory, `runtime-${randomUUID()}.jsonl`)
    const unrelated = join(directory, 'runtime.jsonl')
    await writeFile(legacy, 'legacy')
    await writeFile(unrelated, 'unrelated')
    await age(legacy, 20)
    const dead = await worker(directory)
    await command(dead.child, 'write')
    await exitWorker(dead.child)
    const outside = join(await root(), 'outside.jsonl')
    await writeFile(outside, 'outside')
    await symlink(outside, `${dead.path}.1`)
    await age(dead.path, 20)
    const current = await openWriter(directory)
    expect(await readFile(legacy, 'utf8')).toBe('legacy')
    expect(await readFile(unrelated, 'utf8')).toBe('unrelated')
    expect(await readFile(outside, 'utf8')).toBe('outside')
    expect(await exists(dead.path)).toBe(true)
    expect(current.writer.retentionStatus?.protectedBytes).toBeGreaterThan(0)
  })

  it('preserves foreign-host unknown and reused-live-PID ownership', async () => {
    const directory = await root()
    const foreign = await worker(directory)
    const reused = await worker(directory)
    await Promise.all([command(foreign.child, 'write'), command(reused.child, 'write')])
    await Promise.all([exitWorker(foreign.child), exitWorker(reused.child)])
    await Promise.all([age(foreign.path, 20), age(reused.path, 20)])
    const database = new DatabaseSync(join(directory, '.doppelganger-log-retention.sqlite'))
    try {
      database.prepare('UPDATE owners SET host = ? WHERE family = ?').run('other-host', basename(foreign.path))
      database.prepare('UPDATE owners SET pid = ? WHERE family = ?').run(process.pid, basename(reused.path))
    } finally { database.close() }
    await openWriter(directory)
    expect(await exists(foreign.path)).toBe(true)
    expect(await exists(reused.path)).toBe(true)
  })

  it('skips a busy collector and waits for an ownership claim without blocking the event loop', async () => {
    const directory = await root()
    const current = await openWriter(directory)
    const database = new DatabaseSync(join(directory, '.doppelganger-log-retention.sqlite'), { timeout: 0 })
    try {
      database.exec('BEGIN IMMEDIATE')
      await current.writer.cleanup()
      const next = openWriter(directory)
      await new Promise<void>(resolve => setImmediate(resolve))
      database.exec('COMMIT')
      await next
    } finally { database.close() }
    await current.writer.cleanup()
    expect(current.writer.retentionStatus).toBeDefined()
  })

  it('rejects overlapping managed families across templates before opening a writer', async () => {
    const directory = await root()
    const current = await openWriter(directory)
    const overlapping = resolveFileLoggingConfig(normalizeFileLoggingConfig({
      pathTemplate: join(directory, 'runtime-{runtimeActivationId}.jsonl.1'), retention: {},
    }), { runtimeActivationId: current.activationId, sessionId: 's', runtimePresetId: 'p' })
    await expect(RollingJsonlWriter.open(overlapping)).rejects.toThrow('must not overlap')
    expect(await exists(`${current.path}.1`)).toBe(false)
  })

  it('rejects case-equivalent owner aliases before opening an existing live family', async () => {
    const directory = await root()
    const current = await openWriter(directory)
    const alias = resolveFileLoggingConfig(normalizeFileLoggingConfig({
      pathTemplate: join(directory, 'Runtime-{runtimeActivationId}.jsonl'), retention: {},
    }), { runtimeActivationId: current.activationId, sessionId: 'alias', runtimePresetId: 'alias' })
    await expect(RollingJsonlWriter.open(alias)).rejects.toThrow('must not overlap or alias')
    await current.writer.cleanup()
    expect(await exists(current.path)).toBe(true)
  })

  it('rejects an unsafe registry and keeps retention omission free of metadata', async () => {
    const directory = await root()
    const outside = join(await root(), 'outside')
    await writeFile(outside, 'untouched')
    await symlink(outside, join(directory, '.doppelganger-log-retention.sqlite'))
    await expect(RollingJsonlWriter.open(config(directory))).rejects.toThrow('regular files')
    expect(await readFile(outside, 'utf8')).toBe('untouched')
    const staticDirectory = await root()
    const path = join(staticDirectory, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(resolveFileLoggingConfig(normalizeFileLoggingConfig({ path }), {
      runtimeActivationId: randomUUID(), sessionId: 's', runtimePresetId: 'p',
    }))
    writers.push(writer)
    expect(await readdir(staticDirectory)).toEqual(['runtime.jsonl'])
    expect(writer.retentionStatus).toBeUndefined()
  })

  it('periodically removes an exited family and stops maintenance on Cordis disposal', async () => {
    const directory = await root()
    const old = await worker(directory)
    await command(old.child, 'write')
    await age(old.path, 8)
    const activationId = randomUUID()
    const context = new Context().isolate('doppelgangerLogging')
    let registered: RollingJsonlWriter | undefined
    const logging: RuntimeLoggingService = {
      scope: { runtimeActivationId: activationId, sessionId: 'timer', runtimePresetId: 'timer-test' },
      register(sink) {
        registered = sink as RollingJsonlWriter
        return async () => undefined
      },
    }
    context.provide('doppelgangerLogging', logging)
    try {
      await context.plugin(FileLoggingPlugin, {
        pathTemplate: join(directory, 'runtime-{runtimeActivationId}.jsonl'),
        retention: { cleanupIntervalMs: 1_000 },
      }).await()
      expect(await exists(old.path)).toBe(true)
      await exitWorker(old.child, 'SIGKILL')
      await expect.poll(() => exists(old.path), { timeout: 5_000 }).toBe(false)
      expect(registered?.retentionStatus?.removedFiles).toBe(1)
    } finally { await context.fiber.dispose() }
    await expect(registered!.cleanup()).rejects.toThrow('not accepting maintenance')
    const database = new DatabaseSync(join(directory, '.doppelganger-log-retention.sqlite'), { timeout: 0 })
    try { database.exec('BEGIN EXCLUSIVE; COMMIT') } finally { database.close() }
  })

  it('contains maintenance failure and closes the failed writer registry on disposal', async () => {
    const directory = await root()
    const current = await openWriter(directory)
    const database = new DatabaseSync(join(directory, '.doppelganger-log-retention.sqlite'))
    try { database.exec('DROP TABLE owners') } finally { database.close() }
    await expect(current.writer.cleanup()).rejects.toThrow('no such table')
    await expect(current.writer.write({ runtimeActivationId: current.activationId, sessionId: 's', runtimePresetId: 'p',
      sequence: 1, timestamp: Date.now(), severity: 'info', logger: 'failed', message: 'must not write' })).rejects.toThrow('not accepting records')
    await current.writer.close()
    expect(await readFile(current.path, 'utf8')).toBe('')
  })

  it('coalesces collection and releases its registry after collection completes', async () => {
    const directory = await root()
    const retention = await FileLogRetention.open(config(directory))
    try {
      const first = retention.collect()
      const second = retention.collect()
      expect(second).toBe(first)
      expect(() => retention.close()).toThrow('during collection')
      await first
    } finally { retention.close() }
    retention.close()
    await expect(retention.collect()).rejects.toThrow('closed')
    expect((await stat(join(directory, '.doppelganger-log-retention.sqlite'))).mode & 0o777).toBe(0o600)
  })
})
