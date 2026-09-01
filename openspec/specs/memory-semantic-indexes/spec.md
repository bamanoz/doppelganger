# Memory Semantic Indexes Specification

## Purpose

Defines optional semantic embedding and vector-index services as derived, non-authoritative extensions over canonical Persona memory and lexical retrieval.

## Requirements

### Requirement: Embedder space identity is strict
Every semantic generation SHALL persist an embedder-space identity containing provider, canonical model identifier, immutable model revision or digest, pooling and projection configuration, dimensions, normalization, and distance metric. Existing vectors SHALL NOT be queried or extended when any identity component is incompatible.

#### Scenario: Model revision changes
- **ID**: `memory.semantic.identity.revision-mismatch-rebuild`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::rebuilds q8/384 from canonical content and atomically retains the q4/256 generation`
- **WHEN** the configured model revision or digest differs from the active generation
- **THEN** the existing generation remains unchanged and semantic activation requests a rebuild instead of mixing vectors

#### Scenario: Dimensions differ
- **ID**: `memory.semantic.identity.dimension-mismatch-atomicity`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::rejects malformed input and output dimensions`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::rejects dimension mismatches before committing partial batches and persists across restart`
- **WHEN** an embedder returns a vector whose dimensions differ from its declared identity or target generation
- **THEN** the write fails with a dimension diagnostic and no partial batch is committed

### Requirement: Local multilingual embedding is available
The local embedder plugin SHALL provide a pinned multilingual EmbeddingGemma 300M configuration using the repository's verified q8 ONNX artifact set with normalized 384-dimensional output produced by truncating the model's 768-dimensional sentence embedding to the supported 384-dimensional Matryoshka width and re-normalizing it. It SHALL provide 384-dimensional all-MiniLM-L6-v2 only as an explicit compatibility selection. Accelerator unavailability SHALL fall back to CPU without changing vector-space identity. The selected EmbeddingGemma artifact paths, byte sizes, SHA-256 values, model revision, artifact digest, pooling, projection, dimensions, normalization, and cosine metric SHALL be immutable and covered by contract tests.

#### Scenario: q8 artifacts are selected
- **ID**: `memory.semantic.embedder.q8-artifact-validation`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::reports offline and corrupt model caches without invoking the runtime`
- **WHEN** the EmbeddingGemma model is acquired from the pinned revision
- **THEN** the loader requests q8 execution and validates the q8 artifact set by exact path, byte count, and SHA-256 before publishing the runtime

#### Scenario: Legacy q4/256 cache is present
- **ID**: `memory.semantic.embedder.legacy-q4-cache-rejected`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::does not accept legacy q4 artifacts as the q8 profile cache`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::reports offline and corrupt model caches without invoking the runtime`
- **WHEN** a cache contains only the prior q4 artifacts or the configured artifact metadata does not match q8
- **THEN** acquisition does not treat that cache as a valid q8/384 runtime and reports the existing offline or corrupt-cache diagnostic according to cache availability

#### Scenario: MiniLM compatibility is selected
- **ID**: `memory.semantic.embedder.minilm-isolation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-semantic-contracts.spec.ts::assigns distinct embedder and generation identities to q4/256, q8/384, and MiniLM`
- **WHEN** a preset explicitly selects all-MiniLM-L6-v2
- **THEN** the generation identity records MiniLM and no existing EmbeddingGemma generation is reused

#### Scenario: Requested accelerator is unavailable
- **ID**: `memory.semantic.embedder.accelerator-cpu-fallback`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::falls back to CPU without changing vector-space identity`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::closes a failed accelerator candidate before CPU fallback begins`
- **WHEN** the configured execution accelerator cannot be loaded
- **THEN** embedding falls back to CPU with a diagnostic and preserves the same q8/384 model-space identity

### Requirement: Supported vector backend matrix
The semantic subsystem SHALL provide conforming adapters named `sqlite_exact`, `chroma`, `qdrant`, and `pgvector`. Every adapter SHALL accept explicit vectors, perform cosine nearest-neighbor top-K search, support idempotent upsert and deletion by canonical identity, enforce dimensions, isolate Persona Instance generations, report health, and close owned resources.

#### Scenario: SQLite exact is selected
- **ID**: `memory.semantic.backend.sqlite-exact`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::upserts idempotently and returns deterministic cosine top-K with filters`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::rejects dimension mismatches before committing partial batches and persists across restart`
- **WHEN** a preset selects `sqlite_exact`
- **THEN** vectors are stored locally and searched by exact cosine without requiring a separate service or ANN index

#### Scenario: Chroma is selected
- **ID**: `memory.semantic.backend.chroma`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::uses explicit vectors, generation collections, portable filters, and deterministic ordering`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.smoke.spec.ts::creates, writes, filters, deletes, and cleans a server collection`
- **WHEN** a preset selects `chroma`
- **THEN** the TypeScript adapter connects to the configured Chroma server and supplies explicit document and query embeddings

#### Scenario: Qdrant is selected
- **ID**: `memory.semantic.backend.qdrant`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::creates cosine collection, filters payload, and converges idempotent writes/deletes`
- **WHEN** a preset selects `qdrant`
- **THEN** the adapter uses an isolated cosine collection and pushes eligible metadata filters with the query

#### Scenario: pgvector is selected
- **ID**: `memory.semantic.backend.pgvector`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::uses hashed quoted storage names, explicit vectors, and idempotent parameterized mutations`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::performs exact cosine search with portable filters and deterministic tie ordering`
- **WHEN** a preset selects `pgvector`
- **THEN** the adapter uses an isolated PostgreSQL vector table and exact cosine search unless an explicit supported ANN index has been built

### Requirement: Vector projections are non-authoritative and data-minimized
A vector backend SHALL store only rebuildable projection data and SHALL NOT become authoritative for content, revision state, evidence, conflicts, receipts, temporal state, or deletion state. Projection names and diagnostics SHALL exclude credentials and SHALL use opaque isolated generation identities.

#### Scenario: External index contains a stale document
- **ID**: `memory.semantic.projection.stale-content-revalidation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::revalidates record and revision identity after asynchronous semantic ranking`
- **WHEN** an external backend returns projected content for a non-current or missing revision
- **THEN** the content is ignored and canonical SQLite determines the observable result

#### Scenario: Backend target contains credentials
- **ID**: `memory.semantic.credentials.indirect-and-redacted`
- **EVIDENCE**: `packages/extension-memory/tests/memory-semantic-contracts.spec.ts::uses deterministic identifiers and excludes undeclared secrets and device settings`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::does not expose an indirect credential in identity or failures`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::fails lazily when the indirect DSN is absent and rejects credential-bearing diagnostics`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::rejects dimensions before writing and exposes deterministic UUID IDs without credentials`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::registers sanitized status, rebuild, rollback, and maintenance tools`
- **WHEN** a connection setting includes an API key or password-bearing DSN
- **THEN** the secret is resolved from an indirect credential reference and is absent from persisted markers, generation fingerprints, errors, and health output

### Requirement: Eligibility filters are portable and revalidated
Every backend SHALL implement the required equality and conjunction filters for Persona Instance, actor, scope, project, status, and generation. Semantic search SHALL push those predicates into the backend and SHALL treat canonical post-search validation as mandatory.

#### Scenario: Project-scoped search runs
- **ID**: `memory.semantic.filters.project-scope`
- **EVIDENCE**: `packages/extension-memory/tests/memory-retrieval-corpus.spec.ts::observes lexical-only behavior and hybrid revalidation across every corpus query`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::creates cosine collection, filters payload, and converges idempotent writes/deletes`
- **WHEN** semantic retrieval runs in a project session
- **THEN** the backend query is limited to relationship records for the active Persona-actor partition plus records for the active project

#### Scenario: Backend returns an out-of-partition hit
- **ID**: `memory.semantic.filters.out-of-partition-revalidation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::drops out-of-scope and malformed semantic hits without failing lexical recall`
- **WHEN** a faulty or stale backend response identifies another actor, instance, or project
- **THEN** canonical validation discards the hit before ranking or context projection

### Requirement: Projection synchronization is durable and idempotent
Canonical mutations SHALL enqueue identifier-only vector projection work transactionally with the canonical state change. Retrying work SHALL NOT create duplicate vector entries, and a worker SHALL load and verify the current canonical revision immediately before embedding or deletion.

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

### Requirement: Semantic generations rebuild without mixed vector spaces
A rebuild or backend/model change SHALL populate a new isolated generation from deterministic pages of canonical current eligible revisions, verify it, and switch the local active-generation pointer only after successful completion. Changing EmbeddingGemma from q4/256 to q8/384 SHALL always produce a distinct generation identity. The coordinator SHALL rebuild from canonical memory and SHALL NOT copy, reinterpret, resize, or query vectors from the incompatible q4/256 generation. Failure SHALL leave the previous generation active.

#### Scenario: q8/384 rebuild succeeds
- **ID**: `memory.semantic.generation.q8-rebuild-atomic-activation`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::rebuilds q8/384 from canonical content and atomically retains the q4/256 generation`
- **WHEN** the configured EmbeddingGemma identity changes from q4/256 to q8/384 and every canonical active revision is projected and generation verification passes
- **THEN** the q8/384 generation becomes active atomically, the q4/256 generation remains isolated as retained or failed historical state, and semantic queries use only q8/384 vectors

#### Scenario: q8/384 rebuild is interrupted
- **ID**: `memory.semantic.generation.interrupted-rebuild-isolation`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::keeps q4/256 active across an incomplete q8/384 rebuild and retries from canonical state`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::keeps the active generation on a failed rebuild and closes after in-flight work`
- **WHEN** q8/384 embedding or backend writing fails before generation verification
- **THEN** searches continue using the previous q4/256 generation and do not query the incomplete q8/384 generation

### Requirement: Semantic failure is contained and observable
Embedder and vector-index operations SHALL use bounded deadlines. Timeout, health failure, malformed results, dimension mismatch, and backend exceptions SHALL be contained so lexical memory remains usable, while sanitized health state records the failure category and time.

#### Scenario: Vector search times out
- **ID**: `memory.semantic.failure.timeout-lexical-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::contains semantic timeout and provider exceptions`
- **WHEN** semantic search exceeds its configured deadline
- **THEN** the current recall completes from lexical candidates and semantic health reports a timeout without query or memory content

#### Scenario: Backend recovers
- **ID**: `memory.semantic.failure.backend-recovery`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::contains partial responses, recovers health, and rejects operations after disposal`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::contains malformed responses, recovers availability, and rejects operations after disposal`
- **WHEN** a later health check and semantic query succeed after a recorded failure
- **THEN** semantic retrieval resumes without restarting canonical memory and health reports recovery

### Requirement: Backend maintenance is capability-declared
Each vector adapter SHALL declare the maintenance operations it implements and SHALL return an observable `ran`, `already-running`, or `noop` result. Requesting an unsupported operation SHALL fail explicitly rather than silently succeeding.

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

### Requirement: Semantic diagnostics are bounded and secret-free
The memory tool surface SHALL report backend kind, sanitized target, embedder-space identity, active generation, current/indexed/stale/missing counts, pending projection and deletion counts, last failure category and time, and supported maintenance operations. It SHALL NOT expose credentials, vectors, memory content, or query content.

#### Scenario: Operator inspects semantic status
- **ID**: `memory.semantic.diagnostics.bounded-status`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::rebuilds deterministic pages, drains queued projections, and reports status without content`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/coordinator.spec.ts::registers sanitized status, rebuild, rollback, and maintenance tools`
- **WHEN** the semantic status tool is invoked
- **THEN** it returns bounded operational metadata sufficient to identify lag, mismatch, and backend failure without exposing protected content

### Requirement: Local embedder acquisition is transactional
The local embedder SHALL retain a newly loaded runtime as a private acquisition candidate until post-load artifact validation succeeds and the embedder is still open. Validation failure, loader failure after candidate creation, or close winning the race SHALL close the candidate exactly once and SHALL NOT publish it as active.

#### Scenario: Validation fails after runtime load
- **ID**: `memory.semantic.embedder.validation-failure-disposal`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::closes a loaded candidate when post-load artifact validation fails`
- **WHEN** a local embedding runtime loads successfully but post-load artifact validation fails
- **THEN** the candidate runtime is closed exactly once and the embedder reports the validation/load failure without retaining active runtime state

#### Scenario: Close wins during acquisition
- **ID**: `memory.semantic.embedder.close-during-acquisition`
- **EVIDENCE**: `packages/extension-embedding-local/tests/local-embedder.spec.ts::closes a late runtime exactly once when close wins acquisition`
- **WHEN** `close()` is requested while runtime acquisition is pending and the loader later resolves
- **THEN** the late runtime self-disposes, no active runtime is published, and subsequent embedding requests reject as closed

### Requirement: Vector backend initialization commits atomically
A vector adapter SHALL keep newly loaded runtime, client, pool, collection, schema, and table state private until all required initialization operations succeed and the adapter is still open. Failure or late close SHALL release every owned candidate and SHALL NOT publish partially initialized state.

#### Scenario: pgvector closes while runtime loading
- **ID**: `memory.semantic.pgvector.close-during-runtime-load`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::waits for delayed runtime acquisition to settle before close completes`
- **WHEN** pgvector runtime loading is delayed, adapter close completes, and the loader later resolves
- **THEN** no runtime or pool is published, any subsequently created pool is ended exactly once, and later operations reject as closed

#### Scenario: Qdrant closes during collection inspection
- **ID**: `memory.semantic.qdrant.close-during-metadata`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::does not commit collection readiness when close wins metadata validation`
- **WHEN** collection metadata retrieval is pending while the adapter closes
- **THEN** the adapter does not mark the collection initialized and closes any owned late client

### Requirement: Transient client construction remains retryable
A failed lazy client-construction attempt SHALL clear its cached in-flight state unless the adapter is closed. A later operation MAY retry construction and SHALL use only one shared attempt at a time.

#### Scenario: First Qdrant client construction fails
- **ID**: `memory.semantic.qdrant.transient-client-retry`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::retries one shared client construction after a transient factory rejection`
- **WHEN** the first dynamic import or client factory attempt rejects transiently and the adapter remains open
- **THEN** the failure is reported for that operation and a later operation can create a fresh client successfully

#### Scenario: Concurrent retry callers arrive
- **ID**: `memory.semantic.qdrant.shared-retry-construction`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::retries one shared client construction after a transient factory rejection`
- **WHEN** multiple operations retry after the failed attempt
- **THEN** they share one new client-construction promise rather than creating duplicate owned clients

### Requirement: All vector adapters satisfy one conformance contract
Every supported adapter SHALL pass shared behavior checks for isolation, dimensions, deterministic ordering, filter semantics, top-K search, idempotent writes, deletion, health, lifecycle closure, retryable initialization where applicable, and declared maintenance. Each server-backed adapter SHALL additionally have a real service smoke scenario.

#### Scenario: Adapter returns equal-distance hits
- **ID**: `memory.semantic.adapter.deterministic-distance-tie`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::uses explicit vectors, generation collections, portable filters, and deterministic ordering`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::performs exact cosine search with portable filters and deterministic tie ordering`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::upserts idempotently and returns deterministic cosine top-K with filters`
- **WHEN** two eligible vectors have equal cosine distance
- **THEN** the adapter applies the contract's stable canonical-identity tie break

#### Scenario: Adapter is disposed after initialization
- **ID**: `memory.semantic.adapter.dispose-after-initialization`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.spec.ts::deletes idempotently, cleans a generation, and closes its client`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::reports exact counts and closes idempotently`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::contains malformed responses, recovers availability, and rejects operations after disposal`
- **WHEN** its Cordis scope is disposed after initialization completes
- **THEN** owned database handles, clients, timers, and workers close before temporary or instance resources are released

#### Scenario: Adapter is disposed during initialization
- **ID**: `memory.semantic.adapter.dispose-during-initialization`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::waits for delayed runtime acquisition to settle before close completes`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::ends a setup candidate once when close wins during schema initialization`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::closes a late owned client once when close wins client construction`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.spec.ts::does not commit collection readiness when close wins metadata validation`
- **WHEN** disposal races an awaited runtime, client, metadata, schema, or table initialization step
- **THEN** no late resource becomes active, every owned candidate is closed, and repeated close remains idempotent

#### Scenario: Real server smoke runs
- **ID**: `memory.semantic.adapter.real-server-smoke`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/chroma.smoke.spec.ts::creates, writes, filters, deletes, and cleans a server collection`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.smoke.spec.ts::creates, upserts, filters, searches, deletes, and closes`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/qdrant.real.spec.ts::creates, upserts, filters, deletes, and tears down through the official client`
- **WHEN** the required Chroma, Qdrant, or PostgreSQL service is available to its backend smoke fixture
- **THEN** create, upsert, filtered search, delete, and teardown complete through the production client path
