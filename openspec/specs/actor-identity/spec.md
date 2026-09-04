# Actor Identity Specification

## Purpose

Defines host-authoritative, session-isolated actor identity for actor-aware extensions while keeping generic compositions usable without a binding.

## Requirements

### Requirement: Host-authoritative actor binding
When a compatible host supplies actor identity, it SHALL bind at most one validated actor identifier to a Runtime Session through a separate protected runtime-owned actor plugin. The binding SHALL be immutable for the lifetime of that Runtime Session and SHALL be exposed to extensions as a session-isolated `doppelgangerActor` service with a frozen discriminated value: `{ state: "bound", actorId }` or `{ state: "unbound" }`. The shared Runtime Host bridge, capability profile, requests, tool-catalog callback, context, tools, and lifecycle contracts SHALL NOT construct, require, contain, or infer that binding.

#### Scenario: Host starts a bound session
- **ID**: `actor.identity.host-starts-a-bound-session`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::isolates immutable actor bindings between concurrent sessions`
- **WHEN** a host activates a Runtime Session with a valid actor identifier and actor-aware plugins
- **THEN** it mounts a separate actor provider and every extension in that service's isolation realm observes the same frozen actor identity

#### Scenario: Two sessions use different actors
- **ID**: `actor.identity.two-sessions-use-different-actors`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::isolates immutable actor bindings between concurrent sessions`
- **WHEN** two concurrent Runtime Sessions are activated with different actor identifiers
- **THEN** each separate actor provider exposes only its own immutable identity and neither binding changes through composition reload

#### Scenario: Shared bridge activates without actor identity
- **ID**: `actor.identity.shared-bridge-activates-without-actor-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::validates and freezes bound and unbound identities`
- **WHEN** an actor-independent Runtime Preset activates through the common Runtime Host API
- **THEN** the bridge activates without receiving an actor identifier, creating an actor provider, or synthesizing actor state

### Requirement: Actor identity is outside authored Persona state
Runtime Presets, Persona configuration, project selection manifests, model context, and model-invocable tool input SHALL NOT select or override the authoritative actor binding. Supported hosts SHALL construct the binding outside caller-authored composition layers and SHALL require a new Runtime Session to change actors.

#### Scenario: Persona preset is reused by another actor
- **ID**: `actor.authorship.persona-independent`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::reuses unchanged Persona metadata across separate actor bindings`
- **WHEN** the same Persona Runtime Preset is activated in two sessions with different host actor bindings
- **THEN** the Persona definition remains identical while actor-aware extensions receive the respective host bindings

#### Scenario: Model invokes an actor-aware tool
- **ID**: `actor.authorship.tools-derived`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **WHEN** the model invokes a memory or other actor-aware tool
- **THEN** the tool derives actor identity from the session service and exposes no actor identifier or actor-switch field in its input

### Requirement: Actor binding is optional for generic composition
Actor Identity SHALL have three distinct observable states. If `doppelgangerActor` is absent, the host does not support or did not install the capability. If it is present with `{ state: "unbound" }`, the host supports the capability but has no resolved user. If it is present with `{ state: "bound", actorId }`, the host resolved one immutable user. Generic compositions SHALL remain valid in the first two states. An actor-aware persistent extension SHALL require the service and additionally require `bound`; it SHALL fail visibly for absent or unbound state and SHALL NOT create an implicit anonymous, default, Persona-authored, bridge-derived, or model-selected partition.

#### Scenario: Host does not install Actor Identity
- **ID**: `actor.identity.host-does-not-install-actor-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::validates and freezes bound and unbound identities`
- **WHEN** a compatible host activates an actor-independent Runtime Preset without mounting the provider
- **THEN** `doppelgangerActor` is absent and the Runtime Session plus shared bridge activate normally without synthetic actor state

#### Scenario: Host supports Actor Identity without a resolved user
- **ID**: `actor.identity.host-supports-actor-identity-without-a-resolved-user`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::validates and freezes bound and unbound identities`
- **WHEN** an adapter such as OMP mounts its independent actor provider without an `actorId`
- **THEN** consumers observe explicit `unbound` state and can distinguish it from an unsupported or omitted provider

#### Scenario: Host resolves one user
- **ID**: `actor.identity.host-resolves-one-user`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::validates and freezes bound and unbound identities`
- **WHEN** the provider receives a valid host-authoritative actor identifier
- **THEN** consumers observe immutable `bound` state for the lifetime of that Runtime Session

#### Scenario: Persistent memory has no bound actor
- **ID**: `actor.identity.persistent-memory-has-no-bound-actor`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::validates and freezes bound and unbound identities`
- **WHEN** a Runtime Preset includes persistent memory but the separate actor service is unbound or unavailable
- **THEN** audited activation fails with an actor-identity diagnostic before memory tools or recall become available

#### Scenario: Empty preset has no actor binding
- **ID**: `actor.binding.unbound-generic`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** a compatible host activates an empty or actor-independent Runtime Preset without an actor identifier
- **THEN** the Runtime Session activates with explicit unbound actor state

#### Scenario: Persistent memory has no actor binding
- **ID**: `actor.binding.required-memory`
- **EVIDENCE**: `packages/extension-memory/tests/memory-mutations.spec.ts::rejects an unbound actor before opening canonical storage`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::fails memory activation before canonical storage opens when the host actor is unbound`
- **WHEN** a Runtime Preset includes persistent memory but the actor service is unbound or unavailable
- **THEN** audited activation fails with an actor-identity diagnostic before memory tools or recall become available
