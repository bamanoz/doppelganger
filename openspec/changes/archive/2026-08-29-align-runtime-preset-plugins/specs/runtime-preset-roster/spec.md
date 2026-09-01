## ADDED Requirements

### Requirement: Runtime Preset roster ownership
The system SHALL provide `@doppelganger/doppelganger-runtime-presets` as the control-plane module that owns Runtime Preset discovery, health classification, metadata, and selection. The roster SHALL remain outside every activated Runtime Preset and SHALL NOT mount feature plugins into a Runtime Session.

#### Scenario: Host resolves a selected preset
- **WHEN** a host supplies the Doppelganger home and optional explicit or project selection
- **THEN** the roster resolves the winning healthy Runtime Preset and returns its absolute composition path, stable ID, revision, selection source, and ordered patch paths

#### Scenario: Runtime Preset remains a portable composition
- **WHEN** a Runtime Preset is activated in any host
- **THEN** its authored Loader tree contains only the feature and infrastructure rows selected by its author, not the roster plugin itself

### Requirement: Discovery and health diagnostics
The roster SHALL discover directories at `<home>/.runtime-presets/<id>/`, SHALL treat `runtime.cordis.yml` as the required composition input, and SHALL expose every valid-ID directory as either healthy or broken. A malformed, missing, or structurally invalid composition SHALL remain visible with diagnostics rather than being silently omitted.

#### Scenario: Broken preset is selected
- **WHEN** the winning Runtime Preset is present but broken
- **THEN** selection fails with diagnostics for that preset and does not fall through to a lower-precedence choice

#### Scenario: Roster is listed
- **WHEN** a caller lists discovered Runtime Presets
- **THEN** healthy and broken entries are returned in deterministic ID order with their status and source paths

### Requirement: Selection precedence remains strict
The roster SHALL preserve selection precedence as explicit Runtime Preset, nearest project `runtimePreset`, user `defaultRuntimePreset`, then inactive. Runtime-owned user and project configuration SHALL contain selection only.

#### Scenario: Project selection overrides user default
- **WHEN** the project manifest names a Runtime Preset and user configuration names another default
- **THEN** the project selection wins and the user default is not attempted

#### Scenario: No selection exists
- **WHEN** no explicit, project, or user selection is present
- **THEN** resolution returns inactive without selecting or creating a Runtime Preset

### Requirement: Metadata is preset-owned and optional
A Runtime Preset directory MAY contain preset display metadata separate from `runtime.cordis.yml`. Metadata SHALL NOT affect composition identity, activation semantics, patch ordering, or health of an otherwise valid composition unless the metadata itself is requested for presentation.

#### Scenario: Metadata is absent
- **WHEN** a healthy Runtime Preset contains only `runtime.cordis.yml`
- **THEN** it remains selectable and its directory ID is usable as its display fallback

#### Scenario: Composition changes
- **WHEN** the bytes of `runtime.cordis.yml` change
- **THEN** the roster reports a different composition revision regardless of display metadata changes
