## Purpose

Defines the first concrete host integration, allowing Oh My Pi sessions to activate and use portable Doppelganger compositions without embedding the runtime into OMP.

## ADDED Requirements

### Requirement: Project manifest discovery
The OMP adapter SHALL search from the session working directory upward to the Git root for `.doppelganger/manifest.yaml` and SHALL use the nearest valid manifest.

#### Scenario: Nested working directory
- **WHEN** an OMP session starts in a subdirectory below a configured project root
- **THEN** the adapter activates the Persona Instance selected by the nearest project manifest

#### Scenario: No project manifest
- **WHEN** no project manifest exists before the Git root
- **THEN** the adapter uses the configured global default persona if one exists

### Requirement: Inactive unconfigured state
The OMP adapter SHALL leave normal OMP behavior available when no project persona or global default is configured and SHALL expose an initialization tool.

#### Scenario: First unconfigured session
- **WHEN** OMP starts without any persona selection
- **THEN** no persona context is injected, normal OMP tools remain usable, and initialization is available through the adapter tool

### Requirement: Session-owned runtime process
The adapter SHALL start one Node runtime child for each OMP agent session and SHALL communicate with it over framed JSON-RPC on stdio.

#### Scenario: OMP session starts
- **WHEN** persona activation is required for a new OMP agent session
- **THEN** the adapter starts a dedicated child, performs activation, and associates the child only with that session

#### Scenario: Concurrent OMP sessions
- **WHEN** two OMP agent sessions activate personas concurrently
- **THEN** each session owns a different child process and protocol connection

### Requirement: Persona context projection
Before each model turn, the adapter SHALL request current assembled context from the runtime and append it without discarding the host's existing system instructions.

#### Scenario: Profile changes during session
- **WHEN** a valid profile update reloads successfully
- **THEN** the next OMP model turn receives context from the updated profile

### Requirement: Persona tool projection
The adapter SHALL project active runtime tools into OMP and proxy invocations and results over the session connection.

#### Scenario: Runtime tool is added or updated
- **WHEN** hot reload adds a tool or changes its definition
- **THEN** the OMP session exposes the new active definition without restarting the session

#### Scenario: Runtime tool is removed
- **WHEN** hot reload removes a previously exposed tool
- **THEN** the adapter deactivates that tool for the remainder of the OMP session

### Requirement: Lifecycle event forwarding
The adapter SHALL forward normalized session, turn, and tool observation events to the runtime-side host plugin.

#### Scenario: OMP tool completes
- **WHEN** an OMP tool invocation finishes
- **THEN** the runtime receives the normalized completion event associated with the active runtime session

### Requirement: Graceful shutdown
OMP session shutdown SHALL dispose the runtime session and terminate its child process without relying on a long-lived daemon.

#### Scenario: OMP session closes normally
- **WHEN** OMP emits session shutdown
- **THEN** the adapter requests runtime disposal, closes the protocol connection, and ensures the owned child exits

### Requirement: Runtime failure isolation
Runtime startup, activation, protocol, or projection failure SHALL disable persona behavior for the affected OMP session, report an actionable diagnostic, and SHALL NOT terminate OMP.

#### Scenario: Child process crashes
- **WHEN** the runtime child exits unexpectedly
- **THEN** persona context and tools are disabled for that session and OMP remains usable

#### Scenario: Manifest is invalid
- **WHEN** a discovered project manifest cannot be validated
- **THEN** persona activation is skipped and the adapter reports the exact configuration problem without blocking OMP

### Requirement: Host API containment
The adapter SHALL expose host-specific operations only as explicit RPC capabilities and SHALL NOT pass the raw OMP extension runtime into portable plugins.

#### Scenario: Plugin requests an unavailable host operation
- **WHEN** a plugin optionally depends on an OMP-specific RPC capability that the adapter does not export
- **THEN** the plugin continues without that optional behavior
