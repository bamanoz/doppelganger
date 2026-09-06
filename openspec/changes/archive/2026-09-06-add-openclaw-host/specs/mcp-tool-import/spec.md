## MODIFIED Requirements

### Requirement: Runtime Preset-owned MCP server configuration
The MCP extension SHALL be an ordinary Loader plugin configured inside a Runtime Preset. Each server entry SHALL use a stable lowercase-kebab server ID and validated transport configuration. Server configuration, enablement, aliases, approval policy, credentials references, and optional `startupMode` SHALL belong to the Runtime Preset plugin row or plugin-owned assets rather than native host MCP configuration. The plugin row SHALL accept `startupMode` values `background` and `await-ready`, default the omitted value to `background`, and reject every other value during complete synchronous configuration normalization before external work begins. The selected mode SHALL govern only the initial application of that Loader plugin instance; it SHALL NOT implicitly change accepted in-place update or notification-refresh semantics.

#### Scenario: Preset moves between supported hosts
- **ID**: `mcp.tool.import.preset-moves-between-supported-hosts`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** the same Runtime Preset is selected in OMP and DSH
- **THEN** the MCP extension reads the same server roster and publishes the same portable tool definitions without copying configuration into either host

#### Scenario: One server configuration is invalid
- **ID**: `mcp.tool.import.one-server-configuration-is-invalid`
- **EVIDENCE**: `packages/extension-mcp/tests/config.spec.ts::normalizes stdio, stateless HTTP, references, aliases, disablement, and approval`
- **WHEN** a server entry has an invalid ID, transport, command, endpoint, alias, schema override, or approval policy
- **THEN** activation or reload fails visibly at the owning configuration boundary and does not partially apply that server generation

#### Scenario: Startup mode defaults to background
- **ID**: `mcp.tool.import.startup-mode-defaults-to-background`
- **EVIDENCE**: `packages/extension-mcp/tests/config.spec.ts::defaults MCP startup mode to background`
- **WHEN** an MCP Loader plugin row omits `startupMode`
- **THEN** complete configuration normalization records `background` as the selected initial-application mode

#### Scenario: Await-ready startup mode is valid
- **ID**: `mcp.tool.import.await-ready-startup-mode-is-valid`
- **EVIDENCE**: `packages/extension-mcp/tests/config.spec.ts::accepts await-ready MCP startup mode`
- **WHEN** an MCP Loader plugin row sets `startupMode` to `await-ready`
- **THEN** complete configuration normalization preserves that exact selected initial-application mode

#### Scenario: Invalid startup mode is rejected before acquisition
- **ID**: `mcp.tool.import.invalid-startup-mode-rejected-before-acquisition`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::rejects invalid startup mode before starting any MCP server`
- **WHEN** an MCP Loader plugin row supplies a `startupMode` other than `background` or `await-ready`
- **THEN** activation rejects during complete synchronous normalization without publishing the service or starting external MCP acquisition

#### Scenario: Await-ready mode accepts an empty enabled set
- **ID**: `mcp.tool.import.await-ready-empty-enabled-set`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::treats an empty enabled MCP set as ready in await-ready mode`
- **WHEN** an `await-ready` MCP Loader plugin row contains no enabled server entries
- **THEN** initial activation succeeds without external work and publishes a session-isolated service with an empty server roster

### Requirement: Atomic discovery generation replacement
The extension SHALL build and validate a complete owner-scoped tool set before committing it to `doppelgangerTools`. Successful initial discovery SHALL atomically replace the server generation's empty set; a successful list-change refresh SHALL atomically replace its prior committed set; each successful replacement SHALL emit one catalog mutation. A failed initial discovery SHALL leave that server's set empty and failed without affecting unrelated owners as part of the server-local failure transition; this SHALL NOT prevent exhaustive withdrawal of every attempted-session owner when an `await-ready` initial activation fails. A failed refresh after activation SHALL retain the server's prior healthy set and callable generation. Unexpected transport closure or generation retirement SHALL immediately withdraw that server's complete committed set so hosts do not retain unavailable tools.

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

#### Scenario: Await-ready server commits a valid empty tool set
- **ID**: `mcp.tool.import.await-ready-valid-empty-tool-set`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::accepts an active await-ready MCP server with zero tools`
- **WHEN** an enabled `await-ready` server completes initialization and validated discovery with zero tools
- **THEN** its empty owner-scoped set commits atomically and its active generation satisfies initial readiness without requiring a positive tool count

### Requirement: Exhaustive server lifecycle ownership
The MCP extension SHALL register startup tasks in either startup mode, processes, transports, subscriptions, active requests, tool sets, and cleanup as lifecycle work owned by the server generation and Runtime Session. An accepted in-place Loader update SHALL retain unchanged normalized server generations, immediately retire changed or removed generations, atomically withdraw their committed tool sets, and create changed or added generations in `connecting` state without awaiting external connection success, irrespective of the initial-application startup mode. A replacement startup failure from that update SHALL remain the new server's operational failed state and SHALL NOT restore the retired configuration. A newly applied or recreated Loader plugin instance SHALL follow its configured initial startup mode. Retirement or Runtime Session disposal SHALL make the generation stale before cleanup, prevent new calls and late commits, cancel startup and active requests, attempt every cleanup action, await all owned settlements, and preserve primary failures while reporting cleanup failures.

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
- **WHEN** Loader commits a valid in-place update with changed server configuration
- **THEN** the prior generation becomes stale and its tools are withdrawn before the replacement connects independently in the background

#### Scenario: Retired startup settles after replacement
- **ID**: `mcp.tool.import.retired-startup-settles-after-replacement`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::ignores a stale startup result after server replacement`
- **WHEN** an old generation completes initialization or discovery after reload has retired it
- **THEN** the stale result cannot publish tools, mutate the current server snapshot, or affect the replacement generation

#### Scenario: Await-ready activation is disposed before readiness
- **ID**: `mcp.tool.import.await-ready-activation-disposed-before-readiness`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::cancels await-ready MCP activation without late catalog publication`
- **WHEN** Runtime Session disposal cancels an `await-ready` initial application before every enabled generation is active
- **THEN** the attempted activation rejects, makes every generation stale before exhaustive cleanup, and cannot publish a late tool set

#### Scenario: Await-ready row ignores a stale replacement result
- **ID**: `mcp.tool.import.await-ready-row-ignores-stale-replacement-result`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::ignores stale startup after replacing a server in an await-ready row`
- **WHEN** successive in-place updates retire a still-connecting replacement generation after an `await-ready` row has activated
- **THEN** the retired generation's later startup outcome cannot publish tools, mutate the current snapshot, or satisfy readiness for its replacement

#### Scenario: Await-ready row retains an unchanged generation
- **ID**: `mcp.tool.import.await-ready-row-retains-unchanged-generation`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::retains an unchanged MCP generation after await-ready activation`
- **WHEN** an accepted in-place update preserves an `await-ready` row's normalized server configuration
- **THEN** the active generation and committed tool set are retained without reconnecting or reapplying initial readiness

#### Scenario: Await-ready row updates changed servers in the background
- **ID**: `mcp.tool.import.await-ready-row-updates-changed-servers-in-background`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::keeps in-place MCP updates background after await-ready activation`
- **WHEN** an accepted in-place update changes or adds a server after an `await-ready` row has activated
- **THEN** the update returns without awaiting the new generation and an operational replacement failure does not restore retired configuration

### Requirement: MCP server acquisition remains operator-owned
The MCP extension SHALL execute the exact validated stdio command and arguments or Streamable HTTP endpoint authored by the Runtime Preset operator. It SHALL NOT install, download, upgrade, pin, rewrite, substitute, or fall back to an MCP server executable, package, endpoint, or version. A package manager command such as `npx` SHALL be treated as an ordinary user-configured executable whose startup behavior is owned by that configuration. Any resulting startup work SHALL remain bounded under the selected startup mode.

#### Scenario: Operator configures package-manager startup
- **ID**: `mcp.tool.import.operator-configures-package-manager-startup`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::uses the exact configured MCP command without managing its package or version`
- **WHEN** an operator configures a background-mode stdio server command that resolves or downloads a package before starting the MCP protocol
- **THEN** the extension executes that exact command without changing its package or version and contains any delay through the server's background startup lifecycle

#### Scenario: Configured executable is unavailable
- **ID**: `mcp.tool.import.configured-executable-is-unavailable`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::reports an unavailable configured executable without failing the runtime session`
- **WHEN** the exact configured stdio executable cannot be spawned during background-mode activation
- **THEN** that server becomes failed with a sanitized spawn diagnostic and no replacement executable is selected

### Requirement: MCP servers connect independently in the background
After complete synchronous configuration validation, the MCP Loader plugin SHALL publish its session-isolated service, create every enabled server as an independently owned `connecting` generation, and start those generations concurrently. In `background` mode it SHALL return from activation without awaiting external startup or initial discovery; connection or discovery failure SHALL remain operational state local to that server and SHALL NOT fail the Loader Fiber, Runtime Session, Persona, unrelated extensions, or another configured MCP server. In `await-ready` mode initial plugin activation SHALL succeed only after every enabled initial generation has completed initialization, required tools-capability negotiation, complete validated discovery, and atomic initial tool-set commit, and every captured initial generation remains active after all commits. Failure, timeout, cancellation, or retirement of any enabled captured initial generation before readiness SHALL reject attempted activation with credential-safe diagnostics rather than accept a partial ready set. The rejected attempted activation SHALL exhaustively dispose its resources and withdraw every already-published tool set under ordinary Loader and Runtime Session ownership. Disabled servers SHALL neither connect nor participate in readiness, and an empty enabled set SHALL satisfy readiness without external work. Servers SHALL still commit independently; `await-ready` SHALL NOT introduce a cross-server atomic publication batch.

#### Scenario: Slow server does not delay Runtime Session activation
- **ID**: `mcp.tool.import.slow-server-does-not-delay-runtime-activation`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::activates the plugin while an MCP server is still connecting`
- **WHEN** an enabled background-mode MCP server remains in initialization after the Loader row has been validated
- **THEN** the Runtime Session becomes active with that server reported as connecting and without waiting for its external startup

#### Scenario: Ready server is not blocked by another server
- **ID**: `mcp.tool.import.ready-server-is-not-blocked-by-another-server`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::publishes each server independently while another server is still connecting`
- **WHEN** one configured server completes discovery while another configured server remains connecting
- **THEN** the ready server becomes active and publishes its complete portable tool set without waiting for the other server

#### Scenario: One server fails while another remains active
- **ID**: `mcp.tool.import.one-server-fails-while-another-remains-active`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::contains startup failure to one MCP server generation`
- **WHEN** one background-mode configured server fails during startup after another server has become active
- **THEN** only the failed server has no tools and reports failed state while the active server and Runtime Session remain usable

#### Scenario: Await-ready activation waits for every enabled server
- **ID**: `mcp.tool.import.await-ready-waits-for-all-enabled-servers`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::awaits every enabled MCP server before activating an await-ready row`
- **WHEN** one enabled server in an `await-ready` row commits its complete set while another captured initial generation remains connecting
- **THEN** the ready server publishes independently but the Loader row becomes active only after every enabled captured initial generation has committed and remains active

#### Scenario: Await-ready failure cleans the attempted activation
- **ID**: `mcp.tool.import.await-ready-failure-cleans-attempted-activation`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::rejects await-ready MCP activation and cleans successful sibling servers`
- **WHEN** one enabled `await-ready` initial generation fails after another initial generation has committed its tool set
- **THEN** initial activation rejects with a sanitized server diagnostic and exhaustive cleanup withdraws the sibling set and releases all attempted-session ownership

### Requirement: Background startup is bounded and stage-diagnosed
Each server configuration SHALL accept an optional bounded positive `startupTimeoutMs`, defaulting to 60000 milliseconds. The timeout SHALL apply in both startup modes and cover the complete initial connection sequence from transport start through MCP initialization, required tools-capability negotiation, paginated initial `tools/list`, schema validation, candidate preparation, and atomic initial commit eligibility. Timeout SHALL cancel startup and prevent late publication. Timeout or failure SHALL close the generation's owned transport and process, leave its tool set empty, and record a bounded credential-safe diagnostic that distinguishes spawn, initialization, initial discovery, atomic commit, transport closure, and cleanup stages. A background-mode timeout or failure SHALL remain server-local operational state; timeout or failure of an enabled captured initial generation in `await-ready` mode SHALL reject initial activation. Exhaustive cleanup SHALL retain ownership through all reachable cleanup attempts and report cleanup failures without representing `startupTimeoutMs` as a hard deadline for cleanup completion. The extension SHALL NOT retry automatically.

#### Scenario: Server exceeds its startup timeout
- **ID**: `mcp.tool.import.server-exceeds-startup-timeout`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::times out and disposes a server that never completes initialization`
- **WHEN** a background-mode server does not finish initialization and initial discovery within its configured startup timeout
- **THEN** the server becomes failed, its owned resources are closed, and its diagnostic identifies the timed-out startup stage without failing the Runtime Session

#### Scenario: Initial discovery fails after initialization
- **ID**: `mcp.tool.import.initial-discovery-fails-after-initialization`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::distinguishes initial discovery failure from transport startup failure`
- **WHEN** background-mode MCP initialization succeeds but the initial paginated `tools/list` request or schema validation fails
- **THEN** the server becomes failed with no published tools and a sanitized initial-discovery diagnostic distinct from spawn or initialization failure

#### Scenario: Await-ready timeout rejects after exhaustive cleanup
- **ID**: `mcp.tool.import.await-ready-timeout-rejects-after-cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::rejects timed out await-ready MCP activation and exhausts cleanup`
- **WHEN** an enabled captured initial generation exceeds its per-server startup deadline during `await-ready` activation
- **THEN** attempted activation rejects after cancelling startup, preventing late publication, and exhausting all reachable cleanup without treating the startup deadline as a cleanup-completion bound
