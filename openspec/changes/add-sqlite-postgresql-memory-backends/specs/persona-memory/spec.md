## MODIFIED Requirements

### Requirement: Memory retrieval
The memory plugin SHALL support actor-partition-safe lexical retrieval through the selected canonical repository provider without semantic plugins. Each complete provider SHALL execute the complete principal turn against its dialect-owned lexical source: SQLite FTS5 or PostgreSQL native full-text search. When one semantic stack is active, memory SHALL retrieve independent semantic top-K candidates over the configured active vector generation, fuse lexical and semantic ranks deterministically, and continue with lexical retrieval when semantic generation, health, query, or result validation fails. Provider-specific lexical scores and numeric ranks MAY differ; partition, eligibility, fusion, fallback, and budget behavior SHALL remain consistent.

#### Scenario: Project recall
- **ID**: `retrieval.project-partition`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::preserves scoped lexical recall across SQLite and PostgreSQL`
- **WHEN** the current principal turn matches active project records
- **THEN** retrieval returns relevant records from that project plus eligible relationship records without returning records from another project or actor

#### Scenario: Semantic operation fails
- **ID**: `retrieval.semantic-failure-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::contains semantic timeout and provider exceptions`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::falls back to canonical lexical retrieval across SQLite and PostgreSQL`
- **WHEN** query embedding, vector search, or semantic result parsing throws or times out
- **THEN** the same recall request returns eligible lexical results and records a bounded semantic diagnostic

#### Scenario: Long principal turn is searched
- **ID**: `retrieval.long-query-projection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::projects only the semantic branch while lexical search keeps complete technical identifiers`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::searches the complete lexical query while bounding semantic projection on both providers`
- **WHEN** a principal turn exceeds the semantic safe-query bound
- **THEN** the selected provider's lexical source receives the complete turn while the embedder receives a deterministic bounded intent projection

### Requirement: Recall authority and budget
Automatic recall SHALL contribute an eligible stable relationship-profile subset before query-ranked memory, SHALL treat ordinary records as data, SHALL treat approved preference records as behavioral contributions, and SHALL respect the host-provided context budget. The stable subset SHALL contain pinned relationship preferences and relationship facts whose subject key is under `principal.identity.*`; it SHALL remain subject to actor partition, active status, temporal eligibility, whole-record budgeting, and canonical current-revision validation.
One memory-owned automatic-recall operation SHALL combine stable-profile and ranked candidates and, after awaited repository and semantic retrieval completes, SHALL perform one short bulk canonical read snapshot that validates every candidate immediately before selection. It SHALL NOT rely on per-record synchronous reads or a stale ORM identity map for final validation. It SHALL deduplicate by canonical identity, preserve deterministic whole-record priority and budget decisions, and return no candidate whose partition, status, temporal eligibility, or current revision is invalid as of that final snapshot; a later external commit does not retroactively invalidate the completed selection. The protocol adapter SHALL render that final selection rather than maintain a separate stable snapshot. Approved active preferences SHALL retain their existing behavioral authority even when unpinned and selected by query; pinning governs stable inclusion and precedence rather than changing that authority.

#### Scenario: Stable relationship profile does not lexically match
- **ID**: `context.stable-profile-recall`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::automatically recalls stable relationship profile without lexical overlap`
- **WHEN** a current turn has no lexical overlap with an eligible relationship identity fact and a pinned relationship preference
- **THEN** automatic recall contributes both stable records before ordinary ranked data, excludes unpinned preferences and temporally ineligible identity facts, and contributes any duplicate ranked record only once

#### Scenario: Pinned global preference exists
- **ID**: `context.pinned-precedence-budget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** persona context is assembled
- **THEN** the pinned preference is considered before stable identity and ranked memory, and lower-priority records are omitted when required by the budget

#### Scenario: Stable memory changes while semantic recall is pending
- **ID**: `memory.recall.stable-final-revalidation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::revalidates stable and ranked memory after asynchronous recall`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::bulk revalidates final recall after awaited semantic work on both providers`
- **WHEN** a stable-profile record is corrected, forgotten, expired or made inactive while asynchronous ranked retrieval is pending
- **THEN** one final bulk canonical snapshot admits only revisions that are current and eligible as of that snapshot, never admits the earlier stale stable snapshot, and does not claim validity against later external commits

#### Scenario: Combined recall exceeds its budget
- **ID**: `memory.recall.combined-whole-record-budget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::budgets deduplicated stable and ranked recall as one selection`
- **WHEN** stable and ranked sources overlap and their eligible whole records exceed the supplied recall budget
- **THEN** the final selection counts each record once, preserves existing priority and authority, and omits whole lower-priority records to stay within the hard budget

#### Scenario: Unpinned approved preference is query relevant
- **ID**: `memory.recall.unpinned-approved-preference-authority`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::preserves approved preference authority independently of pinning`
- **WHEN** ranked recall selects an approved active unpinned preference and an ordinary fact
- **THEN** the preference retains behavioral instruction authority while the fact remains data and neither bypasses canonical eligibility or the budget

### Requirement: Memory derives actor identity only from the host service
Persistent memory SHALL require a bound session-isolated `doppelgangerActor` service and exactly one selected memory-owned `doppelgangerMemoryRepository` provider, and SHALL derive every canonical, lexical, semantic, operation, capture, and tool partition from the immutable host-supplied `actorId`. Memory configuration and tool schemas SHALL NOT accept an actor identifier, principal-identity alias, default actor, or actor-switch operation.

#### Scenario: Memory activates with host identity
- **ID**: `memory.actor.activation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **EVIDENCE**: `packages/extension-memory/tests/memory-provider-composition.spec.ts::activates host-bound memory with either canonical repository provider`
- **WHEN** Persona, actor identity, context, tools, and one canonical repository provider are available
- **THEN** memory activates in the `(instanceId, actorId)` partition supplied by the Persona and host services

#### Scenario: Authored config supplies a principal identity
- **ID**: `memory.actor.config-rejection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::rejects obsolete and unsupported memory configuration fields`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::rejects obsolete and unsupported Persona configuration fields`
- **WHEN** a Persona or memory Loader row contains the removed `principalId` configuration
- **THEN** strict configuration validation rejects the obsolete field rather than treating it as an actor binding

#### Scenario: Tool attempts to choose an actor
- **ID**: `memory.actor.tool-rejection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **WHEN** a caller includes `actorId` or `principalId` in a memory tool input whose schema does not define that field
- **THEN** validation rejects the input and the active actor partition remains unchanged

### Requirement: Scope-safe hybrid retrieval
Recall SHALL run the selected canonical repository provider's dialect-owned lexical query and optional semantic top-K retrieval as independent candidate sources. It SHALL fuse their ranks using deterministic reciprocal-rank fusion rather than raw-score addition, and SHALL preserve partition, scope, status, temporal, generation, record, and current-revision eligibility before context projection. SQLite FTS5 and PostgreSQL native full-text search MAY produce different numeric lexical ranks without changing these observable invariants.

#### Scenario: Semantic provider is absent
- **ID**: `retrieval.lexical-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses deterministic reciprocal rank fusion and keeps lexical-only operation without a provider`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::provides lexical-only recall through SQLite and PostgreSQL`
- **WHEN** a query matches eligible lexical memory and no semantic stack is active
- **THEN** recall returns the selected provider's lexical results without degrading memory activation

#### Scenario: Semantic-only record is relevant
- **ID**: `retrieval.semantic-only-fusion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-retrieval-corpus.spec.ts::observes lexical-only behavior and hybrid revalidation across every corpus query`
- **WHEN** an eligible record appears in semantic top-K but not lexical top-K
- **THEN** it remains eligible for the fused result rather than being excluded by a salience-bounded lexical candidate window

#### Scenario: Hybrid results overlap
- **ID**: `retrieval.hybrid-dedup`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses deterministic reciprocal rank fusion and keeps lexical-only operation without a provider`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::preserves deterministic hybrid fusion invariants across both canonical providers`
- **WHEN** the same current record revision appears in lexical and semantic rankings
- **THEN** it is returned once with both rank contributions and deterministic ordering

#### Scenario: Semantic result crosses scope
- **ID**: `retrieval.cross-scope-semantic-discard`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::drops out-of-scope and malformed semantic hits without failing lexical recall`
- **WHEN** a semantic backend returns an identifier outside the active partition or project eligibility
- **THEN** the result is discarded before fused ranking and context projection

#### Scenario: Semantic result is stale
- **ID**: `retrieval.stale-semantic-discard`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::revalidates record and revision identity after asynchronous semantic ranking`
- **WHEN** a vector hit names a non-current revision, inactive record, expired record, deleted record, or inactive generation
- **THEN** canonical validation discards it without exposing projected content

### Requirement: Semantic query projection preserves lexical evidence
The memory plugin SHALL derive a deterministic bounded semantic query only for embedding search. It SHALL preserve the complete principal turn for the selected canonical provider's lexical query, SHALL normalize malformed Unicode safely, and SHALL expose projection method and lengths without logging the query content.

#### Scenario: Short clean query is searched
- **ID**: `query.short-passthrough`
- **EVIDENCE**: `packages/extension-memory/tests/memory-query-projection.spec.ts::normalizes and passes through bounded Unicode input`
- **WHEN** the principal query is within the configured safe bound
- **THEN** the normalized query is passed through unchanged to the semantic embedder

#### Scenario: Long query ends with a question
- **ID**: `query.final-question`
- **EVIDENCE**: `packages/extension-memory/tests/memory-query-projection.spec.ts::prefers the final bounded question in a long turn`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::projects only the semantic branch while lexical search keeps complete technical identifiers`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::preserves complete lexical evidence while bounding semantic queries on both providers`
- **WHEN** a long principal turn contains a bounded final question
- **THEN** semantic retrieval embeds that question while the selected provider's lexical retrieval searches the full turn

#### Scenario: No meaningful bounded segment exists
- **ID**: `query.bounded-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-query-projection.spec.ts::uses the final meaningful bounded sentence then a Unicode-safe tail`
- **WHEN** a long query has no eligible question, line, or sentence
- **THEN** semantic projection uses a bounded tail and reports the fallback method without emitting query content to diagnostics

### Requirement: Memory Loader activation and persistence
The memory Loader row SHALL activate its complete service, tool, context, and storage surface only when Persona, actor identity, context, tools, and exactly one memory-owned `doppelgangerMemoryRepository` provider selected through native Loader composition are available. Its configured durable state SHALL remain available across Runtime Sessions with the same Persona Instance and actor binding without sharing mutable session objects.

#### Scenario: Memory row activates
- **ID**: `memory.activation.complete-surface-and-recall`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs semantic recall, restart, reindex, fallback, recovery, deletion, and shutdown through a child runtime`
- **EVIDENCE**: `packages/extension-memory/tests/memory-provider-composition.spec.ts::activates the complete memory surface with either canonical provider`
- **WHEN** Persona, actor identity, context, tools, and one selected canonical repository provider are available
- **THEN** one memory row opens its provider-owned store, registers the complete memory tool surface, and registers automatic eligible recall for the bound actor

#### Scenario: Actor identity is unbound or unavailable
- **ID**: `memory.activation.actor-required`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::rejects an unbound actor before opening canonical storage`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::fails memory activation before canonical storage opens when the host actor is unbound`
- **WHEN** the memory Loader row is enabled without a bound `doppelgangerActor` service in its session isolation realm
- **THEN** audited activation fails and no canonical repository connection, memory context, tool, capture, or persistent mutation surface becomes active

#### Scenario: Actor-aware Persona memory persists across restart
- **ID**: `memory.persistence.restart`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::preserves relationship and project memory across process restarts without leaking project or actor scope`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-conformance.spec.ts::preserves actor-partitioned memory across SQLite and PostgreSQL restarts`
- **WHEN** two Runtime Sessions activate the same generated full-stack test preset with the same configured Persona Instance, host actor binding, and canonical repository provider
- **THEN** eligible memory written by the first session is available to the second without sharing mutable session objects or handlers
