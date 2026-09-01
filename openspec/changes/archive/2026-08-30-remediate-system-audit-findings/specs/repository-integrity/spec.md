## ADDED Requirements

### Requirement: Package boundaries have one executable source
The repository SHALL define allowed workspace-package dependency edges in one machine-readable manifest consumed by the package-boundary checker. Architecture documentation SHALL describe the intent of those edges without maintaining a second independently executable edge list.

#### Scenario: A forbidden package dependency is introduced
- **WHEN** a workspace package declares a dependency edge absent from the boundary manifest
- **THEN** repository verification fails and identifies the source package, target package, and violated boundary

#### Scenario: A workspace package is added
- **WHEN** a new workspace package is present without an explicit boundary-manifest entry
- **THEN** repository verification fails instead of inferring unrestricted dependencies

### Requirement: Documentation integrity is executable
Repository verification SHALL validate that every authoritative Markdown document under `docs/` is indexed by `docs/README.md`, every local Markdown link from `README.md`, `AGENTS.md`, and `docs/**/*.md` resolves, and removed live-document paths are not referenced outside explicitly excluded historical archives.

#### Scenario: An authoritative document is not indexed
- **WHEN** a Markdown file is added under `docs/` without a corresponding inventory entry
- **THEN** repository verification fails with the unindexed path

#### Scenario: A local documentation link is stale
- **WHEN** an authoritative document links to a missing local target
- **THEN** repository verification fails with the source file and unresolved target

#### Scenario: Historical evidence names a removed document
- **WHEN** an archived OpenSpec change retains a historical reference to `SPEC.md`
- **THEN** documentation verification ignores that archived evidence while continuing to reject the same reference in live documentation and active changes

### Requirement: Live specifications reject configured legacy contracts
Repository verification SHALL inspect non-archived OpenSpec specifications and active changes for configured obsolete package names, removed aggregate preset names, and runtime-owned Persona-selection contracts. The rule set SHALL be narrow enough to permit valid Persona extension configuration such as extension-owned instance identity.

#### Scenario: An active change restores a removed package name
- **WHEN** a non-archived OpenSpec artifact refers to a configured obsolete package or preset identifier
- **THEN** repository verification fails with the artifact and matched legacy rule

#### Scenario: Persona owns instance identity
- **WHEN** a live Persona-extension specification describes `instanceId` as Loader plugin configuration
- **THEN** the legacy-contract check accepts it because the field is extension-owned rather than runtime selection metadata

### Requirement: Production dependency advisories are reviewed explicitly
The repository SHALL provide a reproducible production-dependency audit command that reports unresolved advisories without claiming a clean result. Known advisories without a compatible upstream fix MAY be recorded as an explicit reviewed baseline, but newly introduced advisories, newly available compatible fixes, or baseline drift SHALL require an intentional update and verification.

#### Scenario: A compatible fix becomes available
- **WHEN** the production audit reports that a reviewed advisory has a compatible remediation
- **THEN** security verification fails until the dependency chain is upgraded or an updated reviewed decision is recorded with current evidence

#### Scenario: The local embedder uses the reviewed vulnerable chain
- **WHEN** no compatible fixed release exists for the pinned transformer/runtime chain
- **THEN** the audit reports the unresolved advisory, preserves the opt-in trusted-artifact restriction, and does not describe the dependency set as clean

### Requirement: Repository verification composes integrity checks
The root verification workflow SHALL run workspace typechecks and tests, single-Cordis enforcement, package-boundary validation, and documentation/legacy integrity checks. Network-dependent production advisory queries MAY remain an explicit separate security command but SHALL be included in release or dependency-update evidence.

#### Scenario: Permanent cross-package change is handed off
- **WHEN** the root repository check completes successfully
- **THEN** package, Cordis, test, and documentation integrity have all been verified locally
