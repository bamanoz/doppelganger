import { randomUUID } from 'node:crypto'
import { Context, Service, type Logger } from '@deepseek-ai/cordis'
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
import {
  GlobalEvolutionSignalStore,
  type RecordEvolutionSignalDiagnosticRequest,
  type RecordEvolutionSignalsRequest,
  type RecordEvolutionSignalsResult,
} from './signal-store.ts'
import type { EvolutionSignalDiagnostic, EvolutionSignalPolicy } from './signal-model.ts'

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
  readonly signals: GlobalEvolutionSignalStore
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
  private readonly logger: Logger
  private readonly namespace: string
  private readonly remindersEnabled: boolean
  private readonly cooldownMs: number
  private readonly projectLockTimeoutMs: number
  private readonly now: () => Date
  private readonly id: () => string

  constructor(ctx: Context, config: EvolutionServiceConfig = {}) {
    super(ctx, 'doppelgangerEvolution')
    this.logger = ctx.logger('doppelganger-evolution')
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
    this.logger.info('component.activation.started')
    try {
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
      this.stores = {
        global,
        signals: new GlobalEvolutionSignalStore(database, { instanceId: persona.instanceId, actorId: actor.actorId }),
        ...(project === undefined ? {} : { project }),
      }
      this.logger.info('component.active projectScope=%s', project === undefined ? 'absent' : 'available')
    } catch (error) {
      this.logger.error('component.activation.failed reason=%s', error instanceof EvolutionError ? error.code : error instanceof Error ? error.name : typeof error)
      throw error
    }
  }

  async propose(request: EvolutionProposeRequest): Promise<EvolutionProposal> {
    return this.mutate(request.scope, { kind: 'propose', request })
  }

  async list(request: EvolutionListRequest = {}): Promise<EvolutionListResult> {
    this.logger.debug('evolution.list.started')
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
    const result = deepFreeze({
      proposals: Object.freeze(proposals),
      diagnostics: Object.freeze([...project.diagnostics, ...this.stores.signals.listDiagnostics()]),
    })
    this.logger.debug('evolution.list.completed proposals=%d diagnostics=%d', result.proposals.length, result.diagnostics.length)
    return result
  }

  async inspect(id: string): Promise<EvolutionInspectResult> {
    const global = this.stores.global.inspect(id)
    if (global !== undefined) {
      return deepFreeze({
        proposal: global,
        diagnostics: Object.freeze(this.stores.signals.listDiagnostics().filter(item => item.proposalId === id)),
      })
    }
    const project = await this.projectSnapshot()
    const proposal = project.proposals.find(item => item.id === id)
    if (proposal === undefined) throw new EvolutionError('NOT_FOUND', `proposal "${id}" was not found`)
    return deepFreeze({
      proposal,
      diagnostics: Object.freeze([
        ...project.diagnostics,
        ...this.stores.signals.listDiagnostics().filter(item => item.proposalId === id),
      ]),
    })
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
  recordSignals(request: RecordEvolutionSignalsRequest): RecordEvolutionSignalsResult {
    this.logger.debug('evolution.signals.record.started occurrences=%d', request.occurrences.length)
    const result = this.stores.signals.record(request)
    this.logger.debug('evolution.signals.record.completed occurrences=%d aggregates=%d duplicate=%s', result.occurrences.length, result.aggregates.length, result.duplicate)
    return result
  }

  recordSignalDiagnostic(
    request: Omit<RecordEvolutionSignalDiagnosticRequest, 'createdAt'> & { readonly createdAt?: string },
  ): EvolutionSignalDiagnostic {
    return this.stores.signals.recordDiagnostic({
      ...request,
      createdAt: request.createdAt ?? this.now().toISOString(),
    })
  }

  pruneSignalState(policy: EvolutionSignalPolicy): void {
    this.stores.signals.prune(this.now(), policy)
  }

  signalLastPrunedAt(): string | undefined {
    return this.stores.signals.lastPrunedAt()
  }

  async promoteEligibleSignals(): Promise<void> {
    for (const candidate of this.stores.signals.listEligible()) {
      if (candidate.aggregate.scope === 'project') {
        const projectId = this.ctx.doppelgangerPersona.projectId
        if (this.stores.project === undefined || candidate.aggregate.projectId === undefined || candidate.aggregate.projectId !== projectId) {
          this.recordSignalDiagnostic({
            code: 'PROJECT_PROMOTION_UNAVAILABLE',
            message: 'Project signal promotion requires the matching current workspace.',
            patternKey: candidate.aggregate.patternKey,
          })
          continue
        }
      }
      try {
        const proposal = await this.mutate(candidate.request.scope, { kind: 'propose', request: candidate.request })
        this.stores.signals.linkPromotion(candidate, proposal.id)
      } catch (cause) {
        if (cause instanceof EvolutionError && cause.code === 'DEDUPE_TERMINAL') {
          this.stores.signals.markTerminalCollision(candidate)
          this.recordSignalDiagnostic({
            code: 'SIGNAL_TERMINAL_COLLISION',
            message: 'A terminal proposal already owns the signal deduplication key.',
            patternKey: candidate.aggregate.patternKey,
          })
          continue
        }
        this.recordSignalDiagnostic({
          code: 'SIGNAL_PROMOTION_FAILED',
          message: 'Signal promotion failed and remains pending for retry.',
          patternKey: candidate.aggregate.patternKey,
        })
      }
    }
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
    this.logger.debug('evolution.mutation.started operation=%s scope=%s', command.kind, scope)
    try {
      const context = this.mutationContext()
      const result = scope === 'global'
        ? this.stores.global.mutate(command, context)
        : this.stores.project === undefined
          ? (() => { throw new EvolutionError('PROJECT_UNAVAILABLE', 'project scope requires Runtime Session workspace metadata') })()
          : await this.stores.project.mutate(command, context)
      this.logger.info('evolution.mutation.completed operation=%s scope=%s status=%s', command.kind, scope, result.status)
      return result
    } catch (error) {
      this.logger.warn('evolution.mutation.rejected operation=%s scope=%s code=%s', command.kind, scope, error instanceof EvolutionError ? error.code : 'EVOLUTION_OPERATION_FAILED')
      throw error
    }
  }

  private async mutateExisting(command: Exclude<EvolutionMutationCommand, { readonly kind: 'propose' }>): Promise<EvolutionProposal> {
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
}

