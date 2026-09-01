## ADDED Requirements

### Requirement: File-backed Persona contributions share reload guarantees
Identity and trait assets SHALL use one internal file-backed contribution mechanism for canonical file identity, non-empty content validation, serialized reload, last-good retention, lifecycle-scoped registration, and bounded diagnostics. Identity and ordered-trait policy SHALL remain explicit at their respective plugin entry points.

#### Scenario: A valid Persona asset changes
- **WHEN** the HMR service reports a change for an active identity or trait asset and the new content validates
- **THEN** the next context resolution observes the new content through the existing contribution identity

#### Scenario: A Persona asset reload fails
- **WHEN** a changed identity or trait file is unreadable or empty
- **THEN** the previous valid contribution remains active and a bounded diagnostic identifies the failed asset

## MODIFIED Requirements

### Requirement: Persona concepts are extension-owned
The Persona extension SHALL own immutable Persona Activation metadata, stable instance and principal identifiers, identity, ordered traits, and Persona-specific state configuration. Generic Runtime Preset selection and Runtime Session metadata SHALL NOT interpret those Persona fields.

#### Scenario: Activate Persona composition
- **WHEN** a selected Runtime Preset includes configured Persona Loader rows
- **THEN** the Persona extension derives its activation metadata and behavior from those rows plus generic host session/workspace metadata

#### Scenario: Activate non-persona composition
- **WHEN** a Runtime Preset does not include the Persona extension
- **THEN** the composition activates without Persona configuration, metadata, or services

### Requirement: Existing persona behavior survives extraction
Persona ownership outside the kernel SHALL preserve identity and ordered-trait context, instance-owned persistent memory when composed, workspace-derived scope isolation, and live asset updates.

#### Scenario: Existing Aiden Runtime Preset remains operational
- **WHEN** the development Aiden Runtime Preset activates through the generic OMP adapter
- **THEN** its Persona Loader rows contribute Aiden identity and ordered traits while composed storage and memory retain their configured behavior

## REMOVED Requirements

### Requirement: Existing persona selection precedence
**Reason:** Explicit, project, and user precedence selects Runtime Presets, not Persona Instances. Keeping a second Persona-selection algorithm would duplicate runtime selection and reintroduce domain fields into generic configuration.

**Migration:** Use explicit host/session Runtime Preset selection, project `runtimePreset`, and user `defaultRuntimePreset` in that order. Configure Persona only inside the selected Runtime Preset's Loader rows.
