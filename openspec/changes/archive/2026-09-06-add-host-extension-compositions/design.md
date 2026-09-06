## Context

Doppelganger already has two composition layers with different trust: user/project-owned Runtime Presets and a final runtime-owned protected set. The protected set is currently supplied to `CompositionRuntime.activate()` as parallel `runtimePlugins` and `runtimePluginIsolation` records. OMP manually inserts Actor Identity, its native event provider, and the shared Runtime Host bridge. OpenClaw manually resolves native route mappings, passes `actorId` into direct activation, and inserts Actor Identity plus the bridge. The planned DeepSeek Harness adapter repeats the same pattern.

This direction preserves authority correctly, but the interface is shallow: each adapter must know plugin factories, service names, isolation lists, deterministic entry IDs, and bootstrap ordering. A new actor-like protocol, account binding, tenant binding, conversation identity, or host-native event provider would repeat that knowledge in every adapter that supports it.

The system already documents typed host-specific protected plugins, but it lacks a first-class composition seam for them. The change deepens that seam without moving actor fields into the shared bridge or allowing Runtime Presets to control trusted host state.

## Goals / Non-Goals

**Goals:**

- Give every adapter one compositional interface for the shared bridge, typed host-session facts, Actor Identity, and additional host-specific providers.
- Reuse Cordis Loader dependency injection, isolation, Fibers, effects, diagnostics, audit, and disposal.
- Keep Host Extension configuration and module selection independent from Runtime Preset selection and patches.
- Make Actor Identity an ordinary optional Host Extension consumer/provider chain rather than special bootstrap code in each adapter core.
- Prove the seam with two distinct extensions: Actor Identity and OMP native events.
- Preserve the actor-neutral Runtime Host API and domain-neutral Composition Runtime.
- Make future host adapters, including DSH, consume the same seam before implementation diverges.

**Non-Goals:**

- No actor authentication framework, account database, user onboarding, dynamic actor switching, or universal principal resolver.
- No raw OpenClaw, OMP, or DSH runtime service inside Runtime Sessions.
- No generic host event bus or arbitrary notification envelope.
- No Runtime Preset authority to install Host Extensions.
- No second Host Extension process, bridge, RPC peer, sidecar, or transport.
- No hot reload of Host Extension selection, configuration, or identity inside a Runtime Session.
- No Runtime Host protocol-version change.
- No feature changes to Memory, Evolution, Persona, MCP, or Dynamic Runtime Plugins.

## Decisions

### 1. Add a separate Host Extension Composition, not fields on Runtime Presets

Each adapter constructs one complete Host Extension Composition from trusted bootstrap code and deployment-owned configuration. It is activated after the authored Runtime Preset plus user/project/host patches as the final protected Loader layer.

```text
trusted host bootstrap/configuration
              │
              ▼
Host Extension Composition
  ├─ native session facts
  ├─ Actor Identity extension (optional)
  ├─ host-native event extensions (optional)
  └─ shared Runtime Host bridge
              │ protected final layer
              ▼
Runtime Session ← authored Runtime Preset below it
```

The Host Extension Composition uses the same Cordis execution model as the authored composition, but not the same control plane. Runtime Preset roots, project manifests, patches, and model tools cannot select or mutate it. An empty optional extension tree is valid; the shared bridge remains an adapter-owned protected entry when the selected Runtime Preset activates.

Alternative: add host extensions to Runtime Preset YAML. Rejected because a user-authored preset could assign `actorId`, tenant, approval, or native lifecycle authority.

Alternative: introduce a second Runtime Preset roster with host-extension roots. Rejected for the first implementation because it duplicates discovery and authoring policy. Host packages may accept a trusted Loader tree or programmatically construct one; package discovery policy remains host-owned until a concrete deployment needs a shared roster.

### 2. Replace parallel plugin/isolation maps with one deep protected-composition interface

`CompositionRuntime.activate()` will replace:

```ts
runtimePlugins?: Readonly<Record<string, Plugin>>
runtimePluginIsolation?: Readonly<Record<string, readonly string[]>>
```

with one unified input:

```ts
interface ProtectedComposition {
  readonly entries: readonly ProtectedCompositionEntry[]
}

interface ProtectedCompositionEntry {
  readonly id: string
  readonly plugin: Plugin
  readonly isolate?: Readonly<Record<string, 'session'>>
}
```

These public names are fixed. Entry ID, plugin implementation, and provided/consumed service isolation travel together; input is validated and frozen, explicit entry order is preserved, and the entries become one final Loader layer. The implementation continues using Cordis virtual module imports internally. Callers never maintain correlated maps.

A Host Extension plugin can itself use Loader/Include composition behind its entry, so this interface does not prevent deeper host-owned trees. The first cutover deliberately avoids a general filesystem Host Extension roster.

Alternative: infer provided services by observing `ctx.provide()`. Rejected because isolation must exist before plugin execution and runtime observation would make activation ordering unsafe.

Alternative: keep the parallel maps and add convenience helpers in each host. Rejected because the shallow public interface and split invariant would remain.

### 3. Separate native session facts from semantic Host Extensions

The core adapter owns facts only it can know reliably. Each host package defines a closed namespaced fact service:

```ts
interface OpenClawHostSessionFacts {
  readonly agentId: string
  readonly sessionKey: string
  readonly sessionId: string
  readonly workspaceRoot: string
}
```

The exact fact types remain in their owning host packages and are immutable per Runtime Session. They expose no native object references or mutation methods.

Host Extensions convert those facts plus deployment-owned configuration into semantic services. The OpenClaw Actor extension owns exact route mapping and provides `doppelgangerActor`. The core OpenClaw adapter owns binding epochs and native lifecycle but no longer imports the Actor Identity plugin factory or actor-aware feature logic.

OMP already admits optional `actorId` at its transport boundary. The child exposes that admitted value as an immutable OMP session fact; the OMP Actor extension converts it to bound or unbound Actor Identity. This preserves transport validation without pretending OMP and OpenClaw share a principal-resolution algorithm.

Alternative: define one universal `HostPrincipalFacts` contract. Rejected because authenticated account IDs, installation IDs, route mappings, and explicit unbound state have different authority and lifecycle semantics.

### 4. A host-neutral control plane owns catalog, selection, planning, and instantiation

A new `host-extension-runtime` package owns the mechanics shared by adapters. It depends only on Cordis and Composition Runtime contracts and imports no Actor Identity, feature, or concrete host package.

The public names are fixed:

```ts
const HOST_EXTENSION_PROTOCOL_VERSION = 1

interface HostExtensionModule {
  readonly protocolVersion: 1
  readonly definitions: readonly HostExtensionDefinition[]
}

interface HostExtensionDefinition {
  readonly id: string
  readonly hostKind: string
  readonly normalizeConfig: (input: unknown) => JsonValue
  create(config: JsonValue): ProtectedCompositionEntry | readonly ProtectedCompositionEntry[]
}

interface HostExtensionSelection {
  readonly id: string
  readonly config?: JsonValue
}

interface HostExtensionCatalog {
  readonly hostKind: string
  readonly definitions: readonly HostExtensionDefinition[]
}

interface HostExtensionPlan {
  readonly hostKind: string
  readonly selections: readonly HostExtensionSelection[]
  instantiate(): ProtectedComposition
}
```

Concrete hosts use `OmpHostSessionFacts`, `OpenClawHostSessionFacts`, and future `DshHostSessionFacts` for their closed immutable fact services. They do not add a Host Extension roster or reuse `RuntimePresetRoster` terminology.

1. A **package author** exports a versioned module containing definitions for one exact `hostKind`.
2. A **deployment operator** installs packages and lists exact module specifiers plus selected definition IDs/configuration in host-native trusted configuration.
3. The **Host Adapter bootstrap** imports only those exact module specifiers, validates module protocol version, host kind, IDs, duplicates, config normalizers, and definition shape, then freezes one process/deployment-scoped available catalog.
4. The control plane resolves selected IDs against that catalog, normalizes JSON-compatible configuration, rejects unknown or repeated selections, preserves explicit order, and freezes one `HostExtensionPlan` before native sessions are served.
5. The **Host Adapter binding manager** snapshots one native session's facts and narrow capability providers, asks the plan to create fresh protected plugin entries, and adds the shared bridge entry.
6. **Composition Runtime** activates and disposes the completed protected composition; it does not discover packages, select definitions, or interpret host configuration.

Definitions receive normalized configuration only. They do not receive native session objects through their factory. At activation their Cordis plugins explicitly inject host-owned fact or capability services supplied as separate protected entries. This keeps dependencies auditable and lets Cordis reject a missing capability.

The catalog and plan are immutable. There is no process-global mutable registration API: adapter bootstrap passes imported modules explicitly when constructing the catalog. Each Runtime Session receives newly created plugin entries, so sessions share definition code and frozen configuration but no mutable plugin instance, Fiber, handler, or effect.

No automatic filesystem scan, npm marketplace lookup, package installation, or cross-host extension manifest is included. Exact module specifiers are deployment input and package installation remains operator-owned.

For OpenClaw, preparation imports and validates the complete allowed module set and emits static imports plus prepared definition metadata into the generated artifact. Runtime OpenClaw configuration can enable and configure only those prepared IDs; an unknown ID requires regeneration and restart. Actor mappings remain runtime configuration and are not copied into portable tool catalog data.

For OMP, the trusted OMP adapter bootstrap imports the exact configured module list before creating child bindings and serializes only the frozen selection/configuration plan plus host-owned session inputs needed by the child. Runtime Presets and project manifests cannot add modules.

Alternative: let operator configuration name arbitrary modules for every session. Rejected because module resolution would become session work, failures could vary between sessions, and OpenClaw's prepared artifact could not prove its executable closure.

Alternative: require the host package to hard-code every definition. Rejected because it prevents installed third-party Host Extensions and recreates adapter changes for each new provider.

Alternative: expose a mutable global registration function. Rejected because import order would affect the catalog and tests or sibling adapters could leak definitions across deployments.

Alternative: put every Host Extension in `extension-protocols`. Rejected because host-specific facts and native event semantics would reverse package dependency direction.

### Ownership and creation sequence

| Phase | Owner | Durable input | Output |
| --- | --- | --- | --- |
| Package production | Host Extension package author | Definition ID, exact host kind, protocol version, config normalizer, plugin factory | Installable Host Extension module |
| Installation | Deployment operator | Exact package/version selected by normal package management | Installed trusted code |
| Availability | Host Adapter bootstrap | Exact module specifiers from host-native configuration or generated artifact | Immutable available-definition catalog |
| Selection | Deployment operator | Ordered definition IDs and configuration | Host-native selection input |
| Planning | Host Extension control plane | Catalog plus operator selection | Validated frozen deployment-scoped plan |
| Session creation | Host Adapter binding manager | Plan plus immutable native session facts and narrow capability providers | Fresh protected Host Extension Composition |
| Activation | Composition Runtime | Authored composition plus protected composition | Audited isolated Runtime Session |
| Replacement | Host Adapter binding manager | Native identity/configuration/generation change | Old session disposal followed by fresh composition |
| Cleanup | Composition Runtime and Cordis | Session ownership tree | Quiescent Fibers, effects, providers, bridge, and extensions |

This table is normative for ownership. The operator chooses code and configuration; the adapter authenticates its configuration source and constructs the deployment/session plans; the control-plane package validates composition mechanics; Composition Runtime owns execution lifecycle only.

### 5. Actor Identity remains a common protocol, resolution remains host-specific

`extension-protocols` continues to own only:

```ts
type ActorIdentity =
  | { readonly state: 'bound'; readonly actorId: string }
  | { readonly state: 'unbound' }
```

and validation/provider helpers. OMP, OpenClaw, and DSH Actor Host Extensions resolve their own inputs and expose that interface. Absence, explicit unbound, and bound remain distinct. Actor-aware persistent plugins still fail before storage when absent or unbound.

This preserves the real seam demonstrated by multiple adapters while avoiding a fake shared principal resolver.

### 6. Host Extension state is immutable; replacement uses Runtime Session ownership

The protected composition is snapshotted at activation and is not rebuilt by Runtime Preset HMR. A change to extension modules, configuration, actor mapping, account binding, or host session facts causes the adapter to retire the binding and activate a new Runtime Session.

This matches Actor Identity immutability and prevents identity or authority from changing beneath live tool closures, approvals, context caches, or persistent feature services. Composition Runtime reload continues to rebuild only authored generations under the same protected layer.

### 7. Every Host Extension reuses the adapter's existing binding or transport

Direct adapters expose bounded callbacks/facts through the same in-process binding. OMP transports typed extension messages over its existing framed peer. The OMP native event provider migrates into the Host Extension Composition but keeps the current peer and lifecycle owner.

A Host Extension never receives raw host runtime access merely because it is trusted. New authority requires a narrow typed contract owned by the host package. A second channel is rejected.

### 8. Clean migration across all active host work

Implementation order:

1. Add and test the unified protected-composition contract in `composition-runtime`.
2. Migrate protocol test fixtures and common Runtime Host conformance.
3. Migrate OMP bridge, Actor Identity, and native event provider.
4. Integrate the completed OpenClaw adapter, then extract OpenClaw Actor resolution into its Host Extension.
5. Rewrite the active DSH planning artifacts before implementation so DSH starts on the new seam.
6. Remove `runtimePlugins` and `runtimePluginIsolation` with no aliases or deprecated path.
7. Reconcile current documentation and active OpenSpec deltas before archive.

The `add-openclaw-host` change must be integrated before code application because this proposal modifies its resulting host capability. The DSH change is still planning-only and should be updated rather than implementing the superseded direct actor bootstrap.

## Risks / Trade-offs

- **More concepts in activation** → Host Extension Composition adds terminology. Mitigation: expose one deep interface and delete two shallow maps; document the two trust planes once.
- **Accidental second user configuration system** → A generic roster could duplicate Runtime Presets. Mitigation: no shared Host Extension discovery/authoring system in the first implementation; each host owns trusted assembly.
- **Fact services become raw-host escape hatches** → Extensions could accumulate native authority. Mitigation: closed immutable JSON-compatible facts, host-package ownership, no object handles, and contract tests for exact keys.
- **Extension dependency cycles** → A Loader composition can create unresolved graphs. Mitigation: ordinary Cordis settlement plus full protected-layer activation audit and exhaustive cleanup.
- **Identity changes during reload** → Hot replacement could cross persistence partitions. Mitigation: Host Extension configuration is immutable; changes require Runtime Session replacement.
- **OpenClaw artifact drift** → Prepared tools and host extensions have different deployment boundaries. Mitigation: record them separately, validate both at startup, and never put actor mappings or secrets in the portable catalog.
- **Active-change conflicts** → OpenClaw and DSH artifacts currently describe manual actor bootstrap. Mitigation: explicit sequencing and reconciliation tasks; do not archive contradictory live specs.
- **Over-generalization from Actor Identity** → A universal identity broker would be shallow and semantically false. Mitigation: host-specific fact and resolver extensions behind small typed protocols.
