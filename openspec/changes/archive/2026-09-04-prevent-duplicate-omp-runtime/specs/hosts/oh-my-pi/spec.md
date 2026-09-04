## MODIFIED Requirements

### Requirement: OMP loading modes are explicit alternatives
Doppelganger SHALL support both the installed or linked `@doppelganger/doppelganger-omp` entrypoint and the repository-local `.omp/extensions/doppelganger.ts` delegation. Current setup and verification guidance SHALL state that OMP deduplicates extension candidates by resolved absolute path rather than package name or exported factory identity, so the two different paths SHALL be selected as alternatives within one OMP invocation. The guidance SHALL provide concrete plugin enable and disable actions and SHALL NOT claim a Doppelganger singleton, lease, or restriction on opening the same OMP session in multiple processes.

#### Scenario: Developer uses the linked plugin mode
- **ID**: `omp.package.loading-mode-linked`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::is discovered through real isolated OMP local plugin linking`
- **WHEN** the active OMP profile enables the linked package and the workspace does not expose the project-local Doppelganger extension
- **THEN** OMP loads the package entrypoint and starts its child runtime through the installed package layout

#### Scenario: Developer uses project-local dogfood mode
- **ID**: `omp.package.loading-mode-project-local`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::uses the delegated repository extension with a generated test preset`
- **WHEN** the linked package is absent or disabled for the active OMP profile and OMP discovers the repository-local delegation
- **THEN** the project-selected Runtime Preset activates through the same neutral package factory without a second Doppelganger adapter

#### Scenario: Both distinct entrypoint paths are enabled
- **ID**: `omp.package.loading-mode-duplicate-warning`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::uses the same package entrypoint for project discovery and plugin linking`
- **WHEN** documentation explains the repository delegation and linked plugin as different OMP extension paths that export the same package factory
- **THEN** it warns that enabling both makes OMP invoke two adapters and instructs the operator to disable one path rather than relying on runtime arbitration
