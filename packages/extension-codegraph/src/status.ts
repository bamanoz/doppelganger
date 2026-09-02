import { normalize } from 'node:path'
import { CodeGraphError } from './errors.ts'
import type {
  CodeGraphBinaryStatus,
  CodeGraphDiagnosticCode,
  CodeGraphIndexStatus,
  CodeGraphPendingChanges,
  CodeGraphStatus,
  CodeGraphWorktreeMismatch,
} from './types.ts'

const MAX_PATH_BYTES = 16 * 1_024
const MAX_STRING_BYTES = 1_024
const MAX_COUNT = Number.MAX_SAFE_INTEGER

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new CodeGraphError('CODEGRAPH_STATUS_INVALID', `${label} must be an object`)
  }
  return value as Readonly<Record<string, unknown>>
}

function string(value: unknown, label: string, maximumBytes = MAX_STRING_BYTES): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new CodeGraphError('CODEGRAPH_STATUS_INVALID', `${label} must be a bounded non-empty string`)
  }
  return value
}

function path(value: unknown, label: string): string {
  return normalize(string(value, label, MAX_PATH_BYTES))
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return string(value, label)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new CodeGraphError('CODEGRAPH_STATUS_INVALID', `${label} must be a boolean`)
  return value
}

function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) {
    throw new CodeGraphError('CODEGRAPH_STATUS_INVALID', `${label} must be a non-negative safe integer`)
  }
  return value
}

function nullableCount(value: unknown, label: string): number | null {
  if (value === null) return null
  return count(value, label)
}

function pendingChanges(value: unknown): CodeGraphPendingChanges {
  const input = record(value, 'status.pendingChanges')
  return Object.freeze({
    added: count(input.added, 'status.pendingChanges.added'),
    modified: count(input.modified, 'status.pendingChanges.modified'),
    removed: count(input.removed, 'status.pendingChanges.removed'),
  })
}

function worktreeMismatch(value: unknown): CodeGraphWorktreeMismatch | undefined {
  if (value === null) return undefined
  const input = record(value, 'status.worktreeMismatch')
  return Object.freeze({
    worktreeRoot: path(input.worktreeRoot, 'status.worktreeMismatch.worktreeRoot'),
    indexRoot: path(input.indexRoot, 'status.worktreeMismatch.indexRoot'),
  })
}

type CodeGraphIndexState = Exclude<CodeGraphIndexStatus['state'], undefined>

function indexState(value: unknown): CodeGraphIndexState {
  if (value === null) return null
  if (value === 'complete' || value === 'partial' || value === 'indexing' || value === 'failed') return value
  throw new CodeGraphError('CODEGRAPH_STATUS_INVALID', 'status.index.state is unsupported')
}

export function parseCodeGraphStatus(stdout: string): CodeGraphIndexStatus {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (cause) {
    throw new CodeGraphError('CODEGRAPH_STATUS_INVALID', `CodeGraph status returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const input = record(parsed, 'status')
  const initialized = boolean(input.initialized, 'status.initialized')
  const base = {
    initialized,
    projectPath: path(input.projectPath, 'status.projectPath'),
    indexPath: path(input.indexPath, 'status.indexPath'),
    lastIndexed: nullableString(input.lastIndexed, 'status.lastIndexed'),
  }
  if (!initialized) return Object.freeze(base)

  const index = record(input.index, 'status.index')
  return Object.freeze({
    ...base,
    fileCount: count(input.fileCount, 'status.fileCount'),
    nodeCount: count(input.nodeCount, 'status.nodeCount'),
    edgeCount: count(input.edgeCount, 'status.edgeCount'),
    pendingChanges: pendingChanges(input.pendingChanges),
    ...(worktreeMismatch(input.worktreeMismatch) === undefined ? {} : { worktreeMismatch: worktreeMismatch(input.worktreeMismatch)! }),
    builtWithVersion: nullableString(index.builtWithVersion, 'status.index.builtWithVersion'),
    builtWithExtractionVersion: nullableCount(index.builtWithExtractionVersion, 'status.index.builtWithExtractionVersion'),
    currentExtractionVersion: count(index.currentExtractionVersion, 'status.index.currentExtractionVersion'),
    reindexRecommended: boolean(index.reindexRecommended, 'status.index.reindexRecommended'),
    state: indexState(index.state),
    pendingRefs: count(index.pendingRefs, 'status.index.pendingRefs'),
  })
}

export interface CodeGraphSafety {
  readonly safe: boolean
  readonly repairable: boolean
  readonly code?: CodeGraphDiagnosticCode
  readonly diagnostic?: string
}

function pendingTotal(changes: CodeGraphPendingChanges | undefined): number {
  if (changes === undefined) return 0
  return changes.added + changes.modified + changes.removed
}

export function classifyCodeGraphSafety(
  workspaceRoot: string,
  binary: CodeGraphBinaryStatus,
  index: CodeGraphIndexStatus,
): CodeGraphSafety {
  if (!binary.available) return Object.freeze({ safe: false, repairable: false, code: 'binary-unavailable', diagnostic: 'CodeGraph executable is unavailable' })
  if (!binary.compatible) return Object.freeze({ safe: false, repairable: false, code: 'binary-incompatible', diagnostic: 'CodeGraph executable is outside the supported version range' })
  if (!index.initialized) return Object.freeze({ safe: false, repairable: false, code: 'index-uninitialized', diagnostic: 'CodeGraph is not initialized for this workspace' })
  if (index.projectPath !== workspaceRoot) return Object.freeze({ safe: false, repairable: false, code: 'workspace-mismatch', diagnostic: 'CodeGraph resolved an index outside the Runtime Session workspace' })
  if (index.worktreeMismatch !== undefined) return Object.freeze({ safe: false, repairable: false, code: 'worktree-mismatch', diagnostic: 'CodeGraph reports a worktree/index mismatch' })
  if (index.reindexRecommended === true) return Object.freeze({ safe: false, repairable: false, code: 'rebuild-required', diagnostic: 'CodeGraph requires a full user-driven rebuild' })
  if (index.state !== 'complete') return Object.freeze({ safe: false, repairable: false, code: 'index-incomplete', diagnostic: `CodeGraph index state is ${index.state ?? 'legacy/unknown'}` })
  if (index.builtWithVersion === null || index.builtWithVersion === undefined || index.builtWithVersion !== binary.version) {
    return Object.freeze({ safe: false, repairable: false, code: 'rebuild-required', diagnostic: 'CodeGraph index was built with a different or unknown version' })
  }
  if (index.builtWithExtractionVersion === null || index.builtWithExtractionVersion === undefined
    || index.currentExtractionVersion === undefined
    || index.builtWithExtractionVersion !== index.currentExtractionVersion) {
    return Object.freeze({ safe: false, repairable: false, code: 'rebuild-required', diagnostic: 'CodeGraph extraction version changed; rebuild is required' })
  }
  if (pendingTotal(index.pendingChanges) > 0) return Object.freeze({ safe: false, repairable: true, code: 'pending-changes', diagnostic: 'CodeGraph has pending incremental file changes' })
  if ((index.pendingRefs ?? 0) > 0) return Object.freeze({ safe: false, repairable: true, code: 'pending-references', diagnostic: 'CodeGraph has unresolved references pending synchronization' })
  return Object.freeze({ safe: true, repairable: false })
}

export function statusResult(
  workspaceRoot: string | undefined,
  binary: CodeGraphBinaryStatus,
  index?: CodeGraphIndexStatus,
): CodeGraphStatus {
  if (workspaceRoot === undefined) {
    return Object.freeze({
      workspaceAvailable: false,
      binary,
      explorationSafe: false,
      diagnosticCode: 'workspace-unavailable',
      diagnostic: 'Runtime Session has no workspace root',
    })
  }
  if (index === undefined) {
    return Object.freeze({
      workspaceAvailable: true,
      workspaceRoot,
      binary,
      explorationSafe: false,
      diagnosticCode: binary.available ? 'binary-incompatible' : 'binary-unavailable',
      diagnostic: binary.available
        ? 'CodeGraph executable is outside the supported version range'
        : 'CodeGraph executable is unavailable',
    })
  }
  const safety = classifyCodeGraphSafety(workspaceRoot, binary, index)
  return Object.freeze({
    workspaceAvailable: true,
    workspaceRoot,
    binary,
    index,
    explorationSafe: safety.safe,
    ...(safety.code === undefined ? {} : { diagnosticCode: safety.code }),
    ...(safety.diagnostic === undefined ? {} : { diagnostic: safety.diagnostic }),
  })
}
