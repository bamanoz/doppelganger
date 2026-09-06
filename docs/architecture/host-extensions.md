# Host Extensions

Host Extensions are the trusted host-owned control plane for the final protected layer of a Runtime Session. They compose the shared Runtime Host bridge, optional Actor Identity, and typed host-native providers without giving Runtime Presets authority over host identity, bindings, transports, or native capabilities.

## Definition and module contract

`@doppelganger/doppelganger-host-extensions` exposes API version 1. An installable module exports one `hostExtension` definition with:

- `apiVersion: 1`;
- one exact lowercase-kebab `hostKind`;
- one stable lowercase-kebab `id`;
- optional display `title`;
- a side-effect-free `normalizeConfig(input)` returning a bounded JSON-compatible value;
- `createFactory(config)`, returning a factory that creates one fresh Cordis plugin entry for a Runtime Session.

The session factory receives only stable `sessionId`, selected `runtimePresetId`, optional absolute `workspaceRoot`, and closed JSON-compatible host facts whose `hostKind` must equal the catalog host. It returns a Cordis plugin plus an optional colocated map of services isolated in the `session` realm. Reusing one mutable plugin object across Runtime Sessions is rejected.

Definitions contain executable trusted code. API validation, exact host-kind matching, JSON admission, and isolation constrain composition mistakes; they are not a security sandbox.

## Catalog, selection, and instantiation

Each adapter constructs an immutable catalog from an explicit definition list and one exact host kind. Catalog construction validates every definition, rejects wrong-host definitions and duplicate IDs, and sorts available definitions deterministically. There is no process-global registration API, filesystem scan, package installer, marketplace lookup, or second Runtime Preset roster.

Trusted host-native configuration supplies an ordered selection of definition IDs and optional configuration. Planning rejects unknown and duplicate selections, normalizes and clones each configuration, creates immutable factories, preserves selection order, and returns one frozen plan. A restored serialized plan revalidates the same selected definitions and JSON values.

For every Runtime Session, the adapter snapshots closed host facts and asks the plan to instantiate a fresh `ProtectedComposition`. Composition Runtime validates the complete protected composition before creating a Fiber, appends it after every authored layer, waits for ordinary Cordis dependency settlement, audits every enabled protected entry, and owns exhaustive cleanup.

## Ownership and trust split

| Boundary | Owner |
| --- | --- |
| Package installation and exact module specifiers | Deployment operator |
| Module import and host-kind admission | Concrete host adapter |
| Available catalog and normalized selection plan | Host Extension runtime |
| Native session facts, binding, and narrow host capabilities | Concrete host adapter |
| Fresh protected entry creation | Selected Host Extension factories |
| Activation, audit, reload beneath the protected layer, and disposal | Composition Runtime and Cordis |
| Runtime Preset roots, selection, patches, and feature configuration | Runtime Preset roster and authored Loader tree |

Runtime Presets, project manifests, Runtime Patches, prompts, and model-invocable tools cannot add, select, target, replace, or remove Host Extensions. Protected entry IDs and virtual imports are reserved. A Host Extension module/configuration, actor mapping, native identity, or fact change requires the adapter to retire the old Runtime Session and instantiate a new protected composition. Runtime Preset HMR keeps the existing protected composition immutable.

## Standard definitions

The package supplies reusable definition builders, not universal host policy:

- `createRuntimeHostExtension` creates the actor-neutral shared Runtime Host plugin and colocates isolation for Runtime Session metadata, host capabilities, context, tools, and lifecycle services.
- `createActorIdentityHostExtension` converts one host-owned resolver result into the existing optional bound or unbound Actor Identity service and isolates `doppelgangerActor`.

Each concrete adapter supplies its exact host kind and owns the resolver, binding, and capability profile. Actor provider absence is represented by omitting the `actor` selection; it is distinct from selecting the extension with an unbound result.

## Adapter boundaries

OMP imports exact trusted module specifiers from `DoppelgangerOmpExtensionOptions.hostExtensions` before creating the child binding. The parent serializes only resolved module URLs, normalized selections, and admitted OMP facts. The child reimports the same definitions and instantiates `actor`, `omp-host-events`, `runtime-host`, and optional custom entries. All transported Host Extension messages reuse the existing framed RPC peer; no extension opens another child or connection.

OpenClaw imports and validates configured modules during artifact preparation, bundles each admitted module into `host-extensions/`, and stores separate fingerprinted `prepared-host-extensions.json` metadata. Runtime configuration may select only prepared IDs. The native adapter reconstructs the catalog from static artifact imports and instantiates fresh entries for each binding. Module or available-ID changes require artifact regeneration and native restart; actor mappings remain runtime-only configuration and are not embedded in the artifact.

The planned DeepSeek Harness adapter uses the same catalog and plan directly in-process under each agent-owned Cordis Context. Its standard `runtime-host` entry owns the single direct binding; Actor Identity remains an independently selected `actor` entry. DSH-only definitions join the same protected composition and cannot introduce a second bridge, router, sidecar, or raw runtime service.

## Host-specific authority and transport

A typed host-specific Host Extension may expose only a narrow host-namespaced Cordis service or event. Values crossing a transport are closed, bounded, JSON-compatible, validated, and correlated to the owning Runtime Session. Direct adapters may capture bounded adapter callbacks in trusted standard definitions, but external factories receive no raw gateway, registry, UI, credential store, provider, process manager, sandbox, worktree, or unrestricted event bus.

Every Host Extension reuses the adapter's one binding and, for transported hosts, its existing versioned transport and process lifecycle. A requirement for another connection to the same native host is an adapter-contract change, not an extension escape hatch. Ordinary Runtime Preset plugins may still own unrelated external transports such as MCP clients.

## Primary implementation

- `packages/host-extension-runtime/src/contracts.ts` — versioned definitions, modules, selections, plans, facts, and catalogs.
- `packages/host-extension-runtime/src/runtime.ts` — validation, host-kind admission, planning, restoration, and fresh instantiation.
- `packages/host-extension-runtime/src/standard.ts` — shared Runtime Host and Actor Identity definition builders.
- `packages/composition-runtime/src/runtime.ts` — protected composition validation, activation, audit, reload boundary, and cleanup.
- `packages/host-omp/src/host-extensions.ts` — trusted OMP module import, plan transport, and child instantiation.
- `packages/host-openclaw/src/host-extensions.ts` — preparation metadata, bundled-module reconstruction, runtime selection, and actor routing.
