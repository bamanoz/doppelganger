import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  createActorIdentityPlugin,
  publishLifecycleEvent,
  type AssembledContext,
  type ContextProtocol,
  type JsonValue,
  type LifecycleEvent,
  type ToolDescriptor,
  type ToolInvocationResult,
  type ToolRegistry,
} from '@doppelganger/doppelganger-protocols'
import type { RuntimeChangedParams } from './contracts.ts'

export type RuntimeNotification =
  | { readonly method: 'tools.changed'; readonly params: readonly ToolDescriptor[] }
  | { readonly method: 'runtime.changed'; readonly params: RuntimeChangedParams }
  | { readonly method: 'runtime.failed'; readonly params: { readonly message: string } }

export type OmpLifecycleEvent = LifecycleEvent

export interface OmpRuntimeHost {
  resolveContext(input: string, turnId: string | undefined, tokenBudget: number): Promise<AssembledContext>
  listTools(): readonly ToolDescriptor[]
  invokeTool(name: string, input: JsonValue): Promise<ToolInvocationResult>
  publishEvent(event: OmpLifecycleEvent): Promise<void>
}

export interface OmpRuntimeHostBinding {
  attach(host: OmpRuntimeHost): void
  detach(host: OmpRuntimeHost): void
  notify(notification: RuntimeNotification): void
}

const EMPTY_CONTEXT: AssembledContext = Object.freeze({
  content: '',
  contributions: Object.freeze([]),
  omittedSources: Object.freeze([]),
  tokenCount: 0,
})
const EMPTY_TOOLS: readonly ToolDescriptor[] = Object.freeze([])

export function createOmpRuntimeHostPlugin(binding: OmpRuntimeHostBinding, actorId?: string): Plugin {
  return {
    name: 'doppelganger-omp-runtime-host',
    async apply(ctx: Context) {
      await ctx.plugin(createActorIdentityPlugin(actorId)).await()
      const context = () => ctx.get('doppelgangerContext', false) as ContextProtocol | undefined
      const tools = () => ctx.get('doppelgangerTools', false) as ToolRegistry | undefined
      const host: OmpRuntimeHost = Object.freeze({
        resolveContext: (input: string, turnId: string | undefined, tokenBudget: number) => {
          const protocol = context()
          if (protocol === undefined) return Promise.resolve(EMPTY_CONTEXT)
          return protocol.resolve({
            turn: { input, ...(turnId === undefined ? {} : { turnId }) },
            tokenBudget,
          })
        },
        listTools: () => tools()?.list() ?? EMPTY_TOOLS,
        invokeTool: (name: string, input: JsonValue) => {
          const protocol = tools()
          if (protocol !== undefined) return protocol.invoke(name, input)
          return Promise.resolve(Object.freeze({
            ok: false as const,
            error: Object.freeze({
              code: 'TOOL_PROTOCOL_UNAVAILABLE',
              message: 'the active Runtime Preset does not provide the tools protocol',
            }),
          }))
        },
        publishEvent: (event: OmpLifecycleEvent) => publishLifecycleEvent(ctx, event),
      })
      binding.attach(host)
      ctx.on('doppelganger/tools-changed', () => {
        binding.notify({ method: 'tools.changed', params: host.listTools() })
      })
      ctx.effect(() => () => binding.detach(host), 'doppelgangerOmpHost.detach')
    },
  }
}
