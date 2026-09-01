## Purpose

Define how repository tooling selects, executes, and reports the exact Vitest evidence linked from focused OpenSpec scenarios.

## ADDED Requirements

### Requirement: The repository executes current focused evidence
The repository SHALL provide one command that validates current focused specifications, resolves their exact Vitest evidence cases, executes each unique case once under its owning test root, and reports the outcome for every Scenario ID.

#### Scenario: Current evidence is selected exactly
- **ID**: `focused.execution.current-selection`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::plans current evidence by exact source line and deduplicates shared tests`
- **WHEN** an engineer runs the focused-spec command without a change selector
- **THEN** only evidence referenced by current specifications is selected, shared evidence is executed once, and every current Scenario ID retains its evidence mapping

#### Scenario: Package-local test roots are preserved
- **ID**: `focused.execution.test-roots`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::groups package and script evidence under their owning Vitest roots`
- **WHEN** selected evidence spans repository script tests and multiple workspace packages
- **THEN** each exact `file:line` filter runs under the Vitest root that owns that evidence file

### Requirement: The repository executes one change scope for archive readiness
The repository SHALL accept `--change <name>`, apply strict current-plus-change focused-spec validation, and execute only the evidence declared by that selected change.

#### Scenario: A selected change runs only implemented evidence
- **ID**: `focused.execution.change-selection`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::selects only implemented evidence from the requested change`
- **WHEN** an engineer selects an active change whose focused scenarios all reference implemented tests
- **THEN** the runner validates ownership against current specifications and executes only that change's unique evidence cases

#### Scenario: Planned evidence blocks change execution
- **ID**: `focused.execution.change-planned-evidence`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::rejects planned change evidence before execution`
- **WHEN** a selected active change contains a focused scenario with `EVIDENCE: planned`
- **THEN** the runner reports the archive-readiness violation and starts no Vitest process

### Requirement: Focused execution reports scenario outcomes
The repository SHALL translate exact Vitest assertion results back to their referenced Scenario IDs and SHALL fail the command when validation, execution, or result mapping fails.

#### Scenario: Shared passing evidence is reported for every scenario
- **ID**: `focused.execution.shared-pass-report`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::executes shared evidence once and reports every referencing scenario as PASS`
- **WHEN** two scenarios reference the same passing Vitest case
- **THEN** the case executes once and both Scenario IDs are reported as `PASS`

#### Scenario: Skipped evidence remains visible
- **ID**: `focused.execution.skip-report`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::reports optional skipped evidence without presenting it as PASS`
- **WHEN** a selected evidence case is intentionally skipped by its test environment
- **THEN** the referencing scenario is reported as `SKIP` without causing a failing exit status

#### Scenario: Failed evidence fails the command
- **ID**: `focused.execution.failure-report`
- **EVIDENCE**: `scripts/tests/run-focused-specs.spec.ts::reports failed evidence and returns an unsuccessful result`
- **WHEN** a selected evidence case fails or has no matching assertion result
- **THEN** every affected Scenario ID is reported as `FAIL` with the evidence diagnostic and the command exits non-zero
