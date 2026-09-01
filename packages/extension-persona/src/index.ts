export { default } from './plugin.ts'
export {
  PersonaPlugin,
  type PersonaAssetConfig,
  type PersonaPluginConfig,
  type PersonaTraitConfig,
} from './plugin.ts'
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
  type PersonaAssetReloadEvent,
  type PersonaAssetReloadOutcome,
  type PersonaAssetRevision,
} from './asset.ts'
export {
  IdentityPlugin,
  type IdentityPluginConfig,
} from './identity.ts'
export { TraitsPlugin } from './traits.ts'
