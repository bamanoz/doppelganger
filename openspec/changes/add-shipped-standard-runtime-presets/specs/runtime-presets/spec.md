## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Deterministic Runtime Preset selection
Selection SHALL use the first present choice in this order: explicit host/session preset ID, project `runtimePreset`, user `defaultRuntimePreset`, deployment default. The standard roster SHALL use `standard` as its deployment default. A deployment that explicitly omits its default and supplies no higher-precedence choice SHALL leave Doppelganger inactive without failing the host. A present missing or broken winner SHALL fail visibly and SHALL NOT fall through.

#### Scenario: Explicit selection wins
- **ID**: `runtime.presets.selection.explicit-wins`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** explicit, project, user, and deployment selections all exist
- **THEN** the explicit Runtime Preset is selected

#### Scenario: Project selection wins over user and deployment defaults
- **ID**: `runtime.presets.selection.project-over-user`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::applies explicit, project, user, deployment, and inactive precedence`
- **WHEN** no explicit selection exists and project, user, and deployment selections exist
- **THEN** the project Runtime Preset is selected

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
- **THEN** activation fails visibly with available-preset and preset-health diagnostics rather than falling through to a lower-precedence choice

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