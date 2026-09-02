## 1. Package foundation

- [x] 1.1 Create `packages/extension-codegraph` with strict NodeNext TypeScript configuration, public and Loader exports, Cordis peer dependency, composition-runtime/protocol dependencies, and test scripts
- [x] 1.2 Add the CodeGraph package to `scripts/package-boundaries.json`, the OMP private installation closure, lockfile, single-Cordis verification inputs, and repository integrity/package inventory where required
- [x] 1.3 Define strict Loader configuration, conservative defaults and fixed ceilings, the repository-owned `>=1.6.0 <1.7.0` compatibility contract, normalized public result types, and stable `CODEGRAPH_*` errors

## 2. Bounded standalone process adapter

- [x] 2.1 Implement shell-free executable discovery and `--version` parsing with absolute-path validation, PATH fallback, retryable failures, successful per-generation caching, and exact compatibility diagnostics
- [x] 2.2 Implement one bounded child-process runner with explicit argv/cwd/environment, ignored stdin, telemetry/color overrides, byte-limited stdout/stderr, timeout handling, and exactly-once settlement across spawn/exit/overflow/disposal races
- [x] 2.3 Implement generation-owned active-child tracking and bounded graceful-then-forced termination without invoking CodeGraph installers, upgrades, watchers, UI, MCP, servers, or daemons
- [x] 2.4 Add an executable fixture that records argv, cwd, environment, concurrency, and signals and can produce controlled version, status, sync, explore, failure, delay, and overflow outcomes

## 3. Workspace and status contract

- [x] 3.1 Snapshot the optional host-owned Runtime Session workspace and forbid path, executable, environment, index-root, command, or arbitrary-argument selection through tool input
- [x] 3.2 Implement `codegraph status <workspace> --json` parsing with strict required-field validation, bounded numeric/string values, unknown-additive-field tolerance, and normalized binary/index diagnostics
- [x] 3.3 Classify exploration safety from exact resolved-root equality, initialization, worktree mismatch, build/extraction compatibility, rebuild recommendation, index state, pending changes, and pending references
- [x] 3.4 Implement and register the empty-schema `codegraph.status` portable tool, including no-spawn workspace-unavailable diagnosis and structured failures for malformed, unsuccessful, timed-out, or oversized status execution

## 4. Fresh exploration workflow

- [x] 4.1 Validate the bounded `codegraph.explore` schema and normalize a non-empty UTF-8 query plus effective `maxFiles` without exposing other upstream arguments
- [x] 4.2 Implement the pre-query status gate that refuses absent, mismatched, rebuild-required, partial, indexing, failed, legacy-unsafe, or otherwise unsafe indexes without initialization or full rebuild
- [x] 4.3 Implement one session-local in-flight `sync --quiet` coordinator for only incrementally repairable pending changes/references, with concurrent joiners and mandatory per-caller post-sync status revalidation
- [x] 4.4 Implement bounded FIFO exploration concurrency, direct upstream `explore` invocation, exact non-empty result return, and stable failure mapping without partial-result truncation
- [x] 4.5 Register `codegraph.explore` without native approval and prove that the reachable command set cannot install, upgrade, initialize, rebuild, delete, watch, serve, or globally configure CodeGraph

## 5. Cordis lifecycle and reload

- [x] 5.1 Own adapter state, synchronization, queues, active children, and both portable registrations through the Loader Fiber with correct required-service injection and isolation
- [x] 5.2 Make disposal reject new/queued work, stop all outstanding processes, await every reachable settlement, remove registrations, and aggregate cleanup failures idempotently
- [x] 5.3 Add Composition Runtime coverage for valid configuration reload cutover, invalid-candidate last-good retention, omission/removal cleanup, and stale projected-tool rejection through existing generic semantics

## 6. Focused package behavior

- [x] 6.1 Add package tests for omission neutrality, exact two-tool registration, strict configuration, compatible discovery caching, retryable prerequisite failures, and workspace-required behavior
- [x] 6.2 Add package tests for healthy status normalization, exact-root confinement, additive upstream fields, absent/uninitialized indexes, worktree mismatch, every unsafe build state, and invalid/oversized output
- [x] 6.3 Add package tests for incremental sync, concurrent sync deduplication, post-sync revalidation, safe concurrent exploration, bounded queueing, exact result shape, and forbidden command absence
- [x] 6.4 Add package tests for shell-free argv, telemetry/color environment, timeout/output ceilings, spawn/non-zero errors, graceful/forced termination, disposal races, and exhaustive cleanup
- [x] 6.5 Replace every `planned:` evidence reference in the CodeGraph delta spec with the exact implemented static test title and run the focused package evidence

## 7. OMP generic vertical path

- [x] 7.1 Extend the isolated OMP package-closure test so the installed distribution resolves `@doppelganger/doppelganger-codegraph` while shipped `standard` remains byte-for-byte CodeGraph-free
- [x] 7.2 Add a generated temporary Runtime Preset, workspace, actor, fixture executable, and index state to the real project-local `.omp/extensions/doppelganger.ts` scenario
- [x] 7.3 Invoke projected `codegraph.status` and `codegraph.explore` through OMP's actual mounted-tool inventory and verify generic routing, structured failure propagation, stale-tool removal, process cleanup, and no host-specific CodeGraph code
- [x] 7.4 Add an opt-in real CodeGraph smoke against a disposable initialized fixture repository, with explicit skip when a compatible standalone binary is unavailable and no access to development or personal indexes

## 8. Documentation and verification

- [x] 8.1 Add `docs/features/codegraph.md` as the authoritative feature owner and index it in `docs/README.md`
- [x] 8.2 Update architecture overview, composition/reload lifecycle, configuration, OMP host packaging, project scope/status, verification, and root setup/usage documentation without duplicating normative ownership
- [x] 8.3 Document the exact workspace boundary, user-owned installation and initialization steps, derived-index mutation, automatic incremental sync, telemetry overrides, compatibility line, result bounds, and trusted-process/model-disclosure risks
- [x] 8.4 Run the package typecheck and focused tests, OMP vertical scenario, package-boundary and repository-integrity checks, strict `check:focused-specs:change`, then the full `npm run check`
