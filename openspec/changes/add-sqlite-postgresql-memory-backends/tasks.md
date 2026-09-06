## 1. Baseline and overlapping change coordination

- [x] 1.1 Reconcile `advance-memory-context-engine` planning with the selected repository/unit-of-work boundary, preserve maintained projection-owner scenarios, and choose one next canonical schema version before either overlapping implementation starts.
- [x] 1.2 Extract the current observable memory contract into reusable fixture/assertion helpers, retaining receipt replay of current records, promotion/provenance behavior, actor migration rules, public tool schemas and error outcomes rather than mixing unrelated policy fixes into the persistence cutover.
- [x] 1.3 Add a disposable PostgreSQL 17 test fixture and independent-client/process harness alongside temporary file-backed SQLite fixtures; ensure startup failure is explicit and all clients close before schemas/directories are removed.

## 2. Shared contracts and two-driver transaction tracer

- [x] 2.1 Extract asynchronous `MemoryRepository`, bounded `MemoryUnitOfWork`, detached domain DTOs and the public memory service interface; define operation-scoped ownership and remove concrete `MemoryService` typing from the protocol contract.
- [x] 2.2 Add aligned MikroORM dependencies and internal explicit entity schemas with preserved table names/opaque IDs; keep ORM types, connection state and dialect SQL out of public consumer interfaces.
- [x] 2.3 Implement the actual MikroORM SQLite bootstrap using `@mikro-orm/sql` and `NodeSqliteDialect`, preserved home/namespace location, foreign keys, WAL, durability settings and bounded busy handling.
- [x] 2.4 Implement the actual MikroORM PostgreSQL bootstrap with indirect credentials, validated dedicated schema, bounded pool/deadlines and verified transport configuration, without canonical SQLite or pgvector dependencies.
- [x] 2.5 Prove a real SQLite write transaction acquires the required immediate reservation and uses one connection for ORM writes, dialect SQL and rollback; settle driver plumbing before porting further commands.
- [x] 2.6 Prove real PostgreSQL transaction affinity, partition lock-row serialization, deterministic lock order and rollback using independent clients, not a fake driver or process mutex.
- [x] 2.7 Implement operation-scoped EntityManager forks and detached result mapping; verify independent reads do not reuse managed canonical entities or long-lived ORM result caches.

## 3. Canonical mutations and receipts on both repositories

- [x] 3.1 Port partition/scope and subject reconciliation reads through the repository, preserving immutable host actor derivation, project/relationship eligibility and all public validation/error contracts.
- [x] 3.2 Port explicit remember and candidate propose through the shared unit of work, including conflict-safe first-subject creation, revision rows, provenance and transactional receipt creation.
- [x] 3.3 Port correction and compare-and-swap revision lineage, preserving exact retry precedence over current-revision preconditions and changed-command operation-ID rejection.
- [x] 3.4 Port candidate approve/reject/corroborate and promotion policy with transactional evidence joins, distinct-session rules, non-resurrection and current observable provenance behavior.
- [x] 3.5 Port supporting/contradicting evidence and conflict inspection/resolution through the shared repository, keeping one authoritative domain implementation.
- [x] 3.6 Port pin/unpin, inspection, listing, history and evidence queries with deterministic bounded ordering and identical actor/project/temporal eligibility rules.
- [x] 3.7 Port forget so one transaction deletes canonical content and every local derived row while preserving non-resurrecting receipt state and durable identifier-only remote cleanup obligations.
- [x] 3.8 Add deterministic two-client tests for identical and changed-digest operation reuse, competing subject creation, competing corrections and uncertain PostgreSQL commit responses; verify coherent outcomes with no duplicate side effects.
- [x] 3.9 Inject lexical, evidence, receipt and outbox failures on both implementations and prove full-command rollback on the actual transaction connection.

## 4. Dialect lexical retrieval and final canonical snapshots

- [x] 4.1 Implement SQLite FTS5 indexing/query operations inside the repository without retaining a second legacy canonical execution path; pass the maintained full-query lexical corpus.
- [x] 4.2 Implement PostgreSQL indexed native full-text search with explicit `simple` configuration, complete OR-style query semantics, Unicode/technical token handling and deterministic tie breaks.
- [x] 4.3 Run shared Russian/English/technical-identifier corpus assertions against both engines, preserve eligibility before bounded top-K selection, and document only permitted numeric lexical-ranking differences.
- [x] 4.4 Port lexical/semantic candidate gathering and rank fusion to the asynchronous repository while preserving independent semantic top-K, fallback, query projection and bounded diagnostics.
- [x] 4.5 Implement the final bulk canonical read snapshot after external semantic work, revalidating stable/ranked records and active generation together before pure deduplication, authority and whole-record budgeting.
- [x] 4.6 Prove SQLite cross-process and PostgreSQL cross-client post-commit freshness, pending-semantic correction/deletion rejection, and visible canonical outages without stale-cache or local-store fallback.

## 5. Projection persistence and shared coordinator ownership

- [x] 5.1 Replace the concrete synchronous projection store with a bounded asynchronous memory-owned interface implemented through each selected repository; migrate every coordinator call without exposing ORM/database access.
- [x] 5.2 Persist canonical-store, Persona Instance, generation, source-revision and vector-target routing on projection work and identifier-only deletion debt; filter claims by compatible ownership.
- [x] 5.3 Implement transactional lease acquisition, expiry, recovery, renewal, retry and acknowledgment with unique ownership-token fencing and bounded failures.
- [x] 5.4 Revalidate canonical source and generation state after embedding/vector I/O and preserve convergence work when a source revision changes before acknowledgment.
- [x] 5.5 Persist and serialize generation rebuild, verification, activation, rollback and retained-generation cleanup using durable compare-and-swap transitions and a fixed lock order.
- [x] 5.6 Reject incompatible model/backend/generation owners and distinguish machine-local `sqlite_exact` destinations from genuinely shared targets; prevent silent cross-target work consumption.
- [x] 5.7 Preserve status/rebuild/rollback/maintenance tool contracts and all existing vector adapters while awaiting the new bounded store operations and disposal.
- [x] 5.8 Add deterministic independent-coordinator coverage for route isolation, orphan-source deletion delivery, stale lease fencing, competing generation transitions, restart recovery and cleanup on both canonical backends.

## 6. Cordis providers and complete consumer cutover

- [x] 6.1 Export the SQLite and PostgreSQL Loader subpaths and provide `doppelgangerMemoryRepository` through native Cordis with exactly one provider per memory isolation realm.
- [x] 6.2 Move storage configuration from the memory row to the selected provider row, validate the new provider configurations strictly, and reject unbound actors before either provider opens storage.
- [x] 6.3 Update memory activation, `protocol.ts` and context assembly to consume the asynchronous domain interface; explicitly await forget before projecting its result and render the single final recall selection.
- [x] 6.4 Update committed-turn capture to await inspection and proposal persistence before counting results or containing failures, preserving committed-turn-only capture and candidate-only inference.
- [x] 6.5 Migrate every maintained fixture, direct constructor caller, public export and Loader composition to the explicit provider contract; remove obsolete synchronous APIs and memory-only instance-SQLite injection.
- [x] 6.6 Preserve unrelated Evolution/instance-SQLite and vector `sqlite_exact` consumers, memory-free standard presets, host neutrality and existing package-boundary invariants.
- [x] 6.7 Verify candidate initialization, failure, reload and disposal races close every repository resource exactly once and never publish a late or failed service.

## 7. Schema adoption and offline backend transfer

- [x] 7.1 Implement explicit versioned SQLite adoption for supported populated v1/v2/v3/v4 stores, including actor migration rules and complete canonical/receipt/deletion-debt preservation.
- [x] 7.2 Implement PostgreSQL schema bootstrap and versioned migrations with a database-owned migration lock, schema fingerprint verification and rejection of newer/unknown layouts.
- [x] 7.3 Prove concurrent startup and injected migration failure on both engines do not publish partial state or lose the previously committed store.
- [x] 7.4 Implement an operator-only `memory:transfer` command with quiescent-source preconditions, consistent snapshot reads, empty-destination validation and explicit indirect destination credentials.
- [x] 7.5 Implement atomic SQLite-to-PostgreSQL import preserving IDs, scopes, revisions, evidence, candidate joins, conflicts, timestamps, receipts and canonical lineage, rebuilding PostgreSQL lexical structures.
- [x] 7.6 Implement atomic PostgreSQL-to-SQLite import with the same durable-state manifest and rebuilt FTS5, without rewriting authored Loader selection or deleting the source.
- [x] 7.7 Preserve remote cleanup routes and forgotten-result receipts during transfer; fence abandoned leases, reject incompatible active destinations and rebuild derived indexes rather than accepting inaccessible local generation pointers.
- [x] 7.8 Verify both transfer directions, nonempty destination rejection, failure rollback, canonical digests and post-transfer behavior with populated fixtures; document rollback after new writes without reverting to stale source state.

## 8. Mandatory parity and host evidence

- [x] 8.1 Add direct unconditional SQLite and PostgreSQL conformance entrypoints using shared domain assertions for all commands, isolation, immutable history, evidence, conflicts, promotion, pinning, temporal eligibility and deep deletion.
- [x] 8.2 Cover complete lexical query, optional semantic fallback, deterministic fusion, final canonical snapshots, stable-profile authority and whole-record budgets through both repositories.
- [x] 8.3 Execute the two-client/process transaction, freshness, receipt, CAS, projection routing, lease fencing and generation-transition scenarios against real engines with deterministic barriers.
- [x] 8.4 Exercise the real project-local `.omp/extensions/doppelganger.ts` and child runtime with PostgreSQL canonical memory, including actor rejection, all tools, committed-turn capture, context, second-session visibility, restart, failure and disposal; retain equivalent SQLite coverage.
- [x] 8.5 Wire a required real-backend gate into aggregate verification and CI with documented disposable PostgreSQL provisioning; add a harness assertion that unavailable PostgreSQL fails rather than skips.
- [x] 8.6 Replace every `planned:` evidence target in this change with direct unconditional executable test references, preserve existing scenario IDs and ensure each behavior has one maintained specification owner.

## 9. Documentation and final acceptance

- [x] 9.1 Update `docs/features/memory.md` with canonical provider ownership, asynchronous domain/snapshot behavior, unchanged authorization and exact receipt semantics.
- [x] 9.2 Update `docs/operations/semantic-memory.md` with backend-independent canonical validation, routed projection ownership, lease/generation coordination and local versus shared vector-target limits.
- [x] 9.3 Update `docs/operations/configuration.md` and `README.md` with both Loader configurations, credential/security boundaries, migration/adoption, offline transfer and recovery instructions, preserving memory-free preset behavior.
- [x] 9.4 Update `docs/architecture/overview.md` and `docs/operations/verification.md` for the persistence seam and mandatory real-backend workflow; update `docs/README.md` only if document ownership or paths change.
- [x] 9.5 Remove obsolete synchronous persistence code, compatibility branches and superseded fixtures after behavioral verification, and run the project formatter on the final implementation changes.
- [x] 9.6 Run both real-backend suites, focused-spec implementation evidence, real OMP smoke scenarios, `npm run check` and registry-backed `npm run check:security`; record actual output and residual reviewed security risk without calling skipped service evidence a pass.
- [x] 9.7 Validate the completed OpenSpec change and reconcile maintained specifications/current documentation before archive; do not mark either backend complete while any canonical feature, transfer, consumer or required real-service gate remains unfinished.

## Verification evidence

- Required backend gate with automatic disposable PostgreSQL 17 provisioning: 49 tests passed across six files; no canonical service skips.
- Changed focused-spec graph: 71 scenarios passed, 97 unique tests, zero skips or failures.
- Real transfer CLI smoke: SQLite → PostgreSQL → SQLite preserved record IDs, corrected revision lineage, and history.
- Current OpenSpec validation: 24 specifications passed; this change passed strict validation. Current specs were synchronized without archiving; the newly synchronized backend delta was rebased to `MODIFIED` to preserve unique active/current ownership.
- Registry-backed security check passed with IPv4-first DNS after registry timeouts: four unresolved reviewed high-severity entries remain (`@huggingface/transformers`, `adm-zip`, `onnxruntime-node`, `sharp`), baseline 2026-09-03. This is not a clean audit; the trusted pinned-model restriction remains.
- No project formatter is configured. `npm run format --workspaces --if-present` completed without a formatter invocation; no alternate formatter or style-only rewrite was introduced.
- Optional external embedding, CodeGraph, and remote vector service tests are not claimed as real-service passes. Remote GitHub Actions execution is not claimed.
- Final `npm run check` passed with automatic disposable PostgreSQL provisioning: every workspace typecheck/test, script tests, single-Cordis check, package boundaries, documentation/live-spec integrity, and catalog check. Real OMP host and packaging suites passed within this gate.