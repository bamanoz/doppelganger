## MODIFIED Requirements

### Requirement: Kernel-only public interface
The kernel package SHALL expose composition canonicalization, one validated protected-composition activation interface, session metadata, diagnostics, reload, and disposal contracts while excluding host-specific activation request schemas and all Persona, actor, memory, context assembly, tool, lifecycle, MCP, persistence, or native host fact contracts. The protected-composition interface SHALL accept a complete deterministic Cordis Loader entry tree plus its runtime-owned module bindings as one unit and SHALL NOT expose separate plugin and isolation maps whose correspondence callers must maintain.

#### Scenario: Consume kernel independently
- **ID**: `composition.runtime.consume-kernel-independently`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::defines a domain-neutral protected composition without host imports`
- **WHEN** a downstream host package imports the kernel public entry point
- **THEN** it can activate a generic authored composition plus one protected composition without importing any domain extension, host package, or host-specific discriminator

#### Scenario: Legacy parallel maps are supplied
- **ID**: `composition.runtime.protected-composition.clean-cutover`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::exposes only the unified protected composition activation contract`
- **WHEN** a caller attempts to use the removed `runtimePlugins` or `runtimePluginIsolation` activation fields
- **THEN** the public TypeScript and runtime admission contracts reject them and every repository caller uses the unified protected composition

### Requirement: Protected host integration and layered audit
A Runtime Session activation MAY supply one complete protected composition owned by its adapter. Composition Runtime SHALL validate and insert that composition after every caller-controlled base, Runtime Patch, and explicit host patch as one deterministic final Loader layer. It MAY contain the shared Runtime Host bridge, narrow typed host-session fact providers, a separate Actor Identity extension in absent, unbound, or bound deployment state, and explicitly typed host-specific providers; none SHALL be folded into another provider's public contract. Authored layers SHALL NOT forge, replace, remove, target, or configure protected entries. Every declared injection and isolated service realm SHALL resolve only inside the owning Runtime Session, and the fully layered tree SHALL pass the ordinary activation audit before the Runtime Session is returned.

#### Scenario: Mount shared host bridge through the protected composition
- **ID**: `composition.runtime.mount-shared-host-bridge-last`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** a valid effective composition is activated by any supported host
- **THEN** the runtime inserts the complete protected composition after caller-controlled layering, isolates its services to the session, and audits all entries before returning the session

#### Scenario: Mount host-specific sibling extension
- **ID**: `composition.runtime.mount-host-specific-sibling-provider`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::settles dependent host extensions through the protected Loader tree`
- **WHEN** an adapter supplies a typed native capability extension beside the shared bridge
- **THEN** both entries activate through Cordis dependency settlement in deterministic order and authored layers cannot replace either entry

#### Scenario: Mount Actor Identity through a Host Extension
- **ID**: `composition.runtime.mount-actor-provider-beside-the-bridge`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** the protected composition installs Actor Identity in unbound or bound state
- **THEN** the separate extension provides `doppelgangerActor` in its session isolation realm while the shared bridge remains actor-neutral; omission leaves the service absent

#### Scenario: Empty authored composition receives host integration
- **ID**: `composition.runtime.empty-composition-receives-host-integration`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **WHEN** the selected Runtime Preset contains an empty Loader list
- **THEN** the protected composition still activates without requiring a preset-authored placeholder or mount point

#### Scenario: Protected extension has unresolved dependency
- **ID**: `composition.runtime.protected-provider-has-unresolved-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::exhausts protected and authored cleanup when a host extension fails`
- **WHEN** a bridge or Host Extension entry has a failed or unresolved dependency
- **THEN** activation fails, cleans the complete attempted tree, and reports the exact protected entry and missing service without returning a partially attached binding
