# assistant-evolution Specification

## Purpose

Define an optional installable Doppelganger Evolution plugin that durably coordinates user-directed improvement proposals for assistant behavior and capabilities without gaining authority to revise Persona, research, execute code, edit composition, or install packages.

## Requirements

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


### Requirement: Evolution captures only committed lifecycle evidence
When proactive signal capture is enabled, Evolution SHALL observe completed `turn-committed` events and their correlated `tool-completed` events through the existing host-neutral lifecycle protocol. It SHALL ignore partial turns, failed or cancelled turns, session disposal, and uncommitted tool activity. Re-delivery of the same lifecycle event SHALL be idempotent by stable delivery identity, and stored signal provenance SHALL retain stable session, turn, call, and delivery identifiers without persisting an unbounded raw transcript.

#### Scenario: Completed turn contains correlated tool outcomes
- **ID**: `evolution.signals.committed-correlated-capture`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::captures one committed turn with correlated tool outcomes and bounded provenance`
- **WHEN** completed tool outcomes are followed by a completed committed turn with the same session and turn identity
- **THEN** Evolution evaluates the bounded turn material and correlated tool outcomes once and records only validated signal summaries and provenance

#### Scenario: Turn delivery is retried
- **ID**: `evolution.signals.delivery-idempotency`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::deduplicates correlated deliveries and ignores uncommitted work`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::records distinct Evolution turns across fresh bindings for one resumed OMP session without duplicating replayed evidence`
- **WHEN** the host publishes the same committed turn delivery more than once
- **THEN** Evolution records no duplicate signal, aggregate evidence, promotion, or proposal mutation

#### Scenario: Work is not committed successfully
- **ID**: `evolution.signals.uncommitted-ignored`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::deduplicates correlated deliveries and ignores uncommitted work`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::records distinct Evolution turns across fresh bindings for one resumed OMP session without duplicating replayed evidence`
- **WHEN** a turn is partial, failed, cancelled, or only disposed without a completed commit
- **THEN** Evolution creates no signal or proposal from that work

### Requirement: Signal extraction is deterministic with optional structured inference
Evolution SHALL always provide a deterministic built-in extractor and MAY additionally call the session-scoped `doppelgangerInference` service when inference-assisted extraction is explicitly enabled. Both paths SHALL receive only size-bounded, credential-screened committed material and SHALL produce bounded Persona or capability hypotheses with a normalized pattern key, summary, proposed scope, severity, and likely reuse value. Evolution SHALL define the exact transport-neutral JSON Schema supplied to inference and SHALL boundary-validate the returned value again as untrusted data. Extracted text SHALL never become instruction-authority context or execution authority. The coordinator SHALL derive recurrence from distinct stored provenance and novelty from the current authoritative proposal and aggregate state rather than trusting inferred claims.

#### Scenario: Deterministic evidence repeats
- **ID**: `evolution.signals.deterministic-extractor`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::extracts deterministic correction and tool-failure patterns without structured inference`
- **WHEN** committed work contains a supported explicit correction, limitation, or repeated structured tool-failure pattern
- **THEN** the built-in extractor emits a canonical bounded signal without requiring an inference provider or host-specific API

#### Scenario: Inference returns malformed or sensitive output
- **ID**: `evolution.signals.inference-boundary`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::rejects malformed secret-bearing and authority-shaped inference output`
- **WHEN** structured inference returns an unknown field, invalid factor, unsupported scope, credential-shaped content, oversized value, or instruction-shaped payload
- **THEN** Evolution rejects that output diagnostically and preserves unrelated deterministic signals and host work

### Requirement: Extraction runs through a bounded fail-open worker
Evolution SHALL NOT await model-assisted extraction or proposal promotion in the host lifecycle publication path. It SHALL use one session-owned serialized worker with explicit queue and material bounds, deterministic overload behavior, cancellation, and Cordis-scoped disposal. Inference absence, timeout, cancellation, provider failure, invalid output, persistence failure, or promotion failure SHALL be contained as bounded diagnostics and SHALL NOT fail the committed host turn or stop later queued work. If inference is disabled or unavailable, the worker SHALL continue with deterministic extraction only.

#### Scenario: Inference is slow
- **ID**: `evolution.signals.async-nonblocking`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::returns from lifecycle delivery before slow structured inference settles`
- **WHEN** the inference provider remains pending after a committed event is accepted
- **THEN** lifecycle publication completes without awaiting inference and the serialized worker continues processing within its configured bounds

#### Scenario: Inference provider fails on completed work
- **ID**: `evolution.signals.inference-failure-durable-fallback`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::persists and promotes deterministic lifecycle evidence when structured inference fails`
- **WHEN** inference fails for completed turns containing recurring deterministic evidence
- **THEN** lifecycle publication remains successful, the evidence persists and can reach ordinary `proposed` state, and bounded inference diagnostics remain observable

#### Scenario: Queue reaches its configured limit
- **ID**: `evolution.signals.overload-policy`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::applies deterministic queue bounds and reports dropped extraction work`
- **WHEN** accepted committed material exceeds the configured pending-work limit
- **THEN** Evolution applies its documented deterministic drop policy, emits a bounded diagnostic, and never grows an unbounded queue

#### Scenario: Runtime Session is disposed
- **ID**: `evolution.signals.disposal-cancels-work`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::aborts in-flight inference and prevents post-disposal writes`
- **WHEN** the owning Evolution plugin scope is disposed or replaced
- **THEN** queued work is cleared, in-flight inference is aborted, no stale generation writes afterward, and disposal does not wait indefinitely

### Requirement: Signals aggregate deterministically before proposal promotion
Evolution SHALL persist validated signal summaries in its plugin-owned global SQLite namespace, partitioned by Persona Instance, bound actor, and optional current project identity. It SHALL aggregate by kind, scope, and normalized pattern key using distinct committed turns and sessions, preserve bounded evidence, and apply a versioned deterministic promotion policy based on recurrence, novelty, severity, and likely reuse value. A one-off weak observation SHALL NOT create a proposal, and configurable thresholds SHALL NOT permit bypassing kind-specific minimum independent evidence requirements.

#### Scenario: Weak observation occurs once
- **ID**: `evolution.signals.weak-observation-retained`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::retains weak evidence without promoting a proposal`
- **WHEN** one valid low-support signal has not met the configured and kind-specific evidence threshold
- **THEN** Evolution retains only the bounded aggregate and creates no Persona or capability proposal

#### Scenario: Recurring pattern crosses its threshold
- **ID**: `evolution.signals.threshold-promotion`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::captures deterministic committed evidence by default and deduplicates lifecycle retries`
- **WHEN** distinct committed evidence makes one novel and reusable aggregate satisfy its versioned promotion policy
- **THEN** Evolution promotes it exactly once into an ordinary proposal using a deterministic operation identity and deduplication key

#### Scenario: Equivalent active proposal already exists
- **ID**: `evolution.signals.existing-proposal-deduplicated`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::replays crash-safe promotion linkage and suppresses terminal dedupe collisions`
- **WHEN** a promotable aggregate matches an active proposal in the same authoritative scope
- **THEN** Evolution uses the existing exact proposal deduplication contract and does not create a second proposal

### Requirement: Automatically promoted proposals remain inert and correctly scoped
Automatic promotion SHALL use the existing Evolution proposal schema, authoritative store selection, immutable history, credential policy, and actor partition. Persona hypotheses SHALL promote only to global Persona proposals after evidence from the required distinct Runtime Sessions. Project-specific capability hypotheses SHALL promote only to canonical project YAML when an absolute current workspace is available; unavailable project scope SHALL remain pending with a diagnostic and SHALL NOT fall back to global storage. Automatic promotion SHALL NOT advance a proposal beyond `proposed` or invoke review, research, planning, implementation, Persona revision, code execution, package installation, Runtime Preset editing, or host plugins.

#### Scenario: Persona pattern meets promotion policy
- **ID**: `evolution.signals.persona-global-only`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::requires cross-session Persona evidence and promotes only to global proposed state`
- **WHEN** a stable Persona-quality aggregate has enough evidence from distinct Runtime Sessions
- **THEN** Evolution creates or deduplicates one global Persona proposal in `proposed` state and performs no Persona inspection or revision

#### Scenario: Project signal has no workspace
- **ID**: `evolution.signals.project-without-workspace`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::keeps project promotion pending when workspace metadata is unavailable`
- **WHEN** a promotable capability aggregate requires project scope but the Runtime Session has no absolute workspace root
- **THEN** Evolution records a diagnostic and leaves the aggregate pending without creating global state as a fallback

#### Scenario: Proposal is promoted automatically
- **ID**: `evolution.signals.proposal-remains-inert`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::promotes lifecycle evidence through generic OMP events while preserving every consent gate`
- **WHEN** lifecycle evidence causes automatic proposal promotion through a compatible host
- **THEN** the proposal is only available for ordinary inspection and reminder selection until the user explicitly starts its existing owning workflow

### Requirement: Proactive signal and inference policy is configurable and omission-neutral
Evolution SHALL expose strict serializable configuration for enabling proactive capture, explicitly enabling inference-assisted extraction, bounded event material, worker capacity, inference timeout, retention, and promotion thresholds. Proactive capture SHALL be enabled by default only when the optional Evolution plugin is composed; inference-assisted extraction SHALL remain disabled until explicitly enabled and SHALL require a composed `doppelgangerInference` provider in the same session isolation realm. Operators SHALL be able to disable proactive capture while retaining ordinary Evolution controls. Invalid configuration or inference enablement without the required provider SHALL fail Evolution activation visibly. Presets that omit Evolution SHALL receive no lifecycle subscriber, signal state, worker, diagnostics, proposals, inference call, or behavior change.

#### Scenario: Evolution is composed with signal capture disabled
- **ID**: `evolution.signals.explicitly-disabled`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::preserves proposal-only behavior when proactive capture is disabled`
- **WHEN** valid Evolution configuration disables proactive signal capture
- **THEN** existing proposal tools, reminders, and consent workflows remain available while no lifecycle evidence is captured, inferred, or promoted

#### Scenario: Inference-assisted extraction is not enabled
- **ID**: `evolution.signals.inference-opt-in`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::uses deterministic extraction only until inference is explicitly enabled`
- **WHEN** Evolution is composed without explicit inference-assisted extraction enablement, whether or not an inference provider exists
- **THEN** Evolution performs no model call and continues the bounded deterministic signal pipeline

#### Scenario: Inference is enabled without a provider
- **ID**: `evolution.signals.inference-provider-required`
- **EVIDENCE**: `packages/composition-runtime/tests/inference.spec.ts::resolves an Evolution inference dependency after a later provider row and rejects omission only when enabled`
- **WHEN** Evolution configuration enables inference-assisted extraction but the effective Runtime Session provides no `doppelgangerInference` service in the matching isolation realm
- **THEN** activation or reload fails visibly before lifecycle listeners register and the previous valid generation remains active

#### Scenario: Evolution is omitted
- **ID**: `evolution.signals.omission-neutral`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::activates an arbitrary isolated Runtime Preset and remains neutral when omitted`
- **WHEN** a Runtime Preset does not compose Evolution
- **THEN** activation, lifecycle delivery, storage, prompt context, tools, Persona, and memory remain unchanged

#### Scenario: Stored signal state exceeds retention limits
- **ID**: `evolution.signals.retention-bounded`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::coalesces bounded credential-safe diagnostics and prunes internal state only`
- **WHEN** signal, receipt, diagnostic, or aggregate state exceeds its configured age or count bound
- **THEN** Evolution prunes eligible internal signal state deterministically while preserving ordinary proposal records and immutable proposal history

