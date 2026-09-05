# CodeGraph code intelligence

## Boundary

`@doppelganger/doppelganger-codegraph` is an optional Loader plugin that projects an existing local CodeGraph index through the ordinary portable tool protocol. It is not a kernel service, host feature, semantic-memory backend, or implicit Runtime Preset requirement. The shipped `standard` preset omits it.

The plugin requires session-isolated `doppelgangerRuntimeSession` and `doppelgangerTools`. It snapshots the optional host-owned `workspaceRoot` when its Loader generation activates. Tool input cannot select a path, working directory, index directory, executable, environment, command, or arbitrary upstream argument. Every spawned command uses the exact workspace as both its current directory and CodeGraph path argument. CodeGraph's resolved `projectPath` must equal that workspace exactly; ancestor indexes, symlink resolution to another root, and worktree mismatches remain visible and block exploration.

## Prerequisite and composition

The user installs the standalone `codegraph` CLI separately and initializes each intended repository before Doppelganger uses it. The tested compatibility line is `>=1.6.0 <1.7.0`; changing that line requires source review and repository tests. Installation alone is inert, and the plugin never runs CodeGraph installation, upgrade, agent wiring, initialization, full indexing, deletion, watcher, UI, MCP, server, or daemon commands.

A Runtime Preset composes the row explicitly:

```yaml
- id: doppelganger-codegraph
  name: "@doppelganger/doppelganger-codegraph/loader"
  inject: [doppelgangerRuntimeSession, doppelgangerTools]
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerTools: session
  config:
    executable: /absolute/path/to/codegraph
    statusTimeoutMs: 10000
    syncTimeoutMs: 120000
    exploreTimeoutMs: 30000
    shutdownTimeoutMs: 2000
    maximumExploreOutputBytes: 131072
    defaultMaxFiles: 8
    maximumConcurrentExplorations: 2
    maximumQueuedExplorations: 32
```

`executable` is optional; omission resolves `codegraph` through the Runtime Session process environment. When supplied it must be absolute. Unknown fields and values outside the fixed ceilings fail activation. Timeouts must be positive integers no greater than 30 seconds for status, 600 seconds for sync, 120 seconds for exploration, and 10 seconds for graceful shutdown. Exploration output is limited to at most 1 MiB, `defaultMaxFiles` to 32, active explorations to 8, and queued explorations to 256.

`codegraph.status` accepts an empty object. Without a workspace it returns a normalized workspace-unavailable diagnosis and starts no process. Otherwise it awaits shared binary discovery, validates the reported version against the tested line, runs `codegraph status <workspace> --json` only for a compatible binary, validates required fields and bounds, ignores unknown additive fields, and returns binary, index, pending-change, build/extraction, state, root, and `explorationSafe` diagnostics. Missing, non-executable, malformed, or incompatible binaries remain bounded prerequisite diagnostics; malformed, failed, timed-out, or oversized status execution is a structured tool failure.

Status and exploration calls may overlap one discovery attempt. Discovery publishes only immutable factual binary results (or an unavailable diagnosis), never the initiating caller's required/optional policy. Status maps an unsuccessful prerequisite to its diagnostic result; exploration maps it to `CODEGRAPH_BINARY_UNAVAILABLE` or `CODEGRAPH_BINARY_INCOMPATIBLE` before reading index status, synchronizing, or running exploration. Failed discovery is not cached, so a later independent call retries; a compatible result is cached for the Loader generation only while it is accepting work, and disposal rejects late results.

`codegraph.explore` accepts only:

```json
{ "query": "natural-language code question", "maxFiles": 8 }
```

`query` is trimmed, non-empty, and limited to 4,096 UTF-8 bytes. `maxFiles` is optional and limited to 1-32. A successful result is `{ workspaceRoot, maxFiles, content }`; `content` is the exact non-empty upstream text after removal of one terminal line ending. Output is never silently truncated.

## Freshness and mutation

Every exploration validates current machine-readable status first. Exploration is allowed only for an initialized, complete index whose resolved root exactly matches the Runtime Session workspace, whose build and extraction metadata are current, and which has no worktree mismatch, rebuild recommendation, pending changes, or pending references.

When the only stale state is incremental file changes or unresolved references, the plugin may run `codegraph sync <workspace> --quiet` against the existing `.codegraph/` directory. This mutates derived index state, not authored source or canonical Doppelganger state. Concurrent callers join one session-local in-flight sync, then each caller performs its own post-sync status validation. Uninitialized, mismatched, legacy-unsafe, rebuild-required, partial, indexing, or failed indexes are never repaired automatically.

Safe explorations run concurrently up to the configured limit. Additional calls wait in a bounded FIFO queue. Queue overflow, invalid input, unsafe status, empty output, non-zero exit, timeout, output overflow, spawn failure, and disposal map to stable `CODEGRAPH_*` tool errors.

## Process and lifecycle

Commands spawn the validated executable directly with `shell: false`, ignored stdin, explicit argv, and the bound workspace as `cwd`. The child inherits the ordinary process environment needed by CodeGraph but overrides `NO_COLOR=1`, `FORCE_COLOR=0`, `DO_NOT_TRACK=1`, and `CODEGRAPH_TELEMETRY=0`. Stdout, stderr, duration, and concurrency are bounded.

The Loader Fiber owns discovery cache, synchronization, exploration queue, active processes, and both tool registrations. A valid reload commits an independent candidate generation through Composition Runtime and then disposes the old generation. Invalid reload retains the last good generation. Row removal rejects queued work, stops active children with bounded graceful-then-forced termination, awaits reachable settlements, removes both registrations, and leaves the user-owned index intact. Stale host proxies fail through the generic portable-tool replacement contract.

## Trust and disclosure

CodeGraph is trusted local process code, not a sandbox. It runs with the Runtime Session user's filesystem authority and can read the bound repository. Exact-root confinement prevents this integration from deliberately selecting a broader index, but it does not contain a malicious executable. Graph-ranked source and call-path content returned by `codegraph.explore` enters the model context through the host's normal tool-result path. Operators must treat the executable and indexed source as trusted and account for model disclosure and residual context size.

Component lifecycle, status/exploration outcomes, synchronization, bounded failure categories, and cleanup emit ordinary Cordis events under `doppelganger-codegraph`; queries, source output, workspace paths, executable paths, stdout, and stderr are excluded. The shared event vocabulary and destination behavior are owned by [Runtime logging](runtime-logging.md).

## Primary implementation

- `packages/extension-codegraph/src/plugin.ts` — Loader plugin, schemas, and portable registrations.
- `packages/extension-codegraph/src/adapter.ts` — discovery, status gate, synchronization, queueing, exploration, and disposal.
- `packages/extension-codegraph/src/process.ts` — bounded shell-free child execution and termination.
- `packages/extension-codegraph/src/status.ts` — strict status parsing and safety classification.
- `packages/extension-codegraph/tests/plugin.spec.ts` — deterministic process-boundary and lifecycle evidence.
- `packages/extension-codegraph/tests/codegraph.smoke.spec.ts` — opt-in compatible standalone CLI smoke on a disposable repository.
- `packages/omp/tests/plugin-package.spec.ts` — real OMP generic projection and installed-closure evidence.
