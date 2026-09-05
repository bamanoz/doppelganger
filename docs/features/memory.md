# Memory

Memory is an optional actor-aware Persona extension and never a runtime-kernel interface. Canonical SQLite is authoritative; semantic indexes are derived, rebuildable projections.

## Canonical model

Records are partitioned by Persona Instance and the immutable host actor binding. Project scope is the default when project identity is available; relationship scope requires an explicit request. Records retain kind, status, subject key, immutable revisions, temporal eligibility, provenance evidence, conflicts, receipts, and current-revision lineage.

Persistent memory requires a bound session-isolated `doppelgangerActor` service. An unbound actor fails memory activation before the canonical database opens; actor-independent and empty Runtime Presets remain valid. Memory configuration and model-invocable tools cannot select or switch actors, and tool input rejects both `actorId` and the removed `principalId` alias.

Explicit `remember` creates active memory immediately. Automatic inference and committed-turn capture create review candidates only. Candidates cannot enter recall until manually approved or promoted by evidence policy. Promotion requires qualifying observations from distinct sessions and no unresolved contradiction or subject conflict.

Every mutation uses a stable `operationId` within its `(instanceId, actorId)` partition. An exact retry replays the prior result; reuse with a changed command digest is rejected. Corrections append immutable revisions and use compare-and-swap where the active revision may race.

Hard deletion removes canonical content and local derived rows. Remote vector cleanup retains identifier-only tombstones until delivery succeeds; canonical revalidation suppresses stale remote hits meanwhile.

The shared content policy rejects secrets, credentials, tokens, private keys, recursive memory instructions, and trivial material. Identity and traits are not writable memory. Full transcript storage is disabled by default.

## Retrieval

Automatic recall is one memory-owned operation. It first gathers an eligible relationship-profile subset independent of lexical overlap: pinned relationship preferences and relationship facts under `principal.identity.*`. It then awaits ranked lexical and optional semantic retrieval using the complete current principal turn, and performs one final canonical reload/eligibility pass before returning contributions. Stable profile data is considered before ordinary ranked data under the host-provided context budget; pinned preferences retain instruction authority, while approved active preferences remain behavioral instructions even when unpinned and selected by query. Identity facts and all other ordinary records remain data.

The final operation deduplicates by canonical record identity and applies a deterministic whole-record budget; it never emits a stale stable snapshot or awaits between final validation and return. Both layers derive authorization only from the bound actor partition, status, temporal eligibility, and hard token budget. FTS5 and optional semantic top-K are independent ranked candidate sources, and deterministic reciprocal-rank fusion combines their ranks.

Before return, every record is validated against canonical Persona Instance, actor, scope, status, temporal eligibility, active semantic generation where applicable, record identity, and current revision. Semantic absence, timeout, malformed output, or backend failure preserves stable-profile and lexical recall.

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

## Persistence migration

Canonical schema version 4 renames maintained partition columns to `actor_id`. Supported version 2 and 3 databases migrate transactionally without changing identifier values; version 1 state is assigned to the current bound actor while its records, revisions, evidence, scopes, receipts, and eligibility are preserved. Failed migrations roll back and leave the previous database recoverable.

SQLite exact and pgvector derived stores migrate their persisted actor column and advance an explicit schema/fingerprint version. Chroma and Qdrant use actor-named metadata and new generation identity, so incompatible principal-named projections cannot become active results. Canonical lexical recall remains authoritative and available while semantic state rebuilds or fails.


## Semantic seam

`extension-memory` owns transport-free `MemoryEmbedder`, `MemoryVectorIndex`, `MemorySemanticRetriever`, identity, generation, health, maintenance, projection-work, and query-projection contracts because they use canonical memory identities. Embedder and vector packages implement those interfaces inward; protocols, composition, and hosts expose no embedding or vector protocol.

A complete semantic stack has exactly one embedder, one vector index, and one coordinator in the same Runtime Session isolation realm. Duplicate providers fail through Cordis composition.

The default local multilingual profile is pinned EmbeddingGemma q8 with normalized 384-dimensional Matryoshka output. MiniLM remains an explicit 384-dimensional compatibility profile. Legacy EmbeddingGemma q4/256 vectors are incompatible derived data: changing to q8/384 creates a new generation and rebuilds it from canonical current revisions before activation; vectors are never copied or resized across spaces. Lexical retrieval remains available if q8 acquisition or rebuilding fails.

Operational details are in [Semantic memory](../operations/semantic-memory.md).

Canonical activation, mutation outcomes, search counts, and semantic degradation emit metadata-only ordinary Cordis events under `doppelganger-memory`; memory content, subjects, evidence, and actor identifiers are excluded. The shared event vocabulary and destination behavior are owned by [Runtime logging](runtime-logging.md).

## Primary implementation

- `packages/extension-memory/src/service.ts` — canonical behavior and mutation interface.
- `packages/extension-memory/src/schema.ts` — schema and migrations.
- `packages/extension-memory/src/capture.ts` — candidate extraction.
- `packages/extension-memory/src/semantic.ts` — semantic contracts.
- `packages/extension-memory/src/projection-store.ts` — bounded canonical projection queue, acknowledgment, generation transitions, and status counts; the coordinator has no raw database access.
- `packages/extension-memory-vectors/src/coordinator.ts` — derived projection delivery and semantic retrieval.
