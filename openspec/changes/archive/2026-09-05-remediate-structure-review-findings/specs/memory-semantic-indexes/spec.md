## MODIFIED Requirements

### Requirement: Projection synchronization is durable and idempotent
Canonical mutations SHALL enqueue identifier-only vector projection work transactionally with the canonical state change. Retrying work SHALL NOT create duplicate vector entries, and a worker SHALL load and verify the current canonical revision immediately before embedding or deletion.
Canonical projection queue, receipt, generation and status-count persistence SHALL remain owned by the memory module. A semantic coordinator SHALL use bounded memory-owned operations for leasing, retry, delivery acknowledgment and generation transitions rather than obtaining unrestricted canonical database access. Those operations SHALL enforce canonical identity and generation state, retain synchronous transaction boundaries, and revalidate source state when asynchronous backend work is acknowledged.

#### Scenario: Active revision is committed
- **ID**: `memory.semantic.projection.transactional-enqueue`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::enqueues active revisions transactionally and deduplicates command replay`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::rolls back a canonical mutation when its transactional outbox write fails`
- **WHEN** an explicit record, promoted candidate, or correction becomes the current active revision
- **THEN** deterministic projection work for that record and revision is committed in the same canonical transaction

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
- **WHEN** canonical memory changes while no semantic stack is active
- **THEN** canonical mutation and FTS5 succeed without accumulating work for an unconfigured generation

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

### Requirement: Backend maintenance is capability-declared
Each vector adapter SHALL declare the maintenance operations it implements and SHALL return an observable `ran`, `already-running`, or `noop` result. Requesting an unsupported operation SHALL fail explicitly rather than silently succeeding.
Supported exclusive maintenance SHALL not execute overlapping exclusive work for one adapter. Conformance SHALL demonstrate a genuinely overlapping request at a controlled work boundary and prove one underlying operation with the documented competing outcome. Already completed and no-op operations SHALL be verified separately rather than accepted by an assertion true for every outcome.

#### Scenario: pgvector HNSW build is requested twice
- **ID**: `memory.semantic.maintenance.pgvector-hnsw-concurrency`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::serializes optional HNSW build and reindex maintenance`
- **WHEN** concurrent callers request the supported index-build operation
- **THEN** one call performs the work and the other reports `already-running` instead of stacking exclusive work

#### Scenario: Unsupported reindex is requested
- **ID**: `memory.semantic.maintenance.unsupported-reindex`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::rejects unsupported maintenance explicitly`
- **WHEN** a backend without an ANN index receives a reindex request
- **THEN** it returns a typed unsupported-maintenance error

#### Scenario: Exclusive maintenance overlaps under a controlled fixture
- **ID**: `memory.semantic.maintenance.controlled-overlap`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::proves one exclusive maintenance operation while a second request overlaps`
- **WHEN** a supported exclusive maintenance operation is held open while a second request reaches the same adapter
- **THEN** exactly one underlying exclusive operation runs and the competing request reports the documented already-running outcome

#### Scenario: Completed maintenance is requested again
- **ID**: `memory.semantic.maintenance.completed-request`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::distinguishes completed and noop maintenance from overlapping work`
- **WHEN** maintenance is requested after the previous operation has observably settled
- **THEN** the adapter returns its declared ran or noop result without falsely reporting an operation still in progress
