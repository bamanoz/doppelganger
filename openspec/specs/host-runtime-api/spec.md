# Runtime Host API Specification

## Purpose

Defines the transport-independent adapter-facing Runtime Host bridge, closed capability profile, correlated context and tool operations, lifecycle publication, conformance obligations, and protected host-specific extension boundary.

## Requirements

### Requirement: One Runtime Host bridge per Runtime Session
The system SHALL create at most one shared Runtime Host bridge for one activated Runtime Session. The bridge SHALL resolve only services in that session's isolated Cordis realms and SHALL NOT route operations to another session by mutable global state or caller-supplied session identity.

#### Scenario: Two host sessions activate the same preset
- **ID**: `host.runtime.api.two-host-sessions-activate-the-same-preset`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** two native host sessions activate the same Runtime Preset concurrently
- **THEN** each receives a distinct bridge whose context, tools, active calls, lifecycle publication, tool-catalog callback, and disposal are isolated from the other

#### Scenario: A second bridge attaches before detach
- **ID**: `host.runtime.api.a-second-bridge-attaches-before-detach`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** a binding already owns an attached bridge and another bridge attempts to attach
- **THEN** activation fails visibly instead of replacing the live bridge or sharing its state

### Requirement: Immutable semantic capability profile
The bridge SHALL expose a frozen versioned closed capability profile containing exactly context delivery, tool delivery, required-approval enforcement, tool cancellation, and faithfully supported standard lifecycle event kinds. Runtime Host protocol version 2 context delivery SHALL distinguish `none`, `session-start`, `per-turn`, and `per-request`. Every field SHALL be required, unknown keys and arbitrary string capabilities SHALL be rejected at construction and transport boundaries, and a new common dimension SHALL require a protocol-version change.

#### Scenario: Host supports per-turn context
- **ID**: `host.runtime.api.host-supports-per-turn-context`
- **EVIDENCE**: `packages/extension-protocols/tests/host-capabilities.spec.ts::validates, deeply freezes, and provides the closed session capability value`
- **WHEN** an adapter resolves context once for each direct user turn and reuses it for tool-driven model continuations
- **THEN** it advertises per-turn delivery and does not claim per-request refresh within that turn

#### Scenario: Plugin requires unavailable fidelity
- **ID**: `host.runtime.api.plugin-requires-unavailable-fidelity`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** a Runtime Preset plugin requires a capability or delivery level absent from the immutable profile
- **THEN** Cordis injection or the plugin's explicit capability check leaves that behavior inactive or fails activation visibly according to the plugin's declared requirement

#### Scenario: Adapter supplies an unknown capability field
- **ID**: `host.runtime.api.adapter-supplies-an-unknown-capability-field`
- **EVIDENCE**: `packages/extension-protocols/tests/host-capabilities.spec.ts::rejects unknown, missing, malformed, duplicate, and unsupported version fields`
- **WHEN** a local or transported adapter constructs a profile containing `features`, `extensions`, a host-native hook name, or any other undeclared key
- **THEN** validation rejects the profile before bridge attachment

### Requirement: Actor identity remains outside the Runtime Host API
The shared Runtime Host bridge, binding, capability profile, requests, tool-catalog callback, and lifecycle contracts SHALL contain no `actorId` and SHALL NOT install or infer actor identity. Actor Identity has three distinct observable states: absence of `doppelgangerActor` means unsupported or not installed; `{ state: "unbound" }` means the independent provider is installed without a resolved user; `{ state: "bound", actorId }` means one immutable resolved user. Persona activation SHALL NOT own or derive that binding.

#### Scenario: Actor-independent preset activates
- **ID**: `host.runtime.api.actor-independent-preset-activates`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** a Runtime Preset uses context, tools, or lifecycle but no actor-aware plugin
- **THEN** the shared bridge activates without an actor provider or synthetic actor identity

#### Scenario: Actor-aware plugin is selected
- **ID**: `host.runtime.api.actor-aware-plugin-is-selected`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** a selected plugin explicitly requires `doppelgangerActor` and the host has a stable principal identity
- **THEN** the adapter mounts a separate actor provider whose isolated service is available to that plugin without changing the Runtime Host API

#### Scenario: Host supports Actor Identity without a resolved user
- **ID**: `host.runtime.api.host-supports-actor-identity-without-a-resolved-user`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** an adapter implements Actor Identity but has no configured or authenticated user
- **THEN** it mounts the separate provider in explicit `unbound` state while the shared Runtime Host API remains unchanged

### Requirement: Correlated context resolution
Each context request SHALL carry a non-empty adapter-minted request identity, current principal input, optional stable turn identity, and non-negative token budget. The bridge SHALL return authority-separated assembled context with deterministic accepted and omitted provenance and SHALL NOT receive or mutate native prompt, message, or provider objects.

#### Scenario: Host resolves every model request
- **ID**: `host.runtime.api.host-resolves-every-model-request`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::returns authority-separated context through the shared bridge`
- **WHEN** a host advertising per-request context performs multiple model requests in one turn
- **THEN** each request has its own request ID and receives the current authority-preserving assembly under the supplied turn identity and budget

#### Scenario: Context protocol is absent
- **ID**: `host.runtime.api.context-protocol-is-absent`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** the active Runtime Preset does not install the context protocol
- **THEN** the bridge returns the canonical empty assembly without inventing stale context

### Requirement: Revisioned immutable tool catalog
The bridge SHALL expose a deterministic immutable tool-catalog snapshot containing a catalog revision and descriptors ordered by canonical portable name. Each descriptor SHALL carry an opaque tool revision that changes whenever its callable definition, schema, availability, or approval metadata changes.

#### Scenario: Host projects a catalog snapshot
- **ID**: `host.runtime.api.host-projects-a-catalog-snapshot`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the adapter requests the current tool catalog
- **THEN** it receives one internally consistent revision and descriptors that remain immutable after later registry mutations

### Requirement: Exact correlated tool invocation
A tool invocation SHALL carry a non-empty call ID, optional turn ID, canonical name, exact projected tool revision, JSON-compatible input, and optional protected approval grant. The bridge SHALL invoke only the current matching descriptor and SHALL reject a stale or mismatched revision before calling any handler.

#### Scenario: Retained host closure invokes a replaced tool
- **ID**: `host.runtime.api.retained-host-closure-invokes-a-replaced-tool`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** a host closure captured an old descriptor and invokes it after the same canonical name was replaced
- **THEN** the bridge returns `TOOL_REVISION_STALE` and does not dispatch the new or old handler

### Requirement: Tool invocation context and cooperative cancellation
Every portable tool handler SHALL receive a frozen invocation context containing Runtime Session ID, call ID, optional turn ID, and an `AbortSignal`. The bridge SHALL own one active call record and `AbortController` per invocation and SHALL expose idempotent cancellation by call ID.

#### Scenario: Host cancels an active tool
- **ID**: `host.runtime.api.host-cancels-an-active-tool`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** an adapter that advertised cancellation cancels an active call
- **THEN** the matching signal aborts once, unrelated calls remain active, and the final structured result reflects the handler's observed outcome without fabricating success

#### Scenario: Host has no cancellation channel
- **ID**: `host.runtime.api.host-has-no-cancellation-channel`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** an adapter advertised no cancellation support
- **THEN** the handler still receives a valid never-aborted signal and no portable plugin needs a host-specific invocation signature

### Requirement: Required approval is revalidated inside the bridge
For a descriptor with `approval.policy: "required"`, the bridge SHALL require a protected one-shot grant bound to the exact call ID, tool revision, and canonical digest of the cloned input. A grant ID SHALL be consumable at most once within the Runtime Session. Hosts SHALL retain ownership of presentation, user interaction, and stricter native policy.

#### Scenario: Adapter supplies a matching grant
- **ID**: `host.runtime.api.adapter-supplies-a-matching-grant`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** the native host obtains one explicit user grant for the exact projected call and supplies its protected grant
- **THEN** the bridge consumes that grant and invokes the current handler once

#### Scenario: Grant is absent, stale, altered, or reused
- **ID**: `host.runtime.api.grant-is-absent-stale-altered-or-reused`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** a required invocation has no grant or its call ID, tool revision, input digest, or grant ID does not match
- **THEN** the bridge fails closed before handler invocation with a structured approval error

### Requirement: Declared lifecycle availability
The bridge SHALL accept only normalized lifecycle event kinds listed in its immutable capability profile. Publication SHALL retain existing versioning, stable identities, bounded JSON-compatible payloads, deep freezing, deterministic delivery identity, and subscriber-failure containment.

#### Scenario: Host lacks a committed-turn boundary
- **ID**: `host.runtime.api.host-lacks-a-committed-turn-boundary`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** an adapter cannot faithfully identify a committed assistant turn
- **THEN** it omits `turn-committed` from its profile and never synthesizes that event from a merely similar idle or stop hook

#### Scenario: Adapter publishes an undeclared event kind
- **ID**: `host.runtime.api.adapter-publishes-an-undeclared-event-kind`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** an adapter attempts to publish a lifecycle event not listed in its profile
- **THEN** the bridge rejects it diagnostically before any portable subscriber observes it

### Requirement: Tool catalog change uses one explicit callback
The Runtime Host binding SHALL expose exactly one runtime-to-host change callback, `toolCatalogChanged(revision)`. The shared API SHALL NOT define a generic notification envelope, arbitrary notification type string, mutable registry payload, or native host callback. The adapter SHALL compare the supplied revision with its committed projection before refreshing the immutable snapshot.

#### Scenario: Catalog callback is delayed across reload
- **ID**: `host.runtime.api.catalog-callback-is-delayed-across-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** `toolCatalogChanged` for an older revision arrives after a newer revision is already projected
- **THEN** the adapter ignores the stale revision and cannot restore removed or replaced native tools

#### Scenario: Another runtime-to-host signal is proposed
- **ID**: `host.runtime.api.another-runtime-to-host-signal-is-proposed`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** an implementation needs a second unrelated outbound signal
- **THEN** it remains outside the shared API until an explicit versioned contract is designed instead of being sent through a generic notification channel

### Requirement: Protected host-specific extensions
A host adapter MAY install additional runtime-owned Cordis plugins that provide explicitly typed host-namespaced services or events. These extensions SHALL be isolated to the owning Runtime Session, use Cordis effects for registration and cleanup, validate transported values, and reuse the one adapter-owned in-process binding or existing transport, router, and process lifecycle. They SHALL NOT expose a raw native host runtime, unrestricted event bus, credential store, or registry, and SHALL NOT create a second host RPC connection, socket, sidecar, request router, or session-binding path. External service connections owned by ordinary Runtime Preset plugins such as MCP are not host-adapter channels and remain separately scoped.

#### Scenario: OMP supplies a native-only todo hook
- **ID**: `host.runtime.api.omp-supplies-a-native-only-todo-hook`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** OMP has a `todo_completed` hook with no proven portable equivalent
- **THEN** the OMP adapter may publish a typed `doppelganger/host/omp/todo-completed` event for explicitly OMP-bound plugins without adding it to the common lifecycle union

#### Scenario: Host-bound preset runs on another host
- **ID**: `host.runtime.api.host-bound-preset-runs-on-another-host`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** a Runtime Preset plugin requires an OMP-specific service and the selected host does not provide it
- **THEN** that plugin fails activation visibly rather than receiving an approximate service with different semantics

#### Scenario: Host-specific provider needs transported events
- **ID**: `host.runtime.api.host-specific-provider-needs-transported-events`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** an OMP-specific provider must receive a native hook in the runtime child
- **THEN** `host-omp` validates and routes it over the existing per-session framed RPC rather than allowing the provider to open another connection

### Requirement: Every adapter passes common conformance
Before a host adapter is supported, it SHALL pass the same transport-independent conformance suite for two-session isolation, empty context and tools, closed capability validation, atomic catalog replacement, stale tool revision, approval replay, cancellation/completion races, undeclared lifecycle rejection, independence of the Actor Identity states supported by that adapter, disposal during active calls, and late callbacks after binding replacement.
True Actor Identity provider absence SHALL remain independently verified at the common protocol boundary. OMP SHALL verify explicit unbound and bound states through its real transport because every OMP activation installs the provider; this SHALL NOT introduce a production absence switch or substitute a direct bridge for OMP evidence.
A transported adapter SHALL satisfy those cases through its actual adapter entrypoints, request/response mapping and owned transport; substituting a direct underlying bridge SHALL not constitute adapter conformance. Fixture controls SHALL remain outside production contracts and SHALL wait for observable completion rather than fixed sleeps. Direct bridge semantics remain independently covered without being labelled transported-adapter proof.

#### Scenario: New direct adapter claims support
- **ID**: `host.runtime.api.new-direct-adapter-claims-support`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** a direct in-process adapter implements the shared Runtime Host API
- **THEN** it passes the same observable scenarios as a transported adapter with explicit protocol-level evidence for provider absence and real transported evidence for every state the transported adapter supports

#### Scenario: Transported catalog is replaced during use
- **ID**: `host.runtime.api.conformance.transported-catalog`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::preserves catalog and stale-revision semantics through the real OMP adapter`
- **WHEN** the common conformance fixture replaces a tool set through the actual OMP child and catalog path
- **THEN** the adapter exposes the current atomic snapshot and rejects retained stale descriptors through the real invocation mapping

#### Scenario: Transported approval grant is replayed
- **ID**: `host.runtime.api.conformance.transported-approval`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::enforces one-shot approval through the real OMP adapter`
- **WHEN** the common conformance fixture repeats a protected grant through the actual OMP invocation path
- **THEN** exactly the authorized first invocation reaches the handler and the replay fails through the transported result contract

#### Scenario: Transported active call is cancelled and disposed
- **ID**: `host.runtime.api.conformance.transported-call-lifecycle`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::settles cancellation and disposal through the real OMP adapter`
- **WHEN** the common conformance fixture cancels or disposes a held active call through the actual OMP adapter
- **THEN** the call settles with the correct correlated cancellation or disposal outcome and late completion cannot reattach its retired binding

### Requirement: Common capability promotion requires two-host semantic proof
A host-specific service or event SHALL enter the versioned common Runtime Host API only after at least two implemented host adapters demonstrate equivalent timing and commit boundary, operation ownership and authority, applicable correlation identities, success/failure/partial/cancellation/retry/replay semantics, ordering and stale-callback behavior, and resource rollback and disposal. Similar native names, approximately matching payloads, or a speculative future adapter SHALL be insufficient.

#### Scenario: Two hooks share a similar name
- **ID**: `host.runtime.api.two-hooks-share-a-similar-name`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** two hosts expose hooks named `todo_completed` but differ in commit timing, retry, or cancellation behavior
- **THEN** they remain separate typed host-specific events

#### Scenario: Proven host-specific event is promoted
- **ID**: `host.runtime.api.proven-host-specific-event-is-promoted`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** two implemented adapters and conformance fixtures demonstrate the complete equivalent semantic contract
- **THEN** promotion updates the protocol version, common types, both adapters, conformance suite, owning documentation, and active OpenSpec requirements in one change

### Requirement: Exhaustive bridge detachment and call cleanup
Bridge detachment SHALL be idempotent, prevent new requests, abort active calls, dispose runtime-owned subscriptions and tool-catalog callback effects, and await all reachable cleanup before the Runtime Session is considered quiescent. A stale binding SHALL NOT attach again or publish into a successor session.

#### Scenario: Session disposal races with tool invocation
- **ID**: `host.runtime.api.session-disposal-races-with-tool-invocation`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** Runtime Session disposal begins while portable tool calls are active
- **THEN** new calls fail unavailable, active signals abort, cleanup attempts every owned resource, and no late result mutates a successor binding

### Requirement: Context resolution preserves authority for adapters
The Runtime Host bridge SHALL return immutable context projections that keep instruction-authority and data-authority content separate under one deterministic ordering and token budget. An adapter SHALL NOT need to parse delimiters or infer authority from flattened text.

#### Scenario: Runtime resolves mixed-authority context
- **ID**: `host.runtime.api.context-resolution-preserves-authority`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::returns authority-separated context through the shared bridge`
- **WHEN** active providers contribute both instructions and untrusted data
- **THEN** the bridge exposes each accepted contribution and authority-specific rendered content without promoting data into instructions

### Requirement: Owner removal terminates removed tool implementations
The shared bridge SHALL preserve the tool registry's owner-scoped call lifecycle. When an owned tool definition is removed or revised, calls executing that exact removed implementation SHALL be aborted and SHALL NOT return a successful result as though the definition remained current.

#### Scenario: Plugin reload removes an active handler
- **ID**: `host.runtime.api.reload-removes-active-handler`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::retains active calls only for unchanged definitions during owner replacement`
- **WHEN** a valid plugin reload removes a tool while one call is active
- **THEN** the call settles with the specified unavailable or cancelled result, the new catalog excludes the tool, and later stale closures cannot dispatch it

### Requirement: Tool set changes atomically
A valid owned-set replacement SHALL commit one complete immutable catalog revision. Notification failure SHALL not roll back or reject the committed mutation, and calls owned by definitions removed or revised by that replacement SHALL follow owner-scoped cancellation semantics. The bridge SHALL call `toolCatalogChanged` exactly once after the complete new set becomes current, and no observer SHALL see a partially replaced set.

#### Scenario: Tool set changes atomically
- **ID**: `host.runtime.api.tool-set-changes-atomically`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::contains catalog observer failure after an atomic commit`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::replaces complete owner sets atomically and preserves the old set on validation failure`
- **WHEN** a plugin commits a valid owned-set replacement and an observer fails
- **THEN** the new set remains current, the mutation succeeds, independent observers may continue, and removed active implementations cannot report successful current completion

