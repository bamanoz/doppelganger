import { randomUUID } from 'node:crypto'
import {
  StructuredInferenceError,
  type BoundedLifecycleValue,
  type JsonValue,
  type LifecycleEvent,
  type StructuredInference,
  type ToolCompletedEvent,
  type TurnCommittedEvent,
} from '@doppelganger/doppelganger-protocols'
import { EvolutionError } from './model.ts'
import type { EvolutionService } from './service.ts'
import {
  extractDeterministicSignals,
  extractInferredSignals,
  mergeSignalHypotheses,
} from './signal-extractor.ts'
import {
  createSignalOccurrence,
  normalizeSignalMaterial,
  normalizeToolOutcomeMaterial,
  type EvolutionSignalHypothesis,
  type EvolutionSignalMaterial,
  type EvolutionSignalMaterialLimits,
  type EvolutionSignalPolicy,
  type EvolutionToolOutcomeMaterial,
} from './signal-model.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_CORRELATION_RETENTION_MS = 30 * 60 * 1_000
const DISPOSAL_WAIT_MS = 100

export interface EvolutionSignalWorkerConfig {
  readonly inferenceEnabled: boolean
  readonly inferenceTimeoutMs: number
  readonly queueCapacity: number
  readonly materialLimits: EvolutionSignalMaterialLimits
  readonly policy: EvolutionSignalPolicy
}

interface EvolutionSignalWorkerIdentity {
  readonly instanceId: string
  readonly actorId: string
  readonly projectId?: string
}

interface EvolutionSignalWorkerRuntime {
  readonly now?: () => Date
  readonly id?: () => string
}

interface EvolutionSignalWorkSink {
  enqueue(material: EvolutionSignalMaterial): void
  reportDiagnostic(request: {
    readonly code: string
    readonly message: string
    readonly deliveryId?: string
    readonly patternKey?: string
  }): void
}
export interface EvolutionSignalCorrelationConfig {
  readonly materialLimits: EvolutionSignalMaterialLimits
  readonly maximumCorrelatedTurns: number
  readonly retentionMs?: number
}

interface CorrelatedTurn {
  readonly sessionId: string
  readonly turnId: string
  readonly outcomes: Map<string, EvolutionToolOutcomeMaterial>
  updatedAt: number
}

function hypothesisKey(hypothesis: EvolutionSignalHypothesis): string {
  return JSON.stringify([hypothesis.kind, hypothesis.scope, hypothesis.patternKey])
}

function inferenceDiagnosticCode(cause: unknown, timedOut: boolean): string {
  if (timedOut) return 'INFERENCE_TIMEOUT'
  if (cause instanceof StructuredInferenceError) return `INFERENCE_${cause.code}`
  return 'INFERENCE_FAILED'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref()
  })
}

export class EvolutionSignalWorker {
  readonly #evolution: EvolutionService
  readonly #inference: StructuredInference | undefined
  readonly #config: EvolutionSignalWorkerConfig
  readonly #identity: EvolutionSignalWorkerIdentity
  readonly #now: () => Date
  readonly #id: () => string
  readonly #queue: EvolutionSignalMaterial[] = []
  readonly #controllers = new Set<AbortController>()
  #running: Promise<void> | undefined
  #disposed = false
  #dropped = 0

  constructor(
    evolution: EvolutionService,
    inference: StructuredInference | undefined,
    config: EvolutionSignalWorkerConfig,
    identity: EvolutionSignalWorkerIdentity,
    runtime: EvolutionSignalWorkerRuntime = {},
  ) {
    this.#evolution = evolution
    this.#inference = inference
    this.#config = config
    this.#identity = identity
    this.#now = runtime.now ?? (() => new Date())
    this.#id = runtime.id ?? randomUUID
  }

  enqueue(material: EvolutionSignalMaterial): void {
    if (this.#disposed) return
    if (this.#queue.length >= this.#config.queueCapacity) {
      this.#queue.shift()
      this.#dropped += 1
    }
    this.#queue.push(material)
    this.#schedule()
  }

  reportDiagnostic(request: {
    readonly code: string
    readonly message: string
    readonly deliveryId?: string
    readonly patternKey?: string
  }): void {
    this.#safeDiagnostic(request)
  }

  async flush(): Promise<void> {
    while (this.#running !== undefined) await this.#running
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#queue.splice(0)
    for (const controller of this.#controllers) controller.abort()
    const running = this.#running
    if (running !== undefined) {
      void running.catch(() => {})
      await Promise.race([running, delay(DISPOSAL_WAIT_MS)])
    }
  }

  #schedule(): void {
    if (this.#running !== undefined || this.#disposed) return
    this.#running = Promise.resolve()
      .then(() => this.#drain())
      .catch(() => {
        this.#safeDiagnostic({
          code: 'SIGNAL_WORKER_FAILED',
          message: 'Evolution signal processing failed; later committed work remains eligible for processing.',
        })
      })
      .finally(() => {
        this.#running = undefined
        if (this.#queue.length > 0 && !this.#disposed) this.#schedule()
      })
  }

  async #drain(): Promise<void> {
    while (!this.#disposed) {
      const material = this.#queue.shift()
      if (material === undefined) return
      if (this.#dropped > 0) {
        this.#safeDiagnostic({
          code: 'SIGNAL_QUEUE_OVERFLOW',
          message: 'Committed Evolution signal work exceeded the bounded queue; oldest pending items were dropped.',
        })
        this.#dropped = 0
      }
      await this.#process(material)
    }
  }

  async #process(material: EvolutionSignalMaterial): Promise<void> {
    const deterministic = extractDeterministicSignals(material)
    let inferred: readonly EvolutionSignalHypothesis[] = Object.freeze([])
    if (this.#config.inferenceEnabled && this.#inference !== undefined) {
      const controller = new AbortController()
      this.#controllers.add(controller)
      let timedOut = false
      let timer: NodeJS.Timeout | undefined
      const inference = extractInferredSignals(this.#inference, material, controller.signal)
      void inference.catch(() => {})
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            controller.abort()
            reject(new StructuredInferenceError('TIMEOUT', 'Evolution signal inference timed out'))
          }, this.#config.inferenceTimeoutMs)
          timer.unref()
        })
        const result = await Promise.race([inference, timeout])
        if (this.#disposed) return
        inferred = result.hypotheses
        for (const diagnostic of result.diagnostics) {
          this.#safeDiagnostic({
            code: diagnostic.code,
            message: diagnostic.message,
            deliveryId: material.deliveryId,
            ...(diagnostic.patternKey === undefined ? {} : { patternKey: diagnostic.patternKey }),
          })
        }
      } catch (cause) {
        if (this.#disposed) return
        this.#safeDiagnostic({
          code: inferenceDiagnosticCode(cause, timedOut),
          message: 'Inference-assisted Evolution extraction failed; deterministic extraction continued.',
          deliveryId: material.deliveryId,
        })
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        this.#controllers.delete(controller)
      }
    } else if (this.#config.inferenceEnabled) {
      this.#safeDiagnostic({
        code: 'INFERENCE_UNAVAILABLE',
        message: 'Inference-assisted Evolution extraction is enabled but no structured inference service is active.',
        deliveryId: material.deliveryId,
      })
    }

    if (this.#disposed) return
    const hypotheses = mergeSignalHypotheses(deterministic, inferred)
    const deterministicKeys = new Set(deterministic.map(hypothesisKey))
    const callIds = Object.freeze([...new Set(material.toolOutcomes.map(outcome => outcome.callId))].sort())
    const occurrences = hypotheses.map(hypothesis => createSignalOccurrence({
      id: this.#id(),
      instanceId: this.#identity.instanceId,
      actorId: this.#identity.actorId,
      ...(this.#identity.projectId === undefined ? {} : { projectId: this.#identity.projectId }),
      deliveryId: material.deliveryId,
      sessionId: material.sessionId,
      turnId: material.turnId,
      callIds,
      source: deterministicKeys.has(hypothesisKey(hypothesis)) ? 'deterministic' : 'inference',
      createdAt: material.committedAt,
      hypothesis,
    }))

    try {
      this.#evolution.recordSignals({
        deliveryId: material.deliveryId,
        sessionId: material.sessionId,
        turnId: material.turnId,
        createdAt: material.committedAt,
        expiresAt: new Date(Date.parse(material.committedAt) + this.#config.policy.retentionDays * DAY_MS).toISOString(),
        occurrences,
        policy: this.#config.policy,
      })
    } catch {
      this.#safeDiagnostic({
        code: 'SIGNAL_STORAGE_FAILED',
        message: 'Committed Evolution signal persistence failed without affecting the host turn.',
        deliveryId: material.deliveryId,
      })
      return
    }

    if (this.#disposed) return
    await this.#evolution.promoteEligibleSignals()
    if (this.#disposed) return
    const lastPrunedAt = this.#evolution.signalLastPrunedAt()
    if (lastPrunedAt === undefined || this.#now().getTime() - Date.parse(lastPrunedAt) >= DAY_MS) {
      try {
        this.#evolution.pruneSignalState(this.#config.policy)
      } catch {
        this.#safeDiagnostic({
          code: 'SIGNAL_RETENTION_FAILED',
          message: 'Evolution signal retention maintenance failed and will be retried later.',
        })
      }
    }
  }

  #safeDiagnostic(request: {
    readonly code: string
    readonly message: string
    readonly deliveryId?: string
    readonly patternKey?: string
  }): void {
    if (this.#disposed) return
    try {
      this.#evolution.recordSignalDiagnostic(request)
    } catch {
      // Operational diagnostics are best-effort and never destabilize host lifecycle delivery.
    }
  }
}

function turnKey(sessionId: string, turnId: string): string {
  return `${sessionId}\u0000${turnId}`
}

function boundedValueText(material: BoundedLifecycleValue, maximumCharacters: number): string {
  const encoded = typeof material.value === 'string' ? material.value : JSON.stringify(material.value)
  return encoded.slice(0, maximumCharacters)
}

function resultSummary(value: JsonValue): string {
  if (value === null) return 'null result'
  if (Array.isArray(value)) return `array result with ${value.length} entries`
  if (typeof value === 'object') return `object result with ${Object.keys(value).length} fields`
  return `${typeof value} result`
}

function toolOutcome(event: ToolCompletedEvent): EvolutionToolOutcomeMaterial {
  const input = {
    deliveryId: event.deliveryId,
    callId: event.callId,
    name: event.name,
    outcome: event.outcome,
    ...(event.error?.code === undefined ? {} : { errorCode: event.error.code }),
    ...(event.error?.message === undefined ? {} : { errorMessage: event.error.message }),
    ...(event.result === undefined ? {} : { resultSummary: resultSummary(event.result.value) }),
    timestamp: event.timestamp,
  }
  try {
    return normalizeToolOutcomeMaterial(input)
  } catch (cause) {
    if (!(cause instanceof EvolutionError) || cause.code !== 'CREDENTIAL_REJECTED' || event.error?.message === undefined) throw cause
    const { errorMessage: _errorMessage, ...screened } = input
    return normalizeToolOutcomeMaterial(screened)
  }
}

export class EvolutionLifecycleSignalCorrelation {
  readonly #worker: EvolutionSignalWorkSink
  readonly #config: EvolutionSignalCorrelationConfig
  readonly #turns = new Map<string, CorrelatedTurn>()

  constructor(worker: EvolutionSignalWorkSink, config: EvolutionSignalCorrelationConfig) {
    this.#worker = worker
    this.#config = config
  }

  observe(event: LifecycleEvent): void {
    this.#prune(event.timestamp)
    if (event.type === 'tool-completed') {
      this.#observeTool(event)
      return
    }
    if (event.type === 'turn-committed') {
      this.#observeTurn(event)
      return
    }
    if (event.type === 'session-disposed') this.#discardSession(event.sessionId)
  }

  clear(): void {
    this.#turns.clear()
  }

  #observeTool(event: ToolCompletedEvent): void {
    const key = turnKey(event.sessionId, event.turnId)
    let turn = this.#turns.get(key)
    if (turn === undefined) {
      turn = {
        sessionId: event.sessionId,
        turnId: event.turnId,
        outcomes: new Map(),
        updatedAt: event.timestamp,
      }
      this.#turns.set(key, turn)
    }
    try {
      turn.outcomes.set(event.deliveryId, toolOutcome(event))
    } catch {
      this.#worker.reportDiagnostic({
        code: 'INVALID_SIGNAL_MATERIAL',
        message: 'One completed tool outcome was rejected by the Evolution material boundary.',
        deliveryId: event.deliveryId,
      })
      return
    }
    turn.updatedAt = Math.max(turn.updatedAt, event.timestamp)
    this.#boundTurn(turn)
    this.#boundTurns()
  }

  #observeTurn(event: TurnCommittedEvent): void {
    const key = turnKey(event.sessionId, event.turnId)
    const turn = this.#turns.get(key)
    this.#turns.delete(key)
    if (event.outcome !== 'completed') return
    const outcomes = turn === undefined
      ? []
      : [...turn.outcomes.values()]
          .sort((left, right) => left.timestamp - right.timestamp || left.deliveryId.localeCompare(right.deliveryId))
          .slice(-this.#config.materialLimits.maximumToolOutcomes)
    try {
      const material = normalizeSignalMaterial({
        deliveryId: event.deliveryId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        committedAt: new Date(event.timestamp).toISOString(),
        principalInput: boundedValueText(event.principalInput, this.#config.materialLimits.maximumInputCharacters),
        assistantOutput: boundedValueText(event.assistantOutput, this.#config.materialLimits.maximumOutputCharacters),
        toolOutcomes: outcomes,
      }, this.#config.materialLimits)
      this.#worker.enqueue(material)
    } catch (cause) {
      this.#worker.reportDiagnostic({
        code: cause instanceof EvolutionError && cause.code === 'CREDENTIAL_REJECTED'
          ? 'SIGNAL_MATERIAL_CREDENTIAL_REJECTED'
          : 'INVALID_SIGNAL_MATERIAL',
        message: 'Committed lifecycle material was rejected before Evolution extraction.',
        deliveryId: event.deliveryId,
      })
    }
  }

  #discardSession(sessionId: string): void {
    for (const [key, turn] of this.#turns) {
      if (turn.sessionId === sessionId) this.#turns.delete(key)
    }
  }

  #prune(now: number): void {
    const cutoff = now - (this.#config.retentionMs ?? DEFAULT_CORRELATION_RETENTION_MS)
    for (const [key, turn] of this.#turns) {
      if (turn.updatedAt < cutoff) this.#turns.delete(key)
    }
    this.#boundTurns()
  }

  #boundTurn(turn: CorrelatedTurn): void {
    const maximum = this.#config.materialLimits.maximumToolOutcomes
    if (turn.outcomes.size <= maximum) return
    const keep = new Set([...turn.outcomes.values()]
      .sort((left, right) => right.timestamp - left.timestamp || right.deliveryId.localeCompare(left.deliveryId))
      .slice(0, maximum)
      .map(outcome => outcome.deliveryId))
    for (const deliveryId of turn.outcomes.keys()) {
      if (!keep.has(deliveryId)) turn.outcomes.delete(deliveryId)
    }
  }

  #boundTurns(): void {
    while (this.#turns.size > this.#config.maximumCorrelatedTurns) {
      const oldest = [...this.#turns.entries()]
        .sort(([leftKey, left], [rightKey, right]) => left.updatedAt - right.updatedAt || leftKey.localeCompare(rightKey))[0]
      if (oldest === undefined) return
      this.#turns.delete(oldest[0])
    }
  }
}
