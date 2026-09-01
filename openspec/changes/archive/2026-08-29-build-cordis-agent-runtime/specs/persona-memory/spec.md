## Purpose

Defines durable, scoped, reviewable persona memory that preserves provenance and corrections while remaining an optional plugin outside the runtime kernel.

## ADDED Requirements

### Requirement: Scoped memory records
Every memory record SHALL belong to a Persona Instance and SHALL declare either global scope or a stable project scope.

#### Scenario: Record created without explicit global scope
- **WHEN** memory is written during a configured project session without an approved global promotion
- **THEN** the record is stored in that project's scope

#### Scenario: Global promotion proposed
- **WHEN** an agent identifies project memory as potentially global
- **THEN** it creates a promotion proposal rather than changing the record scope automatically

### Requirement: Memory provenance and lifecycle
Memory records SHALL preserve content, kind, scope, status, source session, timestamps, and revision lineage sufficient to audit why active memory exists.

#### Scenario: Memory result is inspected
- **WHEN** a user or agent retrieves a memory record
- **THEN** the result identifies its scope, status, provenance, and active revision

### Requirement: Explicit memory writes
An explicit user request to remember information SHALL create an active memory record immediately.

#### Scenario: User says to remember a decision
- **WHEN** the agent invokes explicit memory storage for that decision
- **THEN** the decision is active and available to later retrieval without candidate approval

### Requirement: Candidate memory writes
Information inferred automatically from a session SHALL be stored as a candidate and SHALL NOT influence normal recall until promoted.

#### Scenario: Agent extracts a possible preference
- **WHEN** the agent submits an automatically inferred preference
- **THEN** it is stored as a reviewable candidate excluded from active recall

### Requirement: Candidate review
The memory plugin SHALL allow candidates to be listed, approved, and rejected through agent tools.

#### Scenario: Candidate approved manually
- **WHEN** a user approves a candidate
- **THEN** the candidate becomes an active memory record with its provenance retained

#### Scenario: Candidate rejected
- **WHEN** a user rejects a candidate
- **THEN** it cannot enter active recall or be promoted by later corroboration

### Requirement: Corroboration promotion
Automatic candidate promotion SHALL occur only when the active agent links a semantically corroborating observation from a distinct session and no unresolved contradiction is recorded.

#### Scenario: Second session corroborates candidate
- **WHEN** the agent links a corroborating observation from a second session to an eligible candidate
- **THEN** the candidate becomes active and retains references to both source sessions

#### Scenario: Same session repeats candidate
- **WHEN** a candidate is repeated within its original session
- **THEN** the repetition does not satisfy the two-session promotion rule

### Requirement: Versioned correction
Correcting active memory SHALL create a new active revision and supersede the prior revision without erasing history.

#### Scenario: User corrects a fact
- **WHEN** the user explicitly replaces an active fact
- **THEN** recall returns the corrected revision and audit history retains the superseded value

### Requirement: Hard deletion
The user SHALL be able to permanently delete a memory record and all of its revisions.

#### Scenario: User forgets a record
- **WHEN** the user confirms hard deletion of a memory record
- **THEN** the record, revisions, retrieval entries, and derived embeddings are removed

### Requirement: Secret rejection
The memory plugin SHALL reject records detected as credentials, authentication tokens, private keys, or equivalent secrets.

#### Scenario: Agent submits a token
- **WHEN** a proposed active record or candidate contains a detected secret
- **THEN** storage is rejected with a reason and no retrievable record is created

### Requirement: Memory retrieval
The memory plugin SHALL support scoped lexical retrieval and SHALL continue operating when no embedding provider is available.

#### Scenario: Project recall
- **WHEN** the current user turn matches active project records
- **THEN** retrieval returns relevant records from that project plus eligible global records without returning records from another project

#### Scenario: Embedding provider absent
- **WHEN** no embedding provider is active
- **THEN** search and automatic recall use lexical retrieval without failing memory activation

#### Scenario: Embedding provider available
- **WHEN** an embedding provider is active
- **THEN** the memory plugin may combine semantic and lexical results while preserving scope and status filters

### Requirement: Recall authority and budget
Automatic recall SHALL treat ordinary records as data, SHALL treat approved preference records as behavioral contributions, and SHALL respect the host-provided context budget.

#### Scenario: Pinned global preference exists
- **WHEN** persona context is assembled
- **THEN** the pinned preference is considered before ranked memory and lower-priority records are omitted when required by the budget

#### Scenario: Recalled fact conflicts with profile
- **WHEN** ordinary recalled memory conflicts with identity or trait instructions
- **THEN** the profile remains authoritative and the memory is presented as data

### Requirement: Memory maintenance tools
The memory plugin SHALL expose namespaced tools for search, remember, correct, forget, candidate review, approval and rejection, and pinning and unpinning.

#### Scenario: Tool registry lists memory tools
- **WHEN** the memory plugin is active
- **THEN** the tool registry exposes the complete namespaced maintenance surface

### Requirement: Transcript and extraction policy
Full transcript persistence SHALL be disabled by default, and candidate extraction SHALL be initiated by the active agent rather than a hidden shutdown model.

#### Scenario: Session ends normally
- **WHEN** the active agent completes a meaningful task
- **THEN** it may submit candidate records before its final response without persisting the full transcript

#### Scenario: Session terminates abruptly
- **WHEN** a session ends without an agent extraction call
- **THEN** no automatic shutdown extraction is performed
