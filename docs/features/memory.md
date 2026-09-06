# Memory

Memory is an optional actor-aware Persona extension and never a runtime-kernel interface. Canonical memory is authoritative behind one session-isolated repository service; SQLite and PostgreSQL are interchangeable canonical providers. Semantic indexes are derived, rebuildable projections.

## Canonical model

Records are partitioned by Persona Instance and the immutable host actor binding. Project scope is the default when project identity is available; relationship scope requires an explicit request. Records retain kind, status, subject key, immutable revisions, temporal eligibility, provenance evidence, conflicts, receipts, and current-revision lineage.

Persistent memory requires a bound session-isolated `doppelgangerActor` service and exactly one session-isolated `doppelgangerMemoryRepository`. The provider derives its actor partition only from the host binding; an unbound actor fails provider activation before canonical storage opens. Actor-independent and empty Runtime Presets remain valid. Memory configuration and model-invocable tools cannot select or switch actors, and tool input rejects both `actorId` and the removed `principalId` alias.

`@doppelganger/doppelganger-memory/sqlite` owns a local canonical file and `@doppelganger/doppelganger-memory/postgresql` owns a shared canonical database schema. The memory service injects the repository, not instance SQLite, and contains no provider-specific SQL. SQLite is for local state; independent processes may coordinate only when opening the same local file. PostgreSQL is the supported remote-sharing provider. Neither provider makes cross-actor or cross-Persona data visible.

Explicit `remember` creates active memory immediately. Automatic inference and committed-turn capture create review candidates only. Candidates cannot enter recall until manually approved or promoted by evidence policy. Promotion requires qualifying observations from distinct sessions and no unresolved contradiction or subject conflict.

Every mutation uses a stable `operationId` within its `(instanceId, actorId)` partition. A receipt is an idempotency claim, not a frozen record snapshot: an exact same-digest retry reloads and returns the current authorized record, while reuse with a changed command digest fails. If that recorded result was permanently deleted, replay fails rather than resurrecting it; an exact retry of the deletion itself reports the already-recorded deletion. Corrections append immutable revisions and use compare-and-swap where the active revision may race. Repository writes serialize on a durable instance-generation lock and then the actor partition lock; database transactions, not process-local identity maps, own correctness.

SQLite reserves the writer with `BEGIN IMMEDIATE` before domain reads. Contended reservation acquisition yields to the event loop within `busyTimeoutMs`, allowing another local client to commit; exhaustion fails visibly. Only acquisition retries, never a started transaction or an uncertain commit. Read snapshots do not reserve a writer.

Hard deletion removes canonical content and local derived rows. Remote vector cleanup retains identifier-only tombstones until delivery succeeds; canonical revalidation suppresses stale remote hits meanwhile.

The shared content policy rejects secrets, credentials, tokens, private keys, recursive memory instructions, and trivial material. Identity and traits are not writable memory. Full transcript storage is disabled by default.

## Retrieval

Automatic recall is one memory-owned asynchronous operation. It first gathers eligible stable-profile record identities independent of lexical overlap: pinned relationship preferences and relationship facts under `principal.identity.*`. It then awaits ranked canonical lexical and optional semantic retrieval using the complete current principal turn and finishes with one fresh canonical bulk snapshot before returning contributions. No record object retained from before an await is authoritative.

The final operation deduplicates by canonical record identity and applies a deterministic whole-record budget. The fresh snapshot validates Persona Instance, actor, scope, status, temporal eligibility, active semantic generation where applicable, record identity, and current revision. Both layers derive authorization only from the bound actor partition and canonical eligibility. Canonical lexical and optional semantic top-K are independent ranked candidate sources, and deterministic reciprocal-rank fusion combines their ranks.

Every persisted memory read and mutation is Promise-returning and callers must await it, including final validation and mutation outcomes. The bounded `semanticFailure()` metadata accessor remains synchronous. Semantic absence, timeout, malformed output, or backend failure preserves stable-profile and canonical lexical recall; it never licenses a stale pre-await object.

## Public service contract

`doppelgangerMemory` exposes backend-neutral asynchronous persisted reads and mutations. Repository transaction callbacks are private to the memory implementation. The PostgreSQL provider keeps MikroORM transaction handles inside callback scope and recovers failed transaction start (`BEGIN`) without leaking a poisoned connection. SQL, transaction handles, and backend clients never cross into model tools, the semantic coordinator, the generic runtime, or hosts.

## Tools

The memory protocol covers:

- search, inspect, and history;
- remember, correct, and forget;
- candidate propose/list/approve/reject/corroborate;
- evidence list/observe;
- conflict list/resolve;
- pin and unpin.

Tool input and output remain JSON-compatible and validated. Tools expose no actor field or switch operation. Capture is a separate Loader-compatible subpath and is disabled by omission.

The bundled deterministic extractor recognizes explicit durable-memory syntax in committed principal input:

```text
[fact:project.runtime.transport] The runtime uses framed JSON-RPC.
[preference:preference.response.verbosity] Prefer concise answers.
```

Alternative extractors can implement the same candidate interface without changing canonical memory.

## Persistence lifecycle

Canonical schema version 5 introduces the backend-neutral repository and preserves the existing SQLite local-file lineage without forcing relocation while making PostgreSQL a first-class canonical provider. A future context-engine change is reserved to advance canonical state to version 6; version 6 is not part of this implementation. Version 5 migrations are transactional: failure leaves the previous database recoverable, and an unsupported or partially migrated schema never opens as current.

SQLite exact vector schema version 3 stores a random local target ID and folds it into the derived fingerprint, preventing different files with otherwise identical configuration from sharing a generation identity. Generic SQLite infrastructure and non-memory adapters remain available and unchanged. pgvector remains a derived semantic backend with its own schema lifecycle; it is not the canonical PostgreSQL provider.

Canonical SQLite/PostgreSQL movement is an explicit offline operator operation, not activation-time failover or replication. The source must be stopped, the destination empty, and the transfer preserves revisions, receipts, deletion state, and opaque remote-cleanup debt from one consistent source snapshot. It neither rewrites a Runtime Preset nor deletes the source. Exact configuration and the `memory:transfer` command are owned by [Configuration](../operations/configuration.md#canonical-memory-providers).

Canonical lexical recall remains authoritative and available while semantic state rebuilds or fails.

## Semantic seam

`extension-memory` owns transport-free `MemoryRepository`, `MemoryEmbedder`, `MemoryVectorIndex`, `MemorySemanticRetriever`, identity, generation, health, maintenance, projection-work, and query-projection contracts because they use canonical memory identities. Canonical providers, embedder packages, and vector packages implement those interfaces inward; protocols, composition, and hosts expose no database, embedding, or vector protocol.

A complete semantic stack has exactly one embedder, one vector index, and one coordinator in the same Runtime Session isolation realm. Duplicate providers fail through Cordis composition.

The default local multilingual profile is pinned EmbeddingGemma q8 with normalized 384-dimensional Matryoshka output. MiniLM remains an explicit 384-dimensional compatibility profile. Legacy EmbeddingGemma q4/256 vectors are incompatible derived data: changing to q8/384 creates a new generation and rebuilds it from canonical current revisions before activation; vectors are never copied or resized across spaces. Lexical retrieval remains available if q8 acquisition or rebuilding fails.

Operational details are in [Semantic memory](../operations/semantic-memory.md).

Canonical activation, mutation outcomes, search counts, and semantic degradation emit metadata-only ordinary Cordis events under `doppelganger-memory`; memory content, subjects, evidence, and actor identifiers are excluded. The shared event vocabulary and destination behavior are owned by [Runtime logging](runtime-logging.md).

## Primary implementation

- `packages/extension-memory/src/service.ts` — backend-neutral canonical behavior and asynchronous persisted read/mutation interface.
- `packages/extension-memory/src/repository.ts` and `src/persistence/{provider,repository}.ts` — public repository types and private provider/transaction contracts.
- `packages/extension-memory/src/sqlite.ts` and `src/postgresql.ts` — Loader providers for `doppelgangerMemoryRepository`.
- `packages/extension-memory/src/persistence/{config,database,transaction,sqlite-dialect}.ts` — strict backend configuration and private database mechanics.
- `packages/extension-memory/src/persistence/{migrations,transfer}.ts` and `src/operator-transfer.ts` — canonical version 5 migration mechanics and offline transfer.
- `packages/extension-memory/src/capture.ts` — candidate extraction.
- `packages/extension-memory/src/semantic.ts` and `src/projection-store.ts` — semantic contracts and repository-backed canonical projection ownership.
- `packages/extension-memory-vectors/src/coordinator.ts` — derived projection delivery and semantic retrieval.
