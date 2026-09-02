## ADDED Requirements

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
