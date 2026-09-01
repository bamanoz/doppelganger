# Oh My Pi Host Specification

## Purpose

Defines the first concrete host integration, allowing Oh My Pi sessions to activate and use portable Doppelganger compositions without embedding the runtime into OMP.

## Requirements

### Requirement: Project manifest discovery
The OMP adapter SHALL search from the session working directory upward to the Git root for `.doppelganger/manifest.yaml` and SHALL use the nearest valid manifest as the project Runtime Preset selection layer.

#### Scenario: Nested working directory
- **ID**: `manifest.nearest.selection`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::discovers the nearest manifest without walking above the Git root`
- **WHEN** an OMP session starts in a subdirectory below a configured project root
- **THEN** the adapter selects the Runtime Preset named by the nearest project manifest

#### Scenario: No project manifest
- **ID**: `manifest.user.default.selection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::resolves explicit, project, and user selection and rejects unhealthy winners`
- **WHEN** no project manifest exists before the Git root
- **THEN** the adapter uses the configured user `defaultRuntimePreset` if one exists

### Requirement: Session-owned runtime process
The adapter SHALL start one Node runtime child for each OMP agent session with a selected Runtime Preset and SHALL communicate with it over framed JSON-RPC on stdio.

#### Scenario: OMP session starts
- **ID**: `runtime.session.child.ownership`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **WHEN** generic Runtime Preset activation is required for a new OMP agent session
- **THEN** the adapter starts a dedicated child, performs activation, and associates the child only with that session

#### Scenario: Concurrent OMP sessions
- **ID**: `runtime.session.concurrent.children`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::owns independent children for concurrent OMP sessions`
- **WHEN** two OMP agent sessions activate Runtime Presets concurrently
- **THEN** each session owns a different child process and protocol connection

### Requirement: Runtime context projection
Before each model turn, the adapter SHALL request current assembled context from the active generic runtime and append it without discarding the host's existing system instructions.

#### Scenario: Runtime context changes during session
- **ID**: `runtime.context.reload`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a valid composition or asset update reloads successfully
- **THEN** the next OMP model turn receives the current assembled context

### Requirement: Runtime tool projection
The adapter SHALL project active runtime tools into OMP and proxy invocations and results over the session connection without requiring Persona or memory extensions.

#### Scenario: Runtime tool is added or updated
- **ID**: `runtime.tool.reload.upsert`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** hot reload adds a tool or changes its definition
- **THEN** the OMP session exposes the new active definition without restarting the session

#### Scenario: Runtime tool is removed
- **ID**: `runtime.tool.reload.remove`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** hot reload removes a previously exposed tool
- **THEN** the adapter deactivates that tool for the remainder of the OMP session

### Requirement: Lifecycle event forwarding
The adapter SHALL forward normalized session, turn, and tool observation events to the runtime-side host plugin.

#### Scenario: OMP tool completes
- **ID**: `lifecycle.tool.completion.forwarding`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** an OMP tool invocation finishes
- **THEN** the runtime receives the normalized completion event associated with the active runtime session

### Requirement: Graceful shutdown
OMP session shutdown SHALL dispose the runtime session and terminate its child process without relying on a long-lived daemon.

#### Scenario: OMP session closes normally
- **ID**: `runtime.shutdown.graceful`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **WHEN** OMP emits session shutdown
- **THEN** the adapter requests runtime disposal, closes the protocol connection, and ensures the owned child exits

### Requirement: Runtime failure isolation
Runtime startup, activation, protocol, notification-observer, or projection failure SHALL be classified at its owning boundary. Fatal child/transport failures SHALL disable Doppelganger for the affected OMP session and SHALL NOT terminate OMP; contained observer failures SHALL leave the healthy transport active.

#### Scenario: Manifest is invalid
- **ID**: `manifest.invalid.nonblocking`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** a discovered project manifest cannot be validated
- **THEN** Runtime Preset activation is skipped and the adapter reports the exact configuration problem without blocking OMP

### Requirement: Notification observer failure is contained
Each framed JSON-RPC notification observer SHALL run as an independently contained observer. A rejected observer SHALL produce a bounded diagnostic without closing the peer, preventing sibling observers, or rejecting unrelated pending requests.

#### Scenario: One notification observer throws
- **ID**: `transport.notification.observer.failure.containment`
- **EVIDENCE**: `packages/host-omp/tests/protocol.spec.ts::contains rejecting notification observers and preserves later traffic`
- **EVIDENCE**: `packages/host-omp/tests/protocol.spec.ts::bounds notification observer diagnostics`
- **WHEN** a notification has one observer that rejects and another that succeeds
- **THEN** the successful observer completes, the rejection is reported diagnostically, and a subsequent request/response and notification cycle still succeeds

### Requirement: Host package exports are intentional
The `host-omp` package SHALL expose the ordinary extension/adapter consumer API from its root and SHALL expose transport, child-runtime, or test-oriented contracts only through declared subpath exports when external use is intentional. Internal-only symbols SHALL not remain public solely because tests import the root.

#### Scenario: An OMP extension consumer imports the package root
- **ID**: `package.root.exports`
- **EVIDENCE**: `packages/host-omp/tests/exports.spec.ts::exposes only the ordinary extension constructor at runtime`
- **EVIDENCE**: `packages/host-omp/tests/exports.spec.ts::does not expose package-private transport or child modules`
- **WHEN** a normal consumer imports `@doppelganger/doppelganger-host-omp`
- **THEN** it receives the supported extension construction and adapter-facing contracts without unrelated child or framed-transport internals

### Requirement: OMP adapter is composition-neutral
The generic OMP adapter SHALL accept a fully resolved serialized composition activation and SHALL NOT select a named Runtime Preset, require Persona metadata, or import a specific Runtime Preset. Runtime selection outside the adapter SHALL resolve the winning Runtime Preset and ordered patches.

#### Scenario: Mark is activated
- **ID**: `activation.composition.neutral.mark`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **WHEN** generic configuration selects the Mark Runtime Preset for an OMP session
- **THEN** the adapter starts that serialized composition without containing Mark-specific or Persona-specific selection logic

#### Scenario: Non-persona composition is activated
- **ID**: `activation.composition.neutral.generic`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **WHEN** configuration resolves another valid Runtime Preset with the required host mount
- **THEN** the same OMP adapter activates it without Persona or memory extensions

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

### Requirement: One isolated runtime process serves one OMP session
Each active OMP session SHALL own a separate Doppelganger child process and composition session. Disposal or failure of one child SHALL not affect another session or ordinary OMP facilities.

#### Scenario: Child crashes
- **ID**: `runtime.failure.child.isolation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics`
- **WHEN** the Doppelganger child exits or reports unrecoverable failure
- **THEN** projected Doppelganger tools and context are disabled, a diagnostic is surfaced, and normal OMP prompts and tools continue working

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

### Requirement: Runtime context is appended without replacing OMP instructions
Before an agent run, the adapter SHALL resolve Doppelganger context using the current principal input, stable turn identity, and configured budget, then append accepted content to the existing OMP system prompt. Failure SHALL leave the existing prompt unchanged.

#### Scenario: Context resolves successfully
- **ID**: `context.prompt.append`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** Doppelganger returns non-empty assembled context
- **THEN** OMP receives its existing system prompt followed by the assembled contribution

#### Scenario: Context resolution fails
- **ID**: `context.failure.fallback`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics`
- **WHEN** the child times out, crashes, or rejects context resolution
- **THEN** the current OMP turn continues with its original system prompt and Doppelganger is marked failed for the session

### Requirement: Projected OMP tools preserve supported schemas
For each available runtime tool, the adapter SHALL register an OMP proxy whose validation reflects the supported subset of the tool's JSON Schema, including object properties, required fields, arrays, scalar types, enumerations, descriptions, and additional-property policy. Unsupported schema constructs SHALL fail projection diagnostically rather than silently widening validation.

#### Scenario: Structured memory tool is projected
- **ID**: `tool.schema.validation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves nested objects, arrays, scalars, enums, descriptions, and additional-property policy`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** a runtime tool requires named fields with scalar and enumeration constraints
- **THEN** OMP validates those fields before sending a transport invocation

#### Scenario: Runtime tool schema is unsupported
- **ID**: `tool.schema.unsupported`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rejects unsupported constructs at their schema path instead of widening validation`
- **WHEN** a descriptor uses a construct the adapter cannot represent faithfully
- **THEN** that proxy remains unavailable and a diagnostic identifies the unsupported construct

### Requirement: Tool proxies preserve results and errors
A proxy SHALL invoke the qualified runtime tool and return its serializable success value or structured domain error to OMP. Transport failure SHALL disable the broken runtime session without misreporting it as a domain error.

#### Scenario: Runtime tool rejects input semantically
- **ID**: `tool.error.structured`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns serializable structured domain and execution errors`
- **EVIDENCE**: `packages/host-omp/tests/protocol.spec.ts::round-trips requests and notifications while keeping remote errors structured`
- **WHEN** the proxied tool returns a structured error
- **THEN** OMP receives that code and message as an errored tool result while the runtime remains active

#### Scenario: RPC fails during invocation
- **ID**: `tool.rpc.failure.deactivation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics`
- **WHEN** the child connection fails while invoking a tool
- **THEN** OMP receives a transport failure result and remaining Doppelganger projections are deactivated

### Requirement: OMP lifecycle mapping uses available authoritative hooks
The adapter SHALL map OMP session, turn, tool, and pre-compaction hooks to host-neutral lifecycle events using the authoritative payload for each event kind. Completed assistant content supplied by `turn_end` SHALL be forwarded through `turn-committed`, while completed tool results SHALL be forwarded only from `tool_execution_end` through correlated `tool-completed` events and SHALL NOT be duplicated from aggregate `turn_end` data.

#### Scenario: OMP turn ends
- **ID**: `lifecycle.turn.committed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** `turn_end` provides the completed assistant message and aggregate tool results
- **THEN** the normalized `turn-committed` event contains bounded principal input and assistant content with stable session and turn identities but no tool result payloads

#### Scenario: OMP tool ends
- **ID**: `lifecycle.tool.completed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** `tool_execution_end` provides a result and error flag
- **THEN** the normalized `tool-completed` event contains the actual bounded result and corresponding outcome correlated to the active session, turn, and call

#### Scenario: OMP begins compaction
- **ID**: `lifecycle.precompaction`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::publishes bounded pre-compaction lifecycle material`
- **WHEN** `session_before_compact` fires
- **THEN** the adapter publishes a bounded pre-compaction observation before allowing OMP compaction to continue

### Requirement: Stable turn and delivery identity
The adapter SHALL assign one stable turn identity before context resolution and reuse it for turn, tool, and commit events associated with that turn. Retried publication of an event SHALL reuse its deterministic delivery identity.

#### Scenario: Turn invokes multiple tools
- **ID**: `lifecycle.turn.call.identity`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** one OMP turn invokes several tools
- **THEN** all corresponding lifecycle events carry the same turn identity and distinct call identities

### Requirement: Dynamic tool projection is exact
Runtime tool notifications SHALL activate newly available proxies, refresh changed descriptors, and deactivate removed proxies while preserving non-Doppelganger OMP tools.

#### Scenario: Memory extension unloads
- **ID**: `tool.projection.memory.unload`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** runtime reload removes all memory tools
- **THEN** their OMP proxies become inactive and unrelated OMP tools remain active

### Requirement: Activation is discoverable but not implicit configuration mutation
When no configured activation resolves, the extension MAY expose an initialization action. Normal startup SHALL not create or rewrite project configuration without an explicit initialization invocation.

#### Scenario: No user or project configuration exists
- **ID**: `activation.unconfigured.initialization`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::initializes only without selection and writes a strict Runtime Preset manifest`
- **WHEN** an OMP session starts in an unconfigured project
- **THEN** no child process starts and ordinary OMP behavior remains available alongside an explicitly invoked initialization action

### Requirement: Shutdown is bounded and honest
OMP shutdown handling SHALL publish only lifecycle facts supported by the host, transfer runtime ownership to a detached bounded teardown without awaiting child disposal inside the host handler, request session disposal within a bounded deadline, and release the child process. A bare teardown hook SHALL not fabricate a successfully completed session.

#### Scenario: User exits after completed work
- **ID**: `shutdown.no.synthetic.outcome`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::bounds shutdown and reports forced completion honestly`
- **WHEN** prior committed-turn events were delivered and OMP emits shutdown without an outcome
- **THEN** the adapter disposes the runtime without inventing an additional successful session outcome

#### Scenario: Child does not stop promptly
- **ID**: `shutdown.deadline.detached.teardown`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::bounds shutdown and reports forced completion honestly`
- **WHEN** graceful disposal exceeds the configured deadline
- **THEN** the host shutdown handler returns promptly while the detached teardown terminates the owned child process and reports the observed outcome
