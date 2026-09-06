## Context

The baseline is the implemented canonical schema v4 at `90ddf212eedcb9f73a9b929f54e9a771012ff934`, not the unimplemented schema proposed by `advance-memory-context-engine`. `extension-memory/src/service.ts` combines domain policy, synchronous SQLite SQL, receipts, FTS5, and final canonical validation. `Context.doppelgangerMemory` is typed as the concrete `MemoryService`; its `projectionStore` is also a concrete synchronous class. The independent embedder/vector interfaces are already replaceable, but a `pgvector` projection is not canonical PostgreSQL memory.

The user requires two working persistence implementations now: retain local SQLite and enable multiple trusted agent plugins to use a shared PostgreSQL database directly. No Obsidian, GitHub, or extra memory HTTP server belongs to this change. Database credentials belong to plugin code, never to model-invocable SQL tools. Existing `(instanceId, actorId)` and project/relationship authorization remains intact.

Current ownership comes from `docs/features/memory.md`, `docs/operations/semantic-memory.md`, `docs/operations/configuration.md`, `docs/operations/verification.md`, and `docs/architecture/overview.md`. Generic `extension-sqlite` remains a separate infrastructure service used by Evolution; the vector `sqlite_exact` adapter also retains its independent storage implementation.

## Goals / Non-Goals

**Goals:**

- Ship complete MikroORM-backed SQLite and PostgreSQL canonical providers in one change, with identical domain contracts and mandatory tests on both real engines.
- Keep one implementation of memory policy behind a narrow, asynchronous, memory-owned persistence boundary.
- Preserve all observable mutation, capture, recall, privacy, migration, semantic generation, maintenance, and failure behavior unless an explicitly documented backend-independent clarification is necessary.
- Make successful writes immediately available to a subsequent read in another authorized plugin without process restart, local replication, or long-lived ORM caches.
- Preserve existing SQLite data and provide an explicit, verifiable SQLite/PostgreSQL transfer in either direction.

**Non-Goals:**

- An arbitrary-SQL/NoSQL portability framework, additional canonical backends, a custom dependency-injection or lifecycle system, or a memory-specific host transport.
- Git/vault synchronization, an agent-facing SQL tool, a memory daemon, cross-Persona sharing policy, new host events, or rewriting unrelated SQLite consumers.
- Bit-identical lexical scores between FTS5 and PostgreSQL, replication/failover infrastructure, or changing an already-submitted LLM request when memory changes.
- Implementing the pending progressive-context/extraction/checkpoint features of `advance-memory-context-engine`.

## Decisions

### 1. Separate domain operations from transactional persistence, not business rules by backend

Keep `MemoryService` as the sole owner of remember/propose, correction, candidate promotion/rejection, evidence, conflict resolution, pinning, deletion, retrieval fusion, and context-selection policy. Extract its DTOs and asynchronous consumer-facing contract into memory-owned modules. Both local SQLite and PostgreSQL plugins implement `MemoryRepository`; they do not implement independent copies of those policies.

The repository has explicit domain-oriented reads and a transaction callback receiving a bounded `MemoryUnitOfWork`: partition lookup, subject reconciliation reads, receipts, revision/evidence/conflict persistence, canonical state transitions, lexical maintenance, and projection-outbox operations. A unit of work cannot be retained or used after its transaction settles. Repository reads return detached immutable DTOs, not managed entities, lazy collections, EntityManager, query builders, raw connections, or driver statement objects.

Keep common entity mappings and ordinary CRUD/query code shared. Only dialect-specific search, locking, conflict-safe inserts, schema DDL, and connection initialization belong in the two concrete adapters. Do not create a generic CRUD repository per table or a new framework for all Doppelganger persistence.

All domain methods observed through `doppelgangerMemory` become awaitable consistently. All persistence paths use the same abstraction; retaining a second legacy SQLite execution path would make SQLite conformance meaningless. Internal adapters may use explicit MikroORM SQL/driver facilities when necessary, but only inside the owning repository transaction.

Alternative rejected: two `MemoryService` implementations with duplicated policies. Alternative rejected: wrapping `InstanceSqliteDatabase` in Promise-returning methods; it still exposes SQLite statements and fails to model PostgreSQL isolation or asynchronous snapshots.

### 2. Use verified MikroORM drivers without adding a second native SQLite runtime

The researched baseline is MikroORM `7.1.15`, with matching `@mikro-orm/core`, `@mikro-orm/sql`, and `@mikro-orm/postgresql` versions. Registry metadata reports Node `>=22.17.0`, compatible with the repository's Node 26 requirement. `@mikro-orm/sql` provides `SqliteDriver` and `NodeSqliteDialect`; the PostgreSQL package provides the PostgreSQL driver and uses `pg`.

Use explicit internal entity schemas rather than introducing decorators, reflection metadata, framework integrations, or compiler-mode changes. Keep SQL table/column names and opaque IDs stable where possible. Use the owning workspace's declared dependencies and one resolved compatible ORM core; do not borrow dependencies from the vector package. Lock resolved versions and run `npm run check:security` during implementation.

Use PostgreSQL 17 as the initial real-server conformance baseline. Do not claim other server majors without evidence. The canonical provider requires ordinary PostgreSQL only: no `vector` extension, embedding model, or external vector service is required to remember, search lexically, or delete.

Primary research, consulted 2026-09-05:

- https://mikro-orm.io/docs/usage-with-sqlite — generic `node:sqlite` driver and explicit distinction from `better-sqlite3` and libSQL.
- https://mikro-orm.io/docs/transactions — explicit transaction demarcation, flush/commit behavior, and transaction propagation.
- https://mikro-orm.io/docs/identity-map — independent EntityManager forks for independent operations.
- https://registry.npmjs.org/@mikro-orm/postgresql/7.1.15 — concrete published driver, aligned peer dependency and runtime prerequisites.

These are compatibility inputs, not proof that the new repository works; actual driver/transaction behavior is an implementation acceptance gate.

### 3. Select a repository with native Cordis composition

Add public Loader subpaths `@doppelganger/doppelganger-memory/sqlite` and `@doppelganger/doppelganger-memory/postgresql`. Both provide `doppelgangerMemoryRepository`; exactly one provider may occupy the memory session's isolation realm. The common memory row injects this interface plus the existing actor, Persona, context, and tools services. Provider rows must also require a bound actor before opening a database and use the matching session isolation realm.

SQLite provider configuration owns an absolute `home`, optional `namespace` defaulting to `memory`, and bounded busy timeout. It retains `<home>/storage/<namespace>.sqlite`, foreign keys, WAL, and the current documented durability profile. Migrate the old memory `namespace` field to this row. Existing data must not move simply because the implementation changes.

PostgreSQL provider configuration owns `connectionStringEnv`, an explicit validated dedicated `schema`, bounded pool size, connection/statement/lock deadlines, and verified transport settings. Resolve the DSN only from the named environment variable. Omit absent optional fields; reject unknown fields and unsafe identifiers. Never log the resolved DSN, SQL parameters, personal records, or raw server errors. Never disable certificate verification to make initialization pass; remote deployments use authenticated TLS or an operator-secured network.

Selecting PostgreSQL must neither inject generic instance-SQLite solely for memory nor create a local canonical memory file. SQLite remains the backend used in maintained local examples, but there is no silent fallback from failed PostgreSQL to SQLite. The shipped `standard` preset remains memory-free.

Migrate every maintained Loader row, test composition, export, caller, and documentation example in one clean cutover. Keep unrelated Evolution and vector SQLite services unchanged. No backend field enters Runtime Session metadata, runtime-owned configuration, the project selection manifest, or `host-omp`.

### 4. Preserve one atomic command boundary and prove actual locking

A successful domain command commits its record/current pointer, revision lineage, evidence/candidate joins, conflicts, receipt, lexical index changes, and projection/deletion work together. Flushes are implementation details; they cannot expose half a command. Every helper uses the transaction's actual connection and EntityManager, including dialect SQL and outbox writes. No independently committed nested transaction or external embedding/network operation is allowed inside that boundary.

SQLite must preserve an immediate write reservation equivalent to the existing `BEGIN IMMEDIATE`, not a read-then-deferred-write sequence. The first implementation task must prove the chosen MikroORM/NodeSqliteDialect transaction path on the actual released packages. If explicit transaction control is needed, implement it privately on the same repository connection and verify rollback; do not weaken the contract or fall back to the old non-ORM engine.

PostgreSQL serializes conflicting domain mutations with a transaction-owned partition lock row keyed by `(instanceId, actorId)`. Create the lock row conflict-safely, acquire it before reading receipts or subject competitors, and retain it through commit. This deliberately matches the existing serialized mutation model rather than relying on an ORM identity map or process mutex. Partition lock rows contain identifiers only and must survive record deletion. Use a deterministic lock order for operations also touching generation state.

Check the existing receipt before revision/subject preconditions so an exact retry does not fail merely because the original request succeeded. Preserve the current observable replay behavior: receipt replays reload the current authorized record, not a frozen historical response; a changed digest fails, and forgotten results remain non-resurrecting. CAS on the expected current revision remains explicit. Concurrent first creation of a subject and concurrent reuse of an operation ID must produce one coherent winner and the documented competing outcome.

A connection failure with uncertain commit outcome must not be reported as proven rollback. Retrying the same operation ID and identical payload must determine or replay the durable outcome without duplicates. Do not add unbounded transparent retries.

### 5. Scope ORM identity maps to operations and preserve coherent reads

Use a new explicit EntityManager fork per public read or command. Reuse the transaction fork only inside its unit of work. Disable shared result caching for canonical visibility and never retain managed records across tool calls, capture operations, or context resolutions. Bulk reads return only the data needed for the operation; do not materialize all history during ordinary recall.

Canonical reads go to the writable primary, not a lagging replica. When B starts a read after A has received successful commit acknowledgment, B sees that committed state subject to current authorization and any later committed changes. On one host, file-backed SQLite provides the corresponding visibility across independent processes opening the same local database. PostgreSQL provides it across machines. Separate SQLite files are not synchronized by this feature.

Do not hold a database snapshot or lock while awaiting embeddings or vector services. Search gathers candidates, awaits optional external work, and then performs one bounded final canonical read transaction that reloads candidate/current revision rows and the active generation coherently. PostgreSQL uses a fresh repeatable-read snapshot for this final multi-row validation; SQLite uses its coherent local read transaction. Ordering, authority and the final whole-record budget are computed from detached rows without further I/O. This replaces the currently synchronous no-await implementation with an explicit snapshot boundary, not a sequence of unrelated per-record network reads.

A correction/deletion committed before the final snapshot must invalidate old hits. A commit after that snapshot is visible on the next operation; the system cannot promise that data never changes after a result is read. Database unavailability fails explicitly rather than returning an unvalidated stale memory cache. Optional semantic failure still preserves canonical lexical/stable-profile retrieval when the canonical database is healthy.

`LISTEN/NOTIFY` is not required for this contract because every operation reads current canonical state. This change does not claim unsolicited context injection or durable notification delivery. Add a separate invalidation protocol only if a future consumer introduces retained state requiring it.

### 6. Make lexical search a small explicit dialect capability

SQLite retains its FTS5 `unicode61` index and BM25 ranking. PostgreSQL stores an indexed `tsvector` derived from the current canonical text and uses native full-text query/ranking with a fixed `simple` configuration, avoiding implicit English stemming for the existing multilingual corpus. Keep the same complete lexical query input and OR-style candidate semantics; technical identifiers, Russian/English text, Unicode and punctuation are mandatory corpus cases.

Update lexical projection in the same transaction as canonical activation, correction, rejection, and deletion. PostgreSQL uses native database indexing, not a local SQLite sidecar, an unbounded `LIKE` scan, or optional pgvector. Return rank-oriented candidates with deterministic record-ID tie-breaks. Domain fusion still uses ranks rather than adding backend-specific scores.

Tokenizers and lexical scores are not numerically equivalent. Conformance proves isolation, required retrieval cases, complete-query preservation, stable ties, bounded top-K behavior and shared fusion/budget rules. Do not weaken an existing corpus assertion merely to make PostgreSQL pass; address tokenization differences in the dialect adapter or document a deliberate, reviewed contract change before implementation acceptance.

### 7. Keep projection persistence bounded, asynchronous and shared-database safe

Convert `MemoryProjectionStore` into a memory-owned asynchronous bounded interface implemented using the selected repository, retaining ownership of queue, receipt, generation, status-count, and post-I/O validation operations. Keep it separate from public agent commands. The coordinator receives no ORM entity, raw database, or unrestricted transaction escape hatch.

Every job carries sufficient durable identity to route it to its canonical store, Persona Instance, generation, embedder and vector destination. Claims filter by that ownership. A worker cannot consume arbitrary global work and send it to its own configured backend. Deletion routing retains identifier-only destination/generation information after the source record disappears.

Lease claims, renewals, retries and acknowledgments use a unique ownership token and bounded expiry; an expired owner cannot acknowledge or remove work reclaimed by another worker. Claim and generation-maintenance serialization use actual database transactions/locks, not only `workerBusy` or `rebuildPromise` in one process. Lock order is fixed and tested across mutation, lease and generation paths.

The active-generation pointer remains durable per canonical Persona Instance. Compatible coordinators may share work; incompatible model/backend owners cannot silently replace or process each other's generation. Automatic activation attaches only to a compatible committed generation; incompatible replacement needs the explicit serialized maintenance path. Rebuild, verify, activate, rollback and retained-generation cleanup compare and update durable state under one transition boundary.

Preserve all vector adapters and semantic tools: status, rebuild, rollback and maintenance. Canonical PostgreSQL selection must work with no semantic stack and with independently selected semantic implementations. A process-local `sqlite_exact` destination is local, not magically shared because canonical memory is PostgreSQL; prevent different machine-local destinations from claiming the same generation identity. Tests must demonstrate correct routing or explicit incompatibility, not silent missing-vector results.

### 8. Own schema evolution and backend transfer explicitly

Keep memory migrations internal to the selected provider. Do not run global schema synchronization or destructive ORM schema generation at ordinary activation. Initialize a new store and migrate a supported store under a database-wide migration lock; validate the expected schema fingerprint before publishing the repository. Concurrent startup must not apply one migration twice or expose partially initialized tables.

This change owns logical canonical schema v5 on both providers. SQLite adoption recognizes populated v1/v2/v3/v4 stores, retains the existing actor migration rules and canonical identifiers/receipts, and migrates them transactionally to v5. PostgreSQL has its own versioned DDL history and bootstraps the same logical v5 model. Unknown/newer schemas fail safely. The dependent `advance-memory-context-engine` change starts at v6 after this backend contract; it does not reserve a second v5.

Keep application and migration privileges documented separately. An operator-controlled migration step may use DDL privileges; normal agents must not receive superuser credentials or arbitrary schema-management tools. Direct database credentials are a trust boundary: domain filters protect normal plugin operations, not a malicious process with unrestricted SQL access. Do not claim backend choice adds adversarial tenant isolation.

Provide an operator-only offline `memory:transfer` command for SQLite-to-PostgreSQL and PostgreSQL-to-SQLite. It requires all source writers/coordinators to be stopped, reads a consistent source snapshot, validates the destination is empty/compatible, and installs the complete logical state in one destination transaction. A nonempty destination is rejected rather than merged. Preserve records, revisions, evidence, joins, conflicts, scopes, IDs, timestamps, receipt digests/deleted-result state, generation identities and outstanding opaque deletion obligations. Reset abandoned in-flight leases only with ownership fencing; never discard remote deletion debt.

Rebuild dialect-local lexical structures during import. Invalidate/rebuild optional local derived indexes where destination identity differs; do not copy an active vector pointer that refers to inaccessible local files. Preserve historical routing required for outstanding remote cleanup, and report any incompatible target as an explicit blocking preflight condition. Verify canonical counts, IDs, lineage and digests before commit. Failure leaves the old store usable and the destination without a published partial import. Transfer does not rewrite authored Loader files; the operator changes the selected row only after verification. Source data remains until an explicit separate retirement decision.

### 9. Preserve every consumer and keep the kernel neutral

Change `protocol.ts` and `capture.ts` to consume the asynchronous domain interface and preserve existing tool schemas/error codes. In particular, await `memory.forget` before constructing `{ deleted }`; await capture's `inspect` and `propose` before inspecting properties, counting proposals or containing errors. Execute automatic recall as one domain operation instead of reconstructing it from remote per-record calls. Reconcile semantic neighbor identity against current canonical data through the new boundary.

Update the vector coordinator's store calls, initialization, generation operations, status, maintenance and teardown to await the bounded repository-owned operations. Tests that cast private SQLite fields must move to repository-owned fault-injection/fixture helpers rather than exposing raw ORM access in production contracts.

Keep all services and disposables native Cordis. Repository connection pools, transactions, workers and migration candidates dispose with the owning scope; await in-flight cleanup before deleting fixture resources. Failed initialization or reload must close candidates and preserve the previous audited generation where the current reload contract permits it. Provider selection is not a live data migration; switch stores through a verified configuration change and new Runtime Sessions.

### 10. Make two real backends a mandatory completion gate

Extract reusable behavior assertions and provide explicit, unconditional SQLite and PostgreSQL test entrypoints. Focused-spec evidence must resolve to direct static `it`/`test` cases; use ordinary wrappers calling shared assertion functions, not conditional/parameterized/skipped evidence. Use temporary file-backed SQLite and an actual disposable PostgreSQL 17 database/schema with isolated credentials. A mock driver, PGlite-only run, pgvector smoke, or missing-DSN skip cannot certify canonical PostgreSQL support.

Wire both backends into the required verification/CI path. A documented fixture setup provisions a local test server or container before checks; after provisioning checks need no public model/vector downloads. Missing PostgreSQL prerequisites fail the backend gate visibly. If a separate `check:memory-backends` command is introduced, the required aggregate check must invoke it; it is not an optional maintenance command.

The common matrix covers all domain tools, capture, actor/project isolation, credentials, revisions, receipts, evidence, conflicts, promotion, pinning/authority, temporal behavior, lexical corpus, stable/semantic recall and budget, outbox atomicity, deep deletion, migration and restart. Deterministic concurrency barriers prove two independent clients/processes, same-subject creation, duplicate operation IDs, CAS winners, post-commit freshness, stale final-validation rejection, worker routing, expired-lease fencing and competing generation transitions. Failure injection proves lexical/outbox errors roll back the entire mutation and uncertain commit retries do not duplicate data.

A real OMP integration must exercise the project-local `.omp/extensions/doppelganger.ts` and child transport with PostgreSQL canonical storage as well as retained SQLite behavior. Verify bound-actor failure before opening storage, tool/context registration, capture, second-session visibility, restart, failure containment and disposal. Run the existing complete checks, both-backend gate, focused-spec implementation checks, and registry-backed security check before implementation handoff.

### 11. Coordinate the pending context-engine change without expanding this one

This change establishes the persistence contract first. Before either overlapping implementation is applied, rebase `advance-memory-context-engine` onto it: remove its SQLite-only/raw-connection assumptions, reconcile the next schema version, and retain the maintained projection owner/acknowledgment scenarios as well as its proposed additions. That change currently has incomplete MODIFIED projection content relative to the maintained spec; copying it would lose current guarantees.

Do not implement its L0/L1 tiers, hierarchy, extraction queues, checkpoints, usage feedback, or semantic relations here. Any later such feature must use the same repository transaction and pass both canonical backends.

## Risks / Trade-offs

- **ORM identity maps can hide another agent's commit** -> operation-scoped forks, uncached canonical reads, fresh final snapshots and independent-client regression tests.
- **SQLite transactions may differ through the selected dialect** -> prove immediate reservation, connection affinity and rollback on actual MikroORM/node:sqlite before porting the remaining commands; do not silently substitute a weaker transaction.
- **PostgreSQL allows concurrency that the old SQLite path serialized** -> database-owned partition and generation locks, CAS, transaction-scoped receipts, lease-token fencing, deterministic lock order and bounded lock failures.
- **Dialect FTS behavior differs** -> separate indexed search implementations and required multilingual/technical corpus; preserve domain semantics, not accidental score equality.
- **A successful commit can outlive a lost response** -> stable command digest/receipt semantics and explicit uncertain-outcome recovery with the same operation ID.
- **Global semantic workers can misroute shared-store work** -> route by canonical/generation/destination identity and reject incompatible coordinators; never infer locality from one PostgreSQL DSN.
- **Moving storage can lose private lineage or remote cleanup debt** -> consistent offline transfer, empty destination, complete durable-state manifest, verification before cutover and retained original source.
- **Two accepted client implementations can diverge in policy** -> one domain engine and reusable conformance assertions, rather than two policy-bearing services.
- **Mandatory PostgreSQL tests add a developer prerequisite** -> documented disposable fixture provisioning, bounded startup/cleanup and clear failure; no silent skip that misrepresents completion.
- **Documentation currently overstates a few implementation details** -> retain current observable replay/promotion behavior in baseline tests and reconcile wording, not silently invent frozen replay responses or modify capture rules during an ORM migration.

## Migration Plan

1. Reconcile the overlapping active design: schema v5 belongs to this backend change and schema v6 to the later context-engine change. Capture current v4 behavior, including receipt replays loading the current record and promotion updating provenance metadata; do not bundle unrelated behavioral fixes.
2. Add repository/DTO contracts, internal mappings, both driver bootstraps and the first real transaction/conformance fixtures. Prove both transaction paths before the broader cutover.
3. Port canonical commands, indexed lexical search and final validation through the shared domain engine and both repositories, including the bounded projection-store interface and cross-process ownership fixes.
4. Migrate all maintained composition rows, consumers, tests and documentation; preserve old SQLite file locations and supported legacy adoption. PostgreSQL must activate without canonical instance-SQLite or pgvector.
5. Exercise offline transfer in both directions using populated fixtures, including forgotten-operation receipts and pending remote deletion obligations. Reject unsupported or partial transfers.
6. Run mandatory real-backend, concurrency, OMP, security and full repository verification. Replace all planned focused evidence with executable targets before archive.
7. Deploy by selecting one provider per new Runtime Session after its schema/transfer preflight succeeds. Do not switch a running source and destination into concurrent writers during transfer.
8. Roll back binaries only against a compatible schema or a pre-migration backup. After accepting writes on the new backend, restore service by an explicit reverse transfer or verified recovery, not by pointing at a stale old database. No rollback procedure silently loses acknowledged writes.

## Open Questions

No product-level scope decision is deferred: both canonical backends, all current memory behavior, direct shared-database visibility and real service verification are required. The implementation must settle low-level driver transaction plumbing in the first tracer slice. Schema ordering is fixed at v5 for this change and v6 for the dependent context engine; neither sequencing nor driver plumbing is permission to omit PostgreSQL, retain a second SQLite engine, or weaken atomicity.
