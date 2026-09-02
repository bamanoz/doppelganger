import type { Fiber } from '@deepseek-ai/cordis'
import type { JsonValue } from '@doppelganger/doppelganger-protocols'

export type RuntimePluginMode = 'run' | 'update'
export type RuntimePluginDiagnosticPhase = 'apply' | 'disposal' | 'evaluation' | 'guard' | 'parse' | 'waiting'

export interface RuntimePluginDiagnostic {
  readonly pluginId: string
  readonly packageId: string
  readonly runId: string
  readonly phase: RuntimePluginDiagnosticPhase
  readonly message: string
  readonly stack?: string
}

export interface RuntimePluginPackage {
  readonly packageId: string
  readonly name: string
  readonly purpose: string
  readonly source: string
  readonly sourceDigest: string
  readonly sourceBytes: number
}

export interface RuntimePluginRun {
  readonly runId: string
  readonly packageId: string
  readonly fiber: Fiber
  waitingFor: readonly string[]
}

export interface RuntimePluginRecord {
  readonly pluginId: string
  readonly packages: Map<string, RuntimePluginPackage>
  currentPackageId?: string
  nextPackageId?: string
  activeRun?: RuntimePluginRun
  latestDiagnostic?: RuntimePluginDiagnostic
}

export interface RuntimePluginDefineInput {
  readonly plugin:
    | { readonly kind: 'new'; readonly idPrefix: string }
    | { readonly kind: 'existing'; readonly pluginId: string }
  readonly name: string
  readonly purpose: string
  readonly source: string
}

export interface RuntimePluginRunInput {
  readonly pluginId: string
  readonly packageId: string
  readonly mode: RuntimePluginMode
  readonly name: string
  readonly purpose: string
  readonly sourceDigest: string
}

export interface RuntimePluginErrorData {
  readonly phase?: RuntimePluginDiagnosticPhase
  readonly pluginId?: string
  readonly packageId?: string
  readonly runId?: string
  readonly details?: JsonValue
}
