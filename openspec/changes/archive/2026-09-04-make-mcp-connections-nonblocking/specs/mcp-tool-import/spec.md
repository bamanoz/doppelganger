## ADDED Requirements

### Requirement: MCP server acquisition remains operator-owned
The MCP extension SHALL execute the exact validated stdio command and arguments or Streamable HTTP endpoint authored by the Runtime Preset operator. It SHALL NOT install, download, upgrade, pin, rewrite, substitute, or fall back to an MCP server executable, package, endpoint, or version. A package manager command such as `npx` SHALL be treated as an ordinary user-configured executable whose startup behavior is owned by that configuration.

#### Scenario: Operator configures package-manager startup
- **ID**: `mcp.tool.import.operator-configures-package-manager-startup`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::uses the exact configured MCP command without managing its package or version`
- **WHEN** an operator configures a stdio server command that resolves or downloads a package before starting the MCP protocol
- **THEN** the extension executes that exact command without changing its package or version and contains any delay through the server's background startup lifecycle

#### Scenario: Configured executable is unavailable
- **ID**: `mcp.tool.import.configured-executable-is-unavailable`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::reports an unavailable configured executable without failing the runtime session`
- **WHEN** the exact configured stdio executable cannot be spawned
- **THEN** that server becomes failed with a sanitized spawn diagnostic and no replacement executable is selected

### Requirement: MCP servers connect independently in the background
After complete synchronous configuration validation, the MCP Loader plugin SHALL publish its session-isolated service and return from activation without waiting for any external server to spawn, initialize, or complete initial tool discovery. It SHALL create every enabled server as an independently owned `connecting` generation and start those generations concurrently. Connection or discovery failure SHALL be operational state local to that server and SHALL NOT fail the Loader Fiber, Runtime Session, Persona, unrelated extensions, or another configured MCP server.

#### Scenario: Slow server does not delay Runtime Session activation
- **ID**: `mcp.tool.import.slow-server-does-not-delay-runtime-activation`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::activates the plugin while an MCP server is still connecting`
- **WHEN** an enabled MCP server remains in initialization after the Loader row has been validated
- **THEN** the Runtime Session becomes active with that server reported as connecting and without waiting for its external startup

#### Scenario: Ready server is not blocked by another server
- **ID**: `mcp.tool.import.ready-server-is-not-blocked-by-another-server`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::publishes each server independently while another server is still connecting`
- **WHEN** one configured server completes discovery while another configured server remains connecting
- **THEN** the ready server becomes active and publishes its complete portable tool set without waiting for the other server

#### Scenario: One server fails while another remains active
- **ID**: `mcp.tool.import.one-server-fails-while-another-remains-active`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::contains startup failure to one MCP server generation`
- **WHEN** one configured server fails during startup after another server has become active
- **THEN** only the failed server has no tools and reports failed state while the active server and Runtime Session remain usable

### Requirement: Background startup is bounded and stage-diagnosed
Each server configuration SHALL accept an optional bounded positive `startupTimeoutMs`, defaulting to 60000 milliseconds. The timeout SHALL cover the complete initial connection sequence from transport start through MCP initialization, required tools-capability negotiation, paginated initial `tools/list`, schema validation, and candidate preparation. Timeout or failure SHALL close the generation's owned transport and process, leave its tool set empty, and record a bounded credential-safe diagnostic that distinguishes spawn, initialization, initial discovery, transport closure, and cleanup stages. The extension SHALL NOT retry automatically.

#### Scenario: Server exceeds its startup timeout
- **ID**: `mcp.tool.import.server-exceeds-startup-timeout`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::times out and disposes a server that never completes initialization`
- **WHEN** a server does not finish initialization and initial discovery within its configured startup timeout
- **THEN** the server becomes failed, its owned resources are closed, and its diagnostic identifies the timed-out startup stage without failing the Runtime Session

#### Scenario: Initial discovery fails after initialization
- **ID**: `mcp.tool.import.initial-discovery-fails-after-initialization`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::distinguishes initial discovery failure from transport startup failure`
- **WHEN** MCP initialization succeeds but the initial paginated `tools/list` request or schema validation fails
- **THEN** the server becomes failed with no published tools and a sanitized initial-discovery diagnostic distinct from spawn or initialization failure

## MODIFIED Requirements

### Requirement: Atomic discovery generation replacement
The extension SHALL build and validate a complete owner-scoped tool set before committing it to `doppelgangerTools`. Successful initial discovery SHALL atomically replace the server generation's empty set; a successful list-change refresh SHALL atomically replace its prior committed set; each successful replacement SHALL emit one catalog mutation. A failed initial discovery SHALL leave that server's set empty and failed without affecting other owners. A failed refresh after activation SHALL retain the server's prior healthy set and callable generation. Unexpected transport closure or generation retirement SHALL immediately withdraw that server's complete committed set so hosts do not retain unavailable tools.

#### Scenario: Initial discovery commits one complete set
- **ID**: `mcp.tool.import.initial-discovery-commits-one-complete-set`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::publishes one atomic catalog change after background initial discovery`
- **WHEN** a connecting server completes all initial discovery and validation successfully
- **THEN** observers see its complete tool set become active in one owner-scoped catalog mutation and never observe a partial discovered set

#### Scenario: List-change notification succeeds
- **ID**: `mcp.tool.import.list-change-notification-succeeds`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** a server that advertised tool list changes emits `notifications/tools/list_changed` and refreshed discovery succeeds
- **THEN** the prior server-owned set is atomically replaced and dynamic-capable hosts receive one new catalog revision

#### Scenario: Refresh fails after a healthy generation
- **ID**: `mcp.tool.import.refresh-fails-after-a-healthy-generation`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** a refresh encounters a transport error, invalid schema, duplicate name, or registry collision without closing the generation transport
- **THEN** the previous generation remains callable and the failure is reported diagnostically

#### Scenario: Active server transport closes
- **ID**: `mcp.tool.import.active-server-transport-closes`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::withdraws imported tools when an active server transport closes`
- **WHEN** an active server's transport closes unexpectedly
- **THEN** its entire committed tool set is withdrawn in one catalog mutation and retained descriptor closures fail unavailable

### Requirement: Exhaustive server lifecycle ownership
The MCP extension SHALL register background startup tasks, processes, transports, subscriptions, active requests, tool sets, and cleanup as lifecycle work owned by the server generation and Runtime Session. A valid Loader update SHALL retain unchanged server generations, immediately retire changed or removed generations, atomically withdraw their committed tool sets, and create changed or added generations in `connecting` state without awaiting external connection success. A replacement startup failure SHALL remain the new server's operational failed state and SHALL NOT restore the retired configuration. Retirement or Runtime Session disposal SHALL make the generation stale before cleanup, prevent new calls and late commits, cancel startup and active requests, attempt every cleanup action, await all owned settlements, and preserve primary failures while reporting cleanup failures.

#### Scenario: Runtime Session disposes with active MCP calls
- **ID**: `mcp.tool.import.runtime-session-disposes-with-active-mcp-calls`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::cancels active stdio requests during session disposal`
- **WHEN** session disposal begins while stdio or HTTP calls are active
- **THEN** new invocations fail unavailable, active signals abort, all server generations and tool sets are withdrawn, and no late notification republishes tools

#### Scenario: Runtime Session disposes during startup
- **ID**: `mcp.tool.import.runtime-session-disposes-during-startup`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::disposes a connecting generation without a late tool commit or retained process`
- **WHEN** session disposal begins while a server is spawning, initializing, or performing initial discovery
- **THEN** startup is cancelled, every reachable owned resource terminates, and no late result changes the disposed service or portable catalog

#### Scenario: Valid runtime reload replaces MCP configuration
- **ID**: `mcp.tool.import.valid-runtime-reload-replaces-mcp-configuration`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::replaces changed MCP configuration with a background generation`
- **WHEN** Loader commits a valid changed server configuration
- **THEN** the prior generation becomes stale and its tools are withdrawn before the replacement connects independently in the background

#### Scenario: Retired startup settles after replacement
- **ID**: `mcp.tool.import.retired-startup-settles-after-replacement`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::ignores a stale startup result after server replacement`
- **WHEN** an old generation completes initialization or discovery after reload has retired it
- **THEN** the stale result cannot publish tools, mutate the current server snapshot, or affect the replacement generation
