## MODIFIED Requirements

### Requirement: Protected host-specific extensions
A host adapter MAY activate one separate trusted Host Extension Composition beside the actor-neutral shared Runtime Host bridge. The composition MAY provide explicitly typed host-namespaced services or events from closed immutable session facts and SHALL use the ordinary Cordis Loader, injection, isolation, effect, audit, and disposal model inside the owning Runtime Session. Host Extension selection and configuration SHALL remain host/deployment-owned and unavailable to Runtime Presets and patches. Extensions SHALL validate transported values and reuse the one adapter-owned in-process binding or existing transport, router, and process lifecycle. They SHALL NOT expose a raw native host runtime, unrestricted event bus, credential store, UI, provider, registry, or authority channel, and SHALL NOT create a second bridge, RPC connection, socket, sidecar, request router, or session-binding path. External connections owned by ordinary Runtime Preset plugins such as MCP remain separate and are not host-adapter channels.

#### Scenario: OMP supplies a native-only todo hook through its Host Extension Composition
- **ID**: `host.runtime.api.omp-supplies-a-native-only-todo-hook`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** OMP has a `todo_completed` hook with no proven portable equivalent and its trusted Host Extension Composition enables the OMP event provider
- **THEN** the provider publishes the typed OMP-namespaced event through the existing session transport without adding it to the common lifecycle union

#### Scenario: Host-bound preset runs without its Host Extension
- **ID**: `host.runtime.api.host-bound-preset-runs-on-another-host`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **WHEN** a Runtime Preset plugin requires a typed host-specific service and the active Host Extension Composition does not provide it
- **THEN** activation fails visibly rather than receiving an approximate service with different semantics

#### Scenario: Host-specific provider needs transported events
- **ID**: `host.runtime.api.host-specific-provider-needs-transported-events`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::routes validated OMP todo reminders through the child runtime plugin`
- **WHEN** an OMP Host Extension must receive a native hook inside the runtime child
- **THEN** `host-omp` validates and routes it over the existing per-session framed RPC and the extension owns only its Cordis subscription and cleanup

#### Scenario: OpenClaw extension resolves identity from native facts
- **ID**: `host.runtime.api.openclaw-extension-resolves-identity`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **WHEN** the OpenClaw Actor extension consumes its closed session fact service
- **THEN** the extension can provide Actor Identity without the shared bridge gaining actor fields or the core adapter importing an actor-aware feature consumer

### Requirement: Actor identity remains outside the Runtime Host API
The shared Runtime Host bridge, binding, capability profile, requests, tool-catalog callback, and lifecycle contracts SHALL contain no `actorId` and SHALL NOT install, configure, or infer Actor Identity. Actor Identity has three distinct observable states: absence of `doppelgangerActor` means the Host Extension Composition omitted the provider; `{ state: "unbound" }` means the independent Host Extension is installed without a resolved user; `{ state: "bound", actorId }` means the extension resolved one immutable host-authoritative user from trusted session facts and configuration. Persona activation SHALL NOT own or derive that binding.

#### Scenario: Actor-independent preset activates
- **ID**: `host.runtime.api.actor-independent-preset-activates`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** a Runtime Preset uses context, tools, or lifecycle but its Host Extension Composition omits Actor Identity
- **THEN** the shared bridge activates without an actor provider or synthetic actor state

#### Scenario: Actor-aware plugin is selected
- **ID**: `host.runtime.api.actor-aware-plugin-is-selected`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **WHEN** a selected plugin explicitly requires `doppelgangerActor` and the trusted Actor Host Extension resolves a stable principal
- **THEN** that extension provides the isolated actor service without changing the Runtime Host API

#### Scenario: Host supports Actor Identity without a resolved user
- **ID**: `host.runtime.api.host-supports-actor-identity-without-a-resolved-user`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::keeps Actor Identity absent, unbound, and bound through the real OMP adapter`
- **WHEN** the Host Extension Composition installs Actor Identity but its trusted resolution produces no user
- **THEN** consumers observe explicit `unbound` state while the shared Runtime Host API remains unchanged
