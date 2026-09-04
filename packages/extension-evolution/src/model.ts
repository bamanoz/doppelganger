import { createHash } from 'node:crypto'
import { containsCredentialMaterial } from '@doppelganger/doppelganger-protocols'

export type EvolutionProposalKind = 'persona' | 'capability'
export type EvolutionScope = 'global' | 'project'
export type EvolutionProposalStatus =
  | 'proposed'
  | 'reviewing'
  | 'researching'
  | 'options-ready'
  | 'selected'
  | 'planned'
  | 'implementing'
  | 'snoozed'
  | 'rejected'
  | 'done'
export type EvolutionForwardStatus = Exclude<EvolutionProposalStatus, 'snoozed' | 'rejected' | 'done'>
export interface EvolutionEvidenceInput {
  readonly summary: string
  readonly sourceId: string
}

export interface EvolutionEvidenceSummary extends EvolutionEvidenceInput {
  readonly id: string
  readonly createdAt: string
}

export interface EvolutionHistoryEntry {
  readonly id: string
  readonly fromStatus?: EvolutionProposalStatus
  readonly toStatus: EvolutionProposalStatus
  readonly detail: string
  readonly sourceIds: readonly string[]
  readonly createdAt: string
}
export interface EvolutionReminderDelivery {
  readonly id: string
  readonly sessionId: string
  readonly turnId: string
  readonly createdAt: string
}

interface EvolutionProposalBase {
  readonly id: string
  readonly instanceId: string
  readonly actorId: string
  readonly dedupeKey: string
  readonly title: string
  readonly rationale: string
  readonly tags: readonly string[]
  readonly status: EvolutionProposalStatus
  readonly revision: number
  readonly snoozedUntil?: string
  readonly resumeStatus?: EvolutionForwardStatus
  readonly evidence: readonly EvolutionEvidenceSummary[]
  readonly history: readonly EvolutionHistoryEntry[]
  readonly reminders: readonly EvolutionReminderDelivery[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PersonaEvolutionProposal extends EvolutionProposalBase {
  readonly kind: 'persona'
  readonly scope: 'global'
  readonly projectId?: never
}

export type CapabilityEvolutionProposal = EvolutionProposalBase & (
  | { readonly kind: 'capability'; readonly scope: 'global'; readonly projectId?: never }
  | { readonly kind: 'capability'; readonly scope: 'project'; readonly projectId: string }
)

export type EvolutionProposal = PersonaEvolutionProposal | CapabilityEvolutionProposal

export interface EvolutionProposeRequest {
  readonly operationId: string
  readonly kind: EvolutionProposalKind
  readonly scope: EvolutionScope
  readonly dedupeKey: string
  readonly title: string
  readonly rationale: string
  readonly tags?: readonly string[]
  readonly evidence?: readonly EvolutionEvidenceInput[]
}

export interface EvolutionReviseRequest {
  readonly operationId: string
  readonly id: string
  readonly expectedRevision: number
  readonly title?: string
  readonly rationale?: string
  readonly tags?: readonly string[]
  readonly evidence?: readonly EvolutionEvidenceInput[]
}

export type EvolutionTransitionRequest = {
  readonly operationId: string
  readonly id: string
  readonly expectedRevision: number
} & (
  | { readonly target: 'reviewing'; readonly reviewSummary: string }
  | { readonly target: 'researching'; readonly researchQuestion: string }
  | { readonly target: 'options-ready'; readonly optionsSummary: string; readonly sourceIds: readonly string[] }
  | { readonly target: 'selected'; readonly selectedOption: string }
  | { readonly target: 'planned'; readonly planReference: string }
  | { readonly target: 'implementing'; readonly implementationReference: string }
  | { readonly target: 'done'; readonly outcome: string }
  | { readonly target: Exclude<EvolutionProposalStatus, 'reviewing' | 'researching' | 'options-ready' | 'selected' | 'planned' | 'implementing' | 'done' | 'snoozed' | 'rejected'>; readonly detail: string }
)

export interface EvolutionSnoozeRequest {
  readonly operationId: string
  readonly id: string
  readonly expectedRevision: number
  readonly until: string
  readonly reason: string
}
export interface EvolutionResumeRequest {
  readonly operationId: string
  readonly id: string
  readonly expectedRevision: number
}

export interface EvolutionRejectRequest {
  readonly operationId: string
  readonly id: string
  readonly expectedRevision: number
  readonly reason: string
}

export interface EvolutionReminderRecordRequest {
  readonly operationId: string
  readonly id: string
  readonly expectedRevision: number
  readonly sessionId: string
  readonly turnId: string
}
export type EvolutionMutationCommand =
  | { readonly kind: 'propose'; readonly request: EvolutionProposeRequest }
  | { readonly kind: 'transition'; readonly request: EvolutionTransitionRequest }
  | { readonly kind: 'snooze'; readonly request: EvolutionSnoozeRequest }
  | { readonly kind: 'reject'; readonly request: EvolutionRejectRequest }
  | { readonly kind: 'resume'; readonly request: EvolutionResumeRequest }
  | { readonly kind: 'reminder'; readonly request: EvolutionReminderRecordRequest }

export function operationId(command: EvolutionMutationCommand): string {
  return boundedId(command.request.operationId, 'operationId')
}

export interface EvolutionListRequest {
  readonly kind?: EvolutionProposalKind
  readonly scope?: EvolutionScope
  readonly status?: EvolutionProposalStatus
  readonly query?: string
  readonly dueOnly?: boolean
}

export interface EvolutionDiagnostic {
  readonly path: string
  readonly code: string
  readonly message: string
  readonly createdAt?: string
  readonly deliveryId?: string
  readonly patternKey?: string
  readonly proposalId?: string
}

export interface EvolutionListResult {
  readonly proposals: readonly EvolutionProposal[]
  readonly diagnostics: readonly EvolutionDiagnostic[]
}

export interface EvolutionMutationContext {
  readonly instanceId: string
  readonly actorId: string
  readonly projectId?: string
  readonly now: string
  id(): string
}

export class EvolutionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'EvolutionError'
  }
}

const MAX_ID = 200
const MAX_DEDUPE_KEY = 200
const MAX_TITLE = 200
const MAX_RATIONALE = 4_000
const MAX_TAGS = 20
const MAX_TAG = 80
const MAX_EVIDENCE = 20
const MAX_EVIDENCE_SUMMARY = 1_000
const MAX_SOURCE_ID = 300
const MAX_DETAIL = 4_000
const DEDUPE_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const TAG_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
function strictObject(value: unknown, field: string, allowed: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvolutionError('INVALID_INPUT', `${field} must be an object`)
  }
  const extra = Object.keys(value).find(key => !allowed.includes(key))
  if (extra !== undefined) throw new EvolutionError('INVALID_INPUT', `${field}.${extra} is not supported`)
}

function timestamp(value: string, field: string): string {
  const normalized = boundedText(value, field, 100)
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw new EvolutionError('INVALID_INPUT', `${field} must be an ISO 8601 UTC timestamp`)
  }
  return normalized
}


function boundedText(value: string, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new EvolutionError('INVALID_INPUT', `${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new EvolutionError('INVALID_INPUT', `${field} must contain 1-${maximum} characters`)
  }
  if (containsCredentialMaterial(normalized)) {
    throw new EvolutionError('CREDENTIAL_REJECTED', `${field} appears to contain credential material`)
  }
  return normalized
}

export function boundedId(value: string, field = 'id'): string {
  return boundedText(value, field, MAX_ID)
}

export function normalizeDedupeKey(value: string): string {
  const normalized = boundedText(value, 'dedupeKey', MAX_DEDUPE_KEY).toLocaleLowerCase('en-US')
  if (!DEDUPE_PATTERN.test(normalized)) {
    throw new EvolutionError('INVALID_INPUT', 'dedupeKey must be a lowercase semantic key')
  }
  return normalized
}

export function normalizeTags(input: readonly string[] | undefined): readonly string[] {
  if (input === undefined) return Object.freeze([])
  if (!Array.isArray(input) || input.length > MAX_TAGS) {
    throw new EvolutionError('INVALID_INPUT', `tags must contain at most ${MAX_TAGS} entries`)
  }
  const tags = [...new Set(input.map(value => boundedText(value, 'tag', MAX_TAG).toLocaleLowerCase('en-US')))]
  if (tags.some(tag => !TAG_PATTERN.test(tag))) {
    throw new EvolutionError('INVALID_INPUT', 'tags must contain lowercase semantic tokens')
  }
  return Object.freeze(tags.sort())
}

export function normalizeEvidence(
  input: readonly EvolutionEvidenceInput[] | undefined,
  context: EvolutionMutationContext,
  existing: readonly EvolutionEvidenceSummary[] = [],
): readonly EvolutionEvidenceSummary[] {
  if (input === undefined) return existing
  if (!Array.isArray(input) || input.length > MAX_EVIDENCE) {
    throw new EvolutionError('INVALID_INPUT', `evidence must contain at most ${MAX_EVIDENCE} entries`)
  }
  const keys = new Set(existing.map(item => `${item.sourceId}\u0000${item.summary}`))
  const output = [...existing]
  for (const item of input) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new EvolutionError('INVALID_INPUT', 'evidence entries must be objects')
    }
    strictObject(item, 'evidence', ['summary', 'sourceId'])
    const summary = boundedText(item.summary, 'evidence.summary', MAX_EVIDENCE_SUMMARY)
    const sourceId = boundedText(item.sourceId, 'evidence.sourceId', MAX_SOURCE_ID)
    const key = `${sourceId}\u0000${summary}`
    if (keys.has(key)) continue
    keys.add(key)
    output.push(deepFreeze({ id: context.id(), summary, sourceId, createdAt: context.now }))
  }
  return Object.freeze(output)
}

function proposalText(request: Pick<EvolutionProposeRequest, 'title' | 'rationale'>): { title: string; rationale: string } {
  return {
    title: boundedText(request.title, 'title', MAX_TITLE),
    rationale: boundedText(request.rationale, 'rationale', MAX_RATIONALE),
  }
}
export function validateStoredProposal(proposal: EvolutionProposal): EvolutionProposal {
  boundedId(proposal.id, 'proposal.id')
  boundedId(proposal.instanceId, 'proposal.instanceId')
  boundedId(proposal.actorId, 'proposal.actorId')
  if (proposal.scope === 'project') boundedId(proposal.projectId, 'proposal.projectId')
  if (normalizeDedupeKey(proposal.dedupeKey) !== proposal.dedupeKey) {
    throw new EvolutionError('INVALID_INPUT', 'proposal.dedupeKey is not canonical')
  }
  boundedText(proposal.title, 'proposal.title', MAX_TITLE)
  boundedText(proposal.rationale, 'proposal.rationale', MAX_RATIONALE)
  const tags = normalizeTags(proposal.tags)
  if (JSON.stringify(tags) !== JSON.stringify(proposal.tags)) {
    throw new EvolutionError('INVALID_INPUT', 'proposal.tags are not canonical')
  }
  if (!Number.isSafeInteger(proposal.revision) || proposal.revision < 1) {
    throw new EvolutionError('INVALID_INPUT', 'proposal.revision must be a positive safe integer')
  }
  timestamp(proposal.createdAt, 'proposal.createdAt')
  timestamp(proposal.updatedAt, 'proposal.updatedAt')
  if (proposal.snoozedUntil !== undefined) timestamp(proposal.snoozedUntil, 'proposal.snoozedUntil')
  for (const item of proposal.evidence) {
    boundedId(item.id, 'evidence.id')
    boundedText(item.summary, 'evidence.summary', MAX_EVIDENCE_SUMMARY)
    boundedText(item.sourceId, 'evidence.sourceId', MAX_SOURCE_ID)
    timestamp(item.createdAt, 'evidence.createdAt')
  }
  for (const item of proposal.history) {
    boundedId(item.id, 'history.id')
    boundedText(item.detail, 'history.detail', MAX_DETAIL)
    if (item.sourceIds.length > MAX_EVIDENCE) throw new EvolutionError('INVALID_INPUT', 'history.sourceIds is too large')
    for (const sourceId of item.sourceIds) boundedText(sourceId, 'history.sourceId', MAX_SOURCE_ID)
    timestamp(item.createdAt, 'history.createdAt')
  }
  for (const item of proposal.reminders) {
    boundedId(item.id, 'reminder.id')
    boundedId(item.sessionId, 'reminder.sessionId')
    boundedId(item.turnId, 'reminder.turnId')
    timestamp(item.createdAt, 'reminder.createdAt')
  }
  return proposal
}


export function commandDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function createProposal(
  request: EvolutionProposeRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  strictObject(request, 'proposal', ['operationId', 'kind', 'scope', 'dedupeKey', 'title', 'rationale', 'tags', 'evidence'])
  boundedId(request.operationId, 'operationId')
  const now = timestamp(context.now, 'now')
  const id = boundedId(context.id(), 'proposal.id')
  const historyId = boundedId(context.id(), 'history.id')
  if (request.kind !== 'persona' && request.kind !== 'capability') {
    throw new EvolutionError('INVALID_KIND', `unsupported proposal kind "${String(request.kind)}"`)
  }
  if (request.scope !== 'global' && request.scope !== 'project') {
    throw new EvolutionError('INVALID_SCOPE', `unsupported proposal scope "${String(request.scope)}"`)
  }
  if (request.kind === 'persona' && request.scope === 'project') {
    throw new EvolutionError('INVALID_SCOPE', 'persona proposals must use global scope')
  }
  if (request.scope === 'project' && context.projectId === undefined) {
    throw new EvolutionError('PROJECT_UNAVAILABLE', 'project scope requires Runtime Session workspace metadata')
  }
  const text = proposalText(request)
  const common: EvolutionProposalBase = {
    id,
    instanceId: boundedId(context.instanceId, 'instanceId'),
    actorId: boundedId(context.actorId, 'actorId'),
    dedupeKey: normalizeDedupeKey(request.dedupeKey),
    title: text.title,
    rationale: text.rationale,
    tags: normalizeTags(request.tags),
    status: 'proposed',
    revision: 1,
    evidence: normalizeEvidence(request.evidence, context),
    history: Object.freeze([deepFreeze({
      id: historyId,
      toStatus: 'proposed' as const,
      detail: 'Proposal recorded for user-directed review.',
      sourceIds: Object.freeze([]),
      createdAt: now,
    })]),
    reminders: Object.freeze([]),
    createdAt: now,
    updatedAt: now,
  }
  if (request.kind === 'persona') return deepFreeze({ ...common, kind: 'persona', scope: 'global' })
  if (request.scope === 'project') {
    return deepFreeze({ ...common, kind: 'capability', scope: 'project', projectId: boundedId(context.projectId!, 'projectId') })
  }
  return deepFreeze({ ...common, kind: 'capability', scope: 'global' })
}

function active(status: EvolutionProposalStatus): boolean {
  return status !== 'done' && status !== 'rejected'
}

function revised(proposal: EvolutionProposal, patch: Partial<EvolutionProposalBase>, now: string): EvolutionProposal {
  return deepFreeze({ ...proposal, ...patch, revision: proposal.revision + 1, updatedAt: now } as EvolutionProposal)
}

export function assertRevision(proposal: EvolutionProposal, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new EvolutionError('INVALID_INPUT', 'expectedRevision must be a positive safe integer')
  }
  if (proposal.revision !== expectedRevision) {
    throw new EvolutionError('REVISION_CONFLICT', `proposal revision is ${proposal.revision}, not ${expectedRevision}`)
  }
}
function validateMutationBase(
  proposal: EvolutionProposal,
  request: { readonly operationId: string; readonly id: string; readonly expectedRevision: number },
  context: EvolutionMutationContext,
  allowed: readonly string[],
): string {
  strictObject(request, 'mutation', allowed)
  boundedId(request.operationId, 'operationId')
  const id = boundedId(request.id, 'id')
  if (id !== proposal.id) throw new EvolutionError('NOT_FOUND', `proposal "${id}" was not found`)
  assertRevision(proposal, request.expectedRevision)
  return timestamp(context.now, 'now')
}


export function reviseProposal(
  proposal: EvolutionProposal,
  request: EvolutionReviseRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  const now = validateMutationBase(proposal, request, context, ['operationId', 'id', 'expectedRevision', 'title', 'rationale', 'tags', 'evidence'])
  if (!active(proposal.status)) throw new EvolutionError('TERMINAL_PROPOSAL', 'terminal proposals cannot be revised')
  const title = request.title === undefined ? proposal.title : boundedText(request.title, 'title', MAX_TITLE)
  const rationale = request.rationale === undefined ? proposal.rationale : boundedText(request.rationale, 'rationale', MAX_RATIONALE)
  const tags = request.tags === undefined ? proposal.tags : normalizeTags(request.tags)
  const evidence = normalizeEvidence(request.evidence, context, proposal.evidence)
  return revised(proposal, { title, rationale, tags, evidence }, now)
}

const PERSONA_NEXT: Readonly<Record<string, EvolutionProposalStatus>> = Object.freeze({
  proposed: 'reviewing',
  reviewing: 'done',
})
const CAPABILITY_NEXT: Readonly<Record<string, EvolutionProposalStatus>> = Object.freeze({
  proposed: 'researching',
  researching: 'options-ready',
  'options-ready': 'selected',
  selected: 'planned',
  planned: 'implementing',
  implementing: 'done',
})

function revisedWithoutSnooze(
  proposal: EvolutionProposal,
  patch: Partial<EvolutionProposalBase>,
  now: string,
): EvolutionProposal {
  const { snoozedUntil: _snoozedUntil, resumeStatus: _resumeStatus, ...rest } = proposal
  return deepFreeze({ ...rest, ...patch, revision: proposal.revision + 1, updatedAt: now } as EvolutionProposal)
}

function transitionDetail(request: EvolutionTransitionRequest): { detail: string; sourceIds: readonly string[] } {
  const common = ['operationId', 'id', 'expectedRevision', 'target']
  switch (request.target) {
    case 'reviewing': strictObject(request, 'transition', [...common, 'reviewSummary']); break
    case 'researching': strictObject(request, 'transition', [...common, 'researchQuestion']); break
    case 'options-ready': strictObject(request, 'transition', [...common, 'optionsSummary', 'sourceIds']); break
    case 'selected': strictObject(request, 'transition', [...common, 'selectedOption']); break
    case 'planned': strictObject(request, 'transition', [...common, 'planReference']); break
    case 'implementing': strictObject(request, 'transition', [...common, 'implementationReference']); break
    case 'done': strictObject(request, 'transition', [...common, 'outcome']); break
    case 'proposed': strictObject(request, 'transition', [...common, 'detail']); break
    default: throw new EvolutionError('INVALID_TRANSITION', 'unsupported transition target')
  }
  switch (request.target) {
    case 'reviewing': return { detail: boundedText(request.reviewSummary, 'reviewSummary', MAX_DETAIL), sourceIds: Object.freeze([]) }
    case 'researching': return { detail: boundedText(request.researchQuestion, 'researchQuestion', MAX_DETAIL), sourceIds: Object.freeze([]) }
    case 'options-ready': {
      if (!Array.isArray(request.sourceIds) || request.sourceIds.length === 0 || request.sourceIds.length > MAX_EVIDENCE) {
        throw new EvolutionError('INVALID_INPUT', 'sourceIds must contain 1-20 provenance identifiers')
      }
      return {
        detail: boundedText(request.optionsSummary, 'optionsSummary', MAX_DETAIL),
        sourceIds: Object.freeze(request.sourceIds.map(source => boundedText(source, 'sourceId', MAX_SOURCE_ID))),
      }
    }
    case 'selected': return { detail: boundedText(request.selectedOption, 'selectedOption', MAX_DETAIL), sourceIds: Object.freeze([]) }
    case 'planned': return { detail: boundedText(request.planReference, 'planReference', MAX_DETAIL), sourceIds: Object.freeze([]) }
    case 'implementing': return { detail: boundedText(request.implementationReference, 'implementationReference', MAX_DETAIL), sourceIds: Object.freeze([]) }
    case 'done': return { detail: boundedText(request.outcome, 'outcome', MAX_DETAIL), sourceIds: Object.freeze([]) }
    case 'proposed': return { detail: boundedText(request.detail, 'detail', MAX_DETAIL), sourceIds: Object.freeze([]) }
    default: throw new EvolutionError('INVALID_TRANSITION', 'unsupported transition target')
  }
}

export function transitionProposal(
  proposal: EvolutionProposal,
  request: EvolutionTransitionRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  const now = validateMutationBase(proposal, request, context, Object.keys(request))
  if (!active(proposal.status)) throw new EvolutionError('TERMINAL_PROPOSAL', 'terminal proposals cannot transition')
  let expected: EvolutionProposalStatus | undefined
  if (proposal.status === 'snoozed') expected = proposal.resumeStatus
  else expected = (proposal.kind === 'persona' ? PERSONA_NEXT : CAPABILITY_NEXT)[proposal.status]
  if (request.target !== expected) {
    throw new EvolutionError('INVALID_TRANSITION', `proposal cannot transition from ${proposal.status} to ${request.target}`)
  }
  const detail = transitionDetail(request)
  const entry = deepFreeze({
    id: boundedId(context.id(), 'history.id'),
    fromStatus: proposal.status,
    toStatus: request.target,
    detail: detail.detail,
    sourceIds: detail.sourceIds,
    createdAt: now,
  })
  const patch = {
    status: request.target,
    history: Object.freeze([...proposal.history, entry]),
  }
  return proposal.status === 'snoozed'
    ? revisedWithoutSnooze(proposal, patch, now)
    : revised(proposal, patch, now)
}

export function snoozeProposal(
  proposal: EvolutionProposal,
  request: EvolutionSnoozeRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  const now = validateMutationBase(proposal, request, context, ['operationId', 'id', 'expectedRevision', 'until', 'reason'])
  if (!active(proposal.status) || proposal.status === 'snoozed') {
    throw new EvolutionError('INVALID_TRANSITION', `proposal cannot be snoozed from ${proposal.status}`)
  }
  const until = new Date(request.until)
  if (!Number.isFinite(until.getTime()) || until.toISOString() !== request.until || until.getTime() <= Date.parse(now)) {
    throw new EvolutionError('INVALID_INPUT', 'until must be a future ISO 8601 UTC timestamp')
  }
  const reason = boundedText(request.reason, 'reason', MAX_DETAIL)
  const entry = deepFreeze({
    id: boundedId(context.id(), 'history.id'),
    fromStatus: proposal.status,
    toStatus: 'snoozed' as const,
    detail: reason,
    sourceIds: Object.freeze([]),
    createdAt: now,
  })
  return revised(proposal, {
    status: 'snoozed',
    snoozedUntil: until.toISOString(),
    resumeStatus: proposal.status as EvolutionForwardStatus,
    history: Object.freeze([...proposal.history, entry]),
  }, now)
}

export function rejectProposal(
  proposal: EvolutionProposal,
  request: EvolutionRejectRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  const now = validateMutationBase(proposal, request, context, ['operationId', 'id', 'expectedRevision', 'reason'])
  if (!active(proposal.status)) throw new EvolutionError('TERMINAL_PROPOSAL', 'terminal proposals cannot be rejected')
  const reason = boundedText(request.reason, 'reason', MAX_DETAIL)
  const entry = deepFreeze({
    id: boundedId(context.id(), 'history.id'),
    fromStatus: proposal.status,
    toStatus: 'rejected' as const,
    detail: reason,
    sourceIds: Object.freeze([]),
    createdAt: now,
  })
  return revisedWithoutSnooze(proposal, {
    status: 'rejected',
    history: Object.freeze([...proposal.history, entry]),
  }, now)
}

export function recordReminder(
  proposal: EvolutionProposal,
  request: EvolutionReminderRecordRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  const now = validateMutationBase(proposal, request, context, ['operationId', 'id', 'expectedRevision', 'sessionId', 'turnId'])
  if (!active(proposal.status) || proposal.status === 'snoozed') {
    throw new EvolutionError('REMINDER_INELIGIBLE', `proposal in ${proposal.status} cannot record a reminder`)
  }
  const sessionId = boundedId(request.sessionId, 'sessionId')
  const turnId = boundedId(request.turnId, 'turnId')
  if (proposal.reminders.some(item => item.sessionId === sessionId && item.turnId === turnId)) return proposal
  const delivery = deepFreeze({ id: boundedId(context.id(), 'reminder.id'), sessionId, turnId, createdAt: now })
  return revised(proposal, { reminders: Object.freeze([...proposal.reminders, delivery]) }, now)
}

export function resumeProposal(
  proposal: EvolutionProposal,
  request: EvolutionResumeRequest,
  context: EvolutionMutationContext,
): EvolutionProposal {
  const now = validateMutationBase(proposal, request, context, ['operationId', 'id', 'expectedRevision'])
  if (proposal.status !== 'snoozed' || proposal.resumeStatus === undefined || proposal.snoozedUntil === undefined) {
    throw new EvolutionError('INVALID_TRANSITION', 'only a snoozed proposal can resume')
  }
  if (Date.parse(proposal.snoozedUntil) > Date.parse(now)) {
    throw new EvolutionError('SNOOZE_ACTIVE', 'proposal snooze deadline has not elapsed')
  }
  const entry = deepFreeze({
    id: boundedId(context.id(), 'history.id'),
    fromStatus: 'snoozed' as const,
    toStatus: proposal.resumeStatus,
    detail: 'Snooze deadline elapsed.',
    sourceIds: Object.freeze([]),
    createdAt: now,
  })
  return revisedWithoutSnooze(proposal, {
    status: proposal.resumeStatus,
    history: Object.freeze([...proposal.history, entry]),
  }, now)
}

export function applyMutation(
  proposals: readonly EvolutionProposal[],
  command: EvolutionMutationCommand,
  context: EvolutionMutationContext,
): EvolutionProposal {
  if (command.kind === 'propose') {
    const candidate = createProposal(command.request, context)
    const existing = proposals.find(proposal => (
      proposal.kind === candidate.kind
      && proposal.scope === candidate.scope
      && proposal.dedupeKey === candidate.dedupeKey
    ))
    if (existing === undefined) return candidate
    if (!active(existing.status)) {
      throw new EvolutionError('DEDUPE_TERMINAL', 'a terminal proposal already uses this dedupeKey')
    }
    const evidence = normalizeEvidence(command.request.evidence, context, existing.evidence)
    if (evidence.length === existing.evidence.length) return existing
    return revised(existing, { evidence }, context.now)
  }
  const proposal = proposals.find(item => item.id === command.request.id)
  if (proposal === undefined) throw new EvolutionError('NOT_FOUND', `proposal "${command.request.id}" was not found`)
  switch (command.kind) {
    case 'transition': return transitionProposal(proposal, command.request, context)
    case 'snooze': return snoozeProposal(proposal, command.request, context)
    case 'reject': return rejectProposal(proposal, command.request, context)
    case 'resume': return resumeProposal(proposal, command.request, context)
    case 'reminder': return recordReminder(proposal, command.request, context)
  }
}
export function proposalIsReminderEligible(
  proposal: EvolutionProposal,
  now: Date,
  cooldownMs: number,
): boolean {
  if (!active(proposal.status)) return false
  if (proposal.status === 'snoozed') {
    if (proposal.snoozedUntil === undefined || Date.parse(proposal.snoozedUntil) > now.getTime()) return false
  }
  const latest = proposal.reminders.at(-1)
  return latest === undefined || Date.parse(latest.createdAt) + cooldownMs <= now.getTime()
}

const STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'and', 'are', 'but', 'can', 'for', 'from', 'have', 'into', 'not', 'our', 'that', 'the', 'this', 'with', 'you', 'your'])

export function lexicalTokens(value: string): ReadonlySet<string> {
  const tokens = value.toLocaleLowerCase('en-US').normalize('NFKC').match(/[a-z0-9]{3,}/gu) ?? []
  return new Set(tokens.filter(token => !STOP_WORDS.has(token)))
}

export function relevanceScore(proposal: EvolutionProposal, query: string): number {
  const queryTokens = lexicalTokens(query)
  if (queryTokens.size === 0) return 0
  const proposalTokens = lexicalTokens(`${proposal.title} ${proposal.rationale} ${proposal.tags.join(' ')}`)
  let overlap = 0
  for (const token of queryTokens) if (proposalTokens.has(token)) overlap += 1
  return overlap
}
