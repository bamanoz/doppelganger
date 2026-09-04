import { createHash } from 'node:crypto'
import type { InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import { containsCredentialMaterial } from '@doppelganger/doppelganger-protocols'
import { deepFreeze, type EvolutionProposeRequest } from './model.ts'
import { evaluateSignalPromotion, signalPromotionRequest } from './signal-policy.ts'
import {
  createSignalOccurrence,
  signalFactorValue,
  type EvolutionSignalAggregate,
  type EvolutionSignalDiagnostic,
  type EvolutionSignalFactor,
  type EvolutionSignalOccurrence,
  type EvolutionSignalPolicy,
} from './signal-model.ts'
import { migrateEvolutionSchema } from './schema.ts'

interface SignalPartition {
  readonly instanceId: string
  readonly actorId: string
}

export interface RecordEvolutionSignalsRequest {
  readonly deliveryId: string
  readonly sessionId: string
  readonly turnId: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly occurrences: readonly EvolutionSignalOccurrence[]
  readonly policy: EvolutionSignalPolicy
}

export interface RecordEvolutionSignalsResult {
  readonly duplicate: boolean
  readonly occurrences: readonly EvolutionSignalOccurrence[]
  readonly aggregates: readonly EvolutionSignalAggregate[]
}

export interface EvolutionSignalPromotionCandidate {
  readonly aggregate: EvolutionSignalAggregate
  readonly occurrences: readonly EvolutionSignalOccurrence[]
  readonly request: EvolutionProposeRequest
}

export interface RecordEvolutionSignalDiagnosticRequest {
  readonly code: string
  readonly message: string
  readonly createdAt: string
  readonly deliveryId?: string
  readonly patternKey?: string
  readonly proposalId?: string
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`invalid Evolution signal database ${label}`)
  return value
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`invalid Evolution signal database ${label}`)
  return value
}

function optionalText(value: unknown, label: string): string | undefined {
  const normalized = value === null || value === undefined ? '' : text(value, label)
  return normalized.length === 0 ? undefined : normalized
}

function stringArray(value: unknown, label: string): readonly string[] {
  const parsed = JSON.parse(text(value, label)) as unknown
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error(`invalid Evolution signal database ${label}`)
  }
  return Object.freeze(parsed)
}

function timestamp(value: unknown, label: string): string {
  const normalized = text(value, label)
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`invalid Evolution signal database ${label}`)
  }
  return normalized
}

function factor(value: unknown, label: string): EvolutionSignalFactor {
  const normalized = text(value, label)
  if (normalized !== 'low' && normalized !== 'medium' && normalized !== 'high') {
    throw new Error(`invalid Evolution signal database ${label}`)
  }
  return normalized
}

function latestFactor(values: readonly EvolutionSignalFactor[]): EvolutionSignalFactor {
  return values.reduce((selected, value) => signalFactorValue(value) > signalFactorValue(selected) ? value : selected, 'low')
}

function aggregateKey(occurrence: EvolutionSignalOccurrence): readonly unknown[] {
  return [occurrence.kind, occurrence.scope, occurrence.projectId ?? '', occurrence.patternKey]
}

function diagnosticText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) throw new TypeError(`${label} must contain 1-${maximum} characters`)
  if (containsCredentialMaterial(normalized)) throw new TypeError(`${label} appears to contain credential material`)
  return normalized
}

function diagnosticId(input: RecordEvolutionSignalDiagnosticRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([input.code, input.deliveryId ?? '', input.patternKey ?? '', input.proposalId ?? '']))
    .digest('hex')
}

export class GlobalEvolutionSignalStore {
  readonly #database: InstanceSqliteDatabase
  readonly #partition: SignalPartition

  constructor(database: InstanceSqliteDatabase, partition: SignalPartition) {
    this.#database = database
    this.#partition = partition
    migrateEvolutionSchema(database)
  }

  record(request: RecordEvolutionSignalsRequest): RecordEvolutionSignalsResult {
    return this.#database.transaction(database => {
      const receipt = database.prepare(`
        SELECT delivery_id FROM evolution_signal_receipts
        WHERE instance_id = ? AND actor_id = ? AND delivery_id = ?
      `).get(this.#partition.instanceId, this.#partition.actorId, request.deliveryId)
      if (receipt !== undefined) {
        return deepFreeze({ duplicate: true, occurrences: Object.freeze([]), aggregates: Object.freeze([]) })
      }
      database.prepare(`
        INSERT INTO evolution_signal_receipts(
          instance_id, actor_id, delivery_id, session_id, turn_id, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.#partition.instanceId,
        this.#partition.actorId,
        request.deliveryId,
        request.sessionId,
        request.turnId,
        request.createdAt,
        request.expiresAt,
      )

      const inserted: EvolutionSignalOccurrence[] = []
      const insert = database.prepare(`
        INSERT OR IGNORE INTO evolution_signals(
          instance_id, actor_id, id, project_id, kind, scope, pattern_key, title, rationale,
          summary, tags_json, severity, reuse_value, source, delivery_id, session_id, turn_id,
          call_ids_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const occurrence of request.occurrences) {
        this.#assertOccurrencePartition(occurrence, request)
        const result = insert.run(
          occurrence.instanceId,
          occurrence.actorId,
          occurrence.id,
          occurrence.projectId ?? '',
          occurrence.kind,
          occurrence.scope,
          occurrence.patternKey,
          occurrence.title,
          occurrence.rationale,
          occurrence.summary,
          JSON.stringify(occurrence.tags),
          occurrence.severity,
          occurrence.reuseValue,
          occurrence.source,
          occurrence.deliveryId,
          occurrence.sessionId,
          occurrence.turnId,
          JSON.stringify(occurrence.callIds),
          occurrence.createdAt,
        )
        if (Number(result.changes) > 0) inserted.push(occurrence)
      }
      const keys = new Map<string, EvolutionSignalOccurrence>()
      for (const occurrence of inserted) keys.set(JSON.stringify(aggregateKey(occurrence)), occurrence)
      const aggregates = [...keys.values()].map(occurrence => this.#recomputeAggregate(database, occurrence, request.policy))
      return deepFreeze({
        duplicate: false,
        occurrences: Object.freeze(inserted),
        aggregates: Object.freeze(aggregates),
      })
    })
  }

  listEligible(): readonly EvolutionSignalPromotionCandidate[] {
    const aggregates = this.#listAggregates("promotion_status = 'eligible'")
    return Object.freeze(aggregates.map(aggregate => {
      const occurrences = this.listOccurrences(aggregate)
      return deepFreeze({ aggregate, occurrences, request: signalPromotionRequest(aggregate, occurrences) })
    }))
  }

  listOccurrences(aggregate: Pick<EvolutionSignalAggregate, 'kind' | 'scope' | 'projectId' | 'patternKey'>): readonly EvolutionSignalOccurrence[] {
    const rows = this.#database.prepare(`
      SELECT * FROM evolution_signals
      WHERE instance_id = ? AND actor_id = ? AND kind = ? AND scope = ? AND project_id = ? AND pattern_key = ?
      ORDER BY created_at, id
    `).all(
      this.#partition.instanceId,
      this.#partition.actorId,
      aggregate.kind,
      aggregate.scope,
      aggregate.projectId ?? '',
      aggregate.patternKey,
    ) as Record<string, unknown>[]
    return Object.freeze(rows.map(row => this.#occurrenceFromRow(row)))
  }

  linkPromotion(candidate: EvolutionSignalPromotionCandidate, proposalId: string): void {
    const operationId = candidate.request.operationId
    const dedupeKey = candidate.request.dedupeKey
    this.#database.prepare(`
      UPDATE evolution_signal_aggregates
      SET promotion_status = 'promoted', proposal_id = ?, promotion_operation_id = ?, proposal_dedupe_key = ?
      WHERE instance_id = ? AND actor_id = ? AND kind = ? AND scope = ? AND project_id = ? AND pattern_key = ?
        AND promotion_status IN ('eligible', 'promoted')
    `).run(
      proposalId,
      operationId,
      dedupeKey,
      this.#partition.instanceId,
      this.#partition.actorId,
      candidate.aggregate.kind,
      candidate.aggregate.scope,
      candidate.aggregate.projectId ?? '',
      candidate.aggregate.patternKey,
    )
  }

  markTerminalCollision(candidate: EvolutionSignalPromotionCandidate): void {
    this.#database.prepare(`
      UPDATE evolution_signal_aggregates
      SET promotion_status = 'terminal-collision', promotion_operation_id = ?, proposal_dedupe_key = ?
      WHERE instance_id = ? AND actor_id = ? AND kind = ? AND scope = ? AND project_id = ? AND pattern_key = ?
    `).run(
      candidate.request.operationId,
      candidate.request.dedupeKey,
      this.#partition.instanceId,
      this.#partition.actorId,
      candidate.aggregate.kind,
      candidate.aggregate.scope,
      candidate.aggregate.projectId ?? '',
      candidate.aggregate.patternKey,
    )
  }

  recordDiagnostic(request: RecordEvolutionSignalDiagnosticRequest): EvolutionSignalDiagnostic {
    const code = diagnosticText(request.code, 'signal diagnostic code', 200)
    const message = diagnosticText(request.message, 'signal diagnostic message', 1_000)
    const deliveryId = request.deliveryId === undefined ? '' : diagnosticText(request.deliveryId, 'signal diagnostic deliveryId', 300)
    const patternKey = request.patternKey === undefined ? '' : diagnosticText(request.patternKey, 'signal diagnostic patternKey', 200)
    const proposalId = request.proposalId === undefined ? '' : diagnosticText(request.proposalId, 'signal diagnostic proposalId', 300)
    const id = diagnosticId({ ...request, code, message })
    this.#database.prepare(`
      INSERT INTO evolution_signal_diagnostics(
        instance_id, actor_id, id, code, message, delivery_id, pattern_key, proposal_id,
        occurrence_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(instance_id, actor_id, code, delivery_id, pattern_key, proposal_id)
      DO UPDATE SET message = excluded.message,
                    occurrence_count = evolution_signal_diagnostics.occurrence_count + 1,
                    updated_at = excluded.updated_at
    `).run(
      this.#partition.instanceId,
      this.#partition.actorId,
      id,
      code,
      message,
      deliveryId,
      patternKey,
      proposalId,
      request.createdAt,
      request.createdAt,
    )
    return deepFreeze({
      path: 'signals',
      code,
      message,
      createdAt: request.createdAt,
      ...(deliveryId.length === 0 ? {} : { deliveryId }),
      ...(patternKey.length === 0 ? {} : { patternKey }),
      ...(proposalId.length === 0 ? {} : { proposalId }),
    })
  }

  listDiagnostics(limit = 100): readonly EvolutionSignalDiagnostic[] {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000) throw new TypeError('signal diagnostic limit must be between 0 and 1000')
    const rows = this.#database.prepare(`
      SELECT * FROM evolution_signal_diagnostics
      WHERE instance_id = ? AND actor_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(this.#partition.instanceId, this.#partition.actorId, limit) as Record<string, unknown>[]
    return Object.freeze(rows.map(row => {
      const deliveryId = optionalText(row.delivery_id, 'diagnostic.delivery_id')
      const patternKey = optionalText(row.pattern_key, 'diagnostic.pattern_key')
      const proposalId = optionalText(row.proposal_id, 'diagnostic.proposal_id')
      return deepFreeze({
        path: 'signals' as const,
        code: text(row.code, 'diagnostic.code'),
        message: text(row.message, 'diagnostic.message'),
        createdAt: timestamp(row.updated_at, 'diagnostic.updated_at'),
        ...(deliveryId === undefined ? {} : { deliveryId }),
        ...(patternKey === undefined ? {} : { patternKey }),
        ...(proposalId === undefined ? {} : { proposalId }),
      })
    }))
  }

  prune(now: Date, policy: EvolutionSignalPolicy): void {
    const nowIso = now.toISOString()
    const cutoff = new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1_000).toISOString()
    this.#database.transaction(database => {
      database.prepare(`
        DELETE FROM evolution_signal_receipts
        WHERE instance_id = ? AND actor_id = ? AND expires_at <= ?
      `).run(this.#partition.instanceId, this.#partition.actorId, nowIso)
      database.prepare(`
        DELETE FROM evolution_signal_diagnostics
        WHERE instance_id = ? AND actor_id = ? AND updated_at < ?
      `).run(this.#partition.instanceId, this.#partition.actorId, cutoff)
      database.prepare(`
        DELETE FROM evolution_signals
        WHERE instance_id = ? AND actor_id = ? AND created_at < ?
      `).run(this.#partition.instanceId, this.#partition.actorId, cutoff)
      database.prepare(`
        DELETE FROM evolution_signals
        WHERE rowid IN (
          SELECT rowid FROM evolution_signals
          WHERE instance_id = ? AND actor_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT -1 OFFSET ?
        )
      `).run(this.#partition.instanceId, this.#partition.actorId, policy.maxStoredOccurrences)
      this.#recomputePendingAggregates(database, policy)
      database.prepare(`
        INSERT INTO evolution_signal_meta(instance_id, actor_id, key, value, updated_at)
        VALUES (?, ?, 'last-prune-at', ?, ?)
        ON CONFLICT(instance_id, actor_id, key)
        DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(this.#partition.instanceId, this.#partition.actorId, nowIso, nowIso)
    })
  }

  lastPrunedAt(): string | undefined {
    const row = this.#database.prepare(`
      SELECT value FROM evolution_signal_meta
      WHERE instance_id = ? AND actor_id = ? AND key = 'last-prune-at'
    `).get(this.#partition.instanceId, this.#partition.actorId) as Record<string, unknown> | undefined
    return row === undefined ? undefined : timestamp(row.value, 'meta.value')
  }

  #assertOccurrencePartition(occurrence: EvolutionSignalOccurrence, request: RecordEvolutionSignalsRequest): void {
    if (occurrence.instanceId !== this.#partition.instanceId || occurrence.actorId !== this.#partition.actorId) {
      throw new TypeError('signal occurrence partition does not match the store partition')
    }
    if (occurrence.deliveryId !== request.deliveryId || occurrence.sessionId !== request.sessionId || occurrence.turnId !== request.turnId) {
      throw new TypeError('signal occurrence provenance does not match the committed delivery')
    }
  }

  #recomputeAggregate(
    database: InstanceSqliteDatabase,
    occurrence: EvolutionSignalOccurrence,
    policy: EvolutionSignalPolicy,
  ): EvolutionSignalAggregate {
    const rows = database.prepare(`
      SELECT * FROM evolution_signals
      WHERE instance_id = ? AND actor_id = ? AND kind = ? AND scope = ? AND project_id = ? AND pattern_key = ?
      ORDER BY created_at, id
    `).all(
      this.#partition.instanceId,
      this.#partition.actorId,
      occurrence.kind,
      occurrence.scope,
      occurrence.projectId ?? '',
      occurrence.patternKey,
    ) as Record<string, unknown>[]
    const occurrences = rows.map(row => this.#occurrenceFromRow(row))
    const existing = database.prepare(`
      SELECT * FROM evolution_signal_aggregates
      WHERE instance_id = ? AND actor_id = ? AND kind = ? AND scope = ? AND project_id = ? AND pattern_key = ?
    `).get(
      this.#partition.instanceId,
      this.#partition.actorId,
      occurrence.kind,
      occurrence.scope,
      occurrence.projectId ?? '',
      occurrence.patternKey,
    ) as Record<string, unknown> | undefined
    const representative = occurrences.at(-1)!
    const proposalId = existing === undefined ? undefined : optionalText(existing.proposal_id, 'aggregate.proposal_id')
    const promotionStatus = existing === undefined
      ? 'pending'
      : text(existing.promotion_status, 'aggregate.promotion_status') as EvolutionSignalAggregate['promotionStatus']
    const aggregate: EvolutionSignalAggregate = deepFreeze({
      instanceId: this.#partition.instanceId,
      actorId: this.#partition.actorId,
      ...(representative.projectId === undefined ? {} : { projectId: representative.projectId }),
      kind: representative.kind,
      scope: representative.scope,
      patternKey: representative.patternKey,
      title: representative.title,
      rationale: representative.rationale,
      tags: Object.freeze([...new Set(occurrences.flatMap(item => item.tags))].sort()),
      severity: latestFactor(occurrences.map(item => item.severity)),
      reuseValue: latestFactor(occurrences.map(item => item.reuseValue)),
      occurrenceCount: occurrences.length,
      deterministicOccurrenceCount: occurrences.filter(item => item.source === 'deterministic').length,
      distinctTurns: new Set(occurrences.map(item => `${item.sessionId}\u0000${item.turnId}`)).size,
      distinctSessions: new Set(occurrences.map(item => item.sessionId)).size,
      firstSeenAt: occurrences[0]!.createdAt,
      lastSeenAt: representative.createdAt,
      promotionStatus,
      ...(proposalId === undefined ? {} : { proposalId }),
      ...(existing === undefined || optionalText(existing.promotion_operation_id, 'aggregate.promotion_operation_id') === undefined
        ? {}
        : { promotionOperationId: optionalText(existing.promotion_operation_id, 'aggregate.promotion_operation_id')! }),
      ...(existing === undefined || optionalText(existing.proposal_dedupe_key, 'aggregate.proposal_dedupe_key') === undefined
        ? {}
        : { proposalDedupeKey: optionalText(existing.proposal_dedupe_key, 'aggregate.proposal_dedupe_key')! }),
    })
    const evaluation = evaluateSignalPromotion(aggregate, policy)
    const nextStatus = promotionStatus === 'promoted' || promotionStatus === 'terminal-collision'
      ? promotionStatus
      : evaluation.eligible ? 'eligible' : 'pending'
    database.prepare(`
      INSERT INTO evolution_signal_aggregates(
        instance_id, actor_id, project_id, kind, scope, pattern_key, title, rationale, tags_json,
        severity, reuse_value, occurrence_count, deterministic_occurrence_count, distinct_turns,
        distinct_sessions, first_seen_at, last_seen_at, promotion_status, proposal_id,
        promotion_operation_id, proposal_dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, actor_id, kind, scope, project_id, pattern_key)
      DO UPDATE SET title = excluded.title,
                    rationale = excluded.rationale,
                    tags_json = excluded.tags_json,
                    severity = excluded.severity,
                    reuse_value = excluded.reuse_value,
                    occurrence_count = excluded.occurrence_count,
                    deterministic_occurrence_count = excluded.deterministic_occurrence_count,
                    distinct_turns = excluded.distinct_turns,
                    distinct_sessions = excluded.distinct_sessions,
                    first_seen_at = excluded.first_seen_at,
                    last_seen_at = excluded.last_seen_at,
                    promotion_status = excluded.promotion_status,
                    proposal_id = excluded.proposal_id,
                    promotion_operation_id = excluded.promotion_operation_id,
                    proposal_dedupe_key = excluded.proposal_dedupe_key
    `).run(
      aggregate.instanceId,
      aggregate.actorId,
      aggregate.projectId ?? '',
      aggregate.kind,
      aggregate.scope,
      aggregate.patternKey,
      aggregate.title,
      aggregate.rationale,
      JSON.stringify(aggregate.tags),
      aggregate.severity,
      aggregate.reuseValue,
      aggregate.occurrenceCount,
      aggregate.deterministicOccurrenceCount,
      aggregate.distinctTurns,
      aggregate.distinctSessions,
      aggregate.firstSeenAt,
      aggregate.lastSeenAt,
      nextStatus,
      aggregate.proposalId ?? null,
      aggregate.promotionOperationId ?? null,
      aggregate.proposalDedupeKey ?? null,
    )
    return deepFreeze({ ...aggregate, promotionStatus: nextStatus })
  }

  #recomputePendingAggregates(database: InstanceSqliteDatabase, policy: EvolutionSignalPolicy): void {
    const rows = database.prepare(`
      SELECT * FROM evolution_signal_aggregates
      WHERE instance_id = ? AND actor_id = ? AND promotion_status IN ('pending', 'eligible')
      ORDER BY kind, scope, project_id, pattern_key
    `).all(this.#partition.instanceId, this.#partition.actorId) as Record<string, unknown>[]
    for (const row of rows) {
      const aggregate = this.#aggregateFromRow(row)
      const occurrences = this.listOccurrences(aggregate)
      if (occurrences.length === 0) {
        database.prepare(`
          DELETE FROM evolution_signal_aggregates
          WHERE instance_id = ? AND actor_id = ? AND kind = ? AND scope = ? AND project_id = ? AND pattern_key = ?
        `).run(
          this.#partition.instanceId,
          this.#partition.actorId,
          aggregate.kind,
          aggregate.scope,
          aggregate.projectId ?? '',
          aggregate.patternKey,
        )
      } else {
        this.#recomputeAggregate(database, occurrences.at(-1)!, policy)
      }
    }
  }

  #listAggregates(predicate: string): readonly EvolutionSignalAggregate[] {
    const rows = this.#database.prepare(`
      SELECT * FROM evolution_signal_aggregates
      WHERE instance_id = ? AND actor_id = ? AND ${predicate}
      ORDER BY last_seen_at, pattern_key
    `).all(this.#partition.instanceId, this.#partition.actorId) as Record<string, unknown>[]
    return Object.freeze(rows.map(row => this.#aggregateFromRow(row)))
  }

  #aggregateFromRow(row: Record<string, unknown>): EvolutionSignalAggregate {
    const projectId = optionalText(row.project_id, 'aggregate.project_id')
    const proposalId = optionalText(row.proposal_id, 'aggregate.proposal_id')
    const promotionOperationId = optionalText(row.promotion_operation_id, 'aggregate.promotion_operation_id')
    const proposalDedupeKey = optionalText(row.proposal_dedupe_key, 'aggregate.proposal_dedupe_key')
    return deepFreeze({
      instanceId: text(row.instance_id, 'aggregate.instance_id'),
      actorId: text(row.actor_id, 'aggregate.actor_id'),
      ...(projectId === undefined ? {} : { projectId }),
      kind: text(row.kind, 'aggregate.kind') as EvolutionSignalAggregate['kind'],
      scope: text(row.scope, 'aggregate.scope') as EvolutionSignalAggregate['scope'],
      patternKey: text(row.pattern_key, 'aggregate.pattern_key'),
      title: text(row.title, 'aggregate.title'),
      rationale: text(row.rationale, 'aggregate.rationale'),
      tags: stringArray(row.tags_json, 'aggregate.tags_json'),
      severity: factor(row.severity, 'aggregate.severity'),
      reuseValue: factor(row.reuse_value, 'aggregate.reuse_value'),
      occurrenceCount: integer(row.occurrence_count, 'aggregate.occurrence_count'),
      deterministicOccurrenceCount: integer(row.deterministic_occurrence_count, 'aggregate.deterministic_occurrence_count'),
      distinctTurns: integer(row.distinct_turns, 'aggregate.distinct_turns'),
      distinctSessions: integer(row.distinct_sessions, 'aggregate.distinct_sessions'),
      firstSeenAt: timestamp(row.first_seen_at, 'aggregate.first_seen_at'),
      lastSeenAt: timestamp(row.last_seen_at, 'aggregate.last_seen_at'),
      promotionStatus: text(row.promotion_status, 'aggregate.promotion_status') as EvolutionSignalAggregate['promotionStatus'],
      ...(proposalId === undefined ? {} : { proposalId }),
      ...(promotionOperationId === undefined ? {} : { promotionOperationId }),
      ...(proposalDedupeKey === undefined ? {} : { proposalDedupeKey }),
    })
  }

  #occurrenceFromRow(row: Record<string, unknown>): EvolutionSignalOccurrence {
    const projectId = optionalText(row.project_id, 'signal.project_id')
    return createSignalOccurrence({
      id: text(row.id, 'signal.id'),
      instanceId: text(row.instance_id, 'signal.instance_id'),
      actorId: text(row.actor_id, 'signal.actor_id'),
      ...(projectId === undefined ? {} : { projectId }),
      deliveryId: text(row.delivery_id, 'signal.delivery_id'),
      sessionId: text(row.session_id, 'signal.session_id'),
      turnId: text(row.turn_id, 'signal.turn_id'),
      callIds: stringArray(row.call_ids_json, 'signal.call_ids_json'),
      source: text(row.source, 'signal.source') as EvolutionSignalOccurrence['source'],
      createdAt: timestamp(row.created_at, 'signal.created_at'),
      hypothesis: {
        kind: text(row.kind, 'signal.kind') as EvolutionSignalOccurrence['kind'],
        scope: text(row.scope, 'signal.scope') as EvolutionSignalOccurrence['scope'],
        patternKey: text(row.pattern_key, 'signal.pattern_key'),
        title: text(row.title, 'signal.title'),
        rationale: text(row.rationale, 'signal.rationale'),
        summary: text(row.summary, 'signal.summary'),
        tags: stringArray(row.tags_json, 'signal.tags_json'),
        severity: factor(row.severity, 'signal.severity'),
        reuseValue: factor(row.reuse_value, 'signal.reuse_value'),
        provenance: Object.freeze([
          text(row.delivery_id, 'signal.delivery_id'),
          text(row.session_id, 'signal.session_id'),
          text(row.turn_id, 'signal.turn_id'),
        ]),
      },
    })
  }
}
