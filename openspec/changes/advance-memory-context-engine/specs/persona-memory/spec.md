## MODIFIED Requirements

### Requirement: Recall authority and budget
Automatic recall SHALL contribute an eligible stable relationship-profile subset before query-ranked memory, SHALL treat ordinary records and all generated projections as data, SHALL treat only canonical approved preference revisions as behavioral contributions, and SHALL respect the host-provided context budget. The stable subset SHALL contain pinned relationship preferences and relationship facts whose subject key is under `principal.identity.*`; it SHALL remain subject to actor partition, active status, temporal eligibility, deterministic complete-tier selection, and canonical current-revision validation. A generated L0 abstract, L1 overview, subject-group summary, query expansion, hotness signal, or semantic relation SHALL NOT acquire instruction authority.

One memory-owned asynchronous automatic-recall operation SHALL combine stable-profile and ranked candidates from the selected canonical repository's complete lexical query and optional semantic branches. After all awaited external retrieval completes, it SHALL perform one short bulk canonical snapshot through the selected repository that validates every stable and ranked candidate, current revision, eligibility state, and compatible generation together. It SHALL NOT rely on per-record synchronous reads, a stale ORM identity map, or a pre-await stable snapshot. Planning SHALL use detached snapshot results, deduplicate by canonical identity, preserve deterministic authority and budget decisions, and perform no later database I/O. A later external commit does not retroactively invalidate the completed selection. Approved active preferences SHALL retain their behavioral authority even when unpinned and selected by query; pinning governs stable inclusion and precedence rather than changing authority.

#### Scenario: Stable relationship profile does not lexically match
- **ID**: `context.stable-profile-recall`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-protocol.spec.ts::recalls stable profile through progressive authority-safe assembly on both canonical providers`
- **WHEN** a current turn has no lexical overlap with an eligible relationship identity fact and a pinned relationship preference
- **THEN** automatic recall contributes the canonical pinned preference before ordinary ranked data, considers an eligible complete tier of the identity fact, excludes unpinned preferences from the stable subset and temporally ineligible identity facts, and contributes any duplicate current revision only once

#### Scenario: Pinned global preference exists
- **ID**: `context.pinned-precedence-budget`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::preserves canonical preference authority and deterministic budget precedence on both providers`
- **WHEN** persona context is assembled
- **THEN** the canonical pinned preference is considered before stable identity and ranked memory, is never replaced by a generated summary carrying instruction authority, and lower-priority contributions are omitted when required by the budget

#### Scenario: Stable memory changes while semantic recall is pending
- **ID**: `memory.recall.stable-final-revalidation`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-backend-conformance.spec.ts::bulk revalidates progressive recall after awaited semantic work on both providers`
- **WHEN** a stable-profile record is corrected, forgotten, expired or made inactive while asynchronous ranked retrieval is pending
- **THEN** one final bulk canonical snapshot admits only revisions and presentation generations that are current and eligible as of that snapshot, never admits the earlier stale stable snapshot, and does not claim validity against later external commits

#### Scenario: Combined recall exceeds its budget
- **ID**: `memory.recall.combined-whole-record-budget`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::budgets deduplicated stable and ranked recall with complete tiers on both providers`
- **WHEN** stable and ranked sources overlap and their eligible complete canonical or derived representations exceed the supplied recall budget
- **THEN** the final selection counts each canonical revision once, preserves existing priority and authority, and omits or downgrades only through complete permitted tiers to stay within the hard budget

#### Scenario: Unpinned approved preference is query relevant
- **ID**: `memory.recall.unpinned-approved-preference-authority`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::preserves approved preference authority independently of pinning on both providers`
- **WHEN** ranked recall selects an approved active unpinned preference and an ordinary fact
- **THEN** the preference retains behavioral instruction authority only through its complete canonical revision while the fact remains data and neither bypasses canonical eligibility or the budget

#### Scenario: Generated preference summary is available
- **ID**: `context.generated-preference-data-only`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::never promotes generated tiers to instruction authority`
- **WHEN** a derived L0 or L1 projection exists for an approved preference
- **THEN** the projection may be used only as data and the canonical revision remains the only representation eligible for instruction authority

### Requirement: Deterministic context authority and budget
Recall SHALL prioritize eligible pinned relationship preferences, then query-matched approved preferences, then eligible stable relationship identity facts, then project decisions, procedures, and ordinary query-ranked memory. It SHALL diversify candidates by subject, deduplicate stable and ranked revisions, apply configured category quotas, place candidates breadth-first at their cheapest eligible complete presentation tier, and spend remaining budget depth-first on higher-ranked candidates without exceeding the supplied hard token budget. Canonical approved preferences may contribute instructions only as complete canonical revisions; identity facts, other facts, decisions, procedures, working-memory checkpoints, generated tiers, subject summaries, candidates, conflicts, and relation expansions SHALL NOT gain instruction authority. Planning SHALL produce the same policy outcomes from detached eligible values regardless of whether SQLite or PostgreSQL is the selected canonical provider.

#### Scenario: Memory conflicts with authored profile
- **ID**: `context.profile-authority`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::preserves authored profile authority across generated tiers and relations`
- **WHEN** recalled memory or a generated projection contradicts persona identity or traits
- **THEN** the authored profile remains authoritative and every memory-derived representation is constrained to its permitted authority

#### Scenario: Budget cannot fit a record
- **ID**: `context.whole-record-budget`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::never truncates canonical or generated presentation tiers`
- **WHEN** adding a candidate's complete permitted tier would exceed the supplied token budget
- **THEN** that tier is omitted or a smaller complete eligible tier is selected without emitting misleading partial content

#### Scenario: Full revision cannot fit but an abstract can
- **ID**: `context.progressive-tier-fallback`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::fills breadth before depth and uses complete derived tiers`
- **WHEN** an eligible canonical data record exceeds its per-entry share or remaining token budget and a current L0 or L1 projection fits
- **THEN** the planner may contribute the complete derived tier with record and revision provenance instead of truncating canonical content

#### Scenario: No eligible tier fits
- **ID**: `context.tier-budget-omission`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::omits candidates when no complete tier fits`
- **WHEN** no complete permitted presentation tier for a candidate fits the remaining hard budget
- **THEN** the candidate is omitted and the planner reports a bounded omission count without emitting partial text

#### Scenario: Budget remains after breadth pass
- **ID**: `context.depth-upgrade`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::upgrades higher-ranked slots with remaining budget deterministically`
- **WHEN** the breadth pass has placed eligible candidates and unused budget remains
- **THEN** the planner upgrades candidates in deterministic rank order from L0 to L1 to L2 without displacing higher-priority authority classes

#### Scenario: Category quota is unused
- **ID**: `context.quota-redistribution`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-context-planner.spec.ts::redistributes unused category quota without exceeding ceilings`
- **WHEN** one configured retrieval category has insufficient eligible candidates to consume its allocation
- **THEN** the planner deterministically redistributes the unused budget to eligible categories while preserving stable-profile precedence and the global hard limit

### Requirement: Optional capture is committed-turn driven and fail-open
Automatic capture SHALL remain an optional extension driven only by completed committed turns containing stable delivery, session, and turn identity plus bounded principal input and assistant output. When durable capture is enabled, receipt of an eligible committed turn SHALL persist one bounded idempotent extraction job in a short awaited transaction through the selected canonical repository before asynchronous extraction. Workers SHALL use bounded asynchronous repository operations, resume unfinished jobs after restart, persist validated outputs by stable ordinal before candidate effects, and derive candidate mutation identities from the committed delivery identity. Extractor, semantic-neighbor, candidate-validation, queue, repository, or candidate-write failure SHALL be contained and SHALL NOT fail the committed host turn. Extraction SHALL create candidates only, SHALL delete content-bearing job payloads after terminal completion or bounded expiry, and SHALL behave equivalently on SQLite and PostgreSQL.

#### Scenario: Meaningful turn commits
- **ID**: `capture.committed-turn`
- **EVIDENCE**: `planned:packages/host-omp/tests/vertical.spec.ts::persists and drains committed-turn extraction jobs as review candidates on both providers`
- **WHEN** durable capture is enabled and a complete eligible turn is published
- **THEN** one job keyed by the stable delivery identity is durably recorded in the selected repository and may asynchronously submit bounded candidates through the canonical memory interface

#### Scenario: Committed delivery repeats
- **ID**: `capture.durable-delivery-idempotency`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-extraction-queue.spec.ts::deduplicates repeated committed deliveries and candidate writes on both providers`
- **WHEN** the same committed delivery event is received or an unfinished job is retried
- **THEN** the queue and canonical operation receipts converge on one job and at most one effect per extracted candidate ordinal

#### Scenario: Runtime restarts during extraction
- **ID**: `capture.restart-recovery`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-extraction-queue.spec.ts::resumes leased extraction work after restart without duplicate effects on both providers`
- **WHEN** a process exits after persisting a job but before acknowledging terminal completion
- **THEN** a later activation reclaims the expired lease and safely resumes the job from its bounded committed-turn payload

#### Scenario: Extractor fails
- **ID**: `capture.fail-open`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-extraction-queue.spec.ts::records bounded failures while preserving committed turns and retries`
- **WHEN** the configured extractor or optional semantic reconciliation throws
- **THEN** the committed host turn remains successful and the job records bounded retry or terminal diagnostic state without creating active memory

#### Scenario: Host cannot provide committed output
- **ID**: `capture.missing-commit-skip`
- **EVIDENCE**: `planned:packages/host-omp/tests/vertical.spec.ts::skips durable capture when committed output is incomplete`
- **WHEN** a host lacks a complete committed-turn payload
- **THEN** automatic capture for that turn is skipped rather than persisted or inferred from partial state

#### Scenario: Session exits abruptly
- **ID**: `capture.no-shutdown-extraction`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-extraction-queue.spec.ts::disposes workers without starting shutdown extraction`
- **WHEN** shutdown begins with pending or leased extraction jobs
- **THEN** no new extraction call starts, active work settles within the lifecycle bound, and durable jobs remain recoverable for a later activation

## ADDED Requirements

### Requirement: Working memory checkpoints are bounded and non-authoritative
An explicitly enabled working-memory component SHALL retain only a configured bounded recent tail of completed turns through the selected canonical repository and MAY replace older eligible session material with a session-scoped checkpoint. Checkpoints SHALL be derived data, SHALL use data authority, SHALL be partitioned by Persona Instance, actor, and session, SHALL NOT appear as canonical memory records or memory-search results, and SHALL NOT change candidate promotion, evidence, conflicts, or authored Persona state. Raw turn material retained for checkpointing SHALL be minimized, secret-filtered before persistence, and deleted when superseded or when its configured retention bound expires. The same lifecycle, retention, and isolation contract SHALL hold on SQLite and PostgreSQL.

#### Scenario: Session exceeds its working-memory bound
- **ID**: `working-memory.checkpoint-compaction`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-working-context.spec.ts::compacts older committed turns into one bounded checkpoint`
- **WHEN** completed session material exceeds the configured turn or token retention bound
- **THEN** the component retains the configured recent raw tail and replaces older eligible material with a bounded checkpoint carrying session provenance

#### Scenario: Memory tools inspect canonical state
- **ID**: `working-memory.canonical-separation`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-working-context.spec.ts::keeps checkpoints outside canonical tools and recall authority`
- **WHEN** a caller searches, inspects, corrects, or forgets canonical memory
- **THEN** working-memory checkpoints are not presented as canonical records and cannot be mutated through canonical memory commands

#### Scenario: Checkpoint generation fails
- **ID**: `working-memory.fail-open-recent-tail`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-working-context.spec.ts::retains bounded recent context when checkpoint generation fails`
- **WHEN** the optional checkpoint projector throws, times out, or returns malformed output
- **THEN** the current host turn remains successful, the existing valid checkpoint and bounded recent tail remain usable, and no partial checkpoint becomes visible

### Requirement: Retrieval query expansion is optional and bounded
The memory engine MAY invoke one configured query planner to produce a bounded number of bounded retrieval queries from the current principal turn. The original complete principal turn SHALL remain the selected provider's lexical query, every expansion SHALL be data-only retrieval input, and expansion results SHALL enter deterministic rank fusion without changing canonical state. Planner absence, timeout, malformed output, or failure SHALL produce the same eligibility and authority behavior as retrieval without expansion on either canonical provider.

#### Scenario: Query planner returns valid expansions
- **ID**: `retrieval.query-expansion-fusion`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-query-expansion.spec.ts::fuses bounded expansions without replacing the lexical query`
- **WHEN** an enabled planner returns valid subject-, procedure-, or project-oriented expansions
- **THEN** the engine searches them within configured count and character bounds and fuses their candidate ranks deterministically with the original retrieval branches

#### Scenario: Query planner fails
- **ID**: `retrieval.query-expansion-fallback`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-query-expansion.spec.ts::contains planner timeout and malformed output`
- **WHEN** query expansion is unavailable, times out, throws, or returns invalid content
- **THEN** retrieval continues with the complete lexical query and existing bounded semantic projection while recording only a sanitized diagnostic

### Requirement: Subject hierarchy guides but never authorizes recall
The memory engine SHALL derive a hierarchy from stable `subjectKey` prefixes and MAY retrieve bounded subject-group summaries before selecting records. A hierarchy node SHALL be a rebuildable projection stored through the selected repository over canonically current eligible children, SHALL be partitioned by Persona Instance, actor, relationship or project scope, and project identity, and SHALL NOT itself become a memory record, evidence item, conflict, instruction, or mutation target. Every expanded child SHALL pass final canonical eligibility and current-revision validation through the selected provider.

#### Scenario: Relevant subject group is found
- **ID**: `retrieval.subject-hierarchy-expansion`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-hierarchy.spec.ts::expands relevant subject groups into current eligible records`
- **WHEN** retrieval identifies a relevant group such as `project.runtime.*`
- **THEN** the engine searches bounded children of that group and ranks only canonically eligible current revisions

#### Scenario: Group contains cross-project children
- **ID**: `retrieval.subject-hierarchy-scope-filter`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-hierarchy.spec.ts::filters hierarchy children by actor and project before ranking`
- **WHEN** a derived subject prefix exists in multiple actor or project partitions
- **THEN** expansion exposes only relationship records and records for the active project within the active Persona-actor partition

### Requirement: Memory usage feedback produces only a capped ranking signal
The memory engine SHALL record bounded idempotent usage receipts through the selected repository only for canonical revisions actually contributed to a completed context assembly. Usage state SHALL identify record, revision, session, and turn without storing query or contribution content. A deterministic hotness function MAY combine bounded recency and logarithmic frequency, but its configured maximum influence SHALL be capped and SHALL apply only after partition, status, temporal, conflict, semantic-generation, record, and current-revision eligibility. Usage SHALL NOT change authority, confidence, salience, evidence, candidate promotion, correction, or conflict resolution, and SHALL produce the same ranking policy on SQLite and PostgreSQL.

#### Scenario: Contributed revision is assembled twice for one turn
- **ID**: `retrieval.usage-idempotent`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-usage-ranking.spec.ts::records one usage receipt per revision and turn`
- **WHEN** context resolution repeats for the same session and turn and contributes the same revision
- **THEN** usage count advances at most once for that revision and turn

#### Scenario: Frequently used record is otherwise eligible
- **ID**: `retrieval.hotness-capped-boost`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-usage-ranking.spec.ts::caps hotness below semantic and authority boundaries`
- **WHEN** two already-retrieved eligible candidates have comparable base rank and one has more recent bounded usage
- **THEN** hotness may improve deterministic ordering only within the configured cap

#### Scenario: Popular record becomes expired
- **ID**: `retrieval.hotness-never-bypasses-eligibility`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-usage-ranking.spec.ts::excludes expired and stale revisions regardless of usage`
- **WHEN** a highly used record is inactive, expired, deleted, out of scope, conflicted where exclusion is required, or no longer current
- **THEN** usage has no effect and the record is excluded

### Requirement: Semantic memory relations are derived and advisory
The memory engine MAY maintain rebuildable relations through the selected repository between canonical current revisions using a bounded relation vocabulary including `related_to`, `derived_from`, `evolved_from`, `supports`, and `contradicts`. Relations SHALL preserve source and target revision identities, remain partition-safe, contain no independent authority, and expand retrieval only through bounded traversal followed by final canonical validation. A `contradicts` relation SHALL NOT resolve, dismiss, or replace an authoritative `memory_conflicts` entry.

#### Scenario: Related revision expands retrieval
- **ID**: `retrieval.relation-bounded-expansion`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-relations.spec.ts::expands bounded advisory neighbors and revalidates each target`
- **WHEN** an eligible ranked revision has current derived neighbors
- **THEN** the engine may add at most the configured number and depth of canonically eligible target revisions to candidate ranking

#### Scenario: Relation points to a stale revision
- **ID**: `retrieval.relation-stale-target`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-relations.spec.ts::drops stale deleted and cross-partition relation targets`
- **WHEN** a relation names a deleted, superseded, inactive, expired, or out-of-partition target revision
- **THEN** canonical validation drops the target before context assembly

#### Scenario: Derived contradiction exists
- **ID**: `retrieval.relation-conflict-separation`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-relations.spec.ts::keeps contradiction links advisory beside canonical conflict state`
- **WHEN** a projector emits a `contradicts` relation between revisions
- **THEN** the relation may produce a review hint but cannot mutate active content or authoritative conflict state

### Requirement: Memory pipeline diagnostics are bounded and secret-free
The memory engine SHALL expose bounded operational diagnostics for retrieval, progressive planning, working-memory checkpointing, durable extraction, usage accounting, hierarchy, and relation projections through repository-owned bounded asynchronous operations. Diagnostics SHALL include only sanitized categories, counts, durations, queue states, projection generation identities, tier counts, budget totals, fallback counts, zero-result counts, and last failure category and time. They SHALL NOT include memory content, checkpoint content, committed-turn content, query text, credentials, vectors, evidence excerpts, generated model output, ORM state, SQL, or raw backend errors.

#### Scenario: Operator inspects memory pipeline status
- **ID**: `memory.diagnostics.pipeline-status`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-diagnostics.spec.ts::reports bounded retrieval extraction and projection health`
- **WHEN** the namespaced memory status surface is invoked
- **THEN** it reports sufficient bounded metadata to identify queue lag, projection staleness, fallbacks, zero-result retrieval, and budget utilization without protected content

#### Scenario: Repeated failures occur
- **ID**: `memory.diagnostics.failure-bounding`
- **EVIDENCE**: `planned:packages/extension-memory/tests/memory-diagnostics.spec.ts::bounds repeated failures by category and time`
- **WHEN** one pipeline stage fails repeatedly
- **THEN** diagnostics aggregate or replace bounded failure state rather than retaining unbounded error or payload history
