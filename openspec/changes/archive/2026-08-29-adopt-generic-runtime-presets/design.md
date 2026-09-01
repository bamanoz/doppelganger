## Context

Doppelganger already has the correct deep kernel: one Cordis root, one isolated Loader tree per Runtime Session, audited activation, transactional reload, host-neutral protocols, and a child-process OMP boundary. The remaining generic path is not generic enough. `extension-persona` currently parses user and project selection, `preset-aiden` manufactures serialized activation, and `.omp/extensions/doppelganger.ts` imports Aiden directly. Consequently the kernel-facing configuration owns `principalId`, Persona Instance paths, traits, and storage even when the desired composition is unrelated to Persona.

The target model is intentionally smaller:

```text
$DOPPELGANGER_HOME/
├── config.yaml                              # version + optional defaultRuntimePreset
├── runtime.cordis.patch.yml                 # optional user layer
└── .runtime-presets/<id>/runtime.cordis.yml # complete Loader tree

<workspace>/.doppelganger/
├── manifest.yaml                            # version + optional runtimePreset
└── runtime.cordis.patch.yml                 # optional project layer
```

A Runtime Preset is one complete Loader tree. A patch is never a preset. The selected base is layered with user, project, explicit host, and runtime-owned host patches. Plugins own every domain setting and durable byte they need.

The implementation is grounded in the inspected DeepSeek Harness boot path, especially `@deepseek-ai/dsh-app-boot` and `@deepseek-ai/cordis-plugin-include`: patch documents are top-level `PatchOptions[]`, use `entryListSchema`, replace row fields rather than deep-merging them, and are flattened in precedence order for one canonical `applyEntryPatches` call. Doppelganger deliberately differs on one policy: an unmatched target is fatal because each session has one exact selected tree; it is not a cross-surface DSH overlay where a missing row can be expected.

Constraints:

- `SPEC.md` remains authoritative and must be updated in the implementation change.
- `composition-runtime` cannot depend on Persona or other Doppelganger extensions.
- OMP must remain usable when no preset is selected or activation fails.
- The child RPC boundary remains versioned and JSON-compatible.
- Composition and patch inputs are immutable authored files, never Loader persistence targets.
- Runtime Presets may use normal Cordis plugin package names and relative modules under existing Loader resolution. Automatic package installation, dependency solving, and a marketplace are separate product capabilities.

## Goals / Non-Goals

**Goals:**

- Discover, validate, select, and activate arbitrary user-authored Runtime Presets.
- Reduce user/project kernel configuration to selection only.
- Apply deterministic native Cordis patch layers with source-labelled diagnostics.
- Make the generic activation and OMP bootstrap independent of Aiden and Persona.
- Preserve isolated sessions, audited activation, rollback, dynamic OMP tools, and lifecycle transport.
- Retain Aiden only as an optional ordinary plugin preset whose configuration and storage are explicitly extension-owned.

**Non-Goals:**

- A bundle registry, package installer, lockfile format, marketplace, or dependency resolver.
- A generic settings or storage service in the kernel.
- Migration shims accepting the legacy `principalId` / `instances` / `instanceId` schemas.
- Moving plugin state between providers or rewriting existing SQLite records.
- Implementing the native DeepSeek Harness host.
- Making every arbitrary Cordis plugin visible through OMP; only standard optional context/tool/lifecycle protocols are projected.

## Decisions

### 1. Runtime selection moves into `composition-runtime`

Add a runtime-owned configuration module (split by responsibility, e.g. `home.ts`, `runtime-preset.ts`, and `runtime-selection.ts`) with these public concepts:

- `resolveDoppelgangerHome(explicit?)`
- `discoverRuntimePresets(home)`
- `loadRuntimeUserConfig(path)`
- `loadRuntimeProjectManifest(path)`
- `resolveRuntimePresetSelection(request)`
- `RuntimeConfigurationError` carrying filename plus field-level diagnostics

`composition-runtime` is the lowest package that can own a domain-neutral composition selection. Putting this in `host-omp` would duplicate it for the DSH host; leaving it in `extension-persona` preserves the wrong dependency direction.

Home resolution is explicit argument, then non-empty `DOPPELGANGER_HOME`, then `~/.doppelganger`. Preset IDs use the existing lowercase kebab-case convention. Discovery records valid and broken occupied IDs so a broken selected preset cannot masquerade as missing or fall through.

`config.yaml` and `manifest.yaml` use strict version-1 schemas and reject unknown legacy fields. A missing document is an empty selection layer. A selected unknown/broken preset is an error; selection never falls through after a higher-precedence choice.

**Alternative considered:** keep a caller-provided `activationResolver`. Rejected as the primary path because every host would need to reimplement discovery, precedence, patch paths, and diagnostics. A host may still supply the explicit preset ID and explicit patch layers, but not replace the selection algorithm.

### 2. A Runtime Preset has no manifest or kernel-owned domain metadata

The preset identity is its directory name and its complete definition is `runtime.cordis.yml`. The normalized `CompositionDefinition` becomes generic:

```ts
interface CompositionDefinition {
  id: string                 // selected Runtime Preset ID
  revision: string           // deterministic digest of authored composition inputs
  loaderPath: string         // absolute runtime.cordis.yml
  patches: readonly CompositionPatchLayer[]
}
```

Persona-era `imports` and declared `mounts` leave this contract. Ordinary Loader rows resolve plugins through Loader semantics. Runtime-reserved builtins remain internal. Runtime-owned host integration is generated by the runtime rather than declared by a preset.

The revision is a stable digest of the base and effective authored patch contents, not a user-authored Persona revision. It changes only when an input generation commits, so host notifications can identify effective runtime changes.

**Alternative considered:** add `runtime-preset.yaml` metadata for revision, imports, and mount points. Rejected because it creates a second composition description beside the complete Loader tree and gives the kernel new configuration to own.

### 3. Patch layers retain provenance but compose once

Represent every layer as a source-labelled value:

```ts
interface CompositionPatchLayer {
  source: string             // absolute file path or stable host label
  baseUrl: string            // absolute directory for relative inserted modules
  patches: readonly PatchOptions[]
}
```

Filesystem layers are parsed with the Include package's exported `entryListSchema`; present-but-empty YAML is invalid while explicit `[]` is valid. Relative `name` values only in inserted rows are anchored to that layer's directory. Bare specifiers, absolute paths/file URLs, and `name` assertion fields on targeted patches are left unchanged.

The composer flattens layers in exact precedence order and calls canonical `applyEntryPatches` once. Before that call, a strict preflight walks the same initial ID index and incremental insert behavior as Include:

- unconditional root insert is valid;
- targeted insert requires an existing group;
- non-insert requires an ID;
- target ID must exist;
- supplied target `name` must match;
- inserted IDs become addressable by later patches;
- reserved runtime IDs and names are rejected in the base and all caller layers.

Any preflight warning condition becomes `CompositionLayerError` with source, patch ordinal, and target. This adds fail-loud policy without forking the patch vocabulary or replacement semantics.

**Alternative considered:** apply each layer separately and rebuild the ID index. Rejected because it differs from Include semantics when a plain `config` replacement introduces nested rows. One flattened canonical application matches actual Cordis behavior.

### 4. Runtime-owned host integration is a protected final root insertion

The serialized activation identifies the host kind, not a preset-declared mount target. In the child, `host-omp` constructs its bridge plugin and passes it as a runtime-owned final patch. `composition-runtime` assigns reserved import/entry identities, inserts the bridge at the effective root, and audits that its fiber settled active.

The OMP bridge changes its protocol injections from required to optional:

- absent context protocol -> `context.resolve` returns an empty assembled contribution;
- absent tool protocol -> tools list is empty and invocation rejects unknown tools;
- present standard protocols retain existing behavior and live tool updates.

This makes `[]` a valid Runtime Preset while preserving useful projection for presets that compose `extension-protocols`.

No preset-authored placeholder is required. Because a Runtime Session already owns a private Cordis tree, the development Aiden preset no longer needs the extra `session-protocols` group solely to isolate one session from another.

**Alternative considered:** retain out-of-band mount declarations. Rejected because the requested preset layout has one complete Loader tree and host placement metadata would reintroduce a hidden second definition.

### 5. Generic Runtime Session metadata replaces implicit Persona bootstrap data

Add a small runtime-owned service mounted before the preset entries:

```ts
interface RuntimeSessionMetadata {
  sessionId: string
  runtimePresetId: string
  workspaceRoot?: string
}
```

The value is normalized, immutable, and session-local. It contains no principal, project identity, Persona instance, trait, settings, or storage information. Extensions that need host-session correlation can inject it. Hosts may omit `workspaceRoot` outside a discovered workspace.

Persona remains an ordinary extension. Its own activation plugin may consume generic session metadata plus explicit Persona configuration supplied in its Loader row, but the kernel does not construct Persona activation.

**Alternative considered:** provide only `sessionId` as an unscoped config expression. Rejected because extensions such as lifecycle capture need a stable, typed session identity and each host would otherwise invent a different seam.

### 6. Layer reload rebuilds the whole effective generation

Keep one mutation queue per Runtime Session. Register exact HMR config watches for:

- the selected `runtime.cordis.yml`;
- `$DOPPELGANGER_HOME/runtime.cordis.patch.yml` whether or not it initially exists;
- the applicable workspace `.doppelganger/runtime.cordis.patch.yml` whether or not it initially exists.

Explicit host and runtime-owned layers are in-memory constants for that activation. Any watch event re-reads all filesystem inputs, revalidates, recomposes, updates the session tree transactionally, awaits settlement, and audits the result. The generation and revision commit only after audit. Parse, preflight, activation, or audit failure leaves the prior root data and diagnostics active, while adding a source-labelled reload failure.

The session tree continues to override `write()` as a no-op. Reload drives in-memory `EntryTree.update`; it never asks Include to persist the effective tree back to the base or a patch file.

**Alternative considered:** watch only files present at startup. Rejected because creating or deleting an optional patch is itself a composition change.

### 7. Serialized activation and OMP RPC make a clean versioned cutover

Replace Persona-shaped serialized fields with generic fields and bump `OMP_RPC_PROTOCOL_VERSION`. The serialized payload carries only JSON-compatible paths, source-labelled host patches, session/workspace metadata, host kind, and watch policy. Plugin objects never cross RPC; the child creates the OMP bridge locally.

Rename generic runtime notifications and diagnostics (`profile.changed` -> `runtime.changed`, Persona wording -> Runtime Preset wording). Remove obsolete mount reference loading from the child after every caller is migrated.

The OMP extension options become home/selection oriented, for example:

```ts
createDoppelgangerOmpExtension({
  home: '/absolute/dev/doppelganger',
  childPath,
  explicitRuntimePreset?: string,
  patches?: readonly SerializedPatchLayer[],
})
```

At session start it discovers the nearest project manifest, resolves selection through `composition-runtime`, and starts no child when selection is empty. The inactive initialization tool accepts `runtimePreset`, validates it against discovery, writes only `{ version: 1, runtimePreset }`, and retries activation. OMP stays alive on any configuration or child failure.

**Alternative considered:** keep `.omp/extensions/doppelganger.ts` as the Aiden resolver. Rejected because it makes the repository bootstrap the remaining non-generic product seam.

### 8. Aiden becomes an optional ordinary preset, not a resolver

Remove `resolveAidenActivation`, `resolveAidenSelection`, Aiden extension-reference maps, and Persona selection/config exports that only support the legacy kernel path. Keep Persona identity/traits/activation and memory as extension-owned plugins.

Expose `preset-aiden` as a normal Loader-compatible plugin/factory whose row config explicitly owns:

- Persona instance/principal policy;
- identity and trait asset paths;
- memory-capture policy;
- SQLite provider path.

Create `dev/doppelganger/.runtime-presets/aiden/runtime.cordis.yml` with an ordinary `@doppelganger/preset-aiden` row, point dev `config.yaml` at `defaultRuntimePreset: aiden`, and reduce the repository manifest to `{ version: 1, runtimePreset: aiden }` only if a project override is desired. Development storage can remain at the existing ignored location by explicit Aiden plugin config; the generic runtime neither computes nor creates it.

The project-local `.omp/extensions/doppelganger.ts` imports only `host-omp` and supplies the development home. This is the acceptance proof that the host no longer imports a preset.

**Alternative considered:** delete Aiden entirely. Rejected because an ordinary Persona preset is a useful regression fixture for context, tools, lifecycle, and persistence while no longer governing the architecture.

### 9. Documentation and tests cut over by contract

Update `SPEC.md`, `README.md`, `AGENTS.md`, package READMEs if present, and all examples to Runtime Preset terminology and layouts. Remove legacy files and tests rather than maintaining aliases.

Tests are organized around observable boundaries:

- config/home/discovery/selection table tests in `composition-runtime`;
- base/patch parsing, precedence, relative insert anchoring, fail-loud targets, reserved IDs, effective audit, file appearance/deletion, rollback, and no-write tests in `composition-runtime`;
- serialized generic activation and protocol-version tests;
- child-process OMP tests for arbitrary plugin, empty preset, optional protocols, initialization, dynamic tools, failure isolation, and layered reload;
- optional Aiden preset persistence/capture tests through its extension-owned config.

Package-boundary checks are updated only to reflect removal of now-obsolete dependencies. The target dependency direction is `host-omp -> composition-runtime + extension-protocols`; no host dependency on Persona or Aiden.

## Risks / Trade-offs

- **[Existing plugin packages are not Loader-compatible default exports]** -> Wrap multi-plugin products such as Aiden in one ordinary Loader-compatible preset plugin; do not add kernel import aliases for product extensions.
- **[Root host bridge cannot see services hidden by a preset's private isolation labels]** -> Document that OMP-projectable standard protocols must be visible at the Runtime Session root; the runtime does not inspect or pierce plugin-owned isolation.
- **[Fail-loud targets differ from upstream Include warnings]** -> Keep the difference as a narrow preflight policy with parity tests against canonical `applyEntryPatches` for all accepted inputs.
- **[Watching absent files can be platform-sensitive]** -> Use HMR exact config registration and child-process tests for create/delete on supported platforms; serialize callbacks through the existing session queue.
- **[Strict schema cutover rejects existing local configuration]** -> Migrate the repository development files in the same change and emit precise legacy-field diagnostics; do not silently reinterpret old state.
- **[A malformed selected preset blocks a lower fallback]** -> Preserve deterministic intent and show healthy/broken discovery diagnostics instead of unexpectedly activating a different composition.
- **[No package manager means a preset can name an unavailable package]** -> Fail during audited activation with the Loader import error. Package acquisition remains explicitly out of scope.
- **[Effective revision hashing includes source bytes with non-semantic changes]** -> Accept conservative reload notifications; deterministic byte hashing is simpler and never misses a real authored change.

## Migration Plan

1. Add generic home, config, discovery, selection, patch parsing/composition, diagnostics, and session metadata contracts to `composition-runtime`, with focused tests.
2. Refactor `CompositionDefinition` and `CompositionRuntime.activate` to layered inputs and protected runtime additions; retain transactional audit/rollback and no-write behavior.
3. Replace serialized activation and bump OMP RPC; migrate child materialization and notifications in one cutover.
4. Make the OMP host bridge tolerate absent standard protocols; update initialization and project manifest writing to Runtime Preset selection.
5. Convert Aiden to an ordinary Loader plugin and development Runtime Preset with explicit extension-owned configuration/storage.
6. Delete Persona selection/config resolvers and obsolete activation maps after all tests/callers are migrated.
7. Rewrite documentation/examples and package-boundary rules.
8. Verify narrow package typechecks/tests, real OMP empty/arbitrary/Aiden smoke paths, then `npm run check`.

Rollback is source rollback before release. There is no mixed-schema compatibility mode: rolling back code also requires restoring the old development YAML files. Persistent extension-owned storage is not transformed by this change.

## Open Questions

None. Package acquisition and future preset distribution are intentionally deferred rather than left as implementation ambiguity.
