export {
  createCompositionDefinition,
  type CompositionDefinition,
  type CompositionDefinitionInput,
} from './definition.ts'
export {
  defineSerializedCompositionActivation,
  type SerializedActivationResolver,
  type SerializedCompositionActivation,
  type SerializedCompositionDefinition,
  type SerializedPrimitive,
  type SerializedValue,
} from './serialized-activation.ts'
export {
  createCompositionRuntime,
  type CompositionActivation,
  type CompositionReloadEvent,
  type CompositionReloadFailureEvent,
  type CompositionRuntime,
  type CompositionRuntimeOptions,
  type CompositionSession,
  type CompositionWatchOptions,
} from './runtime.ts'
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
  defineCompositionPatchLayer,
  loadCompositionPatchFile,
  validateCompositionEntries,
  type CompositionPatchFile,
  type CompositionPatchInput,
  type CompositionPatchLayer,
} from './patches.ts'
export {
  RUNTIME_SESSION_SERVICE,
  createRuntimeSessionMetadata,
  createRuntimeSessionMetadataPlugin,
  type RuntimeSessionMetadata,
  type RuntimeSessionMetadataInput,
} from './session-metadata.ts'