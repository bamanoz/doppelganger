## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Deterministic Runtime Preset selection
Selection SHALL evaluate the first present choice in this order: explicit host/session preset ID, project `runtimePreset`, user `defaultRuntimePreset`, deployment default. Documents below the winning precedence level SHALL NOT be loaded or validated for that selection attempt. A present document that can determine the winner SHALL remain strictly validated. A present missing or broken winner SHALL fail visibly and SHALL NOT fall through.

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

#### Scenario: Selected preset is missing or broken
- **ID**: `runtime.presets.selection.broken-winner-fails`
- **EVIDENCE**: `packages/runtime-presets/tests/runtime-presets.spec.ts::does not fall through from a missing or broken winner`
- **WHEN** the winning explicit, project, user, or deployment selection names an unknown or broken Runtime Preset
- **THEN** selection fails with diagnostics for that winner rather than reading or selecting a lower-precedence choice
