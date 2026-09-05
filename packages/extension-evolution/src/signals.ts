import type { Context, Plugin } from '@deepseek-ai/cordis'
import { STRUCTURED_INFERENCE_SERVICE, type StructuredInference } from '@doppelganger/doppelganger-protocols'
import { EVOLUTION_SIGNAL_POLICY_VERSION } from './signal-policy.ts'
import type { EvolutionSignalMaterialLimits, EvolutionSignalPolicy } from './signal-model.ts'
import {
  EvolutionLifecycleSignalCorrelation,
  EvolutionSignalWorker,
  type EvolutionSignalWorkerConfig,
} from './signal-worker.ts'

export interface EvolutionSignalConfigInput {
  readonly proactiveSignalsEnabled?: boolean
  readonly signalInferenceEnabled?: boolean
  readonly signalMaxInputCharacters?: number
  readonly signalMaxOutputCharacters?: number
  readonly signalMaxToolOutcomesPerTurn?: number
  readonly signalQueueCapacity?: number
  readonly signalInferenceTimeoutMs?: number
  readonly signalRetentionDays?: number
  readonly signalMaxStoredOccurrences?: number
  readonly capabilityPromotionMinTurns?: number
  readonly personaPromotionMinSessions?: number
  readonly signalPromotionScore?: number
}

export interface EvolutionSignalConfig {
  readonly proactiveSignalsEnabled: boolean
  readonly signalInferenceEnabled: boolean
  readonly signalQueueCapacity: number
  readonly materialLimits: EvolutionSignalMaterialLimits
  readonly policy: EvolutionSignalPolicy
  readonly signalInferenceTimeoutMs: number
}

const SIGNAL_CONFIG_KEYS = new Set([
  'proactiveSignalsEnabled',
  'signalInferenceEnabled',
  'signalMaxInputCharacters',
  'signalMaxOutputCharacters',
  'signalMaxToolOutcomesPerTurn',
  'signalQueueCapacity',
  'signalInferenceTimeoutMs',
  'signalRetentionDays',
  'signalMaxStoredOccurrences',
  'capabilityPromotionMinTurns',
  'personaPromotionMinSessions',
  'signalPromotionScore',
])

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  const normalized = value ?? fallback
  if (typeof normalized !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return normalized
}

function integerValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || (normalized as number) < minimum || (normalized as number) > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return normalized as number
}

export function isEvolutionSignalConfigKey(key: string): boolean {
  return SIGNAL_CONFIG_KEYS.has(key)
}

export function normalizeEvolutionSignalConfig(input: EvolutionSignalConfigInput): EvolutionSignalConfig {
  const proactiveSignalsEnabled = booleanValue(input.proactiveSignalsEnabled, true, 'proactiveSignalsEnabled')
  const signalInferenceEnabled = booleanValue(input.signalInferenceEnabled, false, 'signalInferenceEnabled')
  const materialLimits = Object.freeze({
    maximumInputCharacters: integerValue(input.signalMaxInputCharacters, 8_000, 1, 64_000, 'signalMaxInputCharacters'),
    maximumOutputCharacters: integerValue(input.signalMaxOutputCharacters, 8_000, 1, 64_000, 'signalMaxOutputCharacters'),
    maximumToolOutcomes: integerValue(input.signalMaxToolOutcomesPerTurn, 16, 0, 128, 'signalMaxToolOutcomesPerTurn'),
  })
  const policy = Object.freeze({
    version: EVOLUTION_SIGNAL_POLICY_VERSION,
    retentionDays: integerValue(input.signalRetentionDays, 90, 7, 3_650, 'signalRetentionDays'),
    maxStoredOccurrences: integerValue(input.signalMaxStoredOccurrences, 5_000, 1, 100_000, 'signalMaxStoredOccurrences'),
    capabilityPromotionMinTurns: integerValue(input.capabilityPromotionMinTurns, 3, 3, 100, 'capabilityPromotionMinTurns'),
    personaPromotionMinSessions: integerValue(input.personaPromotionMinSessions, 3, 3, 100, 'personaPromotionMinSessions'),
    promotionScore: integerValue(input.signalPromotionScore, 6, 4, 10, 'signalPromotionScore'),
  }) satisfies EvolutionSignalPolicy
  return Object.freeze({
    proactiveSignalsEnabled,
    signalInferenceEnabled,
    signalQueueCapacity: integerValue(input.signalQueueCapacity, 32, 1, 1_024, 'signalQueueCapacity'),
    materialLimits,
    policy,
    signalInferenceTimeoutMs: integerValue(input.signalInferenceTimeoutMs, 30_000, 100, 600_000, 'signalInferenceTimeoutMs'),
  })
}

export function createEvolutionSignalCapturePlugin(config: EvolutionSignalConfig): Plugin {
  const inject = [
    'doppelgangerEvolution',
    'doppelgangerPersona',
    'doppelgangerActor',
    ...(config.signalInferenceEnabled ? [STRUCTURED_INFERENCE_SERVICE] : []),
  ]
  return {
    name: 'doppelganger-evolution-signals',
    inject,
    apply(ctx: Context) {
      const logger = ctx.logger('doppelganger-evolution-signals')
      logger.info('component.activation.started inference=%s', config.signalInferenceEnabled)
      const persona = ctx.doppelgangerPersona
      const actor = ctx.doppelgangerActor
      if (actor.state !== 'bound') throw new Error('Evolution signal capture requires a bound host actor')
      const inference: StructuredInference | undefined = config.signalInferenceEnabled
        ? ctx.doppelgangerInference
        : undefined
      const workerConfig: EvolutionSignalWorkerConfig = {
        inferenceEnabled: config.signalInferenceEnabled,
        inferenceTimeoutMs: config.signalInferenceTimeoutMs,
        queueCapacity: config.signalQueueCapacity,
        materialLimits: config.materialLimits,
        policy: config.policy,
      }
      const worker = new EvolutionSignalWorker(ctx.doppelgangerEvolution, inference, workerConfig, {
        instanceId: persona.instanceId,
        actorId: actor.actorId,
        ...(persona.projectId === undefined ? {} : { projectId: persona.projectId }),
      })
      const correlation = new EvolutionLifecycleSignalCorrelation(worker, {
        materialLimits: config.materialLimits,
        maximumCorrelatedTurns: Math.max(16, config.signalQueueCapacity * 2),
      })
      ctx.on('doppelganger/tool-completed', event => { correlation.observe(event) })
      ctx.on('doppelganger/turn-committed', event => { correlation.observe(event) })
      ctx.on('doppelganger/session-disposed', event => { correlation.observe(event) })
      logger.info('component.active')
      ctx.effect(() => async () => {
        logger.info('component.disposal.started')
        correlation.clear()
        await worker.dispose()
        logger.info('component.disposal.completed')
      }, 'doppelgangerEvolutionSignals.dispose')
    },
  }
}
