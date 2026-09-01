import {
  canonicalAbsolutePath,
  canonicalizeCompositionDefinition,
  canonicalNonEmpty,
  type CanonicalCompositionDefinition,
} from './canonicalization.ts'
import type { CompositionPatchInput } from './patches.ts'

export type SerializedPrimitive = boolean | number | string | null
export type SerializedValue =
  | SerializedPrimitive
  | { readonly [key: string]: SerializedValue }
  | readonly SerializedValue[]

export interface SerializedCompositionDefinition extends CanonicalCompositionDefinition {
  readonly patches: readonly CompositionPatchInput[]
}

export interface SerializedCompositionActivation {
  readonly composition: SerializedCompositionDefinition
  readonly sessionId: string
  readonly workspaceRoot?: string
  readonly hostKind: 'omp'
  readonly watch?: boolean
}

export type SerializedActivationResolver<Request = void> = (
  request: Request,
) => SerializedCompositionActivation | undefined | Promise<SerializedCompositionActivation | undefined>

export function defineSerializedCompositionActivation(
  input: SerializedCompositionActivation,
): SerializedCompositionActivation {
  if (input.hostKind !== 'omp') throw new TypeError('activation.hostKind must equal "omp"')
  return Object.freeze({
    composition: canonicalizeCompositionDefinition(input.composition, 'activation.composition'),
    sessionId: canonicalNonEmpty('activation.sessionId', input.sessionId),
    ...(input.workspaceRoot === undefined
      ? {}
      : { workspaceRoot: canonicalAbsolutePath('activation.workspaceRoot', input.workspaceRoot) }),
    hostKind: 'omp',
    ...(input.watch === undefined ? {} : { watch: input.watch }),
  })
}
