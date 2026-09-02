# capability-evolution-skill Specification

## Purpose

Define a portable Agent Skill that turns a user-approved capability opportunity into current solution research, Doppelganger-first mechanism selection, and a reviewable implementation plan without treating proposal storage or research consent as execution authority.

## Requirements

### Requirement: Capability evolution ships as one portable Agent Skill
The repository SHALL own one canonical Agent Skill named `doppelganger-capability-evolution` under `skills/evolution/doppelganger-capability-evolution/SKILL.md`. Compatible OMP and DSH hosts SHALL discover the same project-installed skill through their native invocation syntax. Installing or invoking the skill SHALL grant no authority beyond the separately available tools and user decisions.

#### Scenario: Skill is installed for compatible hosts
- **ID**: `capability-evolution-skill.install.universal-project`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::installs the same canonical Skills for OMP and DSH project discovery`
- **WHEN** the canonical skill is installed into a project's universal Agent Skills location
- **THEN** OMP and DSH discover the same workflow without host-specific forks

#### Scenario: Evolution plugin is absent
- **ID**: `capability-evolution-skill.evolution.absent-no-fallback`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::requires Evolution controls and forbids ad hoc backlog files`
- **WHEN** the skill is invoked but the Evolution proposal controls are unavailable
- **THEN** it reports that the active Runtime Preset omitted the optional plugin and does not create an alternate backlog with shell or generic file tools

### Requirement: Research requires explicit user consent
The skill SHALL begin external solution research only after the user explicitly chooses research for an identified capability opportunity. Proposal creation, reminder delivery, ordinary task consent, or prior interest SHALL NOT count as research consent. Before consent, the skill MAY inspect and summarize the selected proposal but SHALL NOT browse external implementations or advance it to `researching`.

#### Scenario: User accepts research offer
- **ID**: `capability-evolution-skill.consent.accepted`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::starts research only after explicit current consent and keeps reminders inert`
- **WHEN** the assistant offers to research a selected capability opportunity and the user explicitly agrees
- **THEN** the skill revision-checks the proposal, transitions it to `researching`, and starts the research workflow

#### Scenario: User has not answered the offer
- **ID**: `capability-evolution-skill.consent.absent`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::starts research only after explicit current consent and keeps reminders inert`
- **WHEN** a capability proposal is created or reminded about without an explicit research decision
- **THEN** the skill performs no external research and leaves the proposal `proposed`

### Requirement: Research compares current source-verified implementations
For an approved opportunity, the skill SHALL search for current maintained implementations before recommending custom development. It SHALL prefer primary sources and inspect architecture, feature fit, maintenance activity, license, dependency and runtime requirements, security boundary, host integration surface, and portability of the reusable core. Material factual claims and time-sensitive conclusions SHALL be source-linked in the research result.

#### Scenario: Multiple viable implementations exist
- **ID**: `capability-evolution-skill.research.compare-options`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::requires current primary-source comparison before recommendation`
- **WHEN** research finds several maintained solutions for the requested capability
- **THEN** the skill presents their relevant trade-offs, identifies reusable versus host-specific parts, and recommends one option with evidence

#### Scenario: No directly usable implementation exists
- **ID**: `capability-evolution-skill.research.no-direct-fit`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::requires current primary-source comparison before recommendation`
- **WHEN** available implementations are unavailable for the active host or cannot be ported through Doppelganger contracts
- **THEN** the skill offers supported alternatives or an explicit adaptation plan rather than inventing compatibility

### Requirement: Mechanism selection is Doppelganger-first but fit-driven
The skill SHALL route a selected solution in this order: reuse an existing capability; use a temporary Dynamic Runtime Plugin for reversible current-session behavior; implement a permanent installable Doppelganger package and Loader plugin for portable persistent behavior; use an existing host-agent plugin only when the required surface is host-specific or absent from Doppelganger; otherwise offer another supported solution or a deliberate host adaptation. It SHALL not force Dynamic Runtime Plugins onto persistence, dependency installation, Client UI, or permanent product requirements.

#### Scenario: Capability fits permanent portable extension
- **ID**: `capability-evolution-skill.routing.permanent-doppelganger`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::routes existing, temporary, permanent, and host-specific mechanisms in order`
- **WHEN** a capability must survive restart and its required services, lifecycle, storage, and tools are available through Doppelganger
- **THEN** the recommendation targets an installable Doppelganger package and Loader plugin before any host-specific implementation

#### Scenario: Capability is a reversible experiment
- **ID**: `capability-evolution-skill.routing.dynamic-runtime-plugin`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::routes existing, temporary, permanent, and host-specific mechanisms in order`
- **WHEN** the capability is reversible current-session host behavior supported by the inspected Dynamic Runtime Plugin catalog
- **THEN** the skill routes implementation through `doppelganger-runtime-plugin-development` and preserves its inspection and approval gates

#### Scenario: Capability needs host Client UI
- **ID**: `capability-evolution-skill.routing.host-specific`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::routes existing, temporary, permanent, and host-specific mechanisms in order`
- **WHEN** the selected solution requires browser DOM, native host Client UI, or another surface not exposed by Doppelganger
- **THEN** the skill recommends a supported host plugin or explicit host adaptation and records why a Doppelganger implementation is insufficient

### Requirement: Research and selection update the durable proposal
The skill SHALL keep the selected Evolution proposal aligned with its research and selection state using exact revisions and stable operation identifiers. It SHALL store bounded research summaries and source references rather than copied articles or raw dialogue, transition to `options-ready` only after presenting viable options, transition to `selected` only after the user chooses one, and stop there. It SHALL NOT choose or create a repository, package, planning system, OpenSpec change, or implementation artifact; write implementation instructions; transition the proposal to `planned`, `implementing`, or `done`; or execute the selected mechanism. Later planning and implementation belong to separately invoked owning workflows.

#### Scenario: Research produces reviewable options
- **ID**: `capability-evolution-skill.state.options-ready`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::records exact research and selection transitions then stops`
- **WHEN** current research has produced a sourced comparison and recommendation
- **THEN** the proposal records the bounded result and becomes `options-ready`

#### Scenario: User selects an option
- **ID**: `capability-evolution-skill.state.selected`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::records exact research and selection transitions then stops`
- **WHEN** the user explicitly chooses one researched option
- **THEN** the proposal records that decision, becomes `selected`, and the skill stops without planning or implementation

#### Scenario: Selected mechanism needs later implementation
- **ID**: `capability-evolution-skill.state.selected-handoff`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::hands the selected mechanism off without planning implementation`
- **WHEN** a selected mechanism requires a repository, package, planning artifact, or executable change
- **THEN** the skill leaves those decisions and actions to a separately invoked owning workflow


### Requirement: Capability evolution never interrupts the primary task
The skill and Evolution policy SHALL require the current task to be completed and verified before a newly detected or existing capability opportunity is presented. A response SHALL include at most one Evolution suggestion, after the primary result, and SHALL omit the suggestion when no substantial relevant opportunity is due.

#### Scenario: Gap is detected during active work
- **ID**: `capability-evolution-skill.presentation.after-primary-result`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::finishes primary work first and rejects weak one-off opportunities`
- **WHEN** the assistant detects a reusable capability gap while solving another task
- **THEN** it finishes and verifies that task before presenting one concise research offer at the end

#### Scenario: Observation is weak or one-off
- **ID**: `capability-evolution-skill.presentation.no-noise`
- **EVIDENCE**: `scripts/tests/capability-evolution-skill.spec.ts::finishes primary work first and rejects weak one-off opportunities`
- **WHEN** an inconvenience is temporary, already solved by an existing tool, or unlikely to recur
- **THEN** the assistant creates no capability proposal and adds no Evolution suggestion
