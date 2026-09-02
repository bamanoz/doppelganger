## Context

Doppelganger's portable seam already exists: a Runtime Preset composes ordinary Cordis Loader plugins, `doppelgangerRuntimeSession` supplies a host-owned optional absolute workspace root, `doppelgangerTools` registers transport-neutral JSON-Schema tools, and each host projects those tools generically. The missing part is a maintained extension that converts a local code graph into that protocol without adding CodeGraph concepts to Composition Runtime or either host.

This plan belongs in the canonical Doppelganger product repository because the new behavior is a reusable Doppelganger Loader package and changes Doppelganger's package closure, specifications, documentation, and verification. A global Evolution proposal may be noticed from any working repository, but an unrelated current repository is not an implementation target. If the Doppelganger source or a registered product planning store is unavailable, the proposal remains unplanned rather than creating product code in that unrelated repository.

The upstream contract was inspected on September 2, 2026 at CodeGraph commit `b9ca4b7981116909900368cc1686a1074cd4d4c1`, whose package version is `1.6.0`. The relevant standalone CLI surfaces are:

- `codegraph --version` for compatibility discovery;
- `codegraph status <path> --json` for initialization, resolved project/index roots, counts, pending changes, worktree mismatch, build/extraction versions, rebuild recommendation, index state, and pending references;
- `codegraph sync <path> --quiet` for incremental maintenance of an existing index;
- `codegraph explore --path <path> --max-files <n> -- <query>` for source context and call paths.

CodeGraph also exposes MCP and an importable library, but neither is the right first integration boundary. MCP would create a second host/tool framework beside `doppelgangerTools`; the npm library currently declares a Node range below Doppelganger's Node 26 runtime and would share process-global behavior. The standalone distribution carries its own runtime and gives Doppelganger a narrow versioned process boundary.

## Goals / Non-Goals

**Goals:**

- Provide one optional, permanent, cross-host CodeGraph capability through existing Runtime Preset, Runtime Session, and portable-tool contracts.
- Make `codegraph.status` diagnostic even when prerequisites are absent, and make `codegraph.explore` safe, bounded, workspace-confined, and current-index-only.
- Reuse a user-created local CodeGraph index while allowing only incremental synchronization needed for a correct read.
- Contain subprocess arguments, environment, output, timeout, concurrency, and disposal behavior inside one Loader Fiber.
- Preserve generic host projection and shipped-`standard` omission neutrality.
- Give implementation and future compatibility updates executable focused-spec evidence.

**Non-Goals:**

- Implement semantic or graph retrieval inside Doppelganger.
- Install, download, upgrade, initialize, rebuild, delete, watch, serve, or globally configure CodeGraph.
- Configure CodeGraph MCP in OMP, DSH, editors, or other agents.
- Add CodeGraph services or metadata to Composition Runtime, Runtime Preset selection, hosts, Persona, memory, Evolution, or Dynamic Runtime Plugins.
- Expose arbitrary filesystem paths, CodeGraph commands, environment values, or CLI arguments to model tool input.
- Sandbox the CodeGraph executable or promise hostile-code containment.
- Change the shipped `standard` Runtime Preset.

## Decisions

### 1. Implement a portable extension package in Doppelganger

Add `packages/extension-codegraph` as `@doppelganger/doppelganger-codegraph`. Its runtime dependencies are only `@doppelganger/doppelganger-composition-runtime` for the Runtime Session metadata contract and `@doppelganger/doppelganger-protocols` for portable tools; Cordis remains the workspace peer. The public entry exports the plugin, strict configuration schema, normalized result/error types, and the tested compatibility constant.

The plugin injects and isolates `doppelgangerRuntimeSession` and `doppelgangerTools`. No CodeGraph service is added to the kernel because no other extension currently needs a shared graph API. Internal modules remain boring and explicit: configuration normalization, CLI discovery/version parsing, bounded process execution, status validation, freshness coordination, and tool definitions.

`@doppelganger/doppelganger-omp` includes the package in its private installation closure so authored Runtime Presets can resolve it in the OMP child. `host-omp` does not depend on it. Future DSH packaging may include the package in its deployment closure, but the native host implementation remains separately planned and receives no CodeGraph logic.

Alternatives rejected:

- **Implement in the repository where the proposal was noticed:** global Evolution scope describes reusable intent, not source ownership; this would scatter Doppelganger product code into arbitrary projects.
- **Host-specific MCP configuration:** duplicates tool registration and loses portable Runtime Session lifecycle and workspace binding.
- **Dynamic Runtime Plugin:** cannot provide a permanent dependency, package closure, maintained subprocess implementation, or restart persistence.
- **Kernel service first:** creates an abstraction without a second consumer and makes a feature-specific concept globally architectural.

### 2. Use the standalone CLI through a strict adapter

The adapter discovers either an absolute configured executable or `codegraph` through the inherited process `PATH`. It executes `--version` once per plugin generation and accepts the initially tested compatibility range `>=1.6.0 <1.7.0`. The supported range is repository-owned, not user-configurable; extending it requires source review, tests, and documentation rather than a configuration escape hatch. Only successful discovery is cached. A failed discovery remains retryable so an operator can install or correct the binary without restarting the Runtime Session.

Every command uses `spawn` directly with `shell: false`, `windowsHide: true`, ignored stdin, piped stdout/stderr, the exact Runtime Session workspace as `cwd`, and an explicit argument vector. The environment inherits ordinary execution variables needed by the standalone binary but overrides `NO_COLOR=1`, `FORCE_COLOR=0`, `DO_NOT_TRACK=1`, and `CODEGRAPH_TELEMETRY=0`. The adapter never invokes CodeGraph update, install, daemon, server, UI, or MCP commands.

The implementation records active children in a generation-owned set. Timeout or disposal sends the platform's normal termination signal, waits the configured shutdown interval, then force-kills if necessary. Completion settles exactly once across spawn error, exit, timeout, output overflow, and disposal races. Stdout and stderr are accumulated incrementally with byte ceilings, not unbounded buffers.

Alternatives rejected:

- **Import the npm library:** its current Node engine excludes Node 26, and process-level imports would couple Doppelganger to upstream globals and native/runtime compatibility.
- **Run through a shell:** adds quoting and injection risk without value.
- **Long-running MCP/daemon child:** creates a second service lifecycle, protocol, stale-process, and multi-session ownership problem for two bounded operations.

### 3. Bind index authority to exact Runtime Session workspace

No tool schema contains a path. The plugin snapshots `doppelgangerRuntimeSession.workspaceRoot` at apply time. Without it, `codegraph.status` returns a normalized `workspace-unavailable` diagnosis without spawning, while `codegraph.explore` throws `ToolInvocationError` with code `CODEGRAPH_WORKSPACE_REQUIRED`.

For a workspace-bound command, the adapter passes the exact normalized absolute root both as `cwd` and as the CLI path argument. Parsed status is safe only when CodeGraph's resolved `projectPath` equals that exact root. An ancestor index, a different resolved root, or `worktreeMismatch` remains diagnostic and blocks exploration. This conservative equality prevents a Runtime Session scoped to a subdirectory or worktree from accidentally exposing source outside its host-owned workspace.

Configuration cannot override workspace or index roots. If an operator wants a different graph boundary, the host must create the Runtime Session with that workspace or the operator must initialize CodeGraph at the intended root.

### 4. Register two bounded portable tools

`codegraph.status` has an empty object schema. It never throws for ordinary prerequisite states; it returns a normalized object containing:

- workspace availability and exact root;
- binary availability, resolved executable, exact version, and compatibility;
- index initialization and exact resolved project/index roots;
- last-indexed timestamp and bounded non-negative file/node/edge counts;
- pending added/modified/removed counts;
- worktree mismatch;
- built/current extraction versions, rebuild recommendation, state, and pending references;
- `explorationSafe`, a stable diagnostic code, and a bounded diagnostic message.

Malformed execution is a tool failure rather than a fabricated status. Unknown additive upstream fields are ignored. Required fields are validated by type and range before returning JSON-compatible data.

`codegraph.explore` accepts `{ query, maxFiles? }`. `query` is trimmed, non-empty, and at most 4,096 UTF-8 bytes. `maxFiles` defaults to 8 and is limited to 1-32. The result is `{ workspaceRoot, maxFiles, content }`, where `content` is the exact non-empty upstream text after removing only one terminal line ending. It is never silently truncated.

Initial defaults and hard ceilings:

| Bound | Default | Hard ceiling |
| --- | ---: | ---: |
| version/status timeout | 10 s | 30 s |
| incremental sync timeout | 120 s | 600 s |
| exploration timeout | 30 s | 120 s |
| graceful shutdown | 2 s | 10 s |
| status stdout | 256 KiB | fixed |
| exploration stdout | 128 KiB | 1 MiB |
| stderr retained in diagnostics | 32 KiB | fixed |
| `maxFiles` | 8 | 32 |

Loader configuration may reduce or raise timeout and exploration-output defaults only within these ceilings, select an absolute executable, and choose a default `maxFiles` not exceeding the fixed maximum. Unknown keys, non-absolute executable paths, and out-of-range values fail activation visibly.

Stable domain errors use a `CODEGRAPH_` prefix and distinguish invalid input, incompatible or missing binary, workspace requirement, invalid status output, unsafe or uninitialized index, sync failure, query failure, timeout, output limit, and disposal. Messages include bounded stderr only when it helps diagnose the exact failed local command; they never include arbitrary environment contents.

No native approval is attached. Status is read-only, and automatic sync updates only an existing user-authorized derived index before a read. Full index creation, rebuild, deletion, installation, and network-capable operations remain impossible through the tool surface.

### 5. Treat status as the freshness and safety gate

Each exploration performs:

1. compatible binary discovery;
2. `status --json` against the exact workspace;
3. structural validation and safety classification;
4. if and only if the index is initialized and the sole unsafe condition is pending incremental changes or unresolved references, join or start one session-local `sync --quiet`;
5. re-run and revalidate status after the sync;
6. run `explore` only when the revalidated status is safe.

Safe means: initialized; exact resolved root; no worktree mismatch; no rebuild recommendation; index state exactly `complete`; zero pending changes; zero pending references; compatible build/extraction metadata. Missing legacy state, `partial`, `indexing`, `failed`, or a changed extraction version requires operator-driven full rebuild and is not auto-repaired.

The freshness coordinator stores at most one in-flight sync promise. Concurrent callers join it, then each performs its own post-sync status read. Status calls may run independently. Explorations may run concurrently after the gate because they are read-only; the active-child set and total output limits still apply per invocation. Configuration sets a conservative maximum concurrent exploration count, default 2 and hard ceiling 8; excess calls wait in a bounded FIFO queue and are rejected on disposal.

### 6. Let Cordis own generation and cleanup

Plugin apply constructs one generation-local adapter and registers both tools through `ctx.doppelgangerTools.register`. A Cordis effect owns the adapter's accepting state, queue, children, and registrations. Candidate reload therefore creates independent state. Existing Composition Runtime activation audit decides whether that candidate commits; the plugin does not watch authored files or create a second reload path.

Disposal order is:

1. mark the adapter closed so no new command or queue entry starts;
2. reject queued explorations with `CODEGRAPH_DISPOSED`;
3. terminate all active children concurrently with bounded graceful-then-forced shutdown;
4. await the in-flight sync and exploration settlements;
5. dispose tool registrations through their owning Cordis effects;
6. aggregate cleanup failures after all reachable work has settled.

Invalid reload retains the previous audited generation under existing Composition Runtime semantics. Valid reload commits the new portable descriptors, after which generic host replacement makes stale projected closures fail through the existing tool-registry behavior.

### 7. Verify adapter behavior and one real host path

Most tests use an executable fixture, not a mocked process API. The fixture records argv, cwd, selected environment fields, concurrency, and signals and can emit controlled version/status/explore output, delays, errors, and byte floods. This proves the process boundary while keeping the normal suite network-free and independent of a developer installation.

Package tests cover strict configuration, omission neutrality, registration, discovery retry/cache, workspace confinement, status normalization, every unsafe state, incremental sync deduplication, bounds, structured errors, reload, and disposal.

The OMP package test builds a temporary installed plugin tree, adds a temporary Runtime Preset composing CodeGraph, supplies a temporary workspace and fixture executable, invokes the actual project-local `.omp/extensions/doppelganger.ts`, and verifies generic mounted-tool discovery and invocation. A separate opt-in smoke may run a real compatible CodeGraph binary against a disposable initialized fixture repository; it is evidence only when the binary is available and never points at the development workspace or personal index.

Owning documentation changes are:

- add `docs/features/codegraph.md` and index it in `docs/README.md`;
- update architecture overview/package topology and composition/reload lifecycle ownership;
- update operations configuration, verification, OMP package closure, and project scope/status;
- update root setup/usage with explicit standalone installation and user-run `codegraph init`, while stating that Doppelganger performs neither action.

## Risks / Trade-offs

- **Upstream CLI drift:** a minor release may change fields or semantics. Mitigation: initially accept only `1.6.x`, validate required status fields, ignore additive fields, pin fixture contracts to the inspected commit, and require explicit compatibility updates.
- **Standalone installation is external:** the plugin can be composed while the binary is absent. Mitigation: activation remains healthy, `codegraph.status` is diagnostic, and exploration returns an actionable structured prerequisite failure without installation side effects.
- **Index freshness is not a filesystem transaction:** source can change after status and before exploration. Mitigation: gate immediately before query and rely on CodeGraph's existing incremental model; do not claim a source snapshot. Results identify the workspace and current status timing.
- **Incremental sync mutates derived state:** a read-like tool writes `.codegraph`. Mitigation: only an existing user-created index is touched, only `sync --quiet` is reachable, and full/destructive commands are absent from code and schemas.
- **Large graph context consumes model context:** one explore result can remain resident. Mitigation: conservative `maxFiles` and byte defaults, hard ceilings, explicit failure instead of truncation, and operator-configurable reductions.
- **Trusted executable authority:** CodeGraph can read the workspace and execute with the Runtime Session user's permissions. Mitigation: exact binary/version diagnosis, shell-free argv, no caller paths or environment, telemetry forced off, bounded children, and explicit documentation that this is not a sandbox.
- **Cross-platform termination differs:** direct child termination may be delayed by platform behavior. Mitigation: bounded graceful and forced phases, no daemon/server commands, exhaustive settlement tests on supported CI platforms, and no claim of hostile-process containment.
- **Exact-root policy rejects useful ancestor indexes:** nested projects cannot borrow a broader graph. This is deliberate: preventing source outside host-owned workspace from entering tool results is more important than convenience. Operators can select or initialize the intended root explicitly.
- **The initial host smoke is OMP-only:** portable tool contracts make the package host-neutral, but native DSH packaging is not yet implemented. Mitigation: no DSH-specific dependency or code; add the package to DSH's deployment closure when that host change is applied.
