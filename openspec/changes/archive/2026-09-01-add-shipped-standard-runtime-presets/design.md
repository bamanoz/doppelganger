## Context

Runtime Preset discovery currently scans only `$DOPPELGANGER_HOME/.runtime-presets`, and selection stops at explicit, project, or user-default configuration. This proves portable composition but leaves a product installation inert until somebody authors files in the home directory.

DeepSeek Harness solves the analogous problem by packaging its shipped presets beside the roster plugin, prepending that package-owned root to configured and user roots, selecting `standard` by deployment default, and allowing customization only through a complete copy into a user root. Doppelganger should adopt that user model without adopting DSH's standing shared mounts: Doppelganger still creates an independent mutable Loader tree per Runtime Session.

The existing `@doppelganger/doppelganger-runtime-presets` package is the correct owner. It is currently a pure Node discovery/selection library used by OMP before the runtime child exists. The future DSH host runs inside a Cordis Context and benefits from the same roster as a service. One package therefore needs a Cordis-free core plus an optional Cordis facade, not two competing roster implementations.

Repository constraints remain authoritative:

- `runtime-presets` stays independent of every other Doppelganger workspace package.
- Host packages remain Persona-neutral and do not name `standard` or `mark`.
- Runtime Presets remain complete portable Loader trees; the roster plugin is never included inside one.
- Relative assets resolve from the selected Runtime Preset directory, while bare plugin packages resolve from the installed Doppelganger package graph.
- `mark` remains development/user content and is not shipped as a product preset.

## Goals / Non-Goals

**Goals:**

- Make a fresh Doppelganger installation immediately usable through a packaged `standard` Runtime Preset.
- Match DSH's shipped/configured/user root model, first-root-wins identity, deployment default, copy-only authoring, and system/user mutability boundary.
- Keep one deterministic roster domain model shared by pure hosts and Cordis-native hosts.
- Preserve existing explicit, project, and user configuration behavior while adding deployment-default fallback.
- Ensure `standard` activates in an unbound, actor-neutral host session.
- Keep user customization durable and independent from package upgrades by copying rather than editing shipped content.

**Non-Goals:**

- Installing arbitrary Runtime Preset packages, resolving dependencies, maintaining lockfiles, or implementing a marketplace.
- Automatically copying or upgrading `standard` under `$DOPPELGANGER_HOME`.
- Making shipped assets writable, overlaying partial user files onto a shipped preset, or merging duplicate preset directories.
- Adding Persona self-authoring, identity revision approval, or writable-trait policy in this change.
- Sharing one activated plugin tree across Runtime Sessions as DSH standing presets do.
- Adding memory, SQLite, embeddings, vector storage, actor onboarding, or credentials to the shipped `standard` preset.
- Shipping the personal `mark` preset.

## Decisions

### 1. Expand the existing runtime-presets package instead of adding a second package

`@doppelganger/doppelganger-runtime-presets` will own:

```text
packages/runtime-presets/
├── src/
│   ├── roster.ts          # Cordis-free domain model
│   ├── authoring.ts       # copy/remove operations
│   ├── configuration.ts   # user/project selection documents and home
│   ├── plugin.ts          # optional Cordis facade
│   └── index.ts           # pure public API
└── presets/
    └── standard/
        ├── runtime.cordis.yml
        ├── preset.yml
        ├── identity.md
        └── traits/
            ├── engineer.md
            └── concise.md
```

The exact source split may follow local naming conventions, but the dependency boundary is fixed: the main export must remain usable without constructing a Cordis Context, and `./plugin` provides the Cordis facade.

Alternative considered: create `doppelganger-runtime-preset-roster` or `doppelganger-default-preset`. Rejected because discovery, selection, metadata, trust, authoring, and shipped roots form one coherent roster responsibility, and a second package would create two public sources of Runtime Preset truth.

### 2. Package `standard` as immutable shipped content and initialize its user control plane

The package manifest will publish `presets/`. `SHIPPED_PRESET_ROOT` will be resolved relative to the installed module with `new URL('../presets/', import.meta.url)`, so source and built layouts are covered by package tests.

The roster reads shipped preset assets in place and never copies `standard` into Doppelganger home automatically. On first selection from an uninitialized home it follows DSH's profile-materialization boundary by creating the editable user control files `config.yaml` and `runtime.cordis.patch.yml` plus the `.runtime-presets/` authoring root. Existing files are never overwritten. Package upgrades may replace shipped content, while user configuration, patches, and copied presets remain durable.

Alternative considered: create `~/.doppelganger/.runtime-presets/standard` on first use. Rejected because it makes ownership and upgrades ambiguous; DSH likewise materializes profile configuration while keeping shipped bundle content package-owned.

### 3. Use one ordered root model with trust as authoring policy

```ts
interface RuntimePresetRoot {
  readonly path: string
  readonly trust: 'system' | 'user'
}

interface RuntimePresetRosterConfig {
  readonly home?: string
  readonly default?: string
  readonly roots?: readonly RuntimePresetRoot[]
  readonly includeShippedRoot?: boolean
  readonly includeUserRoot?: boolean
}
```

Resolved order:

```text
package-owned shipped root        trust: system
configured roots, authored order  trust: system | user
$DOPPELGANGER_HOME/.runtime-presets trust: user
```

Derived roots default to enabled. Earlier roots win a duplicate ID, including when the earlier descriptor is broken. `trust` governs roster mutation only; it is not a sandbox or code-trust guarantee. Every Runtime Preset remains trusted executable composition input once activated.

Alternative considered: let user roots shadow shipped IDs. Rejected because an apparently named `standard` could silently become unrelated executable content. Copying to a new ID makes customization explicit and keeps shipped recovery available.

### 4. Add deployment default below existing selection layers

Selection order becomes:

```text
explicit host/session choice
-> project runtimePreset
-> user defaultRuntimePreset
-> roster deployment default
-> inactive
```

The standard roster configuration supplies `default: 'standard'`. Core APIs may accept `default` as absent so controlled deployments and tests can preserve a valid inactive state. A present missing or broken winner fails without falling through.

`ResolvedRuntimePresetSelection.source` gains `deployment`. Existing config schemas remain selection-only and unchanged.

Alternative considered: write `defaultRuntimePreset: standard` into user config. Rejected because package behavior should work without creating user files, and deployment defaults must remain distinguishable from user choices.

### 5. Keep standard actor-neutral and minimal

The shipped `standard` preset will compose:

- the context protocol;
- the tools protocol, yielding a valid initially empty portable tool registry;
- Persona with a neutral stable instance ID and file-backed identity;
- the existing concise and production-engineer traits adapted from the development preset without the name or relationship-specific Mark content.

It will not compose SQLite, memory, capture, embedding, or vector plugins because those require actor, storage, resource, and persistence choices that an arbitrary host installation cannot safely infer.

The standard preset may use bare workspace package names in `runtime.cordis.yml`. The installed official distribution must include those referenced plugin packages. Roster health reports a broken shipped preset if its deployment omitted a required package.

Alternative considered: ship an empty preset. Rejected because it technically activates but provides no Doppelganger product behavior. Alternative considered: ship the full Mark memory stack. Rejected because it embeds one actor/storage/resource policy into a universal default and makes unbound hosts fail.

### 6. Copy the complete preset tree into the first writable root

`copy(from, id, name?)` resolves the source through the roster and copies its whole directory into the first resolved `user` root. It will:

- validate the destination ID with the canonical preset-ID rule;
- refuse any ID occupied in the roster or on disk;
- dereference symlinks;
- copy into a temporary sibling directory and atomically rename it into place;
- remove partial temporary output on failure;
- preserve all composition assets;
- rewrite copied `preset.yml` so the copy has its own display identity and does not retain shipped ordering metadata.

`remove(id)` accepts only descriptors physically owned by that same writable root. If the removed ID is the user `defaultRuntimePreset`, the operation rewrites the strict user configuration without that field using atomic file replacement. Running Runtime Sessions are unaffected because their activated composition generation owns its lifecycle independently.

Alternative considered: expose arbitrary create/write operations through the roster. Rejected because copy-only authoring starts from a known complete tree and grants no composition capability that the source did not already contain.

### 7. Share implementation between pure and Cordis surfaces

The pure surface will expose a stateful `RuntimePresetRoster` or equivalent factory plus compatibility functions implemented over it. OMP uses this surface before child startup.

The `./plugin` subpath exports one ordinary Cordis Service plugin that provides:

```ts
ctx.doppelgangerRuntimePresets
```

Its methods delegate to the same roster implementation. Cordis owns only configuration, service publication, effects, and disposal; it does not own a second cache or selection algorithm. Discovery remains live per call so newly copied or removed presets appear without restarting the host.

The plugin depends only on `@deepseek-ai/cordis` as a peer. The package continues to have no internal Doppelganger dependencies, preserving the package-boundary manifest.

Alternative considered: make the package's default export the Cordis plugin and require OMP to instantiate Cordis for selection. Rejected because OMP must resolve activation before its Node runtime child exists and the pure path is already the correct process boundary.

### 8. Hosts configure the roster but do not name product presets

The runtime-presets package supplies the default root configuration and `standard` deployment default. `host-omp` calls the pure API with optional home and host overrides; it does not contain the string `standard` or import Persona packages. A native DSH integration composes the `./plugin` facade and consumes `ctx.doppelgangerRuntimePresets`; it does not implement independent discovery.

The active `add-deepseek-harness-host` planning artifacts currently describe direct use of selection functions. They must be reconciled before that host is implemented so its lifecycle owner consumes the new Cordis roster service without changing Runtime Session semantics.

Alternative considered: make each host pass its own shipped root and default. Rejected because hosts could silently expose different Doppelganger product rosters, and every host would need package-layout knowledge.

### 9. Preserve compatibility through clean API migration

Existing exported discovery and selection functions may change signature to accept roster configuration, but all repository callers will migrate in one cutover. No deprecated alternate discovery path or automatic legacy home-only mode will remain. Explicitly setting `includeShippedRoot: false` and omitting `default` provides the controlled equivalent of the old inactive behavior.

The existing development extension continues to pass `dev/doppelganger` as home and selects `mark` through its config/project state. Because explicit/project/user choices outrank the deployment default, development behavior remains stable while `standard` becomes available in the same roster.

## Risks / Trade-offs

- **Package dependency mismatch:** `standard` can be present but broken if the installed distribution omits one of its named plugins. Mitigation: package/publication invariant tests resolve and mount the shipped composition from the built package layout.
- **System trust misunderstanding:** `system` means roster-owned and non-authorable, not safe or sandboxed code. Mitigation: document this explicitly and retain trusted-code language for all Runtime Presets.
- **Default changes prior inactive behavior:** installations with no selection will activate `standard`. This is intended product behavior; deployments needing inactivity must explicitly omit the deployment default or disable the shipped root.
- **Duplicate IDs can confuse users:** first-root-wins means a broken earlier root blocks a healthy later duplicate. This is deliberate because fallback would hide corruption and make identity depend on health.
- **Concurrent authoring:** two processes may copy or remove simultaneously. Temporary-directory plus exclusive atomic rename prevents overwrite; user-config rewriting needs atomic replace and conflict-aware re-read.
- **Copied presets do not receive upgrades:** this preserves ownership but means security or behavior fixes in shipped assets do not propagate. Future explicit diff/upgrade tooling may address this; automatic merge is out of scope.
- **Cordis facade broadens package shape:** careless imports could pull Cordis into OMP's pre-child process. Separate exports and tests must prove the pure entry has no Cordis runtime import.
- **Active DSH change drift:** the existing DSH proposal must be updated before implementation to consume the Cordis service. Leaving both plans unreconciled would create two roster paths.