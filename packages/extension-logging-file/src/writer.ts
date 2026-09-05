import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RuntimeLogRecord, RuntimeLogSink } from '@doppelganger/doppelganger-composition-runtime'
import type { ResolvedFileLoggingConfig } from './config.ts'
import { FileLogRetention, type FileLogRetentionStatus } from './retention.ts'

const activePaths = new Set<string>()

async function existingRegularFile(path: string): Promise<number | undefined> {
  try {
    const status = await lstat(path)
    if (status.isSymbolicLink()) throw new TypeError(`file logging path must not be a symbolic link: ${path}`)
    if (!status.isFile()) throw new TypeError(`file logging path must name a regular file: ${path}`)
    return status.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function openActive(path: string): Promise<FileHandle> {
  const handle = await open(
    path,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  )
  const status = await handle.stat()
  if (!status.isFile()) {
    await handle.close()
    throw new TypeError(`file logging path must name a regular file: ${path}`)
  }
  return handle
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export class RollingJsonlWriter implements RuntimeLogSink {
  private handle: FileHandle | undefined
  private readonly config: ResolvedFileLoggingConfig
  private readonly retention: FileLogRetention | undefined
  private size: number
  private accepting = true
  private failed = false
  private closed = false
  private tail = Promise.resolve()
  private cleanupTask: Promise<void> | undefined
  private closeTask: Promise<void> | undefined
  private currentRetentionStatus: FileLogRetentionStatus | undefined

  private constructor(
    config: ResolvedFileLoggingConfig,
    handle: FileHandle,
    size: number,
    retention: FileLogRetention | undefined,
  ) {
    this.config = config
    this.handle = handle
    this.size = size
    this.retention = retention
  }

  static async open(config: ResolvedFileLoggingConfig): Promise<RollingJsonlWriter> {
    if (activePaths.has(config.path)) throw new Error(`file logging path already has an active writer: ${config.path}`)
    activePaths.add(config.path)
    let retention: FileLogRetention | undefined
    let handle: FileHandle | undefined
    let writer: RollingJsonlWriter | undefined
    try {
      await mkdir(dirname(config.path), { recursive: true })
      if (config.retention !== undefined) retention = await FileLogRetention.open(config)
      const size = await existingRegularFile(config.path) ?? 0
      handle = await openActive(config.path)
      writer = new RollingJsonlWriter(config, handle, size, retention)
      handle = undefined
      retention = undefined
      await writer.cleanup()
      return writer
    } catch (error) {
      const cleanupErrors: unknown[] = []
      if (writer !== undefined) {
        try {
          await writer.close()
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      } else {
        if (handle !== undefined) {
          try {
            await handle.close()
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError)
          }
        }
        if (retention !== undefined) {
          try {
            retention.close()
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError)
          }
        }
        activePaths.delete(config.path)
      }
      if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], 'file logging writer open and cleanup failed')
      throw error
    }
  }

  get retentionStatus(): FileLogRetentionStatus | undefined {
    return this.currentRetentionStatus
  }

  write(record: RuntimeLogRecord): Promise<void> {
    if (!this.accepting || this.failed) return Promise.reject(new Error('file logging writer is not accepting records'))
    const line = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
    const task = this.tail.then(async () => {
      if (this.failed) throw new Error('file logging writer is not accepting records')
      try {
        if (this.size > 0 && this.size + line.byteLength > this.config.maxBytes) await this.rotate()
        const handle = this.handle
        if (handle === undefined) throw new Error('file logging writer has no active file')
        await handle.write(line)
        this.size += line.byteLength
      } catch (error) {
        this.accepting = false
        this.failed = true
        await this.closeHandle()
        throw error
      }
    })
    this.tail = task.catch(() => undefined)
    return task
  }

  cleanup(): Promise<void> {
    if (this.retention === undefined) return Promise.resolve()
    if (!this.accepting || this.failed) return Promise.reject(new Error('file logging writer is not accepting maintenance'))
    if (this.cleanupTask !== undefined) return this.cleanupTask
    const task = this.tail.then(async () => {
      if (this.failed) throw new Error('file logging writer is not accepting maintenance')
      try {
        const status = await this.retention?.collect()
        if (status !== undefined) this.currentRetentionStatus = status
      } catch (error) {
        this.accepting = false
        this.failed = true
        await this.closeHandle()
        throw error
      }
    })
    this.tail = task.catch(() => undefined)
    const cleanupTask = task.finally(() => {
      if (this.cleanupTask === cleanupTask) this.cleanupTask = undefined
    })
    this.cleanupTask = cleanupTask
    return cleanupTask
  }

  close(): Promise<void> {
    return this.closeTask ??= (async () => {
      if (this.closed) return
      this.accepting = false
      const errors: unknown[] = []
      try {
        await this.tail
        await this.closeHandle()
      } catch (error) {
        errors.push(error)
      } finally {
        try {
          this.retention?.close()
        } catch (error) {
          errors.push(error)
        } finally {
          this.closed = true
          activePaths.delete(this.config.path)
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'file logging writer close failed')
    })()
  }

  private async rotate(): Promise<void> {
    await this.closeHandle()
    await rm(`${this.config.path}.${this.config.maxFiles}`, { force: true })
    for (let generation = this.config.maxFiles - 1; generation >= 1; generation -= 1) {
      await renameIfPresent(`${this.config.path}.${generation}`, `${this.config.path}.${generation + 1}`)
    }
    await renameIfPresent(this.config.path, `${this.config.path}.1`)
    this.handle = await openActive(this.config.path)
    this.size = 0
  }

  private async closeHandle(): Promise<void> {
    const handle = this.handle
    if (handle === undefined) return
    this.handle = undefined
    await handle.close()
  }
}
