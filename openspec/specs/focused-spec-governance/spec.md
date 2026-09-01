# Focused Spec Governance Specification

## Purpose

Defines authoritative ownership, focused scenario shape, stable identity, executable evidence, and behavior-preserving migration rules for live OpenSpec specifications.

## Requirements

### Requirement: Each behavior has one live specification owner
Every independently failing product or infrastructure behavior SHALL have one authoritative live OpenSpec capability and scenario. A behavior SHALL NOT remain specified in parallel under legacy, transitional, host, or aggregate capabilities after ownership moves. Archived changes SHALL remain historical evidence and SHALL NOT count as live owners.

#### Scenario: Maintainer moves a runtime behavior to its current owner
- **ID**: `spec.ownership.move-current-owner`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::moves behavior to its current owner`
- **WHEN** activation, reload, disposal, selection, Persona, memory, or host behavior is already governed by a current capability
- **THEN** any superseded live requirement is removed or reconciled so one capability owns the behavior

#### Scenario: Archived change retains an earlier formulation
- **ID**: `spec.ownership.ignore-archive`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::ignores archived ownership`
- **WHEN** an archived OpenSpec change describes a historical version of a live behavior
- **THEN** focused-spec ownership validation ignores the archived artifact

### Requirement: Live scenarios are focused interpretations
Every live scenario SHALL protect one independently failing behavior at the product or infrastructure boundary. Its name SHALL identify the acting context and action, it SHALL contain exactly one request condition and one `THEN`, and the `THEN` SHALL state one user-visible or durable outcome. Transactionally inseparable infrastructure observations MAY remain together when splitting them would remove the meaning of the behavior.

#### Scenario: Scenario combines independently failing outcomes
- **ID**: `spec.focus.split-independent-outcomes`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::rejects independently failing outcomes in one scenario`
- **WHEN** a live scenario requires observations that can regress independently
- **THEN** the behavior is represented by separate focused scenarios with distinct evidence

#### Scenario: Infrastructure outcome is transactionally indivisible
- **ID**: `spec.focus.keep-transactional-boundary`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::allows one transactional infrastructure outcome`
- **WHEN** several observations together prove one cleanup, commit, rollback, or isolation boundary and no observation is meaningful alone
- **THEN** one infrastructure scenario may retain those observations under one explanatory outcome

### Requirement: Every live scenario links to executable evidence
Every live scenario SHALL declare a repository-unique stable scenario identity and at least one executable evidence reference. An evidence reference SHALL resolve to a repository test file and a uniquely identifiable test case that executes the scenario request and observes the promised outcome. Renaming or moving evidence SHALL update the reference in the same change.

#### Scenario: Scenario has executable coverage
- **ID**: `spec.evidence.resolve-executable-test`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::resolves executable evidence by file and test title`
- **WHEN** repository verification inspects a live scenario
- **THEN** its stable identity resolves to an existing executable test case that proves the scenario outcome

#### Scenario: Scenario evidence no longer resolves
- **ID**: `spec.evidence.reject-stale-reference`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::rejects a stale evidence reference`
- **WHEN** a referenced test file or test case is removed or renamed without updating the live scenario
- **THEN** repository verification fails with the scenario identity and unresolved evidence reference

### Requirement: Evidence matches only the promised contract
Executable evidence SHALL assert only fields, events, ordering, identities, effects, or exact values required by the scenario outcome. Evidence SHALL ignore unrelated fields and events, and SHALL require exact or empty results only when totality is part of the promised behavior.

#### Scenario: Response gains an unrelated field
- **ID**: `spec.evidence.ignore-additive-fields`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::keeps additive response fields outside promised evidence`
- **WHEN** an implementation adds a field outside the outcome promised by a focused scenario
- **THEN** the scenario evidence remains passing without weakening the promised assertions

#### Scenario: Total absence is the contract
- **ID**: `spec.evidence.assert-total-absence`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::requires exact absence when absence is promised`
- **WHEN** a focused scenario promises that no event, record, file mutation, or projected capability exists
- **THEN** its executable evidence asserts the complete empty result

### Requirement: Live spec migrations preserve implemented behavior
Consolidating, renaming, splitting, or removing live scenarios SHALL preserve every currently implemented public behavior unless the same OpenSpec change explicitly declares a product contract modification. Superseded wording SHALL be removed rather than retained as a compatibility specification.

#### Scenario: Duplicate scenarios are consolidated
- **ID**: `spec.migration.consolidate-duplicates`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::retains the full contract while removing duplicate owners`
- **WHEN** two live scenarios describe the same implemented behavior at different levels of detail
- **THEN** the authoritative owner retains focused coverage for the complete current contract and the duplicate live scenario is removed
