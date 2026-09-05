## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Repository verification composes integrity checks
The root verification workflow SHALL run workspace typechecks and tests, single-Cordis enforcement, package-boundary validation, documentation and legacy integrity checks, and live focused-spec validation from committed source available in a clean checkout. Network-dependent production advisory queries MAY remain an explicit separate security command but SHALL be included in release or dependency-update evidence.

#### Scenario: Permanent cross-package change is handed off
- **ID**: `integrity.root-check.includes-focused-specs`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::checks live focused specification integrity`
- **WHEN** the root repository check completes successfully in a clean checkout
- **THEN** package, Cordis, test, documentation, live-spec ownership, executable-evidence integrity, and availability of every verification helper have all been verified locally
