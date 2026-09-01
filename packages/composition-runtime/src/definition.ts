import type { CompositionPatchInput } from './patches.ts'
import {
  canonicalizeCompositionDefinition,
  type CanonicalCompositionDefinition,
} from './canonicalization.ts'

export interface CompositionDefinitionInput {
  readonly id: string
  readonly revision: string
  readonly loaderPath: string
  readonly patches?: readonly CompositionPatchInput[]
}

export interface CompositionDefinition extends CanonicalCompositionDefinition {}

export function createCompositionDefinition(input: CompositionDefinitionInput): CompositionDefinition {
  return canonicalizeCompositionDefinition(input, 'composition')
}
