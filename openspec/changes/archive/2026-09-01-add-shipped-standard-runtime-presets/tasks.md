## 1. Roster domain model

- [x] 1.1 Refactor `packages/runtime-presets` into a Cordis-free roster domain API while preserving strict home, user-config, project-manifest, Loader-tree, metadata, and diagnostic validation
- [x] 1.2 Add validated Runtime Preset root configuration with `system` and `user` trust, shipped/configured/derived root ordering, canonical absolute paths, and explicit derived-root opt-outs
- [x] 1.3 Implement deterministic multi-root discovery with first-root-wins identity, broken-ID occupation, root/trust descriptor fields, and stable roster ordering
- [x] 1.4 Extend selection with the deployment-default layer and `deployment` selection source while preserving fail-loud winning choices and explicitly defaultless inactive operation
- [x] 1.5 Migrate all existing pure API callers and fixtures to the roster configuration contract and remove the obsolete home-only discovery path

## 2. Shipped standard Runtime Preset

- [x] 2.1 Add `packages/runtime-presets/presets/standard/preset.yml` with product-neutral display metadata
- [x] 2.2 Add the host-neutral actor-neutral `standard/runtime.cordis.yml` composition using context, tools, and Persona rows with correct session isolation
- [x] 2.3 Add neutral `identity.md`, `traits/engineer.md`, and `traits/concise.md` assets without Mark-specific identity, actor assumptions, memory, storage, embeddings, or vector configuration
- [x] 2.4 Export the shipped preset root from the installed module layout and include the complete `presets/` tree in the package publication manifest
- [x] 2.5 Add built-package and first-run tests proving `standard` is package-resolvable, selection initializes user control files without overwriting edits, and preset assets are never copied into Doppelganger home automatically

## 3. Copy-only user authoring

- [x] 3.1 Implement writable-root selection as the first resolved `user` root with explicit failure when no writable root exists
- [x] 3.2 Implement complete-tree copy with canonical ID validation, roster and filesystem occupancy checks, symlink dereferencing, private destination modes, temporary sibling staging, atomic rename, and rollback of partial output
- [x] 3.3 Rewrite copied `preset.yml` display metadata so a user copy has its own identity and does not inherit shipped ordering metadata
- [x] 3.4 Implement removal restricted to presets physically owned by the writable user root and reject shipped, configured-system, and foreign-user-root targets
- [x] 3.5 Atomically clear `defaultRuntimePreset` when removing the selected user preset without changing any other strict user configuration field
- [x] 3.6 Cover copy of `standard` to `mark`, invalid and occupied IDs, complete asset preservation, concurrent destination races, failed-copy cleanup, system removal refusal, and deleted-default cleanup

## 4. Cordis service facade

- [x] 4.1 Add a `./plugin` package export that provides the shared roster as the session-independent `doppelgangerRuntimePresets` Cordis service
- [x] 4.2 Define the public Cordis module augmentation and service methods for list, resolve, copy, remove, default identity, and roster configuration without duplicating domain logic
- [x] 4.3 Declare the workspace `@deepseek-ai/cordis` peer/dev dependency while keeping the main pure export free of Cordis runtime imports
- [x] 4.4 Add lifecycle and parity tests proving the Cordis service delegates to the same live roster semantics and disposes with its owning plugin scope
- [x] 4.5 Update package-boundary and single-Cordis invariants only as required, preserving `runtime-presets` independence from every other Doppelganger package

## 5. Host integration cutover

- [x] 5.1 Update OMP activation and initialization to use the pure roster API with shipped `standard` fallback before the child process starts
- [x] 5.2 Preserve OMP explicit, project, user, patch, failure-containment, and dynamic initialization behavior while adding `deployment` selection handling
- [x] 5.3 Add OMP coverage for a fresh home activating shipped `standard`, user/project overrides, explicit defaultless inactivity, broken shipped deployment failure, and copied user preset activation
- [x] 5.4 Prove `host-omp` remains Persona-neutral and contains no named `standard` or `mark` dependency
- [x] 5.5 Reconcile the active `add-deepseek-harness-host` proposal, design, spec, and tasks so native DSH composes the `./plugin` roster service instead of adding an independent selection path

## 6. Documentation and project contracts

- [x] 6.1 Update `docs/architecture/overview.md` and `docs/operations/configuration.md` with shipped/configured/user roots, trust semantics, first-root-wins discovery, deployment default, and copy-only authoring
- [x] 6.2 Update `docs/features/persona.md` to distinguish the neutral shipped `standard` Persona from the development-only personal `mark` preset
- [x] 6.3 Update `docs/project/status-and-scope.md` to record shipped preset distribution and retain arbitrary package installation, dependency solving, lockfiles, and marketplace behavior as deferred
- [x] 6.4 Update README setup and usage examples so a fresh installation initializes editable home control files, uses package-owned `standard`, and customization begins by copying to a new user preset ID
- [x] 6.5 Update `docs/README.md` links or ownership entries only if the documentation tree changes, and keep one authoritative owner for Runtime Preset operations
- [x] 6.6 Reconcile the main `runtime-presets` spec and all active OpenSpec requirements with the implemented roster behavior before archival

## 7. Verification

- [x] 7.1 Run runtime-presets typecheck, focused tests, package publication verification, and main-export proof that Cordis is not loaded
- [x] 7.2 Run host-omp typecheck and focused integration tests for fresh-home, override, inactive, failure, and copied-user scenarios
- [x] 7.3 Run a real OMP smoke from an uninitialized temporary Doppelganger home and confirm standard context/tool/Persona activation, initialized user control files, and no copied `standard` tree
- [x] 7.4 Run repository integrity, single-Cordis, package-boundary, focused-spec, and strict OpenSpec validation for every touched live spec and active change
- [x] 7.5 Run `npm run check` and record any registry-backed security check as release-only residual work unless dependencies changed