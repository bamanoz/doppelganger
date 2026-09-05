import type { Context, Plugin } from '@deepseek-ai/cordis'
import { type AssembledContext, type ContextProtocol } from './context.ts'
import {
  HOST_CAPABILITIES_SERVICE,
  defineRuntimeHostCapabilities,
  type RuntimeHostCapabilities,
} from './host-capabilities.ts'
import { normalizeLifecycleEvent, publishLifecycleEvent, type LifecycleEvent } from './lifecycle.ts'
import {
  type ToolCancellationRequest,
  type ToolCancellationResult,
  type ToolCatalogSnapshot,
  type ToolInvocationRequest,
  type ToolInvocationResult,
  type ToolRegistry,
} from './tools.ts'

export interface HostContextRequest {
  readonly requestId: string
  readonly turn: {
    readonly input: string
    readonly turnId?: string
  }
  readonly tokenBudget: number
}

export interface RuntimeHostBridge {
  readonly capabilities: RuntimeHostCapabilities
  resolveContext(request: HostContextRequest): Promise<AssembledContext>
  snapshotTools(): ToolCatalogSnapshot
  invokeTool(request: ToolInvocationRequest): Promise<ToolInvocationResult>
  cancelTool(request: ToolCancellationRequest): Promise<ToolCancellationResult>
  publishLifecycle(event: LifecycleEvent): Promise<void>
}

export interface RuntimeHostBinding {
  attach(bridge: RuntimeHostBridge): void
  detach(bridge: RuntimeHostBridge): void
  toolCatalogChanged(revision: string): void
}

interface RuntimeSessionService {
  readonly sessionId: string
}

const EMPTY_CONTEXT: AssembledContext = Object.freeze({
  instructions: '',
  data: '',
  contributions: Object.freeze([]),
  omittedSources: Object.freeze([]),
  tokenCount: 0,
})

const EMPTY_TOOLS: ToolCatalogSnapshot = Object.freeze({
  revision: 'catalog:0',
  tools: Object.freeze([]),
})

function nonEmpty(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value.trim()
}

function unavailable(message: string): ToolInvocationResult {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code: 'TOOL_PROTOCOL_UNAVAILABLE', message }),
  })
}

function runtimeSession(ctx: Context): RuntimeSessionService {
  const value = ctx.get('doppelgangerRuntimeSession', false) as RuntimeSessionService | undefined
  if (value === undefined) throw new Error('Runtime Host requires doppelgangerRuntimeSession')
  return Object.freeze({ sessionId: nonEmpty('runtime sessionId', value.sessionId) })
}

export function createRuntimeHostPlugin(
  binding: RuntimeHostBinding,
  inputCapabilities: unknown,
): Plugin {
  const capabilities = defineRuntimeHostCapabilities(inputCapabilities)
  return {
    name: 'doppelganger-runtime-host',
    async apply(ctx: Context) {
      const logger = ctx.logger('doppelganger-runtime-host')
      logger.info('component.activation.started')
      const session = runtimeSession(ctx)
      ctx.provide(HOST_CAPABILITIES_SERVICE, capabilities)
      const context = () => ctx.get('doppelgangerContext', false) as ContextProtocol | undefined
      const tools = () => ctx.get('doppelgangerTools', false) as ToolRegistry | undefined
      let attached = true
      const requireAttached = () => {
        if (!attached) throw new Error('Runtime Host bridge is detached')
      }
      const bridge: RuntimeHostBridge = Object.freeze({
        capabilities,
        async resolveContext(request: HostContextRequest) {
          requireAttached()
          nonEmpty('context requestId', request.requestId)
          if (typeof request.turn?.input !== 'string') throw new TypeError('context turn input must be a string')
          if (request.turn.turnId !== undefined) nonEmpty('context turnId', request.turn.turnId)
          if (!Number.isSafeInteger(request.tokenBudget) || request.tokenBudget < 0) {
            throw new RangeError('context token budget must be a non-negative safe integer')
          }
          const protocol = context()
          if (protocol === undefined) return EMPTY_CONTEXT
          return protocol.resolve({
            turn: {
              input: request.turn.input,
              ...(request.turn.turnId === undefined ? {} : { turnId: request.turn.turnId.trim() }),
            },
            tokenBudget: request.tokenBudget,
          })
        },
        snapshotTools() {
          requireAttached()
          return tools()?.snapshot() ?? EMPTY_TOOLS
        },
        invokeTool(request: ToolInvocationRequest) {
          if (!attached) return Promise.resolve(unavailable('Runtime Host bridge is detached'))
          const protocol = tools()
          if (protocol === undefined) {
            return Promise.resolve(unavailable('the active Runtime Preset does not provide the tools protocol'))
          }
          return protocol.invoke(request, session.sessionId)
        },
        async cancelTool(request: ToolCancellationRequest) {
          if (!attached) return Object.freeze({ cancelled: false })
          return tools()?.cancel(request) ?? Object.freeze({ cancelled: false })
        },
        async publishLifecycle(input: LifecycleEvent) {
          requireAttached()
          const event = normalizeLifecycleEvent(input)
          if (event.sessionId !== session.sessionId) {
            throw new TypeError(`lifecycle event sessionId must equal Runtime Session "${session.sessionId}"`)
          }
          if (!capabilities.lifecycle.events.includes(event.type)) {
            throw new TypeError(`lifecycle event "${event.type}" is not declared by Runtime Host capabilities`)
          }
          await publishLifecycleEvent(ctx, event)
        },
      })

      binding.attach(bridge)
      logger.info('component.active')
      ctx.on('doppelganger/tools-changed', revision => {
        if (attached) binding.toolCatalogChanged(revision)
      })
      ctx.effect(() => async () => {
        logger.info('component.disposal.started')
        if (!attached) return
        attached = false
        const protocol = tools()
        if (protocol !== undefined) await protocol.disposeActiveCalls('Runtime Host bridge detached')
        binding.detach(bridge)
        logger.info('component.disposal.completed')
      }, 'doppelgangerRuntimeHost.detach')
    },
  }
}
