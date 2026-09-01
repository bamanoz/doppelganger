## ADDED Requirements

### Requirement: Live focused specifications are verified
Standard repository verification SHALL strictly validate the realized current scenarios under `openspec/specs/` and SHALL validate the structure, identity scope, and evidence syntax of non-archived delta specs. Current scenarios SHALL have resolved executable evidence. An active delta MAY declare a `planned:` evidence reference for a test introduced by that change, but strict pre-archive verification SHALL reject planned or unresolved evidence. Duplicate scenario identities SHALL be rejected within the realized current corpus and within each active change; a delta MAY reuse a current identity only when it modifies or removes that scenario. Diagnostics SHALL identify the artifact, scenario identity, and violated rule. Archived changes SHALL be excluded.

#### Scenario: Current scenario has no executable evidence
- **ID**: `integrity.focused.reject-missing-evidence`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::rejects a current scenario without evidence`
- **WHEN** a current OpenSpec scenario lacks an executable-evidence reference
- **THEN** standard repository verification fails with the artifact and scenario identity

#### Scenario: Current evidence reference is stale
- **ID**: `integrity.focused.reject-stale-reference`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::rejects a stale evidence reference`
- **WHEN** a current scenario references a missing test file or a test case that cannot be identified in that file
- **THEN** standard repository verification fails with the unresolved evidence reference

#### Scenario: Active delta plans new evidence
- **ID**: `integrity.focused.accept-planned-change-evidence`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::accepts planned evidence in an active delta`
- **WHEN** an active delta declares a syntactically valid `planned:` evidence reference for a test introduced by the change
- **THEN** standard repository verification accepts the reference without treating it as current executable evidence

#### Scenario: Active change is ready to archive
- **ID**: `integrity.focused.reject-planned-pre-archive-evidence`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::rejects planned evidence before archive`
- **WHEN** strict pre-archive verification inspects an active change that still contains planned or unresolved evidence
- **THEN** verification fails with the change artifact and scenario identity

#### Scenario: Stable behavior identity has multiple current owners
- **ID**: `integrity.focused.reject-duplicate-owner`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::rejects duplicate stable behavior ownership`
- **WHEN** two realized current scenarios declare the same stable behavior identity
- **THEN** standard repository verification fails and identifies both owning artifacts

#### Scenario: Archived scenario uses historical evidence
- **ID**: `integrity.focused.ignore-archive`
- **EVIDENCE**: `scripts/tests/focused-specs.spec.ts::ignores archived ownership`
- **WHEN** an archived change contains scenario identities or evidence references that no longer resolve
- **THEN** focused-spec verification ignores the archived artifact

## MODIFIED Requirements

### Requirement: Repository verification composes integrity checks
The root verification workflow SHALL run workspace typechecks and tests, single-Cordis enforcement, package-boundary validation, documentation and legacy integrity checks, and live focused-spec validation. Network-dependent production advisory queries MAY remain an explicit separate security command but SHALL be included in release or dependency-update evidence.

#### Scenario: Permanent cross-package change is handed off
- **ID**: `integrity.root-check.includes-focused-specs`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::checks live focused specification integrity`
- **WHEN** the root repository check completes successfully
- **THEN** package, Cordis, test, documentation, live-spec ownership, and executable-evidence integrity have all been verified locally
