import type {
  SerializedCompositionActivation,
  SerializedCompositionDefinition,
  SerializedPluginReference,
} from '@doppelganger/composition-runtime'
import type {
  AssembledContext,
  LifecycleEvent,
  JsonValue,
  ToolDescriptor,
  ToolInvocationResult,
} from '@doppelganger/extension-protocols'

export const OMP_RPC_PROTOCOL_VERSION = 1 as const

export type {
  SerializedCompositionActivation,
  SerializedCompositionDefinition,
  SerializedPluginReference,
}

export interface SessionActivateParams extends SerializedCompositionActivation {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
}

export interface SessionActivateResult {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
  readonly diagnostics: unknown
  readonly tools: readonly ToolDescriptor[]
}

export interface ContextResolveParams {
  readonly input: string
  readonly turnId?: string
  readonly tokenBudget: number
}

export interface ToolsInvokeParams {
  readonly name: string
  readonly input: JsonValue
}

export interface OmpRpcMethods {
  'session.activate': { readonly params: SessionActivateParams; readonly result: SessionActivateResult }
  'session.dispose': { readonly params: undefined; readonly result: null }
  'context.resolve': { readonly params: ContextResolveParams; readonly result: AssembledContext }
  'tools.list': { readonly params: undefined; readonly result: readonly ToolDescriptor[] }
  'tools.invoke': { readonly params: ToolsInvokeParams; readonly result: ToolInvocationResult }
  'event.publish': { readonly params: LifecycleEvent; readonly result: null }
}
