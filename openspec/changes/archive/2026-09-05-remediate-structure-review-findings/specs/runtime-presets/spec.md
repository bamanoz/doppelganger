## MODIFIED Requirements

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
