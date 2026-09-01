## Why

Doppelganger memory has strong canonical-state guarantees but its optional semantic path is only a bounded in-memory reranker, has no production embedder or vector index, and can currently fail lexical recall when a semantic provider throws. Strengthening retrieval now creates a scalable multilingual path without weakening SQLite authority, revision safety, deletion, or fail-open host behavior.

## What Changes

- Replace the bounded `MemoryEmbeddingProvider.rank()` reranker with separate embedder and derived vector-index contracts.
- Add a local multilingual embedder based on EmbeddingGemma 300M and retain MiniLM as an explicit compatibility option; persist and strictly validate model identity, revision, dimensions, and distance metric.
- Add four vector-index adapters matching MemPalace's supported storage matrix: local exact SQLite, Chroma server, Qdrant, and PostgreSQL with pgvector.
- Keep memory records, revisions, evidence, conflicts, operation receipts, temporal state, and FTS5 exclusively authoritative in the canonical SQLite store; vector indexes remain rebuildable projections.
- Fuse independent lexical and semantic top-K candidate sets using deterministic reciprocal-rank fusion, then revalidate partition, scope, status, temporal eligibility, record identity, and current revision before projection.
- Add semantic-only query projection for long or prompt-contaminated turns while preserving the complete principal input for FTS5 and exact technical terms.
- Make semantic generation, search, synchronization, and remote-backend failures degrade to lexical retrieval with visible health diagnostics.
- Add durable, idempotent vector projection work, rebuild/model-swap workflows, backend health and maintenance reporting, and stale/missing/indexed counters.
- Expand optional committed-turn extraction for durable preferences, decisions, facts, procedures, and explicit remember requests while keeping every automatic result a candidate and excluding authored Persona identity, assistant promises, task chatter, secrets, recursive context, generated content, and incomplete turns.
- Use semantic similarity to suggest equivalent observations, paraphrases, and possible contradictions within the same eligible partition and kind; never auto-merge, replace, or delete canonical records from similarity alone.
- Strengthen hard deletion so canonical state becomes immediately invisible and every configured derived vector projection is durably driven to deletion without allowing stale hits to resurrect content.
- **BREAKING**: replace the exported `MemoryEmbeddingProvider` reranking interface with the new embedder/vector-index service contracts and migrate all providers and tests.

## Capabilities

### New Capabilities

- `memory-semantic-indexes`: Embedder identity, derived projection synchronization, backend conformance, configuration, health, rebuild, and maintenance behavior for SQLite exact, Chroma, Qdrant, and pgvector.

### Modified Capabilities

- `persona-memory`: Independent hybrid retrieval, semantic failure isolation, query projection, richer candidate extraction and semantic reconciliation, and hard-deletion behavior for external derived indexes.

## Impact

- Affected packages: `extension-memory`, `extension-embedding-local`, and `extension-memory-vectors`; development Runtime Presets only where they explicitly opt into the stack.
- Affected public contracts: memory semantic service interfaces and their Cordis service declarations.
- New optional dependencies: ONNX model runtime/tokenizer support, Chroma TypeScript client, Qdrant JavaScript client, PostgreSQL client, and pgvector Node integration, isolated to the corresponding plugin packages.
- Persistent state: canonical memory schema gains projection-work and semantic-index metadata; external indexes store only canonical identities, filter metadata, content projection, and vectors.
- Operations: local exact SQLite is the no-server default when semantic retrieval is configured; Chroma, Qdrant, and pgvector remain explicit server-backed choices.
- Documentation and tests: Runtime Preset examples, backend configuration, model migration/rebuild guidance, one shared conformance suite, retrieval benchmarks, and real backend smoke scenarios.
