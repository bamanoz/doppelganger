## ADDED Requirements

### Requirement: Persona authoring is explicit and target-scoped
The Persona Authoring extension SHALL be an optional ordinary Cordis plugin. It SHALL derive logical assets from the active immutable `doppelgangerPersona` service, SHALL accept writable policy only as configured logical trait targets, and SHALL NOT accept filesystem paths, identity targets, unknown traits, actor identity, or model-selected policy as writable configuration. Omitting the plugin SHALL leave every Persona asset read-only.

#### Scenario: Mark enables one writable trait
- **ID**: `persona-authoring.policy.mark-writable`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **WHEN** a Runtime Preset selects `evolving-profile` as an active Persona trait and configures `writableTargets: ["trait:evolving-profile"]`
- **THEN** Persona Authoring activates that exact trait as writable while identity and every other trait remain read-only

#### Scenario: Writable policy names identity or an absent trait
- **ID**: `persona-authoring.policy.invalid-target-rejected`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::normalizes strict bounded configuration`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::fails before tool registration for absent, duplicate, symbolic-link, and non-regular writable assets`
- **WHEN** Persona Authoring configuration names `identity`, a filesystem path, a duplicate target, or a trait not selected by the active Persona
- **THEN** plugin activation fails visibly before any authoring tool is registered

#### Scenario: Persona Authoring is omitted
- **ID**: `persona-authoring.policy.omitted-readonly`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::keeps Persona read-only when authoring plugin is omitted`
- **WHEN** a Runtime Preset composes Persona without Persona Authoring
- **THEN** Persona behavior and reload remain unchanged and no writable Persona tool is exposed

### Requirement: Active Persona assets are inspected by logical identity
Persona Authoring SHALL register a read-only `persona.inspect` portable tool that resolves `identity` and `trait:<name>` against the active Persona, reads the exact regular UTF-8 file, and returns logical target, current content, SHA-256 revision, and writable state. It SHALL NOT return an authoring path as an invocation target or follow a symbolic-link target for mutation.

#### Scenario: Inspect the evolving trait
- **ID**: `persona-authoring.inspect.writable-trait`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/asset.spec.ts::returns exact validated bytes, content, canonical URL, mode, and revision`
- **WHEN** the agent invokes `persona.inspect` for `trait:evolving-profile`
- **THEN** the result contains the active content, a `sha256:<lowercase-hex>` revision, and `writable: true` without requiring host approval

#### Scenario: Inspect a protected asset
- **ID**: `persona-authoring.inspect.protected-readonly`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **WHEN** the agent inspects `identity` or an undeclared active trait
- **THEN** the result identifies the asset as `writable: false` and does not grant a mutation capability

#### Scenario: Inspect an invalid target
- **ID**: `persona-authoring.inspect.invalid-target-rejected`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/asset.spec.ts::rejects unsafe, invalid UTF-8, oversized, and non-regular assets without following links`
- **WHEN** the agent supplies a path, unknown logical target, non-regular file, symlink, invalid UTF-8 content, or oversized asset
- **THEN** inspection returns a bounded structured error without reading or changing another file

### Requirement: Trait revision is an exact approved compare-and-swap
Persona Authoring SHALL register `persona.revise` with portable one-shot approval marked `required`. The command SHALL accept only a configured writable logical target, the exact inspected revision, a complete non-empty replacement, a bounded rationale, and optional bounded evidence references. It SHALL validate Markdown asset limits before mutation and SHALL re-read the target under the interprocess mutation lock before comparing the expected revision.

#### Scenario: User approves a current revision
- **ID**: `persona-authoring.revise.approved-current`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::applies one HMR-confirmed exact replacement, preserves mode, and makes retries idempotent`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** `persona.revise` names a writable target whose locked current revision equals `expectedRevision`, the replacement is valid and different, and the host grants this invocation once
- **THEN** Persona Authoring atomically installs the complete replacement and never writes any other Persona asset

#### Scenario: User rejects or cannot answer approval
- **ID**: `persona-authoring.revise.approval-denied`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the host reports rejection, cancellation, or unavailable approval for `persona.revise`
- **THEN** the tool handler is not invoked and the target bytes remain unchanged

#### Scenario: Current content changed after inspection
- **ID**: `persona-authoring.revise.conflict`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::rejects protected, conflicting, malformed, empty, invalid-Unicode, and oversized revisions`
- **WHEN** the locked target revision differs from `expectedRevision`
- **THEN** the revision fails with a structured `PERSONA_REVISION_CONFLICT` result containing the current revision and does not merge or overwrite content

#### Scenario: Replacement already became current
- **ID**: `persona-authoring.revise.already-current`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::applies one HMR-confirmed exact replacement, preserves mode, and makes retries idempotent`
- **WHEN** an exact retry observes that the target already contains the requested replacement
- **THEN** the operation returns an idempotent `already-current` success without rewriting the file or triggering another reload

### Requirement: Concurrent writers serialize across Runtime Sessions
Persona Authoring SHALL serialize mutations within one session and SHALL acquire a bounded interprocess lock adjacent to the exact target before compare-and-swap. Lock ownership SHALL use an unguessable token; stale-lock recovery SHALL be conservative and SHALL never break a lock whose owner may still be live. Failure to establish exclusive ownership SHALL leave the target unchanged.

#### Scenario: Two sessions revise the same inspected revision
- **ID**: `persona-authoring.lock.concurrent-sessions`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/concurrency.spec.ts::allows at most one same-revision Runtime Session to commit`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/concurrency.spec.ts::serializes independent Node processes so one same-revision CAS conflicts`
- **WHEN** two Runtime Sessions concurrently attempt different replacements using the same expected revision
- **THEN** at most one replacement commits and the other returns a conflict or lock-timeout result without overwriting the winner

#### Scenario: A prior process left an uncertain lock
- **ID**: `persona-authoring.lock.uncertain-fails-closed`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/lock.spec.ts::recovers only a provably dead same-host owner and fails closed on uncertain metadata`
- **WHEN** an adjacent lock exists and its ownership cannot safely be proven stale
- **THEN** Persona Authoring fails closed with a bounded lock diagnostic instead of deleting the lock or writing the asset

### Requirement: Revision commit is confirmed by Persona HMR
After atomic replacement, Persona Authoring SHALL wait for the exact selected asset's public Persona reload outcome carrying the matching observed byte revision. Success SHALL be returned only after the active Persona contribution has accepted the new content. A failed or timed-out candidate reload SHALL cause an atomic restoration of the previous bytes and a wait for the matching restoration revision; active last-good content SHALL remain authoritative throughout.

#### Scenario: Valid replacement reloads
- **ID**: `persona-authoring.hmr.applied`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::applies one HMR-confirmed exact replacement, preserves mode, and makes retries idempotent`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::commits Persona revisions only after the Composition Runtime activates the replacement`
- **WHEN** the target replacement is accepted by the active Persona asset lifecycle
- **THEN** `persona.revise` returns `applied` with the new revision and the next context resolution uses the replacement

#### Scenario: Candidate reload fails
- **ID**: `persona-authoring.hmr.candidate-rejected`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::ignores unrelated revisions and rolls a rejected candidate back after restoration confirmation`
- **WHEN** Persona reports a failed reload for the newly written bytes
- **THEN** Persona Authoring restores the previous bytes, confirms the restored revision when possible, and returns a structured `PERSONA_REVISION_REJECTED` failure

#### Scenario: HMR confirmation times out
- **ID**: `persona-authoring.hmr.timeout-rolls-back`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::rolls timed-out candidates back and distinguishes confirmed from unconfirmed restoration`
- **WHEN** no exact reload outcome arrives before the configured deadline
- **THEN** Persona Authoring restores the previous bytes and reports timeout without claiming the new trait is active

#### Scenario: Restoration cannot be confirmed
- **ID**: `persona-authoring.hmr.rollback-unconfirmed`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/mutation.spec.ts::rolls timed-out candidates back and distinguishes confirmed from unconfirmed restoration`
- **WHEN** rollback bytes are restored but the active Persona does not confirm their reload
- **THEN** the result reports `PERSONA_ROLLBACK_UNCONFIRMED`, preserves Persona's in-memory last-good contribution, and exposes the exact filesystem revision for diagnosis

### Requirement: Persona Authoring remains host-neutral and domain-bounded
Persona Authoring SHALL depend only on the workspace Cordis peer, Persona, and extension protocols. It SHALL contain no OMP or DSH API, skill discovery, memory service, actor partition, Runtime Preset selection, command registration, arbitrary file editing, autonomous timer, or background model invocation.

#### Scenario: A host projects authoring tools
- **ID**: `persona-authoring.host-neutral.projection`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::commits Persona revisions only after the Composition Runtime activates the replacement`
- **WHEN** any compatible host activates a Runtime Preset containing Persona Authoring
- **THEN** the host sees ordinary portable `persona.inspect` and `persona.revise` descriptors and enforces the generic approval declaration without Persona-specific adapter code

#### Scenario: Memory is absent
- **ID**: `persona-authoring.memory.optional`
- **EVIDENCE**: `packages/extension-persona-authoring/tests/plugin.spec.ts::registers exactly inspect and approved revise for one writable active trait`
- **WHEN** Persona Authoring activates in a Runtime Preset with no memory extension
- **THEN** inspection and explicit approved revision remain usable while evidence interpretation stays the invoking Agent Skill's responsibility
