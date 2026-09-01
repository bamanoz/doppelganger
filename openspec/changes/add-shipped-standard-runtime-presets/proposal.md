## Why

Doppelganger currently discovers Runtime Presets only from the user home, so a newly installed host integration has no usable composition unless the user manually creates one. DeepSeek Harness demonstrates a better product boundary: the preset package ships an immediately available system roster while users customize by copying a preset into their writable home.

## What Changes

- Extend `@doppelganger/doppelganger-runtime-presets` from a user-home discovery library into the authoritative multi-root Runtime Preset roster.
- Ship a built-in `standard` Runtime Preset inside that package, including the standard plugin composition and its owned identity/trait assets.
- Discover shipped, configured, and derived user roots with deterministic precedence and explicit `system` or `user` trust.
- Add a deployment default of `standard`, while preserving explicit, project, and user-default selection precedence above it.
- Add copy-only authoring that copies an entire preset directory into the writable user root without overwriting an occupied ID; permit deletion only for user presets.
- Expose the same roster through a Cordis service plugin for in-process hosts while retaining pure host-neutral functions for OMP pre-child selection.
- Keep Runtime Preset compositions portable: the roster service remains outside authored `runtime.cordis.yml` trees.
- Preserve the development-only `mark` preset as user-owned project fixture content rather than shipping it as a product default.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-presets`: Add shipped and configured roots, the built-in `standard` preset, deployment-default fallback, trust-aware copy/delete authoring, and a Cordis roster service facade.

## Impact

- `packages/runtime-presets`: package publication contents, roster model, discovery, selection, authoring, Cordis service export, and tests.
- A new shipped `presets/standard/` tree containing the standard composition and plugin-owned assets.
- `packages/host-omp`: consume the expanded pure roster API without acquiring Persona or named-preset dependencies.
- Planned `packages/host-dsh`: consume the Cordis roster service rather than implementing a second preset mechanism.
- Root package manifests and package boundaries may change to support the Cordis plugin export and the dependencies required by the shipped standard composition.
- Runtime Preset, configuration, architecture, Persona, status/scope, and verification documentation will be updated to describe the shipped/user split and remove automatic package installation from deferred scope where applicable.