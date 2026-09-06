#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const TEST_DSN_ENV = 'DOPPELGANGER_TEST_POSTGRESQL_DSN'
const POSTGRES_IMAGE = 'postgres@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675'
const COMMAND_TIMEOUT_MS = 15_000
const CONTAINER_START_TIMEOUT_MS = 120_000
const POSTGRES_READY_TIMEOUT_MS = 30_000
const POSTGRES_PROBE_TIMEOUT_MS = 5_000
const CONTAINER_REMOVE_TIMEOUT_MS = 10_000
const CONTAINER_REMOVE_ATTEMPT_TIMEOUT_MS = 2_000
const CHILD_SIGNAL_GRACE_MS = 5_000
const MAX_CAPTURE_BYTES = 8_192
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

class GateError extends Error {}

let receivedSignal
let activeChild
let childForceKillTimer
const setupAbort = new AbortController()
function signalChild(signal) {
  if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return
  if (process.platform !== 'win32' && activeChild.pid) {
    try {
      process.kill(-activeChild.pid, signal)
      return
    } catch {}
  }
  activeChild.kill(signal)
}

function onSignal(signal) {
  if (receivedSignal) return
  receivedSignal = signal
  setupAbort.abort()
  if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
    signalChild(signal)
    childForceKillTimer = setTimeout(() => signalChild('SIGKILL'), CHILD_SIGNAL_GRACE_MS)
    childForceKillTimer.unref()
  }
}

for (const signal of SIGNALS) process.on(signal, onSignal)

function boundedAppend(current, chunk) {
  if (current.length >= MAX_CAPTURE_BYTES) return current
  return current + chunk.toString('utf8', 0, MAX_CAPTURE_BYTES - current.length)
}

function runCaptured(command, args, options = {}) {
  const {
    env = process.env,
    signal,
    timeoutMs = COMMAND_TIMEOUT_MS,
  } = options
  const { promise, resolve, reject } = Promise.withResolvers()
  let stdout = ''
  let stderr = ''
  let settled = false
  let timedOut = false
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    signal,
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)
  timer.unref()

  const settle = callback => value => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    callback(value)
  }
  const fail = settle(reject)
  const succeed = settle(resolve)

  child.stdout.on('data', chunk => { stdout = boundedAppend(stdout, chunk) })
  child.stderr.on('data', chunk => { stderr = boundedAppend(stderr, chunk) })
  child.on('error', error => {
    if (signal?.aborted) fail(new GateError('PostgreSQL backend gate was interrupted.'))
    else fail(new GateError(`Unable to start required command ${command}: ${error.code ?? 'process error'}.`))
  })
  child.on('close', (code, childSignal) => {
    if (timedOut) fail(new GateError(`Required command ${command} timed out after ${timeoutMs}ms.`))
    else succeed({ code, signal: childSignal, stdout, stderr })
  })
  return promise
}


async function requireSuppliedPostgreSql(dsn) {
  let client
  try {
    const pg = await import('pg')
    const Client = pg.Client ?? pg.default?.Client
    if (!Client) throw new Error('PostgreSQL client unavailable')
    client = new Client({
      connectionString: dsn,
      connectionTimeoutMillis: POSTGRES_PROBE_TIMEOUT_MS,
      query_timeout: POSTGRES_PROBE_TIMEOUT_MS,
      statement_timeout: POSTGRES_PROBE_TIMEOUT_MS,
    })
    await client.connect()
    await client.query('SELECT 1')
  } catch {
    throw new GateError(`The PostgreSQL service supplied through ${TEST_DSN_ENV} is unavailable.`)
  } finally {
    if (client) await Promise.race([
      client.end().catch(() => {}),
      sleep(POSTGRES_PROBE_TIMEOUT_MS, undefined, { ref: false }),
    ])
  }
}

async function requireDocker() {
  let result
  try {
    result = await runCaptured('docker', ['version', '--format', '{{.Server.Version}}'], {
      signal: setupAbort.signal,
    })
  } catch (error) {
    if (receivedSignal) throw error
    throw new GateError('Docker with a reachable daemon is required for the PostgreSQL backend gate.')
  }
  if (result.code !== 0) throw new GateError('Docker with a reachable daemon is required for the PostgreSQL backend gate.')
}

async function startPostgreSqlContainer(containerName, credentials) {
  const dockerEnv = {
    ...process.env,
    POSTGRES_USER: credentials.user,
    POSTGRES_PASSWORD: credentials.password,
    POSTGRES_DB: credentials.database,
  }
  const result = await runCaptured('docker', [
    'run',
    '--detach',
    '--rm',
    '--name', containerName,
    '--publish', '127.0.0.1::5432/tcp',
    '--env', 'POSTGRES_USER',
    '--env', 'POSTGRES_PASSWORD',
    '--env', 'POSTGRES_DB',
    POSTGRES_IMAGE,
  ], {
    env: dockerEnv,
    signal: setupAbort.signal,
    timeoutMs: CONTAINER_START_TIMEOUT_MS,
  })
  if (result.code !== 0) throw new GateError('Unable to start the disposable PostgreSQL 17 backend fixture.')
}

async function publishedPostgreSqlPort(containerName) {
  const result = await runCaptured('docker', ['port', containerName, '5432/tcp'], {
    signal: setupAbort.signal,
  })
  if (result.code !== 0) throw new GateError('Unable to resolve the disposable PostgreSQL fixture port.')
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = /^127\.0\.0\.1:(\d+)$/u.exec(line.trim())
    if (match) return Number(match[1])
  }
  throw new GateError('Docker did not publish the PostgreSQL fixture on IPv4 loopback.')
}

async function waitForPostgreSql(containerName, credentials) {
  const deadline = Date.now() + POSTGRES_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const result = await runCaptured('docker', [
      'exec', containerName,
      'psql',
      '--no-psqlrc',
      '--username', credentials.user,
      '--dbname', credentials.database,
      '--tuples-only',
      '--command', 'SELECT 1;',
    ], {
      signal: setupAbort.signal,
      timeoutMs: POSTGRES_PROBE_TIMEOUT_MS,
    })
    if (result.code === 0 && result.stdout.trim() === '1') return
    await sleep(250, undefined, { signal: setupAbort.signal })
  }
  throw new GateError('Disposable PostgreSQL 17 did not become SQL-ready within 30000ms.')
}

async function removeContainer(containerName) {
  const deadline = Date.now() + CONTAINER_REMOVE_TIMEOUT_MS
  do {
    try {
      const result = await runCaptured('docker', ['rm', '--force', containerName], {
        timeoutMs: CONTAINER_REMOVE_ATTEMPT_TIMEOUT_MS,
      })
      if (result.code === 0 || /No such container/iu.test(result.stderr)) return
    } catch {}
    if (Date.now() < deadline) await sleep(200)
  } while (Date.now() < deadline)
  throw new GateError('Failed to dispose the disposable PostgreSQL backend fixture.')
}

function runChild(command, args, env) {
  const { promise, resolve, reject } = Promise.withResolvers()
  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })
  activeChild = child
  child.on('error', error => {
    activeChild = undefined
    reject(new GateError(`Unable to start backend verification command: ${error.code ?? 'process error'}.`))
  })
  child.on('close', (code, signal) => {
    activeChild = undefined
    clearTimeout(childForceKillTimer)
    resolve({ code, signal })
  })
  return promise
}

function parseCommand(argv) {
  if (argv[0] !== '--' || !argv[1]) {
    throw new GateError('Usage: node scripts/with-memory-postgresql.mjs -- <binary> <args...>')
  }
  return { command: argv[1], args: argv.slice(2) }
}

async function main() {
  const { command, args } = parseCommand(process.argv.slice(2))
  const supplied = Object.hasOwn(process.env, TEST_DSN_ENV)
  const suppliedDsn = process.env[TEST_DSN_ENV]
  if (supplied && !suppliedDsn) throw new GateError(`${TEST_DSN_ENV} must be non-empty when supplied.`)

  let containerName
  let cleanupError
  let operationError
  let childResult
  try {
    let dsn = suppliedDsn
    if (supplied) {
      await requireSuppliedPostgreSql(suppliedDsn)
    } else {
      await requireDocker()
      const suffix = randomBytes(10).toString('hex')
      containerName = `doppelganger-memory-postgresql-${process.pid}-${suffix}`
      const credentials = {
        user: `doppelganger_${suffix.slice(0, 10)}`,
        password: randomBytes(24).toString('hex'),
        database: `memory_${suffix.slice(10)}`,
      }
      await startPostgreSqlContainer(containerName, credentials)
      const port = await publishedPostgreSqlPort(containerName)
      await waitForPostgreSql(containerName, credentials)
      dsn = `postgresql://${credentials.user}:${credentials.password}@127.0.0.1:${port}/${credentials.database}`
    }

    if (!receivedSignal) {
      childResult = await runChild(command, args, { ...process.env, [TEST_DSN_ENV]: dsn })
    }
  } catch (error) {
    operationError = error
  } finally {
    if (containerName) {
      try {
        await removeContainer(containerName)
      } catch (error) {
        cleanupError = error
      }
    }
  }

  if (cleanupError) console.error(cleanupError.message)
  if (operationError) throw operationError
  if (cleanupError && (!childResult || childResult.code === 0)) return { code: 1 }
  if (receivedSignal) return { signal: receivedSignal }
  if (!childResult) return { code: 1 }
  if (childResult.signal) return { signal: childResult.signal }
  return { code: childResult.code ?? 1 }
}

let outcome
try {
  outcome = await main()
} catch (error) {
  if (!receivedSignal) console.error(error instanceof GateError ? error.message : 'PostgreSQL backend gate failed unexpectedly.')
  outcome = receivedSignal ? { signal: receivedSignal } : { code: 1 }
}

for (const signal of SIGNALS) process.removeListener(signal, onSignal)
if (outcome.signal) process.kill(process.pid, outcome.signal)
else process.exitCode = outcome.code
