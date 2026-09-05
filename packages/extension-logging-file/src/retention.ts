import { chmodSync } from 'node:fs'
import { lstat, mkdir, readdir, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import type { NormalizedFileLogRetentionConfig, ResolvedFileLoggingConfig } from './config.ts'

export interface FileLogRetentionStatus {
  readonly checkedAt: number
  readonly totalBytes: number
  readonly removedFiles: number
  readonly removedBytes: number
  readonly protectedBytes: number
  readonly overBudgetBytes: number
}

interface Owner {
  readonly family: string
  readonly host: string
  readonly pid: number
}

interface LogFile {
  readonly path: string
  readonly size: number
  readonly modified: number
  readonly device: number
  readonly inode: number
}

interface Family {
  readonly name: string
  readonly files: LogFile[]
  size: number
  modified: number
  unsafe: boolean
}

const databaseName = '.doppelganger-log-retention.sqlite'
const activationPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const localHost = hostname()
const dayMs = 86_400_000

function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: number } | null)?.errcode
  return typeof code === 'number' && ((code & 255) === 5 || (code & 255) === 6)
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function deadOwner(value: unknown): value is Owner {
  if (value === null || typeof value !== 'object') return false
  const owner = value as Partial<Owner>
  if (owner.host !== localHost || typeof owner.family !== 'string'
    || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || owner.pid! > 2_147_483_647) return false
  try {
    process.kill(owner.pid!, 0)
    return false
  } catch (error) {
    // EPERM, PID reuse, a foreign host, or any uncertain result preserve the family.
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

async function fileStatus(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** A permanent local registry serializes ownership claims against filesystem deletion.
 * Owners remain protected until their process exits, including exporter/HMR gaps.
 * All cooperating writers must share a local filesystem and one PID namespace.
 */
export class FileLogRetention {
  private readonly database: DatabaseSync
  private readonly directory: string
  private readonly template: string
  private readonly policy: NormalizedFileLogRetentionConfig
  private readonly pattern: RegExp
  private closed = false
  private collecting: Promise<FileLogRetentionStatus | undefined> | undefined

  private constructor(database: DatabaseSync, config: ResolvedFileLoggingConfig) {
    this.database = database
    this.directory = dirname(config.path)
    this.template = basename(config.pathTemplate!)
    this.policy = config.retention!
    const [prefix, suffix] = this.template.split('{runtimeActivationId}')
    this.pattern = new RegExp(`^(${escapePattern(prefix!)}${activationPattern}${escapePattern(suffix!)})(?:\\.[1-9][0-9]*)?$`, 'u')
  }

  static async open(config: ResolvedFileLoggingConfig): Promise<FileLogRetention> {
    if (config.retention === undefined || config.pathTemplate === undefined
      || dirname(config.pathTemplate).includes('{runtimeActivationId}')) {
      throw new TypeError('file log retention requires a basename activation pathTemplate')
    }
    const directory = dirname(config.path)
    await mkdir(directory, { recursive: true })
    const filename = join(directory, databaseName)
    for (const path of [filename, `${filename}-journal`, `${filename}-wal`, `${filename}-shm`]) {
      const status = await fileStatus(path)
      if (status !== undefined && (!status.isFile() || status.isSymbolicLink())) {
        throw new TypeError('file log retention registry must use regular files')
      }
    }
    const database = new DatabaseSync(filename, { timeout: 0, enableDoubleQuotedStringLiterals: false })
    try {
      chmodSync(filename, 0o600)
      const retention = new FileLogRetention(database, config)
      if (!retention.pattern.test(basename(config.path))) throw new TypeError('retention path does not match its template')
      // Never unlink the registry: replacing its inode would split the lock domain.
      await retention.claim(basename(config.path))
      return retention
    } catch (error) {
      database.close()
      throw error
    }
  }

  private async claim(family: string): Promise<void> {
    const deadline = performance.now() + 5_000
    for (;;) {
      try {
        this.database.exec('BEGIN IMMEDIATE')
        try {
          const version = this.database.prepare('PRAGMA user_version').get()?.user_version
          if (version !== 0 && version !== 1) throw new Error('unsupported file log retention registry version')
          this.database.exec(`CREATE TABLE IF NOT EXISTS owners (
            family TEXT PRIMARY KEY, template TEXT NOT NULL, host TEXT NOT NULL,
            pid INTEGER NOT NULL CHECK (pid > 0)
          ) STRICT; PRAGMA user_version = 1;`)
          const owner = this.database.prepare('SELECT host, pid, template FROM owners WHERE family = ?').get(family)
          if (owner !== undefined && (owner.host !== localHost || owner.pid !== process.pid || owner.template !== this.template)) {
            throw new Error('file log family belongs to another process or template')
          }
          const foldedFamily = family.normalize('NFD').toLowerCase()
          const familyPattern = new RegExp(`^${escapePattern(foldedFamily)}\\.[1-9][0-9]*$`, 'u')
          for (const other of this.database.prepare('SELECT family FROM owners WHERE family != ?').all(family)) {
            if (typeof other.family !== 'string') throw new Error('invalid file log retention owner')
            const foldedOther = other.family.normalize('NFD').toLowerCase()
            if (foldedOther === foldedFamily || familyPattern.test(foldedOther)
              || new RegExp(`^${escapePattern(foldedOther)}\\.[1-9][0-9]*$`, 'u').test(foldedFamily)) {
              throw new Error('file log retention families must not overlap or alias')
            }
          }
          if (owner === undefined) {
            this.database.prepare('INSERT INTO owners VALUES (?, ?, ?, ?)')
              .run(family, this.template, localHost, process.pid)
          }
          this.database.exec('COMMIT')
          return
        } catch (error) {
          if (this.database.isTransaction) this.database.exec('ROLLBACK')
          throw error
        }
      } catch (error) {
        if (!isBusy(error) || performance.now() >= deadline) throw error
        await delay(25)
      }
    }
  }

  collect(): Promise<FileLogRetentionStatus | undefined> {
    if (this.closed) return Promise.reject(new Error('file log retention is closed'))
    if (this.collecting !== undefined) return this.collecting
    const task = this.collectLocked()
    this.collecting = task
    void task.finally(() => { this.collecting = undefined }).catch(() => undefined)
    return task
  }

  private async collectLocked(): Promise<FileLogRetentionStatus | undefined> {
    try {
      this.database.exec('BEGIN IMMEDIATE')
    } catch (error) {
      if (isBusy(error)) return undefined
      throw error
    }
    try {
      const checkedAt = Date.now()
      const owners = this.database.prepare('SELECT family, host, pid FROM owners WHERE template = ?').all(this.template)
      const eligible = new Set<string>()
      for (const owner of owners) {
        if (deadOwner(owner)) eligible.add(owner.family)
      }
      const families = new Map<string, Family>()
      for (const name of await readdir(this.directory)) {
        const match = this.pattern.exec(name)
        if (match === null) continue
        const familyName = match[1]!
        let family = families.get(familyName)
        if (family === undefined) {
          family = { name: familyName, files: [], size: 0, modified: 0, unsafe: false }
          families.set(familyName, family)
        }
        const path = join(this.directory, name)
        const status = await fileStatus(path)
        if (status === undefined) continue
        if (!status.isFile() || status.isSymbolicLink()) {
          family.unsafe = true
          continue
        }
        family.files.push({ path, size: status.size, modified: status.mtimeMs, device: status.dev, inode: status.ino })
        family.size += status.size
        family.modified = Math.max(family.modified, status.mtimeMs)
      }
      let totalBytes = 0
      let protectedBytes = 0
      let removedFiles = 0
      let removedBytes = 0
      const candidates: Family[] = []
      for (const family of families.values()) {
        totalBytes += family.size
        if (family.unsafe || !eligible.has(family.name)) protectedBytes += family.size
        else candidates.push(family)
      }
      candidates.sort((a, b) => a.modified - b.modified || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      const removeOwner = this.database.prepare('DELETE FROM owners WHERE family = ? AND template = ?')
      for (const family of candidates) {
        if (checkedAt - family.modified < this.policy.maxAgeDays * dayMs && totalBytes <= this.policy.maxTotalBytes) continue
        let complete = true
        for (const file of family.files) {
          const status = await fileStatus(file.path)
          if (status === undefined) continue
          if (!status.isFile() || status.isSymbolicLink() || status.dev !== file.device || status.ino !== file.inode
            || status.size !== file.size || status.mtimeMs !== file.modified) {
            complete = false
            break
          }
          await unlink(file.path)
          removedFiles += 1
          removedBytes += file.size
          totalBytes -= file.size
        }
        // Filesystem deletion precedes row removal. A crash rolls back the row;
        // a later collector retries missing files safely while claims stay locked out.
        if (complete) removeOwner.run(family.name, this.template)
      }
      for (const name of eligible) {
        if (!families.has(name)) removeOwner.run(name, this.template)
      }
      this.database.exec('COMMIT')
      return Object.freeze({ checkedAt, totalBytes, removedFiles, removedBytes, protectedBytes,
        overBudgetBytes: Math.max(0, totalBytes - this.policy.maxTotalBytes) })
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    if (this.collecting !== undefined) throw new Error('cannot close file log retention during collection')
    this.database.close()
    this.closed = true
  }
}
