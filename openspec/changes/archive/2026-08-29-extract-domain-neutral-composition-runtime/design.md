## Context

The current implementation already delegates composition and lifecycle mechanics to Cordis Loader, Include, HMR, and Fiber. However, one package currently exports kernel contracts, protocol modules, persona selection, identity, traits, memory, and SQLite infrastructure together. Kernel activation also carries persona-shaped metadata and asks callers to supply Loader internals (`builtins`, patches, and `hostGroupId`).

The completed Aiden/OMP vertical establishes behavior that must survive the extraction: isolated concurrent sessions, structured activation diagnostics, rollback on invalid reload, dynamic tools, scoped persistent memory, and child-process failure isolation.

## Goals / Non-Goals

**Goals:**
- Establish a small domain-neutral kernel with a deep activation/session interface.
- Make named mount points the stable seam between compositions and host/domain extensions.
- Make package ownership match conceptual ownership.
- Preserve existing vertical behavior through a clean breaking cutover.
- Keep Cordis as the sole DI, plugin, scope, and lifecycle system.

**Non-Goals:**
- Introduce a second plugin or capability framework.
- Hide Cordis plugins from extension authors.
- Sandbox untrusted plugins.
- Add another host, semantic memory, or new persona behavior.
- Preserve compatibility aliases for the prototype contracts.

## Decisions

### 1. Split the system by ownership, not by every plugin

Use these package-level modules:

```text
packages/
├── composition-runtime
├── extension-protocols
├── extension-sqlite
├── extension-persona
├── extension-memory
├── host-omp
└── preset-aiden
```

`extension-protocols` contains the related context, tools, and normalized lifecycle contracts for now. Splitting each into a package would add package-management weight without independent consumers. They can split later when a real dependency boundary appears.

Alternative: keep one `runtime` package with subpath exports. Rejected because it permits accidental cross-layer imports and leaves ownership unclear.

### 2. Keep the kernel interface centered on Cordis compositions

The public kernel concepts are:

```ts
interface CompositionDefinition {
  id: string
  revision: string
  loaderPath: string
  imports: Readonly<Record<string, CordisPlugin>>
  mounts: Readonly<Record<string, MountPoint>>
}

interface MountPoint {
  target: string
  required?: boolean
}

interface CompositionActivation {
  composition: CompositionDefinition
  sessionId: string
  mounts: Readonly<Record<string, CordisPlugin>>
}

interface CompositionRuntime {
  activate(request: CompositionActivation): Promise<CompositionSession>
  dispose(): Promise<void>
}
```

The precise `MountPoint.target` representation may use a Loader entry identifier internally, but callers supplying mounts do not construct patches. Composition authors declare placement once; activation callers supply only named plugins.

Alternative: accept arbitrary Cordis plugins with no named mounts. Rejected because the composition then has no explicit contract for required extension seams.

Alternative: introduce host capabilities. Rejected until a second host provides evidence for what varies.

### 3. Compile named mounts to private Loader patches

The kernel validates supplied names against declared mount points, checks required mounts, assigns reserved private import names, and compiles them into Include patches. Raw `patches`, `hostGroupId`, and runtime-added `builtins` are not public activation inputs.

Composition-local plugin imports remain explicit because declarative Loader trees need a deterministic import catalog. Reserved kernel import names cannot be overridden.

### 4. Replace activation metadata with extension mounts

The kernel owns only the neutral `sessionId` needed to identify its lifecycle scope. It does not provide instance, project, definition-root, or storage paths.

The persona extension creates an immutable persona-activation Cordis plugin containing:

```text
instanceId
instanceHome
definitionRoot
projectId?
projectRoot?
```

That plugin is supplied through a persona-declared mount. Other domains can define their own metadata plugins without changing the kernel.

Alternative: generic `Record<string, unknown>` kernel metadata. Rejected because it creates an untyped service-locator contract and still makes the kernel own domain transport.

### 5. Preserve isolation, audit, reload, and disposal in the kernel

These behaviors are domain-neutral and remain together:

- one session-owned Fiber subtree per activation;
- unique isolation namespaces for declared isolated Cordis services;
- complete post-settlement audit before activation succeeds;
- serialized refresh with rollback to the previous valid Loader data;
- watcher ownership and deterministic idempotent disposal.

Composition definitions may declare isolation labels used by their plugin tree. The kernel namespaces those labels per session but does not know their domain meaning.

### 6. Extract extensions with explicit dependency direction

Allowed dependencies:

```text
preset-aiden ─────────────┐
host-omp ─────────────────┼──> composition-runtime
extension-persona ────────┤
extension-protocols ──────┤
extension-sqlite ─────────┘
extension-memory ──> extension-persona + extension-protocols + extension-sqlite
preset-aiden ──────> persona + memory + protocols
```

The kernel imports none of the extensions. `host-omp` can depend on protocol contracts and the kernel, but not on persona or memory.

### 7. Rename storage according to its actual seam

`StorageService` becomes `InstanceSqliteService` in `extension-sqlite`. Its interface remains intentionally SQLite-specific: open one namespace-owned database under a supplied extension-owned home directory, bind connection cleanup to Cordis lifecycle, and provide synchronous transactions.

The home path is configuration supplied by the persona composition or another owning extension; the kernel does not define it.

Alternative: embed database opening directly in memory. Rejected because instance-relative placement and lifecycle cleanup are reusable infrastructure already exercised by persistent extensions.

### 8. Make Aiden a preset, not a kernel fixture

`preset-aiden` owns the declarative composition, identity, traits, selected extensions, and mount declarations. The OMP adapter resolves a selected persona through `extension-persona`, supplies the persona metadata mount and OMP host mount, then activates the resulting generic composition.

The child JSON-RPC protocol carries a neutral composition activation payload. Persona resolution may occur before the child request, but the child runtime itself invokes only the generic kernel interface.

### 9. Use a clean cutover

Remove old symbols and migrate all callers and tests in one change. No aliases for `AgentRuntime`, `RuntimeDefinition`, `ActivationMetadataPlugin`, `hostGroupId`, or public raw patches remain.

Tests move with ownership: kernel contracts into `composition-runtime`, extension behavior into each extension package, and only cross-package vertical scenarios remain in `host-omp`.

## Risks / Trade-offs

- **[Mount declarations mirror Loader placement]** → Keep target representation confined to composition authoring; activation callers see names only, and add behavior tests that compile mounts into the expected tree.
- **[Many packages add workspace overhead]** → Use one package per genuine ownership/dependency seam, keeping related protocols together.
- **[Extraction can silently weaken vertical behavior]** → Retain the real Aiden/OMP acceptance suite as the final migration gate.
- **[Persona selection and child activation may become awkwardly split]** → Keep selection in `extension-persona`; serialize only the resolved neutral composition and required extension mount configuration across RPC.
- **[SQLite naming still ties one extension to persona instances]** → Define the module around an owner-supplied home path; `Instance` names the persistence lifetime, not a kernel persona concept.

## Migration Plan

1. Introduce `composition-runtime` and prove generic composition activation, named mounts, isolation, audit, reload, and disposal independently of persona modules.
2. Extract protocols and SQLite infrastructure without changing behavior.
3. Extract persona selection/metadata/identity/traits and memory into extension packages with one-way dependencies.
4. Move Aiden assets and composition declaration into `preset-aiden`.
5. Change OMP child RPC and adapter activation to the neutral composition interface.
6. Migrate all callers and delete the former `packages/runtime` exports and obsolete contracts.
7. Run package-level contract tests, dependency-direction checks, and the complete real Aiden/OMP vertical acceptance suite.

Rollback during development is a source-level revert of the clean cutover. There is no production data migration: existing SQLite paths and schemas remain unchanged.
