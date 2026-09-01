## Why

Doppelganger is a host-neutral Cordis plugin runtime, but its current user configuration and selection path still require persona instances, principals, traits, and instance-owned storage. The runtime needs a domain-neutral way to discover, select, layer, and activate arbitrary plugin compositions while leaving all plugin configuration and durable state to the plugins themselves.

## What Changes

- Introduce user-authored Runtime Presets at `$DOPPELGANGER_HOME/.runtime-presets/<id>/runtime.cordis.yml`; each file is a complete Cordis Loader tree and the directory name is the stable preset ID.
- Reduce `$DOPPELGANGER_HOME/config.yaml` to runtime-owned selection data: format version plus an optional `defaultRuntimePreset`.
- Reduce `<project>/.doppelganger/manifest.yaml` to an optional `runtimePreset` selection.
- Define selection precedence as explicit host/session choice, then project selection, then user default, then no activation.
- Add optional user-global and project-local `runtime.cordis.patch.yml` layers over the selected preset, followed by explicit host patches and the runtime-owned host mount.
- Use Cordis patch semantics directly, validate every layer, reject unmatched targeted mutations, and transactionally reload or roll back the effective composition.
- Keep plugin row `config` opaque and make plugins solely responsible for their own settings, persistence, partitions, credentials, and state lifecycle.
- **BREAKING**: remove generic runtime dependence on persona instances and the `instances`, `instanceId`, `instanceHome`, `principalId`, project ID, traits, and automatic plugin storage contracts.
- **BREAKING**: replace persona-oriented selection and activation naming with `RuntimePreset`, `CompositionDefinition`, and `RuntimeSession`; do not retain compatibility aliases.

## Capabilities

### New Capabilities
- `runtime-presets`: Discovery, validation, selection, and activation of complete domain-neutral Runtime Presets from the Doppelganger home.
- `runtime-patch-layering`: Ordered Cordis patch composition, diagnostics, host-mount protection, and transactional reload across user, project, and host layers.

### Modified Capabilities

None. The repository currently has no promoted main OpenSpec capabilities; this change supersedes persona-oriented selection contracts captured only in prior change artifacts.

## Impact

- Affected packages: `composition-runtime`, `extension-persona`, `preset-aiden`, and `host-omp`, plus the project-local OMP bootstrap.
- Affected contracts: serialized activation, selection/configuration schemas, Loader composition inputs, watch/reload ownership, diagnostics, and package boundaries.
- Affected files and layouts: `$DOPPELGANGER_HOME/config.yaml`, `$DOPPELGANGER_HOME/.runtime-presets/`, `$DOPPELGANGER_HOME/runtime.cordis.patch.yml`, and `<project>/.doppelganger/`.
- Existing development Aiden configuration must become an optional ordinary Runtime Preset or move completely outside the generic runtime; memory and persona state remain extension-owned.
- Tests and documentation must be rewritten around arbitrary plugins and empty compositions rather than treating Persona as the required product path.
