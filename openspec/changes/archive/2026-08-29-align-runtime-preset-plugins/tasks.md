## 1. Runtime Preset Control Plane

- [x] 1.1 Create the `@doppelganger/doppelganger-runtime-presets` workspace package and move Runtime Preset discovery, validation, metadata, revision, configuration, and selection contracts out of composition-runtime
- [x] 1.2 Migrate roster tests to the new package and cover deterministic healthy/broken listing, optional metadata, strict selection precedence, and broken-winner diagnostics
- [x] 1.3 Rename the remaining activation package to `@doppelganger/doppelganger-composition-runtime` and update its public exports to exclude roster responsibilities
- [x] 1.4 Update OMP selection and activation callers to consume the roster and composition packages through their separate public APIs

## 2. Public Package Cutover

- [ ] 2.1 Rename the protocols, Persona, SQLite, memory, and OMP package manifests to the `@doppelganger/doppelganger-*` convention and update their public export maps
- [ ] 2.2 Migrate all source, tests, fixtures, scripts, and Loader specifiers to the new package names with NodeNext `.ts` imports preserved
- [ ] 2.3 Update workspace lockfile and package-boundary rules for the renamed packages and new roster dependency direction
- [ ] 2.4 Remove every obsolete `@doppelganger/extension-*` and `@doppelganger/preset-aiden` import, export, and resolution path

## 3. Loader-Compatible Feature Rows

- [ ] 3.1 Expose context and tool registry plugins through unambiguous public `@doppelganger/doppelganger-protocols` Loader subpaths with declared Cordis services and disposal ownership
- [ ] 3.2 Convert `@doppelganger/doppelganger-sqlite` into a directly loadable infrastructure row while preserving plugin-configured paths, namespaces, and database teardown
- [ ] 3.3 Convert the Persona package root into one Loader plugin that validates activation configuration and owns immutable activation, identity, ordered traits, context contributions, and asset reload
- [ ] 3.4 Add Persona row tests for deterministic contribution order, Runtime Session metadata derivation, missing services, and last-known-good behavior after invalid identity or trait reload
- [ ] 3.5 Convert the memory package root into one Loader plugin that owns the memory service, migrations, complete tool surface, automatic recall, registrations, and atomic disposal
- [ ] 3.6 Expose candidate capture only at `@doppelganger/doppelganger-memory/capture` and preserve committed-turn, candidate-only, secret-rejection, bounds, and stable-operation behavior
- [ ] 3.7 Add real Loader activation tests for all public roots and subpaths, unresolved memory dependencies, empty Runtime Presets, and removal of the complete memory fiber by patch

## 4. Declarative Aiden Runtime Preset

- [ ] 4.1 Move Aiden identity and trait assets into `dev/doppelganger/.runtime-presets/aiden/` and author stable Persona configuration against preset-local assets
- [ ] 4.2 Rewrite Aiden `runtime.cordis.yml` as directly addressable protocol, Persona, SQLite, memory, and optional capture rows with capture disabled by omission
- [ ] 4.3 Replace Aiden aggregate fixtures and tests with the declarative Runtime Preset and prove individual feature rows can be replaced, disabled, inserted, or removed by Cordis patches
- [ ] 4.4 Remove the `preset-aiden` workspace package, `AidenPresetPlugin`, aggregate configuration, and obsolete assets after every caller is migrated

## 5. End-to-End Behavior

- [ ] 5.1 Update host-omp child-process fixtures and RPC tests for renamed packages and the roster/composition split without introducing Persona knowledge into the host
- [ ] 5.2 Prove two isolated Runtime Sessions using declarative Aiden share only explicitly configured SQLite persistence and retain memory across process restart
- [ ] 5.3 Prove dynamic tools, context projection, committed lifecycle capture, failure isolation, transactional hot reload, and shutdown still work through the real OMP surface
- [ ] 5.4 Add reload coverage showing valid Persona asset changes affect the next turn and invalid asset changes retain the last-known-good active contribution with diagnostics

## 6. Documentation and Verification

- [ ] 6.1 Update README examples, SPEC implementation maps, AGENTS package seams, and development configuration references to the new package names and declarative Aiden layout
- [ ] 6.2 Run narrow TypeScript and Vitest checks for each changed package and resolve all Loader, lifecycle, persistence, and teardown regressions
- [ ] 6.3 Search source, tests, definitions, documentation, and lockfile for obsolete package names or Aiden aggregate symbols and remove every remaining compatibility path
- [ ] 6.4 Run `npm run check` and smoke the project-local OMP extension with the declarative Aiden Runtime Preset
