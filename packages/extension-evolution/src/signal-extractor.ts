import { createHash } from 'node:crypto'
import type { StructuredInference } from '@doppelganger/doppelganger-protocols'
import {
  EVOLUTION_SIGNAL_INFERENCE_SCHEMA,
  EVOLUTION_SIGNAL_INFERENCE_SYSTEM,
  normalizeSignalHypothesis,
  normalizeSignalPatternKey,
  type EvolutionSignalHypothesis,
  type EvolutionSignalMaterial,
} from './signal-model.ts'
import { EvolutionError } from './model.ts'

export interface EvolutionSignalExtractionDiagnostic {
  readonly code: string
  readonly message: string
  readonly patternKey?: string
}

export interface EvolutionSignalExtractionResult {
  readonly hypotheses: readonly EvolutionSignalHypothesis[]
  readonly diagnostics: readonly EvolutionSignalExtractionDiagnostic[]
}

const PRINCIPAL_CORRECTION = /(?:\bno[,—:-]?\s+(?:i\s+meant|i\s+asked|that(?:'s| is)\s+not)|\bi\s+(?:meant|asked)\b|\bthat(?:'s| is)\s+not\s+what\b|нет[,—:-]?\s+(?:я\s+(?:имел|имела)\s+в\s+виду|я\s+просил(?:а)?|не\s+так)|я\s+(?:имел|имела)\s+в\s+виду|ты\s+(?:неправильно|неверно)\s+понял(?:а)?|не\s+это)/iu
const ASSISTANT_LIMITATION = /(?:\bi\s+(?:can(?:not|'t)|am\s+unable\s+to|do\s+not\s+have|don't\s+have)\b|\bnot\s+available\s+to\s+me\b|я\s+не\s+могу|мне\s+недоступн[а-я]*|у\s+меня\s+нет)/iu
const MAX_SNIPPET = 500

function snippet(value: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(value)
  if (match === null || match.index === undefined) return undefined
  const start = Math.max(0, match.index - 120)
  const end = Math.min(value.length, match.index + match[0].length + 300)
  return value.slice(start, end).replace(/\s+/gu, ' ').trim().slice(0, MAX_SNIPPET)
}

function hashedPattern(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value.toLocaleLowerCase('en-US')).digest('hex').slice(0, 32)
  return normalizeSignalPatternKey(`${prefix}.${digest}`)
}

function toolFailureHypothesis(tool: EvolutionSignalMaterial['toolOutcomes'][number]): EvolutionSignalHypothesis | undefined {
  if (tool.outcome !== 'failed') return undefined
  const toolName = normalizeSignalPatternKey(tool.name)
  const errorClass = normalizeSignalPatternKey(tool.errorCode ?? 'failure')
  const summary = tool.errorMessage === undefined
    ? `Tool ${tool.name} failed with ${tool.errorCode ?? 'an unclassified error'}.`
    : `Tool ${tool.name} failed with ${tool.errorCode ?? 'an unclassified error'}: ${tool.errorMessage}`
  return normalizeSignalHypothesis({
    kind: 'capability',
    scope: 'global',
    patternKey: `tool.${toolName}.failed.${errorClass}`,
    title: `Improve repeated ${tool.name} failure handling`,
    rationale: `Committed work repeatedly encounters the same structured ${tool.name} failure class. A reusable capability may remove or contain it.`,
    summary,
    tags: ['capability', 'tool-failure', toolName],
    severity: 'medium',
    reuseValue: 'medium',
    provenance: [tool.deliveryId, tool.callId],
  })
}

export function extractDeterministicSignals(material: EvolutionSignalMaterial): readonly EvolutionSignalHypothesis[] {
  const hypotheses: EvolutionSignalHypothesis[] = []
  for (const tool of material.toolOutcomes) {
    const hypothesis = toolFailureHypothesis(tool)
    if (hypothesis !== undefined) hypotheses.push(hypothesis)
  }
  const correction = snippet(material.principalInput, PRINCIPAL_CORRECTION)
  if (correction !== undefined) {
    hypotheses.push(normalizeSignalHypothesis({
      kind: 'persona',
      scope: 'global',
      patternKey: hashedPattern('persona.correction', correction),
      title: 'Preserve a repeatedly corrected collaboration preference',
      rationale: 'The principal explicitly corrected the assistant. Repetition across independent sessions may justify a minimal Persona-quality review.',
      summary: correction,
      tags: ['persona', 'correction'],
      severity: 'low',
      reuseValue: 'medium',
      provenance: [material.deliveryId, material.sessionId, material.turnId],
    }))
  }
  const limitation = snippet(material.assistantOutput, ASSISTANT_LIMITATION)
  if (limitation !== undefined) {
    hypotheses.push(normalizeSignalHypothesis({
      kind: 'capability',
      scope: 'global',
      patternKey: hashedPattern('capability.limitation', limitation),
      title: 'Address a recurring assistant capability limitation',
      rationale: 'The assistant explicitly reported a capability limitation during committed work. Repetition may justify a reusable implementation mechanism.',
      summary: limitation,
      tags: ['capability', 'limitation'],
      severity: 'low',
      reuseValue: 'medium',
      provenance: [material.deliveryId, material.sessionId, material.turnId],
    }))
  }
  return Object.freeze(hypotheses)
}

export function mergeSignalHypotheses(
  deterministic: readonly EvolutionSignalHypothesis[],
  inferred: readonly EvolutionSignalHypothesis[],
): readonly EvolutionSignalHypothesis[] {
  const output: EvolutionSignalHypothesis[] = []
  const keys = new Set<string>()
  for (const hypothesis of [...deterministic, ...inferred]) {
    const key = JSON.stringify([hypothesis.kind, hypothesis.scope, hypothesis.patternKey])
    if (keys.has(key)) continue
    keys.add(key)
    output.push(hypothesis)
  }
  return Object.freeze(output)
}

function inferenceInput(material: EvolutionSignalMaterial): string {
  return JSON.stringify({
    committedTurn: {
      deliveryId: material.deliveryId,
      sessionId: material.sessionId,
      turnId: material.turnId,
      committedAt: material.committedAt,
      principalInput: material.principalInput,
      assistantOutput: material.assistantOutput,
      toolOutcomes: material.toolOutcomes,
    },
  })
}

export async function extractInferredSignals(
  inference: StructuredInference,
  material: EvolutionSignalMaterial,
  signal: AbortSignal,
): Promise<EvolutionSignalExtractionResult> {
  const result = await inference.infer({
    purpose: 'evolution.signal-extraction',
    system: EVOLUTION_SIGNAL_INFERENCE_SYSTEM,
    input: inferenceInput(material),
    outputSchema: EVOLUTION_SIGNAL_INFERENCE_SCHEMA,
    maxOutputTokens: 2_048,
    signal,
  })
  const value = result.value
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new EvolutionError('INVALID_SIGNAL', 'inference result must contain a hypotheses array')
  }
  const rawHypotheses = (value as Readonly<Record<string, unknown>>).hypotheses
  if (!Array.isArray(rawHypotheses)) {
    throw new EvolutionError('INVALID_SIGNAL', 'inference result must contain a hypotheses array')
  }
  const hypotheses: EvolutionSignalHypothesis[] = []
  const diagnostics: EvolutionSignalExtractionDiagnostic[] = []
  for (const item of rawHypotheses) {
    try {
      hypotheses.push(normalizeSignalHypothesis(item))
    } catch (cause) {
      diagnostics.push(Object.freeze({
        code: cause instanceof EvolutionError && cause.code === 'CREDENTIAL_REJECTED'
          ? 'INFERENCE_CREDENTIAL_REJECTED'
          : cause instanceof EvolutionError && cause.code === 'AUTHORITY_REJECTED'
            ? 'INFERENCE_AUTHORITY_REJECTED'
            : 'INFERENCE_HYPOTHESIS_INVALID',
        message: 'One inferred Evolution hypothesis was rejected by the local policy boundary.',
      }))
    }
  }
  return Object.freeze({ hypotheses: Object.freeze(hypotheses), diagnostics: Object.freeze(diagnostics) })
}
