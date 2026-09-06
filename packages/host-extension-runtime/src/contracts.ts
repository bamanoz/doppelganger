import type { Plugin } from '@deepseek-ai/cordis'
import type { ProtectedComposition } from '@doppelganger/doppelganger-composition-runtime'
import type { JsonValue } from '@doppelganger/doppelganger-protocols'

export const HOST_EXTENSION_API_VERSION = 1 as const

export type HostSessionFacts = Readonly<Record<string, JsonValue> & { readonly hostKind: string }>

export interface HostExtensionSessionContext<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly sessionId: string
  readonly runtimePresetId: string
  readonly workspaceRoot?: string
  readonly facts: Facts
}

export interface HostExtensionEntry {
  readonly plugin: Plugin
  readonly isolate?: Readonly<Record<string, 'session'>>
}

export type HostExtensionFactory<Facts extends HostSessionFacts = HostSessionFacts> = (
  context: HostExtensionSessionContext<Facts>,
) => HostExtensionEntry

export interface HostExtensionDefinition<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly apiVersion: typeof HOST_EXTENSION_API_VERSION
  readonly hostKind: string
  readonly id: string
  readonly title?: string
  normalizeConfig(input: unknown): JsonValue
  createFactory(config: JsonValue): HostExtensionFactory<Facts>
}

export interface HostExtensionModule<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly hostExtension: HostExtensionDefinition<Facts>
}

export interface HostExtensionSelectionInput {
  readonly id: string
  readonly config?: unknown
}

export interface HostExtensionSelection {
  readonly id: string
  readonly config: JsonValue
}

export interface HostExtensionPlan<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly hostKind: string
  readonly selections: readonly HostExtensionSelection[]
  instantiate(context: HostExtensionSessionContext<Facts>): ProtectedComposition
}

export interface HostExtensionCatalog<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly hostKind: string
  readonly definitions: readonly HostExtensionDefinition<Facts>[]
  readonly ids: readonly string[]
  plan(input: readonly HostExtensionSelectionInput[]): HostExtensionPlan<Facts>
  restore(input: readonly HostExtensionSelection[]): HostExtensionPlan<Facts>
}
