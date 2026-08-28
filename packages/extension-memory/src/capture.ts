import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { TurnCommittedEvent } from '@doppelganger/extension-protocols'
import { containsMemorySecret, stripRecursiveMemoryContent } from './content-policy.ts'
import type { MemoryKind, MemoryRole, RememberMemoryRequest } from './service.ts'
import type {} from './service.ts'

export interface MemoryCaptureMaterial {
  readonly deliveryId: string
  readonly sessionId: string
  readonly turnId: string
  readonly principalInput: string
  readonly assistantOutput: string
}

export interface ExtractedMemoryCandidate {
  readonly subjectKey: string
  readonly kind: MemoryKind
  readonly content: string
  readonly scope?: 'relationship' | 'project'
  readonly confidence?: number
  readonly salience?: number
  readonly evidenceRole?: MemoryRole
}

export interface MemoryCandidateExtractor {
  extract(material: MemoryCaptureMaterial): readonly ExtractedMemoryCandidate[] | Promise<readonly ExtractedMemoryCandidate[]>
}

export interface MemoryCapturePolicy {
  readonly enabled?: boolean
  readonly maxInputLength?: number
  readonly maxOutputLength?: number
  readonly maxCandidatesPerTurn?: number
}

export interface MemoryCapturePluginConfig extends MemoryCapturePolicy {
  readonly extractor?: MemoryCandidateExtractor
}

const TRIVIAL = /^(?:ok(?:ay)?|thanks?|thank you|got it|sure|yes|no|continue|sounds good)[.!\s]*$/iu
const GENERATED = /^(?:<tool|tool (?:call|result)|function (?:call|result)|system prompt|generated instructions?|instructions?:)/iu
const DURABLE = /^\s*(?:remember\s+)?\[(fact|preference|decision|procedure):([a-z0-9]+(?:[._-][a-z0-9]+)*)\]\s+(.+?)\s*$/gimu

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function filteredText(value: unknown, maximum: number): string | undefined {
  const content = text(value)
  if (content === undefined || content.length === 0 || content.length > maximum) return
  const stripped = stripRecursiveMemoryContent(content)
  if (stripped.length === 0 || TRIVIAL.test(stripped) || GENERATED.test(stripped)) return
  return stripped
}

function candidateOperationId(deliveryId: string, ordinal: number): string {
  return `capture:${deliveryId}:${ordinal}`
}

export const DeterministicMemoryCandidateExtractor: MemoryCandidateExtractor = Object.freeze({
  extract(material: MemoryCaptureMaterial) {
    const candidates: ExtractedMemoryCandidate[] = []
    for (const match of material.principalInput.matchAll(DURABLE)) {
      const kind = match[1] as MemoryKind
      const key = match[2]!
      const content = match[3]!.trim()
      if (key.startsWith('persona.identity') || key.startsWith('persona.trait') || /^you are\b/iu.test(content)) continue
      candidates.push(Object.freeze({
        subjectKey: key,
        kind,
        content,
        confidence: 0.75,
        salience: 0.5,
        evidenceRole: 'principal',
      }))
    }
    return Object.freeze(candidates)
  },
})

export function createMemoryCapturePlugin(config: MemoryCapturePluginConfig = {}): Plugin {
  const enabled = config.enabled ?? false
  const maxInputLength = config.maxInputLength ?? 8_000
  const maxOutputLength = config.maxOutputLength ?? 8_000
  const maxCandidatesPerTurn = config.maxCandidatesPerTurn ?? 8
  if (!Number.isSafeInteger(maxInputLength) || maxInputLength <= 0) throw new TypeError('capture maxInputLength must be positive')
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength <= 0) throw new TypeError('capture maxOutputLength must be positive')
  if (!Number.isSafeInteger(maxCandidatesPerTurn) || maxCandidatesPerTurn <= 0) {
    throw new TypeError('capture maxCandidatesPerTurn must be positive')
  }
  const extractor = config.extractor ?? DeterministicMemoryCandidateExtractor
  return {
    name: 'doppelganger-memory-capture',
    inject: ['doppelgangerMemory'],
    apply(ctx: Context) {
      ctx.on('doppelganger/turn-committed', async (event: TurnCommittedEvent) => {
        if (!enabled || event.outcome !== 'completed') return
        const principalInput = filteredText(event.principalInput.value, maxInputLength)
        const assistantOutput = filteredText(event.assistantOutput.value, maxOutputLength)
        if (principalInput === undefined || assistantOutput === undefined) return
        if (containsMemorySecret(principalInput) || containsMemorySecret(assistantOutput)) return
        const material: MemoryCaptureMaterial = Object.freeze({
          deliveryId: event.deliveryId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          principalInput,
          assistantOutput,
        })
        const candidates = await extractor.extract(material)
        for (const [index, candidate] of candidates.slice(0, maxCandidatesPerTurn).entries()) {
          if (containsMemorySecret(candidate.content)) continue
          const request: RememberMemoryRequest = {
            operationId: candidateOperationId(event.deliveryId, index),
            subjectKey: candidate.subjectKey,
            kind: candidate.kind,
            content: candidate.content,
            ...(candidate.scope === undefined ? {} : { scope: candidate.scope }),
            ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
            ...(candidate.salience === undefined ? {} : { salience: candidate.salience }),
            evidence: {
              turnId: event.turnId,
              role: candidate.evidenceRole ?? 'principal',
              relation: 'support',
              excerpt: candidate.content,
            },
          }
          ctx.doppelgangerMemory.propose(request)
        }
      })
    },
  }
}

export const MemoryCapturePlugin = createMemoryCapturePlugin()
