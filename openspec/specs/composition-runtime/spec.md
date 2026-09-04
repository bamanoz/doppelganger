# Composition Runtime Specification

## Purpose

Defines a domain-neutral runtime that activates, observes, reloads, and disposes isolated Cordis plugin compositions without embedding extension-domain concepts.

## Requirements

### Requirement: Domain-neutral composition activation
The runtime SHALL activate a composition from its identifier, revision, declarative Loader tree, plugin imports, and declared mount points without requiring persona, project, memory, or storage concepts.

#### Scenario: Activate an arbitrary composition
- **ID**: `composition.runtime.activation.arbitrary`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** a caller activates a valid composition with session metadata and all required mounts
- **THEN** the runtime returns an active isolated session after every enabled composition entry settles successfully

#### Scenario: Domain metadata remains extension-owned
- **ID**: `composition.runtime.metadata.extension.owned`
- **EVIDENCE**: `packages/composition-runtime/tests/canonicalization.spec.ts::exports host-neutral canonicalization with immutable optional-field omission`
- **WHEN** an extension requires domain-specific metadata
- **THEN** the extension supplies that metadata through a mounted Cordis plugin rather than a kernel-defined metadata contract

### Requirement: Named composition mount points
A composition SHALL declare named mount points, and activation SHALL accept mounted Cordis plugins only for those declared names. Callers SHALL NOT need to construct Loader patches or identify Loader groups directly.

#### Scenario: Mount a host adapter
- **ID**: `composition.runtime.mount.host.adapter`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** a composition declares a `host` mount point and activation supplies a host plugin for it
- **THEN** the runtime inserts that plugin at the location declared by the composition

#### Scenario: Reject undeclared mount
- **ID**: `composition.runtime.mount.reject.undeclared`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::exhausts partially attached protected providers when activation fails`
- **WHEN** activation supplies a mount name not declared by the composition
- **THEN** activation fails before returning a session and identifies the undeclared mount

#### Scenario: Reject missing required mount
- **ID**: `composition.runtime.mount.reject.missing`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **WHEN** a required mount point has no supplied plugin
- **THEN** activation fails before returning a session and identifies the missing mount

### Requirement: Session isolation
Each activated composition session SHALL own an isolated Cordis lifecycle scope and SHALL not resolve isolated implementations from another concurrently active session.

#### Scenario: Concurrent sessions use distinct implementations
- **ID**: `composition.runtime.isolation.concurrent.sessions`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** two sessions activate the same composition concurrently with different mounted implementations
- **THEN** each session resolves only its own mounted implementations

### Requirement: Audited activation
The runtime SHALL audit the complete Loader tree after dependency settlement and SHALL return a session only when every enabled entry is active.

#### Scenario: Missing dependency blocks activation
- **ID**: `composition.runtime.audit.missing.dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **WHEN** an enabled plugin remains pending because a required service is absent
- **THEN** activation fails with structured diagnostics naming the entry and missing service

#### Scenario: Partial activation is cleaned up
- **ID**: `composition.runtime.activation.partial.cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **WHEN** any composition entry fails during activation
- **THEN** the runtime disposes all resources created for that attempted session

### Requirement: Transactional composition reload
The runtime SHALL serialize reloads per session, commit only a fully audited update, and retain the last valid composition when an update fails.

#### Scenario: Valid update commits
- **ID**: `composition.runtime.reload.valid.commit`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** a watched composition changes to another valid plugin tree
- **THEN** the next session interaction observes the updated composition

#### Scenario: Invalid update rolls back
- **ID**: `composition.runtime.reload.invalid.rollback`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** an update produces a failed, missing, or pending enabled entry
- **THEN** the runtime restores the last valid tree and exposes reload diagnostics without terminating the session

### Requirement: Equivalent activation inputs share one canonicalizer
Composition Definition construction and host adapter activation decoding SHALL use the Composition Runtime's one canonicalization contract for non-empty identifiers, absolute paths, immutable patch data, optional-field omission, and deterministic diagnostics. Concrete adapter fields such as host kind, transport options, and native capability profile SHALL be owned and validated by the host package rather than added to the domain-neutral Composition Runtime activation schema. Optional actor-provider configuration SHALL likewise remain outside the shared Runtime Host contract and be mounted only as a separate plugin.

#### Scenario: Direct and OMP activation describe the same composition
- **ID**: `composition.runtime.direct-and-omp-activation-describe-the-same-composition`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** equivalent composition values enter through the direct Composition Definition API and the OMP adapter's serialized activation decoder
- **THEN** both produce equivalent canonical composition, path, patch, and diagnostic values while OMP-only transport fields remain in `host-omp`

#### Scenario: DSH activates in process
- **ID**: `composition.runtime.dsh-activates-in-process`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** the DSH adapter activates a Runtime Preset without a child transport
- **THEN** it uses the same canonical Composition Definition and direct activation contract without satisfying an OMP-specific `hostKind` discriminator

#### Scenario: An optional value is absent
- **ID**: `composition.runtime.an-optional-value-is-absent`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** an optional activation field is not provided
- **THEN** canonical output omits the field rather than assigning `undefined`

#### Scenario: Direct and serialized activation describe the same composition
- **ID**: `composition.runtime.canonicalization.direct.serialized`
- **EVIDENCE**: `packages/composition-runtime/tests/canonicalization.spec.ts::canonicalizes equivalent direct and host-decoded composition inputs identically`
- **WHEN** equivalent values enter through the direct Composition Definition API and the serialized host activation API
- **THEN** both produce equivalent canonical composition, path, patch, and diagnostic values

### Requirement: Deterministic disposal
Session and runtime disposal SHALL be idempotent, await in-flight lifecycle mutations, remove associated watchers, attempt every owned cleanup stage even when another stage fails, and await Cordis resource quiescence. A session SHALL unregister itself in a `finally`-equivalent path. Runtime disposal SHALL attempt all sibling sessions and owned root resources before reporting collected cleanup failures, and SHALL never dispose a caller-owned root context.

#### Scenario: Dispose one session
- **ID**: `composition.runtime.disposal.session`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::exhausts session cleanup after plugin and watch disposers fail while preserving siblings and a caller-owned root`
- **WHEN** a caller disposes an active session
- **THEN** only that session's plugin tree and watchers are released and the session is removed from runtime ownership before disposal completes

#### Scenario: One plugin disposer throws
- **ID**: `composition.runtime.disposal.session.failure.exhaustion`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::exhausts session cleanup after plugin and watch disposers fail while preserving siblings and a caller-owned root`
- **WHEN** an owned plugin disposer fails while the session also owns watchers and sibling effects
- **THEN** the runtime still removes the watchers, disposes the remaining effects, unregisters the session, and reports the cleanup failure after all reachable cleanup completes

#### Scenario: Dispose runtime with one failing session
- **ID**: `composition.runtime.disposal.runtime.aggregate`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::settles every session and memoizes an aggregate runtime cleanup failure`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::continues through runtime ownership and its owned root when a session cleanup stage rejects`
- **WHEN** one active session rejects disposal and other sessions and an owned Cordis root remain
- **THEN** every sibling session and the owned root are still disposed before the runtime reports an aggregate cleanup failure

#### Scenario: Repeated disposal
- **ID**: `composition.runtime.disposal.idempotent`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::never rewrites authored composition and disposes idempotently`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::settles every session and memoizes an aggregate runtime cleanup failure`
- **WHEN** session or runtime disposal is requested again after successful or partially failing cleanup
- **THEN** the request completes without repeating already completed side effects or reviving removed ownership

### Requirement: Kernel-only public interface
The kernel package SHALL expose composition, canonicalization, protected runtime-plugin insertion, session metadata, diagnostics, reload, and disposal contracts while excluding host-specific activation request schemas and all persona, actor, memory, context assembly, tool, lifecycle, MCP, and persistence contracts.

#### Scenario: Consume kernel independently
- **ID**: `composition.runtime.consume-kernel-independently`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** a downstream package imports the kernel public entry point
- **THEN** it can activate a generic Cordis composition and reuse canonicalization without importing any domain extension or OMP-specific discriminator

#### Scenario: OMP decodes transported activation
- **ID**: `composition.runtime.omp-decodes-transported-activation`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** the OMP child validates an activation request containing OMP transport options and optional actor-provider configuration
- **THEN** the decoder is exported by `host-omp`, supplies only generic canonical composition and session fields to Composition Runtime, and mounts actor identity independently from the shared bridge

### Requirement: Protected host integration and layered audit
Runtime-owned plugins SHALL be inserted after caller-controlled layers as one deterministic protected set. The set MAY include the shared Runtime Host bridge, a separate actor provider in adapter-selected absent, unbound, or bound state, and explicitly typed host-specific providers; none SHALL be folded into another provider's public contract. Every required and optional isolated service declared for those plugins SHALL resolve only inside the owning Runtime Session. The fully layered composition SHALL be audited before a Runtime Session is returned.

#### Scenario: Mount shared host bridge last
- **ID**: `composition.runtime.mount-shared-host-bridge-last`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** a valid effective composition is activated by any supported host
- **THEN** the runtime inserts that host's shared bridge after caller-controlled layering, isolates its declared portable services to the session, and audits activation before returning the session

#### Scenario: Mount host-specific sibling provider
- **ID**: `composition.runtime.mount-host-specific-sibling-provider`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** an adapter supplies an additional typed native capability plugin beside the shared bridge
- **THEN** both protected plugins activate in deterministic order with their declared isolated service realms and authored layers cannot replace them

#### Scenario: Mount actor provider beside the bridge
- **ID**: `composition.runtime.mount-actor-provider-beside-the-bridge`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** an adapter contract installs Actor Identity in unbound or bound state
- **THEN** Composition Runtime mounts that separate actor plugin in the protected set while the shared bridge remains actor-neutral; an adapter that does not implement Actor Identity omits the provider

#### Scenario: Empty composition receives host integration
- **ID**: `composition.runtime.empty-composition-receives-host-integration`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** the selected preset contains an empty Loader list
- **THEN** the protected runtime-owned set still activates without requiring a preset-authored placeholder or target group

#### Scenario: Layered composition activates successfully
- **ID**: `composition.runtime.layered-composition-activates-successfully`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** every document is valid, every targeted mutation matches, every required mount lands, and every enabled authored and protected plugin settles active
- **THEN** the runtime returns the audited Runtime Session

#### Scenario: Protected provider has unresolved dependency
- **ID**: `composition.runtime.protected-provider-has-unresolved-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** a shared bridge or host-specific protected plugin has a failed or unresolved dependency
- **THEN** activation fails, cleans up the attempted tree, and reports the protected entry and missing service without returning a partially attached binding

#### Scenario: Mount host adapter last
- **ID**: `composition.runtime.activation.host.adapter.last`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** a valid effective composition is activated by a host
- **THEN** the runtime inserts that host's bridge at the composition root after caller-controlled layering and audits its activation before returning the session

#### Scenario: Layer causes plugin activation failure
- **ID**: `composition.runtime.audit.layered.failure`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** a patch produces an enabled entry with a failed or unresolved dependency
- **THEN** activation fails, cleans up the attempted tree, and reports both entry diagnostics and the effective layer context

### Requirement: Optional filesystem layer set reload
When watching is enabled, creation or deletion of an optional user or project patch SHALL rebuild the serialized effective composition under the same transactional reload guarantees.

#### Scenario: Patch appears or disappears
- **ID**: `composition.runtime.reload.optional.layer.set`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** an optional user or project patch file is created or removed
- **THEN** the runtime rebuilds using the new ordered set of layers
