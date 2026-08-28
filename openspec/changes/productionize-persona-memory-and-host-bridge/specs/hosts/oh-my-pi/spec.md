## Purpose

Defines the Oh My Pi host adapter that activates arbitrary Doppelganger compositions, projects context and tools through native OMP extension interfaces, forwards faithful lifecycle events, and isolates runtime failure.

## ADDED Requirements

### Requirement: OMP adapter is composition-neutral
The generic OMP adapter SHALL accept a fully resolved serialized composition activation and SHALL NOT select Aiden, require persona metadata, or import a specific preset. Product configuration outside the adapter SHALL resolve any preset or persona selection.

#### Scenario: Aiden is activated
- **WHEN** Aiden product configuration resolves an activation for an OMP session
- **THEN** the generic adapter starts that serialized composition without containing Aiden-specific selection logic

#### Scenario: Non-persona composition is activated
- **WHEN** configuration resolves another valid composition with the required host mount
- **THEN** the same OMP adapter can activate it without persona or memory extensions

### Requirement: One isolated runtime process serves one OMP session
Each active OMP session SHALL own a separate Doppelganger child process and composition session. Disposal or failure of one child SHALL not affect another session or ordinary OMP facilities.

#### Scenario: Two sessions run concurrently
- **WHEN** two OMP sessions activate Doppelganger
- **THEN** they use independent processes, Cordis fibers, handlers, and session-local extension state

#### Scenario: Child crashes
- **WHEN** the Doppelganger child exits or reports unrecoverable failure
- **THEN** projected Doppelganger tools and context are disabled, a diagnostic is surfaced, and normal OMP prompts and tools continue working

### Requirement: Adapter transport exposes the host-neutral runtime surface
The OMP transport SHALL support composition activation and disposal, context resolution, tool listing and invocation, lifecycle publication, and runtime notifications over framed request/response messages. Both endpoints SHALL reject malformed or out-of-state requests without corrupting the session.

#### Scenario: Context is requested before activation
- **WHEN** the extension requests context before a runtime session is active
- **THEN** the request fails with a transport-visible state error and OMP proceeds without Doppelganger context

#### Scenario: Runtime profile changes
- **WHEN** a valid composition reload changes context or tools
- **THEN** the child notifies the OMP extension and the next turn observes the current profile and tool set

### Requirement: Persona context is appended without replacing OMP instructions
Before an agent run, the adapter SHALL resolve Doppelganger context using the current principal input, stable turn identity, and configured budget, then append accepted content to the existing OMP system prompt. Failure SHALL leave the existing prompt unchanged.

#### Scenario: Context resolves successfully
- **WHEN** Doppelganger returns non-empty assembled context
- **THEN** OMP receives its existing system prompt followed by the assembled contribution

#### Scenario: Context resolution fails
- **WHEN** the child times out, crashes, or rejects context resolution
- **THEN** the current OMP turn continues with its original system prompt and Doppelganger is marked failed for the session

### Requirement: Projected OMP tools preserve supported schemas
For each available runtime tool, the adapter SHALL register an OMP proxy whose validation reflects the supported subset of the tool's JSON Schema, including object properties, required fields, arrays, scalar types, enumerations, descriptions, and additional-property policy. Unsupported schema constructs SHALL fail projection diagnostically rather than silently widening validation.

#### Scenario: Structured memory tool is projected
- **WHEN** a runtime tool requires named fields with scalar and enumeration constraints
- **THEN** OMP validates those fields before sending a transport invocation

#### Scenario: Runtime tool schema is unsupported
- **WHEN** a descriptor uses a construct the adapter cannot represent faithfully
- **THEN** that proxy remains unavailable and a diagnostic identifies the unsupported construct

### Requirement: Tool proxies preserve results and errors
A proxy SHALL invoke the qualified runtime tool and return its serializable success value or structured domain error to OMP. Transport failure SHALL disable the broken runtime session without misreporting it as a domain error.

#### Scenario: Runtime tool rejects input semantically
- **WHEN** the proxied tool returns a structured error
- **THEN** OMP receives that code and message as an errored tool result while the runtime remains active

#### Scenario: RPC fails during invocation
- **WHEN** the child connection fails while invoking a tool
- **THEN** OMP receives a transport failure result and remaining Doppelganger projections are deactivated

### Requirement: OMP lifecycle mapping uses available authoritative hooks
The adapter SHALL map OMP session, turn, tool, and pre-compaction hooks to host-neutral lifecycle events using the richest committed payload available. In particular, completed turn messages and tool results supplied by OMP SHALL be forwarded rather than discarded.

#### Scenario: OMP turn ends
- **WHEN** `turn_end` provides the completed assistant message and tool results
- **THEN** the normalized turn-committed event contains their bounded serializable content and stable session and turn identities

#### Scenario: OMP tool ends
- **WHEN** `tool_execution_end` provides a result and error flag
- **THEN** the normalized tool-completed event contains the actual bounded result and corresponding outcome

#### Scenario: OMP begins compaction
- **WHEN** `session_before_compact` fires
- **THEN** the adapter publishes a bounded pre-compaction observation before allowing OMP compaction to continue

### Requirement: Stable turn and delivery identity
The adapter SHALL assign one stable turn identity before context resolution and reuse it for turn, tool, and commit events associated with that turn. Retried publication of an event SHALL reuse its deterministic delivery identity.

#### Scenario: Turn invokes multiple tools
- **WHEN** one OMP turn invokes several tools
- **THEN** all corresponding lifecycle events carry the same turn identity and distinct call identities

### Requirement: Dynamic tool projection is exact
Runtime tool notifications SHALL activate newly available proxies, refresh changed descriptors, and deactivate removed proxies while preserving non-Doppelganger OMP tools.

#### Scenario: Memory extension unloads
- **WHEN** runtime reload removes all memory tools
- **THEN** their OMP proxies become inactive and unrelated OMP tools remain active

### Requirement: Activation is discoverable but not implicit configuration mutation
When no configured activation resolves, the extension MAY expose an initialization action. Normal startup SHALL not create or rewrite project configuration without an explicit initialization invocation.

#### Scenario: No user or project configuration exists
- **WHEN** an OMP session starts in an unconfigured project
- **THEN** no child process starts and ordinary OMP behavior remains available alongside an explicitly invoked initialization action

### Requirement: Shutdown is bounded and honest
OMP shutdown handling SHALL publish only lifecycle facts supported by the host, request session disposal within a bounded deadline, and release the child process. A bare teardown hook SHALL not fabricate a successfully completed session.

#### Scenario: User exits after completed work
- **WHEN** prior committed-turn events were delivered and OMP emits shutdown without an outcome
- **THEN** the adapter disposes the runtime without inventing an additional successful session outcome

#### Scenario: Child does not stop promptly
- **WHEN** graceful disposal exceeds the configured deadline
- **THEN** the adapter terminates the owned child process and OMP shutdown is not held indefinitely
