## Purpose

Define an optional installable Doppelganger Evolution plugin that durably coordinates user-directed improvement proposals for assistant behavior and capabilities without gaining authority to revise Persona, research, execute code, edit composition, or install packages.

## ADDED Requirements

### Requirement: Evolution is an optional installable Doppelganger feature
`@doppelganger/doppelganger-evolution` SHALL be an independently resolvable Cordis Loader plugin package. A compatible Runtime Preset SHALL be able to compose it from its package name without source-path imports, a named Persona aggregate, host-specific code, or kernel changes. Presets that omit the row SHALL receive no Evolution service, tools, context, storage, or reminders.

#### Scenario: Installed package is composed
- **ID**: `evolution.install.loader-package`
- **EVIDENCE**: `scripts/tests/evolution-package.spec.ts::installs into an external consumer, resolves the bare Loader export, stays inert until composed, and activates`
- **WHEN** a Runtime Preset composes the installed `@doppelganger/doppelganger-evolution` Loader entry with its declared services and isolation
- **THEN** one session-scoped Evolution service registers its portable tools and context provider

#### Scenario: Evolution is omitted
- **ID**: `evolution.install.omission-neutral`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::activates an arbitrary isolated Runtime Preset and remains neutral when omitted`
- **WHEN** a Runtime Preset does not contain the Evolution row
- **THEN** activation, prompt context, dynamic tools, Persona behavior, and durable state remain unchanged

### Requirement: Evolution proposals are durable non-executing records
The Evolution ledger SHALL support `persona` and `capability` proposal kinds. Persona proposals SHALL use `global` scope because they describe one Persona Instance's durable behavior; capability proposals SHALL use either `global` or `project` scope. A proposal SHALL contain a stable identifier, deterministic deduplication key, bounded title and rationale, bounded evidence summaries with provenance identifiers, status, revision, timestamps, and immutable transition history. Creating, updating, reminding about, rejecting, or snoozing a proposal SHALL NOT revise Persona, fetch external research, define or run generated code, edit Runtime Presets, invoke host plugins, or install packages.

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

### Requirement: Proposal scope selects one authoritative store
Global proposals SHALL be actor-partitioned by Persona Instance and bound host actor in plugin-owned SQLite state supplied by `doppelgangerInstanceSqlite`. Project-scoped capability proposals SHALL be canonical version-1 YAML documents under `<workspaceRoot>/.doppelganger/evolution/opportunities/`, suitable for version control and validated on every read and write. Project writes SHALL be atomic and SHALL preserve unrelated valid proposal files. A Persona proposal requesting project scope SHALL be rejected. The same proposal SHALL NOT be authoritative in both stores.

#### Scenario: Globally reusable opportunity is stored
- **ID**: `evolution.storage.global-partition`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::isolates every read and mutation by Persona Instance and bound actor`
- **WHEN** a proposal is classified as useful across projects
- **THEN** it is stored only in the current Persona Instance and actor partition of the configured instance SQLite database

#### Scenario: Project-specific opportunity is stored
- **ID**: `evolution.storage.project-yaml`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::creates no directory before first write, renders canonical YAML, and survives restart`
- **WHEN** a proposal depends on the current repository, domain, language, architecture, or infrastructure
- **THEN** it is stored only as validated canonical YAML in that project's Evolution directory

#### Scenario: Persona proposal requests project scope
- **ID**: `evolution.storage.persona-project-rejected`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::serializes concurrent writers and rejects unsafe project scope without fallback`
- **WHEN** a mutation requests project scope for a Persona evolution proposal
- **THEN** it fails visibly without writing project or global state

#### Scenario: Project scope has no workspace
- **ID**: `evolution.storage.project-without-workspace`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::serializes concurrent writers and rejects unsafe project scope without fallback`
- **WHEN** a mutation requests project scope in a Runtime Session without an absolute workspace root
- **THEN** it fails visibly without falling back to global storage

#### Scenario: Project YAML is invalid
- **ID**: `evolution.storage.invalid-project-document`
- **EVIDENCE**: `packages/extension-evolution/tests/storage.spec.ts::preserves healthy proposals and unrelated files while reporting malformed and symlink files`
- **WHEN** one project proposal file violates the declared schema or canonical identity rules
- **THEN** inspection reports that file's diagnostic while preserving access to unrelated valid proposals

### Requirement: Evolution exposes bounded portable proposal controls
When composed, Evolution SHALL register exactly these portable controls: `evolution.propose`, `evolution.list`, `evolution.inspect`, `evolution.transition`, `evolution.snooze`, `evolution.reject`, and `evolution.reminder.record`. Inputs and outputs SHALL be JSON-compatible and boundary-validated. Mutations SHALL require stable operation identifiers; revision-sensitive mutations SHALL require exact expected revisions; invalid transitions SHALL fail without modifying either store.

#### Scenario: Host projects Evolution controls
- **ID**: `evolution.tools.portable-projection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::projects Evolution generically, persists global and project lifecycles, removes stale tools, and disposes cleanly`
- **WHEN** a compatible host activates a Runtime Preset containing Evolution
- **THEN** the host discovers all seven controls through the existing portable Tool Protocol without Evolution-specific adapter code

#### Scenario: Concurrent decision uses a stale revision
- **ID**: `evolution.tools.stale-revision`
- **EVIDENCE**: `packages/extension-evolution/tests/proposals.spec.ts::enforces capability and Persona state matrices, exact revisions, and terminal outcomes`
- **WHEN** a transition, rejection, or snooze uses a revision older than the active proposal revision
- **THEN** the mutation fails and preserves the current proposal and transition history

### Requirement: Proposal lifecycle preserves user control
The ledger SHALL enforce common `proposed` and `done` states plus explicit `snoozed` and terminal `rejected` outcomes. A `persona` proposal SHALL advance through `reviewing`; a `capability` proposal SHALL advance through `researching`, `options-ready`, `selected`, `planned`, and `implementing`. Resuming a snoozed proposal SHALL restore its prior forward state after its deadline or an explicit revision-checked transition. A rejected or completed proposal SHALL not be reopened implicitly; a materially new opportunity SHALL use a new proposal identity. State changes that represent review or research consent, option selection, planning approval, implementation, rejection, or snoozing SHALL be explicit tool mutations directed by the user-facing workflow.

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

### Requirement: Evolution contributes stable self-evaluation instructions
Evolution SHALL register an instruction-authority context contribution that tells the assistant to evaluate tasks and dialogue for stable Persona improvements and material reusable capability gaps, prefer existing capabilities over new mechanisms, complete and verify the current task before raising an opportunity, and present at most one opportunity after the primary result. The instruction SHALL distinguish Persona qualities from user facts and preferences, require proposal-first review, and prioritize portable Doppelganger implementations over host-specific plugins when Doppelganger exposes the required seam.

#### Scenario: Evolution context is assembled
- **ID**: `evolution.context.stable-policy`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::contributes bounded instruction context and one read-only relevant reminder candidate`
- **WHEN** context is resolved for a Runtime Session containing Evolution
- **THEN** the assembled instructions include the stable Persona-and-capability evolution policy within the requested token budget

#### Scenario: Current task is still in progress
- **ID**: `evolution.context.defer-opportunity`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::finishes primary work first and rejects weak one-off opportunities`
- **WHEN** the assistant detects a possible opportunity while actionable work remains
- **THEN** the instructed workflow completes and verifies the current task before mentioning or researching that opportunity

### Requirement: Reminders are relevant, bounded, and cooled down
Evolution SHALL select at most one existing proposal as a reminder candidate for a turn. Selection SHALL exclude `done`, `rejected`, and currently `snoozed` proposals, enforce a default seven-day per-proposal cooldown from confirmed delivery, and require deterministic lexical relevance to the direct principal input. Merely selecting a candidate SHALL not advance cooldown; `evolution.reminder.record` SHALL record delivery only after the assistant actually presents it. Configuration MAY increase the cooldown or disable reminders but SHALL NOT permit more than one candidate per turn.

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
