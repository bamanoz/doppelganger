import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { open, readFile, rm, type FileHandle } from 'node:fs/promises'
import { hostname } from 'node:os'
import { ToolInvocationError } from '@doppelganger/doppelganger-protocols'

interface LockMetadata {
  readonly version: 1
  readonly token: string
  readonly pid: number
  readonly hostname: string
  readonly createdAt: string
}

export interface PersonaAssetLock {
  release(): Promise<void>
}

const MAX_LOCK_BYTES = 4_096
const RETRY_DELAY_MS = 25

function lockPath(filename: string): string {
  return `${filename}.doppelganger.lock`
}

function recoveryPath(filename: string): string {
  return `${lockPath(filename)}.recover`
}

function errno(cause: unknown, code: string): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === code
}

async function readLock(path: string): Promise<{ readonly raw: string; readonly metadata: LockMetadata } | undefined> {
  let raw: string
  try {
    const bytes = await readFile(path)
    if (bytes.length > MAX_LOCK_BYTES) return undefined
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  try {
    const value = JSON.parse(raw) as Partial<LockMetadata>
    if (value.version !== 1 || typeof value.token !== 'string' || value.token.length !== 36
      || !Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0
      || typeof value.hostname !== 'string' || typeof value.createdAt !== 'string') return undefined
    return {
      raw,
      metadata: {
        version: 1,
        token: value.token,
        pid: value.pid as number,
        hostname: value.hostname,
        createdAt: value.createdAt,
      },
    }
  } catch {
    return undefined
  }
}

function processIsProvablyDead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (cause) {
    return errno(cause, 'ESRCH')
  }
}

async function recoverDeadOwner(filename: string): Promise<boolean> {
  const guardPath = recoveryPath(filename)
  let guard: FileHandle
  try {
    guard = await open(guardPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
  } catch {
    return false
  }
  try {
    const path = lockPath(filename)
    const first = await readLock(path)
    if (first === undefined || first.metadata.hostname !== hostname()
      || !processIsProvablyDead(first.metadata.pid)) return false
    const second = await readLock(path)
    if (second === undefined || second.raw !== first.raw || second.metadata.token !== first.metadata.token) return false
    try {
      await rm(path)
      return true
    } catch {
      return false
    }
  } finally {
    await guard.close().catch(() => undefined)
    await rm(guardPath, { force: true }).catch(() => undefined)
  }
}

async function createLock(filename: string): Promise<PersonaAssetLock | undefined> {
  const path = lockPath(filename)
  const token = randomUUID()
  const metadata: LockMetadata = {
    version: 1,
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
  }
  let handle: FileHandle
  try {
    handle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
  } catch (cause) {
    if (errno(cause, 'EEXIST')) return undefined
    throw new ToolInvocationError('PERSONA_LOCK_TIMEOUT', 'Persona asset lock could not be created')
  }
  try {
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8')
    await handle.sync()
  } catch (cause) {
    await handle.close().catch(() => undefined)
    await rm(path, { force: true }).catch(() => undefined)
    throw cause
  }
  await handle.close()

  let released = false
  return Object.freeze({
    async release() {
      if (released) return
      released = true
      const current = await readLock(path)
      if (current?.metadata.token !== token) return
      await rm(path, { force: true })
    },
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function acquirePersonaAssetLock(
  filename: string,
  timeoutMs: number,
): Promise<PersonaAssetLock> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const lock = await createLock(filename)
    if (lock !== undefined) return lock
    await recoverDeadOwner(filename)
    if (Date.now() >= deadline) {
      throw new ToolInvocationError('PERSONA_LOCK_TIMEOUT', 'Timed out waiting for the Persona asset lock')
    }
    await delay(Math.min(RETRY_DELAY_MS, Math.max(1, deadline - Date.now())))
  }
}
