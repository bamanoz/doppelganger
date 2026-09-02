export { default } from './plugin.ts'
export { CodeGraphPlugin, type CodeGraphPluginConfig } from './plugin.ts'
export {
  CODEGRAPH_LIMITS,
  CodeGraphPluginConfigSchema,
  normalizeCodeGraphPluginConfig,
  type NormalizedCodeGraphPluginConfig,
} from './config.ts'
export { CodeGraphError, type CodeGraphErrorCode } from './errors.ts'
export {
  CODEGRAPH_SUPPORTED_VERSION_RANGE,
  type CodeGraphBinaryStatus,
  type CodeGraphDiagnosticCode,
  type CodeGraphExploreResult,
  type CodeGraphIndexStatus,
  type CodeGraphPendingChanges,
  type CodeGraphStatus,
  type CodeGraphWorktreeMismatch,
} from './types.ts'
