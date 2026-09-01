## 1. Semantic Contracts and Persistence

- [x] 1.1 Define embedder, vector-index, semantic retriever, generation, projection identity, health, and maintenance contracts in `extension-memory`, with strict JSON-safe boundary values where applicable.
- [x] 1.2 Add canonical SQLite migrations for semantic generation metadata, active-generation pointers, indexed-revision state, projection work, opaque deletion tombstones, and optional validated embedding-cache metadata.
- [x] 1.3 Add deterministic identity/fingerprint helpers that include complete embedder-space identity while excluding credentials and operational device choice.
- [x] 1.4 Export the new contracts through package entry points, update package-boundary rules for the planned implementation packages, and preserve the single workspace Cordis peer.
- [x] 1.5 Add migration and contract tests covering fresh databases, existing memory databases, identity mismatch, malformed dimensions, and secret-free serialization.

## 2. Canonical Projection Lifecycle

- [x] 2.1 Enqueue deterministic active-revision projection work in the same transaction as explicit remember, candidate promotion, correction, and conflict-resolution mutations.
- [x] 2.2 Converge stale queued upserts by loading and revalidating the current canonical record/revision immediately before embedding.
- [x] 2.3 Extend rejection, expiration, supersession, and status transitions to enqueue the required vector deletion or replacement work without copying content into work rows.
- [x] 2.4 Implement hard deletion that removes canonical and local derived content immediately while retaining only identifier-only remote deletion tombstones until confirmed.
- [x] 2.5 Add lifecycle tests for retry idempotency, mutation rollback, correction races, deletion during backend outage, stale-hit suppression, and tombstone removal after recovery.

## 3. Independent Hybrid Retrieval

- [x] 3.1 Implement deterministic Unicode-safe semantic query projection for bounded pass-through, final-question selection, meaningful trailing segment selection, and bounded-tail fallback.
- [x] 3.2 Replace the salience-bounded `MemoryEmbeddingProvider.rank()` path with independent lexical top-K and optional semantic top-K candidate retrieval.
- [x] 3.3 Fuse overlapping and disjoint candidate sets with deterministic reciprocal-rank fusion, stable tie breaks, pinned-preference precedence, subject diversity, limits, and whole-record token budgets.
- [x] 3.4 Revalidate every semantic hit against canonical partition, scope, project, status, temporal eligibility, active generation, record identity, and current revision before ranking or projection.
- [x] 3.5 Contain embedder, timeout, backend, malformed-hit, and dimension failures so lexical search returns normally and bounded sanitized health state records the failure.
- [x] 3.6 Add retrieval tests for semantic-only matches, lexical-only operation, overlap deduplication, long prompt-contaminated input, technical identifiers outside the projection, cross-scope hits, stale revisions, timeout, and provider exceptions.

## 4. Local Embedder Plugin

- [x] 4.1 Create `extension-embedding-local` as an ordinary Loader-compatible Cordis plugin with lazy ONNX runtime and tokenizer dependencies and no activation cost when unselected.
- [x] 4.2 Implement pinned EmbeddingGemma 300M with an official 256-dimensional Matryoshka projection and explicit 384-dimensional all-MiniLM-L6-v2 configurations with immutable artifact identity, pooling/projection settings, normalization, and cosine metric declarations.
- [x] 4.3 Implement bounded document batching, query embedding, malformed-input handling, deterministic normalization, accelerator selection, and CPU fallback without changing vector-space identity.
- [x] 4.4 Implement bounded model acquisition/cache validation with offline and corrupt-artifact diagnostics that never disable lexical memory.
- [x] 4.5 Add model identity, dimensions, normalization, batching, CPU-fallback, Russian/English similarity, offline failure, and real local inference smoke tests.

## 5. Semantic Coordinator and Generation Control

- [x] 5.1 Create `extension-memory-vectors` entry points for the semantic coordinator and each vector backend, using the contracts from `extension-memory` and one isolated service instance per Runtime Session.
- [x] 5.2 Implement the bounded projection worker with deterministic batching, idempotent delivery, retry/backoff, current-revision checks, and disposal-safe cancellation.
- [x] 5.3 Implement new-generation rebuild from deterministic canonical pages with count/identity verification and an atomic local active-generation switch.
- [x] 5.4 Implement interrupted-build recovery, backend/model swap through a new generation, retained-generation rollback, and retryable old-generation cleanup.
- [x] 5.5 Add semantic status and maintenance memory tools reporting sanitized backend/embedder identity, lag counters, tombstone counts, last failure category/time, and declared maintenance capabilities.
- [x] 5.6 Add coordinator tests for incomplete stacks, duplicate services, parallel session isolation, interrupted rebuild, atomic switch, rollback, reload, worker shutdown, and secret-free diagnostics.

## 6. SQLite Exact Vector Backend

- [x] 6.1 Implement the `sqlite_exact` backend with configured local database ownership, explicit `Float32Array` BLOB encoding, generation namespaces, and transactional idempotent upsert/delete.
- [x] 6.2 Implement exact normalized cosine top-K search with required eligibility filters, strict dimension checks, deterministic canonical-identity tie breaks, and no ANN dependency.
- [x] 6.3 Implement health, counts, close, and supported compaction maintenance with serialized `ran`, `already-running`, and `noop` outcomes.
- [x] 6.4 Add SQLite exact conformance, persistence, concurrent session, dimension mismatch, filter isolation, deletion, maintenance, and process-restart tests.

## 7. Server-Backed Vector Adapters

- [x] 7.1 Build one reusable backend conformance suite for isolation, explicit vectors, dimensions, filters, deterministic ordering, top-K, idempotent writes, deletion, health, lifecycle closure, and maintenance declarations.
- [x] 7.2 Implement the Chroma server adapter with explicit embeddings, tenant/database/collection isolation, indirect credential resolution, filtered queries, health, and collection cleanup.
- [x] 7.3 Implement the Qdrant adapter with cosine collection configuration, deterministic point IDs, payload filters, indirect API-key resolution, health, and collection cleanup.
- [x] 7.4 Implement the pgvector adapter with isolated schema/table naming, exact cosine search, indirect DSN resolution, health, and explicit optional HNSW build/reindex maintenance.
- [x] 7.5 Run the shared conformance suite against all four adapters and add real service smoke fixtures for Chroma, Qdrant, and PostgreSQL/pgvector create, upsert, filtered search, delete, and teardown paths.
- [x] 7.6 Add failure-injection tests for unavailable servers, malformed responses, partial batches, credential redaction, concurrent maintenance, disposal, and recovery without Runtime Session restart.

- [x] 8.1 Expand committed-turn extraction beyond exact fact/preference tags to facts, preferences, decisions, procedures, and explicit remember requests with stable subject keys.
- [x] 8.2 Apply conservative exclusions for uncertain or ambiguous statements, persona self-description, assistant promises, transient task chatter, generated prompt text, recursive memory content, and secrets.
- [x] 8.3 Add optional semantic neighbor suggestions for equivalence, paraphrase, and possible contradiction without allowing automatic canonical mutation.
- [x] 8.4 Re-run neighbor suggestions and mutations through canonical SQL partition, status, temporal, subject-key, idempotency, and conflict rules.
- [x] 8.5 Contain extractor, semantic, observer, and mutation failures so committed-turn capture remains fail-open and bounded.
- [x] 8.6 Add capture precision/recall regression fixtures for English and Russian durable facts, preferences, decisions, procedures, explicit remember requests, exclusions, contradictions, and semantic suggestions.
- [x] 8.5 Add capture tests for positive durable statements, Russian/English paraphrases, unstable-key rejection, false-positive boundaries, cross-partition neighbor rejection, no auto-merge/correction/promotion, and abrupt termination.

## 9. Runtime Presets, Operations, and Documentation

- [x] 9.1 Add Loader-compatible configuration schemas and examples for embedder selection, backend selection, safe limits, sanitized endpoints/namespaces, and environment-variable credential references.
- [x] 9.2 Compose and smoke-test an explicit local semantic Runtime Preset using EmbeddingGemma plus SQLite exact while keeping presets without semantic rows unchanged and development candidate capture disabled unless separately selected.
- [x] 9.3 Document model cache/offline operation, backend prerequisites, model/backend swap, generation rebuild/rollback, health counters, pending deletion recovery, and realistic backend scale trade-offs.
- [x] 9.4 Update `README.md`, the authoritative `docs/features/memory.md` and `docs/operations/semantic-memory.md` owners, package orientation, and dependency-boundary checks to describe independent hybrid retrieval and derived non-authoritative indexes without introducing a kernel or host semantic protocol.
- [x] 9.5 Record MemPalace design provenance and include its MIT notice if implementation text is substantially reused rather than independently reimplemented.
- [x] 9.6 Remove `MemoryEmbeddingProvider`, its legacy reranking implementation, obsolete tests, exports, comments, and compatibility paths after every in-repo caller uses the new contracts.

## 10. Benchmarks and End-to-End Verification

- [x] 10.1 Add a deterministic Russian/English retrieval corpus covering lexical-only, semantic-only, paraphrase, technical identifier, conflicting subject, partition isolation, and temporal/current-revision cases.
- [x] 10.2 Benchmark recall quality and bounded latency across lexical-only, SQLite exact hybrid, and available server backends; select and document top-K, query deadline, batch-size, and retention defaults from the results.
- [x] 10.3 Run narrow typechecks and focused package tests for `extension-memory`, `extension-embedding-local`, `extension-memory-vectors`, affected development Runtime Presets, and `host-omp` as each affected seam is completed.
- [x] 10.4 Exercise the real OMP surface through a child Runtime Session: remember, restart, lexical recall, semantic-only recall, correction/reindex, backend failure fallback, recovery, hard deletion, reload, and shutdown.
- [x] 10.5 Run all four adapter conformance suites and every available real backend smoke, recording explicitly which external-service smokes were unavailable rather than treating mocks as equivalent proof.
- [x] 10.6 Run `npm run check` and verify workspace typechecks, tests, single-Cordis enforcement, package boundaries, and removal of every obsolete semantic reranking path.
