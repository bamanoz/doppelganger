## ADDED Requirements

### Requirement: Local embedder acquisition is transactional
The local embedder SHALL retain a newly loaded runtime as a private acquisition candidate until post-load artifact validation succeeds and the embedder is still open. Validation failure, loader failure after candidate creation, or close winning the race SHALL close the candidate exactly once and SHALL NOT publish it as active.

#### Scenario: Validation fails after runtime load
- **WHEN** a local embedding runtime loads successfully but post-load artifact validation fails
- **THEN** the candidate runtime is closed exactly once and the embedder reports the validation/load failure without retaining active runtime state

#### Scenario: Close wins during acquisition
- **WHEN** `close()` is requested while runtime acquisition is pending and the loader later resolves
- **THEN** the late runtime self-disposes, no active runtime is published, and subsequent embedding requests reject as closed

### Requirement: Vector backend initialization commits atomically
A vector adapter SHALL keep newly loaded runtime, client, pool, collection, schema, and table state private until all required initialization operations succeed and the adapter is still open. Failure or late close SHALL release every owned candidate and SHALL NOT publish partially initialized state.

#### Scenario: pgvector closes while runtime loading
- **WHEN** pgvector runtime loading is delayed, adapter close completes, and the loader later resolves
- **THEN** no runtime or pool is published, any subsequently created pool is ended exactly once, and later operations reject as closed

#### Scenario: Qdrant closes during collection inspection
- **WHEN** collection metadata retrieval is pending while the adapter closes
- **THEN** the adapter does not mark the collection initialized and closes any owned late client

### Requirement: Transient client construction remains retryable
A failed lazy client-construction attempt SHALL clear its cached in-flight state unless the adapter is closed. A later operation MAY retry construction and SHALL use only one shared attempt at a time.

#### Scenario: First Qdrant client construction fails
- **WHEN** the first dynamic import or client factory attempt rejects transiently and the adapter remains open
- **THEN** the failure is reported for that operation and a later operation can create a fresh client successfully

#### Scenario: Concurrent retry callers arrive
- **WHEN** multiple operations retry after the failed attempt
- **THEN** they share one new client-construction promise rather than creating duplicate owned clients

## MODIFIED Requirements

### Requirement: All vector adapters satisfy one conformance contract
Every supported adapter SHALL pass shared behavior checks for isolation, dimensions, deterministic ordering, filter semantics, top-K search, idempotent writes, deletion, health, lifecycle closure, retryable initialization where applicable, and declared maintenance. Each server-backed adapter SHALL additionally have a real service smoke scenario.

#### Scenario: Adapter returns equal-distance hits
- **WHEN** two eligible vectors have equal cosine distance
- **THEN** the adapter applies the contract's stable canonical-identity tie break

#### Scenario: Adapter is disposed after initialization
- **WHEN** its Cordis scope is disposed after initialization completes
- **THEN** owned database handles, clients, timers, and workers close before temporary or instance resources are released

#### Scenario: Adapter is disposed during initialization
- **WHEN** disposal races an awaited runtime, client, metadata, schema, or table initialization step
- **THEN** no late resource becomes active, every owned candidate is closed, and repeated close remains idempotent

#### Scenario: Real server smoke runs
- **WHEN** the required Chroma, Qdrant, or PostgreSQL service is available to its backend smoke fixture
- **THEN** create, upsert, filtered search, delete, and teardown complete through the production client path
