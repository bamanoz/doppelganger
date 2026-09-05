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
The runtime SHALL discover Runtime Presets from the ordered trust-aware roster roots. Each root SHALL contain one directory per preset at `<root>/<id>/runtime.cordis.yml`; discovery SHALL derive the preset ID from the directory name, SHALL accept only lowercase kebab-case IDs safe as one path segment, SHALL retain the winning root and trust in the descriptor, and SHALL return deterministic first-root-wins results.

#### Scenario: Discover a valid user preset
- **ID**: `runtime.presets.discovery.valid-preset`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** the derived user root contains `caveman/runtime.cordis.yml` as a readable valid Loader tree and no earlier root occupies `caveman`
- **THEN** discovery exposes one user Runtime Preset with ID `caveman`, its absolute composition path, root identity, and `user` trust

#### Scenario: Report an occupied broken preset
- **ID**: `runtime.presets.discovery.broken-occupied-id`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a winning valid preset-ID directory exists without a readable valid `runtime.cordis.yml`
- **THEN** discovery reports that preset as broken with its source root and diagnostics instead of silently treating the ID as available

#### Scenario: Ignore unrelated filesystem entries
- **ID**: `runtime.presets.discovery.ignore-unrelated-entries`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a roster root contains files or directories whose names are not valid preset IDs
- **THEN** discovery does not expose them as Runtime Presets

### Requirement: Complete domain-neutral composition
Each `runtime.cordis.yml` SHALL be a complete Cordis Loader entry tree, including an empty top-level list, and SHALL NOT depend on Persona, identity, memory, project, or persistence concepts supplied by the kernel.
Roster health and Composition Runtime activation SHALL consume the same portable Loader structural rules for required nonblank entry IDs and plugin names, unique IDs, and recursively valid supplied group-entry arrays. Ordinary plugin configuration SHALL remain opaque. Protected runtime identities and layered patch target policy SHALL remain Composition Runtime responsibilities, and a healthy roster descriptor SHALL not promise successful plugin dependency activation.

#### Scenario: Activate an arbitrary plugin tree
- **ID**: `runtime.presets.activation.arbitrary-plugin-tree`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
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

#### Scenario: Malformed Loader shape reaches roster and activation
- **ID**: `runtime.presets.validation.structural-parity`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::rejects the same malformed Loader structures as preset discovery`
- **WHEN** a Loader tree with a missing ID, duplicate ID, or malformed supplied group-entry array is examined by roster discovery and activation
- **THEN** both entrypoints reject the structure with source-labelled diagnostics before any plugin from that tree activates

#### Scenario: Shared shape validation does not absorb feature configuration
- **ID**: `runtime.presets.validation.opaque-config-preserved`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::validates Loader shape without interpreting ordinary plugin config`
- **WHEN** a valid non-group plugin carries arbitrary JSON-compatible feature configuration
- **THEN** roster structural validation leaves that configuration unchanged and does not require feature packages or runtime-protected policy

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
Selection SHALL evaluate the first present choice in this order: explicit host/session preset ID, project `runtimePreset`, user `defaultRuntimePreset`, deployment default. Documents below the winning precedence level SHALL NOT be loaded or validated for that selection attempt. A present document that can determine the winner SHALL remain strictly validated. A present missing or broken winner SHALL fail visibly and SHALL NOT fall through. The standard roster SHALL use `standard` as its deployment default. A deployment that explicitly omits its default and supplies no higher-precedence choice SHALL leave Doppelganger inactive without failing the host.

#### Scenario: Explicit selection wins
- **ID**: `runtime.presets.selection.explicit-wins`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::explicit selection ignores malformed lower-precedence documents`
- **WHEN** an explicit valid Runtime Preset is supplied while project or user selection documents are malformed
- **THEN** the explicit preset is selected without reading those lower-precedence documents

#### Scenario: Project selection wins over defaults
- **ID**: `runtime.presets.selection.project-over-user`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::project selection ignores malformed lower-precedence user configuration`
- **WHEN** no explicit selection exists and a valid project selection exists while user configuration is malformed
- **THEN** the project Runtime Preset is selected without reading the user default

#### Scenario: User default wins over deployment default
- **ID**: `runtime.presets.selection.user-over-deployment`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** no explicit or project selection exists and the user selects a healthy `defaultRuntimePreset`
- **THEN** the user Runtime Preset selection wins over `standard`

#### Scenario: Deployment default selects shipped standard
- **ID**: `runtime.presets.selection.deployment-standard`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** no explicit, project, or user selection exists and the standard roster configuration is active
- **THEN** the shipped healthy `standard` Runtime Preset is selected

#### Scenario: Explicitly defaultless deployment remains inactive
- **ID**: `runtime.presets.selection.inactive-without-selection`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** the deployment configures no default and no explicit, project, or user selection exists
- **THEN** no Runtime Session is started and the host remains usable

#### Scenario: Selected preset is missing or broken
- **ID**: `runtime.presets.selection.broken-winner-fails`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::does not fall through from a missing or broken winner`
- **WHEN** the winning explicit, project, user, or deployment selection names an unknown or broken Runtime Preset
- **THEN** selection fails with diagnostics for that winner rather than reading or selecting a lower-precedence choice

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
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
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
Runtime Preset discovery SHALL return deterministic healthy and broken descriptors containing stable identity, source root, trust, absolute composition path, composition revision, and optional display metadata. Resolved selection SHALL additionally identify the selection source and ordered patch paths. The roster control plane SHALL remain outside the authored Loader tree.

#### Scenario: Host resolves a selected preset
- **ID**: `runtime.presets.selection.resolved-descriptor`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::resolves explicit, project, and user selection and rejects unhealthy winners`
- **WHEN** a host supplies roster configuration and optional explicit or project selection
- **THEN** the roster resolves the winning healthy Runtime Preset and returns its absolute composition path, stable ID, root, trust, revision, selection source, and ordered patch paths

#### Scenario: Runtime Preset remains a portable composition
- **ID**: `runtime.presets.composition.portable-loader-tree`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates the shipped standard Runtime Preset from an empty home`
- **WHEN** a shipped or user Runtime Preset is activated in any host
- **THEN** its authored Loader tree contains only feature and infrastructure rows selected by its author, not the roster plugin itself

#### Scenario: Roster is listed
- **ID**: `runtime.presets.discovery.deterministic-roster`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::discovers healthy and broken occupied IDs deterministically`
- **WHEN** a caller lists discovered Runtime Presets
- **THEN** healthy and broken entries are returned in deterministic ID order with status, source root, trust, and source paths

#### Scenario: Metadata is absent
- **ID**: `runtime.presets.metadata.optional-display-fallback`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::keeps optional display metadata separate from composition health and revision`
- **WHEN** a healthy Runtime Preset contains only `runtime.cordis.yml`
- **THEN** it remains selectable and its directory ID is usable as its display fallback

#### Scenario: Composition changes
- **ID**: `runtime.presets.metadata.composition-revision`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::keeps optional display metadata separate from composition health and revision`
- **WHEN** the bytes of a winning `runtime.cordis.yml` change
- **THEN** the roster reports a different composition revision regardless of display metadata changes

### Requirement: Shipped standard Runtime Preset
`@doppelganger/doppelganger-runtime-presets` SHALL publish a `presets/standard/` Runtime Preset whose complete Loader tree and adjacent assets are available directly from the installed package without copying files into Doppelganger home. The shipped `standard` composition SHALL be host-neutral, actor-neutral, and usable without Persona-specific user configuration; it SHALL compose the standard context, tool, and neutral Persona identity/trait layers while omitting actor-dependent persistent extensions.

#### Scenario: Fresh installation resolves standard
- **ID**: `runtime.presets.shipped.standard-available`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** the runtime-presets package is installed and the user preset root and user configuration are absent
- **THEN** the roster exposes one healthy system Runtime Preset named `standard` from the package-owned shipped root

#### Scenario: Standard activates without actor binding
- **ID**: `runtime.presets.shipped.standard-actor-neutral`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates the shipped standard Runtime Preset from an empty home`
- **WHEN** an official host activates the shipped `standard` Runtime Preset without a bound actor
- **THEN** its context, tools, neutral identity, and traits activate without requiring memory, storage, embedding, or vector services

#### Scenario: First selection initializes user control files without copying standard
- **ID**: `runtime.presets.shipped.no-home-copy`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** the shipped roster first selects `standard` from an uninitialized Doppelganger home
- **THEN** it creates `config.yaml`, `runtime.cordis.patch.yml`, and `.runtime-presets/`, preserves them on later selections, and does not create `.runtime-presets/standard`

### Requirement: Trust-aware Runtime Preset roots
The roster SHALL derive its roots in this order: the package-owned shipped root when enabled, configured roots in authored order, and `$DOPPELGANGER_HOME/.runtime-presets` when enabled. Every root SHALL declare `system` or `user` trust, the shipped root SHALL be `system`, the derived home root SHALL be `user`, and the first root supplying an occupied preset ID SHALL win.

#### Scenario: Earlier root shadows duplicate ID
- **ID**: `runtime.presets.roots.first-wins`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::uses first-root-wins shadowing without falling through broken winners`
- **WHEN** shipped, configured, or user roots contain the same valid preset ID
- **THEN** the roster exposes only the descriptor from the earliest root and does not merge preset directories

#### Scenario: Derived roots can be disabled
- **ID**: `runtime.presets.roots.derived-opt-out`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::respects explicit root opt-outs and configured trust`
- **WHEN** a deployment disables the shipped root, the user root, or both
- **THEN** discovery scans only the remaining configured roots and retains their authored trust and order

#### Scenario: Broken entry occupies its ID
- **ID**: `runtime.presets.roots.broken-first-wins`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::uses first-root-wins shadowing without falling through broken winners`
- **WHEN** an earlier root contains a broken valid-ID directory and a later root contains a healthy preset with the same ID
- **THEN** the broken earlier descriptor occupies the ID and selection fails visibly rather than falling through

### Requirement: Copy-only Runtime Preset authoring
The roster SHALL author a local Runtime Preset only by copying the complete directory of an existing discovered preset into the first configured `user` root. Copy SHALL dereference symlinks, SHALL be atomic from the roster's perspective, SHALL reject invalid or occupied IDs without overwriting, and SHALL return the absolute copied directory. Removal SHALL be allowed only for presets owned by that writable root.

#### Scenario: Copy shipped standard for customization
- **ID**: `runtime.presets.authoring.copy-standard`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::copies shipped standard to a new user identity in the first writable root`
- **WHEN** the caller copies `standard` to the new ID `mark`
- **THEN** the writable root receives a self-contained `mark` directory containing the composition, metadata, identity, traits, and every adjacent asset from `standard`

#### Scenario: Copy never overwrites
- **ID**: `runtime.presets.authoring.no-overwrite`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::rejects invalid and filesystem-occupied IDs and cleans failed staging trees`
- **WHEN** the destination ID is invalid or occupied by any discovered root or filesystem directory
- **THEN** the copy fails without modifying the existing destination or leaving a partial preset

#### Scenario: Concurrent copy has one winner
- **ID**: `runtime.presets.authoring.concurrent-no-overwrite`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::never overwrites occupied IDs under concurrent copying`
- **WHEN** two callers race to copy into the same destination ID
- **THEN** exactly one succeeds and the other receives an occupied-ID failure

#### Scenario: Shipped preset cannot be removed
- **ID**: `runtime.presets.authoring.system-read-only`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::restricts removal to user-owned winners and clears their selected default`
- **WHEN** removal targets a shipped or configured system preset
- **THEN** the roster rejects the operation and leaves the preset unchanged

#### Scenario: Foreign user root cannot be removed
- **ID**: `runtime.presets.authoring.foreign-user-read-only`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::refuses presets owned by a later foreign user root`
- **WHEN** removal targets a preset from a user root other than the first writable root
- **THEN** the roster rejects removal and leaves the preset unchanged

#### Scenario: Removing selected user default clears it
- **ID**: `runtime.presets.authoring.clear-deleted-default`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::restricts removal to user-owned winners and clears their selected default`
- **WHEN** a removable user preset is also selected by `defaultRuntimePreset`
- **THEN** removal atomically deletes the preset and removes that user-default field so future selection re-inherits the deployment default

### Requirement: Shared pure and Cordis roster surfaces
The runtime-presets package SHALL implement one roster domain model and expose it through both a pure Node API and an optional Cordis service plugin. The pure API SHALL support pre-runtime host selection without constructing a Cordis Context; the Cordis plugin SHALL provide the same list, resolve, copy, remove, and default semantics as `ctx.doppelgangerRuntimePresets` for in-process hosts. Neither surface SHALL activate a Runtime Session or be inserted into an authored Runtime Preset composition.

#### Scenario: OMP resolves before child startup
- **ID**: `runtime.presets.surface.pure-host-selection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::resolves explicit, project, and user selection and rejects unhealthy winners`
- **WHEN** OMP selects a Runtime Preset before a runtime child exists
- **THEN** it uses the pure roster API and receives the same descriptor and selection result the Cordis service would expose

#### Scenario: In-process host consumes Cordis service
- **ID**: `runtime.presets.surface.cordis-service`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::provides the same roster API and removes it with the plugin fiber`
- **WHEN** an in-process host composes the runtime-presets plugin
- **THEN** `ctx.doppelgangerRuntimePresets` provides the shared roster operations and disposes with its plugin scope

### Requirement: Preset import health follows actual Node resolution
A Runtime Preset SHALL be healthy only when every authored plugin import can resolve from the Loader path under supported Node ESM resolution. Bare-package validation SHALL honor package exports when present and SHALL also reject nonexistent package roots or deep targets when exports are absent.

#### Scenario: Legacy package deep import is missing
- **ID**: `runtime.presets.validation.missing-unexported-deep-import`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::marks nonexistent deep imports in packages without exports as broken`
- **WHEN** a Loader entry names a deep path in a package without an exports map and that target does not exist
- **THEN** discovery reports the preset as broken with an import-resolution diagnostic

#### Scenario: Valid package import resolves outside process cwd
- **ID**: `runtime.presets.validation.node-resolvable-bare-import`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::validates bare package targets with Node resolution independent of process cwd`
- **WHEN** a Loader entry names an installed valid root or subpath export
- **THEN** discovery accepts it using the same module-resolution basis used by activation rather than the caller's working directory

