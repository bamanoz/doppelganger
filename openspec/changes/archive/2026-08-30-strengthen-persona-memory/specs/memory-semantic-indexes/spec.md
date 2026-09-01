## ADDED Requirements

### Requirement: Semantic services are explicitly composed
Semantic memory SHALL be activated only when a Runtime Preset composes exactly one embedder, exactly one vector index, and the semantic coordinator as ordinary Cordis plugins. Their absence SHALL leave canonical memory and FTS5 available, and duplicate providers in one isolation scope SHALL fail activation.

#### Scenario: No semantic plugins are selected
- **WHEN** a Runtime Preset activates memory without an embedder or vector index
- **THEN** memory activates with lexical retrieval and creates no semantic generation or projection work

#### Scenario: One complete semantic stack is selected
- **WHEN** a Runtime Preset composes one embedder, one vector index, and the semantic coordinator
- **THEN** the Runtime Session exposes semantic retrieval backed by that isolated stack

#### Scenario: Duplicate vector indexes are selected
- **WHEN** two plugins provide the vector-index service in the same Runtime Session scope
- **THEN** composition fails visibly rather than choosing one by load order

### Requirement: Embedder space identity is strict
Every semantic generation SHALL persist an embedder-space identity containing provider, canonical model identifier, immutable model revision or digest, pooling and projection configuration, dimensions, normalization, and distance metric. Existing vectors SHALL NOT be queried or extended when any identity component is incompatible.

#### Scenario: Matching embedder reopens an index
- **WHEN** the configured embedder identity exactly matches the active generation identity
- **THEN** semantic search and incremental projection may use that generation

#### Scenario: Model revision changes
- **WHEN** the configured model revision or digest differs from the active generation
- **THEN** the existing generation remains unchanged and semantic activation requests a rebuild instead of mixing vectors

#### Scenario: Dimensions differ
- **WHEN** an embedder returns a vector whose dimensions differ from its declared identity or target generation
- **THEN** the write fails with a dimension diagnostic and no partial batch is committed

### Requirement: Local multilingual embedding is available
The local embedder plugin SHALL provide a pinned multilingual EmbeddingGemma 300M configuration with normalized 256-dimensional output from an officially supported Matryoshka projection and SHALL provide 384-dimensional all-MiniLM-L6-v2 only as an explicit compatibility selection. Accelerator unavailability SHALL fall back to CPU without changing vector-space identity.

#### Scenario: New multilingual configuration is selected
- **WHEN** a preset configures the default local multilingual model
- **THEN** Russian and English document and query text are embedded in the same declared vector space

#### Scenario: MiniLM compatibility is selected
- **WHEN** a preset explicitly selects all-MiniLM-L6-v2
- **THEN** the generation identity records MiniLM and no existing EmbeddingGemma generation is reused

#### Scenario: Requested accelerator is unavailable
- **WHEN** the configured execution accelerator cannot be loaded
- **THEN** embedding falls back to CPU with a diagnostic and preserves the same model-space identity

### Requirement: Supported vector backend matrix
The semantic subsystem SHALL provide conforming adapters named `sqlite_exact`, `chroma`, `qdrant`, and `pgvector`. Every adapter SHALL accept explicit vectors, perform cosine nearest-neighbor top-K search, support idempotent upsert and deletion by canonical identity, enforce dimensions, isolate Persona Instance generations, report health, and close owned resources.

#### Scenario: SQLite exact is selected
- **WHEN** a preset selects `sqlite_exact`
- **THEN** vectors are stored locally and searched by exact cosine without requiring a separate service or ANN index

#### Scenario: Chroma is selected
- **WHEN** a preset selects `chroma`
- **THEN** the TypeScript adapter connects to the configured Chroma server and supplies explicit document and query embeddings

#### Scenario: Qdrant is selected
- **WHEN** a preset selects `qdrant`
- **THEN** the adapter uses an isolated cosine collection and pushes eligible metadata filters with the query

#### Scenario: pgvector is selected
- **WHEN** a preset selects `pgvector`
- **THEN** the adapter uses an isolated PostgreSQL vector table and exact cosine search unless an explicit supported ANN index has been built

### Requirement: Vector projections are non-authoritative and data-minimized
A vector backend SHALL store only rebuildable projection data and SHALL NOT become authoritative for content, revision state, evidence, conflicts, receipts, temporal state, or deletion state. Projection names and diagnostics SHALL exclude credentials and SHALL use opaque isolated generation identities.

#### Scenario: External index contains a stale document
- **WHEN** an external backend returns projected content for a non-current or missing revision
- **THEN** the content is ignored and canonical SQLite determines the observable result

#### Scenario: Backend target contains credentials
- **WHEN** a connection setting includes an API key or password-bearing DSN
- **THEN** the secret is resolved from an indirect credential reference and is absent from persisted markers, generation fingerprints, errors, and health output

### Requirement: Eligibility filters are portable and revalidated
Every backend SHALL implement the required equality and conjunction filters for Persona Instance, principal, scope, project, status, and generation. Semantic search SHALL push those predicates into the backend and SHALL treat canonical post-search validation as mandatory.

#### Scenario: Project-scoped search runs
- **WHEN** semantic retrieval runs in a project session
- **THEN** the backend query is limited to relationship records for the active persona-principal partition plus records for the active project

#### Scenario: Backend returns an out-of-partition hit
- **WHEN** a faulty or stale backend response identifies another principal, instance, or project
- **THEN** canonical validation discards the hit before ranking or context projection

### Requirement: Projection synchronization is durable and idempotent
Canonical mutations SHALL enqueue identifier-only vector projection work transactionally with the canonical state change. Retrying work SHALL NOT create duplicate vector entries, and a worker SHALL load and verify the current canonical revision immediately before embedding or deletion.

#### Scenario: Active revision is committed
- **WHEN** an explicit record, promoted candidate, or correction becomes the current active revision
- **THEN** deterministic projection work for that record and revision is committed in the same canonical transaction

#### Scenario: Projection delivery repeats
- **WHEN** the same projection work is delivered more than once
- **THEN** the backend converges on one entry with the deterministic identity and reports the work complete once

#### Scenario: Revision changes before queued work runs
- **WHEN** queued upsert work names a revision that is no longer current
- **THEN** the worker does not embed the stale content and converges the backend toward the current canonical state

#### Scenario: Semantic plugins are absent
- **WHEN** canonical memory changes while no semantic stack is active
- **THEN** canonical mutation and FTS5 succeed without accumulating work for an unconfigured generation

### Requirement: Semantic generations rebuild without mixed vector spaces
A rebuild or backend/model change SHALL populate a new isolated generation from deterministic pages of canonical current eligible revisions, verify it, and switch the local active-generation pointer only after successful completion. Failure SHALL leave the previous generation active.

#### Scenario: Rebuild succeeds
- **WHEN** every canonical active revision is projected and generation verification passes
- **THEN** the new generation becomes active atomically and old-generation cleanup becomes retryable maintenance

#### Scenario: Rebuild is interrupted
- **WHEN** embedding or backend writing fails before generation verification
- **THEN** searches continue using the previous generation and do not query the incomplete generation

#### Scenario: Backend selection changes
- **WHEN** a preset changes from one vector backend to another
- **THEN** the new backend is rebuilt from canonical memory rather than copying the former backend's vectors or state

### Requirement: Semantic failure is contained and observable
Embedder and vector-index operations SHALL use bounded deadlines. Timeout, health failure, malformed results, dimension mismatch, and backend exceptions SHALL be contained so lexical memory remains usable, while sanitized health state records the failure category and time.

#### Scenario: Vector search times out
- **WHEN** semantic search exceeds its configured deadline
- **THEN** the current recall completes from lexical candidates and semantic health reports a timeout without query or memory content

#### Scenario: Backend recovers
- **WHEN** a later health check and semantic query succeed after a recorded failure
- **THEN** semantic retrieval resumes without restarting canonical memory and health reports recovery

### Requirement: Backend maintenance is capability-declared
Each vector adapter SHALL declare the maintenance operations it implements and SHALL return an observable `ran`, `already-running`, or `noop` result. Requesting an unsupported operation SHALL fail explicitly rather than silently succeeding.

#### Scenario: SQLite exact compact is requested
- **WHEN** the selected local exact backend supports compaction and no competing compaction is running
- **THEN** it performs or reports unnecessary compaction with an observable result

#### Scenario: pgvector HNSW build is requested twice
- **WHEN** concurrent callers request the supported index-build operation
- **THEN** one call performs the work and the other reports `already-running` instead of stacking exclusive work

#### Scenario: Unsupported reindex is requested
- **WHEN** a backend without an ANN index receives a reindex request
- **THEN** it returns a typed unsupported-maintenance error

### Requirement: Semantic diagnostics are bounded and secret-free
The memory tool surface SHALL report backend kind, sanitized target, embedder-space identity, active generation, current/indexed/stale/missing counts, pending projection and deletion counts, last failure category and time, and supported maintenance operations. It SHALL NOT expose credentials, vectors, memory content, or query content.

#### Scenario: Operator inspects semantic status
- **WHEN** the semantic status tool is invoked
- **THEN** it returns bounded operational metadata sufficient to identify lag, mismatch, and backend failure without exposing protected content

### Requirement: All vector adapters satisfy one conformance contract
Every supported adapter SHALL pass shared behavior checks for isolation, dimensions, deterministic ordering, filter semantics, top-K search, idempotent writes, deletion, health, lifecycle closure, and declared maintenance. Each server-backed adapter SHALL additionally have a real service smoke scenario.

#### Scenario: Adapter returns equal-distance hits
- **WHEN** two eligible vectors have equal cosine distance
- **THEN** the adapter applies the contract's stable canonical-identity tie break

#### Scenario: Adapter is disposed
- **WHEN** its Cordis scope is disposed
- **THEN** owned database handles, clients, timers, and workers close before temporary or instance resources are released

#### Scenario: Real server smoke runs
- **WHEN** the required Chroma, Qdrant, or PostgreSQL service is available to its backend smoke fixture
- **THEN** create, upsert, filtered search, delete, and teardown complete through the production client path
