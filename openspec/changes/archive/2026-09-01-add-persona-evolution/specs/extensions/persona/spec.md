## MODIFIED Requirements

### Requirement: File-backed Persona contributions share reload guarantees
Identity and trait assets SHALL use one internal file-backed contribution mechanism for canonical file identity, normalized absolute active paths, non-empty UTF-8 content validation, serialized reload, last-good retention, lifecycle-scoped registration, bounded diagnostics, and a public exact-asset reload outcome carrying the observed byte revision when readable. Identity and ordered-trait policy SHALL remain explicit at their respective plugin entry points. Persona core SHALL expose no general write method; a separate optional extension MAY use the immutable activation metadata and public reload outcome to coordinate a configured asset mutation.

#### Scenario: A valid Persona asset changes
- **ID**: `persona.assets.valid-reload`
- **EVIDENCE**: `packages/extension-persona/tests/identity.spec.ts::contributes instruction Markdown and reloads valid content for the next resolution`
- **EVIDENCE**: `packages/extension-persona/tests/traits.spec.ts::composes and reloads selected traits without changing instance identity`
- **WHEN** the HMR service reports a change for an active identity or trait asset and the new content validates
- **THEN** the next context resolution observes the new content through the existing contribution identity and observers receive a success outcome containing that exact canonical asset and accepted byte revision

#### Scenario: A Persona asset reload fails
- **ID**: `persona.assets.last-good`
- **EVIDENCE**: `packages/extension-persona/tests/asset.spec.ts::retains last-good content and reports readable and unreadable failed revisions`
- **WHEN** a changed identity or trait file is unreadable, empty, invalid UTF-8, or otherwise invalid
- **THEN** the previous valid contribution remains active, a bounded diagnostic identifies the failed asset, and observers receive a failed outcome containing that exact canonical asset and observed byte revision when readable

#### Scenario: Separate authoring extension maps a trait
- **ID**: `persona.authoring.logical-trait-mapping`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **WHEN** an optional extension reads `doppelgangerPersona.traits` to resolve `trait:evolving-profile`
- **THEN** it receives one immutable selected trait name and normalized absolute path without gaining a Persona-core write primitive or access to another asset by path

#### Scenario: Persona runs without authoring
- **ID**: `persona.authoring.omitted-readonly`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::keeps Persona read-only when authoring plugin is omitted`
- **WHEN** no authoring extension is composed
- **THEN** identity and traits retain the same read-only activation, contribution, reload, and disposal behavior as before this change
