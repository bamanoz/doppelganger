## Purpose

Defines production-grade canonical memory for a persona relationship, including isolation, authority, provenance, reconciliation, temporal lifecycle, retrieval, optional capture, and rebuildable semantic projections.

## ADDED Requirements

### Requirement: Persona-principal partitioning
Every memory record SHALL belong to exactly one persona-instance and principal partition and SHALL have either relationship scope or project scope within that partition. Reads and mutations SHALL enforce the active partition and SHALL reject rather than silently broaden an invalid scope.

#### Scenario: Two principals use one persona instance
- **WHEN** two principals activate the same persona instance and each stores relationship memory
- **THEN** each principal can recall only records in their own persona-principal partition

#### Scenario: Project scope is queried
- **WHEN** a session recalls memory inside a project
- **THEN** eligible relationship records and records for that project may be returned, while records for every other project are excluded before ranking

#### Scenario: Session has no project
- **WHEN** a session without a project creates memory without requesting relationship scope
- **THEN** the record is created in relationship scope rather than in an unnamed project scope

### Requirement: Authored persona identity remains outside learned memory
Learned memory SHALL NOT mutate authored persona identity or traits. Memory may describe the principal, the relationship, or projects, but only authored profile contributions define who the persona is.

#### Scenario: Inferred identity claim is captured
- **WHEN** a conversation contains a claim that appears to redefine the persona
- **THEN** capture cannot modify the authored profile and may at most create a non-instruction candidate for review

### Requirement: Canonical records preserve meaning and provenance
Every record SHALL preserve kind, stable subject key, scope, status, confidence, salience, temporal validity, source session, creation and update time, current revision, and supporting or contradicting evidence sufficient to audit why the record is active.

#### Scenario: Active memory is inspected
- **WHEN** a caller inspects an active record
- **THEN** the result identifies its partition, scope, subject key, authority-relevant kind, current revision, temporal state, source, and evidence references

#### Scenario: Evidence is retained
- **WHEN** an observation supports or contradicts a candidate
- **THEN** a bounded evidence excerpt and its session, turn, role, and relation are retained without requiring storage of the full transcript

### Requirement: Idempotent mutation delivery
Every state-changing memory command SHALL accept a stable operation identity within its persona-principal partition. Repeating the same operation SHALL return the original outcome without creating additional records, revisions, evidence, or index work; reusing an operation identity for a different command SHALL fail.

#### Scenario: Committed turn is delivered twice
- **WHEN** capture submits the same candidate operation twice
- **THEN** only one candidate and one set of evidence exist

#### Scenario: Operation identity is reused with different content
- **WHEN** a caller reuses an existing operation identity for a non-equivalent mutation
- **THEN** the mutation fails with an idempotency conflict and existing memory is unchanged

### Requirement: Explicit and inferred authority remain distinct
An explicit principal-directed remember operation SHALL create active memory. Automatically extracted or agent-inferred observations SHALL create candidates only and SHALL NOT influence normal recall before promotion.

#### Scenario: Principal explicitly asks to remember
- **WHEN** the active principal explicitly requests a durable fact, preference, decision, or procedure be remembered
- **THEN** an active record is created with explicit provenance

#### Scenario: Capture infers a possible preference
- **WHEN** an optional capture extension extracts a possible preference from a committed turn
- **THEN** a reviewable candidate is created and no instruction contribution is produced from it

### Requirement: Reconciliation uses stable subjects
New observations SHALL be reconciled against eligible records with the same partition, scope, kind, and stable subject key. Equivalent observations add evidence, explicit corrections create revisions, and incompatible inferred observations create or retain a conflict requiring resolution rather than silently replacing active memory.

#### Scenario: Equivalent observation is repeated
- **WHEN** a later session provides equivalent support for the same subject
- **THEN** evidence is added without creating a duplicate active value

#### Scenario: Inferred value contradicts active memory
- **WHEN** capture proposes a different value for an active subject
- **THEN** the active value remains unchanged and the contradiction is represented as reviewable conflict evidence

#### Scenario: Principal explicitly corrects a value
- **WHEN** the principal corrects an active subject using its expected revision
- **THEN** a new revision becomes current and the prior revision remains auditable

#### Scenario: Concurrent correction races
- **WHEN** two sessions correct the same expected revision concurrently
- **THEN** exactly one correction commits and the other receives a revision conflict

### Requirement: Candidate promotion is evidence-aware
Candidates SHALL support manual approval and rejection. Automatic promotion SHALL require supporting evidence from the configured number of distinct sessions and SHALL be blocked by unresolved contradiction; principal claims such as preferences SHALL require principal-originated support.

#### Scenario: Distinct sessions corroborate a candidate
- **WHEN** a candidate receives sufficient eligible support from distinct sessions and no unresolved contradiction
- **THEN** it becomes active while retaining all promotion evidence

#### Scenario: Assistant repeats a user preference
- **WHEN** only assistant-originated observations repeat an inferred principal preference
- **THEN** the candidate remains inactive

#### Scenario: Candidate is rejected
- **WHEN** a reviewer rejects a candidate
- **THEN** it cannot enter recall or later auto-promote from additional evidence

### Requirement: Temporal memory lifecycle
Records MAY declare validity bounds or expiry. Expired and not-yet-valid records SHALL be excluded from normal recall without erasing their audit history, and explicit inspection SHALL expose their temporal state.

#### Scenario: Temporary fact expires
- **WHEN** a record's expiry time passes
- **THEN** it is excluded before retrieval ranking and context projection

#### Scenario: Historical value is inspected
- **WHEN** a caller explicitly inspects revision history after expiry or correction
- **THEN** prior content and validity metadata remain available until hard deletion

### Requirement: Secret and recursive-content rejection
Memory mutation and capture SHALL reject detected credentials and secrets. Capture SHALL remove Doppelganger-generated memory/context blocks and SHALL ignore trivial acknowledgements, tool scaffolding, and generated instructions so recalled memory cannot recursively store itself.

#### Scenario: Candidate contains a credential
- **WHEN** explicit or inferred content matches a supported secret detector
- **THEN** no record, revision, evidence excerpt, or retrievable index entry containing the secret is committed

#### Scenario: Recalled context appears in a committed turn
- **WHEN** capture receives a turn containing Doppelganger-injected context
- **THEN** the injected block is excluded from candidate content and evidence

### Requirement: Scope-safe hybrid retrieval
Recall SHALL operate without a semantic provider using lexical retrieval. When semantic retrieval is available, lexical and semantic rankings SHALL be fused by rank rather than incompatible raw score addition, while preserving partition, scope, status, temporal, and current-revision filters.

#### Scenario: Semantic provider is absent
- **WHEN** a query matches eligible lexical memory and no semantic provider is active
- **THEN** recall returns the lexical results without degrading memory activation

#### Scenario: Hybrid results overlap
- **WHEN** a record appears in both lexical and semantic rankings
- **THEN** it is returned once with deterministic fused ordering

#### Scenario: Semantic result crosses scope
- **WHEN** a semantic provider returns an identifier outside the active partition or project eligibility
- **THEN** that result is discarded before context projection

### Requirement: Current-revision validation
A semantic result SHALL identify the canonical record and indexed revision. Recall SHALL validate both against authoritative memory before returning content, so a stale projection cannot resurrect corrected, rejected, expired, or deleted memory.

#### Scenario: Semantic index returns superseded revision
- **WHEN** a record was corrected after its semantic revision was indexed
- **THEN** the stale result is excluded and cannot expose the superseded content

#### Scenario: Semantic index returns deleted record
- **WHEN** hard deletion completed but an external index still returns the former identifier
- **THEN** recall returns no content for that identifier

### Requirement: Deterministic context authority and budget
Recall SHALL prioritize eligible pinned relationship preferences, diversify results by subject, and fit whole contributions within the supplied token budget. Approved preferences may contribute instructions; facts, decisions, procedures, archive fragments, candidates, and conflicts SHALL NOT gain instruction authority.

#### Scenario: Memory conflicts with authored profile
- **WHEN** recalled memory contradicts persona identity or traits
- **THEN** the authored profile remains authoritative and ordinary memory is represented as data

#### Scenario: Budget cannot fit a record
- **WHEN** adding a record would exceed the supplied token budget
- **THEN** that record is omitted without truncating it into misleading content

### Requirement: Optional capture is committed-turn driven and fail-open
Automatic capture SHALL be an optional extension driven by a committed turn containing stable session and turn identity plus principal input and completed assistant output. Capture failure SHALL not fail the host turn. No hidden model call or transcript mining SHALL run during shutdown.

#### Scenario: Meaningful turn commits
- **WHEN** capture is enabled and a complete eligible turn is published
- **THEN** the configured extractor may submit bounded candidates through the canonical memory interface

#### Scenario: Host cannot provide committed output
- **WHEN** a host lacks a complete committed-turn payload
- **THEN** automatic capture for that turn is skipped rather than inferred from partial state

#### Scenario: Session exits abruptly
- **WHEN** shutdown occurs without a committed-turn capture
- **THEN** no shutdown extraction is attempted and no full transcript is persisted

### Requirement: Hard deletion covers canonical and derived state
A confirmed forget operation SHALL permanently remove the record, all revisions, evidence, conflicts, lexical entries, cached embeddings owned by memory, and pending projection work. External semantic adapters SHALL receive enough identity to delete their projection, while authoritative recall SHALL suppress stale external results immediately.

#### Scenario: Record is forgotten while semantic deletion is delayed
- **WHEN** canonical hard deletion succeeds but an optional semantic adapter is unavailable
- **THEN** local inspection and recall no longer expose the record and later stale semantic results remain suppressed

### Requirement: Existing memory migrates without loss
Existing instance memory SHALL migrate in place to the production schema. Existing active records and immutable revision history SHALL remain retrievable in the same persona instance and project, with the configured default principal owning legacy data.

#### Scenario: Existing database activates after upgrade
- **WHEN** an instance with the previous memory schema is first activated under the new version
- **THEN** migration completes transactionally and its prior active records, scopes, pins, and revision history remain available

#### Scenario: Migration fails
- **WHEN** existing state cannot be migrated safely
- **THEN** memory activation fails with a diagnostic and the previous database remains recoverable rather than partially migrated
