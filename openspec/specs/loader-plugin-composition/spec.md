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

### Requirement: Mark is a declarative Runtime Preset
The shipped development Mark Runtime Preset SHALL directly list ordinary Doppelganger plugin rows, including the complete local semantic-memory stack, and SHALL colocate its identity and trait assets in its Runtime Preset directory. No Mark-specific TypeScript aggregate plugin SHALL be required to activate Mark.

#### Scenario: Mark composition is inspected
- **ID**: `loader.mark.rows`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::exposes every Mark feature as an independently patchable Loader row`
- **WHEN** a maintainer reads Mark's `runtime.cordis.yml`
- **THEN** the effective Persona, context, tools, SQLite, memory, local embedder, exact vector index, and semantic coordinator features are visible as independently addressable Loader rows

#### Scenario: Mark feature is patched
- **ID**: `loader.mark.patch`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::applies ordered whole-field replacement and later targets inserted rows`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::exposes every Mark feature as an independently patchable Loader row`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid Runtime Patch targets a Mark feature row by ID
- **THEN** only that row's complete Loader configuration is replaced, disabled, inserted, or removed according to Cordis patch semantics
