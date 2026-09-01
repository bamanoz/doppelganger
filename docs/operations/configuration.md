# Configuration

## Doppelganger home

One absolute home is resolved in this order:

1. explicit host option;
2. non-empty `DOPPELGANGER_HOME`;
3. `~/.doppelganger`.

Before the first Runtime Preset selection from a home without `config.yaml`, the roster initializes the user control plane. It creates `config.yaml`, an empty editable `runtime.cordis.patch.yml`, and the derived `.runtime-presets/` authoring directory. Repeated selection preserves these files. The package-owned shipped `standard` tree is not copied into the user root.

Runtime-owned user configuration is:

```text
$DOPPELGANGER_HOME/
├── config.yaml
├── runtime.cordis.patch.yml
└── .runtime-presets/<id>/
    ├── runtime.cordis.yml
    ├── preset.yml              # optional display metadata
    └── plugin-owned assets
```

`config.yaml` accepts only `version: 1` and optional `defaultRuntimePreset`. Runtime-owned user configuration contains no Persona, trait, actor, principal alias, project identity, plugin setting, credential, storage path, or durable runtime state.

## Runtime Preset roots and trust

The default roster searches roots in this order:

1. the package-owned shipped root containing `standard`, with `system` trust;
2. configured absolute roots in authored order, each explicitly marked `system` or `user`;
3. `$DOPPELGANGER_HOME/.runtime-presets`, with `user` trust.

Hosts may disable either derived root and may configure no deployment default. IDs are lowercase kebab-case directory names. The first root containing an ID wins; a broken winner remains visible and blocks lower copies rather than silently falling through. `system` and `user` are authoring trust labels, not security sandboxes: all activated plugins are trusted process code and can exceed any product-level writable policy. Persona Authoring's logical targets constrain that specific plugin; they do not sandbox a malicious Runtime Preset.

The `runtime-presets` package exposes this roster directly through `RuntimePresetRoster` and as the Cordis `doppelgangerRuntimePresets` service. The Cordis plugin defaults `defaultRuntimePreset` to `standard`; pass `null` to make the deployment explicitly defaultless. A compatible host may accept actor identity as a host/session option outside this runtime home. For OMP, the neutral `@doppelganger/doppelganger-omp` entrypoint reads a non-empty `DOPPELGANGER_ACTOR_ID` and passes it to `createDoppelgangerOmpExtension`; the repository-local extension only re-exports that entrypoint. Neither `config.yaml`, project manifests, Runtime Presets, nor patches may select or override the actor binding.

## Copy-only authoring

`RuntimePresetRoster.copy({ from, id, name? })` resolves a healthy source from any root, then copies its complete directory into the first configured `user` root. It never overwrites an occupied discovered ID or filesystem path. The copy is self-contained: symlinks are dereferenced, owner-only modes are applied, composition and adjacent assets are preserved, source display order/name are not inherited, optional supplied `name` is written, and source description is retained.

The current private workspace has no dedicated preset-authoring CLI or OMP UI. Run the public API from the repository root:

```bash
node --input-type=module -e "import { createRuntimePresetRoster } from '@doppelganger/doppelganger-runtime-presets'; const path = await createRuntimePresetRoster().copy({ from: 'standard', id: 'my-assistant', name: 'My Assistant' }); console.log(path)"
```

With the conventional home, this creates `~/.doppelganger/.runtime-presets/my-assistant/`. Select it globally by setting `defaultRuntimePreset: my-assistant` in `~/.doppelganger/config.yaml`, or per project by setting `runtimePreset: my-assistant` in `<project>/.doppelganger/manifest.yaml`. Selection is fixed when a Runtime Session starts, so begin a new host session after changing it.

`RuntimePresetRoster.remove(id)` removes only the winning preset owned by that same writable root. Shipped, configured-system, shadowed, and other non-owned presets are not removable through this API. If the removed preset is the user `defaultRuntimePreset`, the roster also atomically rewrites `config.yaml` without that selection and rolls the staged removal back on a reported failure.

## Project configuration

The nearest project manifest is discovered from the working directory up to the Git root:

```text
<project>/.doppelganger/
├── manifest.yaml
└── runtime.cordis.patch.yml
```

`manifest.yaml` accepts only `version: 1` and optional `runtimePreset`. It is safe to commit because it contains selection only. The project patch applies to whichever preset wins selection, including a user-default preset.

## Selection

Precedence is explicit host/session choice, project `runtimePreset`, user `defaultRuntimePreset`, then the roster's optional deployment default. The standard package/plugin deployment default is `standard`. A winning missing or broken preset fails visibly and does not fall through. A roster explicitly configured without a deployment default can still yield no selection, which activates no Runtime Session.

## Plugin ownership

A preset's Loader rows own feature configuration, credentials by environment-variable reference, state directories, databases, migrations, partitions, and assets. The runtime does not create Persona Instance directories or assign storage. Persona rows own agent identity only; actor-aware persistence injects the separate host-owned `doppelgangerActor` service.
Persona Authoring is opt-in Loader configuration. `writableTargets` accepts only selected logical trait identities such as `trait:evolving-profile`; identity, filesystem paths, globs, absent traits, and model-selected policy are rejected. The plugin serializes same-session mutations, uses a bounded adjacent interprocess lock and exact-byte compare-and-swap, and performs no autonomous work. Its transaction rollback is not persistent history: user-owned preset backup or version control remains the durable recovery mechanism, including the crash window after atomic replacement but before HMR confirmation.

Paths in normalized activation contracts are absolute. Relative plugin assets resolve from the Runtime Preset directory; relative plugin imports inserted by a filesystem patch resolve from that patch's directory.

Loader rows whose `!!js` configuration expressions read a Cordis service SHALL declare that service in `inject`. Session-scoped services such as `doppelgangerRuntimeSession` SHALL also use the matching Loader `isolate` realm on every referencing row; interpolation is evaluated in that row's context and fails activation when the dependency is undeclared.

## Patch order

```text
selected runtime.cordis.yml
$DOPPELGANGER_HOME/runtime.cordis.patch.yml
<project>/.doppelganger/runtime.cordis.patch.yml
explicit host/session patches
protected runtime-owned host bridge
```

Missing optional patches are no-ops. Valid changes reload the active session; invalid changes retain the previous audited generation. No normalized Loader input is written back to authored files.
