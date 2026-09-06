## MODIFIED Requirements

### Requirement: Vector projections are non-authoritative and data-minimized
A vector backend SHALL store only rebuildable projection data and SHALL NOT become authoritative for canonical content, revision state, evidence, conflicts, receipts, temporal state, deletion state, usage state, working-memory checkpoints, presentation tiers, subject hierarchy, or semantic relations. The selected canonical repository provider SHALL determine every observable result after current-state revalidation. Projection entries SHALL declare whether they represent a canonical revision, derived revision tier, or derived subject group; SHALL retain opaque source identities sufficient for canonical revalidation; and SHALL exclude credentials, raw committed turns, evidence excerpts, and undeclared content. Projection names and diagnostics SHALL use opaque isolated generation identities.

#### Scenario: External index contains a stale document
- **ID**: `memory.semantic.projection.stale-content-revalidation`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-backend-conformance.spec.ts::revalidates canonical and derived projection source identities on both providers after asynchronous ranking`
- **WHEN** an external backend returns projected content for a non-current or missing revision or obsolete subject-group generation
- **THEN** the projection is ignored and the selected canonical repository plus current derived-generation state determine the observable result

#### Scenario: Backend target contains credentials
- **ID**: `memory.semantic.credentials.indirect-and-redacted`
- **EVIDENCE**: `packages/extension-memory/tests/memory-semantic-contracts.spec.ts::uses deterministic identifiers and excludes undeclared secrets and device settings`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::does not expose an indirect credential in identity or failures`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::fails lazily when the indirect DSN is absent and rejects credential-bearing diagnostics`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::rejects dimensions before writing and exposes deterministic UUID IDs without credentials`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::registers sanitized status, rebuild, rollback, and maintenance tools`
- **WHEN** a connection setting includes an API key or password-bearing DSN
- **THEN** the secret is resolved from an indirect credential reference and is absent from persisted markers, generation fingerprints, errors, health output, and all derived context projections

#### Scenario: Derived tier is projected externally
- **ID**: `memory.semantic.projection.derived-tier-minimization`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::projects only current bounded tiers and opaque canonical identities`
- **WHEN** a current L0 abstract, L1 overview, or subject-group summary is embedded
- **THEN** the backend stores only the bounded projection text, projection kind, generation identity, and opaque canonical source identities required for ranking and revalidation

### Requirement: Projection synchronization is durable and idempotent
Canonical mutations SHALL enqueue identifier-only vector and presentation projection work atomically in the same awaited selected-repository transaction as the canonical state change when the corresponding projection stack is configured. Presentation projection completion MAY enqueue dependent subject-group, relation, or vector projection work through deterministic idempotent identities. Retrying any work SHALL NOT create duplicate projections or relations, and every worker SHALL load and verify current canonical revision, partition, temporal eligibility, generation, dependency identity, and deletion state immediately before generation or delivery.

Canonical projection queue, receipt, generation, lease, routing, and status-count persistence SHALL remain owned by the memory module through the bounded asynchronous projection interface established by the backend prerequisite. A semantic coordinator SHALL use only those operations for leasing, renewal, retry, delivery acknowledgment, and generation transitions; it SHALL NOT obtain a repository, ORM entity, SQL statement, raw connection, or unrestricted transaction access. Those operations SHALL enforce canonical store, Persona Instance, generation, backend-target, projection-kind, source-revision, and lease-token identity; route deletion work after source rows disappear; use awaitable atomic repository transactions on both canonical providers; and revalidate source state when asynchronous external work is acknowledged.

#### Scenario: Active revision is committed
- **ID**: `memory.semantic.projection.transactional-enqueue`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-backend-conformance.spec.ts::atomically commits canonical and multi-kind projection work on both providers`
- **WHEN** an explicit record, promoted candidate, or correction becomes the current active revision
- **THEN** deterministic configured projection work for that record and revision is committed in the same awaited canonical transaction

#### Scenario: Projection delivery repeats
- **ID**: `memory.semantic.projection.idempotent-delivery`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::converges repeated tier hierarchy relation and vector work on both providers`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::creates cosine collection, filters payload, and converges idempotent writes/deletes`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::upserts idempotently and returns deterministic cosine top-K with filters`
- **WHEN** the same projection work is delivered more than once
- **THEN** local and external stores converge on one projection per deterministic identity and the current lease owner acknowledges the work complete once

#### Scenario: Revision changes before queued work runs
- **ID**: `memory.semantic.projection.stale-work-convergence`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::deletes stale dependent projections and schedules the current revision on both providers`
- **WHEN** queued presentation, relation, group, or vector work names a revision that is no longer current
- **THEN** the worker does not process stale content and converges every configured derived store toward the current canonical revision

#### Scenario: Semantic plugins are absent
- **ID**: `memory.semantic.projection.absent-stack-no-work`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-backend-conformance.spec.ts::runs canonical lexical and configured local tiers without an external semantic stack on both providers`
- **WHEN** canonical memory changes while no semantic stack is active
- **THEN** canonical mutation and the selected provider's lexical update succeed, configured local presentation work remains independent, and no work accumulates for an unconfigured vector generation

#### Scenario: Canonical revision changes before projection acknowledgment
- **ID**: `memory.semantic.projection.acknowledgment-current-source`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::revalidates current source before acknowledging multi-kind external work on both providers`
- **WHEN** a backend upsert finishes after the canonical record was corrected, forgotten or made ineligible
- **THEN** the memory-owned acknowledgment refuses to certify the stale revision as current and preserves the durable work needed to converge on canonical state

#### Scenario: Coordinator attempts an invalid canonical generation transition
- **ID**: `memory.semantic.projection.owner-rejects-invalid-transition`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::preserves provider-owned generation state when a coordinator transition is invalid`
- **WHEN** coordinator work requests activation or acknowledgment for an obsolete, incomplete, mismatched, or incompatible canonical generation
- **THEN** the memory-owned operation rejects that transition without changing the valid active pointer or losing pending canonical work

#### Scenario: Concurrent workers target different projection routes
- **ID**: `memory.semantic.projection.store-generation-target-routing`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::routes shared-store multi-kind work by instance generation and target`
- **WHEN** coordinators for different canonical stores, Persona Instances, generations, projection kinds, or vector targets claim work concurrently
- **THEN** each worker receives only work matching its canonical store, instance, generation, projection kind, and target identity, including deletion work whose source record no longer exists

#### Scenario: An expired worker acknowledges a reclaimed lease
- **ID**: `memory.semantic.projection.lease-token-fencing`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::fences multi-kind retry and acknowledgment with the current lease token`
- **WHEN** a lease is recovered by another worker and the previous worker retries or acknowledges with its stale lease token
- **THEN** the memory-owned operation rejects the stale worker without completing, delaying, or replacing the current owner's work

#### Scenario: Presentation projection completes
- **ID**: `memory.semantic.projection.dependent-work`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::enqueues deterministic dependent group relation and vector work after tier completion on both providers`
- **WHEN** a current revision's presentation projection becomes complete
- **THEN** dependent work is enqueued idempotently through the selected repository for affected subject ancestors, relation analysis, and configured vector entries without mutating canonical memory

### Requirement: Semantic generations rebuild without mixed vector spaces
A rebuild, projection-schema change, backend change, or model change SHALL populate a new isolated generation from deterministic pages of canonical current eligible revisions and current compatible derived projections, verify it, and switch the durable active-generation pointer in the selected canonical repository only after successful completion. Generation identity SHALL cover embedder space, vector backend identity, supported projection kinds, presentation projector identity, hierarchy format, and relation format when those values affect indexed content. The pointer and transition state SHALL be shared across processes and changed through serialized compare-and-swap repository operations rather than process-local authority. Incompatible generations SHALL NOT be queried together, and failure SHALL leave the previous valid generation active while canonical lexical recall and compatible local projections remain available.

#### Scenario: q8/384 rebuild succeeds
- **ID**: `memory.semantic.generation.q8-rebuild-atomic-activation`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::rebuilds canonical and derived projection kinds into one atomically activated generation`
- **WHEN** the configured EmbeddingGemma identity changes from q4/256 to q8/384 and every required canonical or derived projection is written and generation verification passes
- **THEN** the q8/384 generation becomes durably active atomically, the q4/256 generation remains isolated as retained or failed historical state, and semantic queries use only the compatible active generation

#### Scenario: q8/384 rebuild is interrupted
- **ID**: `memory.semantic.generation.interrupted-rebuild-isolation`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::keeps the prior generation active across incomplete multi-kind rebuilds`
- **WHEN** presentation generation, embedding, hierarchy projection, or backend writing fails before generation verification
- **THEN** searches continue using the previous valid semantic generation plus canonical lexical retrieval and do not query the incomplete generation

#### Scenario: Concurrent clients attempt generation transitions
- **ID**: `memory.semantic.generation.cross-client-serialization`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::serializes multi-kind generation activation across concurrent coordinators`
- **WHEN** two clients sharing one canonical store attempt incompatible active-generation transitions from the same durable generation revision
- **THEN** one compare-and-swap transition succeeds and the other is rejected against the durable current pointer without exposing mixed vector spaces

#### Scenario: Presentation projector changes
- **ID**: `memory.semantic.generation.projector-identity-change`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::isolates generations when presentation projection identity changes`
- **WHEN** the configured projector revision or tier format changes indexed L0, L1, or subject-group text
- **THEN** a distinct generation is rebuilt from canonical current revisions and old derived text is never mixed with the new generation

### Requirement: Semantic diagnostics are bounded and secret-free
The memory tool surface SHALL report backend kind, sanitized target, embedder-space identity, active generation, supported projection kinds, current/indexed/stale/missing counts by projection kind, pending projection and deletion counts, retained generation count, last failure category and time, and supported maintenance operations. It SHALL NOT expose credentials, vectors, canonical memory content, generated tier content, subject summaries, relation text, committed-turn content, or query content.

#### Scenario: Operator inspects semantic status
- **ID**: `memory.semantic.diagnostics.bounded-status`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::reports multi-kind projection lag without protected content`
- **WHEN** the semantic status tool is invoked
- **THEN** it returns bounded operational metadata sufficient to identify lag, mismatch, incomplete projection kinds, and backend failure without exposing protected content

#### Scenario: Group projections lag behind revisions
- **ID**: `memory.semantic.diagnostics.group-lag`
- **EVIDENCE**: `planned:packages/extension-memory-vectors/tests/coordinator.spec.ts::reports bounded subject-group projection lag and recovery`
- **WHEN** revision presentation projections are current but dependent subject-group entries remain pending or stale
- **THEN** status reports bounded per-kind counts and the active compatible generation without listing subjects or memory content

## ADDED Requirements

### Requirement: Presentation projections preserve canonical revision identity
An optional presentation projector SHALL produce zero or one complete L0 abstract and zero or one complete L1 overview for a canonical current revision. Each output SHALL be bounded, validated by the shared content policy, stored through the selected repository under deterministic projector-generation, record, and revision identity, and replaceable or deletable without changing canonical history. Malformed, secret-bearing, oversized, stale, or failed output SHALL remain invisible, and retrieval SHALL fall back to another complete tier or canonical L2 content.

#### Scenario: Projector returns valid tiers
- **ID**: `memory.semantic.presentation.valid-current-tiers`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::publishes bounded complete tiers only after validation`
- **WHEN** a configured projector returns valid bounded L0 and L1 output for the current revision
- **THEN** both tiers become visible atomically under the exact record, revision, and projector-generation identity

#### Scenario: Projector returns secret-bearing output
- **ID**: `memory.semantic.presentation.secret-rejection`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::rejects secret-bearing generated tiers without replacing valid projections`
- **WHEN** generated tier output violates the shared content policy
- **THEN** the output is rejected without persistence, vector delivery, or loss of the previous compatible valid tier

#### Scenario: Revision is corrected
- **ID**: `memory.semantic.presentation.revision-replacement`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-projections.spec.ts::removes superseded tiers and converges on the corrected revision`
- **WHEN** a canonical correction replaces the source revision
- **THEN** old presentation tiers and their dependent external entries become ineligible immediately and deterministic work converges on the new revision

### Requirement: Subject-group projections are deterministic and partition-safe
The projection subsystem SHALL derive subject ancestors only from validated stable `subjectKey` segments and SHALL maintain bounded group entries through the selected repository keyed by projection generation, Persona Instance, actor, scope, project, and subject prefix. A group entry SHALL summarize only canonically current eligible children from its exact partition, SHALL contain bounded navigation data rather than authoritative memory, and SHALL rebuild deterministically when child membership or current revision changes.

#### Scenario: Child revision changes
- **ID**: `memory.semantic.hierarchy.child-change-rebuild`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-hierarchy.spec.ts::rebuilds affected ancestors only and preserves deterministic membership`
- **WHEN** a child record under `project.runtime.transport` is added, corrected, expired, deactivated, or deleted
- **THEN** deterministic work refreshes only the affected validated subject ancestors and removes obsolete group entries

#### Scenario: Subject key has multiple segments
- **ID**: `memory.semantic.hierarchy.stable-ancestors`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-hierarchy.spec.ts::derives stable bounded ancestors from validated subject keys`
- **WHEN** a current record uses a subject key such as `preference.response.verbosity`
- **THEN** the subsystem derives only the configured bounded ancestor set and never invents aliases or cross-scope group membership

### Requirement: Relation projections are revision-bound and rebuildable
The projection subsystem SHALL store advisory semantic relations through the selected repository under deterministic relation-generation, source revision, target revision, relation type, and partition identity. Relation generation SHALL use only bounded current eligible material, SHALL enforce a bounded vocabulary and per-source edge limit, SHALL reject self-links and cross-partition links, and SHALL delete or suppress an edge when either endpoint is no longer current and eligible. Relation storage SHALL remain provider-backed rebuildable state unless a vector backend explicitly declares an equivalent data-minimized relation capability.

#### Scenario: Relation batch contains invalid edges
- **ID**: `memory.semantic.relations.validation`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-relations.spec.ts::rejects self cross-partition stale and unknown relation edges`
- **WHEN** a relation projector returns self-links, unknown relation types, duplicate edges, stale revisions, or cross-partition targets
- **THEN** invalid edges are discarded and valid edges are normalized and bounded without failing canonical memory

#### Scenario: Relation projector is unavailable
- **ID**: `memory.semantic.relations.optional-fallback`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-relations.spec.ts::preserves normal lexical and semantic recall without relation projections`
- **WHEN** no relation projector is configured or relation generation fails
- **THEN** canonical mutation, lexical retrieval, vector retrieval, and progressive tier assembly continue without relation expansion
