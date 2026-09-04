import { createHash } from 'node:crypto'
import type { EvolutionProposeRequest } from './model.ts'
import {
  signalFactorValue,
  type EvolutionSignalAggregate,
  type EvolutionSignalOccurrence,
  type EvolutionSignalPolicy,
} from './signal-model.ts'

export const EVOLUTION_SIGNAL_POLICY_VERSION = 1 as const

export interface EvolutionSignalPromotionEvaluation {
  readonly eligible: boolean
  readonly score: number
  readonly evidenceFloorMet: boolean
  readonly reuseFloorMet: boolean
  readonly deterministicEvidenceMet: boolean
}

export function evaluateSignalPromotion(
  aggregate: Pick<EvolutionSignalAggregate, 'kind' | 'distinctTurns' | 'distinctSessions' | 'deterministicOccurrenceCount' | 'severity' | 'reuseValue' | 'proposalId'>,
  policy: EvolutionSignalPolicy,
): EvolutionSignalPromotionEvaluation {
  const evidenceFloorMet = aggregate.kind === 'persona'
    ? aggregate.distinctSessions >= Math.max(3, policy.personaPromotionMinSessions)
    : aggregate.distinctTurns >= Math.max(3, policy.capabilityPromotionMinTurns)
  const reuseFloorMet = signalFactorValue(aggregate.reuseValue) >= signalFactorValue('medium')
  const deterministicEvidenceMet = aggregate.deterministicOccurrenceCount > 0
  const recurrence = aggregate.kind === 'persona'
    ? Math.min(3, aggregate.distinctSessions)
    : Math.min(3, aggregate.distinctTurns)
  const novelty = aggregate.proposalId === undefined ? 1 : 0
  const score = recurrence + signalFactorValue(aggregate.severity) + signalFactorValue(aggregate.reuseValue) + novelty
  return Object.freeze({
    eligible: evidenceFloorMet
      && deterministicEvidenceMet
      && reuseFloorMet
      && score >= policy.promotionScore
      && aggregate.proposalId === undefined,
    score,
    evidenceFloorMet,
    deterministicEvidenceMet,
    reuseFloorMet,
  })
}

function promotionDigest(aggregate: Pick<EvolutionSignalAggregate, 'kind' | 'scope' | 'projectId' | 'patternKey'>): string {
  return createHash('sha256')
    .update(JSON.stringify([
      EVOLUTION_SIGNAL_POLICY_VERSION,
      aggregate.kind,
      aggregate.scope,
      aggregate.projectId ?? '',
      aggregate.patternKey,
    ]))
    .digest('hex')
}

export function signalPromotionOperationId(
  aggregate: Pick<EvolutionSignalAggregate, 'kind' | 'scope' | 'projectId' | 'patternKey'>,
): string {
  return `signal:v${EVOLUTION_SIGNAL_POLICY_VERSION}:${promotionDigest(aggregate).slice(0, 48)}`
}

export function signalProposalDedupeKey(
  aggregate: Pick<EvolutionSignalAggregate, 'kind' | 'scope' | 'projectId' | 'patternKey'>,
): string {
  return `signal.v${EVOLUTION_SIGNAL_POLICY_VERSION}.${aggregate.kind}.${aggregate.scope}.${promotionDigest(aggregate).slice(0, 48)}`
}

export function signalPromotionRequest(
  aggregate: EvolutionSignalAggregate,
  occurrences: readonly EvolutionSignalOccurrence[],
): EvolutionProposeRequest {
  const evidence = occurrences
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 20)
    .map(occurrence => Object.freeze({
      summary: occurrence.summary,
      sourceId: `lifecycle:${occurrence.deliveryId}`,
    }))
  return Object.freeze({
    operationId: signalPromotionOperationId(aggregate),
    kind: aggregate.kind,
    scope: aggregate.kind === 'persona' ? 'global' : aggregate.scope,
    dedupeKey: signalProposalDedupeKey(aggregate),
    title: aggregate.title,
    rationale: aggregate.rationale,
    tags: aggregate.tags,
    evidence: Object.freeze(evidence),
  })
}
