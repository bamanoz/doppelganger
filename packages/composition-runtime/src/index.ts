export {
  createCompositionDefinition,
  type CompositionDefinition,
  type CompositionDefinitionInput,
  type MountPoint,
  type MountPointInput,
} from './definition.ts'
export {
  defineSerializedCompositionActivation,
  type SerializedActivationResolver,
  type SerializedCompositionActivation,
  type SerializedCompositionDefinition,
  type SerializedPluginReference,
  type SerializedPrimitive,
  type SerializedValue,
} from './serialized-activation.ts'
export {
  createCompositionRuntime,
  type CompositionActivation,
  type CompositionReloadEvent,
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
