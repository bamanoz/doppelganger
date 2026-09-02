## ADDED Requirements

### Requirement: Private OMP plugin package is the local install unit
The workspace SHALL contain a private package named `@doppelganger/doppelganger-omp` at version `0.0.0`. Its package manifest SHALL declare one OMP extension entrypoint so OMP can discover and load Doppelganger through its normal plugin registry after linking the package, without a caller-supplied `-e` path.

#### Scenario: Developer links the workspace package
- **ID**: `omp.package.local-link`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::is discovered through real isolated OMP local plugin linking`
- **WHEN** a developer runs OMP's local plugin-link flow against `packages/omp`
- **THEN** OMP records `@doppelganger/doppelganger-omp` as an enabled plugin and loads its declared extension entrypoint on the next session

### Requirement: Installed OMP entrypoint is deployment-neutral
The OMP plugin entrypoint SHALL compose `@doppelganger/doppelganger-host-omp` without embedding a repository-relative Doppelganger home, repository-relative child path, actor identifier, Persona identifier, or named Runtime Preset. Home and Runtime Preset selection SHALL retain the standard runtime-owned precedence. An absent or blank `DOPPELGANGER_ACTOR_ID` SHALL produce an unbound session; a non-empty value SHALL supply the immutable host actor binding.

#### Scenario: Fresh local installation starts with standard defaults
- **ID**: `omp.package.neutral-fresh-home`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::activates shipped standard from a fresh home without authored package defaults`
- **WHEN** the linked plugin starts with a nonexistent Doppelganger home path and no actor environment value
- **THEN** it creates `config.yaml`, `runtime.cordis.patch.yml`, and `.runtime-presets/`, activates the shipped actor-neutral `standard` Runtime Preset with an unbound actor, and does not copy `.runtime-presets/standard`

#### Scenario: Actor binding is supplied externally
- **ID**: `omp.package.external-actor-binding`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::binds only a non-empty externally configured test actor`
- **WHEN** OMP starts with `DOPPELGANGER_ACTOR_ID=test-actor`
- **THEN** the plugin passes `test-actor` as the immutable OMP actor binding without storing it in the package, Runtime Preset, project manifest, or patch

### Requirement: OMP plugin package owns the standard deployment closure
The local OMP plugin package SHALL declare the complete package dependency closure needed to resolve and activate the shipped `standard` Runtime Preset from an installed plugin tree. The generic `host-omp` package SHALL remain free of Persona, memory, SQLite, embedding, vector, and named-preset dependencies.

#### Scenario: Standard resolves from the plugin dependency tree
- **ID**: `omp.package.standard-dependency-closure`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::contains the resolvable dependency closure for shipped standard and opt-in dynamic plugins`
- **WHEN** the OMP plugin package is inspected without relying on undeclared repository imports
- **THEN** every package referenced by `standard/runtime.cordis.yml` and every required runtime infrastructure peer resolves from the declared plugin dependency tree

#### Scenario: Host adapter boundaries remain neutral
- **ID**: `omp.package.host-boundary-neutrality`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::keeps product dependencies at the OMP package boundary`
- **WHEN** package boundaries are validated after adding the OMP plugin package
- **THEN** product-layer dependencies terminate at `@doppelganger/doppelganger-omp` and do not become dependencies of `@doppelganger/doppelganger-host-omp`

### Requirement: Child runtime location belongs to host package layout
The OMP extension package SHALL NOT supply a source-repository child path. `@doppelganger/doppelganger-host-omp` SHALL locate its private child runtime relative to its own installed module layout, and the package contents SHALL include that child entrypoint.

#### Scenario: Linked package starts its child runtime
- **ID**: `omp.package.installed-child-location`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::is discovered through real isolated OMP local plugin linking`
- **WHEN** the linked OMP plugin activates a selected Runtime Preset outside the repository bootstrap implementation
- **THEN** the adapter starts the child using the installed `host-omp` package location without any caller-provided `childPath`

### Requirement: Project-local bootstrap delegates to the OMP package
The repository's project-local `.omp/extensions/doppelganger.ts` SHALL contain no Doppelganger construction logic or development identity defaults. If retained for repository discovery, it SHALL only delegate to `@doppelganger/doppelganger-omp`; development home and actor values SHALL be supplied explicitly by the launch environment.

#### Scenario: Repository dogfoods the packaged entrypoint
- **ID**: `omp.package.project-bootstrap-delegation`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::uses the delegated repository extension with a generated test preset`
- **WHEN** OMP starts through the delegated repository extension with a generated temporary Runtime Preset and test actor
- **THEN** the generated preset activates through the same package entrypoint used by local plugin linking and the project extension contains no repository home, actor, child path, or local construction defaults

### Requirement: Local packaging does not imply public release
The new OMP plugin package SHALL remain `private: true` at version `0.0.0`. Verification SHALL cover local linking and package contents, but SHALL NOT publish, reserve a registry name, define independent release versioning, or claim marketplace compatibility.

#### Scenario: Package is prepared locally
- **ID**: `omp.package.private-release-boundary`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::remains private while exposing only local source package contents`
- **WHEN** repository package and OpenSpec checks run
- **THEN** the OMP package is usable through local linking while public release remains a separate explicit change
