import type { InstanceSqliteDatabase } from '@doppelganger/doppelganger-sqlite'
import type { EvolutionProposal } from './model.ts'

export const EVOLUTION_SCHEMA_VERSION = 2
export const EVOLUTION_PROJECT_DOCUMENT_VERSION = 1

export interface EvolutionProjectDocument {
  readonly version: typeof EVOLUTION_PROJECT_DOCUMENT_VERSION
  readonly proposal: EvolutionProposal
  readonly operations: Readonly<Record<string, { readonly digest: string; readonly proposal: EvolutionProposal }>>
}

const PROPOSAL_SCHEMA_SQL = `
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
`

const SIGNAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS evolution_signal_receipts (
    instance_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY(instance_id, actor_id, delivery_id)
  );
  CREATE TABLE IF NOT EXISTS evolution_signals (
    instance_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    id TEXT NOT NULL,
    project_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('persona', 'capability')),
    scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
    pattern_key TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    summary TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
    reuse_value TEXT NOT NULL CHECK(reuse_value IN ('low', 'medium', 'high')),
    source TEXT NOT NULL CHECK(source IN ('deterministic', 'inference')),
    delivery_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    call_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(instance_id, actor_id, id),
    UNIQUE(instance_id, actor_id, delivery_id, kind, scope, project_id, pattern_key)
  );
  CREATE TABLE IF NOT EXISTS evolution_signal_aggregates (
    instance_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    project_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('persona', 'capability')),
    scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
    pattern_key TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
    reuse_value TEXT NOT NULL CHECK(reuse_value IN ('low', 'medium', 'high')),
    occurrence_count INTEGER NOT NULL CHECK(occurrence_count >= 0),
    deterministic_occurrence_count INTEGER NOT NULL DEFAULT 0 CHECK(deterministic_occurrence_count >= 0),
    distinct_turns INTEGER NOT NULL CHECK(distinct_turns >= 0),
    distinct_sessions INTEGER NOT NULL CHECK(distinct_sessions >= 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    promotion_status TEXT NOT NULL CHECK(promotion_status IN ('pending', 'eligible', 'promoted', 'terminal-collision')),
    proposal_id TEXT,
    promotion_operation_id TEXT,
    proposal_dedupe_key TEXT,
    PRIMARY KEY(instance_id, actor_id, kind, scope, project_id, pattern_key)
  );
  CREATE TABLE IF NOT EXISTS evolution_signal_diagnostics (
    instance_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    id TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    delivery_id TEXT NOT NULL DEFAULT '',
    pattern_key TEXT NOT NULL DEFAULT '',
    proposal_id TEXT NOT NULL DEFAULT '',
    occurrence_count INTEGER NOT NULL CHECK(occurrence_count > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(instance_id, actor_id, id),
    UNIQUE(instance_id, actor_id, code, delivery_id, pattern_key, proposal_id)
  );
  CREATE TABLE IF NOT EXISTS evolution_signal_meta (
    instance_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(instance_id, actor_id, key)
  );
  CREATE INDEX IF NOT EXISTS evolution_signal_receipts_expiry
    ON evolution_signal_receipts(instance_id, actor_id, expires_at, delivery_id);
  CREATE INDEX IF NOT EXISTS evolution_signals_created
    ON evolution_signals(instance_id, actor_id, created_at, id);
  CREATE INDEX IF NOT EXISTS evolution_signals_aggregate
    ON evolution_signals(instance_id, actor_id, kind, scope, project_id, pattern_key, created_at, id);
  CREATE INDEX IF NOT EXISTS evolution_signal_aggregates_status
    ON evolution_signal_aggregates(instance_id, actor_id, promotion_status, last_seen_at, pattern_key);
  CREATE INDEX IF NOT EXISTS evolution_signal_diagnostics_updated
    ON evolution_signal_diagnostics(instance_id, actor_id, updated_at, id);
`

function hasColumn(storage: InstanceSqliteDatabase, table: string, column: string): boolean {
  const rows = storage.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>
  return rows.some(row => row.name === column)
}

function currentSchemaVersion(storage: InstanceSqliteDatabase): 0 | 1 | 2 {
  storage.exec('CREATE TABLE IF NOT EXISTS evolution_schema (version INTEGER NOT NULL);')
  const versions = storage.prepare('SELECT version FROM evolution_schema').all()
  if (versions.length === 0) return 0
  if (versions.length !== 1) throw new Error('unsupported Evolution schema version')
  const version = Number(versions[0]?.version)
  if (version !== 1 && version !== 2) throw new Error('unsupported Evolution schema version')
  return version
}

export function migrateEvolutionSchema(storage: InstanceSqliteDatabase): void {
  const version = currentSchemaVersion(storage)
  storage.transaction(database => {
    database.exec(PROPOSAL_SCHEMA_SQL)
    database.exec(SIGNAL_SCHEMA_SQL)
    if (!hasColumn(database, 'evolution_signal_aggregates', 'deterministic_occurrence_count')) {
      database.exec(`
        ALTER TABLE evolution_signal_aggregates
        ADD COLUMN deterministic_occurrence_count INTEGER NOT NULL DEFAULT 0
          CHECK(deterministic_occurrence_count >= 0);
      `)
    }
    if (version !== EVOLUTION_SCHEMA_VERSION) {
      database.exec(`
        DROP TABLE evolution_schema;
        CREATE TABLE evolution_schema (
          version INTEGER NOT NULL CHECK(version = ${EVOLUTION_SCHEMA_VERSION})
        );
        INSERT INTO evolution_schema(version) VALUES (${EVOLUTION_SCHEMA_VERSION});
      `)
    }
  })
  const versions = storage.prepare('SELECT version FROM evolution_schema').all()
  if (versions.length !== 1 || Number(versions[0]?.version) !== EVOLUTION_SCHEMA_VERSION) {
    throw new Error('unsupported Evolution schema version')
  }
}
