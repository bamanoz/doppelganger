## MODIFIED Requirements

### Requirement: Vector projections are non-authoritative and data-minimized
A vector backend SHALL store only rebuildable projection data and SHALL NOT become authoritative for content, revision state, evidence, conflicts, receipts, temporal state, or deletion state. The selected canonical memory repository provider SHALL determine every observable result after current-state revalidation. Projection names and diagnostics SHALL exclude credentials and SHALL use opaque isolated generation identities.

#### Scenario: External index contains a stale document
- **ID**: `memory.semantic.projection.stale-content-revalidation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::revalidates record and revision identity after asynchronous semantic ranking`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::revalidates stale semantic content against both canonical providers`
- **WHEN** an external backend returns projected content for a non-current or missing revision
- **THEN** the content is ignored and the selected canonical memory repository determines the observable result

#### Scenario: Backend target contains credentials
- **ID**: `memory.semantic.credentials.indirect-and-redacted`
- **EVIDENCE**: `packages/extension-memory/tests/memory-semantic-contracts.spec.ts::uses deterministic identifiers and excludes undeclared secrets and device settings`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::does not expose an indirect credential in identity or failures`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::fails lazily when the indirect DSN is absent and rejects credential-bearing diagnostics`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::rejects dimensions before writing and exposes deterministic UUID IDs without credentials`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::registers sanitized status, rebuild, rollback, and maintenance tools`
- **WHEN** a connection setting includes an API key or password-bearing DSN
- **THEN** the secret is resolved from an indirect credential reference and is absent from persisted markers, generation fingerprints, errors, and health output

### Requirement: Projection synchronization is durable and idempotent
Canonical mutations SHALL enqueue identifier-only vector projection work atomically in the same awaited canonical repository transaction as the canonical state change. Retrying work SHALL NOT create duplicate vector entries, and a worker SHALL load and verify the current canonical revision immediately before embedding or deletion.
Canonical projection queue, receipt, generation, lease, routing, and status-count persistence SHALL remain owned by the memory module. A semantic coordinator SHALL use bounded asynchronous memory-owned operations for leasing, retry, delivery acknowledgment, and generation transitions rather than obtaining unrestricted ORM, SQL, or canonical database access. Those operations SHALL enforce canonical store, Persona Instance, generation, backend-target, source-revision, and lease-token identity; SHALL route deletion work after source rows disappear; SHALL use awaitable atomic repository transactions; and SHALL revalidate source state when asynchronous backend work is acknowledged.

#### Scenario: Active revision is committed
- **ID**: `memory.semantic.projection.transactional-enqueue`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::enqueues active revisions transactionally and deduplicates command replay`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::rolls back a canonical mutation when its transactional outbox write fails`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::atomically commits canonical mutations and projection work on both providers`
- **WHEN** an explicit record, promoted candidate, or correction becomes the current active revision
- **THEN** deterministic projection work for that record and revision is committed in the same awaited canonical transaction

#### Scenario: Projection delivery repeats
- **ID**: `memory.semantic.projection.idempotent-delivery`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::enqueues active revisions transactionally and deduplicates command replay`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::creates cosine collection, filters payload, and converges idempotent writes/deletes`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::upserts idempotently and returns deterministic cosine top-K with filters`
- **WHEN** the same projection work is delivered more than once
- **THEN** the backend converges on one entry with the deterministic identity and reports the work complete once

#### Scenario: Revision changes before queued work runs
- **ID**: `memory.semantic.projection.stale-work-convergence`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::converges a stale queued revision to deletion and the current upsert`
- **WHEN** queued upsert work names a revision that is no longer current
- **THEN** the worker does not embed the stale content and converges the backend toward the current canonical state

#### Scenario: Semantic plugins are absent
- **ID**: `memory.semantic.projection.absent-stack-no-work`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::commits canonical and lexical memory without semantic projection work`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::commits canonical and lexical state without projection work on both providers`
- **WHEN** canonical memory changes while no semantic stack is active
- **THEN** the canonical mutation and the selected provider's lexical index update succeed without accumulating work for an unconfigured generation

#### Scenario: Canonical revision changes before projection acknowledgment
- **ID**: `memory.semantic.projection.acknowledgment-current-source`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::revalidates canonical projection acknowledgments after external work`
- **WHEN** a backend upsert finishes after the canonical record was corrected, forgotten or made ineligible
- **THEN** the memory-owned acknowledgment refuses to certify the stale revision as current and preserves the durable work needed to converge on canonical state

#### Scenario: Coordinator attempts an invalid canonical generation transition
- **ID**: `memory.semantic.projection.owner-rejects-invalid-transition`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::preserves canonical state when a coordinator generation transition is invalid`
- **WHEN** coordinator work requests activation or acknowledgment for an obsolete or mismatched canonical generation
- **THEN** the memory-owned operation rejects that transition without changing the valid active pointer or losing pending canonical work

#### Scenario: Concurrent workers target different projection routes
- **ID**: `memory.semantic.projection.store-generation-target-routing`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::routes shared-store work by instance generation and target`
- **WHEN** coordinators for different Persona Instances, generations, or vector targets claim work concurrently from one canonical store
- **THEN** each worker receives only work matching its canonical store, instance, generation, and target identity, including deletion work whose source record no longer exists

#### Scenario: An expired worker acknowledges a reclaimed lease
- **ID**: `memory.semantic.projection.lease-token-fencing`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::fences retry and acknowledgment with the current lease token`
- **WHEN** a lease is recovered by another worker and the previous worker retries or acknowledges with its stale lease token
- **THEN** the memory-owned operation rejects the stale worker without completing, delaying, or replacing the current owner's work

### Requirement: Semantic generations rebuild without mixed vector spaces
A rebuild or backend/model change SHALL populate a new isolated generation from deterministic pages of canonical current eligible revisions, verify it, and switch the durable active-generation pointer in the canonical repository only after successful completion. The pointer and transition state SHALL be shared across processes and changed through serialized compare-and-swap operations rather than process-local authority. Changing EmbeddingGemma from q4/256 to q8/384 SHALL always produce a distinct generation identity. The coordinator SHALL rebuild from canonical memory and SHALL NOT copy, reinterpret, resize, or query vectors from the incompatible q4/256 generation. Failure SHALL leave the previous generation active.

#### Scenario: q8/384 rebuild succeeds
- **ID**: `memory.semantic.generation.q8-rebuild-atomic-activation`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::rebuilds q8/384 from canonical content and atomically retains the q4/256 generation`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::persists generation activation across concurrent canonical clients`
- **WHEN** the configured EmbeddingGemma identity changes from q4/256 to q8/384 and every canonical active revision is projected and generation verification passes
- **THEN** the q8/384 generation becomes durably active atomically, the q4/256 generation remains isolated as retained or failed historical state, and semantic queries use only q8/384 vectors

#### Scenario: q8/384 rebuild is interrupted
- **ID**: `memory.semantic.generation.interrupted-rebuild-isolation`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::keeps q4/256 active across an incomplete q8/384 rebuild and retries from canonical state`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::keeps the active generation on a failed rebuild and closes after in-flight work`
- **WHEN** q8/384 embedding or backend writing fails before generation verification
- **THEN** searches continue using the previous q4/256 generation and do not query the incomplete q8/384 generation

#### Scenario: Concurrent clients attempt generation transitions
- **ID**: `memory.semantic.generation.cross-client-serialization`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::serializes generation activation across concurrent coordinators`
- **WHEN** two clients sharing one canonical store attempt incompatible active-generation transitions from the same durable generation revision
- **THEN** one compare-and-swap transition succeeds and the other is rejected against the durable current pointer without exposing mixed vector spaces

#### Scenario: A coordinator starts with an incompatible committed generation
- **ID**: `memory.semantic.generation.explicit-replacement`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator-concurrency.spec.ts::requires an explicit rebuild to replace an incompatible committed generation`
- **WHEN** a coordinator starts with a model, backend, or target that differs from the committed active generation
- **THEN** startup preserves the committed pointer and canonical lexical recall until an explicit serialized rebuild activates the replacement
