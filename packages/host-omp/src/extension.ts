import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromJsonSchema } from '@oh-my-pi/omptype/from-json-schema'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import type { SerializedCompositionActivation } from '@doppelganger/composition-runtime'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  serializeLifecycleValue,
  type JsonValue,
  type LifecycleEvent,
  type ToolDescriptor,
  type CommittedToolOutcome,
} from '@doppelganger/extension-protocols'
import { OmpAdapterSession, discoverProjectManifest, type OmpChildFactory } from './adapter.ts'
import { NodeOmpChildFactory } from './process.ts'

const INITIALIZE_TOOL = 'doppelganger_initialize'
const PROXY_PREFIX = 'doppelganger_'

export interface OmpActivationRequest {
  readonly cwd: string
  readonly sessionId: string
  readonly projectManifestPath?: string
}

export type OmpActivationResolver = (
  request: OmpActivationRequest,
) => SerializedCompositionActivation | undefined | Promise<SerializedCompositionActivation | undefined>

export interface DoppelgangerOmpExtensionOptions {
  readonly activationResolver: OmpActivationResolver
  readonly childFactory?: OmpChildFactory
  readonly childPath?: string
  readonly tokenBudget?: number
  readonly shutdownTimeoutMs?: number
}

interface ActiveTurn {
  readonly id: string
  readonly principalInput: string
  readonly toolOutcomes: Map<string, CommittedToolOutcome>
  started: boolean
}

function proxyName(runtimeName: string): string {
  return `${PROXY_PREFIX}${runtimeName.replace(/[^a-zA-Z0-9_-]/g, character => `_x${character.codePointAt(0)!.toString(16)}_`)}`
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    details: value,
    ...(isError ? { isError: true } : {}),
  }
}

function messageText(message: unknown): string | undefined {
  if (message === null || typeof message !== 'object' || !('content' in message)) return
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return
  const parts = content.flatMap(part => {
    if (part !== null && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      return [part.text]
    }
    return []
  })
  return parts.length === 0 ? undefined : parts.join('\n')
}

function turnOutcome(message: unknown): 'completed' | 'failed' | 'cancelled' {
  if (message === null || typeof message !== 'object' || !('stopReason' in message)) return 'completed'
  if (message.stopReason === 'aborted') return 'cancelled'
  if (message.stopReason === 'error') return 'failed'
  return 'completed'
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ]).finally(() => {
    clearTimeout(timer)
  })
}

export function createDoppelgangerOmpExtension(options: DoppelgangerOmpExtensionOptions) {
  return function doppelgangerExtension(pi: ExtensionAPI): void {
    let adapter: OmpAdapterSession | undefined
    let turn: ActiveTurn | undefined
    let turnOrdinal = 0
    let deliveryOrdinal = 0
    const activeDescriptors = new Map<string, ToolDescriptor>()
    const registeredProxyNames = new Map<string, string>()

    const report = (ctx: ExtensionContext, message: string) => {
      pi.logger.error(message)
      if (ctx.hasUI) ctx.ui.notify(message, 'error')
    }

    const nextDeliveryId = (sessionId: string, type: string, identity = '') => (
      `${sessionId}:${type}:${identity}:${++deliveryOrdinal}`
    )

    const setProjectedTools = async (tools: readonly ToolDescriptor[]) => {
      const available = tools.filter(tool => tool.available)
      const next = new Map<string, ToolDescriptor>()
      const projectedNames = new Set<string>()
      for (const descriptor of available) {
        if (next.has(descriptor.name)) throw new TypeError(`runtime returned duplicate tool "${descriptor.name}"`)
        const name = proxyName(descriptor.name)
        const collision = registeredProxyNames.get(name)
        if (collision !== undefined && collision !== descriptor.name) {
          throw new TypeError(`runtime tools "${collision}" and "${descriptor.name}" map to the same OMP proxy`)
        }
        registeredProxyNames.set(name, descriptor.name)
        projectedNames.add(name)
        next.set(descriptor.name, descriptor)
        pi.registerTool({
          name,
          label: `Doppelganger: ${descriptor.name}`,
          description: descriptor.description,
          parameters: fromJsonSchema(descriptor.inputSchema),
          async execute(_callId, params) {
            const active = activeDescriptors.get(descriptor.name)
            const connection = adapter?.connection()
            if (active === undefined || connection === undefined || proxyName(active.name) !== name) {
              return textResult({ code: 'RUNTIME_UNAVAILABLE', message: 'persona runtime tool is inactive' }, true)
            }
            try {
              const result = await connection.request('tools.invoke', {
                name: active.name,
                input: jsonValue(params),
              }) as { ok: boolean; value?: unknown; error?: unknown }
              return result.ok ? textResult(result.value) : textResult(result.error, true)
            } catch (cause) {
              await adapter?.fail({ code: 'TOOL_PROXY_FAILED', message: cause instanceof Error ? cause.message : String(cause) })
              return textResult({ code: 'TOOL_PROXY_FAILED', message: cause instanceof Error ? cause.message : String(cause) }, true)
            }
          },
        })
      }
      activeDescriptors.clear()
      for (const [name, descriptor] of next) activeDescriptors.set(name, descriptor)
      const existing = pi.getActiveTools().filter(name => !name.startsWith(PROXY_PREFIX) && name !== INITIALIZE_TOOL)
      const initialize = adapter?.snapshot().initializationAvailable === true ? [INITIALIZE_TOOL] : []
      await pi.setActiveTools([...existing, ...projectedNames, ...initialize])
    }

    const publish = async (event: LifecycleEvent) => {
      const connection = adapter?.connection()
      if (connection === undefined) return
      try {
        await connection.request('event.publish', event)
      } catch (cause) {
        await adapter?.fail({ code: 'EVENT_FORWARD_FAILED', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }

    const start = async (ctx: ExtensionContext) => {
      if (adapter !== undefined) return adapter.snapshot()
      const childFactory = options.childFactory ?? new NodeOmpChildFactory({
        childPath: options.childPath ?? fileURLToPath(new URL('./child.ts', import.meta.url)),
        ...(options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
      })
      const sessionId = ctx.sessionManager.getSessionId()
      let activation: SerializedCompositionActivation | undefined
      try {
        const projectManifestPath = await discoverProjectManifest(ctx.cwd)
        activation = await options.activationResolver({
          cwd: ctx.cwd,
          sessionId,
          ...(projectManifestPath === undefined ? {} : { projectManifestPath }),
        })
      } catch (cause) {
        const code = cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
          ? cause.code
          : 'ACTIVATION_RESOLUTION_FAILED'
        adapter = new OmpAdapterSession({ childFactory })
        await adapter.fail({ code, message: cause instanceof Error ? cause.message : String(cause) })
        report(ctx, `Doppelganger: ${adapter.snapshot().diagnostic!.message}`)
        return adapter.snapshot()
      }
      adapter = new OmpAdapterSession({
        ...(activation === undefined ? {} : { activation }),
        childFactory,
        onToolsChanged: tools => setProjectedTools(tools),
        notifyDiagnostic: problem => report(ctx, `Doppelganger: ${problem.message}`),
      })
      const snapshot = await adapter.start()
      await setProjectedTools(snapshot.tools)
      if (snapshot.state === 'active') {
        await publish({
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'session-started',
          deliveryId: nextDeliveryId(sessionId, 'session-started'),
          sessionId,
          timestamp: Date.now(),
        })
      }
      return snapshot
    }

    pi.registerTool({
      name: INITIALIZE_TOOL,
      label: 'Initialize Doppelganger',
      description: 'Create this project’s Doppelganger persona selection and activate it.',
      defaultInactive: true,
      parameters: pi.zod.object({
        projectId: pi.zod.string().min(1),
        instanceId: pi.zod.string().min(1),
      }),
      async execute(_callId, params, _signal, _onUpdate, ctx) {
        const input = params as { projectId: string; instanceId: string }
        if (adapter?.snapshot().state === 'active') return textResult({ active: true })
        const directory = join(ctx.cwd, '.doppelganger')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'manifest.yaml'), [
          'version: 1',
          `projectId: ${JSON.stringify(input.projectId)}`,
          `instanceId: ${JSON.stringify(input.instanceId)}`,
        ].join('\n'))
        await adapter?.dispose()
        adapter = undefined
        const snapshot = await start(ctx)
        return snapshot.state === 'active'
          ? textResult({ active: true, instanceId: input.instanceId })
          : textResult(snapshot.diagnostic ?? { code: 'ACTIVATION_FAILED' }, true)
      },
    })

    pi.on('session_start', async (_event, ctx) => { await start(ctx) })
    pi.on('before_agent_start', async (event, ctx) => {
      const snapshot = await start(ctx)
      if (snapshot.state !== 'active') return
      const sessionId = ctx.sessionManager.getSessionId()
      turn = {
        id: `${sessionId}:turn:${++turnOrdinal}`,
        principalInput: event.prompt,
        toolOutcomes: new Map(),
        started: false,
      }
      try {
        const connection = adapter?.connection()
        if (connection === undefined) return
        const assembled = await connection.request('context.resolve', {
          input: event.prompt,
          turnId: turn.id,
          tokenBudget: options.tokenBudget ?? 4000,
        }) as { content: string }
        if (assembled.content.length === 0) return
        return { systemPrompt: [...event.systemPrompt, assembled.content] }
      } catch (cause) {
        await adapter?.fail({ code: 'CONTEXT_PROJECTION_FAILED', message: cause instanceof Error ? cause.message : String(cause) })
        return
      }
    })
    pi.on('turn_start', async (event, ctx) => {
      if (turn === undefined || turn.started) return
      turn.started = true
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-started',
        deliveryId: nextDeliveryId(ctx.sessionManager.getSessionId(), 'turn-started', turn.id),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: turn.id,
        timestamp: event.timestamp,
        principalInput: serializeLifecycleValue(turn.principalInput),
      })
    })
    pi.on('tool_execution_start', async (event, ctx) => {
      if (turn === undefined) return
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'tool-started',
        deliveryId: nextDeliveryId(ctx.sessionManager.getSessionId(), 'tool-started', event.toolCallId),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: turn.id,
        callId: event.toolCallId,
        name: event.toolName,
        timestamp: Date.now(),
        input: serializeLifecycleValue(event.args),
      })
    })
    pi.on('tool_execution_end', async (event, ctx) => {
      if (turn === undefined) return
      const outcome: CommittedToolOutcome = Object.freeze({
        callId: event.toolCallId,
        name: event.toolName,
        outcome: event.isError ? 'failed' : 'completed',
        result: serializeLifecycleValue(event.result),
      })
      turn.toolOutcomes.set(event.toolCallId, outcome)
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'tool-completed',
        deliveryId: nextDeliveryId(ctx.sessionManager.getSessionId(), 'tool-completed', event.toolCallId),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: turn.id,
        callId: event.toolCallId,
        name: event.toolName,
        timestamp: Date.now(),
        outcome: outcome.outcome,
        result: serializeLifecycleValue(event.result),
      })
    })
    pi.on('agent_end', async (event, ctx) => {
      if (turn === undefined || event.willContinue === true) return
      const assistant = [...event.messages].reverse().find(message => message.role === 'assistant')
      const completedTurn = turn
      turn = undefined
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-committed',
        deliveryId: nextDeliveryId(ctx.sessionManager.getSessionId(), 'turn-committed', completedTurn.id),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: completedTurn.id,
        timestamp: Date.now(),
        principalInput: serializeLifecycleValue(completedTurn.principalInput),
        assistantOutput: serializeLifecycleValue(messageText(assistant)),
        toolOutcomes: Object.freeze([...completedTurn.toolOutcomes.values()]),
        outcome: turnOutcome(assistant),
      })
    })
    pi.on('session_before_compact', async (event, ctx) => {
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'pre-compaction',
        deliveryId: nextDeliveryId(ctx.sessionManager.getSessionId(), 'pre-compaction'),
        sessionId: ctx.sessionManager.getSessionId(),
        timestamp: Date.now(),
        material: serializeLifecycleValue({
          preparation: event.preparation,
          branchEntries: event.branchEntries,
          ...(event.customInstructions === undefined ? {} : { customInstructions: event.customInstructions }),
        }),
      })
    })
    pi.on('session_shutdown', async (_event, ctx) => {
      const closing = adapter
      turn = undefined
      if (closing === undefined) return
      const sessionId = ctx.sessionManager.getSessionId()
      await withTimeout(publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'session-completed',
        deliveryId: nextDeliveryId(sessionId, 'session-completed'),
        sessionId,
        timestamp: Date.now(),
        outcome: 'completed',
      }), options.shutdownTimeoutMs ?? 2000, 'session completion').catch(cause => {
        report(ctx, `Doppelganger: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
      adapter = undefined
      const disposal = await closing.dispose()
      if (disposal.outcome !== 'graceful' || !disposal.sessionDisposeAcknowledged) {
        report(ctx, `Doppelganger: runtime shutdown ${disposal.outcome}; session acknowledgement=${String(disposal.sessionDisposeAcknowledged)}`)
      }
    })
  }
}
