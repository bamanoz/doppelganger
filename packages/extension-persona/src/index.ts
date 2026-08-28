export {
  PERSONA_ACTIVATION_SERVICE,
  createPersonaActivation,
  createPersonaActivationPlugin,
  type PersonaActivation,
  type PersonaActivationInput,
  type PersonaIdentityActivation,
  type PersonaTraitActivation,
} from './activation.ts'
export {
  PersonaConfigError,
  loadPersonaDefinitionMetadata,
  loadPersonaInstanceMetadata,
  loadProjectPersonaManifest,
  loadUserPersonaConfig,
  selectPersonaTraits,
  type ConfigDiagnostic,
  type LoadedPersonaDefinition,
  type PersonaAssetDefinition,
  type PersonaDefinitionMetadata,
  type PersonaInstanceMetadata,
  type ProjectPersonaManifest,
  type UserPersonaConfig,
} from './config.ts'
export {
  IdentityPlugin,
  type IdentityPluginConfig,
} from './identity.ts'
export { TraitsPlugin } from './traits.ts'
export {
  resolvePersonaSelection,
  type PersonaSelectionRequest,
  type ResolvedPersonaSelection,
} from './selection.ts'
