## Why

The implemented OMP integration is usable only through a project-local development bootstrap that hard-codes the repository development home, actor `valera`, and a source-tree child path. Doppelganger needs a private workspace OMP plugin package that can be linked and exercised through OMP's real plugin installation path now, while remaining structurally ready for a later publication change.

## What Changes

- Add private workspace package `@doppelganger/doppelganger-omp` as the host-facing OMP plugin install unit, preserving the existing `@doppelganger/doppelganger-<role>` naming convention.
- Give the package an OMP plugin manifest and one default extension entrypoint that composes `@doppelganger/doppelganger-host-omp` without repository-relative paths, named Runtime Presets, or a built-in actor identity.
- Keep `@doppelganger/doppelganger-host-omp` as the Runtime-Preset-neutral adapter/library and make its default child-runtime location valid from the installed package layout.
- Include the dependency closure required for the shipped actor-neutral `standard` Runtime Preset while preserving the host adapter's prohibition on Persona, memory, storage, and named-preset dependencies.
- Replace the project-local OMP implementation bootstrap with consumption of the new package, and move development-only home and actor selection to explicit external launch configuration.
- Exercise local `omp plugin link`, plugin discovery, fresh-home `standard` activation, repository Mark dogfooding, and isolated package contents without publishing to npm.
- Keep the new package at version `0.0.0` with `private: true`; public release, registry naming ownership, independent versioning, marketplace distribution, and compatibility-matrix policy remain out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hosts/oh-my-pi`: add the private installable OMP plugin package, neutral entrypoint, installed child/runtime dependency closure, local linking behavior, and development-bootstrap cutover requirements.

## Impact

- New workspace package: `packages/omp/` named `@doppelganger/doppelganger-omp`.
- Existing packages: `packages/host-omp`, package-boundary manifest, workspace dependency graph, and package-content verification.
- Local integration: `.omp/extensions/doppelganger.ts`, development launch configuration, OMP plugin link/discovery, and real OMP smoke coverage.
- Documentation: README setup/dogfooding, `docs/hosts/oh-my-pi.md`, `docs/project/status-and-scope.md`, verification guidance, and the documentation ownership map only if the tree changes.
- No npm publication, marketplace listing, actor onboarding, Runtime Preset package manager, or change to the Doppelganger package naming style.
