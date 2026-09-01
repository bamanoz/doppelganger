# Runtime Presets Specification

## Purpose

Defines the authoritative ordered Runtime Preset roster, shipped standard distribution, strict selection configuration, copy-only user authoring, pure and Cordis service surfaces, generic activation metadata, and plugin-owned configuration and persistent state.

## Requirements

### Requirement: Resolved Doppelganger home
The runtime selection layer SHALL resolve one absolute Doppelganger home using an explicit configured path first, a non-empty `DOPPELGANGER_HOME` environment value second, and `~/.doppelganger` otherwise. Before the first selection from an uninitialized home, the roster SHALL create `config.yaml`, `runtime.cordis.patch.yml`, and the derived `.runtime-presets/` user root without copying a package-owned Runtime Preset; later selections SHALL preserve those user-owned files.

#### Scenario: Explicit home overrides environment
- **ID**: `runtime.presets.home.explicit-over-environment`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::uses explicit, environment, and conventional paths in order`
- **WHEN** an application supplies a home path and `DOPPELGANGER_HOME` is also set
- **THEN** Runtime Preset discovery and user configuration use the normalized absolute configured path

#### Scenario: Blank environment does not select the working directory
- **ID**: `runtime.presets.home.blank-environment-uses-conventional`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::uses explicit, environment, and conventional paths in order`
- **WHEN** no explicit home is supplied and `DOPPELGANGER_HOME` is empty or whitespace
- **THEN** the runtime resolves the conventional `~/.doppelganger` home

#### Scenario: Selection initializes a missing home
- **ID**: `runtime.presets.home.materialized-on-selection`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** selection starts with a resolved Doppelganger home that has no `config.yaml`
- **THEN** the roster creates a versioned `config.yaml`, an empty editable `runtime.cordis.patch.yml`, and the derived `.runtime-presets/` directory while leaving `.runtime-presets/standard` absent

#### Scenario: Repeated selection preserves initialized files
- **ID**: `runtime.presets.home.initialization-no-overwrite`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** a later selection uses an initialized home whose configuration or patch file has been edited
- **THEN** initialization does not overwrite the user-owned content


### Requirement: Filesystem Runtime Preset discovery
The runtime SHALL discover Runtime Presets from ordered trust-aware roots. Each root SHALL contain one directory per preset at `<root>/<id>/runtime.cordis.yml`; discovery SHALL derive the ID from the directory name, accept only lowercase kebab-case IDs safe as one path segment, retain the winning root and trust, and return deterministic first-root-wins results.

#### Scenario: Discover a valid user preset
- **ID**: `runtime.presets.discovery.valid-preset`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a derived user root contains a readable valid `caveman/runtime.cordis.yml` and no earlier root occupies `caveman`
- **THEN** discovery exposes one user Runtime Preset with its ID, absolute composition path, root, and trust

#### Scenario: Report an occupied broken preset
- **ID**: `runtime.presets.discovery.broken-occupied-id`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a winning valid-ID directory lacks a readable valid `runtime.cordis.yml`
- **THEN** discovery reports it as broken with root and diagnostics instead of treating the ID as available

#### Scenario: Ignore unrelated filesystem entries
- **ID**: `runtime.presets.discovery.ignore-unrelated-entries`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a root contains files or directories whose names are not valid preset IDs
- **THEN** discovery does not expose them as Runtime Presets

### Requirement: Complete domain-neutral composition
Each `runtime.cordis.yml` SHALL be a complete Cordis Loader entry tree, including an empty top-level list, and SHALL NOT depend on Persona, identity, memory, project, or persistence concepts supplied by the kernel.

#### Scenario: Activate an arbitrary plugin tree
- **ID**: `runtime.presets.activation.arbitrary-plugin-tree`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **WHEN** a selected Runtime Preset contains a valid third-party Cordis plugin
- **THEN** the runtime activates it without requiring any Persona or memory package

#### Scenario: Activate an empty preset
- **ID**: `runtime.presets.activation.empty-preset`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **WHEN** the selected `runtime.cordis.yml` contains `[]`
- **THEN** activation succeeds with only runtime-owned host integration contributions

#### Scenario: Reject a patch document as a preset
- **ID**: `runtime.presets.validation.reject-patch-document`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** `runtime.cordis.yml` contains a patch operation rather than a complete Loader entry list
- **THEN** preset validation fails before a Runtime Session is returned

### Requirement: Runtime-owned user configuration
`$DOPPELGANGER_HOME/config.yaml` SHALL be absent only before home initialization and, when present, SHALL contain only `version: 1` and optional `defaultRuntimePreset`; unknown or legacy Persona-instance fields SHALL be rejected.

#### Scenario: Load a global default
- **ID**: `runtime.presets.user-config.global-default`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** `config.yaml` selects an existing healthy `defaultRuntimePreset`
- **THEN** that preset is the user-global selection above the deployment default

#### Scenario: Initialize without a user default
- **ID**: `runtime.presets.user-config.optional`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** `config.yaml` is absent before the first selection
- **THEN** the roster creates a version-only document and explicit, project, and deployment-default selection remain usable

#### Scenario: Reject legacy instance configuration
- **ID**: `runtime.presets.user-config.reject-legacy-fields`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::rejects legacy and malformed fields with file-level diagnostics`
- **WHEN** `config.yaml` contains `instances`, `principalId`, or another field outside the runtime-owned schema
- **THEN** configuration loading fails with a field-level diagnostic

### Requirement: Runtime-owned project selection
A discovered `<project>/.doppelganger/manifest.yaml` SHALL be optional and, when present, SHALL contain only `version: 1` and optional `runtimePreset`; it SHALL NOT carry plugin configuration, plugin state, Persona traits, project identity, or storage paths.

#### Scenario: Select a project preset
- **ID**: `runtime.presets.project.select-preset`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** the nearest applicable project manifest names a healthy Runtime Preset
- **THEN** runtime selection returns that preset without adding domain metadata to activation

#### Scenario: Empty project manifest adds no selection
- **ID**: `runtime.presets.project.empty-manifest-falls-through`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** a valid project manifest omits `runtimePreset`
- **THEN** selection continues to the user and deployment defaults

#### Scenario: Reject plugin data in project manifest
- **ID**: `runtime.presets.project.reject-plugin-data`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::rejects legacy and malformed fields with file-level diagnostics`
- **WHEN** a project manifest contains plugin settings or legacy Persona selection fields
- **THEN** manifest loading fails with a field-level diagnostic

### Requirement: Deterministic Runtime Preset selection
Selection SHALL use the first present choice in this order: explicit host/session preset ID, project `runtimePreset`, user `defaultRuntimePreset`, deployment default. The standard roster SHALL use `standard` as its deployment default. A deployment that explicitly omits its default and supplies no higher-precedence choice SHALL remain inactive. A present missing or broken winner SHALL fail visibly and SHALL NOT fall through.

#### Scenario: Explicit selection wins
- **ID**: `runtime.presets.selection.explicit-wins`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** explicit, project, user, and deployment selections all exist
- **THEN** explicit selection wins

#### Scenario: Project selection wins over defaults
- **ID**: `runtime.presets.selection.project-over-user`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** no explicit selection exists and project, user, and deployment selections exist
- **THEN** project selection wins

#### Scenario: User default wins over deployment default
- **ID**: `runtime.presets.selection.user-over-deployment`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** no explicit or project selection exists and the user selects a healthy default
- **THEN** user selection wins over `standard`

#### Scenario: Deployment default selects shipped standard
- **ID**: `runtime.presets.selection.deployment-standard`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** no explicit, project, or user selection exists and standard roster configuration is active
- **THEN** shipped healthy `standard` is selected with source `deployment`

#### Scenario: Explicitly defaultless deployment remains inactive
- **ID**: `runtime.presets.selection.inactive-without-selection`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::can explicitly disable the deployment default without changing roster semantics`
- **WHEN** deployment configures no default and no explicit, project, or user selection exists
- **THEN** no Runtime Session is started and the host remains usable

#### Scenario: Selected preset is missing or broken
- **ID**: `runtime.presets.selection.broken-winner-fails`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::does not fall through from a missing or broken winner`
- **WHEN** the winning selection names an unknown or broken Runtime Preset
- **THEN** activation fails visibly with available-preset and health diagnostics rather than falling through


### Requirement: Plugin-owned configuration and state
The Doppelganger kernel SHALL treat plugin row `config` values as opaque Loader input and SHALL NOT provide or persist plugin-specific settings, state directories, databases, credentials, scope partitions, or migration policy.

#### Scenario: Plugin owns persistent state
- **ID**: `runtime.presets.plugins.own-persistent-state`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::preserves relationship and project memory across process restarts without leaking project or actor scope`
- **WHEN** a composed plugin needs durable state
- **THEN** the plugin resolves and manages its own provider and storage lifecycle without a kernel-created instance home

#### Scenario: Plugin owns configuration semantics
- **ID**: `runtime.presets.plugins.config-passthrough`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **WHEN** a plugin row carries a `config` object
- **THEN** Doppelganger passes it through Cordis Loader semantics without interpreting domain fields

### Requirement: Clean generic activation contract
Generic selection and serialized activation SHALL identify the Runtime Preset, normalized Composition Definition, host session, ordered patches, runtime-owned host integration, and watch policy without `instanceId`, `instanceHome`, `principalId`, project ID, traits, or other extension-domain fields.

#### Scenario: Serialize a non-Persona activation
- **ID**: `runtime.presets.activation.generic-serialization`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **WHEN** a host activates a selected Runtime Preset
- **THEN** the child receives only generic composition and host integration data

#### Scenario: Persona remains optional
- **ID**: `runtime.presets.activation.persona-optional`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **WHEN** a Runtime Preset explicitly composes Persona extensions
- **THEN** those extensions obtain their configuration and state through extension-owned contracts

### Requirement: Domain-neutral Runtime Session metadata
Each active composition SHALL receive immutable runtime-owned metadata containing stable host `sessionId`, selected Runtime Preset ID, and optional absolute workspace root; it SHALL NOT contain principal, Persona instance, project identity, trait, memory, or storage fields.

#### Scenario: Extension consumes session identity
- **ID**: `runtime.presets.session.generic-identity`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **WHEN** an extension correlates work within an active host session
- **THEN** it consumes generic Runtime Session metadata without depending on Persona activation

#### Scenario: Host has no workspace root
- **ID**: `runtime.presets.session.omit-workspace-root`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::requires project identity and root as one unit`
- **WHEN** a host activates a preset outside a project workspace
- **THEN** Runtime Session metadata omits workspace root rather than inventing project identity

### Requirement: Runtime Preset descriptors are portable and deterministic
Discovery SHALL return deterministic healthy and broken descriptors containing stable identity, source root, trust, absolute composition path, composition revision, and optional display metadata. Resolved selection SHALL identify selection source and ordered patch paths. The roster control plane SHALL remain outside the authored Loader tree.

#### Scenario: Host resolves a selected preset
- **ID**: `runtime.presets.selection.resolved-descriptor`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::resolves explicit, project, and user selection and rejects unhealthy winners`
- **WHEN** a host supplies roster configuration and optional explicit or project selection
- **THEN** the roster resolves the healthy winner with absolute path, ID, root, trust, revision, source, and patch paths

#### Scenario: Runtime Preset remains a portable composition
- **ID**: `runtime.presets.composition.portable-loader-tree`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::activates the checked-in Mark Runtime Preset through Loader interpolation`
- **WHEN** a shipped or user Runtime Preset is activated in any host
- **THEN** its Loader tree contains only feature and infrastructure rows selected by its author, not the roster plugin

#### Scenario: Roster is listed
- **ID**: `runtime.presets.discovery.deterministic-roster`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a caller lists Runtime Presets
- **THEN** healthy and broken entries are returned in deterministic ID order with status, root, trust, and paths

#### Scenario: Metadata is absent
- **ID**: `runtime.presets.metadata.optional-display-fallback`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::keeps optional display metadata separate from composition health and revision`
- **WHEN** a healthy Runtime Preset contains only `runtime.cordis.yml`
- **THEN** it remains selectable and its directory ID is the display fallback

#### Scenario: Composition changes
- **ID**: `runtime.presets.metadata.composition-revision`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::keeps optional display metadata separate from composition health and revision`
- **WHEN** winning `runtime.cordis.yml` bytes change
- **THEN** the roster reports a different revision regardless of display metadata changes
