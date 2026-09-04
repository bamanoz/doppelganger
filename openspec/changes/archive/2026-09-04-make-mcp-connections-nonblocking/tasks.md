## 1. Configuration and test fixtures

- [x] 1.1 Add optional per-server `startupTimeoutMs` to authored and normalized MCP configuration with a 60000ms default, a 1–600000ms integer bound, schema exposure, and configuration-equality participation
- [x] 1.2 Extend configuration tests for defaulting, accepted bounds, rejected values, exact preservation of operator-authored commands/endpoints, and absence of installer, version-selection, or fallback fields
- [x] 1.3 Extend the stdio/HTTP MCP fixtures with gates and outcomes for delayed initialization, delayed initial discovery, spawn failure, transport closure, stale late completion, and exact command/argument observation

## 2. Generation startup and diagnostics

- [x] 2.1 Refactor `McpClientGeneration` around monotonic `connecting`, `active`, `failed`, and `disposed` transitions with one idempotent terminal failure/disposal path
- [x] 2.2 Implement one generation-owned startup deadline spanning transport start, MCP initialization, tools-capability validation, paginated initial discovery, schema validation, and initial commit
- [x] 2.3 Classify and sanitize spawn, initialization, initial-discovery, timeout, transport-close, protocol, validation, and cleanup diagnostics without exposing resolved credential values
- [x] 2.4 Ensure startup timeout or failure closes the owned client transport/process, observes the underlying settlement, records one operational failure, and performs no automatic retry or command substitution
- [x] 2.5 Route unexpected active transport closure through the generation owner so the server becomes failed and its complete committed tool set is withdrawn exactly once
- [x] 2.6 Preserve the prior active tool set after a non-fatal `tools/list_changed` refresh failure while continuing to serialize refreshes for the current generation

## 3. Independent runtime slots

- [x] 3.1 Replace all-server prepared candidates with one runtime slot per enabled server containing normalized config, current generation, stable empty owner registration, committed definitions, and tracked startup settlement
- [x] 3.2 Make initial runtime start synchronously install all enabled slots and launch exactly one concurrent background startup operation per slot without awaiting external MCP work
- [x] 3.3 Commit successful initial discovery through one atomic owner-set replacement and mark only that server active; contain startup or registry failure to the owning failed slot
- [x] 3.4 Keep immutable `doppelgangerMcp.snapshot()` output deterministic and complete for connecting, active, failed, and disposed server state plus bounded chronological diagnostics
- [x] 3.5 Track startup and retirement-cleanup promises so every background rejection is observed and final disposal can await all reachable work

## 4. Loader activation, reload, and disposal

- [x] 4.1 Reorder `McpImportPlugin.apply()` to publish the service and register update/disposal ownership before launching non-blocking runtime startup, with no host or UI dependency
- [x] 4.2 Refactor valid Loader updates to retain identical slots, retire changed/removed generations before cleanup, withdraw their tools atomically, install replacement connecting generations, and return without awaiting external connection success
- [x] 4.3 Preserve synchronous rollback for structurally invalid MCP configuration while treating missing credentials, unavailable commands/endpoints, and protocol/discovery failures as committed per-server operational failure
- [x] 4.4 Reject every stale startup, refresh, close callback, and invocation after replacement by removing current-generation identity before cancellation and cleanup
- [x] 4.5 Make generation and runtime disposal idempotently cancel startup and active calls, remove registrations, close all transports/processes, await all owned settlements, and aggregate cleanup failures after exhaustive attempts

## 5. Behavioral and integration evidence

- [x] 5.1 Add MCP package tests proving Plugin/Runtime Session activation completes while a server remains connecting and that one ready server publishes tools independently of a slow or failed peer
- [x] 5.2 Add MCP package tests proving exact operator-authored command execution, unavailable-executable containment, startup timeout stage classification, initial-discovery failure classification, and no automatic retry/fallback
- [x] 5.3 Add MCP package tests proving one atomic initial catalog commit, retained tools after non-fatal refresh failure, and atomic withdrawal plus stale-closure failure after transport closure
- [x] 5.4 Add MCP package tests proving valid asynchronous reload cutover, changed-timeout replacement, stale late-start rejection, and unchanged-generation retention
- [x] 5.5 Add MCP package tests proving disposal during spawn, initialization, discovery, refresh, and active invocation leaves no late catalog mutation, unhandled rejection, or retained child process
- [x] 5.6 Add Composition Runtime coverage proving the MCP Loader row audits active without awaiting external server readiness and that an operational server failure does not invalidate the Runtime Session
- [x] 5.7 Add OMP vertical coverage proving a session activates before delayed MCP discovery and receives the later tool through the existing generic `toolCatalog.changed` path without MCP-specific production adapter code

## 6. Documentation and verification

- [x] 6.1 Update `docs/features/mcp-tool-import.md` for operator-owned acquisition, background per-server lifecycle, timeout configuration, operational failure semantics, reload cutover, transport withdrawal, and exhaustive cleanup
- [x] 6.2 Update composition activation, configuration, OMP projection, verification, project-status, and README examples only where their owning contracts are affected; explicitly retain the host-neutral and no-UI boundaries
- [x] 6.3 Replace every planned focused-spec evidence reference with the final direct test title and reconcile the active `mcp-tool-import` delta with the current capability owner
- [x] 6.4 Run the narrow `extension-mcp`, Composition Runtime, and host-OMP typechecks and behavioral tests, then exercise a real OMP session using an operator-authored MCP command and observe delayed tool appearance
- [x] 6.5 Run `npm run check:focused-specs:change -- make-mcp-connections-nonblocking`, `npm run test:focused-specs -- --change make-mcp-connections-nonblocking`, `npm run check`, and `openspec validate make-mcp-connections-nonblocking --strict`, resolving every failure
