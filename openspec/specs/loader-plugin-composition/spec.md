# Loader Plugin Composition Specification

## Purpose

Defines how Doppelganger feature and infrastructure packages compose directly as native Cordis Loader rows without aggregate preset plugins or compatibility aliases.

## Requirements

### Requirement: Doppelganger package naming
Every public Loader-compatible Doppelganger plugin package introduced or retained by this change SHALL use the npm naming form `@doppelganger/doppelganger-<capability>`. Loader entry IDs and Cordis plugin names SHALL use stable `doppelganger-<capability>` names where Doppelganger owns the row. The migration SHALL be a clean cutover with no compatibility package aliases or deprecated re-exports.

#### Scenario: Loader resolves a Doppelganger feature
- **ID**: `loader.naming.native-doppelganger-persona`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports runtime-owned Persona selection requirements`
- **WHEN** an authored Runtime Preset names `@doppelganger/doppelganger-persona`
- **THEN** the Loader resolves a native Cordis plugin whose diagnostic name identifies the `doppelganger-persona` capability

#### Scenario: Obsolete package name is used
- **ID**: `loader.naming.obsolete-packages-rejected`
- **EVIDENCE**: `scripts/tests/repository-integrity.spec.ts::reports active obsolete package identifiers`
- **WHEN** authored input or source code references an obsolete `@doppelganger/extension-*` or `@doppelganger/preset-aiden` package
- **THEN** no compatibility path provided by this repository resolves that reference

### Requirement: Directly composable protocol and infrastructure rows
The context registry, tool registry, Persona, SQLite infrastructure, and memory feature SHALL each be directly mountable as ordinary Cordis Loader rows. Their required dependencies SHALL be declared through Cordis injection, and missing required services SHALL keep the row pending or fail audited activation rather than being programmatically hidden by an aggregate preset plugin.

#### Scenario: Empty Runtime Preset
- **ID**: `loader.topology.empty-preset`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **WHEN** a Runtime Preset contains none of these rows
- **THEN** activation remains valid and the protected host bridge observes no context or tool protocol

#### Scenario: Dependency is missing
- **ID**: `loader.topology.missing-memory-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::reports missing services and cleans partially activated resources`
- **WHEN** a Runtime Preset mounts memory without one of its required Persona, context, tools, or SQLite services
- **THEN** audited activation fails and identifies the unresolved memory row and dependency

### Requirement: Independently mountable candidate capture
`@doppelganger/doppelganger-memory/capture` SHALL remain a separate Loader-compatible Cordis plugin within the memory npm package. It SHALL consume committed lifecycle events and propose candidates only; it SHALL NOT create active memory. Capture configuration SHALL own enablement, bounds, and optional extractor policy independently of the main memory row.

#### Scenario: Capture is disabled by omission
- **ID**: `loader.capture.omitted`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::forwards committed OMP turns into capture only when the row is enabled`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** the capture row is absent from a Runtime Preset
- **THEN** committed turns create no inferred memory candidates while explicit memory tools remain usable

#### Scenario: Capture is enabled
- **ID**: `loader.capture.candidates`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::captures committed OMP turns only as idempotent review candidates`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::forwards committed OMP turns into capture only when the row is enabled`
- **WHEN** the capture row is mounted with enabled policy and a completed committed turn yields acceptable durable material
- **THEN** it proposes bounded candidates with stable operation identities and does not promote them directly

### Requirement: Full-stack Runtime Presets remain declarative
A Runtime Preset MAY directly list ordinary Doppelganger feature and infrastructure rows, including a complete local semantic-memory stack, and SHALL colocate any selected identity and trait assets in its Runtime Preset directory. No named-Persona TypeScript aggregate plugin SHALL be required.

#### Scenario: Full-stack test composition is inspected
- **ID**: `loader.full-stack-test.rows`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::exposes every test preset feature as an independently patchable Loader row`
- **WHEN** a maintainer inspects a generated full-stack test Runtime Preset
- **THEN** its feature rows are visible as independently addressable Loader entries

#### Scenario: Full-stack test feature is patched
- **ID**: `loader.full-stack-test.patch`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::applies ordered whole-field replacement and later targets inserted rows`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::exposes every test preset feature as an independently patchable Loader row`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid Runtime Patch targets a generated test feature row by ID
- **THEN** only that row's complete Loader configuration is replaced, disabled, inserted, or removed according to Cordis patch semantics

### Requirement: Evolution is an independently mountable actor-aware row
`@doppelganger/doppelganger-evolution` SHALL expose a native Cordis Loader plugin named `doppelganger-evolution`. The row SHALL declare required injection of `doppelgangerRuntimeSession`, `doppelgangerActor`, `doppelgangerPersona`, `doppelgangerContext`, `doppelgangerTools`, and `doppelgangerInstanceSqlite`, and authored Runtime Presets SHALL isolate each session-scoped service in the same Runtime Session realm. The plugin SHALL own Evolution configuration, ledger schema, migrations, project proposal assets, context, and tools without adding Evolution behavior to composition-runtime, host packages, Persona, memory, SQLite infrastructure, or Dynamic Runtime Plugins.

#### Scenario: Full Evolution row activates
- **ID**: `loader.evolution.complete-row`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::activates an arbitrary isolated Runtime Preset and remains neutral when omitted`
- **WHEN** a Runtime Preset mounts Evolution with all declared dependencies and matching isolation
- **THEN** audited activation exposes one actor-partitioned Evolution service and its optional context and tools

#### Scenario: Actor binding is absent
- **ID**: `loader.evolution.unbound-actor`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::reports missing injection, rejects an unbound actor, and commits valid watched configuration changes`
- **WHEN** a Runtime Preset mounts Evolution in a Runtime Session whose protected host bridge is unbound
- **THEN** the Evolution row fails activation visibly rather than inventing an actor, using the session ID, or falling back to unpartitioned state

#### Scenario: Evolution dependency is missing
- **ID**: `loader.evolution.missing-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::reports missing injection, rejects an unbound actor, and commits valid watched configuration changes`
- **WHEN** an authored composition mounts Evolution without one required service or matching isolation realm
- **THEN** Loader activation remains pending or fails with the unresolved Evolution row identified

### Requirement: Evolution installation is package-based and preset-neutral
The Evolution implementation SHALL be consumable through its declared workspace/npm package exports and SHALL NOT require copying repository source, importing a file path, selecting a named Runtime Preset, or modifying a host adapter. Installation SHALL make the package resolvable; activation SHALL remain an explicit Loader-row choice in a user or deployment Runtime Preset. Marketplace publication, automatic package installation, dependency solving, and automatic Runtime Preset mutation remain outside this capability.

#### Scenario: Installed package remains inactive by default
- **ID**: `loader.evolution.install-without-compose`
- **EVIDENCE**: `scripts/tests/evolution-package.spec.ts::installs into an external consumer, resolves the bare Loader export, stays inert until composed, and activates`
- **WHEN** the Evolution package is installed but no selected Runtime Preset composes its Loader entry
- **THEN** it registers no Cordis service, context, tools, storage, or background behavior

#### Scenario: Generic user preset composes Evolution
- **ID**: `loader.evolution.preset-neutral`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::activates an arbitrary isolated Runtime Preset and remains neutral when omitted`
- **WHEN** an arbitrary compatible user Runtime Preset names the installed package and supplies its required rows
- **THEN** Evolution activates without a Mark-specific aggregate, host-specific construction, or private source path
