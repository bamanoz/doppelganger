## ADDED Requirements

### Requirement: Ordered Runtime Preset patch layers
The runtime SHALL build the effective composition by applying, in order, the selected preset's complete `runtime.cordis.yml`, optional `$DOPPELGANGER_HOME/runtime.cordis.patch.yml`, optional `<project>/.doppelganger/runtime.cordis.patch.yml`, explicit host activation patches, and finally runtime-owned mount patches.

#### Scenario: More specific layer overrides an earlier layer
- **WHEN** user and project patches both replace the same entry field
- **THEN** the effective composition contains the project layer's value before later host and runtime-owned patches are applied

#### Scenario: Missing optional patch is a no-op
- **WHEN** either standard patch path is absent
- **THEN** activation continues with the remaining layers without creating the missing file

#### Scenario: No project selection still permits project patching
- **WHEN** a user default selects the Runtime Preset and an applicable project patch exists
- **THEN** the project patch applies to that selected preset even though the manifest did not select it

### Requirement: Native Cordis patch semantics
Patch files and explicit host patches SHALL use the Cordis Include patch vocabulary directly; Doppelganger SHALL NOT introduce a second patch language or deep-merge plugin `config` values.

#### Scenario: Insert an entry
- **WHEN** a patch uses an unconditional Cordis insert operation
- **THEN** the inserted plugin entry appears at the requested position in the effective Loader tree

#### Scenario: Replace entry configuration
- **WHEN** a targeted patch supplies `config` for an existing entry
- **THEN** that `config` replaces the earlier value as one whole value rather than deep-merging omitted fields

#### Scenario: Reject invalid patch shape
- **WHEN** a patch file does not validate as a Cordis patch list
- **THEN** activation fails with a diagnostic naming the source patch file and invalid location

#### Scenario: Resolve a patch-local inserted plugin
- **WHEN** a filesystem patch inserts an entry whose plugin name is a relative path
- **THEN** the path is anchored to that patch file's directory while bare package names and target assertion names remain unchanged

### Requirement: Fail-loud targeted mutations
Every targeted patch mutation SHALL match its intended entry in the composition state produced by earlier layers; an unmatched target SHALL fail activation rather than warn or silently continue.

#### Scenario: Target exists
- **WHEN** a project patch targets an entry produced by the preset or user patch
- **THEN** the mutation applies exactly once to that entry

#### Scenario: Target is absent
- **WHEN** a patch targets an ID that earlier layers did not produce
- **THEN** activation fails with a diagnostic naming the patch source and unmatched target ID

### Requirement: Protected runtime-owned host integration
Runtime-owned host integration SHALL be generated internally as a root insertion after all caller-controlled patches, use reserved names and IDs, and SHALL not be removable, replaceable, or forged by preset, user, project, or host patch input.

#### Scenario: Mount host adapter last
- **WHEN** a valid effective composition is activated by a host
- **THEN** the runtime inserts that host's bridge at the composition root after caller-controlled layering and audits its activation before returning the session

#### Scenario: Reject reserved mount identity
- **WHEN** a caller-controlled composition or patch declares a runtime-reserved host import name or generated entry ID
- **THEN** validation fails before the composition is activated

#### Scenario: Empty composition receives host integration
- **WHEN** the selected preset contains an empty Loader list
- **THEN** the runtime-owned root insertion still activates the host bridge without requiring a preset-authored placeholder or target group

### Requirement: Effective composition audit
The runtime SHALL validate every source document and audit the fully layered Loader tree before publishing a Runtime Session; failures SHALL identify the base preset or patch layer responsible where determinable.

#### Scenario: Layered composition activates successfully
- **WHEN** every document is valid, every targeted mutation matches, every required mount lands, and every enabled plugin settles active
- **THEN** the runtime returns the audited Runtime Session

#### Scenario: Layer causes plugin activation failure
- **WHEN** a patch produces an enabled entry with a failed or unresolved dependency
- **THEN** activation fails, cleans up the attempted tree, and reports both entry diagnostics and the effective layer context

### Requirement: Transactional layered reload
When watching is enabled, the runtime SHALL observe the base composition and applicable filesystem patch paths, including creation and deletion of optional patch files, serialize reloads per session, and retain the last audited effective composition when rebuilding any layer fails.

#### Scenario: Patch edit commits
- **WHEN** an existing patch changes and the rebuilt effective composition passes validation and audit
- **THEN** the active Runtime Session commits the new composition generation

#### Scenario: Patch appears or disappears
- **WHEN** an optional user or project patch file is created or removed
- **THEN** the runtime rebuilds using the new ordered set of layers

#### Scenario: Invalid reload rolls back
- **WHEN** a changed base or patch layer is invalid or produces a failed effective tree
- **THEN** the previous audited composition remains active and reload diagnostics expose the rejected layer

### Requirement: Composition inputs are never persistence targets
The runtime SHALL treat `runtime.cordis.yml` and every `runtime.cordis.patch.yml` as authored inputs and SHALL suppress Loader write-back from mutating them during plugin disposal, self-removal, reload, or session teardown.

#### Scenario: Session disposal does not rewrite configuration
- **WHEN** a Runtime Session disposes its layered Loader tree
- **THEN** every preset and patch file remains byte-for-byte unchanged

#### Scenario: Plugin state is not written into patches
- **WHEN** a plugin mutates runtime-local or durable state
- **THEN** Doppelganger does not serialize that state into any composition or patch input
