## MODIFIED Requirements

### Requirement: Evolution proposals are durable non-executing records
The Evolution ledger SHALL support `persona` and `capability` proposal kinds. Persona proposals SHALL use `global` scope because they describe one Persona Instance's durable behavior; capability proposals SHALL use either `global` or `project` scope. A proposal SHALL contain a stable identifier, deterministic deduplication key, bounded title and rationale, bounded evidence summaries with provenance identifiers, status, revision, timestamps, and immutable transition history. Creating, updating, reminding about, rejecting, or snoozing a proposal SHALL NOT revise Persona, fetch external research, define or run generated code, edit Runtime Presets, invoke host plugins, or install packages.
A successful command with a new operation identifier that returns an unchanged proposal SHALL commit its exact operation receipt without inserting a duplicate immutable revision or repeating evidence, history, or reminder delivery. SQLite and project YAML adapters SHALL implement the same unchanged-result semantics; actual command or revision conflicts SHALL still fail.

#### Scenario: Persona opportunity is proposed
- **ID**: `evolution.proposal.persona-non-mutating`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::keeps a Persona proposal inert until review and completes it only after separately confirmed activation`
- **WHEN** the agent records a supported stable behavioral opportunity
- **THEN** the ledger stores or deduplicates a `persona` proposal and no Persona asset changes

#### Scenario: Capability opportunity is proposed
- **ID**: `evolution.proposal.capability-non-executing`
- **EVIDENCE**: `packages/extension-evolution/tests/proposals.spec.ts::creates deeply frozen bounded proposals and rejects invalid kind/scope and credentials`
- **WHEN** the agent records a recurring or material capability gap
- **THEN** the ledger stores or deduplicates a `capability` proposal and performs no research, code generation, composition mutation, or installation

#### Scenario: Operation is retried
- **ID**: `evolution.proposal.operation-idempotency`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::persists, replays exact operations, rejects changed retries and stale writes`
- **WHEN** a proposal mutation repeats an existing operation identifier
- **THEN** an identical command replays its prior result and a changed command digest is rejected

#### Scenario: New command deduplicates an unchanged proposal
- **ID**: `evolution.proposal.unchanged-new-operation-receipt`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::records unchanged proposal commands consistently in SQLite and YAML`
- **WHEN** a new operation ID proposes an existing active dedupe key without new evidence in either authoritative store
- **THEN** the store commits a replayable receipt for the unchanged result without duplicating its revision, evidence, or history

#### Scenario: New command repeats a confirmed reminder delivery
- **ID**: `evolution.reminder.unchanged-new-operation-receipt`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::records duplicate reminder commands without duplicate revisions in either store`
- **WHEN** a fresh operation ID with the current expected revision records an already recorded session and turn delivery
- **THEN** the store records the unchanged outcome for exact replay without advancing revision, history, delivery count, or cooldown

### Requirement: Evolution exposes bounded portable proposal controls
When composed, Evolution SHALL register exactly these portable controls: `evolution.propose`, `evolution.list`, `evolution.inspect`, `evolution.transition`, `evolution.snooze`, `evolution.reject`, and `evolution.reminder.record`. Inputs and outputs SHALL be JSON-compatible, boundary-validated, and expressible within each compatible host's supported portable-schema translation subset. `evolution.transition` SHALL preserve target-specific required and irrelevant-field validation at invocation even when the transport schema represents its target details in one host-portable object. Mutations SHALL require stable operation identifiers; revision-sensitive mutations SHALL require exact expected revisions; invalid transitions SHALL fail without modifying either store.
Listing and inspection SHALL return persisted proposal state without resuming snoozes, modifying receipts or history, creating directories, or acquiring project write locks. Read filters on status SHALL use the persisted status, and per-file project diagnostics SHALL remain isolated from healthy records.

#### Scenario: Host projects Evolution controls
- **ID**: `evolution.tools.portable-projection`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::projects opt-in Evolution policy and all seven controls through real OMP`
- **WHEN** a compatible host activates a Runtime Preset containing Evolution
- **THEN** the host discovers all seven controls through the existing portable Tool Protocol without Evolution-specific adapter code

#### Scenario: Concurrent decision uses a stale revision
- **ID**: `evolution.tools.stale-revision`
- **EVIDENCE**: `packages/extension-evolution/tests/proposals.spec.ts::enforces capability and Persona state matrices, exact revisions, and terminal outcomes`
- **WHEN** a transition, rejection, or snooze uses a revision older than the active proposal revision
- **THEN** the mutation fails and preserves the current proposal and transition history

#### Scenario: Inspecting one proposal leaves expired neighbors untouched
- **ID**: `evolution.tools.read-only-inspection-and-listing`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::lists and inspects without rewriting expired or unrelated proposals`
- **WHEN** the caller lists or inspects proposals while expired snoozes and unrelated malformed project files exist
- **THEN** the query returns stored revisions and isolated diagnostics without changing any proposal bytes, durable ledger rows, or project write-lock state

### Requirement: Proposal lifecycle preserves user control
The ledger SHALL enforce common `proposed` and `done` states plus explicit `snoozed` and terminal `rejected` outcomes. A `persona` proposal SHALL advance through `reviewing`; a `capability` proposal SHALL advance through `researching`, `options-ready`, `selected`, `planned`, and `implementing`. Resuming a snoozed proposal SHALL restore its prior forward state after its deadline or an explicit revision-checked transition. A rejected or completed proposal SHALL not be reopened implicitly; a materially new opportunity SHALL use a new proposal identity. State changes that represent review or research consent, option selection, planning approval, implementation, rejection, or snoozing SHALL be explicit tool mutations directed by the user-facing workflow.
Deadline expiry SHALL make a snoozed proposal time-eligible without a write on read. Queries SHALL retain its persisted snoozed status, revision, deadline, and resume status. An explicit applicable mutation that requires deadline resumption SHALL verify the expected persisted revision first and atomically resume only its target with the requested operation; failure SHALL leave both the resumption and requested mutation unapplied. The original command digest and receipt SHALL govern retries, and no mutation SHALL sweep unrelated expired proposals.

#### Scenario: Research has not been approved
- **ID**: `evolution.lifecycle.proposed-does-not-research`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::starts research only after explicit current consent and keeps reminders inert`
- **WHEN** a capability opportunity remains `proposed`
- **THEN** the plugin performs no research and exposes it only for inspection or eligible reminder selection

#### Scenario: Proposal is rejected
- **ID**: `evolution.lifecycle.rejected-terminal`
- **EVIDENCE**: `packages/extension-evolution/tests/proposals.spec.ts::restores the prior forward state after snooze and keeps rejection terminal`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::excludes rejected and currently snoozed proposals from reminders`
- **WHEN** an exact-revision rejection succeeds
- **THEN** the immutable history records the decision and the proposal is excluded from future reminders and forward transitions

#### Scenario: Confirmed delivery resumes only its expired target
- **ID**: `evolution.lifecycle.targeted-expiry-delivery-atomic`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::atomically resumes an expired reminder target using the inspected revision`
- **WHEN** the workflow confirms a newly presented reminder for an expired snoozed proposal using its inspected exact revision
- **THEN** one authoritative-store commit records the target resumption and delivery with a replayable original-command receipt while leaving unrelated proposals unchanged

#### Scenario: Target mutation fails after preparing resumption
- **ID**: `evolution.lifecycle.targeted-expiry-failure-atomic`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::rolls back targeted expiry when the requested mutation cannot commit`
- **WHEN** a targeted mutation cannot commit after preparing the expired snooze resumption
- **THEN** the authoritative store preserves the original proposal, revision, history and receipt state without partial resumption

### Requirement: Reminders are relevant, bounded, and cooled down
Evolution SHALL select at most one existing proposal as a reminder candidate for a turn. Selection SHALL exclude `done`, `rejected`, and currently `snoozed` proposals, enforce a default seven-day per-proposal cooldown from confirmed delivery, and require deterministic lexical relevance to the direct principal input. Merely selecting a candidate SHALL not advance cooldown; `evolution.reminder.record` SHALL record delivery only after the assistant actually presents it. Configuration MAY increase the cooldown or disable reminders but SHALL NOT permit more than one candidate per turn.
Selection, due-only listing, and context resolution SHALL be read-only even when snooze deadlines have elapsed. They SHALL use time-derived eligibility with the existing relevance and cooldown rules, SHALL return the exact stored proposal rather than a synthetic revision, and SHALL neither write a receipt nor create a project directory or write lock.

#### Scenario: Relevant proposal is due
- **ID**: `evolution.reminder.relevant-due`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::contributes bounded instruction context and one read-only relevant reminder candidate`
- **WHEN** multiple active proposals exist and one due proposal is most relevant to the direct principal input
- **THEN** context exposes only that proposal as a data-authority reminder candidate

#### Scenario: Proposal was recently mentioned
- **ID**: `evolution.reminder.cooldown`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::contributes bounded instruction context and one read-only relevant reminder candidate`
- **WHEN** a proposal has a confirmed reminder delivery inside its cooldown
- **THEN** it is not selected as a reminder candidate

#### Scenario: Candidate is not presented
- **ID**: `evolution.reminder.no-false-delivery`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::contributes bounded instruction context and one read-only relevant reminder candidate`
- **WHEN** context exposes a reminder candidate but the assistant does not include it after the primary response
- **THEN** the proposal's reminder history and cooldown remain unchanged

#### Scenario: Expired snooze is considered without rewriting its document
- **ID**: `evolution.reminder.expired-snooze-read-only`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::selects expired snoozes without mutating stored proposals or delivery state`
- **WHEN** context resolution considers a relevant expired snooze among future-snoozed and cooled-down proposals
- **THEN** it returns only the eligible stored proposal within the context budget while preserving all proposal bytes, revisions, receipts, history and delivery state
