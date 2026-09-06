## Context

The implementation baseline for this change is the completed `add-sqlite-postgresql-memory-backends` cutover, not the current synchronous SQLite implementation. That prerequisite establishes canonical schema version 5, complete MikroORM-backed SQLite and PostgreSQL repository providers, one shared domain policy, an asynchronous `MemoryRepository`/bounded `MemoryUnitOfWork`, fresh final canonical snapshots, and a bounded asynchronous memory-owned projection interface.

The memory implementation retains a deliberately narrow retrieval path:

- `MemoryService` owns actor/project partitioning, immutable revisions, receipts, evidence, conflicts, canonical revalidation, stable-profile selection, and rank fusion independently of the selected provider.
- Each repository provider owns its indexed lexical dialect, schema lifecycle, and transaction implementation; provider details do not cross the detached domain boundary.
- `protocol.ts` turns complete canonical revisions into context contributions. Preferences receive instruction authority; all other kinds receive data authority. The outer `ContextProtocol` applies the final hard budget.
- `capture.ts` consumes only completed `turn-committed` lifecycle events. Stable candidate operation IDs already derive from `(deliveryId, ordinal)`.
- The bounded asynchronous projection interface owns identifier-only durable vector work, leases, retries, generation rebuild, atomic activation, routing, fencing, and post-I/O canonical acknowledgment on both canonical providers. The semantic coordinator receives no repository, ORM, SQL, or raw connection access.
- Vector identity currently represents only `(generationId, recordId, revisionId)`. Semantic generations cover embedder and backend identity, not presentation format or hierarchy projections.
- `ContextProtocol` knows which contributions survive final cross-provider budgeting, but providers do not receive an acceptance receipt. Memory therefore cannot accurately record usage for only the revisions actually delivered.

The change must preserve the existing authority boundary: the selected canonical repository remains authoritative; generated summaries, checkpoints, hierarchy nodes, usage signals, semantic relations, and remote vectors remain derived data. It must also preserve each provider's complete lexical recall when every optional projector, query planner, worker, embedder, or vector backend is absent or failing.

No OpenViking runtime or code is introduced. The design adopts the useful architectural ideas—progressive tiers, directory-like navigation, bounded session checkpoints, asynchronous extraction, and retrieval feedback—inside Doppelganger's existing Cordis, canonical-memory, lifecycle, and projection contracts.

## Goals / Non-Goals

**Goals:**

- Provide complete L0 abstract, L1 overview, and canonical L2 representations with deterministic provenance and no text truncation masquerading as canonical content.
- Assemble automatic memory context breadth-first, then spend remaining budget on depth upgrades, while preserving authority and a hard token limit.
- Guide retrieval through validated `subjectKey` prefixes and bounded subject-group projections.
- Make committed-turn extraction durable, restart-safe, idempotent, candidate-only, fail-open to host work, and transactional through either canonical provider.
- Add optional bounded working-memory checkpoints without making transcript material canonical memory.
- Add optional query expansion, capped usage hotness, and advisory semantic relations without bypassing canonical eligibility.
- Extend semantic generations and vector entries so configured L0, L1, and subject-group projections can be indexed safely.
- Expose bounded secret-free diagnostics for the new pipelines.
- Keep current memory tools compatible, pass the context-engine contract on both canonical providers, and keep omission of every new Loader row behaviorally valid.

**Non-Goals:**

- No new canonical memory backend, graph database, daemon, Python runtime, or mandatory external service.
- No automatic promotion of extracted candidates and no weakening of evidence, conflict, correction, or deletion rules.
- No model-authored identity or trait changes and no generated instruction authority.
- No full transcript archive, cross-Persona sharing, cross-actor retrieval, or project-scope leakage.
- No unbounded graph traversal, autonomous planning loop, agent loop, or replacement of host conversation history.
- No requirement that a presentation or checkpoint projector be model-based. The first implementation exposes a provider contract and uses deterministic fixtures in tests; feature rows remain optional.
- No relation-based conflict resolution. `memory_conflicts` remains the only authoritative contradiction workflow.
- No change to host lifecycle vocabulary or host-specific memory transport.

## Decisions

### 1. Keep canonical memory central; split optional workers by lifecycle

`MemoryService` remains the only domain mutation owner and the package root remains responsible for canonical tools, retrieval, and automatic recall. The selected SQLite or PostgreSQL `MemoryRepository` owns persistence behind the prerequisite asynchronous contract. New derived behavior is mounted through ordinary optional Cordis plugins in the same package:

- `@doppelganger/doppelganger-memory/capture`: existing public subpath, changed from inline extraction to durable queued extraction.
- `@doppelganger/doppelganger-memory/context-engine`: presentation tiers, subject groups, advisory relations, projection rebuild, and their worker.
- `@doppelganger/doppelganger-memory/working-context`: committed-turn tail retention and session checkpoints.
- `@doppelganger/doppelganger-memory/context-projector`: optional projector service contract entrypoint; concrete providers may implement a subset of capabilities.

All canonical and derived state is accessed through the asynchronous repository/unit-of-work and bounded projection interfaces. Optional plugins inject `doppelgangerMemory` and use domain-oriented or purpose-bounded methods; they do not obtain ORM entities, an EntityManager, SQL statements, a raw connection, or an unrestricted transaction escape hatch. Canonical mutation plus dependent work enqueue uses the selected provider's existing transaction.

The context engine and working-context rows require a configured `doppelgangerMemoryContextProjector` only for operations that need generated text. Absence is valid:

- retrieval remains canonical L2 plus the selected provider's indexed lexical search and any configured semantic L2 index;
- no L0/L1 or checkpoint generation work accumulates;
- deterministic subject-prefix navigation may still operate from canonical metadata;
- query expansion and generated relations are skipped.

Alternative: place every worker in the package-root plugin. Rejected because capture, working context, and projection generation have independent lifecycle, retention, failure, and deployment costs. Omission must remain the disabled state.

Alternative: create a new top-level package for the context engine. Rejected because every contract uses canonical memory identities and no independent package boundary is gained.

### 2. Use one capability-based context projector seam

Add a transport-free `MemoryContextProjector` service contract in `extension-memory`:

```ts
interface MemoryContextProjectorIdentity {
  readonly provider: string
  readonly modelId: string
  readonly revision: string
  readonly configFingerprint: string
}

interface MemoryContextProjector {
  readonly identity: MemoryContextProjectorIdentity
  projectRevision?(request: MemoryRevisionProjectionRequest): Promise<MemoryRevisionProjectionResult>
  projectCheckpoint?(request: MemoryCheckpointProjectionRequest): Promise<MemoryCheckpointProjectionResult>
  expandQuery?(request: MemoryQueryExpansionRequest): Promise<MemoryQueryExpansionResult>
  relate?(request: MemoryRelationProjectionRequest): Promise<MemoryRelationProjectionResult>
}
```

Every request and result is bounded, JSON-compatible except for no binary data, validated at the owning seam, and carries only the minimum canonical or session material required for that operation. Optional methods avoid forcing one provider to implement unrelated model tasks. Provider identity is included only in derived generation identities, never Runtime Session metadata.

Generated revision output contains zero or one L0 and zero or one L1 string. Generated checkpoint output contains one bounded data-only string. Query expansion returns at most the configured count of bounded strings. Relation output uses the closed relation vocabulary and opaque source/target identities.

Alternative: separate four Cordis services. Rejected for the first implementation because it multiplies Loader rows and duplicate model ownership without creating a proven isolation boundary. Method-level capabilities preserve optionality.

Alternative: call a host model directly. Rejected because portable extensions do not receive a host model or private agent runtime, and hosts must remain preset-neutral.

### 3. Add additive provider-owned tables but keep them non-canonical

After the backend prerequisite reserves and installs canonical schema version 5, bump both canonical providers from version 5 to version 6 through their explicit migration histories. Existing canonical tables and identifiers remain unchanged. SQLite and PostgreSQL represent the same logical additions with provider-owned DDL and mappings:

- `memory_context_projection_generations`: projector identity, format version, state, timestamps, sanitized failure category.
- `memory_revision_presentations`: `(generation, record, revision, tier)`, content digest, complete validated content, token estimate, created time.
- `memory_subject_groups`: exact actor/scope/project partition, validated subject prefix, child-set digest/count, bounded summary/catalog, token estimate.
- `memory_relations`: relation generation, exact source and target record/revision identities, closed relation type, bounded normalized weight, timestamps.
- `memory_context_projection_work`: identifier-only jobs for revision, group, and relation projection with canonical-store/generation/route ownership, unique lease token, renewal/retry state, and bounded expiry.
- `memory_extraction_jobs`: committed delivery identity, partition/session/turn identity, bounded filtered principal and assistant material, state, unique lease token, retry state, and expiry.
- `memory_extraction_candidates`: stable `(job, ordinal)` validated output persisted before canonical candidate effects.
- `memory_working_turns`: bounded filtered completed-turn material partitioned by instance, actor, and session with expiry.
- `memory_working_checkpoints`: current checkpoint generation, covered turn range/digest, bounded content, expiry.
- `memory_working_checkpoint_work`: identifier-only checkpoint jobs with canonical-store/session/projector ownership, unique lease token, renewal/retry state, and bounded expiry.
- `memory_usage_receipts`: idempotent `(instance, actor, session, turn, record, revision)` delivery receipt without query or content.
- `memory_usage_rollups`: bounded count and last-used time per current revision, rebuildable from retained receipts.
- `memory_pipeline_health`: one bounded last-state row per stage and partition; no payload or exception text.

Provider-enforced references and deletion constraints are used wherever deletion semantics permit. Identifier-only remote deletion work remains valid after canonical content deletion, so it continues to avoid content-bearing references.

Hard deletion removes revision presentations, hierarchy membership, local relations, usage rows, pending local projection work, embedding cache, and semantic indexed markers transactionally with canonical deletion. It enqueues or preserves opaque remote deletion work before deleting canonical rows.

Content-bearing extraction jobs and working turns use explicit expiry columns. Successful extraction deletes principal/assistant job material after stable candidate rows have been delivered; terminal failure deletes it at bounded expiry. Superseded working turns and checkpoints are deleted immediately when no longer needed. The design does not claim encryption at rest; filesystem or server storage protection remains an operator responsibility.

Alternative: store generated tiers as new `memory_records`. Rejected because it would contaminate revision history, tools, evidence, conflicts, authority, and deletion semantics.

Alternative: store queues outside the selected canonical repository. Rejected because canonical mutation plus work enqueue must share one provider transaction and transfer as one logical durable state.

### 4. Separate retrieval candidates from presentation planning

Keep the public `MemoryService.search()` contract canonical and tool-compatible: `memory.search` continues to return eligible active canonical records and enforces its supplied token budget against L2 content.

Add asynchronous internal APIs returning detached immutable values:

- `retrieve(request): Promise<MemoryRetrievalCandidate[]>` gathers candidates through the selected provider and optional semantic services.
- `planContext(request, candidates): MemoryContextPlan` chooses authority class, category, tier, and ordering after the final snapshot, without further I/O.
- `recordContextUsage(receipt): Promise<void>` persists accepted canonical revision usage idempotently.

Retrieval branches are:

1. canonical stable profile;
2. original-query indexed lexical search through the selected provider;
3. optional expanded-query lexical branches through the selected provider;
4. optional semantic record hits;
5. optional semantic subject-group hits expanded into current canonical children;
6. bounded one-hop advisory relation expansion.

Each branch produces ranks only. Deterministic weighted reciprocal-rank fusion combines them. After all optional asynchronous retrieval completes, one short bulk canonical snapshot through the selected repository reloads every stable and ranked candidate together with compatible generation state. Before planning, that snapshot applies the existing actor, scope, status, temporal, record, and current-revision checks. Group and relation expansion occurs before this final canonical revalidation, never after it; planning performs no later database I/O.

The original complete normalized principal turn always drives the selected provider's indexed lexical search. The existing bounded semantic query projection remains only the semantic input. Query expansion has a separate short deadline and count/character limits; failure records a sanitized diagnostic and contributes no branch.

Alternative: make generated subject summaries directly recallable memory. Rejected because a navigation projection must not become an authority-bearing record.

### 5. Plan memory context breadth-first, then depth-first

The planner builds ordered authority/category lanes:

1. pinned relationship preferences, canonical L2 instruction only;
2. query-matched approved preferences, canonical L2 instruction only;
3. stable relationship identity facts, data;
4. project decisions, data;
5. procedures, data;
6. ordinary facts and remaining decisions, data.

Defaults are expressed as integer weights, not fixed token amounts. Configuration provides per-lane weight and optional maximum share. Zero disables a lane. Positive weights are normalized against the current hard budget. Unused allocation is redistributed in the same lane order to candidates that remain below their configured maximum; the total never exceeds the provider budget.

Within a lane, ranking uses fused retrieval score, then capped hotness, then salience, then stable record/revision identity. One candidate per `subjectKey` is selected before repeated subjects.

Presentation tiers are:

- L0: complete current abstract projection;
- L1: complete current overview projection;
- L2: complete canonical current revision.

Instruction-authority preferences have only L2 as an eligible tier. Every other candidate starts at its cheapest complete available tier. If none fits, it is omitted. This is the breadth pass. The planner then revisits accepted candidates in deterministic rank order and pays only the incremental token cost for L0→L1→L2 upgrades. It never emits substring truncation and sets `truncate: false` on every memory contribution.

Contribution sources encode provenance, for example `memory.<recordId>.<revisionId>.l1`, while displayed headers identify the record kind, scope, subject, tier, and canonical revision. Generated text is always data authority. Canonical preferences retain their current instruction authority.

The outer `ContextProtocol` remains the final global budget authority. It may still omit lower-priority memory contributions when authored Persona or another provider consumes budget first. Memory planning never assumes it owns the entire assembled context.

Alternative: choose depth for the highest-ranked record before breadth. Rejected because it recreates whole-record domination and lowers topic coverage.

Alternative: let `ContextProtocol` truncate L2 content. Rejected because partial procedures, decisions, or preferences can change meaning and generated tiers must be distinguishable from canonical content.

### 6. Add provider-scoped context acceptance receipts

Extend `ContextProvider` in `extension-protocols` with one optional in-process callback:

```ts
interface ContextProviderAcceptance {
  readonly turnId?: string
  readonly acceptedSources: readonly string[]
  readonly omittedSources: readonly string[]
  readonly tokenCount: number
}

interface ContextProvider {
  readonly id: string
  resolve(...): ...
  accepted?(receipt: ContextProviderAcceptance): void | Promise<void>
}
```

`ContextProtocol.resolve()` computes the final assembled context first, then invokes each provider's callback with only that provider's exact accepted and omitted source IDs. Callback failures are contained with `Promise.allSettled` and cannot change or fail the already assembled context.

The memory provider parses only its own structured source IDs and records a usage receipt only when:

- `turnId` is present;
- the accepted source represents a canonical record/revision tier;
- the revision is still current and eligible;
- the same session/turn/revision receipt does not already exist.

L0/L1 acceptance increments the usage of their canonical source revision. Subject-group contributions do not increment every child; only a canonical child tier accepted into context records usage.

Alternative: record usage when memory returns a contribution. Rejected because the outer assembler may omit it.

Alternative: add a new transported host lifecycle event. Rejected because acceptance is fully known inside the host-neutral context protocol and no host integration is needed.

### 7. Cap hotness after eligibility and base retrieval

Maintain a rollup per canonical current revision:

```text
hotness = min(maximumBoost,
  recencyWeight * exp(-age / halfLife) +
  frequencyWeight * log1p(cappedCount))
```

Configuration bounds `maximumBoost`, `halfLife`, and retained receipt count/age. The value is used only as a tie-adjustment after a candidate is already retrieved and canonically eligible. It cannot create a candidate, change authority, change confidence or salience, promote a candidate, or bypass conflict and temporal rules.

A correction starts a new revision rollup. Old revision receipts may remain until retention expiry for diagnostics but have no ranking effect. Repeated context resolution for one turn converges through the receipt primary key.

Alternative: increment salience. Rejected because salience is canonical authored state; usage is derived behavior and must be removable.

### 8. Derive hierarchy from subject keys, not free-form paths

A validated `subjectKey` is split only on `.` for hierarchy; `_` and `-` remain within a segment. Prefixes shorter than two segments and prefixes deeper than the configured maximum are not materialized. Examples:

- `project.runtime.transport` → `project.runtime`, `project.runtime.transport`;
- `preference.response.verbosity` → `preference.response`, `preference.response.verbosity`.

Group identity includes presentation generation, instance, actor, scope, project, and prefix. Membership contains only current active temporally eligible records in the exact partition. The group projection stores a deterministic child-set digest and a bounded catalog built from child subject keys and available L0 text. An optional projector may replace the catalog with a validated summary under a distinct generation identity.

Retrieval may search group projections lexically and, when configured, semantically. A group hit expands at most the configured child count, ordered by child rank/salience/stable identity, and every child is canonically revalidated.

Alternative: infer a directory tree from arbitrary content. Rejected because it creates unstable paths and weakens subject ownership.

### 9. Persist extraction output before applying candidate effects

The capture listener performs only bounded validation/filtering and one short awaited transaction through the selected repository:

1. ignore non-completed or incomplete committed turns;
2. strip recursive memory text and reject credential-bearing material;
3. insert one `memory_extraction_jobs` row keyed by `(instance, actor, deliveryId)` with bounded payload and expiry through the active unit of work;
4. return without awaiting extraction.

A serialized worker uses only purpose-bounded asynchronous repository operations for claim, renewal, output publication, retry, and acknowledgment. Claims are fenced by unique lease token and canonical store/partition ownership so an expired worker cannot settle reclaimed work. Bounded exponential backoff and actual provider transactions make the state machine safe across processes:

```text
pending extraction
  -> leased extraction
  -> outputs persisted by stable ordinal
  -> candidates delivered through MemoryService.propose
  -> terminal success with content payload removed

failure -> pending/failed with next available time -> bounded terminal expiry
```

Extractor results are fully validated and persisted in `memory_extraction_candidates` through the selected repository before the first canonical candidate mutation. Candidate operation IDs remain `capture:<deliveryId>:<ordinal>`. If the process dies after extraction persistence, restart reuses the same ordinals and content; it does not call the extractor again. If it dies during an extractor call before output persistence, no canonical effect has occurred and the job may safely re-run.

Candidate delivery uses the existing idempotency receipts. The current lease owner acknowledges success only after the awaited candidate effects resolve; stale-token acknowledgment is rejected without deleting current work. Optional semantic-neighbor suggestions run after candidate delivery as best-effort advisory work and do not control job success. Shutdown stops new claims, waits only within the configured bound for active work, and leaves leases recoverable. It never initiates extraction from disposal.

Alternative: enqueue only `deliveryId` and reload transcript material later. Rejected because the lifecycle payload is not retained by the host-neutral protocol.

Alternative: write candidates directly from extractor output before persistence. Rejected because non-deterministic re-extraction could reorder ordinals after a crash.

### 10. Keep working memory session-scoped and separate from canonical recall

The working-context plugin listens to completed committed turns and retains a configured recent tail by both turn count and token estimate through the selected repository. It filters and bounds material with the same secret and recursive-memory policy as capture. The host remains responsible for current conversation history; raw working turns are retained only as checkpoint input and are not emitted as duplicate context.

When the tail exceeds its threshold and a checkpoint projector is available, the plugin enqueues one checkpoint job covering an immutable ordered turn range and digest in the active provider transaction. Workers claim and acknowledge through purpose-bounded asynchronous operations with canonical-store/session/projector routing and lease-token fencing. A valid new checkpoint atomically replaces the prior checkpoint and deletes covered raw turns except the configured recent tail. The checkpoint context provider contributes at most one data-authority entry below authored Persona and stable-profile authority.

Checkpoint identity includes canonical store, instance, actor, session, projector identity, and covered-turn digest. `session-disposed` deletes session working state. Missing disposal after a crash is handled by expiry cleanup. Projector failure retains the previous valid checkpoint and bounded recent tail; it does not fail the host turn.

Alternative: promote checkpoints into long-term memory candidates. Rejected because checkpointing and durable knowledge extraction have different review and retention semantics.

Alternative: depend on `pre-compaction` material as the primary source. Rejected because hosts may not expose identical compaction timing or content. `pre-compaction` may trigger an early checkpoint of already committed retained turns but never supplies uncommitted canonical input.

### 11. Keep relations repository-local, revision-bound, and one-hop

The first implementation stores relations only as derived state in the selected canonical repository. It does not require graph support from vector backends. Relation projector output is validated against:

- closed types: `related_to`, `derived_from`, `evolved_from`, `supports`, `contradicts`;
- exact instance/actor/scope/project partition;
- current active temporally eligible source and target revisions;
- no self-link;
- per-source edge count and normalized weight bounds.

Retrieval follows at most one hop by default and adds only bounded targets to the candidate pool. Targets then pass the normal canonical revalidation and ranking path. `contradicts` may expose an operator review hint but never writes or resolves `memory_conflicts`.

Correction, deactivation, expiry, or deletion makes an edge immediately ineligible; worker cleanup removes it asynchronously. A projector failure leaves retrieval unchanged.

Alternative: use relations as canonical provenance evidence. Rejected because generated semantic judgments are not principal observations and must not alter evidence policy.

### 12. Generalize semantic projection identity without forcing derived indexing

Extend vector projection identity to distinguish:

- `record-l2` canonical revision;
- `record-l1` generated overview;
- `record-l0` generated abstract;
- `subject-group` generated or deterministic group projection.

A vector entry carries `projectionKind`, opaque `entityId`, exact partition metadata, and canonical source identity where applicable. Record-L2 deterministic external IDs preserve the current `(generationId, recordId, revisionId)` derivation so existing default projections can migrate without leaving unreachable duplicates. Other kinds include projection kind and entity identity in their vector ID.

`MemoryVectorCoordinatorConfig` gains `projectionKinds`, defaulting to `['record-l2']`. Therefore existing semantic deployments remain L2-only until explicitly changed. Enabling L0, L1, or subject groups requires an active compatible context-projection generation.

Semantic generation identity adds a projection profile containing:

- vector projection schema version;
- sorted included projection kinds;
- compatible presentation generation identity when generated text is indexed;
- hierarchy format identity when subject groups are indexed.

The coordinator rebuild enumerates every configured kind in deterministic pages, verifies per-kind expected/current/stale counts, and activates only after all configured kinds are complete. A failed derived kind leaves the previous semantic generation active and lexical/local context available.

All four adapters receive the same contract update. SQLite exact and pgvector bump their explicit derived schema version. Chroma creates a new generation collection when the projection profile changes. Qdrant uses new generation-filtered point payload and deterministic IDs. No adapter gains canonical authority.

Relations remain local in this change, so relation format does not enter vector generation identity unless a future backend explicitly implements relation projection.

Alternative: index only summaries and stop indexing L2. Rejected because canonical semantic retrieval must remain independently available and summary quality is optional.

Alternative: encode groups as fake record IDs. Rejected because it would blur canonical revalidation and deletion semantics.

### 13. Use bounded diagnostics and existing tool protocols

Add root tool `memory.pipeline.status`, always available with canonical memory. It reports bounded stage summaries for retrieval, planning, usage, extraction, working context, local projections, hierarchy, and relations. Optional coordinators report through the repository-owned `memory_pipeline_health` state; queue counts come from bounded asynchronous repository operations. Fields are restricted to counts, durations, budget totals, tier counts, generation IDs, queue states, fallback counts, zero-result counts, and last failure category/time.

The context-engine row registers `memory.projections.rebuild`. Existing `memory.semantic.status`, rebuild, rollback, and maintenance tools remain owned by the vector coordinator and gain per-projection-kind counts. No diagnostic includes query text, record/checkpoint/turn content, generated output, credentials, vectors, or exception strings.

Failures are categorized at the boundary (`validation`, `projector`, `timeout`, `storage`, `backend`, `identity`, `stale`, `secret`) and overwrite or aggregate bounded counters. They never retain arbitrary error history.

Alternative: log raw failed payloads for debugging. Rejected because memory and committed-turn content is protected data.

### 14. Migration and rollout follow the backend prerequisite

Implementation order and operational rollout:

1. Complete `add-sqlite-postgresql-memory-backends`: schema version 5, asynchronous repository/unit-of-work, both canonical providers, bounded asynchronous projection ownership, migration/transfer, and mandatory real-server verification.
2. Add the context acceptance callback and context-projector contracts while preserving current default behavior.
3. Refactor retrieval into asynchronous candidate gathering, one final provider snapshot, and pure planning; prove L2-only output remains authority- and budget-compatible on SQLite and PostgreSQL.
4. Add schema version 6 to both provider migration histories and extend offline transfer with the new durable tables before enabling any writer.
5. Add local projection generation and enable `context-engine` with a test projector in generated disposable presets for both canonical providers.
6. Convert capture to the durable queue; existing omission and `enabled: false` remain disabled.
7. Add working-context, usage feedback, hierarchy, relations, expansion, and diagnostics.
8. Generalize vector identity/adapters with default `record-l2` only, using only the bounded asynchronous projection interface.
9. Enable additional vector projection kinds only after local projection generation is healthy and rebuilt.

Schema migration is forward-only. Disabling optional rows rolls behavior back to canonical L2 and the selected provider's lexical path without deleting canonical state, but running a version-5 binary against a version-6 database is unsupported; operational rollback requires restoring the pre-migration database backup. Offline transfer between canonical providers includes the complete version-6 logical state. Semantic rollback remains generation-scoped and cannot reinterpret incompatible vector spaces or projection profiles.

## Risks / Trade-offs

- **Generated text can omit or distort meaning.** Mitigation: generated tiers are data-only, complete bounded artifacts with explicit provenance; canonical L2 remains available; preferences require canonical L2 for instruction authority.
- **Protocol surface expands for usage receipts.** The provider-scoped acceptance callback is the minimum accurate seam. It is in-process, optional, and fail-open, but every context implementation and conformance test must cover exact accepted-source reporting.
- **Durable turn payloads increase privacy exposure.** Capture and working context retain only bounded filtered material, apply secret rejection before persistence, use expiry, and erase payloads after terminal work. This still requires protected SQLite files or PostgreSQL storage and credentials.
- **Projector non-determinism can affect retries.** Outputs are persisted before downstream effects; generation identity pins provider configuration; rebuilds isolate changed projector identities.
- **Subject hierarchy quality depends on disciplined keys.** The engine never invents paths. Poor keys yield shallow or unhelpful navigation rather than cross-topic inference.
- **Hotness can reinforce popularity.** The boost is capped, decays, applies only after base retrieval and eligibility, and never changes canonical salience.
- **Derived projection storage can grow.** Per-record tier count, group depth, edge count, receipt retention, queue attempts, and checkpoint history are bounded. Hard deletion and generation cleanup remove local derived state.
- **Multi-kind vector rebuilds cost more.** The default remains L2-only. Additional kinds are opt-in, batched, generation-isolated, and never block lexical recall from the active runtime.
- **A projection generation can lag canonical writes.** Context falls back to another complete current tier or L2. Semantic hits and group children are canonically revalidated; stale derived data cannot become visible authority.
- **At-least-once workers can repeat external calls.** Stable work identities, leases, persisted extractor output, idempotent candidate operation IDs, vector upserts, and completion transactions make repeated delivery converge.
- **Working checkpoints may duplicate some host history.** Only the checkpoint, not the raw recent tail, is contributed. Priority keeps it below authored Persona and stable memory, and it disappears when the row is omitted or session state expires.
