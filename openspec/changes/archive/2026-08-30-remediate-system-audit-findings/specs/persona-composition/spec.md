## MODIFIED Requirements

### Requirement: Portable persona definition
A Persona Definition SHALL be a host-independent set of ordinary Persona-related plugins, configuration, and assets composed explicitly by a Runtime Preset. It SHALL NOT include a concrete host adapter or rely on runtime-owned Persona selection fields.

#### Scenario: Definition activates in a host
- **WHEN** a Runtime Preset composes a valid Persona Definition and the host appends its protected bridge
- **THEN** the unchanged Persona plugins activate inside that Runtime Session without host-specific code

### Requirement: Stable persona instance
A Persona Instance SHALL derive its stable instance identity and persistent-state lineage from Persona-owned Loader configuration and storage, independently of Runtime Preset selection metadata.

#### Scenario: Runtime Preset revision changes
- **WHEN** a Runtime Preset activates a newer valid revision while retaining the same Persona-owned instance configuration
- **THEN** the Persona Instance identity and explicitly configured persistent-state lineage remain unchanged

### Requirement: Ordered traits
A Persona Definition SHALL support an ordered set of Persona-owned trait assets that contribute working behavior independently of identity.

#### Scenario: Persona configuration declares traits
- **WHEN** a Persona Loader row declares multiple valid trait assets
- **THEN** those traits are composed in declared order without adding trait selection to the project manifest or Runtime Session metadata

### Requirement: Concurrent persona sessions
Concurrent sessions of one Persona Instance SHALL share only authored assets and persistent state explicitly configured by composed extensions.

#### Scenario: Two hosts activate one Persona Instance
- **WHEN** one Persona-owned instance configuration is active in two host sessions
- **THEN** each session has independent runtime state while configured persistent state remains available according to its provider's concurrency rules

## REMOVED Requirements

### Requirement: Project persona selection
**Reason:** Project manifests now select only a generic Runtime Preset. Persona instance and trait configuration belongs to the Persona Loader row inside that preset, not to runtime-owned project selection.

**Migration:** Replace project `instance` or trait fields with `runtimePreset` selection and express Persona instance, identity, traits, and storage in the selected Runtime Preset's Persona plugin configuration.

### Requirement: Global persona selection
**Reason:** User runtime configuration now supports only the optional `defaultRuntimePreset`; it no longer selects a Persona Instance directly.

**Migration:** Select a user-global Runtime Preset through `defaultRuntimePreset`. If that preset composes Persona, its Loader rows own Persona configuration. With no explicit, project, or user Runtime Preset selection, Doppelganger remains inactive.
