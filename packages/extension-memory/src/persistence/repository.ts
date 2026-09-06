import type { FilterQuery } from '@mikro-orm/core'
import type { SqlEntityManager } from '@mikro-orm/sql'
import {
  activeMemorySemanticGeneration,
  enqueueActiveMemoryProjection,
  enqueueKnownMemoryProjectionDeletions,
  enqueueMemoryRevisionReplacement,
  MemoryProjectionStore,
} from '../projection-store.ts'
import {
  type MemoryCanonicalSnapshot,
  type MemoryConflict,
  type MemoryEvidence,
  type MemoryLexicalCandidate,
  type MemoryOperationReceipt,
  type MemoryPartition,
  type MemoryPromotionEvidence,
  type MemoryReadOptions,
  type MemoryRecord,
  type MemoryRepository,
  type MemoryRepositoryReader,
  type MemoryRevision,
  type MemoryRevisionUpdate,
  type MemoryStatus,
  type MemorySubjectQuery,
  type MemoryUnitOfWork,
  type NewMemoryConflict,
  type NewMemoryEvidence,
  type NewMemoryRecord,
  type NewMemoryRevision,
} from '../repository.ts'
import type { MemoryDatabase } from './database.ts'
import {
  MemoryCandidateEvidenceEntity,
  MemoryConflictEntity,
  MemoryEmbeddingCacheEntity,
  MemoryEvidenceEntity,
  MemoryOperationEntity,
  MemoryRecordEntity,
  MemoryRevisionEntity,
  MemorySemanticIndexedRevisionEntity,
  MemoryVectorProjectionWorkEntity,
} from './entities.ts'

const LEXICAL_TOKEN = /[\p{L}\p{N}_-]+/gu

function temporalState(
  value: { readonly validFrom?: string; readonly validUntil?: string; readonly expiresAt?: string },
  now: string,
): MemoryRecord['temporalState'] {
  if (value.validFrom !== undefined && value.validFrom > now) return 'not-yet-valid'
  if ((value.validUntil !== undefined && value.validUntil <= now) || (value.expiresAt !== undefined && value.expiresAt <= now)) return 'expired'
  return 'eligible'
}

function recordCriteria(
  partition: MemoryPartition,
  options: MemoryReadOptions = {},
): FilterQuery<MemoryRecordEntity> {
  const criteria: Record<string, unknown> = {
    instanceId: partition.instanceId,
    actorId: partition.actorId,
    ...(partition.projectId === undefined
      ? { scopeKind: 'relationship' }
      : { $or: [{ scopeKind: 'relationship' }, { scopeKind: 'project', projectId: partition.projectId }] }),
  }
  if (options.statuses !== undefined) criteria.status = { $in: [...options.statuses] }
  return criteria as FilterQuery<MemoryRecordEntity>
}

function temporallyEligible(record: MemoryRecordEntity, now: string): boolean {
  return (record.validFrom === null || record.validFrom <= now)
    && (record.validUntil === null || record.validUntil > now)
    && (record.expiresAt === null || record.expiresAt > now)
}

function detachedRevision(row: MemoryRevisionEntity): MemoryRevision {
  return Object.freeze({
    id: row.id,
    ordinal: Number(row.ordinal),
    content: row.content,
    sourceSessionId: row.sourceSessionId,
    sourceKind: row.sourceKind,
    ...(row.supersedesRevisionId === null ? {} : { supersedesRevisionId: row.supersedesRevisionId }),
    ...(row.validFrom === null ? {} : { validFrom: row.validFrom }),
    ...(row.validUntil === null ? {} : { validUntil: row.validUntil }),
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
    createdAt: row.createdAt,
  })
}

function detachedRecord(
  row: MemoryRecordEntity,
  revision: MemoryRevisionEntity,
  hasUnresolvedConflict: boolean,
  now: string,
): MemoryRecord {
  const times = {
    ...(row.validFrom === null ? {} : { validFrom: row.validFrom }),
    ...(row.validUntil === null ? {} : { validUntil: row.validUntil }),
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
  }
  return Object.freeze({
    id: row.id,
    instanceId: row.instanceId,
    actorId: row.actorId,
    kind: row.kind,
    subjectKey: row.subjectKey,
    scope: Object.freeze({
      kind: row.scopeKind,
      ...(row.projectId === null ? {} : { projectId: row.projectId }),
    }),
    status: row.status,
    pinned: Boolean(row.pinned),
    confidence: Number(row.confidence),
    salience: Number(row.salience),
    ...times,
    temporalState: temporalState(times, now),
    hasUnresolvedConflict,
    sourceSessionId: row.sourceSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: detachedRevision(revision),
  })
}

function detachedEvidence(row: MemoryEvidenceEntity): MemoryEvidence {
  return Object.freeze({
    id: row.id,
    recordId: row.recordId,
    sourceSessionId: row.sourceSessionId,
    sourceTurnId: row.sourceTurnId,
    role: row.role,
    relation: row.relation,
    excerpt: row.excerpt,
    createdAt: row.createdAt,
  })
}

function detachedConflict(row: MemoryConflictEntity): MemoryConflict {
  return Object.freeze({
    id: row.id,
    activeRecordId: row.activeRecordId,
    candidateRecordId: row.candidateRecordId,
    ...(row.evidenceId === null ? {} : { evidenceId: row.evidenceId }),
    status: row.status,
    createdAt: row.createdAt,
    ...(row.resolvedAt === null ? {} : { resolvedAt: row.resolvedAt }),
    ...(row.resolutionRevisionId === null ? {} : { resolutionRevisionId: row.resolutionRevisionId }),
  })
}

function exactScope(query: MemorySubjectQuery): Record<string, unknown> {
  return query.scope.kind === 'relationship'
    ? { scopeKind: 'relationship', projectId: null }
    : { scopeKind: 'project', projectId: query.scope.projectId }
}

async function loadRecords(
  em: SqlEntityManager,
  partition: MemoryPartition,
  ids: readonly string[] | undefined,
  now: string,
  options: MemoryReadOptions = {},
  orderBy?: Record<string, 'asc' | 'desc'>,
  limit?: number,
): Promise<readonly MemoryRecord[]> {
  if (ids !== undefined && ids.length === 0) return Object.freeze([])
  const criteria = recordCriteria(partition, options) as Record<string, unknown>
  if (ids !== undefined) criteria.id = { $in: [...new Set(ids)] }
  const rows = await em.find(MemoryRecordEntity, criteria as FilterQuery<MemoryRecordEntity>, {
    refresh: true,
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(limit === undefined ? {} : { limit }),
  })
  const eligibleRows = options.temporal === true ? rows.filter(row => temporallyEligible(row, now)) : rows
  if (eligibleRows.length === 0) return Object.freeze([])
  const revisionIds = [...new Set(eligibleRows.map(row => row.currentRevisionId))]
  const revisions = await em.find(MemoryRevisionEntity, { id: { $in: revisionIds } }, { refresh: true })
  const revisionById = new Map(revisions.map(row => [row.id, row]))
  const recordIds = eligibleRows.map(row => row.id)
  const conflicts = await em.find(MemoryConflictEntity, {
    status: 'unresolved',
    $or: [
      { activeRecordId: { $in: recordIds } },
      { candidateRecordId: { $in: recordIds } },
    ],
  }, { refresh: true })
  const conflicted = new Set(conflicts.flatMap(row => [row.activeRecordId, row.candidateRecordId]))
  const records = eligibleRows.flatMap(row => {
    const revision = revisionById.get(row.currentRevisionId)
    if (revision === undefined || revision.recordId !== row.id) throw new Error(`memory record "${row.id}" has an invalid current revision`)
    return [detachedRecord(row, revision, conflicted.has(row.id), now)]
  })
  if (ids === undefined) return Object.freeze(records)
  const byId = new Map(records.map(record => [record.id, record]))
  return Object.freeze(ids.flatMap(id => {
    const record = byId.get(id)
    return record === undefined ? [] : [record]
  }))
}

class OrmMemoryReader implements MemoryRepositoryReader {
  protected readonly em: SqlEntityManager

  constructor(em: SqlEntityManager) {
    this.em = em
  }
  getRecord(
    partition: MemoryPartition,
    id: string,
    now: string,
    options: MemoryReadOptions = {},
  ): Promise<MemoryRecord | undefined> {
    return loadRecords(this.em, partition, [id], now, options).then(records => records[0])
  }

  getRecords(
    partition: MemoryPartition,
    ids: readonly string[],
    now: string,
    options: MemoryReadOptions = {},
  ): Promise<readonly MemoryRecord[]> {
    return loadRecords(this.em, partition, ids, now, options)
  }

  async findSubject(partition: MemoryPartition, query: MemorySubjectQuery, now: string): Promise<MemoryRecord | undefined> {
    const rows = await this.em.find(MemoryRecordEntity, {
      instanceId: partition.instanceId,
      actorId: partition.actorId,
      ...exactScope(query),
      kind: query.kind,
      subjectKey: query.subjectKey,
      status: query.status,
    } as FilterQuery<MemoryRecordEntity>, { orderBy: { createdAt: 'asc', id: 'asc' }, refresh: true })
    if (rows.length === 0) return undefined
    let selected = rows[0]
    if (query.content !== undefined) {
      const revisions = await this.em.find(MemoryRevisionEntity, {
        id: { $in: rows.map(row => row.currentRevisionId) },
        content: query.content,
      }, { refresh: true })
      const matches = new Set(revisions.map(row => row.id))
      selected = rows.find(row => matches.has(row.currentRevisionId))
    }
    if (selected === undefined) return undefined
    return (await loadRecords(this.em, partition, [selected.id], now))[0]
  }

  async getReceipt(partition: MemoryPartition, operationId: string): Promise<MemoryOperationReceipt | undefined> {
    const row = await this.em.findOne(MemoryOperationEntity, {
      instanceId: partition.instanceId,
      actorId: partition.actorId,
      operationId,
    }, { refresh: true })
    if (row === null) return undefined
    return Object.freeze({
      commandDigest: row.commandDigest,
      resultKind: row.resultKind,
      ...(row.resultRecordId === null ? {} : { resultRecordId: row.resultRecordId }),
      ...(row.resultRevisionId === null ? {} : { resultRevisionId: row.resultRevisionId }),
    })
  }

  async listEvidence(partition: MemoryPartition, recordId: string, now: string): Promise<readonly MemoryEvidence[]> {
    const visible = await this.getRecord(partition, recordId, now)
    if (visible === undefined) return Object.freeze([])
    const rows = await this.em.find(MemoryEvidenceEntity, { recordId }, { orderBy: { createdAt: 'asc', id: 'asc' }, refresh: true })
    return Object.freeze(rows.map(detachedEvidence))
  }

  async listRevisions(partition: MemoryPartition, recordId: string, now: string): Promise<readonly MemoryRevision[]> {
    const visible = await this.getRecord(partition, recordId, now)
    if (visible === undefined) return Object.freeze([])
    const rows = await this.em.find(MemoryRevisionEntity, { recordId }, { orderBy: { ordinal: 'asc' }, refresh: true })
    return Object.freeze(rows.map(detachedRevision))
  }

  listCandidates(partition: MemoryPartition, now: string): Promise<readonly MemoryRecord[]> {
    return loadRecords(this.em, partition, undefined, now, { statuses: ['candidate'] }, { createdAt: 'asc', id: 'asc' })
  }

  async listConflicts(
    partition: MemoryPartition,
    recordId?: string,
  ): Promise<readonly MemoryConflict[]> {
    const criteria = recordCriteria(partition)
    const candidates = await this.em.find(MemoryRecordEntity, criteria, { fields: ['id'], refresh: true })
    const candidateIds = candidates.map(record => record.id)
    if (candidateIds.length === 0) return Object.freeze([])
    const rows = await this.em.find(MemoryConflictEntity, {
      candidateRecordId: { $in: candidateIds },
      ...(recordId === undefined
        ? {}
        : { $or: [{ activeRecordId: recordId }, { candidateRecordId: recordId }] }),
    } as FilterQuery<MemoryConflictEntity>, { orderBy: { createdAt: 'asc', id: 'asc' }, refresh: true })
    return Object.freeze(rows.map(detachedConflict))
  }

  async getUnresolvedConflict(partition: MemoryPartition, conflictId: string, now: string): Promise<MemoryConflict | undefined> {
    const row = await this.em.findOne(MemoryConflictEntity, { id: conflictId, status: 'unresolved' }, { refresh: true })
    if (row === null) return undefined
    const candidate = await this.getRecord(partition, row.candidateRecordId, now)
    return candidate === undefined ? undefined : detachedConflict(row)
  }

  activeGeneration(instanceId: string): Promise<string | undefined> {
    return activeMemorySemanticGeneration(this.em, instanceId)
  }
}

class OrmMemoryUnitOfWork extends OrmMemoryReader implements MemoryUnitOfWork {
  private readonly kind: MemoryDatabase['kind']

  constructor(em: SqlEntityManager, kind: MemoryDatabase['kind']) {
    super(em)
    this.kind = kind
  }

  async insertRecord(record: NewMemoryRecord): Promise<void> {
    await this.em.insert(MemoryRecordEntity, {
      id: record.id,
      instanceId: record.partition.instanceId,
      actorId: record.partition.actorId,
      kind: record.kind,
      subjectKey: record.subjectKey,
      scopeKind: record.scope.kind,
      projectId: record.scope.projectId ?? null,
      status: record.status,
      pinned: record.pinned,
      confidence: record.confidence,
      salience: record.salience,
      validFrom: record.validFrom ?? null,
      validUntil: record.validUntil ?? null,
      expiresAt: record.expiresAt ?? null,
      currentRevisionId: record.currentRevisionId,
      sourceSessionId: record.sourceSessionId,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    })
  }

  async insertRevision(revision: NewMemoryRevision): Promise<void> {
    await this.em.insert(MemoryRevisionEntity, {
      id: revision.id,
      recordId: revision.recordId,
      ordinal: revision.ordinal,
      content: revision.content,
      sourceSessionId: revision.sourceSessionId,
      sourceKind: revision.sourceKind,
      supersedesRevisionId: revision.supersedesRevisionId ?? null,
      validFrom: revision.validFrom ?? null,
      validUntil: revision.validUntil ?? null,
      expiresAt: revision.expiresAt ?? null,
      createdAt: revision.createdAt,
    })
  }

  async updateCurrentRevision(update: MemoryRevisionUpdate): Promise<boolean> {
    return await this.em.nativeUpdate(MemoryRecordEntity, {
      id: update.recordId,
      currentRevisionId: update.expectedRevisionId,
    }, {
      currentRevisionId: update.revisionId,
      confidence: update.confidence,
      salience: update.salience,
      validFrom: update.validFrom ?? null,
      validUntil: update.validUntil ?? null,
      expiresAt: update.expiresAt ?? null,
      updatedAt: update.timestamp,
    }) === 1
  }

  async setPinned(recordId: string, pinned: boolean, timestamp: string): Promise<void> {
    await this.em.nativeUpdate(MemoryRecordEntity, { id: recordId }, { pinned, updatedAt: timestamp })
  }

  async transitionStatus(
    recordId: string,
    expected: MemoryStatus,
    next: MemoryStatus,
    timestamp: string,
  ): Promise<boolean> {
    return await this.em.nativeUpdate(MemoryRecordEntity, { id: recordId, status: expected }, {
      status: next,
      updatedAt: timestamp,
    }) === 1
  }

  async updateRevisionSourceKind(revisionId: string, sourceKind: string): Promise<void> {
    await this.em.nativeUpdate(MemoryRevisionEntity, { id: revisionId }, { sourceKind })
  }

  async insertEvidence(evidence: NewMemoryEvidence): Promise<MemoryEvidence> {
    await this.em.upsert(MemoryEvidenceEntity, {
      id: evidence.id,
      recordId: evidence.recordId,
      sourceSessionId: evidence.sourceSessionId,
      sourceTurnId: evidence.sourceTurnId,
      role: evidence.role,
      relation: evidence.relation,
      excerpt: evidence.excerpt,
      createdAt: evidence.createdAt,
    }, {
      onConflictFields: ['recordId', 'sourceSessionId', 'sourceTurnId', 'role', 'relation', 'excerpt'],
      onConflictAction: 'ignore',
    })
    const row = await this.em.findOne(MemoryEvidenceEntity, {
      recordId: evidence.recordId,
      sourceSessionId: evidence.sourceSessionId,
      sourceTurnId: evidence.sourceTurnId,
      role: evidence.role,
      relation: evidence.relation,
      excerpt: evidence.excerpt,
    }, { refresh: true })
    if (row === null) throw new Error('memory evidence insertion produced no canonical row')
    return detachedEvidence(row)
  }

  async linkCandidateEvidence(candidateId: string, evidenceId: string): Promise<void> {
    await this.em.upsert(MemoryCandidateEvidenceEntity, { candidateId, evidenceId }, {
      onConflictFields: ['candidateId', 'evidenceId'],
      onConflictAction: 'ignore',
    })
  }

  async insertConflict(conflict: NewMemoryConflict): Promise<void> {
    await this.em.upsert(MemoryConflictEntity, {
      id: conflict.id,
      activeRecordId: conflict.activeRecordId,
      candidateRecordId: conflict.candidateRecordId,
      evidenceId: conflict.evidenceId ?? null,
      status: 'unresolved',
      createdAt: conflict.createdAt,
      resolvedAt: null,
      resolutionRevisionId: null,
    }, {
      onConflictFields: ['activeRecordId', 'candidateRecordId', 'status'],
      onConflictAction: 'ignore',
    })
  }

  async promotionEvidence(recordId: string, principalOnly: boolean): Promise<MemoryPromotionEvidence> {
    const contradiction = await this.em.count(MemoryEvidenceEntity, { recordId, relation: 'contradiction' }) > 0
    const unresolvedConflict = await this.em.count(MemoryConflictEntity, {
      candidateRecordId: recordId,
      status: 'unresolved',
    }) > 0
    const support = await this.em.find(MemoryEvidenceEntity, {
      recordId,
      relation: 'support',
      ...(principalOnly ? { role: 'principal' } : {}),
    }, { refresh: true })
    return Object.freeze({
      contradiction,
      unresolvedConflict,
      distinctSupportingSessions: new Set(support.map(row => row.sourceSessionId)).size,
    })
  }

  async resolveConflict(
    conflictId: string,
    status: MemoryConflict['status'],
    timestamp: string,
    resolutionRevisionId?: string,
  ): Promise<boolean> {
    return await this.em.nativeUpdate(MemoryConflictEntity, { id: conflictId, status: 'unresolved' }, {
      status,
      resolvedAt: timestamp,
      resolutionRevisionId: resolutionRevisionId ?? null,
    }) === 1
  }

  async insertReceipt(
    partition: MemoryPartition,
    operationId: string,
    commandKind: string,
    commandDigest: string,
    resultKind: string,
    recordId: string | undefined,
    revisionId: string | undefined,
    timestamp: string,
  ): Promise<void> {
    await this.em.insert(MemoryOperationEntity, {
      instanceId: partition.instanceId,
      actorId: partition.actorId,
      operationId,
      commandKind,
      commandDigest,
      resultKind,
      resultRecordId: recordId ?? null,
      resultRevisionId: revisionId ?? null,
      createdAt: timestamp,
    })
  }

  async replaceLexicalEntry(recordId: string, revisionId: string, content: string): Promise<void> {
    await this.removeLexicalEntry(recordId)
    if (this.kind === 'sqlite') {
      await this.em.execute('INSERT INTO memory_fts(record_id, revision_id, content) VALUES (?, ?, ?)', [recordId, revisionId, content], 'run')
      return
    }
    await this.em.execute(`
      INSERT INTO memory_lexical_index(record_id, revision_id, content)
      VALUES (?, ?, ?)
    `, [recordId, revisionId, content], 'run')
  }

  async removeLexicalEntry(recordId: string): Promise<void> {
    const table = this.kind === 'sqlite' ? 'memory_fts' : 'memory_lexical_index'
    await this.em.execute(`DELETE FROM ${table} WHERE record_id = ?`, [recordId], 'run')
  }

  async enqueueActiveProjection(instanceId: string, recordId: string, revisionId: string, timestamp: string): Promise<void> {
    await enqueueActiveMemoryProjection(this.em, instanceId, recordId, revisionId, timestamp)
  }

  async enqueueRevisionReplacement(
    instanceId: string,
    recordId: string,
    previousRevisionId: string,
    nextRevisionId: string,
    timestamp: string,
  ): Promise<void> {
    await enqueueMemoryRevisionReplacement(this.em, instanceId, recordId, previousRevisionId, nextRevisionId, timestamp)
  }

  async enqueueKnownProjectionDeletions(recordId: string, timestamp: string): Promise<void> {
    await enqueueKnownMemoryProjectionDeletions(this.em, recordId, timestamp)
  }

  async deleteRecord(recordId: string): Promise<boolean> {
    const exists = await this.em.count(MemoryRecordEntity, { id: recordId }) > 0
    if (!exists) return false
    await this.em.nativeUpdate(MemoryOperationEntity, { resultRecordId: recordId }, {
      resultKind: 'deleted',
      resultRecordId: null,
      resultRevisionId: null,
    })
    await this.em.nativeDelete(MemoryConflictEntity, {
      $or: [{ activeRecordId: recordId }, { candidateRecordId: recordId }],
    })
    const evidence = await this.em.find(MemoryEvidenceEntity, { recordId }, { fields: ['id'], refresh: true })
    if (evidence.length > 0) {
      await this.em.nativeDelete(MemoryCandidateEvidenceEntity, { evidenceId: { $in: evidence.map(row => row.id) } })
    }
    await this.em.nativeDelete(MemoryCandidateEvidenceEntity, { candidateId: recordId })
    await this.em.nativeDelete(MemoryEvidenceEntity, { recordId })
    await this.em.nativeDelete(MemoryVectorProjectionWorkEntity, { recordId })
    await this.em.nativeDelete(MemorySemanticIndexedRevisionEntity, { recordId })
    await this.em.nativeDelete(MemoryEmbeddingCacheEntity, { recordId })
    await this.removeLexicalEntry(recordId)
    await this.em.nativeDelete(MemoryRevisionEntity, { recordId })
    return await this.em.nativeDelete(MemoryRecordEntity, { id: recordId }) === 1
  }
}

class OrmMemoryRepository implements MemoryRepository {
  readonly projectionStore: MemoryProjectionStore
  private readonly database: MemoryDatabase

  constructor(database: MemoryDatabase) {
    this.database = database
    this.projectionStore = new MemoryProjectionStore(database)
  }

  getRecord(partition: MemoryPartition, id: string, now: string, options: MemoryReadOptions = {}): Promise<MemoryRecord | undefined> {
    return this.database.read(em => new OrmMemoryReader(em).getRecord(partition, id, now, options))
  }

  getRecords(partition: MemoryPartition, ids: readonly string[], now: string, options: MemoryReadOptions = {}): Promise<readonly MemoryRecord[]> {
    return this.database.read(em => new OrmMemoryReader(em).getRecords(partition, ids, now, options))
  }

  findSubject(partition: MemoryPartition, query: MemorySubjectQuery, now: string): Promise<MemoryRecord | undefined> {
    return this.database.read(em => new OrmMemoryReader(em).findSubject(partition, query, now))
  }

  getReceipt(partition: MemoryPartition, operationId: string): Promise<MemoryOperationReceipt | undefined> {
    return this.database.read(em => new OrmMemoryReader(em).getReceipt(partition, operationId))
  }

  listEvidence(partition: MemoryPartition, recordId: string, now: string): Promise<readonly MemoryEvidence[]> {
    return this.database.read(em => new OrmMemoryReader(em).listEvidence(partition, recordId, now))
  }

  listRevisions(partition: MemoryPartition, recordId: string, now: string): Promise<readonly MemoryRevision[]> {
    return this.database.read(em => new OrmMemoryReader(em).listRevisions(partition, recordId, now))
  }

  listCandidates(partition: MemoryPartition, now: string): Promise<readonly MemoryRecord[]> {
    return this.database.read(em => new OrmMemoryReader(em).listCandidates(partition, now))
  }

  listConflicts(partition: MemoryPartition, recordId?: string): Promise<readonly MemoryConflict[]> {
    return this.database.read(em => new OrmMemoryReader(em).listConflicts(partition, recordId))
  }

  getUnresolvedConflict(partition: MemoryPartition, conflictId: string, now: string): Promise<MemoryConflict | undefined> {
    return this.database.read(em => new OrmMemoryReader(em).getUnresolvedConflict(partition, conflictId, now))
  }

  activeGeneration(instanceId: string): Promise<string | undefined> {
    return this.database.read(em => new OrmMemoryReader(em).activeGeneration(instanceId))
  }

  transaction<T>(partition: MemoryPartition, work: (unit: MemoryUnitOfWork) => Promise<T>): Promise<T> {
    return this.database.write(partition, async em => {
      const target = new OrmMemoryUnitOfWork(em, this.database.kind)
      let active = true
      const unit = new Proxy(target, {
        get(value, property, receiver) {
          const member = Reflect.get(value, property, receiver)
          if (typeof member !== 'function') return member
          return (...args: unknown[]) => {
            if (!active) throw new Error('memory unit of work is no longer active')
            return Reflect.apply(member, value, args)
          }
        },
      }) as MemoryUnitOfWork
      try {
        return await work(unit)
      } finally {
        active = false
      }
    })
  }

  async lexicalCandidates(
    partition: MemoryPartition,
    query: string,
    now: string,
    limit: number,
  ): Promise<readonly MemoryLexicalCandidate[]> {
    const tokens = [...query.matchAll(LEXICAL_TOKEN)].map(match => match[0])
    if (tokens.length === 0) return Object.freeze([])
    return this.database.read(async em => {
      const eligibility = lexicalEligibility(partition, now)
      const rows = this.database.kind === 'sqlite'
        ? await em.execute(`
            SELECT r.id AS record_id, r.current_revision_id AS revision_id
            FROM memory_records r
            JOIN memory_fts f ON f.record_id = r.id AND f.revision_id = r.current_revision_id
            WHERE ${eligibility.sql} AND memory_fts MATCH ?
            ORDER BY bm25(memory_fts), r.id
            LIMIT ?
          `, [...eligibility.parameters, tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' OR '), limit], 'all')
        : await em.execute(`
            SELECT r.id AS record_id, r.current_revision_id AS revision_id
            FROM memory_records r
            JOIN memory_lexical_index f ON f.record_id = r.id AND f.revision_id = r.current_revision_id
            WHERE ${eligibility.sql} AND f.document @@ to_tsquery('simple', ?)
            ORDER BY ts_rank_cd(f.document, to_tsquery('simple', ?)) DESC, r.id
            LIMIT ?
          `, [
            ...eligibility.parameters,
            tokens.map(postgresqlLexeme).join(' | '),
            tokens.map(postgresqlLexeme).join(' | '),
            limit,
          ], 'all')
      return Object.freeze((rows as unknown as readonly Record<string, unknown>[]).map(row => Object.freeze({
        recordId: requiredText(row.record_id, 'lexical record_id'),
        revisionId: requiredText(row.revision_id, 'lexical revision_id'),
      })))
    })
  }

  stableProfile(partition: MemoryPartition, now: string, limit: number): Promise<readonly MemoryRecord[]> {
    return this.database.read(async em => {
      const eligibility = lexicalEligibility(partition, now)
      const rows = await em.execute(`
        SELECT r.id
        FROM memory_records r
        WHERE ${eligibility.sql}
          AND r.scope_kind = 'relationship'
          AND (
            (r.pinned = ? AND r.kind = 'preference')
            OR (r.kind = 'fact' AND r.subject_key LIKE 'principal.identity.%')
          )
        ORDER BY
          CASE WHEN r.pinned = ? AND r.kind = 'preference' THEN 1 ELSE 0 END DESC,
          r.salience DESC, r.updated_at DESC, r.id
        LIMIT ?
      `, [...eligibility.parameters, true, true, limit], 'all')
      const ids = (rows as unknown as readonly Record<string, unknown>[]).map(row => requiredText(row.id, 'stable profile id'))
      return loadRecords(em, partition, ids, now, { statuses: ['active'], temporal: true })
    })
  }

  readCanonicalSnapshot(
    partition: MemoryPartition,
    ids: readonly string[],
    now: string,
  ): Promise<MemoryCanonicalSnapshot> {
    return this.database.read(async em => {
      const reader = new OrmMemoryReader(em)
      const records = await reader.getRecords(partition, ids, now, { statuses: ['active'], temporal: true })
      const activeGenerationId = await reader.activeGeneration(partition.instanceId)
      return Object.freeze({
        records,
        ...(activeGenerationId === undefined ? {} : { activeGenerationId }),
      })
    })
  }

  close(): Promise<void> {
    return this.database.close()
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid memory database ${field}`)
  return value
}

function postgresqlLexeme(token: string): string {
  return `'${token.replaceAll("'", "''")}'`
}

function lexicalEligibility(
  partition: MemoryPartition,
  now: string,
): { readonly sql: string; readonly parameters: readonly string[] } {
  const parameters = [partition.instanceId, partition.actorId]
  const scope = partition.projectId === undefined
    ? `r.scope_kind = 'relationship'`
    : `(r.scope_kind = 'relationship' OR (r.scope_kind = 'project' AND r.project_id = ?))`
  if (partition.projectId !== undefined) parameters.push(partition.projectId)
  parameters.push(now, now, now)
  return {
    sql: `
      r.instance_id = ? AND r.actor_id = ? AND ${scope}
      AND r.status = 'active'
      AND (r.valid_from IS NULL OR r.valid_from <= ?)
      AND (r.valid_until IS NULL OR r.valid_until > ?)
      AND (r.expires_at IS NULL OR r.expires_at > ?)
    `,
    parameters,
  }
}

export function createMemoryRepository(database: MemoryDatabase): MemoryRepository {
  return new OrmMemoryRepository(database)
}
