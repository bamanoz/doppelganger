## MODIFIED Requirements

### Requirement: OMP adapter is composition-neutral
The generic OMP adapter SHALL accept and validate its serialized Runtime Preset activation request and separate trusted Host Extension configuration. At adapter startup it SHALL import the operator's exact Host Extension module specifiers, build one immutable OMP definition catalog, resolve the ordered selection into a frozen plan, and reject incompatible deployment configuration before creating a child Runtime Session. For each binding it SHALL reuse Composition Runtime canonicalization for the authored composition and instantiate one fresh OMP Host Extension Composition in the child. OMP-only host kind, watch, transport, capability, admitted actor input, and native event bindings SHALL remain owned by `host-omp` and enter the Runtime Session only through closed OMP session facts and narrow protected capabilities. Runtime Presets and project manifests SHALL NOT add Host Extension modules or selections.

#### Scenario: Actor-aware Persona composition is activated
- **ID**: `host.omp.actor-aware-persona-composition-is-activated`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **WHEN** generic configuration selects an actor-aware Persona Runtime Preset for an OMP session
- **THEN** the adapter decodes the request, supplies the shared bridge plus trusted OMP Host Extension Composition, and starts the canonical authored composition without feature-specific selection logic

#### Scenario: Non-Persona composition is activated
- **ID**: `host.omp.non-persona-composition-is-activated`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **WHEN** configuration resolves another valid Runtime Preset with no actor-aware extensions
- **THEN** the same adapter activates it through the shared bridge and unified protected composition contract

### Requirement: OMP supplies actor identity outside Runtime Presets
The OMP extension SHALL accept an optional non-empty `actorId` host option, validate it before child activation, and transport the admitted value across the versioned parent/child activation boundary as an immutable OMP session fact. The trusted OMP Actor Host Extension SHALL consume that fact and provide the existing Actor Identity protocol: `bound` for a resolved identifier and explicit `unbound` otherwise. Runtime Presets, Persona configuration, project manifests, prompts, tools, and patches SHALL NOT install, configure, or replace that extension, and the shared Runtime Host API SHALL contain no `actorId`.

#### Scenario: Local OMP actor is configured
- **ID**: `host.omp.local-omp-actor-is-configured`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** an OMP session activates with a valid configured `actorId`
- **THEN** the child OMP Actor Host Extension exposes that exact frozen binding to actor-aware plugins for the Runtime Session lifetime

#### Scenario: OMP actor identifier is invalid
- **ID**: `host.omp.omp-actor-identifier-is-invalid`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the OMP extension receives an empty or non-string actor identifier
- **THEN** transport admission fails before a child Runtime Session or Actor Host Extension becomes active and ordinary OMP behavior remains usable

#### Scenario: OMP has no actor configuration
- **ID**: `host.omp.omp-has-no-actor-configuration`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::keeps Actor Identity absent, unbound, and bound through the real OMP adapter`
- **WHEN** OMP enables its Actor Host Extension without a resolved actor identifier
- **THEN** the provider exposes explicit `unbound`, actor-independent plugins remain usable, and the shared bridge remains unchanged

### Requirement: OMP host-specific providers use one protected Host Extension Composition
OMP MAY compose typed OMP-namespaced Cordis services or events beside its Actor Host Extension and shared bridge for native hooks with no proven common semantic equivalent. The OMP Host Extension Composition SHALL be session-isolated, dispose with the active binding, and reuse the existing OMP extension, per-session child, framed RPC peer, request router, and shutdown path. It SHALL NOT expose the raw OMP `ExtensionContext`, native registries, or unrestricted hook subscription API and SHALL NOT create another host channel.

#### Scenario: OMP-bound preset consumes a native hook
- **ID**: `host.omp.omp-bound-preset-consumes-a-native-hook`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** a Runtime Preset plugin explicitly requires a supported OMP-specific provider
- **THEN** the trusted OMP Host Extension Composition provides it as an isolated sibling and stale callbacks cannot publish after session rebinding

#### Scenario: OMP-specific provider crosses the child boundary
- **ID**: `host.omp.omp-specific-provider-crosses-the-child-boundary`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** a Host Extension must receive a native OMP hook inside the Runtime Session
- **THEN** `host-omp` adds a validated message to its existing framed protocol and retains sole routing and process ownership

#### Scenario: Provider attempts a private host channel
- **ID**: `host.omp.provider-attempts-a-private-host-channel`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::provides factories only frozen closed session facts without host transport authority`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** an OMP Host Extension proposes its own child, socket, or RPC connection to OMP
- **THEN** the integration is rejected in favor of the existing adapter transport
