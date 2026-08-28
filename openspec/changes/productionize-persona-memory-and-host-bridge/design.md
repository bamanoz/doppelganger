## Context

See `proposal.md` for motivation and the three delta specifications for behavioral requirements.

The repository already has the correct top-level shape: a domain-neutral `composition-runtime`, host-neutral context/tool/lifecycle protocols, persona and memory extensions, instance-owned SQLite, an Aiden preset, and an OMP adapter that runs one child process per session. The current memory database is authoritative and already supports immutable revisions, candidates, FTS5, scope filtering, and hard deletion. The design must deepen that module rather than layer a second catalog or make MemPalace authoritative.

Current constraints that shape the approach:

- `composition-runtime` must remain unaware of persona, principal, project, memory, protocols, and hosts.
- Persistent state is shared by concurrent session processes through short SQLite transactions; mutable JavaScript objects are not shared.
- OMP provides completed assistant messages and tool results at `turn_end`, actual results at `tool_execution_end`, and a `session_before_compact` hook. The current adapter discards those payloads.
- OMP `session_shutdown` carries no success/failure reason, so it cannot justify a successful session-completion event.
- The current semantic provider ranks all already-scoped canonical candidates. No real external indexed provider ships, so an external indexing worker or outbox would be speculative.
- Existing local instance databases and the Aiden vertical must survive a clean breaking cutover.

## Goals / Non-Goals

**Goals:**

- Make canonical memory safe for multiple principals, concurrent sessions, corrections, inference, expiry, and eventual semantic adapters.
- Keep the memory interface small while concentrating reconciliation, provenance, idempotency, retrieval, and privacy inside the memory module.
- Provide a committed-turn lifecycle event rich enough for optional candidate capture without transcript mining.
- Make `host-omp` depend only on generic composition and protocol contracts, not on Aiden or persona packages.
- Preserve fail-open OMP behavior and one-process-per-session isolation.
- Migrate existing memory transactionally and validate the complete behavior through the public protocol and real child-process vertical.

**Non-Goals:**

- Building an episodic transcript archive, MemPalace adapter, knowledge graph, diary, daemon, or cross-persona sharing.
- Shipping an LLM extractor, embedding model, or external vector database.
- Moving memory, persona, or host concepts into `composition-runtime`.
- Giving Doppelganger control of OMP's model loop, tool approval, compaction decision, or provider selection.
- Defining universal entity ontology. Subject keys identify replaceable memory topics; they are not a general knowledge graph.
- Preserving the old memory or host-RPC interfaces through aliases or compatibility shims.

## Decisions

### 1. Extend the existing authoritative SQLite module

`extension-memory` remains the only source of truth. Its interface owns validation, mutation state transitions, reconciliation, retrieval eligibility, and hard deletion. FTS rows, cached embeddings, and future semantic indexes are projections.

The external interface remains behavior-oriented:

```text
remember / propose
observe evidence
correct / resolve conflict
approve / reject
pin / unpin / forget
inspect / history / recall
```

Callers do not manage SQL rows, FTS entries, revision pointers, expiry, or promotion counters.

Alternative: adopt MemPalace or a new catalog as authoritative. Rejected because it duplicates current durable state and lacks the required partition, candidate, revision, conflict, and deletion semantics.

Alternative: replace the methods with one generic command bus. Rejected for the public Cordis interface because it reduces type clarity without hiding additional implementation complexity. Idempotency is shared command metadata, not a reason to erase meaningful operations.

### 2. Partition every row by persona instance and principal

Persona activation metadata gains a required stable `principalId`. The local Aiden product resolver supplies an explicit configured local principal; generic persona activation does not infer identity from OS username or host display text.

Memory eligibility is:

```text
partition = (instanceId, principalId)
scope     = relationship | project(projectId)
```

Relationship replaces the misleading old `global` name. SQL predicates apply partition, scope, status, and time eligibility before lexical or semantic ranking. The database remains physically owned by the persona instance; principals are logically isolated within it.

Alternative: one database per principal. Rejected because instance storage allocation, backup, migration, and cross-session concurrency are already solved, while correct SQL partitioning remains necessary even with separate files.

### 3. Require stable subject keys for new memory

New remember and propose operations carry a normalized `subjectKey`, such as `preference.response.verbosity` or `project.database.engine`. Keys are opaque to the kernel and validated only for stable syntax and bounded size. Kind, partition, and scope complete the reconciliation identity.

The protocol tools require callers to supply the key. Optional capture extractors must emit it. Migration assigns deterministic legacy keys derived from record identity rather than pretending to infer semantics from old prose; migrated records therefore retain behavior without accidental merging.

Alternative: derive every key from content tokens. Rejected because paraphrases and corrections produce unstable identities and unsafe supersession.

Alternative: build a universal entity schema. Rejected as unnecessary for preferences, facts, decisions, and procedures.

### 4. Separate records, immutable revisions, evidence, conflicts, and operation receipts

The versioned schema contains:

```text
memory_records
memory_revisions
memory_evidence
memory_conflicts
memory_candidate_evidence
memory_operations
memory_fts
memory_embeddings
```

`memory_records` contains partition, scope, kind, subject key, status, pin, confidence, salience, validity, and current revision. Revisions contain bounded canonical content and lineage. Evidence stores bounded excerpts plus role/session/turn and support/contradiction relation. Conflicts link an active subject to incompatible candidate evidence without disabling the active value.

`memory_operations` stores partitioned operation ID, command digest, and content-free result coordinates. The same digest returns the original outcome; another digest produces `IDEMPOTENCY_CONFLICT`. Receipts deliberately exclude remembered prose and survive record deletion only as non-sensitive replay protection.

Alternative: encode contradiction as another active record. Rejected because normal recall would expose mutually incompatible values.

Alternative: automatically replace active content on high-confidence inference. Rejected because model confidence is not authority.

### 5. Keep temporal eligibility orthogonal to audit status

`validFrom`, `validUntil`, and `expiresAt` determine whether an otherwise active record is currently eligible. Expiry does not rewrite or delete revision history. Candidate/rejected state remains a review lifecycle, while unresolved conflict is represented explicitly rather than overloading status.

Every read evaluates time using an injected clock, enabling deterministic tests and ensuring expiry applies before all retrieval channels.

Alternative: background jobs that mark expired rows. Rejected because query-time eligibility is simpler and correct after downtime; maintenance may compact indexes later without affecting truth.

### 6. Reconcile inside one short transaction

For `(partition, scope, kind, subjectKey)`:

- an equivalent observation adds evidence;
- an inferred incompatible observation creates or updates a conflict/candidate;
- explicit correction uses `expectedRevisionId` compare-and-swap and appends a revision;
- manual approval promotes a candidate after rechecking conflicts;
- automatic promotion counts eligible distinct-session principal evidence and refuses unresolved contradiction;
- rejection is terminal;
- hard deletion removes canonical and locally derived rows in one transaction.

Equivalence is explicit input from a capture/reconciliation adapter or exact normalized canonical content for the built-in path. The memory module does not claim semantic equivalence from token overlap.

Alternative: hide a model call inside the transaction. Rejected because transactions must be short, deterministic, and available offline.

### 7. Use rank fusion over eligible canonical candidates

FTS5 remains mandatory. The semantic seam continues to rank a bounded list of canonical candidates for this change because no real indexed adapter exists. Its response carries `recordId`, `revisionId`, and rank; raw provider scores are not trusted or added to BM25-derived scores.

Recall performs:

1. authoritative partition/scope/status/time selection;
2. lexical ranking;
3. optional semantic ranking of the same eligible candidate snapshots;
4. post-await revalidation of record and revision identities;
5. Reciprocal Rank Fusion with a fixed documented constant;
6. pinned relationship-preference precedence;
7. one-result-per-subject diversity before secondary results;
8. whole-record token budgeting and deterministic ties.

This prevents a provider from widening scope and handles a record corrected or deleted while semantic ranking is in flight. An indexed search interface will be introduced only with a real second adapter; it must preserve the same identity revalidation.

Alternative: add raw lexical and semantic scores. Rejected because their scales have no shared meaning.

Alternative: build an indexing outbox now. Rejected because no external index ships and the current candidate-ranking seam requires no projection delivery.

### 8. Make capture an optional plugin over committed-turn lifecycle

`MemoryCapturePlugin` is optional and depends on host-neutral lifecycle plus memory. It receives `turn-committed`, applies recursive-context stripping, secret detection, trivial-content filtering, size limits, and policy, then invokes a `MemoryCandidateExtractor` adapter. Every result goes through `propose` or evidence observation with an operation ID derived from event delivery ID and candidate ordinal.

The initial implementation ships a conservative deterministic extractor for explicit durable patterns and allows another plugin to provide an extractor later. No model is created by the memory module. Capture never writes active memory and never runs at shutdown. Aiden keeps automatic capture disabled until explicitly enabled in instance policy; direct remember and agent-initiated candidates remain available.

Alternative: mine session files at shutdown. Rejected because it is hidden, lossy on crashes, duplicates injected context, and delays errors beyond the originating turn.

Alternative: let an extractor write SQLite directly. Rejected because it bypasses authority, idempotency, reconciliation, and secret policy.

### 9. Replace lossy lifecycle events with committed serializable projections

`extension-protocols` introduces normalized JSON-safe payloads and replaces ambiguous turn completion with committed turn semantics. Event identity is deterministic from host session, turn, event kind, and call where relevant.

The lifecycle surface includes:

```text
session-started
session-disposed or session-completed when outcome is known
turn-started
turn-committed
pre-compaction
 tool-started
 tool-completed
```

A committed turn contains bounded principal input, completed assistant text, bounded normalized tool outcomes, timestamp, and outcome. Raw provider objects, abort signals, and unbounded session transcripts do not cross the seam. Protocol dispatch catches subscriber failures, reports diagnostics, and allows the host adapter to fail open.

OMP mapping uses `turn_end.message`, `turn_end.toolResults`, `tool_execution_end.result`, and `session_before_compact`. Bare `session_shutdown` maps to disposal, not successful completion.

Alternative: publish raw OMP event objects. Rejected because they are host-coupled, may be non-serializable, and expose more data than subscribers need.

### 10. Resolve product activation before the generic OMP adapter

`host-omp` no longer imports `preset-aiden`. The extension accepts an activation resolver supplied by the product bootstrap. That resolver returns either no activation or a complete serialized composition, mounts, host mount, session identity, and watch policy. An optional explicit initializer remains product-supplied.

The development `.omp/extensions/doppelganger.ts` composes the generic OMP extension with Aiden selection and initialization. Aiden selection logic remains in `preset-aiden`; conversion to the generic activation descriptor occurs in the bootstrap or a small preset export that does not depend on OMP.

Alternative: introduce a global host-capability framework. Rejected because there is still one host and the existing context/tool/lifecycle seams already express what varies.

Alternative: keep Aiden imports in `OmpAdapterSession`. Rejected because it makes a host transport select domain composition and blocks reuse for another preset.

### 11. Translate supported JSON Schema exactly

`host-omp` owns one recursive translator from the protocol's supported JSON Schema subset to OMP's schema builder. It handles object properties, required fields, arrays, strings, numbers, integers, booleans, null where supported, enums, descriptions, and `additionalProperties`. The translator reports a path-specific error for unsupported unions, references, conditionals, or contradictory constraints; that tool is not projected.

A tool descriptor update rebuilds its proxy schema and active-tool set. Runtime domain errors remain tool errors; RPC/process errors fail the adapter session.

Alternative: retain `record<string, unknown>` and put JSON Schema in the description. Rejected because invalid calls reach the runtime and host/model users see a misleading interface.

### 12. Keep authority at context-contribution level

Persona identity and traits remain authored instruction contributions. Only active approved preferences can produce memory instructions. Other canonical memory and every future archive fragment are data. Candidates and unresolved conflicts are excluded.

Memory context uses stable source IDs and whole contributions. The shared context assembler remains the final budget authority and preserves existing OMP instructions by appending Doppelganger's assembled output.

## Risks / Trade-offs

- [Stable subject keys increase caller responsibility] → Require them in protocol schemas, provide conservative normalization helpers, document examples in Aiden guidance, and never silently merge unrelated legacy records.
- [A configured local principal can later be mistaken for a real authenticated identity] → Name it explicitly in product configuration and require authenticated/multi-user hosts to provide their own stable principal ID.
- [Logical principal isolation shares one SQLite file] → Apply partition predicates in every query/mutation, centralize eligibility SQL, and test adversarial cross-principal identifiers as well as search results.
- [Bounded evidence may omit useful nuance] → Preserve source coordinates and allow explicit archive adapters later; do not solve this by persisting full transcripts by default.
- [Deterministic extraction has limited recall] → Prefer missed candidates over false active memory; keep extraction replaceable and candidate-only.
- [Semantic ranking remains O(n) in eligible canonical records] → Bound candidate count and treat this as suitable for canonical memory; add indexed search only with a concrete provider and benchmark.
- [RRF constants and diversity policy affect relevance] → Fix deterministic defaults, expose configuration only after measured need, and test pinned, lexical-only, semantic-only, and mixed rankings.
- [Lifecycle payloads can contain sensitive tool output] → Serialize only bounded fields, apply secret filtering before evidence persistence, and keep capture opt-in.
- [OMP schema support is narrower than JSON Schema] → Define and test the supported subset; reject unsupported tools rather than silently widening validation.
- [Breaking RPC change requires lockstep deployment] → Update parent extension and child entry in the same package/release and reject protocol-version mismatch during activation.

## Migration Plan

1. Add `principalId` to persona activation contracts and update Aiden configuration/selection fixtures to supply the explicit local principal.
2. Introduce memory schema version 2 as a single SQLite transaction: create v2 tables and indexes, copy v1 records/revisions/candidates/FTS data, bind them to the activating legacy principal, assign deterministic `legacy.<record-id>` subject keys, validate counts and current-revision references, then switch the schema version. Preserve the original file through SQLite transactional rollback on failure.
3. Cut memory interfaces and protocol tools over together; update every caller and remove `global`, old semantic score merging, and obsolete schemas without aliases.
4. Add enriched lifecycle contracts, RPC protocol versioning, and child runtime handling; then update the OMP extension mappings in the same change.
5. Extract Aiden resolution from `host-omp`, wire it in the development/product bootstrap, and enforce dependency direction so `host-omp` imports neither persona, memory, nor presets.
6. Add exact OMP schema translation and dynamic projection behavior.
7. Add optional capture implementation and policy after committed-turn delivery is proven; leave it disabled by default in Aiden configuration.
8. Exercise migration from a real v1 fixture, cross-principal/project isolation, duplicate event delivery, correction races, expiry, stale semantic results, schema projection, lifecycle payload fidelity, process restart, reload, and child failure in focused and vertical tests.
9. Run an actual OMP smoke session that activates Aiden, appends context, validates a structured memory tool before RPC, remembers and recalls across restart, forwards a committed turn, and continues normally after forced child failure.

Rollback before schema migration is ordinary package rollback. After a database has migrated, code rollback to the v1 reader is unsupported; retain a pre-upgrade backup at the product/deployment layer or restore from backup. Migration failure itself rolls back transactionally and leaves the prior schema usable by the prior release.
