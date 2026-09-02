import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-composition-runtime'
import type {} from '@doppelganger/doppelganger-persona'
import type {} from '@doppelganger/doppelganger-protocols'
import type {} from '@doppelganger/doppelganger-sqlite'
import { GlobalEvolutionStore } from './global-store.ts'
import {
  deepFreeze,
  EvolutionError,
  proposalIsReminderEligible,
  relevanceScore,
  type EvolutionDiagnostic,
  type EvolutionListRequest,
  type EvolutionListResult,
  type EvolutionMutationCommand,
  type EvolutionMutationContext,
  type EvolutionProposal,
  type EvolutionProposeRequest,
  type EvolutionRejectRequest,
  type EvolutionReminderRecordRequest,
  type EvolutionSnoozeRequest,
  type EvolutionTransitionRequest,
} from './model.ts'
import { ProjectEvolutionStore } from './project-store.ts'

export type {
  EvolutionDiagnostic,
  EvolutionEvidenceInput,
  EvolutionEvidenceSummary,
  EvolutionForwardStatus,
  EvolutionHistoryEntry,
  EvolutionListRequest,
  EvolutionListResult,
  EvolutionProposal,
  EvolutionProposalKind,
  EvolutionProposalStatus,
  EvolutionProposeRequest,
  EvolutionRejectRequest,
  EvolutionReminderDelivery,
  EvolutionReminderRecordRequest,
  EvolutionScope,
  EvolutionSnoozeRequest,
  EvolutionTransitionRequest,
} from './model.ts'
export { EvolutionError } from './model.ts'

export interface EvolutionInspectResult {
  readonly proposal: EvolutionProposal
  readonly diagnostics: readonly EvolutionDiagnostic[]
}

export interface EvolutionServiceConfig {
  readonly namespace?: string
  readonly remindersEnabled?: boolean
  readonly reminderCooldownDays?: number
  readonly projectLockTimeoutMs?: number
  readonly now?: () => Date
  readonly id?: () => string
}

interface Stores {
  readonly global: GlobalEvolutionStore
  readonly project?: ProjectEvolutionStore
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerEvolution: EvolutionService
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000

export class EvolutionService extends Service {
  static inject = [
    'doppelgangerRuntimeSession',
    'doppelgangerActor',
    'doppelgangerPersona',
    'doppelgangerInstanceSqlite',
  ]

  private stores!: Stores
  private readonly namespace: string
  private readonly remindersEnabled: boolean
  private readonly cooldownMs: number
  private readonly projectLockTimeoutMs: number
  private readonly now: () => Date
  private readonly id: () => string

  constructor(ctx: Context, config: EvolutionServiceConfig = {}) {
    super(ctx, 'doppelgangerEvolution')
    this.namespace = config.namespace ?? 'evolution'
    if (!/^[a-z][a-z0-9-]*$/.test(this.namespace)) throw new TypeError('evolution namespace is invalid')
    this.remindersEnabled = config.remindersEnabled ?? true
    if (typeof this.remindersEnabled !== 'boolean') throw new TypeError('remindersEnabled must be a boolean')
    const cooldownDays = config.reminderCooldownDays ?? 7
    if (!Number.isSafeInteger(cooldownDays) || cooldownDays < 7 || cooldownDays > 3650) {
      throw new TypeError('reminderCooldownDays must be an integer between 7 and 3650')
    }
    this.cooldownMs = cooldownDays * DAY_MS
    this.projectLockTimeoutMs = config.projectLockTimeoutMs ?? 2_000
    if (!Number.isSafeInteger(this.projectLockTimeoutMs) || this.projectLockTimeoutMs < 100 || this.projectLockTimeoutMs > 60_000) {
      throw new TypeError('projectLockTimeoutMs must be an integer between 100 and 60000')
    }
    this.now = config.now ?? (() => new Date())
    this.id = config.id ?? randomUUID
  }

  async *[Service.init]() {
    const actor = this.ctx.doppelgangerActor
    if (actor.state !== 'bound') throw new Error('Evolution requires a bound host actor')
    const persona = this.ctx.doppelgangerPersona
    const runtime = this.ctx.doppelgangerRuntimeSession
    if (runtime.workspaceRoot !== persona.projectRoot) {
      throw new Error('Evolution requires consistent Runtime Session and Persona project metadata')
    }
    const database = await this.ctx.doppelgangerInstanceSqlite.open(this.namespace)
    const global = new GlobalEvolutionStore(database, { instanceId: persona.instanceId, actorId: actor.actorId })
    const project = runtime.workspaceRoot === undefined
      ? undefined
      : new ProjectEvolutionStore({
          root: runtime.workspaceRoot,
          instanceId: persona.instanceId,
          actorId: actor.actorId,
          projectId: persona.projectId!,
        }, this.projectLockTimeoutMs)
    this.stores = { global, ...(project === undefined ? {} : { project }) }
  }

  async propose(request: EvolutionProposeRequest): Promise<EvolutionProposal> {
    return this.mutate(request.scope, { kind: 'propose', request })
  }

  async list(request: EvolutionListRequest = {}): Promise<EvolutionListResult> {
    await this.resumeExpiredSnoozes()
    const global = this.stores.global.list()
    const project = await this.projectSnapshot()
    const now = this.now()
    const proposals = [...global, ...project.proposals]
      .filter(proposal => request.kind === undefined || proposal.kind === request.kind)
      .filter(proposal => request.scope === undefined || proposal.scope === request.scope)
      .filter(proposal => request.status === undefined || proposal.status === request.status)
      .filter(proposal => request.query === undefined || relevanceScore(proposal, request.query) > 0)
      .filter(proposal => request.dueOnly !== true || proposalIsReminderEligible(proposal, now, this.cooldownMs))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    return deepFreeze({ proposals: Object.freeze(proposals), diagnostics: project.diagnostics })
  }

  async inspect(id: string): Promise<EvolutionInspectResult> {
    await this.resumeExpiredSnoozes()
    const global = this.stores.global.inspect(id)
    if (global !== undefined) return deepFreeze({ proposal: global, diagnostics: Object.freeze([]) })
    const project = await this.projectSnapshot()
    const proposal = project.proposals.find(item => item.id === id)
    if (proposal === undefined) throw new EvolutionError('NOT_FOUND', `proposal "${id}" was not found`)
    return deepFreeze({ proposal, diagnostics: project.diagnostics })
  }

  async transition(request: EvolutionTransitionRequest): Promise<EvolutionProposal> {
    return this.mutateExisting({ kind: 'transition', request })
  }

  async snooze(request: EvolutionSnoozeRequest): Promise<EvolutionProposal> {
    return this.mutateExisting({ kind: 'snooze', request })
  }

  async reject(request: EvolutionRejectRequest): Promise<EvolutionProposal> {
    return this.mutateExisting({ kind: 'reject', request })
  }

  async recordReminder(request: EvolutionReminderRecordRequest): Promise<EvolutionProposal> {
    return this.mutateExisting({ kind: 'reminder', request })
  }

  async selectReminder(input: string): Promise<EvolutionProposal | undefined> {
    if (!this.remindersEnabled || input.trim().length === 0) return
    const result = await this.list({ dueOnly: true })
    const ranked = result.proposals
      .map(proposal => ({ proposal, score: relevanceScore(proposal, input) }))
      .filter(item => item.score > 0)
      .sort((left, right) => (
        right.score - left.score
        || (left.proposal.reminders.at(-1)?.createdAt ?? '').localeCompare(right.proposal.reminders.at(-1)?.createdAt ?? '')
        || left.proposal.createdAt.localeCompare(right.proposal.createdAt)
        || left.proposal.id.localeCompare(right.proposal.id)
      ))
    return ranked[0]?.proposal
  }

  private mutationContext(): EvolutionMutationContext {
    const actor = this.ctx.doppelgangerActor
    if (actor.state !== 'bound') throw new Error('Evolution requires a bound host actor')
    const persona = this.ctx.doppelgangerPersona
    return Object.freeze({
      instanceId: persona.instanceId,
      actorId: actor.actorId,
      ...(persona.projectId === undefined ? {} : { projectId: persona.projectId }),
      now: this.now().toISOString(),
      id: this.id,
    })
  }

  private async mutate(scope: 'global' | 'project', command: EvolutionMutationCommand): Promise<EvolutionProposal> {
    const context = this.mutationContext()
    if (scope === 'global') return this.stores.global.mutate(command, context)
    if (this.stores.project === undefined) {
      throw new EvolutionError('PROJECT_UNAVAILABLE', 'project scope requires Runtime Session workspace metadata')
    }
    return this.stores.project.mutate(command, context)
  }

  private async mutateExisting(command: Exclude<EvolutionMutationCommand, { readonly kind: 'propose' }>): Promise<EvolutionProposal> {
    await this.resumeExpiredSnoozes()
    const id = command.request.id
    if (this.stores.global.inspect(id) !== undefined) return this.mutate('global', command)
    const project = await this.projectSnapshot()
    if (project.proposals.some(proposal => proposal.id === id)) return this.mutate('project', command)
    throw new EvolutionError('NOT_FOUND', `proposal "${id}" was not found`)
  }

  private async projectSnapshot(): Promise<{ proposals: readonly EvolutionProposal[]; diagnostics: readonly EvolutionDiagnostic[] }> {
    if (this.stores.project === undefined) return { proposals: Object.freeze([]), diagnostics: Object.freeze([]) }
    const snapshot = await this.stores.project.list()
    return deepFreeze({
      proposals: Object.freeze(snapshot.documents.map(item => item.document.proposal)),
      diagnostics: snapshot.diagnostics,
    })
  }

  private async resumeExpiredSnoozes(): Promise<void> {
    const now = this.now()
    const global = this.stores.global.list()
    const project = await this.projectSnapshot()
    for (const proposal of [...global, ...project.proposals]) {
      if (proposal.status !== 'snoozed' || proposal.snoozedUntil === undefined || Date.parse(proposal.snoozedUntil) > now.getTime()) continue
      const command: EvolutionMutationCommand = {
        kind: 'resume',
        request: {
          operationId: `resume:${proposal.id}:${proposal.revision}`,
          id: proposal.id,
          expectedRevision: proposal.revision,
        },
      }
      await this.mutate(proposal.scope, command)
    }
  }
}
