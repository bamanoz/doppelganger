## Why

Doppelganger's canonical memory has stronger mutation safety, provenance, isolation, and degraded operation than broad context-database designs, but its retrieval and extraction layers still treat records mostly as flat, whole-text units. After `add-sqlite-postgresql-memory-backends` establishes the asynchronous `MemoryRepository`/`MemoryUnitOfWork` contract and complete SQLite and PostgreSQL providers at canonical schema version 5, the memory engine should gain progressive, hierarchical, budget-aware context assembly and durable asynchronous learning on both providers while preserving canonical authority, candidate review, actor/project isolation, and lexical fallback.

## What Changes

- Add rebuildable L0 abstract and L1 overview projections alongside canonical L2 revision content, with progressive breadth-first-then-depth context assembly under a hard token budget.
- Derive a subject hierarchy from stable `subjectKey` prefixes and use non-authoritative group summaries to guide retrieval before selecting canonically eligible records.
- Replace best-effort inline automatic extraction with a durable, idempotent committed-turn extraction queue that recovers after restart and only creates review candidates.
- Add bounded working-memory checkpoints that compress older committed session material without making transcripts or checkpoints authoritative long-term memory.
- Add configurable retrieval quotas for stable profile, preferences, identity facts, project decisions, procedures, and ordinary facts, with deterministic redistribution of unused budget.
- Add optional bounded query expansion whose failure preserves the existing complete lexical query and deterministic hybrid retrieval.
- Record bounded usage feedback for contributed memory and apply a capped recency/frequency hotness boost that cannot bypass canonical eligibility, authority, or conflict rules.
- Add rebuildable semantic relations between current revisions for retrieval expansion and provenance navigation while retaining `memory_conflicts` as the only authoritative contradiction workflow.
- Add bounded, secret-free retrieval and extraction diagnostics covering stage latency, fallbacks, stale-hit rejection, budget use, projection tiers, queue state, and zero-result queries.
- Preserve canonical records in the selected repository, immutable revisions, mutation receipts, candidate review, evidence, conflicts, hard deletion, actor/project partitioning, each provider's indexed lexical retrieval, and optional semantic fallback as the authoritative and always-available foundation.
- Implement the design independently; do not add an OpenViking runtime dependency or copy AGPL implementation code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `persona-memory`: Extend committed-turn extraction, working memory, retrieval planning, authority-safe context assembly, usage feedback, semantic relations, and diagnostics while preserving the canonical mutation model.
- `memory-semantic-indexes`: Extend derived-generation contracts to cover revision summaries, subject-group summaries, relation projections, durable projection work, rebuilds, and failure containment.

## Impact

- Primary packages: `packages/extension-memory`, `packages/extension-memory-vectors`, the SQLite and PostgreSQL canonical providers, and the configured capture/extractor Loader rows.
- Host lifecycle remains transport-neutral and continues to consume only completed committed-turn events; no host-specific memory path is introduced.
- This change depends on the completed asynchronous repository/unit-of-work and bounded projection-store cutover from `add-sqlite-postgresql-memory-backends`. Canonical schema version 5 is reserved for that backend change; this change adds its durable extraction, projection, usage, relation, and working-checkpoint state in schema version 6 through both providers and their migration/transfer contracts.
- Memory context output changes from whole-record-only selection to deterministic progressive tiers, but existing authority, partition, status, temporal, revision, and hard-budget checks remain mandatory.
- Existing memory tools remain compatible; new operator diagnostics or maintenance controls may be added through the existing namespaced tool protocol.
- Affected documentation: `docs/features/memory.md`, `docs/operations/semantic-memory.md`, `docs/operations/verification.md`, and `docs/project/status-and-scope.md`.
- No mandatory external service, Python runtime, or additional canonical storage backend is introduced.