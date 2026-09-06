# Actor Identity Specification

## Purpose

Defines host-authoritative, session-isolated actor identity for actor-aware extensions while keeping generic compositions usable without a binding.

## Requirements

### Requirement: Host-authoritative actor binding
When a compatible host supplies Actor Identity, its trusted Host Extension Composition SHALL bind at most one validated actor identifier to a Runtime Session through an independent Actor Identity extension. Host-specific resolution SHALL consume only closed immutable host-session facts and deployment-owned configuration; it SHALL remain outside the core adapter, Runtime Preset, Runtime Patches, Persona state, model context, and tool input. The resulting binding SHALL be immutable for the Runtime Session lifetime and exposed as a session-isolated `doppelgangerActor` service with a frozen discriminated value: `{ state: "bound", actorId }` or `{ state: "unbound" }`. The shared Runtime Host bridge and capability profile SHALL contain no actor fields.

#### Scenario: Host starts a bound session
- **ID**: `actor.identity.host-starts-a-bound-session`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** a trusted Actor Host Extension resolves a valid identifier for one native session and an actor-aware plugin is composed
- **THEN** it provides one frozen actor binding and every consumer in that service's isolation realm observes the same value

#### Scenario: Two hosts use different resolution extensions
- **ID**: `actor.identity.host-specific-resolution-extensions`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **WHEN** OMP resolves an admitted activation actor and OpenClaw resolves an exact native route mapping
- **THEN** both Host Extensions provide the same Actor Identity interface while neither resolution policy enters the common bridge or feature plugins

#### Scenario: Two sessions use different actors
- **ID**: `actor.identity.two-sessions-use-different-actors`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** two concurrent Runtime Sessions activate Host Extension Compositions that resolve different actors
- **THEN** each session exposes only its own immutable identity and neither binding changes through Runtime Preset reload

#### Scenario: Shared bridge activates without Actor Identity
- **ID**: `actor.identity.shared-bridge-activates-without-actor-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** an actor-independent Runtime Preset activates with a Host Extension Composition that omits the Actor Identity extension
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
Actor Identity SHALL retain three distinct observable states. If `doppelgangerActor` is absent, the Host Extension Composition did not install the capability. If present with `{ state: "unbound" }`, the installed extension supports Actor Identity but resolved no user. If present with `{ state: "bound", actorId }`, the extension resolved one immutable user. Generic compositions SHALL remain valid in the first two states. An actor-aware persistent extension SHALL require the service and additionally require `bound`; it SHALL fail visibly for absent or unbound state and SHALL NOT create an implicit anonymous, default, Persona-authored, bridge-derived, model-selected, or adapter-global partition.

#### Scenario: Host omits the Actor Identity extension
- **ID**: `actor.identity.host-does-not-install-actor-identity`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** a compatible host activates an actor-independent Runtime Preset without the Actor Identity Host Extension
- **THEN** `doppelgangerActor` is absent and the Runtime Session plus shared bridge activate normally

#### Scenario: Host installs Actor Identity without a resolved user
- **ID**: `actor.identity.host-supports-actor-identity-without-a-resolved-user`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** the trusted Host Extension Composition installs Actor Identity in explicit unbound mode
- **THEN** consumers distinguish it from both an omitted provider and a bound user

#### Scenario: Persistent memory has no bound actor
- **ID**: `actor.identity.persistent-memory-has-no-bound-actor`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::fails memory activation before canonical storage opens when the host actor is unbound`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::fails memory activation before canonical storage opens when Actor Identity is omitted`
- **WHEN** a Runtime Preset includes persistent memory but the Actor Identity Host Extension is absent or unbound
- **THEN** audited activation fails with an actor-identity diagnostic before memory tools or canonical storage become available
