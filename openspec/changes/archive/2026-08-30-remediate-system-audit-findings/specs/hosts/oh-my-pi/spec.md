## ADDED Requirements

### Requirement: Notification observer failure is contained
Each framed JSON-RPC notification observer SHALL run as an independently contained observer. A rejected observer SHALL produce a bounded diagnostic without closing the peer, preventing sibling observers, or rejecting unrelated pending requests.

#### Scenario: One notification observer throws
- **WHEN** a notification has one observer that rejects and another that succeeds
- **THEN** the successful observer completes, the rejection is reported diagnostically, and a subsequent request/response and notification cycle still succeeds

### Requirement: Host package exports are intentional
The `host-omp` package SHALL expose the ordinary extension/adapter consumer API from its root and SHALL expose transport, child-runtime, or test-oriented contracts only through declared subpath exports when external use is intentional. Internal-only symbols SHALL not remain public solely because tests import the root.

#### Scenario: An OMP extension consumer imports the package root
- **WHEN** a normal consumer imports `@doppelganger/doppelganger-host-omp`
- **THEN** it receives the supported extension construction and adapter-facing contracts without unrelated child or framed-transport internals

#### Scenario: A transport integration uses an intentional seam
- **WHEN** a supported integration requires framed RPC or child-runtime contracts
- **THEN** it imports a documented package subpath with an explicit export contract

## RENAMED Requirements

- FROM: `### Requirement: Persona context projection`
- TO: `### Requirement: Runtime context projection`
- FROM: `### Requirement: Persona tool projection`
- TO: `### Requirement: Runtime tool projection`
- FROM: `### Requirement: Persona context is appended without replacing OMP instructions`
- TO: `### Requirement: Runtime context is appended without replacing OMP instructions`

## MODIFIED Requirements

### Requirement: Project manifest discovery
The OMP adapter SHALL search from the session working directory upward to the Git root for `.doppelganger/manifest.yaml` and SHALL use the nearest valid manifest as the project Runtime Preset selection layer.

#### Scenario: Nested working directory
- **WHEN** an OMP session starts in a subdirectory below a configured project root
- **THEN** the adapter selects the Runtime Preset named by the nearest project manifest

#### Scenario: No project manifest
- **WHEN** no project manifest exists before the Git root
- **THEN** the adapter uses the configured user `defaultRuntimePreset` if one exists

### Requirement: Inactive unconfigured state
The OMP adapter SHALL leave normal OMP behavior available when no explicit, project, or user Runtime Preset is selected and SHALL expose an explicit initialization tool.

#### Scenario: First unconfigured session
- **WHEN** OMP starts without any Runtime Preset selection
- **THEN** no Doppelganger context or tools are projected, normal OMP tools remain usable, and initialization is available through the adapter tool

### Requirement: Session-owned runtime process
The adapter SHALL start one Node runtime child for each OMP agent session with a selected Runtime Preset and SHALL communicate with it over framed JSON-RPC on stdio.

#### Scenario: OMP session starts
- **WHEN** generic Runtime Preset activation is required for a new OMP agent session
- **THEN** the adapter starts a dedicated child, performs activation, and associates the child only with that session

#### Scenario: Concurrent OMP sessions
- **WHEN** two OMP agent sessions activate Runtime Presets concurrently
- **THEN** each session owns a different child process and protocol connection

### Requirement: Runtime context projection
Before each model turn, the adapter SHALL request current assembled context from the active generic runtime and append it without discarding the host's existing system instructions.

#### Scenario: Runtime context changes during session
- **WHEN** a valid composition or asset update reloads successfully
- **THEN** the next OMP model turn receives the current assembled context

### Requirement: Runtime tool projection
The adapter SHALL project active runtime tools into OMP and proxy invocations and results over the session connection without requiring Persona or memory extensions.

#### Scenario: Runtime tool is added or updated
- **WHEN** hot reload adds a tool or changes its definition
- **THEN** the OMP session exposes the new active definition without restarting the session

#### Scenario: Runtime tool is removed
- **WHEN** hot reload removes a previously exposed tool
- **THEN** the adapter deactivates that tool for the remainder of the OMP session

### Requirement: Runtime failure isolation
Runtime startup, activation, protocol, notification-observer, or projection failure SHALL be classified at its owning boundary. Fatal child/transport failures SHALL disable Doppelganger for the affected OMP session and SHALL NOT terminate OMP; contained observer failures SHALL leave the healthy transport active.

#### Scenario: Child process crashes
- **WHEN** the runtime child exits unexpectedly
- **THEN** Doppelganger context and tools are disabled for that session and OMP remains usable

#### Scenario: Manifest is invalid
- **WHEN** a discovered project manifest cannot be validated
- **THEN** Runtime Preset activation is skipped and the adapter reports the exact configuration problem without blocking OMP

#### Scenario: Notification observer fails
- **WHEN** one local notification observer rejects after a valid frame is decoded
- **THEN** the observer failure is diagnosed without treating the peer or child as failed

### Requirement: OMP adapter is composition-neutral
The generic OMP adapter SHALL accept a fully resolved serialized composition activation and SHALL NOT select Aiden, require Persona metadata, or import a specific Runtime Preset. Runtime selection outside the adapter SHALL resolve the winning Runtime Preset and ordered patches.

#### Scenario: Aiden is activated
- **WHEN** generic configuration selects the Aiden Runtime Preset for an OMP session
- **THEN** the adapter starts that serialized composition without containing Aiden-specific or Persona-specific selection logic

#### Scenario: Non-persona composition is activated
- **WHEN** configuration resolves another valid Runtime Preset with the required host mount
- **THEN** the same OMP adapter activates it without Persona or memory extensions

### Requirement: Runtime context is appended without replacing OMP instructions
Before an agent run, the adapter SHALL resolve Doppelganger context using the current principal input, stable turn identity, and configured budget, then append accepted content to the existing OMP system prompt. Failure SHALL leave the existing prompt unchanged.

#### Scenario: Context resolves successfully
- **WHEN** Doppelganger returns non-empty assembled context
- **THEN** OMP receives its existing system prompt followed by the assembled contribution

#### Scenario: Context resolution fails
- **WHEN** the child times out, crashes, or rejects context resolution
- **THEN** the current OMP turn continues with its original system prompt and Doppelganger is marked failed for the session
