## 1. OMP plugin package foundation

- [x] 1.1 Add `packages/omp` as private workspace package `@doppelganger/doppelganger-omp` at version `0.0.0` with TypeScript configuration and one `omp.extensions` entry
- [x] 1.2 Implement the neutral package entrypoint over `createDoppelgangerOmpExtension`, omitting blank actor configuration and passing no home, child path, Persona, or Runtime Preset defaults
- [x] 1.3 Declare the host adapter, shipped-standard product packages, Cordis Loader infrastructure, and bounded OMP peer needed for an isolated plugin dependency closure
- [x] 1.4 Register the new package and its one-way allowed dependencies in the package-boundary manifest without widening `host-omp`

## 2. Installed host runtime layout

- [x] 2.1 Make the default `host-omp` child location resolve from the package's own module layout while retaining explicit child path and factory injection seams
- [x] 2.2 Define `host-omp` package contents so its private child and every runtime module required by that child are included in local package inspection
- [x] 2.3 Add focused host tests proving default package-relative child startup and preserving existing injected-path behavior

## 3. Package contract and isolation tests

- [x] 3.1 Add `packages/omp/tests/plugin-package.spec.ts` coverage for package name, privacy, version, OMP manifest, and single declared extension entry
- [x] 3.2 Test that the entrypoint contains no repository-relative home, child path, actor, Persona instance, or named Runtime Preset default and binds only a non-empty `DOPPELGANGER_ACTOR_ID`
- [x] 3.3 Test that the complete shipped `standard` dependency closure resolves from an isolated packed or copied plugin tree rather than workspace hoisting
- [x] 3.4 Test package contents, private release boundaries, and absence of publication or marketplace metadata
- [x] 3.5 Extend package-boundary regression coverage to prove product dependencies stop at `doppelganger-omp` and `host-omp` remains Persona-, storage-, memory-, embedding-, vector-, and named-preset-neutral

## 4. Local OMP plugin linking

- [x] 4.1 Build an isolated OMP plugin-link fixture whose registry, profile, sessions, workspace, and Doppelganger home live under temporary roots
- [x] 4.2 Link `packages/omp` through the real OMP plugin manager and verify the package is recorded, enabled, discovered, and loaded without an explicit `-e` path
- [x] 4.3 Run a real fresh-home OMP session through the linked package and verify it initializes editable home control files, activates shipped `standard` context unbound, and does not copy the package-owned preset
- [x] 4.4 Run the linked package with external actor configuration and verify the exact immutable binding reaches the runtime without entering authored Runtime Preset or project files
- [x] 4.5 Dispose OMP sessions and child processes before removing every temporary registry and workspace root

## 5. Repository dogfood cutover

- [x] 5.1 Replace `.omp/extensions/doppelganger.ts` with a pure default re-export from `@doppelganger/doppelganger-omp`
- [x] 5.2 Remove development home, `valera`, child source path, and direct extension-construction logic from the project-local bootstrap
- [x] 5.3 Document explicit `DOPPELGANGER_HOME` and `DOPPELGANGER_ACTOR_ID` launch configuration for repository Mark dogfooding
- [x] 5.4 Run a real repository-local OMP session through the delegated package entrypoint and verify Mark context and actor-aware tools remain active

## 6. Documentation and current contracts

- [x] 6.1 Update README local installation and dogfooding flows to distinguish plugin linking with shipped `standard` from explicit Mark development configuration
- [x] 6.2 Update `docs/hosts/oh-my-pi.md` with the `doppelganger-omp` install boundary, neutral entrypoint, dependency ownership, and package-relative child invariant
- [x] 6.3 Update `docs/project/status-and-scope.md` so private local OMP packaging is implemented while public release, marketplace distribution, and compatibility policy remain deferred
- [x] 6.4 Update `docs/operations/verification.md` with isolated plugin-link and delegated repository smoke requirements
- [x] 6.5 Update `docs/README.md` only if the documentation tree or topic ownership changes, and reconcile the live OMP spec before archival

## 7. Verification

- [x] 7.1 Run `packages/omp` and `packages/host-omp` typechecks and focused tests
- [x] 7.2 Inspect local package contents and verify all declared OMP and child entrypoints are present without publishing
- [x] 7.3 Run isolated real OMP plugin-link smokes for fresh-home `standard` and externally actor-bound operation
- [x] 7.4 Run the real repository Mark dogfood smoke through the project-local delegation
- [x] 7.5 Run repository integrity, single-Cordis, package-boundary, focused-spec, and strict OpenSpec validation for the change
- [x] 7.6 Run `npm run check`; run the registry-backed security check only if production dependency versions change and report reviewed residual advisories accurately
