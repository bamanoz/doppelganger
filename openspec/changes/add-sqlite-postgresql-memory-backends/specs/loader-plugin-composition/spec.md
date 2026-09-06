## MODIFIED Requirements

### Requirement: Directly composable protocol and infrastructure rows
The context registry, tool registry, Persona, SQLite infrastructure, memory feature, and canonical memory repository providers SHALL each be directly mountable as ordinary Cordis Loader rows. The memory row SHALL consume exactly one memory-owned `doppelgangerMemoryRepository` service selected through the public Loader specifier `@doppelganger/doppelganger-memory/sqlite` or `@doppelganger/doppelganger-memory/postgresql`; the selected provider SHALL remain independently authored and injected rather than hidden by an aggregate preset plugin. Generic SQLite infrastructure SHALL remain directly composable for unrelated consumers and SHALL NOT become a required dependency of PostgreSQL-backed memory. All required dependencies SHALL be declared through Cordis injection, and missing required services SHALL keep the row pending or fail audited activation.

#### Scenario: Empty Runtime Preset
- **ID**: `loader.topology.empty-preset`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **WHEN** a Runtime Preset contains none of these rows
- **THEN** activation remains valid and the protected host bridge observes no context or tool protocol

#### Scenario: Dependency is missing
- **ID**: `loader.topology.missing-memory-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **EVIDENCE**: `packages/extension-memory/tests/memory-provider-composition.spec.ts::reports a missing selected canonical repository provider`
- **WHEN** a Runtime Preset mounts memory without one of its required Persona, actor identity, context, tools, or selected canonical repository provider services
- **THEN** audited activation fails and identifies the unresolved memory row and dependency
