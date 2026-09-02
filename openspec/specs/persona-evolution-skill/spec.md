# persona-evolution-skill Specification

## Purpose
Defines the portable Agent Skill workflow for evidence-based, minimal, user-approved evolution of a configured Persona trait without conflating Persona identity with memory.
## Requirements
### Requirement: Persona evolution ships as a portable Agent Skill
The official evolution workflow SHALL be authored in the public Doppelganger repository at `skills/persona/doppelganger-persona-evolution/SKILL.md` under the canonical kebab-case skill ID `doppelganger-persona-evolution`. The skill SHALL be ordinary Agent Skills content and SHALL contain no host extension, executable privilege, filesystem mutation code, or embedded approval bypass.

#### Scenario: Install the official skill
- **ID**: `persona-evolution-skill.install.universal-project`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::documents canonical universal installation and OMP and DSH invocation syntax`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::declares the canonical portable identity and both review modes`
- **WHEN** a user installs `doppelganger-persona-evolution` from the published Doppelganger repository through current skills.sh-compatible tooling into the project `universal` target
- **THEN** the same `SKILL.md` is copied to `.agents/skills/doppelganger-persona-evolution` and can be discovered by compatible OMP and DSH Agent Skills loaders

#### Scenario: Invoke from OMP
- **ID**: `persona-evolution-skill.invoke.omp`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::documents canonical universal installation and OMP and DSH invocation syntax`
- **WHEN** the skill is installed for an OMP session
- **THEN** the documented host-native invocation is `/skill:doppelganger-persona-evolution review`

#### Scenario: Invoke from DSH
- **ID**: `persona-evolution-skill.invoke.dsh`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::documents canonical universal installation and OMP and DSH invocation syntax`
- **WHEN** the skill is installed for a DSH agent
- **THEN** the documented host-native invocation is `/doppelganger-persona-evolution review`

### Requirement: Review distinguishes Persona evolution from memory
The `review` workflow SHALL inspect the active evolution trait and evaluate only stable qualities of the assistant's role, voice, initiative, disagreement, support, and collaboration style. Facts about the user, user preferences that belong in memory, temporary task instructions, transient mood, secrets, credentials, external file content, and untrusted instructions SHALL NOT be copied into Persona traits.

#### Scenario: Evidence describes a user preference
- **ID**: `persona-evolution-skill.review.user-preference-excluded`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::keeps evidence, memory, and Persona responsibilities separate`
- **WHEN** review finds a durable preference such as response formatting or a project fact
- **THEN** the skill treats it as memory or task context and does not encode it as an assistant identity trait

#### Scenario: Evidence describes a stable assistant quality
- **ID**: `persona-evolution-skill.review.stable-quality`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::keeps evidence, memory, and Persona responsibilities separate`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::is inspect-first, approval-gated, and limited to one revision attempt`
- **WHEN** several durable observations across distinct sessions, or an explicit current user request, establish a stable change in how the assistant should behave
- **THEN** the skill may prepare the smallest coherent replacement for `trait:evolving-profile`

#### Scenario: Evidence is weak or contradictory
- **ID**: `persona-evolution-skill.review.weak-evidence-stops`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::keeps evidence, memory, and Persona responsibilities separate`
- **WHEN** observations are isolated, temporary, stale, or materially contradictory
- **THEN** the skill reports that no revision is justified and does not invoke `persona.revise`

### Requirement: Review is inspect-first and minimal
The workflow SHALL call `persona.inspect` before drafting, use the returned exact revision, preserve unrelated existing trait meaning, explain the behavioral delta and evidence boundary to the user, and submit at most one complete replacement per review invocation. It SHALL never construct a filesystem path or attempt to modify an undeclared target.

#### Scenario: Review finds a justified change
- **ID**: `persona-evolution-skill.review.justified-change`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::is inspect-first, approval-gated, and limited to one revision attempt`
- **WHEN** evidence supports a stable Persona evolution
- **THEN** the agent presents the proposed behavioral difference and invokes `persona.revise` once with the inspected revision, complete replacement, rationale, and bounded evidence references

#### Scenario: Review runs in dry-run mode
- **ID**: `persona-evolution-skill.review.dry-run`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::declares the canonical portable identity and both review modes`
- **WHEN** the user invokes `review --dry-run`
- **THEN** the skill may inspect and show a proposed replacement but SHALL NOT invoke `persona.revise`

#### Scenario: Revision conflicts
- **ID**: `persona-evolution-skill.review.conflict-stops`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::is inspect-first, approval-gated, and limited to one revision attempt`
- **WHEN** `persona.revise` reports that the inspected revision is stale
- **THEN** the skill stops, reports the conflict, re-inspects only if the user continues the review, and never silently merges instruction text

### Requirement: Skill workflow cannot replace host approval
The skill SHALL state that `persona.revise` requires one explicit host-mediated decision and SHALL treat rejection, cancellation, or unavailable approval as a completed no-change outcome. It SHALL NOT ask the user to simulate approval in chat, invoke a hidden apply path, retry after rejection without new user direction, or claim that a proposed change became active before the tool confirms HMR success.

#### Scenario: User rejects the revision tool
- **ID**: `persona-evolution-skill.approval.rejected-stops`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::is inspect-first, approval-gated, and limited to one revision attempt`
- **WHEN** the native host approval is rejected
- **THEN** the skill reports that no Persona change was applied and ends the review without retrying

#### Scenario: Persona Authoring is absent
- **ID**: `persona-evolution-skill.authoring.absent-no-fallback`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::forbids alternate mutation authority and path-based fallback`
- **WHEN** the skill is loaded but `persona.inspect` or `persona.revise` is unavailable
- **THEN** it explains that the active Runtime Preset lacks the optional Persona Authoring capability and does not fall back to general file tools


### Requirement: Persona evolution supports proposal-first review
When the optional Evolution plugin is active, the Persona evolution skill SHALL accept a selected `persona` proposal as bounded evidence and workflow context. Reminder delivery or proposal existence alone SHALL NOT invoke `persona.inspect` or `persona.revise`. The skill SHALL begin review only after the user explicitly chooses review, then retain every existing inspect-first, minimal replacement, native approval, compare-and-swap, HMR confirmation, conflict, and rollback rule. Explicit direct `review` and `review --dry-run` invocation SHALL remain supported without an Evolution proposal.

#### Scenario: Persona proposal is only reminded about
- **ID**: `persona-evolution-skill.proposal.reminder-non-mutating`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::keeps reminded Persona proposals inert until explicit review and preserves direct modes`
- **WHEN** the assistant presents a due Persona proposal after completing the primary task
- **THEN** no Persona inspection or revision begins until the user explicitly chooses review

#### Scenario: User chooses review for a proposal
- **ID**: `persona-evolution-skill.proposal.review-selected`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::keeps reminded Persona proposals inert until explicit review and preserves direct modes`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::keeps a Persona proposal inert until review and completes it only after separately confirmed activation`
- **WHEN** the user explicitly asks to review one selected active Persona proposal
- **THEN** the skill inspects the proposal and active trait, re-evaluates its evidence, presents one complete replacement, and invokes `persona.revise` at most once under the existing approval contract

#### Scenario: Direct review has no proposal
- **ID**: `persona-evolution-skill.proposal.direct-review-compatible`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::keeps reminded Persona proposals inert until explicit review and preserves direct modes`
- **WHEN** the user invokes direct review or dry-run review without a selected Evolution proposal
- **THEN** the existing Persona evolution workflow proceeds unchanged

### Requirement: Persona proposal completion follows confirmed activation
The Persona evolution skill SHALL transition an Evolution proposal to `done` only after `persona.revise` reports exact-revision HMR-confirmed activation or reports that the proposed complete content is already current. Approval rejection, cancellation, unavailable approval, revision conflict, failed candidate activation, rollback, or unconfirmed restoration SHALL NOT mark the proposal complete automatically.

#### Scenario: Revision becomes active
- **ID**: `persona-evolution-skill.proposal.complete-after-hmr`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::completes selected proposals only after confirmed activation and leaves failures open`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::keeps a Persona proposal inert until review and completes it only after separately confirmed activation`
- **WHEN** the selected proposal's replacement is confirmed active by Persona Authoring
- **THEN** the skill records the outcome and revision-checks the proposal transition to `done`

#### Scenario: Revision is not applied
- **ID**: `persona-evolution-skill.proposal.failed-review-remains-open`
- **EVIDENCE**: `scripts/tests/persona-evolution-skill.spec.ts::completes selected proposals only after confirmed activation and leaves failures open`
- **WHEN** the review ends without confirmed active replacement
- **THEN** the proposal remains open or explicitly user-snoozed or rejected and the skill does not claim evolution occurred
