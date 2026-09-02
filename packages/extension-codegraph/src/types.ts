export const CODEGRAPH_SUPPORTED_VERSION_RANGE = '>=1.6.0 <1.7.0' as const

export type CodeGraphDiagnosticCode =
  | 'workspace-unavailable'
  | 'binary-unavailable'
  | 'binary-incompatible'
  | 'index-uninitialized'
  | 'workspace-mismatch'
  | 'worktree-mismatch'
  | 'rebuild-required'
  | 'index-incomplete'
  | 'pending-changes'
  | 'pending-references'
  | 'index-unsafe'

export interface CodeGraphBinaryStatus {
  readonly available: boolean
  readonly executable: string
  readonly version?: string
  readonly compatible: boolean
}

export interface CodeGraphPendingChanges {
  readonly added: number
  readonly modified: number
  readonly removed: number
}

export interface CodeGraphWorktreeMismatch {
  readonly worktreeRoot: string
  readonly indexRoot: string
}

export interface CodeGraphIndexStatus {
  readonly initialized: boolean
  readonly projectPath: string
  readonly indexPath: string
  readonly lastIndexed: string | null
  readonly fileCount?: number
  readonly nodeCount?: number
  readonly edgeCount?: number
  readonly pendingChanges?: CodeGraphPendingChanges
  readonly worktreeMismatch?: CodeGraphWorktreeMismatch
  readonly builtWithVersion?: string | null
  readonly builtWithExtractionVersion?: number | null
  readonly currentExtractionVersion?: number
  readonly reindexRecommended?: boolean
  readonly state?: 'complete' | 'partial' | 'indexing' | 'failed' | null
  readonly pendingRefs?: number
}

export interface CodeGraphStatus {
  readonly workspaceAvailable: boolean
  readonly workspaceRoot?: string
  readonly binary: CodeGraphBinaryStatus
  readonly index?: CodeGraphIndexStatus
  readonly explorationSafe: boolean
  readonly diagnosticCode?: CodeGraphDiagnosticCode
  readonly diagnostic?: string
}

export interface CodeGraphExploreResult {
  readonly workspaceRoot: string
  readonly maxFiles: number
  readonly content: string
}
