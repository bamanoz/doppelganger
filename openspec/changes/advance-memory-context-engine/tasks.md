## 0. Required Backend Prerequisite

- [ ] 0.1 Complete `add-sqlite-postgresql-memory-backends`, including the asynchronous `MemoryRepository`/`MemoryUnitOfWork`, both canonical providers, bounded asynchronous projection ownership, canonical schema version 5, migration/transfer, and mandatory real-PostgreSQL gate; do not begin this change's implementation before that contract is complete

## 1. Prerequisite, Protocol, and Storage Foundation

- [ ] 1.1 Extend `ContextProvider` with provider-scoped accepted/omitted source receipts and contain callback failures after final context assembly
- [ ] 1.2 Add context protocol tests for exact provider receipts, missing turn IDs, omission accounting, callback failure containment, and unchanged hard-budget behavior
- [ ] 1.3 Define and validate context-projector identity, revision projection, checkpoint projection, query expansion, and relation contracts in `extension-memory`
- [ ] 1.4 Export the projector contracts and add Loader-compatible `context-projector`, `context-engine`, and `working-context` package subpaths with strict Schemastery configuration
- [ ] 1.5 Implement canonical schema version 6 through both repository providers with additive projection, extraction, working-context, usage, relation, and bounded health tables and indexes
- [ ] 1.6 Add SQLite and PostgreSQL version-5-to-version-6 migration tests covering transaction rollback, preserved canonical identifiers/content, provider fingerprint validation, and rejection of malformed new state; extend offline transfer to preserve the complete version-6 logical state in both directions
- [ ] 1.7 Extend hard deletion through the shared unit of work to remove every local derived row and preserve identifier-only remote deletion work before canonical rows disappear
- [ ] 1.8 Add both-provider deletion tests covering presentation tiers, groups, relations, usage, queues, checkpoints, embedding cache, semantic markers, and repeated deletion

## 2. Retrieval and Progressive Context Planning

- [ ] 2.1 Refactor the asynchronous `MemoryService.search` path into reusable candidate gathering through the selected repository plus the existing tool-compatible L2 result budgeting
- [ ] 2.2 Preserve stable-profile, provider-owned lexical, semantic, reciprocal-rank, subject-diversity, final bulk canonical-snapshot, and failure-fallback behavior through the retrieval refactor on both canonical providers
- [ ] 2.3 Add optional bounded query expansion with original-query preservation, deterministic branch fusion, timeout/malformed-output fallback, and sanitized diagnostics
- [ ] 2.4 Add partition-safe subject-prefix lookup and bounded group-to-child expansion before canonical candidate revalidation
- [ ] 2.5 Add bounded one-hop advisory relation expansion with stale, deleted, cross-partition, and superseded target rejection
- [ ] 2.6 Implement lane classification and configurable weights/maximum shares for pinned preferences, approved preferences, stable identity, project decisions, procedures, and ordinary facts
- [ ] 2.7 Implement deterministic unused-quota redistribution, subject diversity, stable tie-breakers, and no-budget-overrun invariants
- [ ] 2.8 Implement complete L0/L1/L2 tier selection with breadth-first placement, depth-first upgrades, exact incremental token accounting, and omission when no complete tier fits
- [ ] 2.9 Enforce canonical L2-only instruction authority for approved preferences and data authority for identity facts, checkpoints, generated tiers, groups, and relations
- [ ] 2.10 Emit provenance-bearing memory source IDs and headers without enabling outer `ContextProtocol` truncation
- [ ] 2.11 Add `memory-context-planner.spec.ts` coverage for stable precedence, generated preference safety, quotas, breadth/depth upgrades, complete-tier omission, deterministic ordering, and authored-Persona authority
- [ ] 2.12 Update `memory-protocol.spec.ts` to prove stable-profile deduplication, hard final budgets, L2-only fallback when projections are absent, and exact accepted-source usage handoff

## 3. Presentation, Hierarchy, and Relation Projection Engine

- [ ] 3.1 Implement context projection generation identities covering projector identity and presentation, hierarchy, and relation format versions through provider-neutral detached contracts
- [ ] 3.2 Implement atomic publication and lookup of validated current L0/L1 revision tiers with canonical record/revision provenance on both repositories
- [ ] 3.3 Reject malformed, oversized, credential-bearing, recursive, stale, or partial projector output while retaining the prior compatible valid generation
- [ ] 3.4 Implement leaseable idempotent local projection work for revision, subject-group, and relation jobs through bounded asynchronous memory-owned operations with routing identity, lease-token fencing, bounded attempts, current-source acknowledgment, and sanitized failure categories
- [ ] 3.5 Enqueue configured revision projection work transactionally from remember, promotion, correction, conflict resolution, pin-relevant updates, and deletion paths through the active `MemoryUnitOfWork`
- [ ] 3.6 Derive bounded subject ancestors from dot-separated validated `subjectKey` segments and maintain exact actor/scope/project group membership
- [ ] 3.7 Build deterministic bounded subject-group catalogs and optionally replace them with validated projector summaries under a distinct generation identity
- [ ] 3.8 Validate and persist revision-bound advisory relations with the closed vocabulary, edge limits, no self-links, and exact partition checks
- [ ] 3.9 Converge stale revision, group, and relation work after correction, deactivation, expiry, deletion, worker restart, and repeated delivery
- [ ] 3.10 Register `memory.projections.rebuild` and bounded projection status through the existing tool protocol
- [ ] 3.11 Add `memory-context-projections.spec.ts` coverage for atomic tier publication, secret rejection, idempotent work, stale convergence, dependency enqueue, rebuild, and optional-projector fallback
- [ ] 3.12 Add `memory-hierarchy.spec.ts` and `memory-relations.spec.ts` coverage for stable ancestors, partition isolation, bounded expansion, invalid edges, stale targets, and conflict separation

## 4. Durable Committed-Turn Extraction

- [ ] 4.1 Replace inline capture work with a bounded listener transaction through the selected repository that deduplicates completed committed deliveries and persists filtered extraction jobs
- [ ] 4.2 Preserve omission, `enabled: false`, incomplete-turn skip, recursive-content filtering, trivial-content filtering, credential rejection, and candidate-only semantics
- [ ] 4.3 Implement serialized leaseable extraction workers with bounded exponential retry, expiry, restart recovery, and no new claims during disposal
- [ ] 4.4 Validate and persist the complete extracted candidate list by stable ordinal before applying any canonical candidate mutation
- [ ] 4.5 Deliver persisted candidates through `MemoryService.propose` using `capture:<deliveryId>:<ordinal>` operation IDs and converge repeated delivery through canonical receipts
- [ ] 4.6 Remove content-bearing committed-turn payload and candidate rows after terminal success and purge terminal/abandoned payloads at bounded expiry
- [ ] 4.7 Keep semantic-neighbor suggestions advisory and best-effort after candidate delivery without controlling job success or host turn outcome
- [ ] 4.8 Expose bounded extraction queue counts, lag, retry categories, terminal failures, and last failure time without turn or candidate content
- [ ] 4.9 Rewrite `memory-capture.spec.ts` and add `memory-extraction-queue.spec.ts` for listener latency, delivery deduplication, persisted ordinals, crash recovery, retry, expiry, fail-open behavior, and shutdown
- [ ] 4.10 Update the OMP committed-turn vertical to prove durable queue persistence, restart drain, candidate-only effects, incomplete-output skip, and no host-specific memory route

## 5. Working Context Checkpoints

- [ ] 5.1 Implement the optional working-context plugin with bounded committed-turn retention by count, token estimate, session partition, and expiry through either canonical provider
- [ ] 5.2 Reuse recursive-memory and credential filtering before persisting any working-turn material
- [ ] 5.3 Enqueue immutable turn-range checkpoint jobs in the active provider transaction only when configured thresholds are exceeded and a checkpoint projector is available
- [ ] 5.4 Atomically publish a validated checkpoint, retain the configured recent raw tail, and delete superseded covered material
- [ ] 5.5 Register a session-scoped data-authority checkpoint context provider below authored Persona and stable-profile precedence without duplicating the recent raw tail
- [ ] 5.6 Delete session working state on disposal, recover expired leases after crashes, and preserve the previous valid checkpoint on projector failure
- [ ] 5.7 Add both-provider `memory-working-context.spec.ts` coverage for compaction thresholds, canonical/tool separation, partition isolation, failure fallback, disposal, expiry, and omission neutrality

## 6. Usage Feedback and Pipeline Diagnostics

- [ ] 6.1 Persist idempotent usage receipts through the selected repository only from final accepted memory source IDs with exact session, turn, record, and revision identity
- [ ] 6.2 Maintain bounded per-revision usage rollups and cleanup retention without storing query or contribution content on either provider
- [ ] 6.3 Apply capped logarithmic-frequency and decayed-recency hotness only after base retrieval and canonical eligibility
- [ ] 6.4 Ensure correction, deletion, expiry, inactive status, conflicts, partition mismatch, and stale revisions nullify every usage ranking effect
- [ ] 6.5 Add `memory-usage-ranking.spec.ts` for repeated resolution idempotency, capped ordering influence, deterministic ties, revision cutover, and eligibility precedence
- [ ] 6.6 Add `memory.pipeline.status` with bounded stage counts, duration summaries, budget/tier/fallback/zero-result metrics, queue state, generation IDs, and sanitized last failures
- [ ] 6.7 Add `memory-diagnostics.spec.ts` proving secret-free bounded status, repeated-failure aggregation, queue lag, stale projection reporting, and zero-result visibility

## 7. Semantic Projection Generalization

- [ ] 7.1 Extend semantic contracts with explicit `record-l2`, `record-l1`, `record-l0`, and `subject-group` projection identities and filters
- [ ] 7.2 Preserve deterministic legacy record-L2 external identities while assigning kind-aware identities to new projection kinds
- [ ] 7.3 Extend semantic generation fingerprints with sorted projection kinds and compatible presentation/hierarchy generation identities
- [ ] 7.4 Generalize bounded asynchronous projection work loading, routing, leasing, delivery, current-source acknowledgment, deletion, indexed markers, rebuild paging, and canonical revalidation by projection kind without exposing repository, ORM, SQL, or raw-connection access to the coordinator
- [ ] 7.5 Keep vector coordinator configuration defaulted to `record-l2` and reject generated kinds without a compatible active local projection generation
- [ ] 7.6 Rebuild, verify, compare-and-swap activate, and retain all configured projection kinds through durable provider-owned generation transitions only after per-kind expected/current/stale verification succeeds
- [ ] 7.7 Extend semantic status and maintenance with bounded per-kind counts, projection lag, retained-generation cleanup, and unchanged secret redaction
- [ ] 7.8 Migrate SQLite exact vector schema and tests for projection-kind identity, filters, idempotent upsert/delete, and prior L2 state handling
- [ ] 7.9 Migrate pgvector schema and tests for projection-kind identity, filters, dimensions, HNSW maintenance, and transactional schema change
- [ ] 7.10 Migrate Chroma collections and tests for generation-isolated projection metadata, bounded filters, stale-hit rejection, and credential redaction
- [ ] 7.11 Migrate Qdrant payloads and tests for deterministic kind-aware point IDs, generation filters, stale-hit rejection, and credential redaction
- [ ] 7.12 Extend coordinator tests for multi-kind rebuild success, interrupted rebuild isolation, projector identity changes, retry, rollback compatibility, per-kind diagnostics, and lexical fallback

## 8. Loader Integration and Documentation

- [ ] 8.1 Add generated disposable Runtime Presets for SQLite and PostgreSQL that exercise independent omission and activation of capture, context-engine, working-context, projector, embedder, vector index, and coordinator rows in matching isolation realms
- [ ] 8.2 Add Loader tests for both canonical providers, strict config rejection, missing projector methods, duplicate services, row removal, reload cutover, stale workers, and exhaustive Fiber disposal
- [ ] 8.3 Update `docs/features/memory.md` with progressive tiers, planner authority, hierarchy, durable extraction, working checkpoints, usage feedback, relations, storage retention, and primary implementation ownership
- [ ] 8.4 Update `docs/operations/semantic-memory.md` with projection kinds, projector/generation identity, rebuild order, per-kind status, rollout, rollback, cleanup, performance, and privacy constraints
- [ ] 8.5 Update `docs/operations/verification.md` with behavioral proof requirements for planner budgets, queue recovery, checkpoint disposal, usage receipts, relation validation, and multi-kind semantic generations
- [ ] 8.6 Update `docs/project/status-and-scope.md` with the implemented memory-context acceptance criteria and unchanged deferred boundaries
- [ ] 8.7 Reconcile every planned scenario evidence reference with exact Vitest names and run `npm run check:focused-specs -- --change advance-memory-context-engine` during implementation
- [ ] 8.8 Run package-local typechecks and focused tests while iterating, then run the mandatory SQLite/PostgreSQL backend gate, `npm run check`, and real generated-preset OMP smokes for both canonical providers before handoff
