## ADDED Requirements

### Requirement: Resolved Doppelganger home
The runtime selection layer SHALL resolve one absolute Doppelganger home using an explicit configured path first, a non-empty `DOPPELGANGER_HOME` environment value second, and `~/.doppelganger` otherwise.

#### Scenario: Explicit home overrides environment
- **WHEN** an application supplies a home path and `DOPPELGANGER_HOME` is also set
- **THEN** Runtime Preset discovery and user configuration use the normalized absolute configured path

#### Scenario: Blank environment does not select the working directory
- **WHEN** no explicit home is supplied and `DOPPELGANGER_HOME` is empty or whitespace
- **THEN** the runtime resolves the conventional `~/.doppelganger` home

### Requirement: Filesystem Runtime Preset discovery
The runtime SHALL discover user Runtime Presets at `$DOPPELGANGER_HOME/.runtime-presets/<id>/runtime.cordis.yml`, SHALL derive the preset ID from the directory name, and SHALL accept only lowercase kebab-case IDs that are safe as one path segment.

#### Scenario: Discover a valid preset
- **WHEN** `.runtime-presets/caveman/runtime.cordis.yml` is a readable valid Loader tree
- **THEN** discovery exposes one Runtime Preset with ID `caveman` and the absolute composition path

#### Scenario: Report an occupied broken preset
- **WHEN** a valid preset-ID directory exists without a readable valid `runtime.cordis.yml`
- **THEN** discovery reports that preset as broken with a diagnostic instead of silently treating the ID as available

#### Scenario: Ignore unrelated filesystem entries
- **WHEN** `.runtime-presets` contains files or directories whose names are not valid preset IDs
- **THEN** discovery does not expose them as Runtime Presets

### Requirement: Complete domain-neutral composition
Each `runtime.cordis.yml` SHALL be a complete Cordis Loader entry tree, including an empty top-level list, and SHALL NOT depend on Persona, identity, memory, project, or persistence concepts supplied by the kernel.

#### Scenario: Activate an arbitrary plugin tree
- **WHEN** a selected Runtime Preset contains a valid third-party Cordis plugin
- **THEN** the runtime activates it without requiring any Persona or memory package

#### Scenario: Activate an empty preset
- **WHEN** the selected `runtime.cordis.yml` contains `[]`
- **THEN** activation succeeds with only runtime-owned host integration contributions

#### Scenario: Reject a patch document as a preset
- **WHEN** `runtime.cordis.yml` contains a patch operation rather than a complete Loader entry list
- **THEN** preset validation fails before a Runtime Session is returned

### Requirement: Runtime-owned user configuration
`$DOPPELGANGER_HOME/config.yaml` SHALL be optional and, when present, SHALL contain only `version: 1` and an optional `defaultRuntimePreset`; unknown or legacy persona-instance fields SHALL be rejected.

#### Scenario: Load a global default
- **WHEN** `config.yaml` selects an existing healthy `defaultRuntimePreset`
- **THEN** that preset is available as the user-global fallback selection

#### Scenario: Run without user configuration
- **WHEN** `config.yaml` is absent
- **THEN** explicit and project selection remain usable and absence of a default is not an error

#### Scenario: Reject legacy instance configuration
- **WHEN** `config.yaml` contains `instances`, `principalId`, or another field outside the runtime-owned schema
- **THEN** configuration loading fails with a field-level diagnostic

### Requirement: Runtime-owned project selection
A discovered `<project>/.doppelganger/manifest.yaml` SHALL be optional and, when present, SHALL contain only `version: 1` and an optional `runtimePreset`; it SHALL NOT carry plugin configuration, plugin state, persona traits, project identity, or storage paths.

#### Scenario: Select a project preset
- **WHEN** the nearest applicable project manifest names a healthy Runtime Preset
- **THEN** runtime selection returns that preset without adding domain metadata to activation

#### Scenario: Empty project manifest adds no selection
- **WHEN** a valid project manifest omits `runtimePreset`
- **THEN** selection continues to the user-global default

#### Scenario: Reject plugin data in project manifest
- **WHEN** a project manifest contains plugin settings or legacy persona selection fields
- **THEN** manifest loading fails with a field-level diagnostic

### Requirement: Deterministic Runtime Preset selection
Selection SHALL use the first present choice in this order: explicit host/session preset ID, project `runtimePreset`, user `defaultRuntimePreset`; when no layer selects a preset, Doppelganger SHALL remain inactive without failing the host.

#### Scenario: Explicit selection wins
- **WHEN** explicit, project, and user selections all exist
- **THEN** the explicit Runtime Preset is selected

#### Scenario: Project selection wins over user default
- **WHEN** no explicit selection exists and both project and user selections exist
- **THEN** the project Runtime Preset is selected

#### Scenario: No selection remains inactive
- **WHEN** no explicit, project, or user selection exists
- **THEN** no Runtime Session is started and the host remains usable

#### Scenario: Selected preset is missing or broken
- **WHEN** the winning selection names an unknown or broken Runtime Preset
- **THEN** activation fails visibly with available-preset and preset-health diagnostics rather than falling through to a lower-precedence choice

### Requirement: Plugin-owned configuration and state
The Doppelganger kernel SHALL treat plugin row `config` values as opaque Loader input and SHALL NOT provide or persist plugin-specific settings, state directories, databases, credentials, scope partitions, or migration policy.

#### Scenario: Plugin owns persistent state
- **WHEN** a composed plugin needs durable state
- **THEN** the plugin resolves and manages its own provider and storage lifecycle without a kernel-created instance home or storage directory

#### Scenario: Plugin owns configuration semantics
- **WHEN** a plugin row carries a `config` object
- **THEN** Doppelganger passes it through Cordis Loader semantics without interpreting its domain fields

### Requirement: Clean generic activation contract
Generic selection and serialized activation SHALL identify the Runtime Preset, normalized Composition Definition, host session, ordered patches, runtime-owned host integration, and watch policy without `instanceId`, `instanceHome`, `principalId`, project ID, traits, or other extension-domain fields.

#### Scenario: Serialize a non-persona activation
- **WHEN** a host activates a selected Runtime Preset
- **THEN** the child runtime receives only generic composition and host integration data required to start the Runtime Session

#### Scenario: Persona remains optional
- **WHEN** a Runtime Preset explicitly composes Persona extensions
- **THEN** those extensions obtain their own configuration and state through extension-owned contracts rather than generic activation metadata

### Requirement: Domain-neutral Runtime Session metadata
Each active composition SHALL receive immutable runtime-owned metadata containing the stable host `sessionId`, selected Runtime Preset ID, and an optional absolute workspace root; it SHALL NOT contain principal, persona instance, project identity, trait, memory, or storage fields.

#### Scenario: Extension consumes session identity
- **WHEN** an ordinary extension needs to correlate events within the active host session
- **THEN** it can consume the generic Runtime Session metadata service without depending on a Persona activation

#### Scenario: Host has no workspace root
- **WHEN** a host activates a preset outside a project workspace
- **THEN** Runtime Session metadata omits the workspace root rather than inventing a project identity
