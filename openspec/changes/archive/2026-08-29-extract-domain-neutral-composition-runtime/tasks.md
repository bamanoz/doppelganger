## 1. Domain-Neutral Composition Kernel

- [x] 1.1 Create the `composition-runtime` package and define public composition, mount-point, activation, session, diagnostics, reload, and disposal contracts; verify its public entry point exports no persona, memory, protocol, or persistence symbols.
- [x] 1.2 Implement composition-definition validation for absolute Loader paths, import catalogs, mount declarations, reserved names, and required/optional mounts; verify valid definitions freeze their data and invalid or conflicting declarations fail with precise errors.
- [x] 1.3 Compile supplied named mounts into private Loader imports and insertion patches; verify declared mounts land at their targets while undeclared and missing required mounts fail before a session is returned.
- [x] 1.4 Port session-owned Cordis Fiber mounting and isolation namespacing into the kernel without domain metadata; verify concurrent generic sessions resolve only their own mounted implementations.
- [x] 1.5 Port full-tree activation audit and structured failures; verify pending dependencies, failed entries, and partial activation cleanup through generic kernel tests.
- [x] 1.6 Port serialized HMR refresh, audited commit, rollback, reload diagnostics, watcher ownership, and idempotent disposal; verify valid reload, invalid rollback, concurrent mutation ordering, and session/runtime teardown.

## 2. Extension Package Extraction

- [x] 2.1 Create `extension-protocols` and move context assembly, tool registry, and normalized lifecycle contracts without behavior changes; verify existing protocol contract tests pass from the new package and it depends only on Cordis/kernel contracts it actually uses.
- [x] 2.2 Create `extension-sqlite`, rename `StorageService` to `InstanceSqliteService`, and make its home directory owner-supplied rather than kernel metadata-derived; verify namespace validation, WAL settings, transactions, lifecycle closure, and stable existing database paths.
- [x] 2.3 Create `extension-persona` and move config loading, selection, activation metadata, identity, and traits into it; verify project/default/inactive precedence, immutable session isolation, identity context, trait order, and profile reload.
- [x] 2.4 Create `extension-memory` and migrate memory schema, service, retrieval, and tools onto persona metadata, protocols, and instance SQLite dependencies; verify the complete existing memory contract suite passes without importing the kernel's internal modules.
- [x] 2.5 Add dependency-direction enforcement for all new packages; verify the kernel imports no extension and `host-omp` imports neither persona nor memory.

## 3. Preset and Composition Migration

- [x] 3.1 Create `preset-aiden` containing Aiden assets, extension imports, isolation declarations, and named `host` and persona-metadata mounts; verify the preset loads as a valid generic composition with no OMP-specific content.
- [x] 3.2 Update persona resolution to produce a composition plus an extension-owned metadata mount instead of a kernel runtime definition; verify two different instance/project selections activate concurrently without metadata leakage.
- [x] 3.3 Migrate development configuration and persistent SQLite placement to the extracted preset/extensions; verify existing Aiden data remains readable at the same instance-owned path without schema migration.

## 4. OMP Adapter Cutover

- [x] 4.1 Replace child JSON-RPC runtime-definition and activation-metadata parameters with the neutral composition activation contract; verify the child process invokes only the generic kernel interface.
- [x] 4.2 Mount the OMP runtime host plugin through the composition's declared `host` mount and remove `hostGroupId`, raw host patches, and persona-specific child construction.
- [x] 4.3 Preserve OMP inactive/start/fail/dispose behavior, prompt projection, tools, lifecycle events, subprocess cleanup, project scope, global fallback, concurrent isolation, and reload notifications with adapter and child-process tests.

## 5. Clean Cutover and Acceptance

- [x] 5.1 Migrate every direct runtime caller and test to the composition interface, then delete `AgentRuntime`, `RuntimeDefinition`, `ActivationMetadataPlugin`, public raw patches, `hostGroupId`, old exports, and the former `packages/runtime` package; verify workspace search and typecheck find no obsolete references or compatibility aliases.
- [x] 5.2 Re-home tests according to package ownership and remove duplicated migration scaffolding; verify each package's focused suite exercises only its public interface.
- [x] 5.3 Run the complete workspace typecheck, contract/integration suites, single-Cordis check, and actual Aiden/OMP smoke session; verify identity, traits, scoped persistent memory, transactional reload, dynamic tools, process restart continuity, and OMP failure isolation remain operational.
