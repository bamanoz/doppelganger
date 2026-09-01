## 1. Authoritative Contract and Generic Configuration

- [x] 1.1 Update `SPEC.md` canonical terms, host integration, state layout, acceptance criteria, and deferred scope from Persona Instance selection to Runtime Presets and ordered patches.
- [x] 1.2 Add the direct YAML parsing dependency and implement normalized Doppelganger-home resolution in `composition-runtime` with explicit/environment/default precedence tests.
- [x] 1.3 Implement strict version-1 user config and project manifest loaders with optional-file behavior, unknown-field diagnostics, and legacy-schema rejection tests.
- [x] 1.4 Implement `.runtime-presets/<id>/runtime.cordis.yml` discovery with valid/broken occupancy diagnostics, safe ID validation, and deterministic ordering tests.
- [x] 1.5 Implement explicit/project/user/no-activation selection precedence with missing/broken winner diagnostics and no-fallback tests.

## 2. Native Patch Layer Composition

- [x] 2.1 Add source-labelled filesystem and inline patch-layer contracts to `composition-runtime`, preserving JSON-compatible serialization at the host boundary.
- [x] 2.2 Parse patch files with Cordis `entryListSchema`, distinguish absent files from invalid empty documents, and anchor inserted relative plugin paths to their source directory.
- [x] 2.3 Implement strict targeted-patch preflight matching Include's one-pass ID index, insert/group rules, name assertions, and whole-field replacement semantics.
- [x] 2.4 Reject runtime-reserved IDs/import identities in base and caller layers, then compose accepted layers with one canonical `applyEntryPatches` call.
- [x] 2.5 Add contract tests for layer precedence, later targeting of inserted rows, non-reindexing after config replacement, relative resolution, invalid shape, unmatched targets, and reserved identities.

## 3. Layered Composition Runtime

- [x] 3.1 Refactor `CompositionDefinition` to preset ID, authored-input revision, base Loader path, and ordered patch layers; remove Persona-era import and declared-mount metadata.
- [x] 3.2 Add immutable session-local `RuntimeSessionMetadata` with `sessionId`, Runtime Preset ID, and optional absolute workspace root, plus validation and isolation tests.
- [x] 3.3 Rework session-tree activation to load and validate the complete base, apply caller layers, append protected runtime-owned root plugins, settle, and audit before returning.
- [x] 3.4 Preserve no-write behavior for base and patch inputs and add byte-for-byte disposal/self-removal regression tests.
- [x] 3.5 Rebuild all filesystem layers through one serialized transactional reload path and retain the prior audited generation on parse, patch, activation, or audit failure.
- [x] 3.6 Register exact watches for the base and present-or-absent user/project patch paths, with tests for edit, create, delete, concurrent callbacks, revision commit, and rollback diagnostics.

## 4. Generic Serialized Activation and OMP Child

- [x] 4.1 Replace serialized composition/activation contracts with generic preset, layer, session metadata, host kind, and watch fields; remove serialized plugin import/mount references.
- [x] 4.2 Bump the OMP RPC protocol version and migrate request validation, adapter snapshots, diagnostics, and tests in one clean cutover.
- [x] 4.3 Update the OMP child to materialize generic layered activation, construct its host bridge locally, and pass it as the protected final runtime plugin.
- [x] 4.4 Rename `profile.changed` to `runtime.changed` and verify effective-revision notifications after committed reload only.
- [x] 4.5 Make OMP context/tool projection tolerate absent standard protocol plugins while preserving live context, tools, invocation, lifecycle, and failure containment when they are present.

## 5. Generic OMP Selection Surface

- [x] 5.1 Replace the required custom activation resolver with home, optional explicit Runtime Preset, and explicit host patch options backed by the generic selection resolver.
- [x] 5.2 Preserve nearest project discovery and pass an optional absolute workspace root without constructing project identity.
- [x] 5.3 Replace the Persona initialization tool input/output and manifest writer with validated `runtimePreset` selection only.
- [x] 5.4 Add child-process tests for no selection, empty preset, arbitrary plugin preset, explicit/project/user precedence, broken selection, optional protocols, and host survival after activation failure.
- [x] 5.5 Add child-process layered reload tests covering user/project patch precedence, patch appearance/disappearance, invalid target rollback, dynamic tool replacement, and stale-tool rejection.

## 6. Optional Aiden Runtime Preset Migration

- [x] 6.1 Convert `preset-aiden` to an ordinary Loader-compatible plugin/factory whose row config explicitly owns Persona policy, assets, capture settings, and SQLite provider path.
- [x] 6.2 Adapt Persona/memory integration to consume generic Runtime Session metadata plus Aiden-owned configuration without kernel selection or storage-path synthesis.
- [x] 6.3 Create `dev/doppelganger/.runtime-presets/aiden/runtime.cordis.yml` and migrate development user/project YAML to the strict runtime-owned selection schemas.
- [x] 6.4 Reduce `.omp/extensions/doppelganger.ts` to `host-omp` plus the development home and prove it has no Aiden or Persona import.
- [x] 6.5 Exercise Aiden end to end through the ordinary preset for context, tools, lifecycle, persistence restart, candidate-capture policy, and reload.

## 7. Clean Cutover

- [x] 7.1 Delete Aiden activation resolvers, extension-reference maps, and every migrated caller after the generic OMP and Aiden smoke paths pass.
- [x] 7.2 Delete legacy Persona user/project/instance selection parsers, exports, fixtures, and tests while retaining extension-owned Persona activation, identity, and traits.
- [x] 7.3 Remove obsolete development instance metadata and composition files that the ordinary Aiden preset replaces without deleting extension-owned ignored storage.
- [x] 7.4 Update package manifests and the package-boundary checker so `host-omp` depends only on generic runtime/protocol seams and no obsolete compatibility path remains.

## 8. Documentation and Verification

- [x] 8.1 Update `README.md` and `AGENTS.md` layouts, examples, implementation map, commands, and terminology for Runtime Presets, patch precedence, plugin-owned state, and optional Aiden.
- [x] 8.2 Run narrow TypeScript and Vitest checks for every changed package and fix all contract failures.
- [x] 8.3 Run the documented real OMP smoke for empty, arbitrary, and Aiden presets and record only the behavior actually exercised.
- [x] 8.4 Run `npm run check` and confirm typechecks, tests, single-Cordis identity, and package boundaries all pass.
