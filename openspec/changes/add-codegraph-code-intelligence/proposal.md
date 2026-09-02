## Why

Doppelganger can locate exact symbols and text through host tools, but it has no portable capability for retrieving graph-connected implementation context, call paths, and blast radius in one bounded query. `colbymchenry/codegraph` already provides that local derived index and a stable CLI surface, so integrating it behind Doppelganger's ordinary tool protocol avoids duplicating a code-intelligence engine or binding the capability to one host's MCP configuration.

## What Changes

- Add an optional `@doppelganger/doppelganger-codegraph` Loader plugin that projects CodeGraph-backed code intelligence through transport-neutral Doppelganger tools.
- Expose a bounded `codegraph.explore` tool for graph-ranked source context, call paths, and impact information, plus `codegraph.status` for index health and pending-change diagnostics.
- Bind every invocation to the active Runtime Session's absolute workspace root; tool input cannot select an arbitrary filesystem path.
- Invoke the standalone CodeGraph CLI without a shell, pin and validate the supported CodeGraph version, force telemetry and shared daemons off, bound execution time and captured output, and map process failures to structured portable tool errors.
- Require an existing user-initialized `.codegraph` index. The plugin never installs, upgrades, initializes, deletes, or globally configures CodeGraph; before exploration it may incrementally synchronize only that existing derived index.
- Own all subprocesses and synchronization queues through the Loader Fiber so reload and Runtime Session disposal stop new work, terminate outstanding children, and settle cleanup deterministically.
- Keep shipped `standard` unchanged. Opt-in Runtime Presets compose the new row explicitly, and generic host adapters project its tools without CodeGraph-specific host code.
- Add focused package and real OMP scenarios, package-boundary enforcement, dependency-closure updates, and owning architecture, feature, operations, host, scope, and verification documentation.

## Capabilities

### New Capabilities

- `codegraph-code-intelligence`: Optional local CodeGraph discovery, workspace-bound portable tools, bounded subprocess execution, index freshness, failure behavior, and lifecycle cleanup.

### Modified Capabilities

None. Existing composition, extension-protocol, Runtime Session, and host projection requirements remain authoritative.

## Impact

- New workspace package: `packages/extension-codegraph`.
- New external runtime prerequisite: a separately installed standalone `codegraph` binary compatible with the pinned supported version; automatic dependency installation remains out of scope.
- `@doppelganger/doppelganger-omp` gains the optional package in its private installation closure so user-authored Runtime Presets can resolve the Loader entry; `host-omp` remains dependency- and semantics-neutral.
- New derived project state under the user-initialized `.codegraph/` directory. Doppelganger does not treat that index as authored source or canonical product state.
- Updates to `scripts/package-boundaries.json`, workspace manifests, docs, package tests, and OMP vertical coverage.
- No change to shipped `standard`, Persona, memory, Evolution, Dynamic Runtime Plugins, or host-native MCP configuration.