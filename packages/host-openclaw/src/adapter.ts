import { randomUUID } from 'node:crypto'
import { normalize, resolve } from 'node:path'
import type {
  AnyAgentTool,
  OpenClawPluginToolContext,
} from 'openclaw/plugin-sdk/core'
import {
  cloneJsonValue,
  digestToolInput,
  type AssembledContext,
  type JsonValue,
  type RuntimeHostBridge,
  type ToolDescriptor,
  type ToolCatalogSnapshot,
  type ToolInvocationResult,
} from '@doppelganger/doppelganger-protocols'
import { projectCatalog, type PreparedCatalog } from './catalog.ts'
import { beginDirectActivation, type DirectActivation, type PendingDirectActivation } from './direct.ts'
import {
  createOpenClawActorResolver,
  createStandardOpenClawHostExtensionRuntime,
  type OpenClawHostExtensionRuntime,
  type OpenClawHostSessionFacts,
} from './host-extensions.ts'
import type { OpenClawOptions } from './options.ts'

const MAX_DIAGNOSTICS = 200
const MAX_DIAGNOSTIC_LENGTH = 2_048
const MAX_RESULT_TEXT_LENGTH = 32_000

export interface OpenClawAdapterLogger {
  debug?(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface OpenClawAdapterDiagnostic {
  readonly code: string
  readonly message: string
  readonly binding?: string
}

export interface OpenClawPromptProjection {
  readonly appendSystemContext?: string
  readonly appendContext?: string
}
export interface OpenClawAgentContext {
  readonly runId?: string
  readonly agentId?: string
  readonly sessionKey?: string
  readonly sessionId?: string
  readonly workspaceDir?: string
  readonly contextTokenBudget?: number
}
export interface OpenClawBeforeToolCallEvent {
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly runId?: string
  readonly toolCallId?: string
}

export interface OpenClawToolHookContext {
  readonly agentId?: string
  readonly sessionKey?: string
  readonly sessionId?: string
  readonly runId?: string
  readonly workspaceDir?: string
  readonly toolName: string
  readonly toolCallId?: string
  readonly abortSignal?: AbortSignal
}

export interface OpenClawBeforeToolCallResult {
  readonly block?: boolean
  readonly blockReason?: string
  readonly requireApproval?: {
    readonly title: string
    readonly description: string
    readonly allowedDecisions: ['allow-once', 'deny']
    readonly onResolution: (decision: 'allow-once' | 'allow-always' | 'deny' | 'timeout' | 'cancelled') => void
  }
}

export interface OpenClawAdapterSnapshot {
  readonly bindings: readonly {
    readonly key: string
    readonly state: NativeBindingState
    readonly epoch: number
    readonly runtimePresetId?: string
    readonly catalogRevision?: string
  }[]
  readonly diagnostics: readonly OpenClawAdapterDiagnostic[]
}

type NativeBindingState = 'activating' | 'inactive' | 'ready' | 'failed' | 'disposing' | 'disposed'

interface BindingIdentity {
  readonly agentId: string
  readonly sessionKey: string
  readonly sessionId: string
  readonly workspaceRoot: string
}

interface ProjectedDescriptor {
  readonly nativeName: string
  readonly descriptor: ToolDescriptor
}

interface NativeBinding {
  readonly routeKey: string
  readonly key: string
  readonly identity: BindingIdentity
  readonly epoch: number
  readonly direct: PendingDirectActivation
  ready: Promise<NativeBinding>
  state: NativeBindingState
  activation?: DirectActivation
  projected: ReadonlyMap<string, ProjectedDescriptor>
  catalogRevision?: string
  catalogGeneration: number
  catalogQueue: Promise<void>
  disposePromise?: Promise<void>
}

interface ApprovalRecord {
  readonly binding: NativeBinding
  readonly epoch: number
  readonly catalogGeneration: number
  readonly runId?: string
  readonly callId: string
  readonly nativeName: string
  readonly canonicalName: string
  readonly toolRevision: string
  readonly inputDigest: string
  readonly requiresApproval: boolean
  resolution?: 'allow-once' | 'deny' | 'timeout' | 'cancelled'
  consumed: boolean
  cancelled: boolean
  removeAbort?: () => void
}

interface ActiveCall {
  readonly binding: NativeBinding
  readonly bridge: RuntimeHostBridge
  readonly callId: string
  removeAbort?: () => void
}
function boundCallKey(binding: NativeBinding, callId: string): string {
  return `${binding.key}\u0000${callId}`
}
function boundRunKey(binding: NativeBinding, runId: string): string {
  return `${binding.key}\u0000${runId}`
}

function boundedMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message.length <= MAX_DIAGNOSTIC_LENGTH
    ? message
    : `${message.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`
}

function routeKey(agentId: string, sessionKey: string): string {
  return `${agentId}\u0000${sessionKey}`
}

function bindingKey(identity: BindingIdentity): string {
  return `${identity.agentId}\u0000${identity.sessionKey}\u0000${identity.sessionId}\u0000${identity.workspaceRoot}`
}

function sameIdentity(left: BindingIdentity, right: BindingIdentity): boolean {
  return left.agentId === right.agentId
    && left.sessionKey === right.sessionKey
    && left.sessionId === right.sessionId
    && left.workspaceRoot === right.workspaceRoot
}

function renderResult(result: ToolInvocationResult): { content: { type: 'text'; text: string }[]; details: ToolInvocationResult } {
  const payload = result.ok ? result.value : result.error
  const serialized = JSON.stringify(payload, null, 2) ?? 'null'
  const text = serialized.length <= MAX_RESULT_TEXT_LENGTH
    ? serialized
    : `${serialized.slice(0, MAX_RESULT_TEXT_LENGTH - 1)}…`
  return { content: [{ type: 'text', text }], details: result }
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

export class OpenClawAdapter {
  readonly #prepared: PreparedCatalog
  readonly #options: OpenClawOptions
  readonly #logger: OpenClawAdapterLogger
  readonly #hostExtensions: OpenClawHostExtensionRuntime
  readonly #resolveActor: (facts: OpenClawHostSessionFacts) => string | undefined
  readonly #bindings = new Map<string, NativeBinding>()
  readonly #approvalRecords = new Map<string, ApprovalRecord>()
  readonly #activeCalls = new Map<string, ActiveCall>()
  readonly #contextByRun = new Map<string, { binding: NativeBinding; context: Promise<AssembledContext> }>()
  readonly #diagnostics: OpenClawAdapterDiagnostic[] = []
  #nextEpoch = 0
  #disposed = false
  #disposePromise: Promise<void> | undefined

  constructor(
    prepared: PreparedCatalog,
    options: OpenClawOptions,
    logger: OpenClawAdapterLogger,
    hostExtensions: OpenClawHostExtensionRuntime = createStandardOpenClawHostExtensionRuntime(),
  ) {
    this.#prepared = prepared
    this.#options = options
    this.#logger = logger
    this.#hostExtensions = hostExtensions
    this.#resolveActor = createOpenClawActorResolver(options.actors)
  }

  #diagnose(code: string, message: unknown, binding?: NativeBinding): void {
    const diagnostic = Object.freeze({
      code,
      message: boundedMessage(message),
      ...(binding === undefined ? {} : { binding: binding.key }),
    })
    this.#diagnostics.push(diagnostic)
    if (this.#diagnostics.length > MAX_DIAGNOSTICS) this.#diagnostics.shift()
    this.#logger.warn(`[${code}] ${diagnostic.message}`)
  }

  #identity(context: Pick<OpenClawPluginToolContext, 'agentId' | 'sessionKey' | 'sessionId' | 'workspaceDir'>): BindingIdentity | undefined {
    if (!context.agentId || !context.sessionKey || !context.sessionId || !context.workspaceDir) {
      this.#diagnose(
        'OPENCLAW_BINDING_INCOMPLETE',
        'Doppelganger requires agentId, sessionKey, sessionId and workspaceDir for the supported embedded route',
      )
      return
    }
    const workspaceRoot = normalize(resolve(context.workspaceDir))
    return Object.freeze({
      agentId: context.agentId,
      sessionKey: context.sessionKey,
      sessionId: context.sessionId,
      workspaceRoot,
    })
  }

  #bindingForContext(context: Pick<OpenClawPluginToolContext, 'agentId' | 'sessionKey' | 'sessionId' | 'workspaceDir'>): NativeBinding | undefined {
    const identity = this.#identity(context)
    if (identity === undefined) return
    const binding = this.#bindings.get(routeKey(identity.agentId, identity.sessionKey))
    return binding !== undefined && sameIdentity(binding.identity, identity) ? binding : undefined
  }

  #disposeBinding(binding: NativeBinding): Promise<void> {
    if (binding.disposePromise !== undefined) return binding.disposePromise
    binding.state = 'disposing'
    binding.disposePromise = (async () => {
      const failures: unknown[] = []
      for (const [activeKey, active] of this.#activeCalls) {
        if (active.binding !== binding) continue
        active.removeAbort?.()
        this.#activeCalls.delete(activeKey)
        try {
          await active.bridge.cancelTool({ callId: active.callId, reason: 'OpenClaw binding disposed' })
        } catch (error) {
          this.#diagnose('OPENCLAW_TOOL_CANCEL_FAILED', error, binding)
          failures.push(error)
        }
      }
      for (const [approvalKey, approval] of this.#approvalRecords) {
        if (approval.binding !== binding) continue
        approval.cancelled = true
        approval.removeAbort?.()
        this.#approvalRecords.delete(approvalKey)
      }
      for (const [runId, cached] of this.#contextByRun) {
        if (cached.binding === binding) this.#contextByRun.delete(runId)
      }
      try {
        await binding.direct.dispose()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length > 0) throw new AggregateError(failures, 'OpenClaw binding cleanup failed')
    })().finally(() => {
      binding.state = 'disposed'
      if (this.#bindings.get(binding.routeKey) === binding) this.#bindings.delete(binding.routeKey)
    })
    return binding.disposePromise
  }

  #startBinding(identity: BindingIdentity): NativeBinding {
    const epoch = this.#nextEpoch += 1
    let binding: NativeBinding
    const hostFacts: OpenClawHostSessionFacts = Object.freeze({
      hostKind: 'openclaw',
      agentId: identity.agentId,
      sessionKey: identity.sessionKey,
      sessionId: identity.sessionId,
      workspaceRoot: identity.workspaceRoot,
    })
    const direct = beginDirectActivation({
      roster: this.#options.roster,
      ...(this.#options.runtimePreset === undefined ? {} : { explicitRuntimePreset: this.#options.runtimePreset }),
      workspaceRoot: identity.workspaceRoot,
      hostExtensions: this.#hostExtensions,
      ...(this.#options.hostExtensions === undefined ? {} : { hostExtensionSelections: this.#options.hostExtensions }),
      hostFacts,
      resolveActor: this.#resolveActor,
      watch: true,
      onCatalogChanged: revision => {
        if (binding.state !== 'ready') return
        binding.projected = new Map()
        binding.catalogQueue = binding.catalogQueue
          .then(() => this.#refreshCatalog(binding, revision))
          .catch(error => this.#diagnose('OPENCLAW_CATALOG_REFRESH_FAILED', error, binding))
      },
      onReload: event => {
        this.#diagnose('OPENCLAW_RELOAD_COMPLETED', `composition reload completed at ${event.compositionRevision}`, binding)
        if (binding.state !== 'ready' || binding.activation === undefined) return
        binding.projected = new Map()
        const revision = binding.activation.bridge.snapshotTools().revision
        binding.catalogQueue = binding.catalogQueue
          .then(() => this.#refreshCatalog(binding, revision))
          .catch(error => this.#diagnose('OPENCLAW_CATALOG_REFRESH_FAILED', error, binding))
      },
      onReloadFailure: event => {
        const restorationFailed = event.diagnostics.entries.some(entry => entry.state !== 'active' && entry.state !== 'disabled')
        this.#diagnose(
          restorationFailed ? 'OPENCLAW_RELOAD_RESTORATION_FAILED' : 'OPENCLAW_RELOAD_REJECTED',
          event.diagnostics.reload?.error ?? `composition reload failed at ${event.compositionRevision}`,
          binding,
        )
        if (!restorationFailed || binding.state === 'disposed' || binding.state === 'disposing') return
        binding.state = 'failed'
        binding.projected = new Map()
        void this.#disposeBinding(binding).catch(error => this.#diagnose('OPENCLAW_RELOAD_FAILURE_CLEANUP_FAILED', error, binding))
      },
    })
    binding = {
      routeKey: routeKey(identity.agentId, identity.sessionKey),
      key: bindingKey(identity),
      identity,
      epoch,
      direct,
      state: 'activating',
      projected: new Map(),
      catalogGeneration: 0,
      catalogQueue: Promise.resolve(),
      ready: Promise.resolve(undefined as never),
    }
    binding.ready = direct.ready.then(async activation => {
      if (activation === undefined) {
        binding.state = 'inactive'
        return binding
      }
      if (activation.runtimePresetId !== this.#prepared.runtimePresetId) {
        binding.state = 'failed'
        throw new Error(
          `selected Runtime Preset ${JSON.stringify(activation.runtimePresetId)} does not match prepared deployment ${JSON.stringify(this.#prepared.runtimePresetId)}; regenerate and restart the OpenClaw plugin`,
        )
      }
      if (this.#disposed || this.#bindings.get(binding.routeKey) !== binding) {
        await direct.dispose()
        binding.state = 'disposed'
        throw new Error('OpenClaw binding was retired before activation completed')
      }
      binding.activation = activation
      this.#projectSnapshot(binding, activation.bridge.snapshotTools())
      binding.state = 'ready'
      return binding
    }).catch(async error => {
      if (binding.state !== 'disposed') binding.state = 'failed'
      try {
        await direct.dispose()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'OpenClaw binding activation and cleanup failed')
      }
      throw error
    })
    void binding.ready.catch(error => this.#diagnose('OPENCLAW_ACTIVATION_FAILED', error, binding))
    return binding
  }

  #projectSnapshot(binding: NativeBinding, snapshot: ToolCatalogSnapshot): void {
    binding.catalogGeneration += 1
    const projected = projectCatalog(this.#prepared, snapshot, message => {
      this.#diagnose('OPENCLAW_CATALOG_REGENERATION_REQUIRED', message, binding)
    })
    binding.projected = new Map(projected.map(tool => [tool.nativeName, tool]))
    binding.catalogRevision = snapshot.revision
  }

  async #refreshCatalog(binding: NativeBinding, notifiedRevision: string): Promise<void> {
    if (binding.state !== 'ready' || binding.activation === undefined) return
    const snapshot = binding.activation.bridge.snapshotTools()
    if (snapshot.revision !== notifiedRevision) {
      this.#diagnose(
        'OPENCLAW_CATALOG_NOTIFICATION_SUPERSEDED',
        `catalog notification ${JSON.stringify(notifiedRevision)} was superseded by ${JSON.stringify(snapshot.revision)}`,
        binding,
      )
    }
    this.#projectSnapshot(binding, snapshot)
  }

  async warm(context: OpenClawAgentContext): Promise<void> {
    if (this.#disposed) return
    const identity = this.#identity(context)
    if (identity === undefined) return
    const key = routeKey(identity.agentId, identity.sessionKey)
    let binding: NativeBinding
    while (true) {
      const current = this.#bindings.get(key)
      if (current !== undefined && !sameIdentity(current.identity, identity)) {
        await this.#disposeBinding(current)
        continue
      }
      if (current === undefined || current.state === 'disposed') {
        binding = this.#startBinding(identity)
        this.#bindings.set(key, binding)
      } else {
        binding = current
      }
      break
    }
    try {
      await raceWithTimeout(
        binding.ready,
        this.#options.warmupTimeoutMs,
        `Doppelganger warmup exceeded ${this.#options.warmupTimeoutMs}ms`,
      )
    } catch (error) {
      this.#diagnose('OPENCLAW_WARMUP_FAILED', error, binding)
      binding.state = 'failed'
      await binding.direct.dispose()
      throw error
    }
  }

  async projectContext(
    event: { readonly prompt: string },
    context: OpenClawAgentContext,
  ): Promise<OpenClawPromptProjection | undefined> {
    if (!context.runId) {
      this.#diagnose('OPENCLAW_CONTEXT_UNCORRELATED', 'per-turn context requires a native runId')
      return
    }
    const binding = this.#bindingForContext(context)
    if (binding?.state !== 'ready' || binding.activation === undefined) {
      this.#diagnose('OPENCLAW_CONTEXT_UNAVAILABLE', 'Doppelganger context omitted because the binding is not ready', binding)
      return
    }
    const contextKey = boundRunKey(binding, context.runId)
    let cached = this.#contextByRun.get(contextKey)
    if (cached !== undefined && cached.binding !== binding) {
      this.#contextByRun.delete(contextKey)
      cached = undefined
    }
    if (cached === undefined) {
      const tokenBudget = context.contextTokenBudget === undefined
        ? this.#options.contextTokenBudget
        : Math.min(this.#options.contextTokenBudget, Math.max(0, Math.floor(context.contextTokenBudget)))
      cached = {
        binding,
        context: binding.activation.bridge.resolveContext({
          requestId: `openclaw-context-${randomUUID()}`,
          turn: { input: event.prompt, turnId: context.runId },
          tokenBudget,
        }),
      }
      this.#contextByRun.set(contextKey, cached)
      const bindingContextKeys = [...this.#contextByRun.entries()]
        .filter(([, entry]) => entry.binding === binding)
        .map(([key]) => key)
      if (bindingContextKeys.length > 64) this.#contextByRun.delete(bindingContextKeys[0]!)
    }
    let assembled: AssembledContext
    try {
      assembled = await cached.context
    } catch (error) {
      if (this.#contextByRun.get(contextKey) === cached) this.#contextByRun.delete(contextKey)
      this.#diagnose('OPENCLAW_CONTEXT_RESOLUTION_FAILED', error, binding)
      return
    }
    if (binding.state !== 'ready' || this.#bindings.get(binding.routeKey) !== binding) return
    return Object.freeze({
      ...(assembled.instructions.length === 0 ? {} : { appendSystemContext: assembled.instructions }),
      ...(assembled.data.length === 0 ? {} : { appendContext: assembled.data }),
    })
  }

  tools(context: OpenClawPluginToolContext): AnyAgentTool[] | null {
    const binding = this.#bindingForContext(context)
    if (binding?.state !== 'ready' || binding.activation === undefined) {
      this.#diagnose('OPENCLAW_TOOLS_UNAVAILABLE', 'Doppelganger tools are unavailable until native warmup completes', binding)
      return null
    }
    const activation = binding.activation
    const epoch = binding.epoch
    const catalogGeneration = binding.catalogGeneration
    return [...binding.projected.values()].map(projected => {
      const descriptor = projected.descriptor
      return {
        name: projected.nativeName,
        label: descriptor.label,
        description: descriptor.description,
        parameters: descriptor.inputSchema,
        execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
          if (this.#disposed || binding.state !== 'ready' || binding.epoch !== epoch) {
            throw new Error('Doppelganger tool binding is no longer active')
          }
          const current = binding.projected.get(projected.nativeName)
          if (binding.catalogGeneration !== catalogGeneration || current === undefined
            || current.descriptor.revision !== descriptor.revision || current.descriptor.name !== descriptor.name) {
            return renderResult(Object.freeze({
              ok: false as const,
              error: Object.freeze({
                code: current === undefined ? 'TOOL_UNAVAILABLE' : 'TOOL_REVISION_STALE',
                message: current === undefined
                  ? `tool ${JSON.stringify(descriptor.name)} is unavailable in the current catalog`
                  : `tool ${JSON.stringify(descriptor.name)} revision is stale`,
              }),
            }))
          }
          const input = cloneJsonValue(params, `OpenClaw tool ${projected.nativeName} input`, {
            maximumBytes: 1024 * 1024,
            maximumDepth: 64,
          })
          if (signal?.aborted === true) throw signal.reason ?? new Error('OpenClaw tool call aborted')
          const recordKey = boundCallKey(binding, toolCallId)
          const record = this.#approvalRecords.get(recordKey)
          if (record === undefined
            || record.binding !== binding
            || record.epoch !== epoch
            || record.catalogGeneration !== catalogGeneration
            || record.nativeName !== projected.nativeName
            || record.canonicalName !== descriptor.name
            || (record.requiresApproval && record.inputDigest !== digestToolInput(input))
            || record.requiresApproval !== (descriptor.approval?.policy === 'required')
            || record.cancelled
            || record.consumed) {
            throw new Error('Doppelganger tool call is absent, stale, cancelled or does not match final input')
          }
          let approval
          if (record.requiresApproval) {
            if (record.resolution !== 'allow-once') {
              throw new Error('Doppelganger tool approval is absent or unresolved')
            }
            approval = Object.freeze({
              kind: 'one-shot' as const,
              grantId: `openclaw-approval-${randomUUID()}`,
              callId: toolCallId,
              toolRevision: descriptor.revision,
              inputDigest: record.inputDigest,
            })
          }
          record.consumed = true
          record.removeAbort?.()
          this.#approvalRecords.delete(recordKey)
          const activeKey = boundCallKey(binding, toolCallId)
          if (this.#activeCalls.has(activeKey)) throw new Error('Doppelganger native toolCallId is already active for this binding')
          const activeCall: ActiveCall = { binding, bridge: activation.bridge, callId: toolCallId }
          if (signal !== undefined) {
            const abort = () => { void activation.bridge.cancelTool({ callId: toolCallId, reason: 'OpenClaw tool call aborted' }) }
            signal.addEventListener('abort', abort, { once: true })
            activeCall.removeAbort = () => signal.removeEventListener('abort', abort)
          }
          this.#activeCalls.set(activeKey, activeCall)
          try {
            const result = await activation.bridge.invokeTool({
              callId: toolCallId,
              input,
              name: descriptor.name,
              toolRevision: descriptor.revision,
              ...(record.runId === undefined ? {} : { turnId: record.runId }),
              ...(approval === undefined ? {} : { approval }),
            })
            return renderResult(result)
          } finally {
            activeCall.removeAbort?.()
            if (this.#activeCalls.get(activeKey) === activeCall) this.#activeCalls.delete(activeKey)
          }
        },
      } as AnyAgentTool
    })
  }

  beforeToolCall(
    event: OpenClawBeforeToolCallEvent,
    context: OpenClawToolHookContext,
  ): OpenClawBeforeToolCallResult | undefined {
    const prepared = this.#prepared.tools.find(tool => tool.nativeName === event.toolName)
    if (prepared === undefined) return
    const binding = context.agentId === undefined || context.sessionKey === undefined
      ? undefined
      : this.#bindings.get(routeKey(context.agentId, context.sessionKey))
    if (binding !== undefined && context.sessionId !== undefined && binding.identity.sessionId !== context.sessionId) {
      return { block: true, blockReason: 'Doppelganger tool binding identity does not match the native session' }
    }
    if (binding !== undefined && context.workspaceDir !== undefined
      && normalize(resolve(context.workspaceDir)) !== binding.identity.workspaceRoot) {
      return { block: true, blockReason: 'Doppelganger tool binding workspace does not match the native session' }
    }
    if (binding?.state !== 'ready') {
      return { block: true, blockReason: 'Doppelganger tool binding is not ready' }
    }
    const projected = binding.projected.get(event.toolName)
    if (projected === undefined) {
      return { block: true, blockReason: 'Doppelganger tool is unavailable or incompatible with the prepared catalog' }
    }
    if (!event.toolCallId) return { block: true, blockReason: 'Doppelganger tool dispatch requires a native toolCallId' }
    let input: JsonValue
    try {
      input = cloneJsonValue(event.params, `OpenClaw tool ${event.toolName} approval input`, {
        maximumBytes: 1024 * 1024,
        maximumDepth: 64,
      })
    } catch (error) {
      return { block: true, blockReason: boundedMessage(error) }
    }
    const approvalKey = boundCallKey(binding, event.toolCallId)
    if (this.#approvalRecords.has(approvalKey)) {
      return { block: true, blockReason: 'Doppelganger native toolCallId is already awaiting or consumed by approval' }
    }
    const record: ApprovalRecord = {
      binding,
      epoch: binding.epoch,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      callId: event.toolCallId,
      catalogGeneration: binding.catalogGeneration,
      nativeName: event.toolName,
      canonicalName: projected.descriptor.name,
      toolRevision: projected.descriptor.revision,
      requiresApproval: projected.descriptor.approval?.policy === 'required',
      inputDigest: digestToolInput(input),
      consumed: false,
      cancelled: false,
    }
    this.#approvalRecords.set(approvalKey, record)
    if (context.abortSignal !== undefined) {
      const abort = () => {
        record.cancelled = true
        if (this.#approvalRecords.get(approvalKey) === record) this.#approvalRecords.delete(approvalKey)
      }
      context.abortSignal.addEventListener('abort', abort, { once: true })
      record.removeAbort = () => context.abortSignal?.removeEventListener('abort', abort)
      if (context.abortSignal.aborted) abort()
    }
    if (!record.requiresApproval) return
    return {
      requireApproval: {
        title: projected.descriptor.label,
        description: projected.descriptor.approval?.reason
          ?? `Allow ${projected.descriptor.label} for this call only?`,
        allowedDecisions: ['allow-once', 'deny'],
        onResolution: decision => {
          const current = this.#approvalRecords.get(approvalKey)
          if (current !== record || record.consumed || record.cancelled || binding.state !== 'ready' || record.resolution !== undefined) return
          if (decision === 'allow-once') {
            record.resolution = 'allow-once'
            return
          }
          record.resolution = decision === 'deny' || decision === 'timeout' || decision === 'cancelled' ? decision : 'deny'
          record.removeAbort?.()
          this.#approvalRecords.delete(approvalKey)
        },
      },
    }
  }

  async retireSession(sessionKey: string): Promise<void> {
    const bindings = [...this.#bindings.values()].filter(binding => binding.identity.sessionKey === sessionKey)
    await Promise.all(bindings.map(binding => this.#disposeBinding(binding)))
  }

  snapshot(): OpenClawAdapterSnapshot {
    return Object.freeze({
      bindings: Object.freeze([...this.#bindings.values()].map(binding => Object.freeze({
        key: binding.key,
        state: binding.state,
        epoch: binding.epoch,
        ...(binding.activation === undefined ? {} : { runtimePresetId: binding.activation.runtimePresetId }),
        ...(binding.catalogRevision === undefined ? {} : { catalogRevision: binding.catalogRevision }),
      }))),
      diagnostics: Object.freeze([...this.#diagnostics]),
    })
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#disposed = true
    this.#disposePromise = (async () => {
      const failures: unknown[] = []
      const bindings = [...this.#bindings.values()]
      for (const binding of bindings) {
        try {
          await this.#disposeBinding(binding)
        } catch (error) {
          failures.push(error)
        }
      }
      this.#bindings.clear()
      this.#approvalRecords.clear()
      this.#activeCalls.clear()
      this.#contextByRun.clear()
      if (failures.length > 0) throw new AggregateError(failures, 'OpenClaw adapter cleanup failed')
    })()
    return this.#disposePromise
  }
}
