## ADDED Requirements

### Requirement: Doppelganger package naming
Every public Loader-compatible Doppelganger plugin package introduced or retained by this change SHALL use the npm naming form `@doppelganger/doppelganger-<capability>`. Loader entry IDs and Cordis plugin names SHALL use stable `doppelganger-<capability>` names where Doppelganger owns the row. The migration SHALL be a clean cutover with no compatibility package aliases or deprecated re-exports.

#### Scenario: Loader resolves a Doppelganger feature
- **WHEN** an authored Runtime Preset names `@doppelganger/doppelganger-persona`
- **THEN** the Loader resolves a native Cordis plugin whose diagnostic name identifies the `doppelganger-persona` capability

#### Scenario: Obsolete package name is used
- **WHEN** authored input or source code references an obsolete `@doppelganger/extension-*` or `@doppelganger/preset-aiden` package
- **THEN** no compatibility path provided by this repository resolves that reference

### Requirement: Directly composable protocol and infrastructure rows
The context registry, tool registry, Persona, SQLite infrastructure, and memory feature SHALL each be directly mountable as ordinary Cordis Loader rows. Their required dependencies SHALL be declared through Cordis injection, and missing required services SHALL keep the row pending or fail audited activation rather than being programmatically hidden by an aggregate preset plugin.

#### Scenario: Empty Runtime Preset
- **WHEN** a Runtime Preset contains none of these rows
- **THEN** activation remains valid and the protected host bridge observes no context or tool protocol

#### Scenario: Dependency is missing
- **WHEN** a Runtime Preset mounts memory without one of its required Persona, context, tools, or SQLite services
- **THEN** audited activation fails and identifies the unresolved memory row and dependency

### Requirement: One Loader-compatible Persona row
`@doppelganger/doppelganger-persona` SHALL own Persona Activation plus authored identity and ordered traits behind one Loader row. It SHALL derive `sessionId` and optional workspace metadata from Runtime Session metadata, SHALL require stable configured `instanceId` and `principalId`, and SHALL contribute identity and traits as instruction-authority context through the composed context protocol.

#### Scenario: Persona activates
- **WHEN** a valid Persona row is mounted with identity and traits
- **THEN** it provides one immutable Persona Activation and contributes the resolved identity and traits in deterministic priority order

#### Scenario: Persona assets reload invalidly
- **WHEN** an authored identity or trait reload is empty or unreadable
- **THEN** the last valid active contribution remains available and the failed reload is diagnosed

### Requirement: Cohesive memory plugin
`@doppelganger/doppelganger-memory` SHALL own the memory domain service, schema and migrations, model-facing memory tools, and automatic recall context. These responsibilities SHALL remain one Loader row until a real independently swappable provider or consumer requires another seam. Existing memory mutation, partition, retrieval, revision, evidence, conflict, candidate, idempotency, secret-rejection, temporal, and deletion invariants SHALL remain unchanged.

#### Scenario: Memory row activates
- **WHEN** Persona, context, tools, and SQLite dependencies are available
- **THEN** one memory row opens its namespaced store, registers the complete memory tool surface, and registers automatic eligible recall

#### Scenario: Memory row is removed by a patch
- **WHEN** an effective Runtime Preset patch removes the memory row
- **THEN** its service, tools, context contribution, database handle, and registrations are disposed together

### Requirement: Independently mountable candidate capture
`@doppelganger/doppelganger-memory/capture` SHALL remain a separate Loader-compatible Cordis plugin within the memory npm package. It SHALL consume committed lifecycle events and propose candidates only; it SHALL NOT create active memory. Capture configuration SHALL own enablement, bounds, and optional extractor policy independently of the main memory row.

#### Scenario: Capture is disabled by omission
- **WHEN** the capture row is absent from a Runtime Preset
- **THEN** committed turns create no inferred memory candidates while explicit memory tools remain usable

#### Scenario: Capture is enabled
- **WHEN** the capture row is mounted with enabled policy and a completed committed turn yields acceptable durable material
- **THEN** it proposes bounded candidates with stable operation identities and does not promote them directly

### Requirement: Aiden is a declarative Runtime Preset
The shipped development Aiden Runtime Preset SHALL directly list ordinary Doppelganger plugin rows and SHALL colocate its identity and trait assets in its Runtime Preset directory. No Aiden-specific TypeScript aggregate plugin SHALL be required to activate Aiden.

#### Scenario: Aiden composition is inspected
- **WHEN** a maintainer reads Aiden's `runtime.cordis.yml`
- **THEN** the effective Persona, context, tools, SQLite, memory, and optional capture features are visible as independently addressable Loader rows

#### Scenario: Aiden feature is patched
- **WHEN** a valid Runtime Patch targets an Aiden feature row by ID
- **THEN** only that row's complete Loader configuration is replaced, disabled, inserted, or removed according to Cordis patch semantics

#### Scenario: Aiden persists across restart
- **WHEN** two Runtime Sessions activate the Aiden preset with the same configured Persona Instance storage and principal partition
- **THEN** eligible memory written by the first session is available to the second without sharing mutable session objects or handlers
