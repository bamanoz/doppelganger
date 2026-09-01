## MODIFIED Requirements

### Requirement: Memory retrieval
The memory plugin SHALL support partition-safe lexical retrieval without semantic plugins. When one semantic stack is active, it SHALL retrieve independent semantic top-K candidates over the configured active vector generation, fuse lexical and semantic ranks deterministically, and continue with lexical retrieval when semantic generation, health, query, or result validation fails.

#### Scenario: Project recall
- **WHEN** the current principal turn matches active project records
- **THEN** retrieval returns relevant records from that project plus eligible relationship records without returning records from another project or principal

#### Scenario: Semantic stack absent
- **WHEN** no complete semantic stack is active
- **THEN** search and automatic recall use FTS5 without failing memory activation or canonical mutations

#### Scenario: Semantic stack available
- **WHEN** an eligible record is returned by the active vector generation but is outside the lexical result set
- **THEN** it participates in deterministic hybrid ranking after canonical validation

#### Scenario: Semantic operation fails
- **WHEN** query embedding, vector search, or semantic result parsing throws or times out
- **THEN** the same recall request returns eligible lexical results and records a bounded semantic diagnostic

#### Scenario: Long principal turn is searched
- **WHEN** a principal turn exceeds the semantic safe-query bound
- **THEN** FTS5 receives the complete turn while the embedder receives a deterministic bounded intent projection

### Requirement: Transcript and extraction policy
Full transcript persistence SHALL remain disabled by default. Optional candidate extraction SHALL consume only bounded completed committed-turn material, SHALL create candidates rather than active memory, and SHALL emit an observation only when it can provide a valid kind, stable subject key, bounded content, and provenance. The bundled deterministic extractor SHALL recognize conservative durable preferences, decisions, facts, procedures, and explicit remember requests while skipping ambiguous key derivation, authored Persona identity, assistant promises, task chatter, generated or recursive context, secrets, and incomplete turns.

#### Scenario: Durable principal statement has a stable key
- **WHEN** a completed committed principal turn matches a configured conservative durable pattern and yields a valid stable subject key
- **THEN** capture may submit a reviewable candidate with principal evidence

#### Scenario: Durable statement has no stable key
- **WHEN** a statement appears memorable but the extractor cannot derive a stable validated subject key
- **THEN** the bundled extractor skips it rather than inventing an unstable canonical subject

#### Scenario: Authored Persona claim is encountered
- **WHEN** captured material attempts to redefine Persona identity or authored traits
- **THEN** capture cannot mutate authored profile state or create an instruction-authority memory

#### Scenario: Session terminates without a completed commit
- **WHEN** a session ends abruptly or only partial output exists
- **THEN** no shutdown extraction or full transcript persistence occurs

### Requirement: Reconciliation uses stable subjects
Canonical reconciliation SHALL continue to use partition, scope, kind, and stable subject key. Semantic similarity MAY identify review suggestions within the same eligible partition, scope, and kind, but SHALL NOT by itself add evidence, rewrite a subject key, merge records, promote a candidate, correct an active revision, or delete state.

#### Scenario: Equivalent observation repeats the same subject
- **WHEN** a later session provides equivalent support for the same stable subject through an explicit or validated observation
- **THEN** evidence is added under the existing reconciliation rules without creating a duplicate active value

#### Scenario: Similar candidate has a different subject key
- **WHEN** semantic reconciliation finds a likely paraphrase under another subject key
- **THEN** it creates or returns a review suggestion while both canonical records remain unchanged

#### Scenario: Semantic neighbor may contradict active memory
- **WHEN** similarity search surfaces content that may conflict with an active record
- **THEN** the active revision remains unchanged until explicit evidence and conflict-resolution rules establish an outcome

#### Scenario: Principal explicitly corrects a value
- **WHEN** the principal corrects an active subject using its expected revision
- **THEN** a new revision becomes current and the prior revision remains auditable independent of semantic similarity

### Requirement: Scope-safe hybrid retrieval
Recall SHALL run canonical FTS5 and optional semantic top-K retrieval as independent candidate sources. It SHALL fuse their ranks using deterministic reciprocal-rank fusion rather than raw-score addition, and SHALL preserve partition, scope, status, temporal, generation, record, and current-revision eligibility before context projection.

#### Scenario: Semantic provider is absent
- **WHEN** a query matches eligible lexical memory and no semantic stack is active
- **THEN** recall returns the lexical results without degrading memory activation

#### Scenario: Semantic-only record is relevant
- **WHEN** an eligible record appears in semantic top-K but not lexical top-K
- **THEN** it remains eligible for the fused result rather than being excluded by a salience-bounded lexical candidate window

#### Scenario: Hybrid results overlap
- **WHEN** the same current record revision appears in lexical and semantic rankings
- **THEN** it is returned once with both rank contributions and deterministic ordering

#### Scenario: Semantic result crosses scope
- **WHEN** a semantic backend returns an identifier outside the active partition or project eligibility
- **THEN** the result is discarded before fused ranking and context projection

#### Scenario: Semantic result is stale
- **WHEN** a vector hit names a non-current revision, inactive record, expired record, deleted record, or inactive generation
- **THEN** canonical validation discards it without exposing projected content

### Requirement: Optional capture is committed-turn driven and fail-open
Automatic capture SHALL remain an optional extension driven by a completed committed turn containing stable delivery, session, and turn identity plus bounded principal input and assistant output. Extractor, semantic-neighbor, candidate-validation, or candidate-write failure SHALL be contained and SHALL NOT fail the committed host turn. No hidden model call or transcript mining SHALL run during shutdown.

#### Scenario: Meaningful turn commits
- **WHEN** capture is enabled and a complete eligible turn is published
- **THEN** the configured extractor may submit bounded candidates through the canonical memory interface

#### Scenario: Extractor fails
- **WHEN** the configured extractor or optional semantic reconciliation throws
- **THEN** the committed host turn remains successful and capture records only a bounded diagnostic

#### Scenario: Host cannot provide committed output
- **WHEN** a host lacks a complete committed-turn payload
- **THEN** automatic capture for that turn is skipped rather than inferred from partial state

#### Scenario: Session exits abruptly
- **WHEN** shutdown occurs without a committed-turn capture
- **THEN** no shutdown extraction is attempted and no full transcript is persisted

### Requirement: Hard deletion covers canonical and derived state
A confirmed forget operation SHALL transactionally make the record invisible and remove its canonical record, revisions, evidence, conflicts, lexical entries, locally cached embeddings, and content-bearing projection work. For each configured external semantic generation it SHALL retain only deterministic identifier-only deletion work until the adapter confirms removal. Stale external hits SHALL remain suppressed by canonical validation throughout any outage.

#### Scenario: Record is forgotten with a healthy semantic backend
- **WHEN** canonical deletion commits and the active vector adapter is available
- **THEN** the canonical state disappears immediately and the corresponding vector identities are deleted idempotently

#### Scenario: Record is forgotten while semantic deletion is delayed
- **WHEN** canonical hard deletion succeeds but an optional semantic adapter is unavailable
- **THEN** local inspection and recall no longer expose the record, an opaque deletion tombstone remains retryable, and stale semantic hits are discarded

#### Scenario: Deletion retry completes
- **WHEN** the unavailable adapter later confirms deletion for the retained canonical identities
- **THEN** the identifier-only tombstone is removed without restoring or rereading deleted content

#### Scenario: Deletion state is inspected
- **WHEN** semantic status is requested while external deletion is pending
- **THEN** it reports the bounded pending count and failure category without record content, vectors, credentials, or query text

## ADDED Requirements

### Requirement: Semantic query projection preserves lexical evidence
The memory plugin SHALL derive a deterministic bounded semantic query only for embedding search. It SHALL preserve the complete principal turn for FTS5, SHALL normalize malformed Unicode safely, and SHALL expose projection method and lengths without logging the query content.

#### Scenario: Short clean query is searched
- **WHEN** the principal query is within the configured safe bound
- **THEN** the normalized query is passed through unchanged to the semantic embedder

#### Scenario: Long query ends with a question
- **WHEN** a long principal turn contains a bounded final question
- **THEN** semantic retrieval embeds that question while lexical retrieval searches the full turn

#### Scenario: No meaningful bounded segment exists
- **WHEN** a long query has no eligible question, line, or sentence
- **THEN** semantic projection uses a bounded tail and reports the fallback method without emitting query content to diagnostics

### Requirement: Semantic reconciliation remains non-authoritative
Semantic nearest-neighbor lookup for candidates SHALL be advisory and limited to the same Persona Instance, principal, scope, and kind. Similarity thresholds SHALL produce review hints only; canonical evidence, subject, conflict, correction, and promotion commands remain the exclusive state-changing paths.

#### Scenario: High similarity is observed
- **WHEN** a new candidate is highly similar to an active record with a different subject key
- **THEN** no canonical mutation occurs until an explicit validated reconciliation command is issued

#### Scenario: Neighbor belongs to another partition
- **WHEN** a vector backend returns a semantically similar candidate from another principal, instance, or project
- **THEN** it is discarded and cannot appear in reconciliation suggestions
