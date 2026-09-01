## ADDED Requirements

### Requirement: Memory derives actor identity only from the host service
Persistent memory SHALL require a bound session-isolated `doppelgangerActor` service and SHALL derive every canonical, lexical, semantic, operation, capture, and tool partition from its immutable `actorId`. Memory configuration and tool schemas SHALL NOT accept an actor identifier, principal-identity alias, default actor, or actor-switch operation.

#### Scenario: Memory activates with host identity
- **ID**: `memory.actor.activation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** Persona, actor identity, context, tools, and SQLite dependencies are available
- **THEN** memory activates in the `(instanceId, actorId)` partition supplied by the Persona and host services

#### Scenario: Authored config supplies a principal identity
- **ID**: `memory.actor.config-rejection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::rejects obsolete and unsupported memory configuration fields`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::rejects obsolete and unsupported Persona configuration fields`
- **WHEN** a Persona or memory Loader row contains the removed `principalId` configuration
- **THEN** strict configuration validation rejects the obsolete field rather than treating it as an actor binding

#### Scenario: Tool attempts to choose an actor
- **ID**: `memory.actor.tool-rejection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **WHEN** a caller includes `actorId` or `principalId` in a memory tool input whose schema does not define that field
- **THEN** validation rejects the input and the active actor partition remains unchanged

### Requirement: Actor identity naming is a clean public cutover
Memory records, requests, results, partitions, semantic contracts, vector entries, filters, and backend metadata SHALL use `actorId` in TypeScript/JSON and `actor_id` in maintained SQL schemas. Identity fields or aliases named `principalId` or `principal_id` SHALL NOT remain in supported contracts; conversation-authorship terms such as `principalInput` and evidence role `principal` SHALL remain unchanged.

#### Scenario: Consumer inspects a record
- **ID**: `memory.actor.record-naming`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::isolates actors and projects before direct lookup or mutation`
- **WHEN** a caller receives a memory record or semantic projection value
- **THEN** the actor partition is exposed as `actorId` and no principal-identity alias is present

#### Scenario: Committed principal input is captured
- **ID**: `memory.actor.authorship-terms`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::extracts conservative durable patterns as candidates without changing authored identity`
- **WHEN** the lifecycle protocol delivers bounded user-authored turn content
- **THEN** capture continues to label the content `principalInput` and principal evidence without treating those authorship terms as identity fields

### Requirement: Derived semantic state follows actor partition naming
Every local or remote vector backend SHALL store and filter actor partition metadata as `actorId` or `actor_id`. Derived state whose persisted identity schema uses principal-named fields SHALL be treated as incompatible and SHALL be transactionally migrated when safe or rebuilt from canonical current revisions before becoming active; lexical recall SHALL remain available during rebuild or backend failure.

#### Scenario: Existing derived index uses principal metadata
- **ID**: `memory.actor.derived-migration`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::migrates a populated principal-partition artifact to actor schema version two`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::migrates a principal-partition table to actor schema version two transactionally`
- **WHEN** semantic coordination opens a local or remote derived index created by the previous principal-named contract
- **THEN** stale entries cannot become active actor-partition results and the coordinator rebuilds or migrates them under the actor schema before semantic recall resumes

#### Scenario: Semantic rebuild is unavailable
- **ID**: `memory.actor.semantic-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::contains semantic timeout and provider exceptions`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::drops out-of-scope and malformed semantic hits without failing lexical recall`
- **WHEN** the derived actor-named index cannot be rebuilt or queried
- **THEN** canonical actor-scoped lexical retrieval continues and no result from another actor is exposed

## RENAMED Requirements

- FROM: `Persona-principal partitioning`
- TO: `Persona-actor partitioning`

## MODIFIED Requirements

### Requirement: Persona-actor partitioning
Every memory record SHALL belong to exactly one Persona Instance and actor partition and SHALL have either relationship scope or project scope within that partition. Reads and mutations SHALL derive the actor from the active host service, enforce the complete partition, and reject rather than silently broaden an invalid scope.

#### Scenario: Two actors use one persona instance
- **ID**: `partition.actor-isolation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::isolates actors and projects before direct lookup or mutation`
- **WHEN** two actors activate the same Persona Instance and each stores relationship memory
- **THEN** each actor can recall only records in their own Persona-actor partition

#### Scenario: Project scope is queried
- **ID**: `partition.project-eligibility`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** a session recalls memory inside a project
- **THEN** eligible relationship records and records for that project may be returned, while records for every other project or actor are excluded before ranking

#### Scenario: Session has no project
- **ID**: `scope.relationship-default`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::falls back to relationship scope when no project is active`
- **WHEN** a session without a project creates memory without requesting relationship scope
- **THEN** the record is created in relationship scope rather than in an unnamed project scope

### Requirement: Memory retrieval
The memory plugin SHALL support actor-partition-safe lexical retrieval without semantic plugins. When one semantic stack is active, it SHALL retrieve independent semantic top-K candidates over the configured active vector generation, fuse lexical and semantic ranks deterministically, and continue with lexical retrieval when semantic generation, health, query, or result validation fails.

#### Scenario: Project recall
- **ID**: `retrieval.project-partition`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** the current principal turn matches active project records
- **THEN** retrieval returns relevant records from that project plus eligible relationship records without returning records from another project or actor

#### Scenario: Semantic operation fails
- **ID**: `retrieval.semantic-failure-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::contains semantic timeout and provider exceptions`
- **WHEN** query embedding, vector search, or semantic result parsing throws or times out
- **THEN** the same recall request returns eligible lexical results and records a bounded semantic diagnostic

#### Scenario: Long principal turn is searched
- **ID**: `retrieval.long-query-projection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::projects only the semantic branch while lexical search keeps complete technical identifiers`
- **WHEN** a principal turn exceeds the semantic safe-query bound
- **THEN** FTS5 receives the complete turn while the embedder receives a deterministic bounded intent projection

### Requirement: Idempotent mutation delivery
Every state-changing memory command SHALL accept a stable operation identity within its Persona-actor partition. Repeating the same operation SHALL return the original outcome without creating additional records, revisions, evidence, or index work; reusing an operation identity for a different command SHALL fail.

#### Scenario: Committed turn is delivered twice
- **ID**: `idempotency.duplicate-delivery`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::derives idempotent operations from delivery identity and never extracts during disposal`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::makes mutations idempotent and reconciles equivalent subject observations as evidence`
- **WHEN** capture submits the same candidate operation twice for the same actor binding
- **THEN** only one candidate and one set of evidence exist

#### Scenario: Operation identity is reused with different content
- **ID**: `idempotency.conflict`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::makes mutations idempotent and reconciles equivalent subject observations as evidence`
- **WHEN** a caller reuses an existing operation identity for a non-equivalent mutation in the active actor partition
- **THEN** the mutation fails with an idempotency conflict and existing memory is unchanged

### Requirement: Semantic reconciliation remains non-authoritative
Semantic nearest-neighbor lookup for candidates SHALL be advisory and limited to the same Persona Instance, actor, scope, and kind. Similarity thresholds SHALL produce review hints only; canonical evidence, subject, conflict, correction, and promotion commands remain the exclusive state-changing paths.

#### Scenario: Neighbor belongs to another partition
- **ID**: `reconciliation.cross-partition-discard`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::emits only canonically valid same-partition and same-kind neighbor suggestions without mutation`
- **WHEN** a vector backend returns a semantically similar candidate from another actor, instance, or project
- **THEN** it is discarded and cannot appear in reconciliation suggestions

### Requirement: Existing memory migrates without loss
Existing instance memory SHALL migrate transactionally from principal-named identity columns to actor-named identity columns without changing identifier values. Existing active records, operation receipts, immutable revision history, scopes, and provenance SHALL remain retrievable in the same Persona Instance, actor, and project after upgrade.

#### Scenario: Existing principal-partition database activates after upgrade
- **ID**: `migration.actor-rename-upgrade`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::preserves relationship and project memory across process restarts without leaking project or actor scope`
- **WHEN** a supported database with `principal_id` partition columns is first activated with the same host identifier value as `actorId`
- **THEN** migration renames the partition contract atomically and all prior canonical memory remains available under that actor

#### Scenario: Migration fails
- **ID**: `migration.rollback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-schema.spec.ts::rolls back a failed version three actor-column migration`
- **WHEN** existing state cannot be migrated safely
- **THEN** memory activation fails with a diagnostic and the previous database remains recoverable rather than partially migrated

#### Scenario: Version-one legacy memory is upgraded directly
- **ID**: `migration.version-one-actor-assignment`
- **EVIDENCE**: `packages/extension-memory/tests/memory-schema.spec.ts::migrates populated version one state without losing lineage or eligibility`
- **WHEN** a version-one database without an identity partition is activated after the actor cutover
- **THEN** the migration assigns its legacy records to the active host `actorId` and completes the remaining schema migrations in one transaction

### Requirement: Memory Loader activation and persistence
The memory Loader row SHALL activate its complete service, tool, context, and storage surface only when Persona, actor identity, context, tools, and SQLite dependencies are available. Its configured durable state SHALL remain available across Runtime Sessions with the same Persona Instance and actor binding without sharing mutable session objects.

#### Scenario: Memory row activates
- **ID**: `memory.activation.complete-surface-and-recall`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs semantic recall, restart, reindex, fallback, recovery, deletion, and shutdown through a child runtime`
- **WHEN** Persona, actor identity, context, tools, and SQLite dependencies are available
- **THEN** one memory row opens its namespaced store, registers the complete memory tool surface, and registers automatic eligible recall for the bound actor

#### Scenario: Actor identity is unbound or unavailable
- **ID**: `memory.activation.actor-required`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::rejects an unbound actor before opening canonical storage`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::fails memory activation before canonical storage opens when the host actor is unbound`
- **WHEN** the memory Loader row is enabled without a bound `doppelgangerActor` service in its session isolation realm
- **THEN** audited activation fails and no database, memory context, tool, capture, or persistent mutation surface becomes active

#### Scenario: Mark persists across restart
- **ID**: `memory.persistence.restart`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::preserves relationship and project memory across process restarts without leaking project or actor scope`
- **WHEN** two Runtime Sessions activate the Mark preset with the same configured Persona Instance storage and host actor binding
- **THEN** eligible memory written by the first session is available to the second without sharing mutable session objects or handlers
