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
The runtime SHALL audit the complete Loader tree after dependency settlement and SHALL return a session only when every enabled entry is active and every required activation-owned watch has been registered. Any failure before return SHALL dispose the complete attempted session.

#### Scenario: Missing dependency blocks activation
- **ID**: `composition.runtime.audit.missing.dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **WHEN** an enabled plugin remains pending because a required service is absent
- **THEN** activation fails with structured diagnostics naming the entry and missing service

#### Scenario: Partial activation is cleaned up
- **ID**: `composition.runtime.activation.partial.cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::cleans the attempted session when watch registration fails after activation`
- **WHEN** any composition entry, audit step, or activation-owned watch registration fails
- **THEN** the runtime disposes every resource created for that attempted session before rejecting activation

### Requirement: Transactional composition reload
The runtime SHALL serialize reloads per session and commit only a fully audited update. On candidate failure it SHALL attempt to restore the last valid composition using the same settlement and acceptance audit as a candidate. It SHALL report successful rollback only when that restoration passes audit. If restoration fails or cannot be audited, the runtime SHALL expose observed restoration diagnostics and the candidate/restoration failure without replacing them with a stale healthy snapshot. The session owner SHALL remain available for explicit retry and exhaustive disposal; the runtime SHALL NOT claim the prior tree is usable when its restoration failed.

#### Scenario: Valid update commits
- **ID**: `composition.runtime.reload.valid.commit`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** a watched composition changes to another valid plugin tree
- **THEN** the next session interaction observes the updated composition

#### Scenario: Invalid update rolls back
- **ID**: `composition.runtime.reload.invalid.rollback`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** an update produces a failed, missing, or pending enabled entry and restoring the last valid tree passes audit
- **THEN** the runtime restores the last valid tree and exposes reload diagnostics without terminating the session

#### Scenario: Restored tree does not satisfy the activation audit
- **ID**: `composition.runtime.reload.restoration-audit-failure`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::reports observed rollback audit failures without restoring stale healthy diagnostics`
- **WHEN** an invalid candidate is rolled back but the restored tree contains an enabled failed or pending entry
- **THEN** reload diagnostics report the actual restored entry state and restoration failure instead of a successful rollback or the previous healthy entry snapshot

#### Scenario: Restoration update itself throws
- **ID**: `composition.runtime.reload.restoration-update-failure`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::aggregates candidate and restoration errors while retaining disposal ownership`
- **WHEN** restoring the prior effective tree throws after a candidate update fails
- **THEN** the session exposes both failures without claiming recovery and still exhausts owned resources when explicitly disposed

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
The kernel package SHALL expose composition canonicalization, one validated protected-composition activation interface, session metadata, diagnostics, reload, and disposal contracts while excluding host-specific activation request schemas and all Persona, actor, memory, context assembly, tool, lifecycle, MCP, persistence, or native host fact contracts. The protected-composition interface SHALL accept a complete deterministic Cordis Loader entry tree plus its runtime-owned module bindings as one unit and SHALL NOT expose separate plugin and isolation maps whose correspondence callers must maintain.

#### Scenario: Consume kernel independently
- **ID**: `composition.runtime.consume-kernel-independently`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::defines a domain-neutral protected composition without host imports`
- **WHEN** a downstream host package imports the kernel public entry point
- **THEN** it can activate a generic authored composition plus one protected composition without importing any domain extension, host package, or host-specific discriminator

#### Scenario: Legacy parallel maps are supplied
- **ID**: `composition.runtime.protected-composition.clean-cutover`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::exposes only the unified protected composition activation contract`
- **WHEN** a caller attempts to use the removed `runtimePlugins` or `runtimePluginIsolation` activation fields
- **THEN** the public TypeScript and runtime admission contracts reject them and every repository caller uses the unified protected composition

### Requirement: Protected host integration and layered audit
A Runtime Session activation MAY supply one complete protected composition owned by its adapter. Composition Runtime SHALL validate and insert that composition after every caller-controlled base, Runtime Patch, and explicit host patch as one deterministic final Loader layer. It MAY contain the shared Runtime Host bridge, narrow typed host-session fact providers, a separate Actor Identity extension in absent, unbound, or bound deployment state, and explicitly typed host-specific providers; none SHALL be folded into another provider's public contract. Authored layers SHALL NOT forge, replace, remove, target, or configure protected entries. Every declared injection and isolated service realm SHALL resolve only inside the owning Runtime Session, and the fully layered tree SHALL pass the ordinary activation audit before the Runtime Session is returned.

#### Scenario: Mount shared host bridge through the protected composition
- **ID**: `composition.runtime.mount-shared-host-bridge-last`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** a valid effective composition is activated by any supported host
- **THEN** the runtime inserts the complete protected composition after caller-controlled layering, isolates its services to the session, and audits all entries before returning the session

#### Scenario: Mount host-specific sibling extension
- **ID**: `composition.runtime.mount-host-specific-sibling-provider`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::settles dependent host extensions through the protected Loader tree`
- **WHEN** an adapter supplies a typed native capability extension beside the shared bridge
- **THEN** both entries activate through Cordis dependency settlement in deterministic order and authored layers cannot replace either entry

#### Scenario: Mount Actor Identity through a Host Extension
- **ID**: `composition.runtime.mount-actor-provider-beside-the-bridge`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** the protected composition installs Actor Identity in unbound or bound state
- **THEN** the separate extension provides `doppelgangerActor` in its session isolation realm while the shared bridge remains actor-neutral; omission leaves the service absent

#### Scenario: Empty authored composition receives host integration
- **ID**: `composition.runtime.empty-composition-receives-host-integration`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **WHEN** the selected Runtime Preset contains an empty Loader list
- **THEN** the protected composition still activates without requiring a preset-authored placeholder or mount point

#### Scenario: Protected extension has unresolved dependency
- **ID**: `composition.runtime.protected-provider-has-unresolved-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::exhausts protected and authored cleanup when a host extension fails`
- **WHEN** a bridge or Host Extension entry has a failed or unresolved dependency
- **THEN** activation fails, cleans the complete attempted tree, and reports the exact protected entry and missing service without returning a partially attached binding

### Requirement: Optional filesystem layer set reload
When watching is enabled, creation or deletion of an optional user or project patch SHALL rebuild the serialized effective composition under the same transactional reload guarantees.

#### Scenario: Patch appears or disappears
- **ID**: `composition.runtime.reload.optional.layer.set`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** an optional user or project patch file is created or removed
- **THEN** the runtime rebuilds using the new ordered set of layers

### Requirement: Watch acquisition is part of session activation
When watching is enabled, all required input-watch registrations SHALL be acquired as owned activation resources before the Runtime Session is returned. Failure to acquire any watch SHALL unwind previously acquired watches, dispose the attempted session Fiber to quiescence, unregister runtime ownership, and report the original failure together with any cleanup failures.

#### Scenario: Watch registration rejects after plugins activate
- **ID**: `composition.runtime.activation.watch-registration-failure-cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::cleans the attempted session when watch registration fails after activation`
- **WHEN** the Loader tree is active but one HMR input registration rejects
- **THEN** activation rejects only after every acquired watch and session-owned effect has been disposed and no attempted session remains runtime-owned

#### Scenario: Cleanup of a failed watch registration also fails
- **ID**: `composition.runtime.activation.watch-registration-aggregate-cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::aggregates watch acquisition and attempted-session cleanup failures`
- **WHEN** watch acquisition rejects and one cleanup stage also rejects
- **THEN** all remaining cleanup stages are attempted and the caller receives an aggregate failure preserving the acquisition cause

### Requirement: Patch validation reports configuration diagnostics
Composition patch validation SHALL validate entry field types before using them, collect all ordinary malformed-field diagnostics, and return `RuntimeConfigurationError` or `CompositionLayerError` at the patch seam rather than incidental JavaScript method or property errors.

#### Scenario: Inserted entry has a non-string name
- **ID**: `composition.runtime.patch.non-string-name-diagnostic`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::reports structured diagnostics for malformed inserted entry fields`
- **WHEN** a patch inserts an entry whose `name` is not a non-empty string
- **THEN** patch definition fails with a diagnostic identifying the exact entry path and does not invoke string operations on the invalid value
