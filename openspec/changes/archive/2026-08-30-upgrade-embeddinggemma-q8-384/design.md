## Context

`extension-embedding-local` currently selects `embeddinggemma-300m` by default, requests q4 Transformers.js artifacts, projects the model's 768-dimensional sentence embedding to normalized 256-dimensional vectors, and records that space in the immutable embedder identity. The local model cache is validated by exact artifact metadata, and the runtime is acquired lazily with accelerator fallback and disposal-safe prepare/commit behavior.

`extension-memory-vectors` already derives a generation ID from the complete embedder and vector-index identities. A model, projection, dimension, or backend change therefore triggers a new rebuild from canonical SQLite state; the active-generation pointer changes only after verification. Vector backends are dimension-parameterized, so no backend implementation change is expected beyond preset/test/documentation expectations.

The target model revision is unchanged. The pinned Hugging Face artifact tree exposes q8 through `onnx/model_quantized.onnx` and `onnx/model_quantized.onnx_data`; their exact byte counts and SHA-256 values must be copied from the verified upstream tree into the local manifest. The artifact digest in the identity must be regenerated using the repository's established identity convention, not guessed from a mutable model label.

The existing vector-backend retrieval benchmark uses a synthetic 12-dimensional corpus and is appropriate for backend conformance, not for comparing local model profiles. The model comparison needs a fixed Russian/English semantic fixture and must measure quality and runtime characteristics without changing canonical memory or backend contracts.

## Goals / Non-Goals

**Goals:**

- Make EmbeddingGemma q8 with normalized 384-dimensional Matryoshka projection the default local multilingual profile.
- Validate the exact q8 cache artifacts before runtime publication and preserve lazy loading, offline behavior, CPU fallback, and candidate disposal semantics.
- Ensure q4/256 and q8/384 are distinct semantic generations and that migration rebuilds projections from canonical content.
- Update the development semantic preset and all user-facing examples to use 384 dimensions.
- Produce reproducible q4/256 versus q8/384 evidence for bilingual retrieval quality, cold and warm latency, peak memory, and cached/indexed bytes.
- Keep MiniLM as an explicit 384-dimensional compatibility profile and keep vector backend choice independent of embedder choice.

**Non-Goals:**

- No new model revision, model family, embedding provider, Python process, sidecar, service, or package boundary.
- No change to query/document prefixes, tokenizer behavior, source model dimension, pooling semantics, normalization algorithm, or accelerator policy.
- No change to canonical memory, FTS5 ranking, host protocols, vector backend APIs, or backend selection defaults.
- No automatic migration that copies or resizes old vectors; existing derived q4/256 indexes are disposable rebuild products.
- No claim that this resolves the already-reviewed Transformers.js/ONNX transitive advisories.

## Decisions

### 1. Replace the default EmbeddingGemma artifact set in place

`EMBEDDING_GEMMA` remains the same model name, model ID, revision, source dimension, prefixes, and lazy Transformers.js path. Its dtype becomes `q8`; its artifact list becomes the exact q8 graph and external-data files from the pinned revision; its identity projection becomes `mrl-truncate-384-l2` and dimensions become `384`.

Alternative considered: add a second model name such as `embeddinggemma-300m-q8`. Rejected because the requested behavior is a clean default upgrade, the model revision is unchanged, and a second name would leave ambiguous preset selection and duplicate compatibility surface. The old q4/256 space remains represented by persisted historical generation identities, not by a new public model selection.

### 2. Keep projection in the existing embedder boundary

The existing `l2Project` path continues to truncate each 768-dimensional runtime row to the declared identity width and renormalize it. No model-side output option is introduced. Contract tests assert 384-length normalized vectors and retain source-output dimension validation at 768.

Alternative considered: request a 384-dimensional model output directly. Rejected because the pinned model card documents MRL as truncation plus re-normalization, and the existing implementation already enforces that invariant in one place.

### 3. Treat q8/384 migration as identity-driven rebuild

The complete embedder identity changes in both `projection` and `dimensions`; the artifact digest also changes. `memorySemanticGenerationId` consequently differs. Existing coordinator behavior detects the configured generation mismatch, builds q8/384 from canonical current eligible revisions, verifies counts/current revisions, then atomically activates it. No migration code copies vectors between generations. Failed builds leave the previously active generation queryable.

Alternative considered: delete the old generation before rebuilding. Rejected because rollback and lexical/semantic availability during a failed rebuild are existing guarantees. Old-generation cleanup remains ordinary maintenance.

### 4. Put local model comparison beside the local embedder

Add a deterministic opt-in benchmark entry point under `packages/extension-embedding-local`. It runs the same fixed Russian/English query-document cases through explicit q4/256 and q8/384 profile definitions, computes ranking/retrieval metrics, and records cold acquisition, warm single-query and batch latency, peak RSS delta, and verified cache byte totals. The benchmark writes a versioned JSON report and never changes canonical memory or vector indexes.

The existing `extension-memory-vectors` backend benchmark remains unchanged except for any shared documentation links. Its synthetic 12-dimensional corpus must not be relabeled as model-quality evidence.

Alternative considered: embed the real model comparison into the vector-backend benchmark. Rejected because that would cross the package boundary from vector backends into the local provider and conflate model quality with backend behavior.

### 5. Update only explicit semantic configurations

Change `aiden-semantic` and documented Chroma/Qdrant/pgvector examples from 256 to 384. SQLite exact remains the local default backend. Presets without semantic rows remain valid and do not acquire model artifacts. MiniLM examples, if present, remain 384 and retain their current identity.

### 6. Record evidence without hard-coding unsupported defaults

The benchmark report records measurements and environment metadata. It may recommend q8/384 only after the fixture demonstrates the expected quality contract and the measured resource cost is documented. Existing operational defaults such as semantic top-K, timeout, and coordinator batch size are not changed solely because vector width changed; any change requires explicit evidence and a separate documented rationale.

## Risks / Trade-offs

- **q8 resource cost:** q8 artifacts are materially larger than q4, increasing first-use download/cache size and likely memory use. The benchmark and cache-byte assertions make this visible before preset rollout.
- **Latency variance:** cold model acquisition and accelerator availability dominate local timings. Reports separate cold and warm measurements, include device/runtime metadata, and avoid presenting one machine's result as a universal SLA.
- **Quality uncertainty:** 384 dimensions are supported by the model's MRL design, but application quality must be measured on the repository fixture. A failed or inconclusive benchmark blocks claiming an improvement; it does not justify retaining mixed spaces.
- **Existing installations:** users with only q4 cache artifacts may see a new acquisition or an offline-unavailable error. This is intentional: accepting q4 artifacts under a q8 identity would violate cache integrity and generation isolation.
- **Index rebuild duration:** every active canonical revision must be re-embedded. The coordinator's existing bounded pages, retries, interruption behavior, and retained-generation rollback contain this operational cost.
- **Upstream artifact drift:** the revision is pinned, but manifest metadata can still be transcribed incorrectly. Tests must verify the exact q8 paths, byte counts, SHA-256 values, and identity digest before any real smoke is treated as valid.
- **Security posture:** switching quantization does not remove the reviewed native/image dependency advisories. The existing trusted-pinned-artifact restriction remains part of deployment guidance.
