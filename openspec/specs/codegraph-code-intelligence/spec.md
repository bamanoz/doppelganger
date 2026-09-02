# codegraph-code-intelligence Specification

## Purpose

Define an optional portable CodeGraph integration that binds local graph-backed code intelligence to one Runtime Session workspace, projects it through standard Doppelganger tools, and contains external CLI execution, derived-index mutation, failures, and cleanup.

## Requirements

### Requirement: CodeGraph is an optional Loader extension
The repository SHALL provide an installable Loader plugin package `@doppelganger/doppelganger-codegraph` with a declared Loader entry. The plugin SHALL inject `doppelgangerRuntimeSession` and `doppelgangerTools`, SHALL register only transport-neutral portable tools, and SHALL require explicit Runtime Preset composition. The shipped `standard` Runtime Preset and generic host packages SHALL NOT acquire CodeGraph semantics or an implicit CodeGraph requirement.

#### Scenario: Runtime Preset omits CodeGraph
- **ID**: `codegraph.composition.omission-neutral`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::leaves a runtime unchanged when CodeGraph is omitted`
- **WHEN** a Runtime Preset does not compose the CodeGraph Loader row
- **THEN** the Runtime Session activates without CodeGraph tools, binary discovery, subprocesses, or index access

#### Scenario: Runtime Preset composes CodeGraph
- **ID**: `codegraph.composition.explicit-tools`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::registers the bounded CodeGraph tool surface only when composed`
- **WHEN** a Runtime Preset explicitly composes the CodeGraph Loader row with its required isolated services
- **THEN** that Runtime Session owns exactly the portable `codegraph.status` and `codegraph.explore` registrations

### Requirement: The standalone CodeGraph CLI is a diagnosed prerequisite
The plugin SHALL invoke a separately installed standalone `codegraph` executable rather than importing the CodeGraph engine into the Doppelganger Node process. Configuration MAY select an absolute executable path; otherwise discovery SHALL use the Runtime Session process environment. The plugin SHALL validate the executable's reported version against the repository's tested compatibility line before exploration, SHALL cache only a successful immutable discovery result for the plugin generation, and SHALL expose missing, non-executable, malformed, and unsupported binaries as bounded structured status or invocation failures. It SHALL NOT install, upgrade, download, self-configure, or invoke CodeGraph's agent installer.

#### Scenario: Compatible binary is installed
- **ID**: `codegraph.binary.compatible`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::accepts the tested standalone CodeGraph compatibility line`
- **WHEN** binary discovery resolves an executable whose version belongs to the configured supported line
- **THEN** status reports the exact executable and version and exploration may proceed

#### Scenario: Binary is absent or unsupported
- **ID**: `codegraph.binary.unavailable`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::diagnoses absent malformed and unsupported CodeGraph binaries without installation`
- **WHEN** discovery cannot execute a compatible CodeGraph binary
- **THEN** status reports the bounded prerequisite diagnostic and exploration fails with a stable structured error without changing the machine

### Requirement: Every operation is bound to host-owned workspace metadata
The plugin SHALL derive the project root exclusively from the active `doppelgangerRuntimeSession.workspaceRoot`. It SHALL reject exploration when that metadata is absent, SHALL pass the exact normalized absolute root to CodeGraph, and SHALL NOT accept a path, working directory, index directory, environment override, executable, or arbitrary argument from tool input. Symlink and worktree diagnostics returned by CodeGraph SHALL remain visible rather than being silently redirected to another index.

#### Scenario: Caller explores the active workspace
- **ID**: `codegraph.workspace.bound`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::binds every CodeGraph command to Runtime Session workspace metadata`
- **WHEN** a caller invokes a CodeGraph tool in a Runtime Session with an absolute workspace root
- **THEN** every status, synchronization, and exploration command targets exactly that root regardless of query content

#### Scenario: Runtime Session has no workspace
- **ID**: `codegraph.workspace.required`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::rejects exploration without host-owned workspace metadata`
- **WHEN** `codegraph.explore` is invoked in a Runtime Session without `workspaceRoot`
- **THEN** the invocation returns a stable workspace-required error and starts no CodeGraph process

### Requirement: Status returns a bounded normalized index diagnosis
`codegraph.status` SHALL run CodeGraph's machine-readable status command for the bound workspace and return a JSON-compatible normalized result covering binary availability and version, initialization, project and index roots, last-indexed time, file/node/edge counts, pending changes, worktree mismatch, build-version compatibility, extraction-version compatibility, index state, pending references, and whether exploration is currently safe. Unknown additive upstream fields SHALL be ignored. Malformed, oversized, timed-out, or unsuccessful status output SHALL produce a structured diagnostic rather than unvalidated data.

#### Scenario: Initialized index is healthy
- **ID**: `codegraph.status.healthy`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::normalizes a healthy machine-readable CodeGraph status`
- **WHEN** a compatible CodeGraph binary reports an initialized complete current index for the bound workspace
- **THEN** `codegraph.status` returns bounded normalized counts and marks exploration safe

#### Scenario: Status output is invalid
- **ID**: `codegraph.status.invalid-output`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::rejects invalid or oversized CodeGraph status output`
- **WHEN** CodeGraph exits unsuccessfully or emits malformed, unsupported, timed-out, or oversized status output
- **THEN** the tool returns a stable structured failure without treating the index as healthy

### Requirement: Exploration uses an existing current index only
`codegraph.explore` SHALL accept a non-empty bounded natural-language query and an optional bounded `maxFiles`; it SHALL expose no other CodeGraph arguments. Before querying, the plugin SHALL validate status. It SHALL reject an uninitialized index, worktree mismatch, rebuild recommendation, partial, indexing, failed, or otherwise unsafe index. When the only stale state is incremental pending file changes or unresolved references, it SHALL run `codegraph sync --quiet` against the existing index, re-read status, and query only after the result is safe. The plugin SHALL never run `init`, `index`, `uninit`, `install`, `upgrade`, a watcher, UI server, MCP server, or detached daemon.

#### Scenario: Existing index has incremental changes
- **ID**: `codegraph.explore.incremental-sync`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::synchronizes an existing changed index before exploration`
- **WHEN** exploration observes only incrementally repairable pending changes or references
- **THEN** one serialized synchronization completes, status is revalidated, and the query runs against the current index

#### Scenario: Index requires initialization or rebuild
- **ID**: `codegraph.explore.unsafe-index`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::refuses initialization rebuild and unsafe index states`
- **WHEN** the bound workspace has no index or CodeGraph reports a mismatch, rebuild recommendation, partial build, indexing build, or failed build
- **THEN** exploration returns an actionable stable error and performs no destructive or full-index command

#### Scenario: Concurrent exploration observes stale index
- **ID**: `codegraph.explore.sync-deduplication`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::deduplicates concurrent synchronization and revalidates every waiting exploration`
- **WHEN** concurrent exploration calls observe the same incrementally stale index
- **THEN** the Runtime Session performs at most one in-flight sync and each waiting call revalidates safety before reading

### Requirement: Exploration returns bounded graph context
For a safe index, `codegraph.explore` SHALL invoke the upstream `explore` CLI command with the bound workspace and validated file limit, then return its graph-ranked source context and call paths as one JSON-compatible result. Query size, file count, execution duration, stdout, stderr, and result size SHALL have strict configurable bounds with conservative defaults and hard ceilings. Empty, malformed, timed-out, killed, oversized, or non-zero results SHALL become stable structured errors; the plugin SHALL NOT silently truncate output and present it as complete.

#### Scenario: Graph exploration succeeds
- **ID**: `codegraph.explore.success`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::returns bounded graph-ranked source and call-path context`
- **WHEN** CodeGraph successfully explores a valid bounded query against a safe index
- **THEN** the portable tool returns the exact bounded textual context with the effective file limit and workspace identity

#### Scenario: Exploration exceeds a bound
- **ID**: `codegraph.explore.bounded-failure`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::fails closed on query timeout output and process bounds`
- **WHEN** query input or CodeGraph execution exceeds a configured hard bound
- **THEN** the process is stopped and the invocation returns a stable bounded failure without partial context

### Requirement: CLI execution is shell-free, local, and non-telemetric
The plugin SHALL spawn the validated executable directly with an explicit argument vector and `shell: false`, set the working directory to the bound workspace, disable color, set both `DO_NOT_TRACK=1` and `CODEGRAPH_TELEMETRY=0`, and never invoke a network-capable update or installation command. The executable remains trusted local process code with the Runtime Session user's filesystem authority; the integration SHALL document that it is not a sandbox and that indexed source may be returned to the model through the host's normal tool-result path.

#### Scenario: CodeGraph command is launched
- **ID**: `codegraph.process.trust-boundary`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::spawns CodeGraph without a shell telemetry or caller-controlled arguments`
- **WHEN** the plugin starts any CodeGraph operation
- **THEN** the child receives only the validated command arguments, bound workspace, disabled telemetry and color environment, and ordinary trusted-process authority

### Requirement: Runtime lifecycle owns every process and registration
The Loader plugin SHALL own tool registrations, discovery state, synchronization state, and every child process through its Cordis scope. Reload SHALL create an independent candidate generation and commit tool replacement only through existing Composition Runtime semantics. Disposal SHALL stop accepting work, reject queued work, terminate all outstanding children with bounded graceful-then-forced shutdown, await their settlement, remove tool registrations, and aggregate cleanup failures without leaving a daemon or watcher. A stale projected host closure SHALL remain subject to the existing portable-tool stale-registration behavior.

#### Scenario: Runtime Session disposes during work
- **ID**: `codegraph.lifecycle.disposal`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::terminates outstanding CodeGraph work and removes registrations on disposal`
- **WHEN** the Runtime Session or plugin generation disposes while status, sync, or exploration is running or queued
- **THEN** all reachable work settles within the shutdown bound, children terminate, queued calls fail closed, and CodeGraph tools are removed

#### Scenario: Valid reload replaces CodeGraph configuration
- **ID**: `codegraph.lifecycle.reload-cutover`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::cuts over CodeGraph configuration only after committed reload`
- **WHEN** a watched valid Runtime Preset update changes CodeGraph configuration
- **THEN** the next invocation uses only the committed generation while the prior generation's registrations and processes are disposed

### Requirement: Generic OMP packaging resolves and projects the extension
The private OMP distribution package SHALL include the CodeGraph extension package in its installation closure so a user-authored Runtime Preset can resolve the Loader entry. The OMP host SHALL project the resulting portable tools through its existing generic tool bridge without CodeGraph-specific routing, command execution, approval, or index logic. Repository verification SHALL exercise the actual project-local OMP extension with a temporary Runtime Preset, workspace, actor, CodeGraph executable, and index state.

#### Scenario: Real OMP session uses CodeGraph tools
- **ID**: `codegraph.host.omp-generic`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::projects CodeGraph generically through the real OMP extension`
- **WHEN** a temporary OMP installation selects a Runtime Preset that composes CodeGraph for an initialized workspace
- **THEN** OMP discovers the package from its installed closure and invokes the portable status and exploration tools without host-specific CodeGraph code

#### Scenario: Shipped standard remains unchanged
- **ID**: `codegraph.host.standard-neutral`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::activates shipped standard from a fresh home without authored package defaults`
- **WHEN** a fresh Doppelganger home activates the shipped `standard` Runtime Preset
- **THEN** no CodeGraph tool, process, prerequisite, or index access is introduced
