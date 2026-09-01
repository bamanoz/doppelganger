## ADDED Requirements

### Requirement: OMP supplies actor identity outside Runtime Presets
The OMP extension SHALL accept an optional non-empty `actorId` host option, validate it before child activation, transport it across the versioned parent/child activation boundary, and provide it through the protected runtime-side actor service. Runtime Preset files, project manifests, patches, context, and tools SHALL NOT select or override that identifier.

#### Scenario: Local OMP actor is configured
- **ID**: `omp.actor.bound-session`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** an OMP session activates a Runtime Preset with a valid configured `actorId`
- **THEN** the child runtime exposes that exact immutable actor binding to actor-aware extensions for the lifetime of the session

#### Scenario: OMP actor identifier is invalid
- **ID**: `omp.actor.invalid-config`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rejects invalid actor configuration before starting a child`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the OMP extension receives an empty or non-string actor identifier
- **THEN** activation fails visibly before a child Runtime Session becomes active and ordinary OMP behavior remains usable

#### Scenario: OMP has no actor configuration
- **ID**: `omp.actor.unbound-generic`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** OMP activates an actor-independent Runtime Preset without `actorId`
- **THEN** the generic runtime remains usable with an explicit unbound actor service

### Requirement: OMP actor binding is not model-controlled
The OMP adapter SHALL NOT project actor selection, actor switching, or raw actor identifiers as model-invocable tools. Changing the configured actor SHALL require disposal and activation of a new Runtime Session.

#### Scenario: Memory tools are projected
- **ID**: `omp.actor.tool-neutrality`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** an actor-bound memory Runtime Preset activates successfully
- **THEN** projected memory schemas contain no `actorId` field and every invocation uses the session binding

#### Scenario: Runtime composition reloads
- **ID**: `omp.actor.reload-stability`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** a valid Runtime Preset or patch reload commits during an active OMP session
- **THEN** the actor binding remains unchanged even if authored configuration attempts to add an actor-like field

## MODIFIED Requirements

### Requirement: Adapter transport exposes the host-neutral runtime surface
The OMP transport SHALL support composition activation with an optional host actor binding, disposal, context resolution, tool listing and invocation, lifecycle publication, and runtime notifications over framed request/response messages. Both endpoints SHALL validate the same actor-aware activation contract and reject malformed, version-mismatched, or out-of-state requests without corrupting the session.

#### Scenario: Context is requested before activation
- **ID**: `transport.context.inactive.error`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the extension requests context before a runtime session is active
- **THEN** the request fails with a transport-visible state error and OMP proceeds without Doppelganger context

#### Scenario: Runtime composition changes
- **ID**: `runtime.reload.projection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition reload changes context or tools
- **THEN** the child notifies the OMP extension and the next turn observes the current context and tool set without changing the actor binding
