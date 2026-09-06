import { createHash, randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, normalize } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  MemoryVectorEntry,
  MemoryVectorFilter,
  MemoryVectorHealth,
  MemoryVectorHit,
  MemoryVectorIdentity,
  MemoryVectorIndex,
  MemoryVectorIndexIdentity,
  MemoryVectorMaintenanceKind,
  MemoryVectorMaintenanceResult,
  MemoryVectorSearchRequest,
} from '@doppelganger/doppelganger-memory'
import {
  validateMemoryVector,
  memoryVectorIdentityId,
} from '@doppelganger/doppelganger-memory'

export interface SQLiteExactConfig {
  readonly databasePath: string
  readonly namespace?: string
  readonly dimensions: number
  readonly configFingerprint?: string
  readonly sanitizedTarget?: string
  readonly busyTimeoutMs?: number
}

interface StoredVector {
  readonly generation_id: string
  readonly record_id: string
  readonly revision_id: string
  readonly instance_id: string
  readonly actor_id: string
  readonly scope_kind: string
  readonly project_id: string | null
  readonly kind: string
  readonly subject_key: string
  readonly status: string
  readonly vector: Uint8Array
}

function text(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 256) throw new TypeError(`${field} must be non-empty and bounded`)
  return normalized
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function tableName(namespace: string): string {
  // Keep the authored namespace out of SQL identifiers. Hashing also avoids
  // collisions caused by punctuation being replaced with underscores.
  return `doppelganger_vectors_${createHash('sha256').update(namespace).digest('hex').slice(0, 32)}`
}

function vectorBlob(vector: Float32Array): Uint8Array {
  // Copy the view so a caller cannot mutate a value while SQLite is binding it.
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength))
}

function vectorFromBlob(value: unknown, dimensions: number): Float32Array {
  if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value)) throw new TypeError('stored vector is not a byte buffer')
  if (value.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) throw new TypeError('stored vector dimensions do not match backend identity')
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Float32Array(bytes.slice().buffer)
}

function cosine(left: Float32Array, right: Float32Array): number {
  let leftScale = 0
  let rightScale = 0
  for (let index = 0; index < left.length; index += 1) {
    leftScale = Math.max(leftScale, Math.abs(left[index]!))
    rightScale = Math.max(rightScale, Math.abs(right[index]!))
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const normalizedLeft = left[index]! / leftScale
    const normalizedRight = right[index]! / rightScale
    dot += normalizedLeft * normalizedRight
    leftNorm += normalizedLeft * normalizedLeft
    rightNorm += normalizedRight * normalizedRight
  }
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function compareIdentity(left: MemoryVectorIdentity, right: MemoryVectorIdentity): number {
  return left.generationId < right.generationId ? -1
    : left.generationId > right.generationId ? 1
      : left.recordId < right.recordId ? -1
        : left.recordId > right.recordId ? 1
          : left.revisionId < right.revisionId ? -1
            : left.revisionId > right.revisionId ? 1
              : 0
}

function matches(row: StoredVector, filter: MemoryVectorFilter): boolean {
  if (row.instance_id !== filter.instanceId || row.actor_id !== filter.actorId) return false
  if (filter.scopeKind !== undefined && row.scope_kind !== filter.scopeKind) return false
  if (filter.projectId !== undefined && row.project_id !== filter.projectId) return false
  if (filter.scopeKind === 'relationship' && row.project_id !== null) return false
  if (filter.kind !== undefined && row.kind !== filter.kind) return false
  if (filter.status !== undefined && row.status !== filter.status) return false
  return true
}

export class SQLiteExactMemoryVectorIndex implements MemoryVectorIndex {
  readonly identity: MemoryVectorIndexIdentity
  readonly supportedMaintenance: readonly MemoryVectorMaintenanceKind[] = Object.freeze(['compact'])
  private readonly database: DatabaseSync
  private readonly dimensions: number
  private readonly target: string
  private readonly table: string
  private maintenanceRunning = false
  private closed = false

  constructor(config: SQLiteExactConfig) {
    if (!isAbsolute(config.databasePath)) throw new TypeError('SQLite exact databasePath must be absolute')
    if (!Number.isSafeInteger(config.dimensions) || config.dimensions <= 0) throw new TypeError('SQLite exact dimensions must be positive')
    this.dimensions = config.dimensions
    this.target = normalize(config.databasePath)
    const namespace = text(config.namespace ?? 'default', 'SQLite exact namespace')
    const configuredFingerprint = config.configFingerprint ?? fingerprint({ backend: 'sqlite_exact', databasePath: this.target, namespace, dimensions: this.dimensions })
    if (!/^[a-f0-9]{64}$/.test(configuredFingerprint)) throw new TypeError('SQLite exact configFingerprint must be a SHA-256 fingerprint')
    const partitionFingerprint = fingerprint({ partitionSchemaVersion: 2, configuredFingerprint })
    this.database = new DatabaseSync(this.target, {
      timeout: config.busyTimeoutMs ?? 5000,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    })
    const table = tableName(namespace)
    let transactionOpen = false
    let targetId: string
    let configFingerprint: string
    try {
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS doppelganger_vector_metadata (
          namespace TEXT PRIMARY KEY,
          dimensions INTEGER NOT NULL,
          config_fingerprint TEXT NOT NULL,
          schema_version INTEGER NOT NULL DEFAULT 3,
          target_id TEXT
        );
      `)
      this.database.exec('BEGIN IMMEDIATE')
      transactionOpen = true
      const metadataColumns = this.database.prepare('PRAGMA table_info(doppelganger_vector_metadata)').all() as { name: string }[]
      if (!metadataColumns.some(column => column.name === 'schema_version')) {
        this.database.exec('ALTER TABLE doppelganger_vector_metadata ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1')
      }
      if (!metadataColumns.some(column => column.name === 'target_id')) {
        this.database.exec('ALTER TABLE doppelganger_vector_metadata ADD COLUMN target_id TEXT')
      }
      const metadata = this.database.prepare('SELECT dimensions, config_fingerprint, schema_version, target_id FROM doppelganger_vector_metadata WHERE namespace = ?').get(namespace) as {
        dimensions: number
        config_fingerprint: string
        schema_version: number
        target_id: string | null
      } | undefined
      if (metadata === undefined) {
        targetId = randomBytes(32).toString('hex')
        configFingerprint = fingerprint({ partitionSchemaVersion: 2, configuredFingerprint, targetId })
        this.database.prepare('INSERT INTO doppelganger_vector_metadata(namespace, dimensions, config_fingerprint, schema_version, target_id) VALUES (?, ?, ?, 3, ?)')
          .run(namespace, this.dimensions, configFingerprint, targetId)
      } else {
        const expectedStoredFingerprint = metadata.schema_version === 1 ? configuredFingerprint : partitionFingerprint
        if (metadata.dimensions !== this.dimensions || (metadata.schema_version <= 2 && metadata.config_fingerprint !== expectedStoredFingerprint)) {
          throw new Error('SQLite exact database already contains an incompatible vector index identity')
        }
        if (metadata.schema_version === 1) {
          const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
          const names = new Set(columns.map(column => column.name))
          if (!names.has('principal_id') || names.has('actor_id')) throw new Error('SQLite exact legacy actor migration cannot identify the partition column')
          this.database.exec(`ALTER TABLE ${table} RENAME COLUMN principal_id TO actor_id`)
        } else if (metadata.schema_version !== 2 && metadata.schema_version !== 3) {
          throw new Error(`unsupported SQLite exact schema version: ${String(metadata.schema_version)}`)
        }
        targetId = metadata.target_id ?? randomBytes(32).toString('hex')
        if (!/^[a-f0-9]{64}$/.test(targetId)) throw new Error('SQLite exact database contains an invalid target identity')
        configFingerprint = fingerprint({ partitionSchemaVersion: 2, configuredFingerprint, targetId })
        if (metadata.schema_version === 3) {
          if (metadata.config_fingerprint !== configFingerprint) throw new Error('SQLite exact database already contains an incompatible vector index identity')
        } else {
          this.database.prepare('UPDATE doppelganger_vector_metadata SET config_fingerprint = ?, schema_version = 3, target_id = ? WHERE namespace = ?')
            .run(configFingerprint, targetId, namespace)
        }
      }
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          vector_id TEXT PRIMARY KEY,
          generation_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          revision_id TEXT NOT NULL,
          instance_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          scope_kind TEXT NOT NULL,
          project_id TEXT,
          kind TEXT NOT NULL,
          subject_key TEXT NOT NULL,
          status TEXT NOT NULL,
          vector BLOB NOT NULL,
          UNIQUE(generation_id, record_id, revision_id)
        );
      `)
      this.database.exec('COMMIT')
      transactionOpen = false
    } catch (error) {
      if (transactionOpen) {
        try {
          this.database.exec('ROLLBACK')
        } catch {}
      }
      this.database.close()
      throw error
    }
    this.table = table
    this.identity = Object.freeze({
      backend: 'sqlite_exact',
      namespace,
      sanitizedTarget: config.sanitizedTarget ?? this.target,
      configFingerprint,
      dimensions: this.dimensions,
      distanceMetric: 'cosine',
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SQLite exact vector index is closed')
  }

  async upsert(entries: readonly MemoryVectorEntry[]): Promise<void> {
    this.assertOpen()
    for (const entry of entries) {
      if (entry.generationId.length === 0) throw new TypeError('vector generationId is required')
      validateMemoryVector(entry.vector, this.dimensions, 'vector')
      if (entry.vector.length !== this.identity.dimensions) throw new TypeError('vector dimensions do not match index identity')
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.database.prepare(`INSERT INTO ${this.table}(
        vector_id, generation_id, record_id, revision_id, instance_id, actor_id,
        scope_kind, project_id, kind, subject_key, status, vector
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vector_id) DO UPDATE SET
        generation_id=excluded.generation_id, record_id=excluded.record_id, revision_id=excluded.revision_id,
        instance_id=excluded.instance_id, actor_id=excluded.actor_id, scope_kind=excluded.scope_kind,
        project_id=excluded.project_id, kind=excluded.kind, subject_key=excluded.subject_key,
        status=excluded.status, vector=excluded.vector`)
      for (const entry of entries) statement.run(
        memoryVectorIdentityId(entry), entry.generationId, entry.recordId, entry.revisionId,
        entry.instanceId, entry.actorId, entry.scopeKind, entry.projectId ?? null,
        entry.kind, entry.subjectKey, entry.status, vectorBlob(entry.vector),
      )
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async delete(identities: readonly MemoryVectorIdentity[]): Promise<void> {
    this.assertOpen()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.database.prepare(`DELETE FROM ${this.table} WHERE vector_id = ?`)
      for (const identity of identities) statement.run(memoryVectorIdentityId(identity))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async search(request: MemoryVectorSearchRequest): Promise<readonly MemoryVectorHit[]> {
    this.assertOpen()
    if (request.generationId.length === 0) throw new TypeError('search generationId is required')
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) throw new TypeError('search limit must be positive')
    validateMemoryVector(request.vector, this.dimensions, 'search vector')
    const rows = this.database.prepare(`SELECT * FROM ${this.table} WHERE generation_id = ?`).all(request.generationId) as unknown as readonly StoredVector[]
    return Object.freeze(rows.filter(row => matches(row, request.filter)).map(row => {
      const stored = vectorFromBlob(row.vector, this.dimensions)
      const identity = { generationId: row.generation_id, recordId: row.record_id, revisionId: row.revision_id }
      return { identity, score: cosine(request.vector, stored) }
    }).sort((left, right) => right.score - left.score || compareIdentity(left.identity, right.identity)).slice(0, request.limit).map(item => Object.freeze({ ...item.identity, score: item.score })))
  }

  async health(): Promise<MemoryVectorHealth> {
    this.assertOpen()
    const count = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ${this.table}`).get() as { count: number }).count)
    return Object.freeze({ state: 'healthy', checkedAt: new Date().toISOString(), backend: 'sqlite_exact', sanitizedTarget: this.identity.sanitizedTarget, counts: Object.freeze({ indexed: count, current: count, stale: 0, missing: 0, pendingUpserts: 0, pendingDeletes: 0 }) })
  }
  async maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult> {
    this.assertOpen()
    if (kind !== 'compact') throw Object.assign(new Error(`SQLite exact does not support ${kind}`), { code: 'UNSUPPORTED_MAINTENANCE' })
    const startedAt = new Date().toISOString()
    if (this.maintenanceRunning) return Object.freeze({ kind, outcome: 'already-running', startedAt, completedAt: new Date().toISOString() })
    this.maintenanceRunning = true
    try {
      // Yield once so simultaneous callers observe the in-flight operation and
      // report `already-running` rather than stacking PRAGMA work.
      await Promise.resolve()
      this.database.exec('PRAGMA optimize')
      return Object.freeze({ kind, outcome: 'ran', startedAt, completedAt: new Date().toISOString() })
    } finally {
      this.maintenanceRunning = false
    }
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.database.close()
    }
    return Promise.resolve()
  }
}

export async function createSQLiteExactMemoryVectorIndex(config: SQLiteExactConfig): Promise<SQLiteExactMemoryVectorIndex> {
  await mkdir(dirname(config.databasePath), { recursive: true })
  return new SQLiteExactMemoryVectorIndex(config)
}
