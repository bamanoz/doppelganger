## Context

The generic runtime already discovers and selects Runtime Presets, activates one isolated Loader tree per Runtime Session, layers patches, audits activation, and appends a protected host bridge. Aiden, however, is represented by one `AidenPresetPlugin` row that imperatively mounts Persona, protocols, SQLite, memory, capture, identity, and traits. This hides feature rows from composition inspection and Cordis patches.

DeepSeek Harness uses two relevant patterns. Its agent-presets plugin is a control-plane roster and mount coordinator, while each Agent Preset is a declarative `agent.cordis.yml` tree. It separates Service Definition, Service Provider, and Consumer packages only when those roles evolve independently; cohesive product features such as plan mode keep state, prompt, tools, commands, and lifecycle handling in one plugin. Doppelganger should adopt both patterns without copying DSH's standing-mount lifetime, because Doppelganger's current contract requires isolated Runtime Session trees.

The change crosses every public package and Loader definition. It must preserve one workspace Cordis identity, NodeNext ESM imports, exact optional properties, JSON-compatible host boundaries, transactional reload, memory persistence, and the generic host seam.

## Goals / Non-Goals

**Goals:**

- Make Aiden a transparent declarative Runtime Preset of ordinary Loader rows.
- Establish the `@doppelganger/doppelganger-*` package naming convention through a clean cutover.
- Extract Runtime Preset roster responsibilities from composition activation responsibilities.
- Provide one Loader-compatible Persona row and one cohesive Loader-compatible memory row.
- Keep candidate capture independently selectable without creating micro-packages for tools and recall.
- Preserve existing runtime, OMP, Persona, memory, persistence, and reload behavior end to end.

**Non-Goals:**

- Implement the native DeepSeek Harness host or adopt DSH standing preset mounts.
- Add preset copying, deletion, UI pickers, marketplace distribution, or generated-code authoring.
- Add alternative memory stores, semantic providers, extractors, or model-facing behavior.
- Change Runtime Preset selection precedence, patch precedence, Runtime Session metadata, memory policy, or capture defaults.
- Keep aliases for prior package names or `AidenPresetPlugin`.

## Decisions

### 1. Split roster control plane from composition runtime

Create `@doppelganger/doppelganger-runtime-presets` from the discovery, validation, configuration, metadata, and selection code currently in `composition-runtime/src/runtime-presets.ts`. `@doppelganger/doppelganger-composition-runtime` retains composition definitions, patch composition, activation, session metadata, audit, reload, and teardown.

The initial roster interface may remain host-callable library functions plus a Cordis service/plugin entry suitable for a native host. OMP consumes the host-neutral roster API and does not inject roster behavior into a child Runtime Preset.

Alternative: leave the functions in composition-runtime. Rejected because discovery/selection is a control-plane lifecycle and future hosts need the roster without coupling it to activation internals.

### 2. Use product-prefixed npm packages and clean cutover

Rename packages to:

- `@doppelganger/doppelganger-runtime-presets`
- `@doppelganger/doppelganger-composition-runtime`
- `@doppelganger/doppelganger-protocols`
- `@doppelganger/doppelganger-persona`
- `@doppelganger/doppelganger-sqlite`
- `@doppelganger/doppelganger-memory`
- `@doppelganger/doppelganger-host-omp`

Protocol context and tool registries remain one npm package because their shared transport-neutral vocabulary and lifecycle boundary already form a coherent package. They expose Loader-compatible package subpaths only where the root cannot unambiguously represent one plugin, rather than creating `doppelganger-context` and `doppelganger-tools` npm micro-packages. Exact subpaths and root defaults must be chosen so every YAML row resolves through a public export map.

Alternative: create one npm package per Cordis row. Rejected because DSH splits packages for independently evolving roles, not merely for every registration, and the resulting manifest/documentation overhead would exceed current leverage.

Alternative: keep old aliases. Rejected because repository policy requires a clean cutover and aliases would leave two conventions.

### 3. Make Persona one public Loader row

The persona package root becomes a Loader-compatible plugin configured with `instanceId`, `principalId`, optional project identity, asset root, identity, and ordered traits. It creates the immutable Persona Activation and owns file-backed instruction contributions and HMR handling within one fiber.

Internal activation, identity loading, and trait loading modules remain separate for locality and tests. They are not independently authored rows because no current Runtime Preset benefits from activation without its authored identity behavior, and DSH exposes Persona as one row.

Alternative: retain activation, identity, and traits as three public rows. Rejected as a shallow public interface that forces every preset to reproduce internal ordering and injection knowledge.

### 4. Keep memory cohesive; split capture only

The memory package root becomes one Loader-compatible plugin that starts `MemoryService`, registers all memory tools, and registers automatic recall context. Internal modules remain separate, but one row owns their common lifecycle and disposal.

Candidate capture remains a second plugin at `@doppelganger/doppelganger-memory/capture`. Capture is independently optional, consumes a different lifecycle seam, owns extractor and bounds policy, and creates candidates only. Absence of this row is the disabled state; an `enabled` field may remain for explicit policy and patchability if existing configuration requires it.

Alternative: separate `memory-tools` and `memory-context` rows. Rejected because no second Consumer or independent evolution currently exists. DSH keeps prompt guidance beside a tool when it is one model-facing capability and explicitly advises against preemptive seams.

Alternative: fold capture into memory. Rejected because Aiden intentionally disables capture while retaining direct memory and recall, proving independent composition value.

### 5. Make Aiden data plus composition

Move `identity.md` and trait assets under `dev/doppelganger/.runtime-presets/aiden/`. Rewrite `runtime.cordis.yml` to list protocol, Persona, SQLite, memory, and capture rows directly with stable `doppelganger-*` IDs. Remove the `preset-aiden` workspace package after all tests use the declarative preset or generic fixtures.

Aiden's SQLite path remains explicitly configured by the preset, and `principalId` remains authored configuration. Runtime-owned manifests and user configuration remain selection-only.

Alternative: keep an Aiden bundle package that internally mounts rows. Rejected because it restores the opacity this change is intended to remove.

### 6. Preserve Runtime Session isolation rather than DSH standing mounts

Every Doppelganger Runtime Session continues to activate an independent plugin tree. Persistence is shared only through explicitly configured plugin storage. The roster does not cache one standing plugin composition across sessions.

Alternative: copy DSH's one-standing-mount-per-preset model. Rejected because Doppelganger's host-neutral runtime contract and completed parallel-session isolation tests require independent fibers, handlers, and mutable objects.

## Risks / Trade-offs

- **Package rename blast radius** → Migrate manifests, imports, tests, Loader specifiers, extension bootstrap, boundary rules, docs, and lockfile in one cutover; search for obsolete names before verification.
- **Loader export ambiguity** → Prove every root and subpath with real Loader activation tests, not only TypeScript imports.
- **Activation-order regressions** → Express all required services through `inject`, use groups/isolation only when service realms require them, and audit missing-dependency failures.
- **Persona HMR regression** → Keep last-known-good authored content semantics and add identity/trait reload coverage through the new public row.
- **Memory lifecycle regression** → Make the root memory fiber own service, tool, and recall registrations so patch removal disposes them atomically; retain the existing domain tests.
- **Capture behavior drift** → Preserve committed-turn-only input, secret rejection, bounds, stable operation IDs, candidate-only writes, and disabled Aiden default.
- **Roster over-abstraction** → Keep the extracted interface limited to behavior already required by OMP and future native hosts; defer authoring and UI APIs.
- **More rows in authored presets** → Accept the verbosity because rows become inspectable and patchable; provide a complete shipped Aiden example and deterministic IDs.
