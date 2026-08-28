## Purpose

Defines portable persona definitions and stable persona instances as ordinary plugin compositions layered over the generic agent runtime.

## ADDED Requirements

### Requirement: Portable persona definition
A Persona Definition SHALL be a host-independent plugin composition with configuration and assets and SHALL NOT include a concrete host adapter.

#### Scenario: Definition activates in a host
- **WHEN** a host adapter activates a valid Persona Definition
- **THEN** the host plugin is mounted for that session beside the unchanged persona composition

### Requirement: Stable persona instance
A Persona Instance SHALL retain a stable instance ID and persistent state across definition revisions and runtime sessions.

#### Scenario: Definition revision changes
- **WHEN** an existing Persona Instance activates a newer valid definition revision
- **THEN** its instance identity and persistent state lineage remain unchanged

### Requirement: Identity as a plugin
Identity SHALL be provided by an ordinary plugin whose concrete identity content is loaded from persona configuration and assets.

#### Scenario: Identity contributes context
- **WHEN** a persona session resolves context
- **THEN** the configured identity plugin contributes the active identity through the context protocol

#### Scenario: Identity configuration reloads
- **WHEN** identity content changes to a valid revision during an active session
- **THEN** the next context resolution uses the updated identity content

### Requirement: Ordered traits
A Persona Definition SHALL support an ordered set of trait configurations that contribute working behavior independently of identity.

#### Scenario: Project selects traits
- **WHEN** project configuration selects additional existing traits
- **THEN** those traits are composed in the declared order without changing the Persona Instance identity

### Requirement: Project persona selection
A project manifest SHALL identify a stable project and selected Persona Instance and MAY select additional traits.

#### Scenario: Project manifest is committed
- **WHEN** a project is initialized for Doppelganger
- **THEN** its manifest contains configuration safe to version while persistent persona state remains outside the project repository

### Requirement: Global persona selection
User configuration SHALL support selecting a default Persona Instance for sessions without a project manifest.

#### Scenario: No project manifest exists
- **WHEN** a host session starts outside a configured project and a global default exists
- **THEN** the host may activate the configured default Persona Instance without a project memory scope

#### Scenario: No default exists
- **WHEN** no project selection and no global default are available
- **THEN** persona behavior remains inactive until initialization or explicit selection

### Requirement: Concurrent persona sessions
Concurrent sessions of one Persona Instance SHALL share only persistent plugin state and definition assets.

#### Scenario: Two hosts activate one persona
- **WHEN** one Persona Instance is active in two agent hosts
- **THEN** each session has independent runtime state while committed persona state remains available to both according to storage concurrency rules
