# Runtime Patch Layering Specification

## Purpose

Defines ordered native Cordis patch composition, protected host integration, transactional reload, and preservation of authored Runtime Preset inputs.

## Requirements

### Requirement: Ordered Runtime Preset patch layers
The runtime SHALL build the effective composition by applying, in order, the selected preset's complete `runtime.cordis.yml`, optional `$DOPPELGANGER_HOME/runtime.cordis.patch.yml`, optional `<project>/.doppelganger/runtime.cordis.patch.yml`, explicit host activation patches, and finally runtime-owned mount patches.

#### Scenario: More specific layer overrides an earlier layer
- **ID**: `runtime.patch.layering.order.override`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::applies ordered whole-field replacement and later targets inserted rows`
- **WHEN** user and project patches both replace the same entry field
- **THEN** the effective composition contains the project layer's value before later host and runtime-owned patches are applied

#### Scenario: Missing optional patch is a no-op
- **ID**: `runtime.patch.layering.optional.noop`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::loads optional files, rejects empty documents, and anchors only inserted relative names`
- **WHEN** either standard patch path is absent
- **THEN** activation continues with the remaining layers without creating the missing file

#### Scenario: No project selection still permits project patching
- **ID**: `runtime.patch.layering.project.without.manifest.selection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a user default selects the Runtime Preset and an applicable project patch exists
- **THEN** the project patch applies to that selected preset even though the manifest did not select it

### Requirement: Native Cordis patch semantics
Patch files and explicit host patches SHALL use the Cordis Include patch vocabulary directly; Doppelganger SHALL NOT introduce a second patch language or deep-merge plugin `config` values.

#### Scenario: Insert an entry
- **ID**: `runtime.patch.semantics.insert`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::applies ordered whole-field replacement and later targets inserted rows`
- **WHEN** a patch uses an unconditional Cordis insert operation
- **THEN** the inserted plugin entry appears at the requested position in the effective Loader tree

#### Scenario: Replace entry configuration
- **ID**: `runtime.patch.semantics.config.replace`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::applies ordered whole-field replacement and later targets inserted rows`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::does not reindex children introduced by a config replacement`
- **WHEN** a targeted patch supplies `config` for an existing entry
- **THEN** that `config` replaces the earlier value as one whole value rather than deep-merging omitted fields

#### Scenario: Reject invalid patch shape
- **ID**: `runtime.patch.validation.invalid.shape`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::rejects malformed patches and runtime-reserved caller identities`
- **WHEN** a patch file does not validate as a Cordis patch list
- **THEN** activation fails with a diagnostic naming the source patch file and invalid location

#### Scenario: Resolve a patch-local inserted plugin
- **ID**: `runtime.patch.resolution.inserted.relative.plugin`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::loads optional files, rejects empty documents, and anchors only inserted relative names`
- **WHEN** a filesystem patch inserts an entry whose plugin name is a relative path
- **THEN** the path is anchored to that patch file's directory while bare package names and target assertion names remain unchanged

### Requirement: Fail-loud targeted mutations
Every targeted patch mutation SHALL match its intended entry in the composition state produced by earlier layers; an unmatched target SHALL fail activation rather than warn or silently continue.

#### Scenario: Target exists
- **ID**: `runtime.patch.target.exactly.once`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::applies ordered whole-field replacement and later targets inserted rows`
- **WHEN** a project patch targets an entry produced by the preset or user patch
- **THEN** the mutation applies exactly once to that entry

#### Scenario: Target is absent
- **ID**: `runtime.patch.target.absent.failure`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::fails loud on absent targets, non-group inserts, and name mismatches`
- **WHEN** a patch targets an ID that earlier layers did not produce
- **THEN** activation fails with a diagnostic naming the patch source and unmatched target ID

### Requirement: Protected runtime-owned host integration
Runtime-owned host integration SHALL be generated internally as a root insertion after all caller-controlled patches, use reserved names and IDs, and SHALL not be removable, replaceable, or forged by preset, user, project, or host patch input.

#### Scenario: Reject reserved mount identity
- **ID**: `runtime.reserved.host.identity`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::rejects malformed patches and runtime-reserved caller identities`
- **WHEN** a caller-controlled composition or patch declares a runtime-reserved host import name or generated entry ID
- **THEN** validation fails before the composition is activated

### Requirement: Composition inputs are never persistence targets
The runtime SHALL treat `runtime.cordis.yml` and every `runtime.cordis.patch.yml` as authored inputs and SHALL suppress Loader write-back from mutating them during plugin disposal, self-removal, reload, or session teardown.

#### Scenario: Session disposal does not rewrite configuration
- **ID**: `runtime.patch.persistence.inputs.immutable`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::never rewrites authored composition and disposes idempotently`
- **WHEN** a Runtime Session disposes its layered Loader tree
- **THEN** every preset and patch file remains byte-for-byte unchanged

#### Scenario: Plugin state is not written into patches
- **ID**: `runtime.patch.persistence.state.not.serialized`
- **EVIDENCE**: `packages/composition-runtime/tests/canonicalization.spec.ts::exports host-neutral canonicalization with immutable optional-field omission`
- **WHEN** a plugin mutates runtime-local or durable state
- **THEN** Doppelganger does not serialize that state into any composition or patch input
