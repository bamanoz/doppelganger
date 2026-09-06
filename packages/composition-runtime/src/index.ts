export {
  createCompositionDefinition,
  type CompositionDefinition,
  type CompositionDefinitionInput,
} from './definition.ts'
export {
  canonicalAbsolutePath,
  canonicalNonEmpty,
  canonicalizeCompositionDefinition,
  type CanonicalCompositionDefinition,
  type CanonicalCompositionInput,
} from './canonicalization.ts'
export {
  createCompositionRuntime,
  type CompositionActivation,
  type CompositionReloadEvent,
  type CompositionReloadFailureEvent,
  type CompositionRuntime,
  type CompositionRuntimeOptions,
  type CompositionSession,
  type CompositionWatchOptions,
  type ProtectedComposition,
  type ProtectedCompositionEntry,
} from './runtime.ts'
export {
  RUNTIME_LOGGING_LIMITS,
  RUNTIME_LOGGING_SERVICE,
  RuntimeLoggingRouter,
  compareRuntimeLogSeverity,
  runtimeLogLevelAllows,
  truncateRuntimeLogUtf8,
  type RuntimeLogError,
  type RuntimeLoggingLimits,
  type RuntimeLoggingScope,
  type RuntimeLoggingService,
  type RuntimeLogRecord,
  type RuntimeLogSeverity,
  type RuntimeLogSink,
  type RuntimeLogSinkOptions,
} from './runtime-logging.ts'
export {
  CompositionActivationError,
  activationFailures,
  type CompositionDiagnostics,
  type CompositionEntryDiagnostic,
  type CompositionEntryState,
  type CompositionReloadDiagnostic,
} from './activation-audit.ts'

export {
  CompositionLayerError,
  RUNTIME_ENTRY_PREFIX,
  RUNTIME_IMPORT_PREFIX,
  composeCompositionEntries,
  flattenCompositionPatches,
  prepareComposition,
  defineCompositionPatchLayer,
  loadCompositionPatchFile,
  validateCompositionEntries,
  type CompositionPatchFile,
  type CompositionPatchInput,
  type CompositionPatchLayer,
  type CompositionPreflight,
} from './patches.ts'
export {
  RUNTIME_SESSION_SERVICE,
  createRuntimeSessionMetadata,
  createRuntimeSessionMetadataPlugin,
  type RuntimeSessionMetadata,
  type RuntimeSessionMetadataInput,
} from './session-metadata.ts'