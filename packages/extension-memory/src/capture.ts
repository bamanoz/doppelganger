import type { Context, Logger, Plugin } from '@deepseek-ai/cordis'
import { containsCredentialMaterial, type TurnCommittedEvent } from '@doppelganger/doppelganger-protocols'
import { stripRecursiveMemoryContent } from './content-policy.ts'
import type { MemoryKind, MemoryRole, RememberMemoryRequest } from './service.ts'
import type { MemorySemanticNeighborRequest, MemorySemanticNeighborSuggestion, MemorySemanticNeighborRelation } from './semantic.ts'

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

export interface MemoryCaptureNeighborSuggestion extends MemorySemanticNeighborSuggestion {
  readonly candidateSubjectKey: string
  readonly candidateKind: MemoryKind
}

export interface MemoryCaptureDiagnostic {
  readonly code: 'extractor' | 'neighbor' | 'validation' | 'write'
}

export interface MemoryCandidateExtractor {
  extract(material: MemoryCaptureMaterial): readonly ExtractedMemoryCandidate[] | Promise<readonly ExtractedMemoryCandidate[]>
}

export interface MemoryCapturePolicy {
  readonly enabled?: boolean
  readonly maxInputLength?: number
  readonly maxOutputLength?: number
  readonly maxCandidatesPerTurn?: number
  readonly extractor?: MemoryCandidateExtractor
  readonly onSuggestion?: (suggestion: MemoryCaptureNeighborSuggestion) => void
  readonly onDiagnostic?: (diagnostic: MemoryCaptureDiagnostic) => void
}

export interface MemoryCapturePluginConfig extends MemoryCapturePolicy {}

const TRIVIAL = /^(?:ok(?:ay)?|thanks?|thank you|got it|sure|yes|no|continue|sounds good|понятно|спасибо|хорошо|да|нет)[.!\s]*$/iu
const GENERATED = /^(?:<tool|tool (?:call|result)|function (?:call|result)|system prompt|generated instructions?|instructions?:|<memory|\[doppelganger)/iu
const KEY = '[a-z0-9]+(?:[._-][a-z0-9]+)*'
const KIND = '(fact|preference|decision|procedure|факт|предпочтение|решение|процедура)'
const TAGGED = new RegExp(`^\\s*(?:remember\\s*[:,]?\\s*(?:that\\s+)?|please\\s+remember\\s*[:,]?\\s*|запомни\\s*[:,]?\\s*(?:что\\s+)?|пожалуйста,?\\s*запомни\\s*[:,]?\\s+)?\\[${KIND}:(${KEY})\\]\\s*(?:[:—-]\\s*)?(.+?)\\s*$`, 'imu')
const KEYED = new RegExp(`^\\s*(?:remember\\s*[:,]?\\s*(?:that\\s+)?|please\\s+remember\\s*[:,]?\\s*|запомни\\s*[:,]?\\s*(?:что\\s+)?|пожалуйста,?\\s*запомни\\s*[:,]?\\s+)?${KIND}\\s*[:/]\\s*(${KEY})\\s*(?:=|:|—|-)\\s*(.+?)\\s*$`, 'imu')
const SUBJECT_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u
const AMBIGUOUS = /(?:\?\s*$|\b(?:maybe|perhaps|possibly|might|i think|not sure|может быть|возможно|кажется|наверное)\b)/iu
const PERSONA = /^(?:you are\b|you['’]re\b|ты\s+(?:можешь|должен|—|это)|persona[._-]|identity[._-]|trait[._-]|profile[._-])/iu
const PROMISE = /^(?:i['’]ll\b|i will\b|i promise\b|я\s+(?:буду|обещаю|могу)\b|обещаю\b)/iu
const TASK_CHATTER = /^(?:todo\b|task\b|задач[аи]\b|сделай\b|please\s+(?:do|fix|implement)\b|can you\b|could you\b|what is\b|how do i\b|исправь\b|реализуй\b)/iu
const SECRET_KEY = /(?:secret|token|password|credential|api[._-]?key|парол|токен|секрет)/iu
const KIND_ALIASES: Readonly<Record<string, MemoryKind>> = Object.freeze({ fact: 'fact', preference: 'preference', decision: 'decision', procedure: 'procedure', факт: 'fact', предпочтение: 'preference', решение: 'decision', процедура: 'procedure' })

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

function stableCandidate(kindText: string, keyText: string, contentText: string): ExtractedMemoryCandidate | undefined {
  const kind = KIND_ALIASES[kindText.toLocaleLowerCase('en-US')]
  const key = keyText.trim().toLocaleLowerCase('en-US')
  const content = contentText.trim()
  if (kind === undefined || content.length === 0 || content.length > 2_000) return
  if (!SUBJECT_KEY.test(key) || key.length > 200 || key.split(/[._-]/u).length < 2) return
  if (SECRET_KEY.test(key) || key.startsWith('persona.') || key.startsWith('identity.') || key.startsWith('trait.') || key.startsWith('profile.')) return
  if (containsCredentialMaterial(content) || AMBIGUOUS.test(content) || PERSONA.test(content) || PROMISE.test(content) || TASK_CHATTER.test(content)) return
  const scope = key.startsWith('project.') ? 'project' : 'relationship'
  return Object.freeze({ subjectKey: key, kind, content, scope, confidence: 0.75, salience: 0.5, evidenceRole: 'principal' })
}

export const DeterministicMemoryCandidateExtractor: MemoryCandidateExtractor = Object.freeze({
  extract(material: MemoryCaptureMaterial) {
    const candidates: ExtractedMemoryCandidate[] = []
    for (const line of material.principalInput.split(/\r?\n/u)) {
      const match = TAGGED.exec(line) ?? KEYED.exec(line)
      TAGGED.lastIndex = 0
      KEYED.lastIndex = 0
      if (match === null) continue
      const candidate = stableCandidate(match[1]!, match[2]!, match[3]!)
      if (candidate !== undefined) candidates.push(candidate)
    }
    return Object.freeze(candidates)
  },
})

function capturePolicy(config: MemoryCapturePluginConfig) {
  const enabled = config.enabled ?? false
  const maxInputLength = config.maxInputLength ?? 8_000
  const maxOutputLength = config.maxOutputLength ?? 8_000
  const maxCandidatesPerTurn = config.maxCandidatesPerTurn ?? 8
  if (!Number.isSafeInteger(maxInputLength) || maxInputLength <= 0) throw new TypeError('capture maxInputLength must be positive')
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength <= 0) throw new TypeError('capture maxOutputLength must be positive')
  if (!Number.isSafeInteger(maxCandidatesPerTurn) || maxCandidatesPerTurn <= 0) {
    throw new TypeError('capture maxCandidatesPerTurn must be positive')
  }
  return {
    enabled,
    maxInputLength,
    maxOutputLength,
    maxCandidatesPerTurn,
    extractor: config.extractor ?? DeterministicMemoryCandidateExtractor,
    onSuggestion: config.onSuggestion,
    onDiagnostic: config.onDiagnostic,
  }
}

function diagnostic(policy: ReturnType<typeof capturePolicy>, logger: Logger, code: MemoryCaptureDiagnostic['code']): void {
  logger.warn('memory.capture.degraded code=%s', code)
  try { policy.onDiagnostic?.(Object.freeze({ code })) } catch { /* diagnostics are best effort */ }
}

function validatedCandidate(candidate: unknown): ExtractedMemoryCandidate | undefined {
  if (candidate === null || typeof candidate !== 'object') return
  const value = candidate as Record<string, unknown>
  const subjectKey = text(value.subjectKey)
  const kind = text(value.kind)
  const content = text(value.content)
  if (subjectKey === undefined || kind === undefined || content === undefined) return
  if (!['decision', 'fact', 'preference', 'procedure'].includes(kind)) return
  const stable = stableCandidate(kind, subjectKey, content)
  if (stable === undefined) return
  const scope = value.scope
  if (scope !== undefined && scope !== stable.scope) return
  const confidence = value.confidence
  const salience = value.salience
  if (confidence !== undefined && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return
  if (salience !== undefined && (typeof salience !== 'number' || !Number.isFinite(salience) || salience < 0 || salience > 1)) return
  return Object.freeze({
    ...stable,
    ...(confidence === undefined ? {} : { confidence }),
    ...(salience === undefined ? {} : { salience }),
  })
}

function canonicalNeighbor(
  ctx: Context,
  candidate: ExtractedMemoryCandidate,
  suggestion: unknown,
): MemoryCaptureNeighborSuggestion | undefined {
  if (suggestion === null || typeof suggestion !== 'object') return
  const value = suggestion as Record<string, unknown>
  const recordId = text(value.recordId)
  const revisionId = text(value.revisionId)
  const subjectKey = text(value.subjectKey)
  const relation = text(value.relation) as MemorySemanticNeighborRelation | undefined
  const score = value.score
  if (recordId === undefined || revisionId === undefined || subjectKey === undefined
    || !['equivalent', 'paraphrase', 'possible-contradiction'].includes(relation ?? '')
    || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return
  try {
    const record = ctx.doppelgangerMemory.inspect(recordId)
    const expectedScope = candidate.scope ?? 'relationship'
    if (record.revision.id !== revisionId || record.kind !== candidate.kind || record.subjectKey !== subjectKey
      || record.status === 'rejected' || record.temporalState !== 'eligible'
      || record.instanceId !== ctx.doppelgangerPersona.instanceId || record.actorId !== (ctx.doppelgangerActor.state === 'bound' ? ctx.doppelgangerActor.actorId : undefined)
      || record.scope.kind !== expectedScope
      || (expectedScope === 'project' && record.scope.projectId !== ctx.doppelgangerPersona.projectId)) return
    return Object.freeze({ recordId, revisionId, subjectKey, score, relation: relation! as MemorySemanticNeighborRelation, candidateSubjectKey: candidate.subjectKey, candidateKind: candidate.kind })
  } catch {
    return
  }
}

async function applyNeighbors(
  ctx: Context,
  policy: ReturnType<typeof capturePolicy>,
  candidate: ExtractedMemoryCandidate,
): Promise<void> {
  const semantic = ctx.get('doppelgangerMemorySemantic') as { neighbors?: (request: MemorySemanticNeighborRequest) => Promise<readonly MemorySemanticNeighborSuggestion[]> } | undefined
  if (semantic?.neighbors === undefined) return
  const persona = ctx.doppelgangerPersona
  const actor = ctx.doppelgangerActor
  if (actor.state !== 'bound') return
  try {
    const request: MemorySemanticNeighborRequest = Object.freeze({
      content: candidate.content,
      instanceId: persona.instanceId,
      actorId: actor.actorId,
      scopeKind: candidate.scope ?? 'relationship',
      ...(candidate.scope === 'project' && persona.projectId === undefined ? {} : candidate.scope === 'project' ? { projectId: persona.projectId } : {}),
      kind: candidate.kind,
      limit: 4,
    })
    const suggestions = await semantic.neighbors(request)
    for (const suggestion of suggestions.slice(0, 4)) {
      const validated = canonicalNeighbor(ctx, candidate, suggestion)
      if (validated === undefined) continue
      try { policy.onSuggestion?.(validated) } catch { /* observer failures are contained */ }
    }
  } catch {
    diagnostic(policy, ctx.logger('doppelganger-memory-capture'), 'neighbor')
  }
}

function applyMemoryCapture(ctx: Context, config: MemoryCapturePluginConfig): void {
  const logger = ctx.logger('doppelganger-memory-capture')
  const policy = capturePolicy(config)
  logger.info('component.active enabled=%s', policy.enabled)
  ctx.effect(() => () => { logger.info('component.disposal.started') }, 'doppelgangerMemoryCapture.logDisposal')
  ctx.on('doppelganger/turn-committed', async (event: TurnCommittedEvent) => {
    if (!policy.enabled || event.outcome !== 'completed') return
    logger.debug('memory.capture.started')
    try {
      const principalInput = filteredText(event.principalInput.value, policy.maxInputLength)
      const assistantOutput = filteredText(event.assistantOutput.value, policy.maxOutputLength)
      if (principalInput === undefined || assistantOutput === undefined) return
      if (containsCredentialMaterial(principalInput) || containsCredentialMaterial(assistantOutput)) return
      const material: MemoryCaptureMaterial = Object.freeze({ deliveryId: event.deliveryId, sessionId: event.sessionId, turnId: event.turnId, principalInput, assistantOutput })
      let extracted: readonly ExtractedMemoryCandidate[]
      try {
        extracted = await policy.extractor.extract(material)
      } catch {
        diagnostic(policy, logger, 'extractor')
        return
      }
      if (!Array.isArray(extracted)) { diagnostic(policy, logger, 'extractor'); return }
      let ordinal = 0
      let proposed = 0
      for (const rawCandidate of extracted.slice(0, policy.maxCandidatesPerTurn)) {
        const candidate = validatedCandidate(rawCandidate)
        if (candidate === undefined) { diagnostic(policy, logger, 'validation'); continue }
        await applyNeighbors(ctx, policy, candidate)
        try {
          const request: RememberMemoryRequest = {
            operationId: candidateOperationId(event.deliveryId, ordinal++),
            subjectKey: candidate.subjectKey,
            kind: candidate.kind,
            content: candidate.content,
            ...(candidate.scope === undefined ? {} : { scope: candidate.scope }),
            ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
            ...(candidate.salience === undefined ? {} : { salience: candidate.salience }),
            evidence: { turnId: event.turnId, role: candidate.evidenceRole ?? 'principal', relation: 'support', excerpt: candidate.content },
          }
          ctx.doppelgangerMemory.propose(request)
          proposed += 1
        } catch {
          diagnostic(policy, logger, 'write')
        }
      }
      logger.debug('memory.capture.completed extracted=%d proposed=%d', extracted.length, proposed)
    } catch {
      diagnostic(policy, logger, 'validation')
    }
  })
}


export function createMemoryCapturePlugin(config: MemoryCapturePluginConfig = {}): Plugin {
  return {
    name: 'doppelganger-memory-capture',
    inject: ['doppelgangerMemory', 'doppelgangerPersona', 'doppelgangerActor'],
    apply(ctx: Context) {
      applyMemoryCapture(ctx, config)
    },
  }
}

export const MemoryCapturePlugin: Plugin<MemoryCapturePluginConfig> = {
  name: 'doppelganger-memory-capture',
  inject: ['doppelgangerMemory', 'doppelgangerPersona', 'doppelgangerActor'],
  apply(ctx: Context, config: MemoryCapturePluginConfig = {}) {
    applyMemoryCapture(ctx, config)
  },
}

export default MemoryCapturePlugin
