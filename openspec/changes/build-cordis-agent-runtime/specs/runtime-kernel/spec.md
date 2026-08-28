## Purpose

Defines reliable activation, isolation, reload, diagnostics, and teardown behavior for portable extension compositions running inside agent sessions.

## ADDED Requirements

### Requirement: Runtime session activation
The runtime SHALL activate a definition as an independent runtime session under either a caller-supplied host context or a standalone context owned by the runtime.

#### Scenario: Activate under a host context
- **WHEN** a caller supplies a compatible host context and a valid definition
- **THEN** the runtime activates the definition in a child session scope without creating a competing root context

#### Scenario: Activate standalone
- **WHEN** a caller supplies a valid definition without a host context
- **THEN** the runtime creates and owns the context required by that runtime session

### Requirement: Session isolation
Each runtime session SHALL have an independent plugin tree and SHALL NOT share mutable plugin objects, handlers, or lifecycle fibers with another session.

#### Scenario: Concurrent sessions for one instance
- **WHEN** the same logical instance is activated in two concurrent agent sessions
- **THEN** each activation receives an independent plugin tree and shares data only through explicitly configured persistent storage

### Requirement: Scoped activation metadata
The runtime SHALL expose instance, session, project, and resolved path metadata to plugins in the active session scope.

#### Scenario: Plugin reads activation metadata
- **WHEN** a plugin activates inside a project-backed session
- **THEN** it can resolve the stable instance ID, session ID, project ID, project root, and instance home for that activation

### Requirement: Activation audit
Activation SHALL succeed only when every configured required plugin reaches an active state, and failures SHALL include diagnostics identifying inactive or failed entries and their causes.

#### Scenario: Required dependency is unavailable
- **WHEN** a configured plugin cannot activate because a required service is unavailable
- **THEN** activation fails with diagnostics naming the plugin and missing dependency

#### Scenario: Duplicate service registration
- **WHEN** two plugins register the same service in one isolation scope
- **THEN** activation fails instead of selecting a provider implicitly

### Requirement: Transactional hot reload
The runtime SHALL apply definition and plugin updates transactionally to an active session and SHALL restore the previous working composition when the update cannot activate.

#### Scenario: Successful update
- **WHEN** a valid plugin or configuration update is detected
- **THEN** affected plugins are disposed and reactivated and the updated composition becomes active in the same session

#### Scenario: Failed update
- **WHEN** an updated composition fails activation or audit
- **THEN** the runtime restores the previous working composition and reports the failed update

### Requirement: Reload state semantics
Hot reload SHALL reset plugin-local runtime state while preserving state committed through persistent storage plugins.

#### Scenario: Plugin reloads
- **WHEN** a plugin with local and persisted state reloads successfully
- **THEN** its local state is recreated and its previously committed persistent state remains available

### Requirement: Deterministic disposal
Disposing a runtime session SHALL await owned plugin effects and child lifecycles and SHALL release resources without affecting sibling sessions.

#### Scenario: Session shutdown
- **WHEN** a caller disposes an active runtime session
- **THEN** all owned plugins and effects reach a disposed state before disposal completes

#### Scenario: Repeated disposal
- **WHEN** disposal is requested more than once for the same session
- **THEN** subsequent requests complete safely without repeating side effects
