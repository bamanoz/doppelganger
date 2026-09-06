## ADDED Requirements

### Requirement: Host Extension availability and selection have explicit owners
A Host Extension package SHALL export a versioned definition for one exact host kind with a stable ID, closed configuration normalizer, and factory for fresh protected Cordis plugin entries. A deployment operator SHALL install exact packages and configure exact module specifiers plus an ordered definition selection through trusted host-native configuration. The Host Adapter bootstrap SHALL import those modules once, reject unsupported versions, wrong host kinds, duplicate IDs, malformed definitions, and failed configuration normalization, and freeze one available-definition catalog and selected plan before serving Runtime Sessions. Runtime Presets, project manifests, patches, prompts, and tools SHALL NOT add modules or selections. No automatic directory scan, marketplace lookup, package installation, or mutable global registration SHALL occur.

#### Scenario: Operator selects an unknown definition
- **ID**: `host.extensions.control-plane.unknown-selection`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::resolves ordered normalized frozen selections and rejects ambiguity`
- **WHEN** trusted host configuration selects an extension ID absent from the adapter's imported available-definition catalog
- **THEN** deployment planning fails before any Runtime Session is created and identifies the unknown ID

#### Scenario: Installed module targets another host
- **ID**: `host.extensions.control-plane.wrong-host-module`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::builds an immutable available catalog and validates module exports`
- **WHEN** an OpenClaw bootstrap imports a Host Extension definition whose exact host kind is OMP
- **THEN** catalog construction rejects it rather than adapting or approximately exposing its services

#### Scenario: Two sessions use one frozen plan
- **ID**: `host.extensions.control-plane.fresh-session-instances`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::instantiates fresh protected entries for each Runtime Session`
- **WHEN** two native sessions instantiate the same selected Host Extension plan concurrently
- **THEN** they share only immutable definition code and normalized configuration while owning distinct plugin instances, Fibers, effects, and session facts

### Requirement: Host Extension Composition is a separate trusted execution plane
A supported host SHALL construct one complete Host Extension Composition independently from the selected Runtime Preset by instantiating its frozen Host Extension plan with immutable native session facts and narrow adapter-owned capability providers. The Composition SHALL use Cordis Loader plugin entries and configuration and SHALL NOT be selectable, inserted, replaced, removed, or patched by Runtime Preset files, project manifests, Runtime Patches, model context, or model-invocable tools. An empty optional extension selection SHALL be valid; adapter-required infrastructure such as the shared bridge remains protected.

#### Scenario: Runtime Preset attempts to install a host extension
- **ID**: `host.extensions.trust.runtime-preset-cannot-install`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::keeps Host Extensions outside authored preset and patch control`
- **WHEN** an authored Runtime Preset or patch uses a reserved Host Extension entry identity or attempts to target the protected Host Extension Composition
- **THEN** validation rejects the authored layer before activation and does not replace any trusted provider

#### Scenario: Host configures no optional extensions
- **ID**: `host.extensions.trust.empty-composition`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **WHEN** a host activates an actor-independent Runtime Preset with an empty Host Extension Composition
- **THEN** the Runtime Session and shared Runtime Host bridge activate normally without synthetic host-specific services

### Requirement: Host Extensions reuse the Cordis composition lifecycle
The Host Extension Composition SHALL activate as the deterministic final protected Loader layer of one Runtime Session. Its plugins SHALL use ordinary Cordis injection, isolation, effects, Fibers, diagnostics, and disposal; every enabled entry SHALL settle and pass the same activation audit before the Runtime Session is returned. Activation failure SHALL exhaust all reachable authored and protected resources before rejecting.

#### Scenario: Host Extensions depend on one another
- **ID**: `host.extensions.activation.injection-order`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::settles dependent host extensions through the protected Loader tree`
- **WHEN** one Host Extension provides a typed session fact and another injects it to provide a higher-level protocol
- **THEN** Cordis dependency settlement activates them in the declared composition without host-adapter manual ordering or service lookup

#### Scenario: Host Extension activation fails
- **ID**: `host.extensions.activation.failure-cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::exhausts protected and authored cleanup when a host extension fails`
- **WHEN** a Host Extension throws, remains unresolved, or fails the activation audit after another extension acquired resources
- **THEN** activation returns no Runtime Session and disposes every reachable Host Extension, bridge, authored plugin, watch, and session resource

### Requirement: Native host authority is projected as narrow typed session facts
A host adapter MAY provide closed, immutable, host-namespaced session fact services to its Host Extension Composition. Each fact contract SHALL contain only values required by explicitly supported extensions, SHALL be scoped to one Runtime Session, and SHALL be snapshotted before protected activation. It SHALL NOT expose a raw native runtime, unrestricted hook or event registry, credential store, model provider, UI object, mutable adapter state, or authority to create another host channel.

#### Scenario: OpenClaw Actor extension resolves a principal
- **ID**: `host.extensions.facts.openclaw-actor-resolution`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::keeps sessions without an exact trusted tuple unbound`
- **WHEN** the OpenClaw Actor Host Extension receives exact native agent, route, session-generation, workspace, and trusted mapping configuration
- **THEN** it provides the existing frozen bound or unbound Actor Identity without receiving OpenClaw registries or runtime objects

#### Scenario: Extension requests an undeclared native capability
- **ID**: `host.extensions.facts.raw-host-denied`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::provides factories only frozen closed session facts without host transport authority`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::exhausts protected and authored cleanup when a host extension fails`
- **WHEN** a Host Extension requires a raw host service or native capability not exposed by its typed host package contract
- **THEN** injection remains unresolved and audited activation fails visibly rather than granting ambient host access

### Requirement: Host Extension configuration is immutable for one Runtime Session
The selected Host Extension Composition, plugin module identities, configuration, native fact snapshot, and provided identity state SHALL remain fixed for the lifetime of one Runtime Session. Runtime Preset reload SHALL rebuild only caller-controlled composition generations beneath the existing protected Host Extension Composition. A Host Extension composition, configuration, actor, tenant, account, or native binding change SHALL require retirement and replacement of the Runtime Session.

#### Scenario: Actor mapping changes during Runtime Preset reload
- **ID**: `host.extensions.lifecycle.identity-not-hot-reloaded`
- **EVIDENCE**: `packages/host-openclaw/tests/reload.spec.ts::preserves audited rollback and rejects stale native closures`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::retires prior closures when a route rotates workspace or session identity`
- **WHEN** deployment actor mapping changes while an OpenClaw Runtime Session remains active and its Runtime Preset reloads
- **THEN** the active Actor Identity does not mutate and the new mapping becomes observable only after the adapter creates a replacement Runtime Session

#### Scenario: Runtime Session is replaced
- **ID**: `host.extensions.lifecycle.session-replacement`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** the owning native session, trusted fact snapshot, or Host Extension Composition changes
- **THEN** the adapter fences the old binding, disposes its complete Host Extension Composition, and activates a fresh protected composition for the replacement

### Requirement: Host Extensions reuse exactly one adapter binding and transport
Every Host Extension SHALL reuse the owning adapter's existing in-process binding or existing versioned transport, request router, and process lifecycle. The composition SHALL NOT create another Runtime Host bridge, child process, RPC connection, socket, sidecar, request router, session-binding path, or native registry mutation channel. Host-specific transported messages SHALL be typed, bounded, validated, and correlated to the owning Runtime Session.

#### Scenario: OMP native event extension crosses the child boundary
- **ID**: `host.extensions.transport.omp-native-event`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** an OMP Host Extension consumes a supported native event inside the runtime child
- **THEN** `host-omp` routes the event over its existing framed peer and the extension opens no additional channel

#### Scenario: Extension attempts a private host connection
- **ID**: `host.extensions.transport.private-channel-rejected`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::provides factories only frozen closed session facts without host transport authority`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** a proposed Host Extension requires an independent connection to the same native host
- **THEN** the integration is rejected in favor of extending the adapter-owned binding or adding one explicit typed message to its existing transport

### Requirement: Host adapters expose an extension composition seam without feature coupling
Each supported adapter SHALL provide exact module inputs to the shared Host Extension control plane, create one immutable deployment plan, and instantiate its shared bridge, typed session facts, narrow capability providers, and selected Host Extensions through one Host Extension Composition interface per Runtime Session. The adapter core SHALL NOT import Memory, Evolution, Persona, MCP, Dynamic Runtime Plugins, or another feature consumer, and an extension that provides a new typed protocol SHALL remain optional. Adding an installed definition SHALL require only operator installation/configuration plus adapter-compatible definition validation, not a shared Runtime Host capability or protocol-version change unless its semantics are deliberately promoted into the common API.

#### Scenario: New account protocol is added for one host
- **ID**: `host.extensions.extensibility.new-account-provider`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** one adapter adds a trusted account or tenant extension consumed by an optional Doppelganger plugin
- **THEN** the new provider composes beside Actor Identity and the shared bridge without adding fields to either contract or changing unrelated adapters

#### Scenario: Adapter conformance runs with extensions
- **ID**: `host.extensions.conformance.cross-adapter`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::keeps Actor Identity absent, unbound, and bound through the real OMP adapter`
- **EVIDENCE**: `packages/host-openclaw/tests/runtime-host-conformance.spec.ts::passes common semantics through the real fixed-catalog OpenClaw adapter`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** OMP and OpenClaw run shared conformance with empty, unbound, bound, and host-specific extension compositions
- **THEN** bridge semantics remain identical while each adapter proves session isolation, extension disposal, and stale-callback fencing through its real entrypoints
