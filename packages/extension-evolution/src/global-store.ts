import type { InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import {
  applyPersistedMutation,
  commandDigest,
  deepFreeze,
  EvolutionError,
  operationId,
  validateStoredProposal,
  type EvolutionEvidenceSummary,
  type EvolutionHistoryEntry,
  type EvolutionMutationCommand,
  type EvolutionMutationContext,
  type EvolutionProposal,
  type EvolutionProposalKind,
  type EvolutionProposalStatus,
  type EvolutionReminderDelivery,
} from './model.ts'
import { migrateEvolutionSchema } from './schema.ts'

interface GlobalPartition {
  readonly instanceId: string
  readonly actorId: string
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid Evolution database ${field}`)
  return value
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === null || value === undefined ? undefined : text(value, field)
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`invalid Evolution database ${field}`)
  }
  return value
}

function stringArray(value: unknown, field: string): readonly string[] {
  const parsed = JSON.parse(text(value, field)) as unknown
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error(`invalid Evolution database ${field}`)
  }
  return Object.freeze(parsed)
}

export class GlobalEvolutionStore {
  private readonly database: InstanceSqliteDatabase
  private readonly partition: GlobalPartition

  constructor(database: InstanceSqliteDatabase, partition: GlobalPartition) {
    this.database = database
    this.partition = partition
    migrateEvolutionSchema(database)
  }

  list(): readonly EvolutionProposal[] {
    const rows = this.database.prepare(`
      SELECT p.*, r.title, r.rationale, r.tags_json
      FROM evolution_proposals p
      JOIN evolution_revisions r
        ON r.instance_id = p.instance_id
       AND r.actor_id = p.actor_id
       AND r.proposal_id = p.id
       AND r.revision = p.current_revision
      WHERE p.instance_id = ? AND p.actor_id = ?
      ORDER BY p.created_at, p.id
    `).all(this.partition.instanceId, this.partition.actorId) as Record<string, unknown>[]
    return Object.freeze(rows.map(row => this.fromRow(row)))
  }

  inspect(id: string): EvolutionProposal | undefined {
    const row = this.database.prepare(`
      SELECT p.*, r.title, r.rationale, r.tags_json
      FROM evolution_proposals p
      JOIN evolution_revisions r
        ON r.instance_id = p.instance_id
       AND r.actor_id = p.actor_id
       AND r.proposal_id = p.id
       AND r.revision = p.current_revision
      WHERE p.instance_id = ? AND p.actor_id = ? AND p.id = ?
    `).get(this.partition.instanceId, this.partition.actorId, id) as Record<string, unknown> | undefined
    return row === undefined ? undefined : this.fromRow(row)
  }

  mutate(command: EvolutionMutationCommand, context: EvolutionMutationContext): EvolutionProposal {
    const commandId = operationId(command)
    const digest = commandDigest(command)
    return this.database.transaction(storage => {
      const receipt = storage.prepare(`
        SELECT command_digest, result_json FROM evolution_operations
        WHERE instance_id = ? AND actor_id = ? AND operation_id = ?
      `).get(this.partition.instanceId, this.partition.actorId, commandId) as Record<string, unknown> | undefined
      if (receipt !== undefined) {
        if (text(receipt.command_digest, 'operation.command_digest') !== digest) {
          throw new EvolutionError('OPERATION_CONFLICT', `operationId "${commandId}" was reused with a different command`)
        }
        return deepFreeze(JSON.parse(text(receipt.result_json, 'operation.result_json')) as EvolutionProposal)
      }
      const current = this.list()
      const mutation = applyPersistedMutation(current, command, context)
      const proposal = mutation.proposal
      this.persist(storage, proposal, mutation.revisions, current.find(item => item.id === proposal.id))
      storage.prepare(`
        INSERT INTO evolution_operations(instance_id, actor_id, operation_id, command_digest, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.partition.instanceId,
        this.partition.actorId,
        commandId,
        digest,
        JSON.stringify(proposal),
        context.now,
      )
      return proposal
    })
  }

  private fromRow(row: Record<string, unknown>): EvolutionProposal {
    const id = text(row.id, 'proposal.id')
    const params = [this.partition.instanceId, this.partition.actorId, id] as const
    const evidence = (this.database.prepare(`
      SELECT id, summary, source_id, created_at FROM evolution_evidence
      WHERE instance_id = ? AND actor_id = ? AND proposal_id = ?
      ORDER BY rowid
    `).all(...params) as Record<string, unknown>[]).map(item => deepFreeze<EvolutionEvidenceSummary>({
      id: text(item.id, 'evidence.id'),
      summary: text(item.summary, 'evidence.summary'),
      sourceId: text(item.source_id, 'evidence.source_id'),
      createdAt: text(item.created_at, 'evidence.created_at'),
    }))
    const history = (this.database.prepare(`
      SELECT id, from_status, to_status, detail, source_ids_json, created_at FROM evolution_transitions
      WHERE instance_id = ? AND actor_id = ? AND proposal_id = ?
      ORDER BY rowid
    `).all(...params) as Record<string, unknown>[]).map(item => {
      const fromStatus = optionalText(item.from_status, 'transition.from_status') as EvolutionProposalStatus | undefined
      return deepFreeze<EvolutionHistoryEntry>({
        id: text(item.id, 'transition.id'),
        ...(fromStatus === undefined ? {} : { fromStatus }),
        toStatus: text(item.to_status, 'transition.to_status') as EvolutionProposalStatus,
        detail: text(item.detail, 'transition.detail'),
        sourceIds: stringArray(item.source_ids_json, 'transition.source_ids_json'),
        createdAt: text(item.created_at, 'transition.created_at'),
      })
    })
    const reminders = (this.database.prepare(`
      SELECT id, session_id, turn_id, created_at FROM evolution_reminders
      WHERE instance_id = ? AND actor_id = ? AND proposal_id = ?
      ORDER BY rowid
    `).all(...params) as Record<string, unknown>[]).map(item => deepFreeze<EvolutionReminderDelivery>({
      id: text(item.id, 'reminder.id'),
      sessionId: text(item.session_id, 'reminder.session_id'),
      turnId: text(item.turn_id, 'reminder.turn_id'),
      createdAt: text(item.created_at, 'reminder.created_at'),
    }))
    const snoozedUntil = optionalText(row.snoozed_until, 'proposal.snoozed_until')
    const resumeStatus = optionalText(row.resume_status, 'proposal.resume_status') as EvolutionProposal['resumeStatus']
    const kind = text(row.kind, 'proposal.kind') as EvolutionProposalKind
    if (kind !== 'persona' && kind !== 'capability') throw new Error('invalid Evolution database proposal.kind')
    const common = {
      id,
      instanceId: text(row.instance_id, 'proposal.instance_id'),
      actorId: text(row.actor_id, 'proposal.actor_id'),
      dedupeKey: text(row.dedupe_key, 'proposal.dedupe_key'),
      title: text(row.title, 'revision.title'),
      rationale: text(row.rationale, 'revision.rationale'),
      tags: stringArray(row.tags_json, 'revision.tags_json'),
      status: text(row.status, 'proposal.status') as EvolutionProposalStatus,
      revision: integer(row.current_revision, 'proposal.current_revision'),
      ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
      ...(resumeStatus === undefined ? {} : { resumeStatus }),
      evidence: Object.freeze(evidence),
      history: Object.freeze(history),
      reminders: Object.freeze(reminders),
      createdAt: text(row.created_at, 'proposal.created_at'),
      updatedAt: text(row.updated_at, 'proposal.updated_at'),
    }
    return validateStoredProposal(deepFreeze({ ...common, kind, scope: 'global' as const }))
  }

  private persist(
    storage: InstanceSqliteDatabase,
    proposal: EvolutionProposal,
    revisions: readonly EvolutionProposal[],
    previous: EvolutionProposal | undefined,
  ): void {
    if (revisions.length === 0) return
    storage.prepare(`
      INSERT INTO evolution_proposals(
        instance_id, actor_id, id, kind, scope, dedupe_key, status, current_revision,
        snoozed_until, resume_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'global', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, actor_id, id) DO UPDATE SET
        status = excluded.status,
        current_revision = excluded.current_revision,
        snoozed_until = excluded.snoozed_until,
        resume_status = excluded.resume_status,
        updated_at = excluded.updated_at
    `).run(
      proposal.instanceId,
      proposal.actorId,
      proposal.id,
      proposal.kind,
      proposal.dedupeKey,
      proposal.status,
      proposal.revision,
      proposal.snoozedUntil ?? null,
      proposal.resumeStatus ?? null,
      proposal.createdAt,
      proposal.updatedAt,
    )
    const revisionInsert = storage.prepare(`
      INSERT INTO evolution_revisions(
        instance_id, actor_id, proposal_id, revision, title, rationale, tags_json,
        status, snoozed_until, resume_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const revision of revisions) revisionInsert.run(
      revision.instanceId,
      revision.actorId,
      revision.id,
      revision.revision,
      revision.title,
      revision.rationale,
      JSON.stringify(revision.tags),
      revision.status,
      revision.snoozedUntil ?? null,
      revision.resumeStatus ?? null,
      revision.updatedAt,
    )
    const evidenceInsert = storage.prepare(`
      INSERT INTO evolution_evidence(
        instance_id, actor_id, proposal_id, id, summary, source_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const evidence of proposal.evidence.slice(previous?.evidence.length ?? 0)) evidenceInsert.run(
      proposal.instanceId, proposal.actorId, proposal.id, evidence.id,
      evidence.summary, evidence.sourceId, evidence.createdAt,
    )
    const transitionInsert = storage.prepare(`
      INSERT INTO evolution_transitions(
        instance_id, actor_id, proposal_id, id, from_status, to_status, detail, source_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const transition of proposal.history.slice(previous?.history.length ?? 0)) transitionInsert.run(
      proposal.instanceId, proposal.actorId, proposal.id, transition.id,
      transition.fromStatus ?? null, transition.toStatus, transition.detail,
      JSON.stringify(transition.sourceIds), transition.createdAt,
    )
    const reminderInsert = storage.prepare(`
      INSERT INTO evolution_reminders(
        instance_id, actor_id, proposal_id, id, session_id, turn_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const reminder of proposal.reminders.slice(previous?.reminders.length ?? 0)) reminderInsert.run(
      proposal.instanceId, proposal.actorId, proposal.id, reminder.id,
      reminder.sessionId, reminder.turnId, reminder.createdAt,
    )
  }
}
