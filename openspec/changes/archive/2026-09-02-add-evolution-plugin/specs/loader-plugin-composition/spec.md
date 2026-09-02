## ADDED Requirements

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
