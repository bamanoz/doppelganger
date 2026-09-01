import {
  defineSerializedCompositionActivation,
  type SerializedCompositionActivation,
  type SerializedCompositionDefinition,
} from '@doppelganger/doppelganger-composition-runtime'
import {
  createActorIdentity,
  type AssembledContext,
  type LifecycleEvent,
  type JsonValue,
  type ToolDescriptor,
  type ToolInvocationResult,
} from '@doppelganger/doppelganger-protocols'

export const OMP_RPC_PROTOCOL_VERSION = 3 as const

export type {
  SerializedCompositionActivation,
  SerializedCompositionDefinition,
}

export interface SerializedOmpActivation extends SerializedCompositionActivation {
  readonly actorId?: string
}

export function defineSerializedOmpActivation(input: SerializedOmpActivation): SerializedOmpActivation {
  const activation = defineSerializedCompositionActivation(input)
  const actor = createActorIdentity(input.actorId)
  return Object.freeze({
    ...activation,
    ...(actor.state === 'bound' ? { actorId: actor.actorId } : {}),
  })
}

export interface SessionActivateParams extends SerializedOmpActivation {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
}

export interface SessionActivateResult {
  readonly protocolVersion: typeof OMP_RPC_PROTOCOL_VERSION
  readonly diagnostics: unknown
  readonly runtimeRevision: string
  readonly tools: readonly ToolDescriptor[]
}

export interface RuntimeChangedParams {
  readonly runtimeRevision: string
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
