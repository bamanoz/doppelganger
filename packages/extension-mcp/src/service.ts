import { Context, Service } from '@deepseek-ai/cordis'

export type McpServerState = 'connecting' | 'active' | 'failed' | 'disposed'

export interface McpDiagnostic {
  readonly sequence: number
  readonly timestamp: number
  readonly level: 'warning' | 'error'
  readonly code: string
  readonly serverId: string
  readonly message: string
}

export interface McpServerSnapshot {
  readonly id: string
  readonly state: McpServerState
  readonly transport: 'stdio' | 'streamable-http'
  readonly protocolVersion?: string
  readonly serverName?: string
  readonly serverVersion?: string
  readonly toolCount: number
}

export interface McpImportSnapshot {
  readonly servers: readonly McpServerSnapshot[]
  readonly diagnostics: readonly McpDiagnostic[]
}

export interface McpImportRuntimeView {
  snapshot(): McpImportSnapshot
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerMcp: McpImportService
  }
}

export class McpImportService extends Service {
  readonly runtime: McpImportRuntimeView

  constructor(ctx: Context, runtime: McpImportRuntimeView) {
    super(ctx, 'doppelgangerMcp')
    this.runtime = runtime
  }

  snapshot(): McpImportSnapshot {
    return this.runtime.snapshot()
  }
}
