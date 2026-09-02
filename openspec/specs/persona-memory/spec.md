# Persona Memory Specification

## Purpose

Defines durable, scoped, reviewable persona memory that preserves provenance and corrections while remaining an optional plugin outside the runtime kernel.

## Requirements

### Requirement: Scoped memory records
Every memory record SHALL belong to a Persona Instance and SHALL declare either global scope or a stable project scope.

#### Scenario: Record created without explicit global scope
- **ID**: `scope.project-default`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::isolates actors and projects before direct lookup or mutation`
- **WHEN** memory is written during a configured project session without an approved global promotion
- **THEN** the record is stored in that project's scope

#### Scenario: Global promotion proposed
- **ID**: `scope.global-promotion-proposal`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::keeps candidates out of recall until manual approval and makes rejection terminal`
- **WHEN** an agent identifies project memory as potentially global
- **THEN** it creates a promotion proposal rather than changing the record scope automatically

### Requirement: Candidate review
The memory plugin SHALL allow candidates to be listed, approved, and rejected through agent tools.

#### Scenario: Candidate approved manually
- **ID**: `candidate.manual-approval`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::keeps candidates out of recall until manual approval and makes rejection terminal`
- **WHEN** a user approves a candidate
- **THEN** the candidate becomes an active memory record with its provenance retained

### Requirement: Corroboration promotion
Automatic candidate promotion SHALL occur only when the active agent links a semantically corroborating observation from a distinct session and no unresolved contradiction is recorded.

#### Scenario: Same session repeats candidate
- **ID**: `promotion.same-session-insufficient`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::requires distinct-session principal evidence for preference auto-promotion`
- **WHEN** a candidate is repeated within its original session
- **THEN** the repetition does not satisfy the two-session promotion rule

### Requirement: Hard deletion
The user SHALL be able to permanently delete a memory record and all of its revisions.

#### Scenario: User forgets a record
- **ID**: `deletion.hard-complete`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::preserves immutable correction history and deep hard deletion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-schema.spec.ts::hard deletion removes canonical and derived rows while retaining content-free replay protection`
- **WHEN** the user confirms hard deletion of a memory record
- **THEN** the record, revisions, retrieval entries, and derived embeddings are removed

### Requirement: Memory retrieval
The memory plugin SHALL support actor-partition-safe lexical retrieval without semantic plugins. When one semantic stack is active, it SHALL retrieve independent semantic top-K candidates over the configured active vector generation, fuse lexical and semantic ranks deterministically, and continue with lexical retrieval when semantic generation, health, query, or result validation fails.

#### Scenario: Project recall
- **ID**: `retrieval.project-partition`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** the current principal turn matches active project records
- **THEN** retrieval returns relevant records from that project plus eligible relationship records without returning records from another project or actor

#### Scenario: Semantic operation fails
- **ID**: `retrieval.semantic-failure-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::contains semantic timeout and provider exceptions`
- **WHEN** query embedding, vector search, or semantic result parsing throws or times out
- **THEN** the same recall request returns eligible lexical results and records a bounded semantic diagnostic

#### Scenario: Long principal turn is searched
- **ID**: `retrieval.long-query-projection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::projects only the semantic branch while lexical search keeps complete technical identifiers`
- **WHEN** a principal turn exceeds the semantic safe-query bound
- **THEN** FTS5 receives the complete turn while the embedder receives a deterministic bounded intent projection

### Requirement: Recall authority and budget
Automatic recall SHALL treat ordinary records as data, SHALL treat approved preference records as behavioral contributions, and SHALL respect the host-provided context budget.

#### Scenario: Pinned global preference exists
- **ID**: `context.pinned-precedence-budget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** persona context is assembled
- **THEN** the pinned preference is considered before ranked memory and lower-priority records are omitted when required by the budget

### Requirement: Memory maintenance tools
The memory plugin SHALL expose namespaced tools for search, remember, correct, forget, candidate review, approval and rejection, and pinning and unpinning.

#### Scenario: Tool registry lists memory tools
- **ID**: `tools.registry`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **WHEN** the memory plugin is active
- **THEN** the tool registry exposes the complete namespaced maintenance surface

### Requirement: Transcript and extraction policy
Full transcript persistence SHALL remain disabled by default. Optional candidate extraction SHALL consume only bounded completed committed-turn material, SHALL create candidates rather than active memory, and SHALL emit an observation only when it can provide a valid kind, stable subject key, bounded content, and provenance. The bundled deterministic extractor SHALL recognize conservative durable preferences, decisions, facts, procedures, and explicit remember requests while skipping ambiguous key derivation, authored Persona identity, assistant promises, task chatter, generated or recursive context, secrets, and incomplete turns.

#### Scenario: Durable principal statement has a stable key
- **ID**: `capture.stable-key-candidate`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::extracts conservative durable patterns as candidates without changing authored identity`
- **WHEN** a completed committed principal turn matches a configured conservative durable pattern and yields a valid stable subject key
- **THEN** capture may submit a reviewable candidate with principal evidence

#### Scenario: Durable statement has no stable key
- **ID**: `capture.unstable-key-skip`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::extracts conservative durable patterns as candidates without changing authored identity`
- **WHEN** a statement appears memorable but the extractor cannot derive a stable validated subject key
- **THEN** the bundled extractor skips it rather than inventing an unstable canonical subject

### Requirement: Memory derives actor identity only from the host service
Persistent memory SHALL require a bound session-isolated `doppelgangerActor` service and SHALL derive every canonical, lexical, semantic, operation, capture, and tool partition from its immutable `actorId`. Memory configuration and tool schemas SHALL NOT accept an actor identifier, principal-identity alias, default actor, or actor-switch operation.

#### Scenario: Memory activates with host identity
- **ID**: `memory.actor.activation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** Persona, actor identity, context, tools, and SQLite dependencies are available
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

### Requirement: Actor identity naming is a clean public cutover
Memory records, requests, results, partitions, semantic contracts, vector entries, filters, and backend metadata SHALL use `actorId` in TypeScript/JSON and `actor_id` in maintained SQL schemas. Identity fields or aliases named `principalId` or `principal_id` SHALL NOT remain in supported contracts; conversation-authorship terms such as `principalInput` and evidence role `principal` SHALL remain unchanged.

#### Scenario: Consumer inspects a record
- **ID**: `memory.actor.record-naming`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::isolates actors and projects before direct lookup or mutation`
- **WHEN** a caller receives a memory record or semantic projection value
- **THEN** the actor partition is exposed as `actorId` and no principal-identity alias is present

#### Scenario: Committed principal input is captured
- **ID**: `memory.actor.authorship-terms`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::extracts conservative durable patterns as candidates without changing authored identity`
- **WHEN** the lifecycle protocol delivers bounded user-authored turn content
- **THEN** capture continues to label the content `principalInput` and principal evidence without treating those authorship terms as identity fields

### Requirement: Derived semantic state follows actor partition naming
Every local or remote vector backend SHALL store and filter actor partition metadata as `actorId` or `actor_id`. Derived state whose persisted identity schema uses principal-named fields SHALL be treated as incompatible and SHALL be transactionally migrated when safe or rebuilt from canonical current revisions before becoming active; lexical recall SHALL remain available during rebuild or backend failure.

#### Scenario: Existing derived index uses principal metadata
- **ID**: `memory.actor.derived-migration`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/sqlite-exact.spec.ts::migrates a populated principal-partition artifact to actor schema version two`
- **EVIDENCE**: `packages/extension-memory-vectors/tests/pgvector.spec.ts::migrates a principal-partition table to actor schema version two transactionally`
- **WHEN** semantic coordination opens a local or remote derived index created by the previous principal-named contract
- **THEN** stale entries cannot become active actor-partition results and the coordinator rebuilds or migrates them under the actor schema before semantic recall resumes

#### Scenario: Semantic rebuild is unavailable
- **ID**: `memory.actor.semantic-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::contains semantic timeout and provider exceptions`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::drops out-of-scope and malformed semantic hits without failing lexical recall`
- **WHEN** the derived actor-named index cannot be rebuilt or queried
- **THEN** canonical actor-scoped lexical retrieval continues and no result from another actor is exposed

### Requirement: Persona-actor partitioning
Every memory record SHALL belong to exactly one Persona Instance and actor partition and SHALL have either relationship scope or project scope within that partition. Reads and mutations SHALL derive the actor from the active host service, enforce the complete partition, and reject rather than silently broaden an invalid scope.

#### Scenario: Two actors use one persona instance
- **ID**: `partition.actor-isolation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::isolates actors and projects before direct lookup or mutation`
- **WHEN** two actors activate the same Persona Instance and each stores relationship memory
- **THEN** each actor can recall only records in their own Persona-actor partition

#### Scenario: Project scope is queried
- **ID**: `partition.project-eligibility`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** a session recalls memory inside a project
- **THEN** eligible relationship records and records for that project may be returned, while records for every other project or actor are excluded before ranking

#### Scenario: Session has no project
- **ID**: `scope.relationship-default`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::falls back to relationship scope when no project is active`
- **WHEN** a session without a project creates memory without requesting relationship scope
- **THEN** the record is created in relationship scope rather than in an unnamed project scope

### Requirement: Authored persona identity remains outside learned memory
Learned memory SHALL NOT mutate authored persona identity or traits. Memory may describe the principal, the relationship, or projects, but only authored profile contributions define who the persona is.

#### Scenario: Inferred identity claim is captured
- **ID**: `identity.authored-profile-protection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::extracts conservative durable patterns as candidates without changing authored identity`
- **WHEN** a conversation contains a claim that appears to redefine the persona
- **THEN** capture cannot modify the authored profile and may at most create a non-instruction candidate for review

### Requirement: Canonical records preserve meaning and provenance
Every record SHALL preserve kind, stable subject key, scope, status, confidence, salience, temporal validity, source session, creation and update time, current revision, and supporting or contradicting evidence sufficient to audit why the record is active.

#### Scenario: Active memory is inspected
- **ID**: `records.inspect-active`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **WHEN** a caller inspects an active record
- **THEN** the result identifies its partition, scope, subject key, authority-relevant kind, current revision, temporal state, source, and evidence references

#### Scenario: Evidence is retained
- **ID**: `evidence.bounded-provenance`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::bounds evidence excerpts and rejects secret-bearing evidence atomically`
- **WHEN** an observation supports or contradicts a candidate
- **THEN** a bounded evidence excerpt and its session, turn, role, and relation are retained without requiring storage of the full transcript

### Requirement: Idempotent mutation delivery
Every state-changing memory command SHALL accept a stable operation identity within its Persona-actor partition. Repeating the same operation SHALL return the original outcome without creating additional records, revisions, evidence, or index work; reusing an operation identity for a different command SHALL fail.

#### Scenario: Committed turn is delivered twice
- **ID**: `idempotency.duplicate-delivery`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::derives idempotent operations from delivery identity and never extracts during disposal`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::makes mutations idempotent and reconciles equivalent subject observations as evidence`
- **WHEN** capture submits the same candidate operation twice for the same actor binding
- **THEN** only one candidate and one set of evidence exist

#### Scenario: Operation identity is reused with different content
- **ID**: `idempotency.conflict`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::makes mutations idempotent and reconciles equivalent subject observations as evidence`
- **WHEN** a caller reuses an existing operation identity for a non-equivalent mutation in the active actor partition
- **THEN** the mutation fails with an idempotency conflict and existing memory is unchanged

### Requirement: Explicit and inferred authority remain distinct
An explicit principal-directed remember operation SHALL create active memory. Automatically extracted or agent-inferred observations SHALL create candidates only and SHALL NOT influence normal recall before promotion.

#### Scenario: Principal explicitly asks to remember
- **ID**: `authority.explicit-active`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** the active principal explicitly requests a durable fact, preference, decision, or procedure be remembered
- **THEN** an active record is created with explicit provenance

#### Scenario: Capture infers a possible preference
- **ID**: `authority.inferred-candidate`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::keeps candidates out of recall until manual approval and makes rejection terminal`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::extracts conservative durable patterns as candidates without changing authored identity`
- **WHEN** an optional capture extension extracts a possible preference from a committed turn
- **THEN** a reviewable candidate is created and no instruction contribution is produced from it

### Requirement: Reconciliation uses stable subjects
Canonical reconciliation SHALL continue to use partition, scope, kind, and stable subject key. Semantic similarity MAY identify review suggestions within the same eligible partition, scope, and kind, but SHALL NOT by itself add evidence, rewrite a subject key, merge records, promote a candidate, correct an active revision, or delete state.

#### Scenario: Equivalent observation repeats the same subject
- **ID**: `reconciliation.equivalent-subject`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::makes mutations idempotent and reconciles equivalent subject observations as evidence`
- **WHEN** a later session provides equivalent support for the same stable subject through an explicit or validated observation
- **THEN** evidence is added under the existing reconciliation rules without creating a duplicate active value

#### Scenario: Similar candidate has a different subject key
- **ID**: `reconciliation.cross-subject-suggestion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::emits only canonically valid same-partition and same-kind neighbor suggestions without mutation`
- **WHEN** semantic reconciliation finds a likely paraphrase under another subject key
- **THEN** it creates or returns a review suggestion while both canonical records remain unchanged

#### Scenario: Semantic neighbor may contradict active memory
- **ID**: `reconciliation.non-authoritative-conflict`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::represents inferred contradictions as reviewable conflicts without replacing active memory`
- **WHEN** similarity search surfaces content that may conflict with an active record
- **THEN** the active revision remains unchanged until explicit evidence and conflict-resolution rules establish an outcome

#### Scenario: Principal explicitly corrects a value
- **ID**: `correction.expected-revision`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::preserves immutable correction history and deep hard deletion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::commits exactly one concurrent-session correction for an expected revision`
- **WHEN** the principal corrects an active subject using its expected revision
- **THEN** a new revision becomes current and the prior revision remains auditable independent of semantic similarity

### Requirement: Candidate promotion is evidence-aware
Candidates SHALL support manual approval and rejection. Automatic promotion SHALL require supporting evidence from the configured number of distinct sessions and SHALL be blocked by unresolved contradiction; principal claims such as preferences SHALL require principal-originated support.

#### Scenario: Distinct sessions corroborate a candidate
- **ID**: `promotion.evidence-aware`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::requires distinct-session principal evidence for preference auto-promotion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::blocks promotion when contradiction evidence exists`
- **WHEN** a candidate receives sufficient eligible support from distinct sessions and no unresolved contradiction
- **THEN** it becomes active while retaining all promotion evidence

#### Scenario: Assistant repeats a user preference
- **ID**: `promotion.assistant-evidence-ineligible`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::requires distinct-session principal evidence for preference auto-promotion`
- **WHEN** only assistant-originated observations repeat an inferred principal preference
- **THEN** the candidate remains inactive

#### Scenario: Candidate is rejected
- **ID**: `candidate.rejection-terminal`
- **EVIDENCE**: `packages/extension-memory/tests/memory-candidates.spec.ts::keeps candidates out of recall until manual approval and makes rejection terminal`
- **WHEN** a reviewer rejects a candidate
- **THEN** it cannot enter recall or later auto-promote from additional evidence

### Requirement: Temporal memory lifecycle
Records MAY declare validity bounds or expiry. Expired and not-yet-valid records SHALL be excluded from normal recall without erasing their audit history, and explicit inspection SHALL expose their temporal state.

#### Scenario: Temporary fact expires
- **ID**: `temporal.expiry-exclusion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::applies temporal eligibility at read time while retaining inspection history`
- **WHEN** a record's expiry time passes
- **THEN** it is excluded before retrieval ranking and context projection

#### Scenario: Historical value is inspected
- **ID**: `temporal.history-inspection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::applies temporal eligibility at read time while retaining inspection history`
- **WHEN** a caller explicitly inspects revision history after expiry or correction
- **THEN** prior content and validity metadata remain available until hard deletion

### Requirement: Secret and recursive-content rejection
Memory mutation and capture SHALL reject detected credentials and secrets. Capture SHALL remove Doppelganger-generated memory/context blocks and SHALL ignore trivial acknowledgements, tool scaffolding, and generated instructions so recalled memory cannot recursively store itself.

#### Scenario: Candidate contains a credential
- **ID**: `security.secret-rejection`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::bounds evidence excerpts and rejects secret-bearing evidence atomically`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::rejects secrets before creating records, evidence, or receipts`
- **WHEN** explicit or inferred content matches a supported secret detector
- **THEN** no record, revision, evidence excerpt, or retrievable index entry containing the secret is committed

#### Scenario: Recalled context appears in a committed turn
- **ID**: `capture.recursive-context-filter`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::filters recursive context, trivial, generated, secret, non-string, and oversized material before extraction`
- **WHEN** capture receives a turn containing Doppelganger-injected context
- **THEN** the injected block is excluded from candidate content and evidence

### Requirement: Scope-safe hybrid retrieval
Recall SHALL run canonical FTS5 and optional semantic top-K retrieval as independent candidate sources. It SHALL fuse their ranks using deterministic reciprocal-rank fusion rather than raw-score addition, and SHALL preserve partition, scope, status, temporal, generation, record, and current-revision eligibility before context projection.

#### Scenario: Semantic provider is absent
- **ID**: `retrieval.lexical-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses deterministic reciprocal rank fusion and keeps lexical-only operation without a provider`
- **WHEN** a query matches eligible lexical memory and no semantic stack is active
- **THEN** recall returns the lexical results without degrading memory activation

#### Scenario: Semantic-only record is relevant
- **ID**: `retrieval.semantic-only-fusion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-retrieval-corpus.spec.ts::observes lexical-only behavior and hybrid revalidation across every corpus query`
- **WHEN** an eligible record appears in semantic top-K but not lexical top-K
- **THEN** it remains eligible for the fused result rather than being excluded by a salience-bounded lexical candidate window

#### Scenario: Hybrid results overlap
- **ID**: `retrieval.hybrid-dedup`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses deterministic reciprocal rank fusion and keeps lexical-only operation without a provider`
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

### Requirement: Deterministic context authority and budget
Recall SHALL prioritize eligible pinned relationship preferences, diversify results by subject, and fit whole contributions within the supplied token budget. Approved preferences may contribute instructions; facts, decisions, procedures, archive fragments, candidates, and conflicts SHALL NOT gain instruction authority.

#### Scenario: Memory conflicts with authored profile
- **ID**: `context.profile-authority`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **WHEN** recalled memory contradicts persona identity or traits
- **THEN** the authored profile remains authoritative and ordinary memory is represented as data

#### Scenario: Budget cannot fit a record
- **ID**: `context.whole-record-budget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** adding a record would exceed the supplied token budget
- **THEN** that record is omitted without truncating it into misleading content

### Requirement: Optional capture is committed-turn driven and fail-open
Automatic capture SHALL remain an optional extension driven by a completed committed turn containing stable delivery, session, and turn identity plus bounded principal input and assistant output. Extractor, semantic-neighbor, candidate-validation, or candidate-write failure SHALL be contained and SHALL NOT fail the committed host turn. No hidden model call or transcript mining SHALL run during shutdown.

#### Scenario: Meaningful turn commits
- **ID**: `capture.committed-turn`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::captures committed OMP turns only as idempotent review candidates`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::forwards committed OMP turns into capture only when the row is enabled`
- **WHEN** capture is enabled and a complete eligible turn is published
- **THEN** the configured extractor may submit bounded candidates through the canonical memory interface

#### Scenario: Extractor fails
- **ID**: `capture.fail-open`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::contains neighbor and suggestion observer failures while preserving committed candidate writes`
- **WHEN** the configured extractor or optional semantic reconciliation throws
- **THEN** the committed host turn remains successful and capture records only a bounded diagnostic

#### Scenario: Host cannot provide committed output
- **ID**: `capture.missing-commit-skip`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::captures committed OMP turns only as idempotent review candidates`
- **WHEN** a host lacks a complete committed-turn payload
- **THEN** automatic capture for that turn is skipped rather than inferred from partial state

#### Scenario: Session exits abruptly
- **ID**: `capture.no-shutdown-extraction`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::derives idempotent operations from delivery identity and never extracts during disposal`
- **WHEN** shutdown occurs without a committed-turn capture
- **THEN** no shutdown extraction is attempted and no full transcript is persisted

### Requirement: Hard deletion covers canonical and derived state
A confirmed forget operation SHALL transactionally make the record invisible and remove its canonical record, revisions, evidence, conflicts, lexical entries, locally cached embeddings, and content-bearing projection work. For each configured external semantic generation it SHALL retain only deterministic identifier-only deletion work until the adapter confirms removal. Stale external hits SHALL remain suppressed by canonical validation throughout any outage.

#### Scenario: Record is forgotten with a healthy semantic backend
- **ID**: `deletion.healthy-semantic`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::hard-deletes content immediately and retains only retryable vector identities`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs semantic recall, restart, reindex, fallback, recovery, deletion, and shutdown through a child runtime`
- **WHEN** canonical deletion commits and the active vector adapter is available
- **THEN** the canonical state disappears immediately and the corresponding vector identities are deleted idempotently

#### Scenario: Record is forgotten while semantic deletion is delayed
- **ID**: `deletion.pending-semantic`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::hard-deletes content immediately and retains only retryable vector identities`
- **WHEN** canonical hard deletion succeeds but an optional semantic adapter is unavailable
- **THEN** local inspection and recall no longer expose the record, an opaque deletion tombstone remains retryable, and stale semantic hits are discarded

#### Scenario: Deletion retry completes
- **ID**: `deletion.retry-completion`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::hard-deletes content immediately and retains only retryable vector identities`
- **WHEN** the unavailable adapter later confirms deletion for the retained canonical identities
- **THEN** the identifier-only tombstone is removed without restoring or rereading deleted content

#### Scenario: Deletion state is inspected
- **ID**: `deletion.status`
- **EVIDENCE**: `packages/extension-memory/tests/memory-projections.spec.ts::hard-deletes content immediately and retains only retryable vector identities`
- **WHEN** semantic status is requested while external deletion is pending
- **THEN** it reports the bounded pending count and failure category without record content, vectors, credentials, or query text

### Requirement: Semantic query projection preserves lexical evidence
The memory plugin SHALL derive a deterministic bounded semantic query only for embedding search. It SHALL preserve the complete principal turn for FTS5, SHALL normalize malformed Unicode safely, and SHALL expose projection method and lengths without logging the query content.

#### Scenario: Short clean query is searched
- **ID**: `query.short-passthrough`
- **EVIDENCE**: `packages/extension-memory/tests/memory-query-projection.spec.ts::normalizes and passes through bounded Unicode input`
- **WHEN** the principal query is within the configured safe bound
- **THEN** the normalized query is passed through unchanged to the semantic embedder

#### Scenario: Long query ends with a question
- **ID**: `query.final-question`
- **EVIDENCE**: `packages/extension-memory/tests/memory-query-projection.spec.ts::prefers the final bounded question in a long turn`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::projects only the semantic branch while lexical search keeps complete technical identifiers`
- **WHEN** a long principal turn contains a bounded final question
- **THEN** semantic retrieval embeds that question while lexical retrieval searches the full turn

#### Scenario: No meaningful bounded segment exists
- **ID**: `query.bounded-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-query-projection.spec.ts::uses the final meaningful bounded sentence then a Unicode-safe tail`
- **WHEN** a long query has no eligible question, line, or sentence
- **THEN** semantic projection uses a bounded tail and reports the fallback method without emitting query content to diagnostics

### Requirement: Semantic reconciliation remains non-authoritative
Semantic nearest-neighbor lookup for candidates SHALL be advisory and limited to the same Persona Instance, actor, scope, and kind. Similarity thresholds SHALL produce review hints only; canonical evidence, subject, conflict, correction, and promotion commands remain the exclusive state-changing paths.

#### Scenario: Neighbor belongs to another partition
- **ID**: `reconciliation.cross-partition-discard`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::emits only canonically valid same-partition and same-kind neighbor suggestions without mutation`
- **WHEN** a vector backend returns a semantically similar candidate from another actor, instance, or project
- **THEN** it is discarded and cannot appear in reconciliation suggestions

### Requirement: Existing memory migrates without loss
Existing instance memory SHALL migrate transactionally from principal-named identity columns to actor-named identity columns without changing identifier values. Existing active records, operation receipts, immutable revision history, scopes, and provenance SHALL remain retrievable in the same Persona Instance, actor, and project after upgrade.

#### Scenario: Existing principal-partition database activates after upgrade
- **ID**: `migration.actor-rename-upgrade`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::preserves relationship and project memory across process restarts without leaking project or actor scope`
- **WHEN** a supported database with `principal_id` partition columns is first activated with the same host identifier value as `actorId`
- **THEN** migration renames the partition contract atomically and all prior canonical memory remains available under that actor

#### Scenario: Migration fails
- **ID**: `migration.rollback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-schema.spec.ts::rolls back a failed version three actor-column migration`
- **WHEN** existing state cannot be migrated safely
- **THEN** memory activation fails with a diagnostic and the previous database remains recoverable rather than partially migrated

#### Scenario: Version-one legacy memory is upgraded directly
- **ID**: `migration.version-one-actor-assignment`
- **EVIDENCE**: `packages/extension-memory/tests/memory-schema.spec.ts::migrates populated version one state without losing lineage or eligibility`
- **WHEN** a version-one database without an identity partition is activated after the actor cutover
- **THEN** the migration assigns its legacy records to the active host `actorId` and completes the remaining schema migrations in one transaction

### Requirement: Memory Loader activation and persistence
The memory Loader row SHALL activate its complete service, tool, context, and storage surface only when Persona, actor identity, context, tools, and SQLite dependencies are available. Its configured durable state SHALL remain available across Runtime Sessions with the same Persona Instance and actor binding without sharing mutable session objects.

#### Scenario: Memory row activates
- **ID**: `memory.activation.complete-surface-and-recall`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs semantic recall, restart, reindex, fallback, recovery, deletion, and shutdown through a child runtime`
- **WHEN** Persona, actor identity, context, tools, and SQLite dependencies are available
- **THEN** one memory row opens its namespaced store, registers the complete memory tool surface, and registers automatic eligible recall for the bound actor

#### Scenario: Actor identity is unbound or unavailable
- **ID**: `memory.activation.actor-required`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::rejects an unbound actor before opening canonical storage`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::fails memory activation before canonical storage opens when the host actor is unbound`
- **WHEN** the memory Loader row is enabled without a bound `doppelgangerActor` service in its session isolation realm
- **THEN** audited activation fails and no database, memory context, tool, capture, or persistent mutation surface becomes active

#### Scenario: Actor-aware Persona memory persists across restart
- **ID**: `memory.persistence.restart`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::preserves relationship and project memory across process restarts without leaking project or actor scope`
- **WHEN** two Runtime Sessions activate the same generated full-stack test preset with the same configured Persona Instance storage and host actor binding
- **THEN** eligible memory written by the first session is available to the second without sharing mutable session objects or handlers
