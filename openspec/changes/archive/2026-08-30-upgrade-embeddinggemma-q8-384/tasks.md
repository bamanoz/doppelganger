## 1. Upgrade the local EmbeddingGemma profile

- [x] 1.1 Verify the pinned revision's q8 artifact paths, byte counts, per-file SHA-256 values, and the repository's artifact-digest derivation convention from the upstream manifest and existing identity helpers.
- [x] 1.2 Update `packages/extension-embedding-local/src/models.ts` so `embeddinggemma-300m` requests q8, uses the verified `model_quantized.onnx` artifact pair, and declares `mrl-truncate-384-l2`, 384 dimensions, and the regenerated immutable artifact digest.
- [x] 1.3 Update local embedder contract tests to assert q8 identity metadata, exact artifact manifest, 384-dimensional normalized output, CPU fallback identity preservation, plugin activation identity, and q8 cache rejection when only legacy q4 artifacts are present.
- [x] 1.4 Preserve MiniLM's explicit 384-dimensional compatibility identity and verify that model selection, lazy loading, prefixes, source-dimension validation, offline diagnostics, and disposal behavior remain unchanged.

## 2. Add reproducible model-profile evidence

- [x] 2.1 Define a versioned fixed Russian/English query-document fixture with expected relevant and forbidden relationships suitable for comparing EmbeddingGemma q4/256 and q8/384 without using canonical memory or a vector backend.
- [x] 2.2 Add an opt-in local-embedder benchmark entry point and package script that runs both profiles against the same fixture and records model identity, Node/platform/architecture, device, cold acquisition latency, warm query/document latency, batch throughput, peak RSS delta, and verified cache byte totals.
- [x] 2.3 Implement deterministic quality metrics and report validation for bilingual retrieval, including expected-hit recall, reciprocal rank, forbidden-hit count, sample counts, and explicit unavailable/failure states when required model artifacts or opt-in execution are absent.
- [x] 2.4 Run the q4/256 versus q8/384 benchmark on the supported local environment, preserve the versioned JSON evidence, and document observed quality, latency, cold-start, memory, and cache/index-size trade-offs without presenting one machine's measurements as a universal SLA.

## 3. Prove generation-safe migration

- [x] 3.1 Add semantic identity tests proving q4/256 and q8/384 produce distinct embedder and generation identities while MiniLM remains distinct from both EmbeddingGemma spaces.
- [x] 3.2 Add coordinator migration coverage showing a configured q8/384 stack rebuilds from canonical content, never copies or resizes q4/256 vectors, verifies the new generation, and activates it only after successful completion.
- [x] 3.3 Add failure and interruption coverage showing an incomplete q8/384 rebuild leaves the previous q4/256 generation active and that later retry can complete from canonical state.
- [x] 3.4 Verify backend dimension checks and generation isolation remain parameterized and unchanged for SQLite exact, Chroma, Qdrant, and pgvector; update only fixtures whose stated EmbeddingGemma dimension is 256.

## 4. Update semantic presets and documentation

- [x] 4.1 Change `dev/doppelganger/.runtime-presets/aiden-semantic/runtime.cordis.yml` to configure 384 dimensions and retain explicit EmbeddingGemma, SQLite exact, isolation, and disabled-capture behavior.
- [x] 4.2 Update README semantic examples and profile descriptions from EmbeddingGemma q4/256 to q8/384, while retaining SQLite exact as the local default and MiniLM as explicit compatibility configuration.
- [x] 4.3 Update `docs/features/memory.md` and `docs/operations/semantic-memory.md` with q8 cache expectations, q4-to-q8 rebuild/rollback procedure, measured benchmark evidence, cache-size trade-offs, and unchanged trusted-pinned-artifact security guidance.
- [x] 4.4 Update the authoritative `openspec/specs/memory-semantic-indexes/spec.md` from 256-dimensional EmbeddingGemma behavior to q8/384 and ensure no stale 256-dimensional default wording remains in maintained docs or preset examples.

## 5. Verify the complete change

- [x] 5.1 Run focused typechecks and tests for `extension-embedding-local`, `extension-memory`, and `extension-memory-vectors`, including generation migration and benchmark contract tests.
- [x] 5.2 Run the real opt-in local inference smoke with the verified q8 cache and confirm Russian/English similarity, 384-dimensional normalized output, offline reuse, and accelerator fallback where available.
- [x] 5.3 Exercise the real `aiden-semantic` Runtime Preset through the project-local OMP extension, confirming q8/384 activation, rebuild behavior, semantic fallback to lexical retrieval, and clean shutdown.
- [x] 5.4 Run `npm run check` plus the repository documentation/live-spec and security checks; record unavailable external-service smokes explicitly and confirm package boundaries and single-Cordis enforcement remain unchanged.

Verification note (2026-08-30): the real Chroma, Qdrant, and pgvector service smokes remained unavailable because `CHROMA_SMOKE_URL`, `QDRANT_URL`, and `DOPPELGANGER_TEST_PGVECTOR_DSN` were not configured. Their fake/conformance suites and the real SQLite exact path passed. `npm run check`, strict OpenSpec validation, and the reviewed production security baseline passed; the baseline still contains the four documented high-severity transitive advisories with no compatible fixes.
