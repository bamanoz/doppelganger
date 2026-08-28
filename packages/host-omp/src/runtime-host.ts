import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  publishLifecycleEvent,
  type AssembledContext,
  type JsonValue,
  type LifecycleEvent,
  type ToolDescriptor,
  type ToolInvocationResult,
} from '@doppelganger/extension-protocols'
import type {} from '@doppelganger/extension-protocols'

export type RuntimeNotification =
  | { readonly method: 'tools.changed'; readonly params: readonly ToolDescriptor[] }
  | { readonly method: 'profile.changed'; readonly params: { readonly revision: string } }
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

export function createOmpRuntimeHostPlugin(binding: OmpRuntimeHostBinding): Plugin {
  return {
    name: 'doppelganger-omp-runtime-host',
    inject: ['doppelgangerContext', 'doppelgangerTools'],
    apply(ctx: Context) {
      const host: OmpRuntimeHost = Object.freeze({
        resolveContext: (input: string, turnId: string | undefined, tokenBudget: number) => (
          ctx.doppelgangerContext.resolve({
            turn: { input, ...(turnId === undefined ? {} : { turnId }) },
            tokenBudget,
          })
        ),
        listTools: () => ctx.doppelgangerTools.list(),
        invokeTool: (name: string, input: JsonValue) => ctx.doppelgangerTools.invoke(name, input),
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
