export { default } from './plugin.ts'
export {
  EvolutionPlugin,
  EvolutionPluginConfigSchema,
  type EvolutionPluginConfig,
} from './plugin.ts'
export {
  EvolutionError,
  EvolutionService,
  type EvolutionDiagnostic,
  type EvolutionEvidenceInput,
  type EvolutionEvidenceSummary,
  type EvolutionForwardStatus,
  type EvolutionHistoryEntry,
  type EvolutionInspectResult,
  type EvolutionListRequest,
  type EvolutionListResult,
  type EvolutionProposal,
  type EvolutionProposalKind,
  type EvolutionProposalStatus,
  type EvolutionProposeRequest,
  type EvolutionRejectRequest,
  type EvolutionReminderDelivery,
  type EvolutionReminderRecordRequest,
  type EvolutionScope,
  type EvolutionServiceConfig,
  type EvolutionSnoozeRequest,
  type EvolutionTransitionRequest,
} from './service.ts'
export {
  EVOLUTION_PROJECT_DOCUMENT_VERSION,
  EVOLUTION_SCHEMA_VERSION,
  migrateEvolutionSchema,
  type EvolutionProjectDocument,
} from './schema.ts'
