# Repository Integrity Specification

## Purpose

Defines executable repository checks for package architecture, documentation integrity, live-spec legacy contracts, production dependency advisories, and the root verification workflow.

## Requirements

### Requirement: Package boundaries have one executable source
The repository SHALL define allowed workspace-package dependency edges in one machine-readable manifest consumed by the package-boundary checker. Architecture documentation SHALL describe the intent of those edges without maintaining a second independently executable edge list.
The checker SHALL derive statically declared source edges from TypeScript syntax for imports, side-effect imports, type-only imports, re-exports and string-literal dynamic imports rather than a regex that recognizes only selected spellings. Internal package subpaths SHALL be attributed to their owning workspace package before comparison with the same manifest. Relative imports crossing workspace-package ownership SHALL be rejected under the package-name import convention even when that named edge would be allowed; legal intra-package imports SHALL remain valid. Comments and non-import string contents SHALL not create source edges.

#### Scenario: A forbidden package dependency is introduced
- **ID**: `repository-integrity.forbidden-package-dependency`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::reports forbidden manifest and source edges`
- **WHEN** a workspace package declares a dependency edge absent from the boundary manifest
- **THEN** repository verification fails and identifies the source package, target package, and violated boundary

#### Scenario: A workspace package is added
- **ID**: `repository-integrity.unregistered-workspace-package`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::rejects an unregistered workspace package`
- **WHEN** a new workspace package is present without an explicit boundary-manifest entry
- **THEN** repository verification fails instead of inferring unrestricted dependencies

#### Scenario: Forbidden package is imported for side effects
- **ID**: `repository-integrity.import-side-effect-edge`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::rejects forbidden side-effect and type-only workspace imports`
- **WHEN** a package imports a forbidden workspace dependency through a side-effect or type-only declaration
- **THEN** verification rejects the edge with the canonical source and target package identities

#### Scenario: Relative import crosses package ownership
- **ID**: `repository-integrity.import-relative-package-edge`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::rejects relative cross-package imports even for otherwise allowed named edges`
- **WHEN** a source file reaches another workspace package through a relative path
- **THEN** verification rejects the cross-package spelling and identifies the owning target package instead of ignoring the import

#### Scenario: Allowed package subpath is imported
- **ID**: `repository-integrity.import-subpath-owner`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::attributes imports and reexports from package subpaths to their owner`
- **WHEN** a source file imports or re-exports a declared subpath of an allowed workspace dependency
- **THEN** verification applies the owning package edge and accepts the valid dependency without treating the subpath as another package

#### Scenario: Source contains import-shaped non-code text
- **ID**: `repository-integrity.import-syntax-not-text`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::ignores import-shaped comments and strings while checking literal dynamic imports`
- **WHEN** a source contains comments or ordinary strings resembling forbidden imports alongside a string-literal dynamic import
- **THEN** verification reports only the real syntax-derived edge and produces no false dependency for non-import text

### Requirement: Documentation integrity is executable
Repository verification SHALL validate that every authoritative Markdown document under `docs/` is indexed by `docs/README.md`, every local Markdown link from `README.md`, `AGENTS.md`, and `docs/**/*.md` resolves, and removed live-document paths are not referenced outside explicitly excluded historical archives.

#### Scenario: An authoritative document is not indexed
- **ID**: `repository-integrity.unindexed-authoritative-document`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports authoritative documents missing from the docs index`
- **WHEN** a Markdown file is added under `docs/` without a corresponding inventory entry
- **THEN** repository verification fails with the unindexed path

#### Scenario: A local documentation link is stale
- **ID**: `repository-integrity.stale-local-documentation-link`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports broken local Markdown links`
- **WHEN** an authoritative document links to a missing local target
- **THEN** repository verification fails with the source file and unresolved target

#### Scenario: Historical evidence names a removed document
- **ID**: `repository-integrity.archived-document-reference`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::accepts indexed docs, valid links, archives, and extension-owned instance identity`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports active obsolete package identifiers`
- **WHEN** an archived OpenSpec change retains a historical reference to `SPEC.md`
- **THEN** documentation verification ignores that archived evidence while continuing to reject the same reference in live documentation and active changes

### Requirement: Live specifications reject configured legacy contracts
Repository verification SHALL inspect non-archived OpenSpec specifications and active changes for configured obsolete package names, removed aggregate preset names, and runtime-owned Persona-selection contracts. The rule set SHALL be narrow enough to permit valid Persona extension configuration such as extension-owned instance identity.

#### Scenario: An active change restores a removed package name
- **ID**: `repository-integrity.active-legacy-contract`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports active obsolete package identifiers`
- **WHEN** a non-archived OpenSpec artifact refers to a configured obsolete package or preset identifier
- **THEN** repository verification fails with the artifact and matched legacy rule

#### Scenario: Persona owns instance identity
- **ID**: `repository-integrity.persona-extension-owned-instance-identity`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::accepts indexed docs, valid links, archives, and extension-owned instance identity`
- **WHEN** a live Persona-extension specification describes `instanceId` as Loader plugin configuration
- **THEN** the legacy-contract check accepts it because the field is extension-owned rather than runtime selection metadata

### Requirement: Production dependency advisories are reviewed explicitly
The repository SHALL provide a reproducible production-dependency audit command that reports unresolved advisories without claiming a clean result. Known advisories without a compatible upstream fix MAY be recorded as an explicit reviewed baseline, but newly introduced advisories, newly available compatible fixes, or baseline drift SHALL require an intentional update and verification.

#### Scenario: A compatible fix becomes available
- **ID**: `repository-integrity.compatible-advisory-fix`
- **EVIDENCE**: `scripts/tests/security-audit.spec.ts::fails when a compatible fix becomes available`
- **WHEN** the production audit reports that a reviewed advisory has a compatible remediation
- **THEN** security verification fails until the dependency chain is upgraded or an updated reviewed decision is recorded with current evidence

#### Scenario: The local embedder uses the reviewed vulnerable chain
- **ID**: `repository-integrity.reviewed-vulnerable-embedder-chain`
- **EVIDENCE**: `scripts/tests/security-audit.spec.ts::accepts unchanged reviewed advisories`
- **EVIDENCE**: `scripts/tests/security-audit.spec.ts::rejects newly introduced advisories`
- **EVIDENCE**: `scripts/tests/security-audit.spec.ts::fails when a compatible fix becomes available`
- **WHEN** no compatible fixed release exists for the pinned transformer/runtime chain
- **THEN** the audit reports the unresolved advisory, preserves the opt-in trusted-artifact restriction, and does not describe the dependency set as clean


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

### Requirement: Repository verification composes integrity checks
The root verification workflow SHALL run workspace typechecks and tests, single-Cordis enforcement, package-boundary validation, documentation and legacy integrity checks, and live focused-spec validation from committed source available in a clean checkout. Network-dependent production advisory queries MAY remain an explicit separate security command but SHALL be included in release or dependency-update evidence.

#### Scenario: Permanent cross-package change is handed off
- **ID**: `integrity.root-check.includes-focused-specs`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::checks live focused specification integrity`
- **WHEN** the root repository check completes successfully in a clean checkout
- **THEN** package, Cordis, test, documentation, live-spec ownership, executable-evidence integrity, and availability of every verification helper have all been verified locally

### Requirement: Verification sources survive a clean checkout
Every executable source module imported by repository checks or their tests SHALL be tracked by version control and present in a clean checkout. Ignore rules SHALL distinguish generated package output from source directories such as `scripts/lib`, and verification SHALL fail if a required helper is absent.

#### Scenario: Repository is checked out into a fresh worktree
- **ID**: `repository-integrity.fresh-checkout-verification-sources`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::requires every repository-check helper in tracked source`
- **WHEN** the repository is checked out without ignored files copied from another worktree
- **THEN** package-boundary, documentation-integrity, focused-spec, and production-security commands can load every committed helper they import

#### Scenario: Ignore rule hides an executable helper
- **ID**: `repository-integrity.ignored-verification-helper`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports executable verification helpers excluded by ignore rules`
- **WHEN** a repository check imports a source path that is untracked because an ignore rule matches it
- **THEN** local repository verification fails with the missing or ignored helper path rather than passing only in a contaminated worktree

