# Actor Identity Specification

## Purpose

Defines host-authoritative, session-isolated actor identity for actor-aware extensions while keeping generic compositions usable without a binding.

## Requirements

### Requirement: Host-authoritative actor binding
A compatible host SHALL bind at most one validated actor identifier to a Runtime Session through the protected runtime-side host bridge. The binding SHALL be immutable for the lifetime of that Runtime Session and SHALL be exposed to extensions as a session-isolated `doppelgangerActor` service with a frozen discriminated value: `{ state: 'bound', actorId }` or `{ state: 'unbound' }`.

#### Scenario: Host starts a bound session
- **ID**: `actor.binding.bound-session`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::validates and freezes bound and unbound identities`
- **WHEN** a host activates a Runtime Session with a valid actor identifier
- **THEN** every extension in that session's actor-service isolation realm observes the same frozen actor identity

#### Scenario: Two sessions use different actors
- **ID**: `actor.binding.session-isolation`
- **EVIDENCE**: `packages/extension-protocols/tests/actor.spec.ts::isolates immutable actor bindings between concurrent sessions`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** two concurrent Runtime Sessions are activated with different actor identifiers
- **THEN** each session resolves only its own actor identity and neither binding changes through composition reload

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
Absence of a bound actor SHALL remain valid for arbitrary compositions that do not require actor-aware durable state. A compatible host bridge SHALL expose explicit unbound state rather than inventing an identifier. An actor-aware persistent extension SHALL require a bound actor and SHALL fail activation visibly when the service is unbound or unavailable; it SHALL NOT create an implicit anonymous, default, Persona-authored, or model-selected partition.

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
