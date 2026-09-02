import type { InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import type { EvolutionProposal } from './model.ts'

export const EVOLUTION_SCHEMA_VERSION = 1
export const EVOLUTION_PROJECT_DOCUMENT_VERSION = 1

export interface EvolutionProjectDocument {
  readonly version: typeof EVOLUTION_PROJECT_DOCUMENT_VERSION
  readonly proposal: EvolutionProposal
  readonly operations: Readonly<Record<string, { readonly digest: string; readonly proposal: EvolutionProposal }>>
}

export function migrateEvolutionSchema(storage: InstanceSqliteDatabase): void {
  storage.exec(`
    CREATE TABLE IF NOT EXISTS evolution_schema (
      version INTEGER NOT NULL CHECK(version = ${EVOLUTION_SCHEMA_VERSION})
    );
    INSERT INTO evolution_schema(version)
      SELECT ${EVOLUTION_SCHEMA_VERSION}
      WHERE NOT EXISTS (SELECT 1 FROM evolution_schema);

    CREATE TABLE IF NOT EXISTS evolution_proposals (
      instance_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('persona', 'capability')),
      scope TEXT NOT NULL CHECK(scope = 'global'),
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('proposed', 'reviewing', 'researching', 'options-ready', 'selected', 'planned', 'implementing', 'snoozed', 'rejected', 'done')),
      current_revision INTEGER NOT NULL CHECK(current_revision > 0),
      snoozed_until TEXT,
      resume_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, actor_id, id),
      UNIQUE(instance_id, actor_id, kind, scope, dedupe_key)
    );
    CREATE TABLE IF NOT EXISTS evolution_revisions (
      instance_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      status TEXT NOT NULL,
      snoozed_until TEXT,
      resume_status TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, actor_id, proposal_id, revision),
      FOREIGN KEY(instance_id, actor_id, proposal_id)
        REFERENCES evolution_proposals(instance_id, actor_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS evolution_evidence (
      instance_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      id TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, actor_id, proposal_id, id),
      FOREIGN KEY(instance_id, actor_id, proposal_id)
        REFERENCES evolution_proposals(instance_id, actor_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS evolution_transitions (
      instance_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      detail TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, actor_id, proposal_id, id),
      FOREIGN KEY(instance_id, actor_id, proposal_id)
        REFERENCES evolution_proposals(instance_id, actor_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS evolution_reminders (
      instance_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, actor_id, proposal_id, id),
      UNIQUE(instance_id, actor_id, proposal_id, session_id, turn_id),
      FOREIGN KEY(instance_id, actor_id, proposal_id)
        REFERENCES evolution_proposals(instance_id, actor_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS evolution_operations (
      instance_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      command_digest TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(instance_id, actor_id, operation_id)
    );
    CREATE INDEX IF NOT EXISTS evolution_proposals_status
      ON evolution_proposals(instance_id, actor_id, status, updated_at, id);
    CREATE INDEX IF NOT EXISTS evolution_reminders_proposal
      ON evolution_reminders(instance_id, actor_id, proposal_id, created_at, id);
  `)
  const versions = storage.prepare('SELECT version FROM evolution_schema').all()
  if (versions.length !== 1 || Number(versions[0]?.version) !== EVOLUTION_SCHEMA_VERSION) {
    throw new Error('unsupported Evolution schema version')
  }
}
