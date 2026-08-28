## Purpose

Defines a domain-neutral runtime that activates, observes, reloads, and disposes isolated Cordis plugin compositions without embedding extension-domain concepts.

## ADDED Requirements

### Requirement: Domain-neutral composition activation
The runtime SHALL activate a composition from its identifier, revision, declarative Loader tree, plugin imports, and declared mount points without requiring persona, project, memory, or storage concepts.

#### Scenario: Activate an arbitrary composition
- **WHEN** a caller activates a valid composition with session metadata and all required mounts
- **THEN** the runtime returns an active isolated session after every enabled composition entry settles successfully

#### Scenario: Domain metadata remains extension-owned
- **WHEN** an extension requires domain-specific metadata
- **THEN** the extension supplies that metadata through a mounted Cordis plugin rather than a kernel-defined metadata contract

### Requirement: Named composition mount points
A composition SHALL declare named mount points, and activation SHALL accept mounted Cordis plugins only for those declared names. Callers SHALL NOT need to construct Loader patches or identify Loader groups directly.

#### Scenario: Mount a host adapter
- **WHEN** a composition declares a `host` mount point and activation supplies a host plugin for it
- **THEN** the runtime inserts that plugin at the location declared by the composition

#### Scenario: Reject undeclared mount
- **WHEN** activation supplies a mount name not declared by the composition
- **THEN** activation fails before returning a session and identifies the undeclared mount

#### Scenario: Reject missing required mount
- **WHEN** a required mount point has no supplied plugin
- **THEN** activation fails before returning a session and identifies the missing mount

### Requirement: Session isolation
Each activated composition session SHALL own an isolated Cordis lifecycle scope and SHALL not resolve isolated implementations from another concurrently active session.

#### Scenario: Concurrent sessions use distinct implementations
- **WHEN** two sessions activate the same composition concurrently with different mounted implementations
- **THEN** each session resolves only its own mounted implementations

### Requirement: Audited activation
The runtime SHALL audit the complete Loader tree after dependency settlement and SHALL return a session only when every enabled entry is active.

#### Scenario: Missing dependency blocks activation
- **WHEN** an enabled plugin remains pending because a required service is absent
- **THEN** activation fails with structured diagnostics naming the entry and missing service

#### Scenario: Partial activation is cleaned up
- **WHEN** any composition entry fails during activation
- **THEN** the runtime disposes all resources created for that attempted session

### Requirement: Transactional composition reload
The runtime SHALL serialize reloads per session, commit only a fully audited update, and retain the last valid composition when an update fails.

#### Scenario: Valid update commits
- **WHEN** a watched composition changes to another valid plugin tree
- **THEN** the next session interaction observes the updated composition

#### Scenario: Invalid update rolls back
- **WHEN** an update produces a failed, missing, or pending enabled entry
- **THEN** the runtime restores the last valid tree and exposes reload diagnostics without terminating the session

### Requirement: Deterministic disposal
Session and runtime disposal SHALL be idempotent, await in-flight lifecycle mutations, remove associated watchers, and await Cordis resource quiescence.

#### Scenario: Dispose one session
- **WHEN** a caller disposes an active session
- **THEN** only that session's plugin tree and watchers are released

#### Scenario: Dispose runtime
- **WHEN** a caller disposes the runtime
- **THEN** all active sessions and runtime-owned Cordis resources are released before disposal completes

### Requirement: Kernel-only public interface
The kernel package SHALL expose composition, mount, session, diagnostics, reload, and disposal contracts while excluding persona, memory, context assembly, tools, lifecycle protocols, and persistence contracts.

#### Scenario: Consume kernel independently
- **WHEN** a downstream package imports the kernel public entry point
- **THEN** it can activate a generic Cordis composition without importing any domain extension
