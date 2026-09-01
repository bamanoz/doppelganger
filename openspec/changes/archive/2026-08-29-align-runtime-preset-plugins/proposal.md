## Why

Aiden is currently packaged as one programmatic aggregate plugin, so its Runtime Preset does not expose the ordinary Cordis rows that actually provide Persona, protocols, storage, and memory. Aligning the composition with DeepSeek Harness patterns makes Runtime Presets inspectable and patchable while avoiding premature package and plugin fragmentation.

## What Changes

- Introduce a Runtime Preset roster module, named `@doppelganger/doppelganger-runtime-presets`, that owns discovery, health diagnostics, selection, and preset metadata outside activated Runtime Presets.
- Convert Persona into one Loader-compatible plugin, named `@doppelganger/doppelganger-persona`, that owns Persona Activation plus authored identity and ordered traits behind one row.
- Convert context, tools, SQLite, and memory capabilities into directly loadable `@doppelganger/doppelganger-*` plugin packages.
- Keep memory domain behavior, model-facing tools, and automatic recall in one `@doppelganger/doppelganger-memory` plugin because they form one product capability with no independently swappable consumer today.
- Keep candidate capture independently mountable as the `@doppelganger/doppelganger-memory/capture` subpath because capture has separate lifecycle, policy, extractor, and enablement semantics.
- Rewrite the Aiden Runtime Preset as a declarative Loader tree of those ordinary plugins and colocate its identity and trait assets with the preset.
- **BREAKING**: Remove `@doppelganger/preset-aiden` and the `AidenPresetPlugin` aggregate; callers and authored Loader rows must use the new declarative composition.
- **BREAKING**: Rename public Doppelganger packages to the `@doppelganger/doppelganger-*` convention and migrate every import and Loader specifier without compatibility aliases.

## Capabilities

### New Capabilities
- `runtime-preset-roster`: Discovery, health, metadata, selection, and control-plane ownership for Runtime Presets.
- `loader-plugin-composition`: Loader-compatible Doppelganger plugin rows, their package naming convention, and declarative Aiden composition.

### Modified Capabilities

None. The local main spec directory is currently empty; this change records the applicable behavior as new capability deltas.

## Impact

- Affected packages: `composition-runtime`, `extension-protocols`, `extension-persona`, `extension-sqlite`, `extension-memory`, `preset-aiden`, and `host-omp`.
- Affected configuration: development Aiden `runtime.cordis.yml`, Runtime Preset assets, package manifests, workspace imports, boundary checks, README examples, and implementation maps.
- Existing Runtime Preset selection precedence, patch ordering, host bridge protection, Runtime Session isolation, memory invariants, persistence, capture policy, and OMP transport behavior remain unchanged.
- The package rename and aggregate-plugin removal require a clean cutover across source, tests, definitions, and documentation.