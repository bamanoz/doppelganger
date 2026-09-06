# Semantic memory operations

Semantic memory is explicit Runtime Preset composition, not a kernel or host protocol. Canonical provider-backed lexical retrieval remains complete and functional when the semantic stack is absent or fails.

## Stack

A complete stack composes exactly one of each in the same isolation realm:

1. `MemoryEmbedder` provider;
2. `MemoryVectorIndex` provider;
3. memory vector coordinator.

No semantic row means no model acquisition, embedding, projection, or vector-server work.

## Local embedder

`extension-embedding-local` lazily loads the pinned EmbeddingGemma 300M q8 ONNX artifact pair and projects the 768-dimensional sentence embedding to normalized 384-dimensional Matryoshka output. A 384-dimensional MiniLM profile is explicit compatibility configuration with a distinct identity. Cache artifacts are checked against pinned path, size, and SHA-256 metadata; a legacy q4-only cache is not accepted as q8.

Runtime acquisition is prepare/commit. A loaded runtime remains a private candidate until post-load artifact validation succeeds and a final open-state check passes. Validation failure, accelerator failure before CPU fallback, loader failure after candidate creation, or `close()` winning the race closes the candidate exactly once and never publishes it as active. A late loader result self-disposes; later embedding requests reject as closed.

`offline: true` requires a previously warmed and verified cache. Missing artifacts report `OFFLINE_MODEL_UNAVAILABLE`; corrupt artifacts report `CORRUPT_CACHE`. Accelerator failure may fall back to CPU only after the failed candidate is closed. Device selection is operational and does not change vector-space identity.

Changing model, revision, artifact digest, pooling, projection, normalization, metric, or dimensions creates a new semantic generation.

### Measured q4/256 versus q8/384 evidence

The versioned reports in `docs/benchmarks/embeddinggemma-profile-*-2026-08-30.json` use the same fixed eight-query Russian/English fixture on Node v26.8.1, Darwin arm64, Apple M2 CPU. They are evidence from one supported workstation, not an SLA or a claim about other devices.

Both profiles produced recall@3 `1.0`, mean reciprocal rank `0.9375`, and one forbidden top-3 hit; this fixture showed parity, not a measured q8 quality improvement. In the warm-cache run, q8 query latency was 48.809 ms p50 and 52.968 ms p95 versus 8.242 ms and 10.510 ms for q4. q8 document throughput was 45.048 entries/s versus 113.793 entries/s, and peak RSS delta was 1,354,743,808 bytes versus 456,589,312 bytes. The verified q8 cache was 309,458,498 bytes versus 197,245,082 bytes for q4 (+56.9%); a 384-dimensional `Float32Array` projection is 1,536 bytes per record versus 1,024 bytes at 256 dimensions (+50%), before backend metadata or ANN overhead.

The initial-acquisition report observed 485.844 seconds for q8 because that run downloaded the artifact while q4 was already cached; do not compare those two acquisition values directly. The second report measures both from a warm verified cache. Re-run `DOPPELGANGER_RUN_LOCAL_EMBEDDING_BENCHMARK=1 npm run benchmark:profiles --workspace @doppelganger/doppelganger-embedding-local` on deployment-class hardware before changing operational limits.

## Canonical databases and vector backends

Canonical storage and semantic vector storage are separate choices. `@doppelganger/doppelganger-memory/postgresql` is an authoritative record repository and does not require pgvector. `@doppelganger/doppelganger-memory-vectors/pgvector` is an optional derived vector index and is never canonical authority. A deployment may therefore use canonical PostgreSQL with SQLite exact, Chroma, Qdrant, pgvector, or no semantic backend; conversely, canonical SQLite may use remote pgvector.

| Derived backend | Prerequisite | Profile |
| --- | --- | --- |
| SQLite exact | Writable local filesystem | Exact normalized-cosine scan; local projection target; linear scan cost |
| Chroma | Reachable Chroma server | Server collections and metadata filters; no embedded Node mode |
| Qdrant | Reachable Qdrant service | Cosine collections, payload filters, external snapshot/replication operations |
| pgvector | PostgreSQL with `vector` extension | Exact cosine by default; HNSW build/reindex only by explicit maintenance |

Choose a vector backend from measured record count, latency, durability, and operating constraints. A local SQLite exact target is derived state and does not make a canonical database shared. Remote backends add network and outage modes; bounded semantic deadlines preserve canonical lexical results.

Backend initialization is prepare/commit. Runtime modules, clients, pools, collection metadata, schemas, and tables remain local candidates until every required setup operation and a final open-state check succeed. Failure or late close releases every owned candidate without publishing partial state. Close is idempotent even when it races initialization.

Qdrant client construction uses one shared in-flight promise. A transient factory/import rejection clears that exact promise while the adapter remains open, so later callers can retry; concurrent retry callers share one new attempt. Collection readiness is not committed after a close that wins during remote metadata inspection.

## Credentials

Semantic server endpoints and non-secret namespaces are authored Loader configuration. Chroma tokens, Qdrant API keys, and password-bearing pgvector DSNs are referenced by environment-variable name only. Resolved values are excluded from generation fingerprints, Runtime Session metadata, diagnostics, health, and errors. Canonical PostgreSQL credentials follow the separately owned [canonical provider configuration](configuration.md#canonical-memory-providers).

## Projection and generation lifecycle

Canonical mutations enqueue identifier-only projection work in the same repository transaction. Every projection entry and backend filter includes the canonical `(instanceId, actorId)` partition. The shared repository contract owns queue leasing, retry, acknowledgment, generation preparation/verification/activation/rollback/cleanup, and status counts. The coordinator retains scheduling, deadlines, external embedding/index I/O, and cancellation; it has no canonical database seam and performs no canonical SQL.

Work is routed by canonical store, Persona Instance, generation, and vector target. Claims never consume another target's work; deletion debt retains its original opaque route after canonical content is gone. Each lease has a unique expiring ownership token. Recovery replaces that token, so a stale worker cannot renew, retry, or acknowledge its successor's work.

After semantic I/O, acknowledgment and query assembly reload the affected identities through a fresh canonical bulk read before certifying delivery or returning content. The coordinator and memory service retain no authoritative object identity map across awaits.

A model, backend, or partition-schema change builds a new generation from deterministic canonical pages, verifies identity and counts, then atomically switches the canonical active pointer. Candidate activation fails if the rebuild is incomplete, so the prior audited runtime and generation remain active. Vector stores hold deterministic identities, actor-named eligibility filter metadata, and normalized vectors only; they never authorize content.

Generation preparation rejects reuse with another canonical owner or provider identity. Rebuild-page acknowledgment rechecks each record and revision atomically; a stale page cannot certify a candidate. Activation and rollback verify completeness within the pointer-change transaction, and retained-generation cleanup checks state before deleting queued work.

The durable active pointer is per Persona Instance. Generation transitions compare its revision under the same instance-first lock order as canonical mutations; competing transitions cannot both activate from one revision. Compatible coordinators converge on the committed generation, and interrupted rebuilds recover through expiring transition ownership rather than process-local locks.

Startup attaches to an exactly compatible committed generation or builds the first generation when none exists. A different committed model/backend/target is never replaced by startup: the new coordinator remains semantically inactive/degraded, preserves canonical lexical recall, and exposes maintenance. Invoke `memory.semantic.rebuild` explicitly to build and atomically activate the replacement.

SQLite exact vector schema version 3 persists a random local target ID in its metadata and folds that ID into the fingerprint. Two different files therefore cannot collide merely because their paths, namespace, dimensions, and authored configuration match. pgvector has a separate derived schema lifecycle; neither vector schema version is a canonical-memory schema version. Incompatible or partially migrated derived state cannot become active results, and canonical actor-scoped lexical retrieval remains available during migration, rebuild, or backend failure.

### q4/256 to q8/384 procedure

1. Warm and verify the pinned q8 cache online, or provision the exact verified cache before enabling `offline: true`. A q4-only cache cannot satisfy q8 acquisition.
2. Change the embedder profile by deploying this q8/384 release and set the selected backend to 384 dimensions. For SQLite exact or Qdrant, also choose a new non-secret namespace/collection such as `assistant.embeddinggemma-q8-384`; their persisted storage identity cannot reopen a 256-dimensional namespace as 384. Chroma isolates each generation in its own collection; pgvector includes dimensions in its derived storage names.
3. Activate or reload the Runtime Preset, then explicitly invoke `memory.semantic.rebuild` if the previous incompatible generation remains committed. The coordinator embeds canonical current active revisions into the new generation; it never reads, copies, or resizes q4 vectors.
4. Inspect `memory.semantic.status`. Treat the migration as complete only when the q8/384 identity is active and indexed/current counts match with zero missing or stale entries. Canonical lexical retrieval remains available throughout.
5. Retain the q4 storage until the deployment is accepted. Cleanup is optional derived-data maintenance after the rollback window.

An interrupted q8 build remains failed/incomplete and cannot become the active generation. Retry activation or `memory.semantic.rebuild` after correcting acquisition/backend failure; the retry restarts from canonical state and removes partial q8 projection markers first. `memory.semantic.rollback` activates only a retained generation compatible with the currently configured embedder and backend. Returning to q4/256 therefore requires restoring the prior release and its 256-dimensional backend namespace, or disabling semantic rows for immediate lexical-only operation; it never reinterprets q4 vectors as q8.

## Health and maintenance

Health is sanitized and bounded to backend kind/target, active generation, embedder identity, supported maintenance, indexed/current/stale/missing counts, pending upserts/deletes, and last failure category/time.

Coordinator tools expose status, rebuild, rollback, and backend-declared maintenance. Maintenance is serialized; controlled overlap reports `already-running`, while separately settled requests report their declared `ran` or `noop` result. Unsupported operations fail explicitly. SQLite exact supports compaction, pgvector supports explicit HNSW build/reindex, and generation cleanup removes retained derived data only. Adapter conformance must use a real supported exclusive-work boundary; a fixture-only assertion or unconditional sleep is not evidence of serialization.

Pending remote deletion retains opaque identities until confirmation. Canonical absence suppresses stale hits; never delete tombstones or reintroduce deleted content manually to clear operational debt.

The local embedder, vector backends, and semantic coordinator emit ordinary Cordis lifecycle, generation, retry, degraded-search, and maintenance events through the optional Runtime Session logging route. Records contain only backend kinds, dimensions, counts, maintenance kinds, and failure categories; model paths, endpoints, credentials, canonical content, queries, and vectors are excluded. The vocabulary and destination contract are owned by [Runtime logging](../features/runtime-logging.md).

## Design provenance

The backend matrix and rebuild-oriented operations were informed by MemPalace. Doppelganger's TypeScript implementation was independently written against its own Cordis and canonical-memory contracts; no substantial MemPalace implementation text is incorporated.

## Current dependency risk

The local embedder is an opt-in deployment component restricted to trusted, pinned model artifacts. Do not process untrusted model archives or image inputs through its transitive native/image stack. The reviewed baseline at `scripts/security-advisory-baseline.json`, dated 2026-09-03, currently records four unresolved high-severity entries in `@huggingface/transformers`, `onnxruntime-node`, `adm-zip`, and `sharp`, with no compatible fix reported by npm.

Run `npm run check:security` for a registry-backed production audit. It prints every unresolved entry and the deployment restriction, then compares severity, affected range, advisory IDs, and `fixAvailable` with the reviewed baseline. New advisories, baseline drift, a resolved/path-changed reviewed entry, or a newly compatible fix fail the command. A passing baseline comparison means the known risk is unchanged; it is not a clean-audit claim. See the [system audit](../audits/2026-08-30-system-audit.md).
