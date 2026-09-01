## Context

`extension-memory` already owns the authoritative Persona memory model: partitioned records, immutable revisions, evidence, candidate promotion, conflicts, operation receipts, temporal eligibility, FTS5, context authority, and hard deletion. Its optional semantic seam is incomplete: `MemoryEmbeddingProvider.rank()` receives at most 200 records selected by salience, so it cannot retrieve a relevant record excluded from that candidate window; no production provider exists; and an exception from the provider currently aborts the entire search instead of preserving lexical recall.

The change crosses canonical mutations, retrieval, persistence, optional model execution, four vector stores, Runtime Preset composition, failure isolation, deletion, and operational maintenance. The kernel and hosts must remain unaware of embeddings. Persona definitions must compose semantic support from ordinary Cordis plugins. One workspace Cordis root remains mandatory.

The governing constraints are:

- canonical SQLite state is the only source of truth;
- FTS5 remains available without semantic plugins and during their failure;
- eligibility is applied before ranking where possible and always revalidated afterward;
- external stores are rebuildable projections and cannot become required for canonical mutation correctness;
- model identity and vector dimensions cannot be mixed silently;
- automatic extraction creates candidates only;
- hard deletion suppresses content immediately and eventually removes every configured external projection without retaining deleted content in retry state;
- settings belong to plugin rows, while credentials are referenced indirectly rather than persisted in memory state or diagnostics.

## Goals / Non-Goals

**Goals:**

- Retrieve independent semantic top-K candidates over all vector-indexed eligible memory rather than reranking a salience-bounded subset.
- Support the same storage choices as MemPalace: SQLite exact, Chroma, Qdrant, and PostgreSQL with pgvector.
- Provide a local multilingual embedder suitable for Russian and English, with MiniLM retained only as an explicit compatibility choice.
- Preserve deterministic FTS5 plus semantic reciprocal-rank fusion, current-revision validation, subject diversity, pinned-preference precedence, and whole-record token budgeting.
- Make vector projection synchronization durable, idempotent, observable, rebuildable, and safe across corrections, promotions, rejection, model changes, and deletion.
- Expand conservative committed-turn candidate extraction and use semantic neighbors as review evidence without allowing similarity alone to mutate canonical records.
- Exercise every backend through one conformance contract and a real end-to-end retrieval/deletion scenario.

**Non-Goals:**

- Moving canonical memory, revisions, evidence, conflicts, receipts, or temporal state into a vector database.
- Making semantic retrieval mandatory for activation or recall.
- Running Chroma embedded in the Node.js process; the TypeScript adapter targets a Chroma server.
- Supporting multiple simultaneously active semantic indexes in one Runtime Session.
- Cross-persona memory sharing, document/repository ingestion, a general knowledge graph, or MemPalace wing/room/tunnel ontology.
- Automatic semantic merge, correction, deletion, identity mutation, or instruction-authority escalation.
- Mutating salience from reads, Hebbian reinforcement, or Ebbinghaus decay.
- Adding embedding concepts to the runtime kernel, host bridge, or extension protocols.

## Decisions

### 1. Keep semantic state behind memory-owned contracts

`extension-memory` will export transport-free value types and two service contracts:

```ts
interface MemoryEmbedder {
  readonly identity: MemoryEmbedderIdentity
  embedDocuments(texts: readonly string[]): Promise<readonly Float32Array[]>
  embedQuery(text: string): Promise<Float32Array>
}

interface MemoryVectorIndex {
  readonly identity: MemoryVectorIndexIdentity
  upsert(entries: readonly MemoryVectorEntry[]): Promise<void>
  delete(identities: readonly MemoryVectorIdentity[]): Promise<void>
  search(request: MemoryVectorSearchRequest): Promise<readonly MemoryVectorHit[]>
  health(): Promise<MemoryVectorHealth>
  maintenance(kind: MemoryVectorMaintenanceKind): Promise<MemoryVectorMaintenanceResult>
  close(): Promise<void>
}
```

An ordinary semantic coordinator plugin depends on `doppelgangerMemory`, one `doppelgangerMemoryEmbedder`, and one `doppelgangerMemoryVectorIndex`. It drains canonical projection work and provides one optional `doppelgangerMemorySemantic` retriever to `MemoryService`. Memory activation itself does not inject the optional services, so their absence never blocks FTS5.

The contracts remain owned by `extension-memory` because they operate on canonical record/revision identities and eligibility metadata. Implementation packages depend inward on this contract; `extension-memory` never imports an implementation package.

Alternative considered: a generic vector protocol in `extension-protocols`. Rejected because no host transport consumes vectors and exposing memory-specific indexing as a standard host protocol would widen the wrong boundary.

Alternative considered: backend selection through a central registry. Rejected because Runtime Presets already provide composition and duplicate service detection. One selected plugin row is explicit and auditable.

### 2. Use two implementation packages rather than one package per backend

Add:

- `extension-embedding-local`: local ONNX embedder plugin, model cache, batching, normalization, and model identity;
- `extension-memory-vectors`: semantic coordinator plus SQLite exact, Chroma, Qdrant, and pgvector vector-index plugins exposed as separate Loader-compatible entry points.

Backend-specific third-party clients are loaded only by their selected entry point. Dependencies that require infrastructure remain optional/lazy. Package-boundary rules will explicitly allow these packages to depend on the memory contract and, where needed, SQLite infrastructure.

Alternative considered: five backend packages. Rejected initially because each would repeat configuration, identity, filter, conformance, and lifecycle plumbing. Separate packages remain possible if distribution or native dependency isolation later requires them.

### 3. Separate embedding generation from vector storage

Every backend receives explicit normalized vectors from the selected embedder. Backend-owned/default embedding functions are disabled. This gives identical vector spaces across SQLite exact, Chroma, Qdrant, and pgvector and makes model changes explicit.

The initial model choices are:

- `embeddinggemma-300m`: default for newly configured semantic memory, 256 dimensions through an officially supported Matryoshka projection, multilingual and normalized for cosine distance;
- `all-MiniLM-L6-v2`: explicit compatibility option, 384 dimensions, not selected automatically for multilingual presets.

The persisted identity contains provider, canonical model identifier, immutable model revision/digest, pooling/projection configuration, dimensions, normalization, and distance metric. Device choice is operational and is not part of vector-space identity. CPU is always a fallback; accelerator selection cannot change output identity.

Unknown model revision, dimension mismatch, normalization mismatch, or distance-metric mismatch blocks semantic index opening and requests a rebuild. It never silently records a new identity over existing vectors.

Alternative considered: allow each backend to embed text. Rejected because Chroma defaults and server configuration can drift, while Qdrant and pgvector normally expect explicit vectors.

### 4. Treat every vector store as a derived generation

A semantic generation has a stable ID derived from Persona Instance, backend configuration fingerprint, and embedder-space identity. Entries use deterministic IDs from generation, record ID, and revision ID. Stored payload is limited to:

- record ID and revision ID;
- instance and principal partition IDs;
- relationship/project scope and project ID when present;
- kind and subject key;
- status needed by the adapter contract;
- content projection required by backend diagnostics, only when a backend requires or explicitly supports it.

The external collection/table name includes an opaque instance/generation namespace. Credentials and raw connection strings are excluded from names, fingerprints exposed to callers, markers, and diagnostics.

Only active revisions participate in normal semantic recall. Candidates may use a separate reconciliation collection or explicit candidate-search mode, never the active recall collection.

Alternative considered: keep one collection and overwrite vectors during model changes. Rejected because a partially rebuilt collection mixes incompatible vector spaces and has no safe rollback.

### 5. Use a canonical transactional outbox for projection work

Canonical mutations update FTS5 and enqueue vector projection work in the same SQLite transaction. Work rows contain only operation kind, backend/generation identity, record ID, revision ID, attempt state, and timestamps. They do not copy memory content or embeddings. The worker loads eligible current content immediately before embedding; if the record or revision is no longer current, it converts work into deletion/no-op as appropriate.

Work identities are deterministic, so retries cannot produce duplicate projections. Upsert completion records the indexed revision. Correction, promotion, conflict resolution, rejection, and model generation changes enqueue the corresponding work. FTS5 is updated synchronously and therefore covers newly committed records while semantic indexing catches up.

Hard deletion enqueues identifier-only tombstones before canonical rows and local cached embeddings are removed. Canonical inspection and recall stop exposing the record in that transaction. A remote outage leaves a durable opaque deletion tombstone; stale remote hits still fail canonical revalidation. Successful remote deletion removes the tombstone. Deleted content is never retained for retry.

Alternative considered: make every memory mutation wait for the remote backend. Rejected because Qdrant, Chroma, or PostgreSQL availability would then control canonical memory correctness and host-turn latency.

### 6. Retrieve lexical and semantic candidates independently

Search runs two branches:

1. FTS5 over the complete principal query with canonical partition, status, and temporal predicates.
2. Semantic top-K over the active generation using a bounded semantic query projection and backend filter for instance, principal, scope/project, active status, and model generation.

The union is keyed by record ID plus revision ID. Lexical and semantic ranks are fused using the existing deterministic RRF constant. Every union member is loaded again from canonical SQLite and must still match the active partition, status, temporal state, record ID, and current revision ID. Results then apply pinned relationship-preference precedence, subject diversity, deterministic tie breaking, limit, and whole-record token budget.

A semantic timeout, health failure, malformed hit, dimension error, or backend exception is contained and recorded in health state; the lexical branch returns normally. Semantic results alone never carry content into context projection.

Alternative considered: normalize and add raw vector and BM25 scores. Rejected because backend distance scales differ and candidate-relative normalization can reorder existing hits when unrelated candidates enter the set.

### 7. Project long queries only for the semantic branch

Queries at or below the safe bound pass through after Unicode normalization. Longer turns use a deterministic projection: prefer the last bounded question, otherwise the last meaningful bounded line/sentence, otherwise a bounded tail. The result records projection method and lengths for diagnostics but never logs query content.

FTS5 always receives the full principal input so paths, versions, symbols, identifiers, and numeric literals outside the projected tail remain searchable. The projection is not a security boundary and cannot alter canonical input or capture material.

Alternative considered: summarize with a model. Rejected because it adds latency, nondeterminism, another failure path, and potential instruction following before retrieval.

### 8. Implement backend-specific behavior behind one conformance suite

- **SQLite exact**: local configured database path, explicit `Float32Array` vectors stored as BLOBs, exact normalized cosine scan, no ANN index, local transactional upsert/delete, no server. It is the default backend when a semantic vector plugin is explicitly configured.
- **Chroma**: TypeScript HTTP client connected to a configured Chroma server; explicit embeddings for add/query; tenant/database/collection namespace and optional token read from an environment-variable reference. No embedded Node mode is claimed.
- **Qdrant**: official JavaScript client, explicit cosine collection dimensions, deterministic point IDs, payload filters for eligibility, namespace-derived collection names, API key read from an environment-variable reference.
- **pgvector**: `node-postgres` plus pgvector encoding, one schema/table namespace per instance generation, exact cosine `<=>` search by default, optional HNSW maintenance, DSN read from an environment-variable reference.

Each adapter must implement deterministic isolation, explicit dimension validation, filtered top-K, idempotent upsert/delete, health, close, and supported maintenance outcomes. Unsupported maintenance raises a typed error rather than silently succeeding.

Server endpoints and non-secret namespaces live in plugin rows. Secret-bearing API keys and DSNs are referenced by environment-variable name; resolved values are never serialized into Runtime Session metadata, markers, receipts, errors, or health output.

### 9. Make rebuild and model swap transactional at the local control plane

Rebuild creates a new generation, scans canonical eligible active revisions in deterministic pages, embeds in bounded batches, writes the new backend collection, verifies counts and sampled identities, then switches the local active-generation pointer in one SQLite transaction. Searches continue using the previous generation until the switch. Old generation cleanup occurs afterward and is retryable.

A failed or interrupted rebuild leaves the previous generation active. Re-running resumes or replaces the incomplete generation by deterministic build identity. Rollback switches the pointer back while the previous generation is retained; after retention cleanup, rollback requires rebuilding it.

Backend changes use the same generation mechanism rather than in-place migration. No vector data is copied between backends; canonical content is re-embedded or reuses a locally validated cache keyed by complete embedder identity plus revision ID.

### 10. Keep semantic reconciliation advisory

The capture contract continues to require a valid kind, stable subject key, bounded content, and provenance. The bundled deterministic extractor adds conservative durable-language patterns only when it can produce a stable validated key; otherwise it skips the observation. Pluggable model extractors may produce richer candidates through the same boundary.

Before a new candidate is committed, semantic nearest neighbors may be requested only inside the same Persona Instance, principal, scope, and kind. Similarity produces review suggestions:

- likely equivalent record/candidate;
- likely paraphrase with a different subject key;
- possible contradiction requiring inspection.

Similarity alone never adds evidence, changes a subject key, merges records, promotes a candidate, corrects an active revision, or deletes state. Existing exact subject-key reconciliation and explicit/corroborated evidence remain authoritative.

### 11. Expose bounded diagnostics, not a new host protocol

Memory tools gain semantic status and maintenance operations through the existing tool registry. Status reports selected backend kind, sanitized target, active generation, embedder identity, indexed/current/stale/missing counts, pending identifier-only work, last failure code/time, and supported maintenance kinds. It excludes credentials, memory content, vectors, and queries.

No OMP RPC or extension-protocol change is required because these remain ordinary runtime tools and context behavior.

### 12. Preserve provenance when adapting MemPalace ideas

The TypeScript implementation will target Doppelganger contracts rather than transliterate Python modules. If any substantial MemPalace implementation text is reused, its MIT copyright and permission notice will accompany the copied portion. Algorithms rewritten from the behavior and tests will still acknowledge design inspiration where appropriate.

## Risks / Trade-offs

- **[Risk] Eventual semantic consistency can miss a newly committed semantic-only match.** → FTS5 is synchronous; outbox lag is visible; rebuild and drain operations are available.
- **[Risk] External filters differ subtly across backends.** → Define a narrow required filter grammar, run shared conformance fixtures, and always revalidate canonical eligibility after search.
- **[Risk] Model output changes under the same upstream model name.** → Pin immutable model revision/digest and all pooling/projection parameters in identity.
- **[Risk] Local ONNX models increase installation size and first-use latency.** → Lazy model acquisition, bounded cache, explicit offline diagnostics, and no model load when semantic plugins are absent.
- **[Risk] Exact SQLite search becomes slow at large scale.** → Keep it as the predictable local default; expose counts/latency; select Qdrant, Chroma, or pgvector for larger indexes.
- **[Risk] Chroma has no embedded TypeScript parity with Python PersistentClient.** → Document and test server mode only; do not present it as the local default.
- **[Risk] Remote deletion may remain pending indefinitely.** → Canonical tombstones suppress hits immediately; expose pending deletions and retry health; retain only opaque identities.
- **[Risk] Backend availability could add turn latency.** → Bound semantic query time, contain failures, and return lexical results without waiting beyond the configured deadline.
- **[Risk] Natural-language heuristics generate unstable keys or false memories.** → Skip ambiguous observations, require validated keys, store outputs as inactive candidates, and test false-positive boundaries.
- **[Trade-off] One vector adapter package carries multiple client integrations.** → Lazy entry points avoid activating unused clients; split packages later only if distribution evidence requires it.

## Migration Plan

1. Add the new contracts alongside the legacy `MemoryEmbeddingProvider` only within one implementation branch; migrate all in-repo callers and tests before removing the legacy export in the same change.
2. Add semantic metadata, generation, projection-work, and tombstone tables transactionally. Existing canonical records and FTS5 remain untouched and immediately usable.
3. Ship the semantic coordinator and SQLite exact backend first behind explicit Runtime Preset composition. No existing preset becomes semantic by migration.
4. Build and activate the first generation from canonical current revisions. Failure leaves lexical-only behavior and existing memory intact.
5. Add Qdrant, pgvector, and Chroma adapters against the shared conformance suite and backend-specific real smoke fixtures.
6. Opt the development Aiden preset into local semantic memory only after local model/index smoke verification; production presets choose explicitly.
7. Remove the legacy reranker contract after every caller and test uses independent semantic retrieval.

Rollback disables/removes the semantic coordinator, embedder, and backend rows from the Runtime Preset. FTS5 and canonical memory continue unchanged. New projection metadata may remain dormant and can be deleted independently after no generation is active. Canonical schema downgrade is not required.

## Open Questions

- Benchmark-derived defaults for semantic top-K, query timeout, batch size, and generation-retention duration must be selected from the retrieval corpus before implementation constants are finalized.
- The exact immutable artifact digest exposed by the chosen local model distribution must be verified during implementation; model identity cannot rely on a mutable repository label.
- Real Chroma, Qdrant, and pgvector smoke tests may be environment-gated in the default suite, but each adapter must also have deterministic contract tests that run without external infrastructure.
