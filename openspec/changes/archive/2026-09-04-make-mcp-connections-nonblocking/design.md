## Context

`@doppelganger/doppelganger-extension-mcp` is an optional host-neutral Loader plugin. It owns MCP transports under one Runtime Session and publishes discovered tools only through the portable `doppelgangerTools` registry. Host adapters consume ordinary revisioned tool-catalog changes and must not receive MCP configuration, client objects, or feature-specific status contracts.

The current plugin awaits `McpImportRuntime.start()` from `Plugin.apply()`. The runtime prepares every enabled server with `Promise.allSettled`, and each preparation awaits MCP transport connection, initialization, paginated initial `tools/list`, schema validation, and complete candidate construction. Composition Runtime waits for the Loader Fiber, so the slowest external MCP command delays the entire Runtime Session. A user-authored `npx` command can therefore spend the host's extension-handler budget resolving a package before any MCP initialize response exists.

Current reload follows the same prepare-before-commit model: changed servers must connect and validate before the Loader update returns. This provides rollback to the old server generation, but incorrectly treats an optional external dependency's availability as composition validity. The existing tool registry already supports empty owner sets, atomic owner-set replacement, revision notifications, and exact stale descriptor failure. The Runtime Host API and OMP adapter already propagate late catalog changes; no host protocol change is required.

Constraints:

- Configuration shape and synchronous validation remain strict and transactional.
- Cordis remains the owner of plugin services, effects, isolation, reload, and disposal.
- `extension-mcp` remains independent of OMP and every native host API.
- Operators own commands, endpoints, credentials, package managers, installation, and versions.
- Values in service snapshots and diagnostics remain bounded, immutable, JSON-compatible where transported, and credential-safe.
- Background work must not outlive its server generation or Runtime Session.

## Goals / Non-Goals

**Goals:**

- Let the MCP Loader Fiber and Runtime Session activate before external MCP servers finish connecting.
- Connect enabled servers concurrently and contain startup failure to the owning server.
- Publish a server's complete imported tool set only after successful initialization and initial discovery.
- Preserve atomic refresh replacement and retain the last healthy set after a non-fatal refresh failure.
- Withdraw unavailable or retired server tools immediately and reject every stale late commit.
- Bound startup with a per-server timeout and stage-specific diagnostics.
- Make reload and disposal exhaustive across background startup, active calls, transports, registrations, and late callbacks.
- Reuse the existing portable tool-registry and Runtime Host catalog-change path unchanged.

**Non-Goals:**

- OMP status bars, notifications, widgets, or a generic UI/status protocol.
- Any dependency from `extension-mcp` to `host-omp` or another host adapter.
- Installing, downloading, upgrading, pinning, rewriting, or selecting MCP server packages or executables.
- Automatic retry, reconnection, fallback commands, health polling, or backoff policy.
- Lazy connection on first tool invocation; schemas must be discovered before a concrete tool can be advertised.
- Importing prompts, resources, sampling, elicitation, roots, tasks, logging, or native host MCP configuration.
- Changing Runtime Host capabilities, RPC methods, tool naming, approval, invocation, or result contracts.

## Decisions

### 1. Activate the plugin synchronously; own connection work asynchronously

`McpImportPlugin.apply()` will normalize the complete configuration, construct `McpImportRuntime`, publish `McpImportService`, register update and disposal ownership, and then start the runtime without awaiting external connection completion. `McpImportRuntime.start()` will synchronously create server slots and launch tracked background startup operations; it will not expose a rejected promise to the Loader Fiber for operational server failures.

Configuration parsing, unknown fields, invalid IDs, invalid timeout values, invalid transports, malformed aliases, and structurally invalid credential references remain synchronous activation or reload errors. Missing environment values, spawn failures, endpoint failures, protocol negotiation failures, and discovery failures occur inside one server generation and become operational diagnostics.

Alternative: keep awaiting `runtime.start()` and raise the host timeout. Rejected because startup time remains coupled to the slowest external process and every host would need a larger arbitrary budget.

Alternative: defer connection until a model calls a generic MCP tool. Rejected because the runtime cannot advertise concrete names and schemas before `tools/list` succeeds.

### 2. Represent every enabled server with a stable runtime slot and an empty owner set

The runtime map will contain a `ServerSlot` for every enabled server from the moment its generation starts, not only after activation. A slot owns:

- the normalized server configuration;
- the current `McpClientGeneration`;
- one stable `ToolSetRegistration` registered initially with an empty set;
- the currently committed definitions;
- one tracked startup settlement;
- observable state through the generation snapshot.

The service snapshot remains the feature-local portable observation surface and orders every configured server deterministically by ID. No new host notification is introduced.

Registering the empty owner set before connecting gives initial discovery an atomic `registration.replace(definitions)` commit, lets transport failure withdraw one complete set with `replace([])`, and preserves the same owner identity across a changed configuration. Empty registration creates no catalog revision because the tool registry already suppresses unchanged empty sets.

Alternative: register the owner only after discovery. Rejected because startup, replacement, and transport-close paths would need separate ownership and collision cleanup rules.

### 3. Give each client generation one monotonic lifecycle

A generation moves only through:

```text
connecting -> active -> failed -> disposed
           \-------------> disposed
```

`failed` is terminal for this change; there is no automatic retry. A generation becomes `active` only after transport start, MCP initialization, tools-capability validation, complete initial discovery, definition validation, and atomic registry commit. `dispose()` may be called from any state and is idempotent.

The runtime's `isCurrent(generation)` identity check remains the authority for catalog commits. Retirement removes current identity before cancellation or transport cleanup. Every startup continuation and list-change refresh rechecks both generation disposal and current identity immediately before registry mutation. Late completion therefore cannot publish tools or mutate the replacement snapshot.

Alternative: reuse one client object across configuration updates. Rejected because endpoint, process, credentials, schema closures, active requests, and notification handlers must remain bound to one exact configuration generation.

### 4. Start servers concurrently, but commit each independently

Startup operations are launched once per enabled server without an all-server preparation barrier. A successful server replaces only its own empty owner set and becomes active. A failed server records its diagnostic, closes owned resources, remains visible as failed, and leaves unrelated slots untouched.

Initial registry collision or definition failure is local to the server whose commit fails. Names include stable server IDs, so cross-server collisions are structurally avoided; collisions with another registry owner still fail closed. No partial tool set is published.

Alternative: wait for all enabled servers and commit one aggregate candidate. Rejected because one optional dependency would continue blocking every healthy server and the Runtime Session.

### 5. Use one bounded startup deadline with an explicit current stage

`McpServerConfig` gains optional `startupTimeoutMs`. Normalization requires a safe integer from 1 through 600000 milliseconds and defaults to 60000. The normalized value participates in configuration equality, so changing it replaces that server generation.

One generation-owned deadline covers transport start, MCP initialization, tools-capability validation, initial paginated `tools/list`, schema validation, and initial candidate commit. The generation tracks a coarse current stage:

```text
spawn | initialize | discover | commit
```

Stdio transport start failure before process creation maps to `MCP_SPAWN_FAILED`. A deadline while the MCP client is awaiting initialize maps to `MCP_INITIALIZE_TIMEOUT`; a deadline during initial list pagination or validation maps to `MCP_DISCOVERY_TIMEOUT`. Protocol and validation failures use corresponding non-timeout codes. Timeout starts disposal immediately, and the startup settlement remains tracked until both the startup path and reachable cleanup settle.

The implementation will pass the remaining deadline to MCP SDK requests where supported and retain its own generation deadline as the lifecycle authority. A timeout race alone is insufficient cleanup: it must abort or close the client transport and await the owned startup settlement without leaving an unhandled request.

Diagnostics contain server ID, code, stage-derived bounded message, timestamp, and severity. They never include resolved credential values. Existing bounded chronological retention remains.

Alternative: rely only on the MCP SDK's default request timeout. Rejected because it does not express the complete startup budget or reliably distinguish transport start, initialization, and initial discovery.

Alternative: separate operator settings for spawn, initialize, and discovery. Rejected for now because it adds configuration surface without evidence that independent policies are needed; one deadline plus stage diagnosis addresses the observed problem.

### 6. Treat active transport closure differently from refresh failure

A failed `notifications/tools/list_changed` refresh leaves the existing active transport and prior committed set intact when the transport itself remains usable. The runtime records a diagnostic and waits for another server notification or explicit configuration replacement; it does not retry independently.

Unexpected transport closure marks the generation failed and atomically replaces its owner set with empty definitions. This emits the ordinary portable catalog change, causes hosts with dynamic-tool support to remove proxies, and ensures retained descriptor closures fail current-generation or availability checks.

The close callback delegates state mutation to one idempotent generation failure path so close, timeout, invocation failure, and disposal races cannot publish duplicate withdrawal transitions.

Alternative: retain tools after transport closure. Rejected because the host would advertise tools that cannot be invoked.

Alternative: withdraw tools after any refresh error. Rejected because schema or list errors need not invalidate the last healthy callable generation.

### 7. Make valid reload a clean asynchronous cutover

`McpImportRuntime.update()` remains awaited by Cordis for deterministic local mutation, but it does not await external startup. It will:

1. validate and normalize the complete candidate config before runtime mutation;
2. retain slots whose normalized configuration is identical;
3. mark changed and removed generations stale;
4. atomically withdraw their committed owner sets;
5. dispose removed slots and retain no snapshot entry for them;
6. reuse the stable empty owner registration for changed server IDs;
7. install new connecting generations and launch their tracked startup operations;
8. return after local ownership is committed, while changed and added servers connect in the background.

A valid configuration that points to an unavailable executable or endpoint commits as configuration and later reports that server failed. The previous generation is not restored. This separates configuration validity from external operational health and is the intentional behavioral break.

Disposal of retired resources may continue as runtime-owned tracked cleanup after the local cutover, but failures are recorded and all such work is awaited by final Runtime Session disposal. Update never leaves the old generation current while starting its replacement.

Alternative: preserve prepare-before-withdraw rollback for reload only. Rejected because reload would still block on external dependencies and valid authored configuration would not become the active truth until an optional server was healthy.

### 8. Track every background settlement and dispose exhaustively

The runtime owns sets of startup and retirement-cleanup settlements. Generation disposal first marks the generation disposing/stale, withdraws its tool set when still present, aborts active invocations and startup requests, closes the MCP client/transport, and waits for reachable request and refresh settlements. Runtime disposal clears current identities before acting, disposes every registration, awaits every generation and tracked cleanup with `Promise.allSettled`, and reports an aggregate cleanup failure only after all reachable work has settled.

A background startup rejection is always observed by the runtime and converted to server state plus diagnostic; it cannot become an unhandled rejection or fail the Cordis root after activation.

Alternative: fire-and-forget startup promises without tracking. Rejected because replacement and session disposal could leak child processes, HTTP requests, callbacks, or late catalog commits.

### 9. Keep host integration unchanged

The only externally projected success signal remains a mutation of `doppelgangerTools`, which emits `doppelganger/tools-changed`. The shared Runtime Host bridge converts that revision into its existing `toolCatalogChanged(revision)` callback. OMP and future dynamic-capable adapters fetch and exactly replace the complete catalog through their existing implementations.

`extension-mcp` does not import Runtime Host or OMP types, and no MCP state is sent over host RPC. Host integration tests prove late tool appearance and failure containment through the existing generic catalog mechanism; production host code changes only if a test exposes a generic projection defect.

Alternative: expose `connecting` and `failed` through OMP `ctx.ui`. Rejected as host-specific policy with no demonstrated cross-host semantic contract.

## Risks / Trade-offs

- [A valid reload can temporarily remove working tools before its replacement connects] → Treat authored configuration as current truth, make the withdrawal atomic, expose connecting/failed state through `doppelgangerMcp.snapshot()`, and require explicit operator correction rather than silently retaining stale configuration.
- [Many configured servers can create concurrent process/network load] → Preserve the existing maximum of 128 servers, launch exactly one startup per enabled server, add no retries, and bound each startup deadline.
- [Timeout and transport-close races can double-report or double-dispose] → Centralize terminal generation transition, make disposal idempotent, and test timeout/close/reload/disposal interleavings.
- [A timed-out MCP SDK request may continue after the caller's race settles] → Close or abort the owned client transport, retain the underlying settlement, and await it during generation/runtime disposal.
- [Operational failures no longer trigger Composition Runtime rollback] → Keep all structural config validation synchronous, document the breaking semantic split, and provide immutable server state plus diagnostics for operators.
- [A host without dynamic tool replacement will not expose late MCP tools] → Keep this feature dependent only on the portable registry; adapter capability fidelity remains the host's responsibility and no host-specific workaround is added.
- [Default 60000ms may be too short for some package-manager cold starts] → Let operators raise `startupTimeoutMs` up to 600000ms without Doppelganger choosing or installing a different dependency.

## Migration Plan

1. Extend MCP server configuration and normalization with `startupTimeoutMs`, preserving existing authored configurations through the 60000ms default.
2. Refactor runtime ownership around server slots, empty owner registrations, tracked startup settlements, and independent terminal state.
3. Refactor client startup, stage classification, timeout, transport-close withdrawal, and idempotent disposal.
4. Change initial activation and Loader updates to commit local ownership without awaiting external connection success.
5. Add focused package tests for background activation, independent servers, exact command use, timeout stages, transport closure, reload races, and startup disposal.
6. Add Composition Runtime and OMP vertical evidence that the Runtime Session starts before a delayed MCP server and later receives its ordinary catalog update.
7. Update MCP, composition, configuration, verification, and status documentation in the same implementation change.
8. Run narrow package checks, a real OMP smoke using an operator-authored MCP command, `npm run check`, focused-spec validation/evidence, and strict OpenSpec validation.

Rollback is a source rollback. Existing configurations without `startupTimeoutMs` remain valid. If an operator starts using `startupTimeoutMs`, that field must be removed before running an older release whose strict schema does not recognize it. No persistent data migration exists.

## Open Questions

None. The change intentionally fixes the startup lifecycle only; retry policy, generic operational-status projection, and host UI remain separate future decisions.
