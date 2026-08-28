## Purpose

Defines persona behavior as an optional Cordis extension that resolves persona configuration and contributes persona-owned metadata and behavior to a generic composition session.

## ADDED Requirements

### Requirement: Persona concepts are extension-owned
The persona extension SHALL own persona definitions, instances, project selection, activation metadata, identity, and traits; the composition kernel SHALL not define or interpret those concepts.

#### Scenario: Activate persona composition
- **WHEN** the persona extension resolves an instance and project selection
- **THEN** it supplies persona metadata and plugins through declared composition imports and mounts

#### Scenario: Activate non-persona composition
- **WHEN** a composition does not include the persona extension
- **THEN** the composition activates without persona configuration, metadata, or services

### Requirement: Persona metadata isolation
Persona metadata SHALL be immutable and isolated per composition session, including instance identity, instance home, definition root, and optional project identity and root.

#### Scenario: Concurrent persona sessions
- **WHEN** two sessions use different persona instances or projects
- **THEN** each persona plugin observes only its own session metadata

### Requirement: Host-neutral persona definitions
Persona definitions SHALL declare their plugin composition and mount points without containing OMP-specific hooks, RPC methods, tool names, or process-management code.

#### Scenario: Mount persona in OMP
- **WHEN** an OMP host adapter is mounted into a persona composition
- **THEN** identity, selected traits, and persona services operate without OMP-specific code in the persona definition

### Requirement: Existing persona selection precedence
The persona extension SHALL preserve project selection over the user default, use the user default when no project selection exists, and remain inactive when neither is configured.

#### Scenario: Project selection overrides default
- **WHEN** both a user default instance and a valid project selection exist
- **THEN** the extension selects the project instance and project traits

#### Scenario: User default applies globally
- **WHEN** no project selection exists and a user default is configured
- **THEN** the extension selects the user default instance without project metadata

#### Scenario: No persona configured
- **WHEN** neither project selection nor user default exists
- **THEN** the persona extension reports inactive without preventing the host from operating

### Requirement: Existing persona behavior survives extraction
Moving persona behavior out of the kernel SHALL preserve identity and selected-trait context, instance-owned persistent memory, project scope isolation, and live profile updates when the corresponding extensions are composed.

#### Scenario: Existing Aiden composition remains operational
- **WHEN** the Aiden preset is activated through the OMP adapter after extraction
- **THEN** it produces Aiden identity and selected traits and retains its existing scoped memory and reload behavior
