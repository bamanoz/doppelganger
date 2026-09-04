# MCP Tool Import Specification

## Purpose

Defines Runtime Preset-owned MCP server configuration and lifecycle, deterministic import of external MCP tools into the portable tool registry, dynamic replacement, invocation, failure containment, and exhaustive cleanup.

## Requirements

### Requirement: Runtime Preset-owned MCP server configuration
The MCP extension SHALL be an ordinary Loader plugin configured inside a Runtime Preset. Each server entry SHALL use a stable lowercase-kebab server ID and validated transport configuration. Server configuration, enablement, aliases, approval policy, and credentials references SHALL belong to the Runtime Preset plugin row or plugin-owned assets rather than native host MCP configuration.

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

### Requirement: Stdio and stateless HTTP transports
The first MCP extension version SHALL support current MCP stdio and stateless Streamable HTTP client transports. Transport objects, subprocess handles, HTTP clients, authentication material, and protocol session state SHALL remain private to the owning Runtime Session plugin scope.

#### Scenario: Stdio server activates
- **ID**: `mcp.tool.import.stdio-server-activates`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** a configured stdio server starts and completes MCP initialization
- **THEN** the extension owns its process, client, streams, negotiated capabilities, active requests, and exhaustive disposal

#### Scenario: Stateless HTTP server activates
- **ID**: `mcp.tool.import.stateless-http-server-activates`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::uses stateless Streamable HTTP with credential references and untrusted annotations`
- **WHEN** a configured stateless HTTP endpoint completes MCP initialization and tool discovery
- **THEN** each request uses the current protocol transport contract without requiring native host MCP support or leaking the HTTP client into portable tool definitions

### Requirement: Exact per-server tool discovery
For every active server generation, the extension SHALL call MCP `tools/list`, follow supported pagination to completion, validate every returned tool, and retain the exact case-sensitive original MCP tool name for invocation. MCP server-reported names SHALL be unique only within that configured server ID.

#### Scenario: Server exposes multiple pages
- **ID**: `mcp.tool.import.server-exposes-multiple-pages`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** `tools/list` returns a continuation cursor
- **THEN** the extension follows cursors until it has one complete candidate set before changing the portable registry

#### Scenario: Server repeats a name
- **ID**: `mcp.tool.import.server-repeats-a-name`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** one discovery generation returns the same exact MCP tool name more than once
- **THEN** that candidate generation is invalid and the previously committed healthy generation remains active

### Requirement: Deterministic portable tool naming and aliases
Each imported tool SHALL have a deterministic canonical portable name under `mcp-<server-id>.<local-id>`. By default, the local ID SHALL lowercase ASCII MCP names, map underscores and dots to hyphens, collapse repeated separators, and satisfy the portable lowercase dot-segment grammar. Configuration MAY map an exact original MCP name to an explicit lowercase-kebab local alias. Invalid, unrepresentable, overlong, or colliding names without unique aliases SHALL be omitted with diagnostics and SHALL NOT replace unrelated valid tools.

#### Scenario: Common MCP name is imported
- **ID**: `mcp.tool.import.common-mcp-name-is-imported`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** server `filesystem` exposes exact MCP name `read_file`
- **THEN** the default portable name is `mcp-filesystem.read-file` and invocation still sends exact name `read_file` to that server generation

#### Scenario: Case or separator normalization collides
- **ID**: `mcp.tool.import.case-or-separator-normalization-collides`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** one server exposes `Read_File` and `read-file`
- **THEN** neither ambiguous default mapping is silently chosen; explicit distinct aliases can enable one or both

#### Scenario: Different servers expose the same local name
- **ID**: `mcp.tool.import.different-servers-expose-the-same-local-name`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** servers `filesystem` and `workspace` both expose `read_file`
- **THEN** they register as distinct portable names under their configured server IDs

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

### Requirement: Imported descriptors preserve supported MCP schema
The extension SHALL project each valid MCP tool's description and input schema into a portable `ToolDefinition`. When present and supported, output schema and structured-result metadata SHALL be preserved in the extension's invocation mapping without widening the portable definition with MCP client objects. Unsupported annotations, icons, metadata, or content kinds SHALL be omitted or diagnosed explicitly rather than misrepresented.

#### Scenario: Tool has input and output schemas
- **ID**: `mcp.tool.import.tool-has-input-and-output-schemas`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** an MCP tool declares valid `inputSchema` and `outputSchema`
- **THEN** its portable definition exposes validated input constraints and its invocation result preserves conforming structured content

#### Scenario: Official server declares draft-07 schema
- **ID**: `mcp.tool.import.official-server-declares-draft-seven-schema`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** an MCP tool schema explicitly declares `http://json-schema.org/draft-07/schema#`
- **THEN** discovery and invocation validate it with the same draft-07-compatible semantics instead of rejecting the official dialect as unknown

#### Scenario: Tool metadata is not portable
- **ID**: `mcp.tool.import.tool-metadata-is-not-portable`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** an MCP descriptor contains metadata with no defined portable equivalent
- **THEN** the extension omits that metadata and does not reinterpret it as approval, availability, or host authority

### Requirement: Exact MCP invocation with cancellation
Invoking an imported portable tool SHALL call MCP `tools/call` on the exact server generation and exact original case-sensitive MCP name captured by the current descriptor revision. The portable invocation input SHALL become MCP arguments, and the portable `AbortSignal` SHALL cancel the underlying client request when the transport supports cancellation.

#### Scenario: Imported tool is called
- **ID**: `mcp.tool.import.imported-tool-is-called`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** the host invokes current descriptor `mcp-filesystem.read-file`
- **THEN** the extension calls exact MCP method `tools/call` with original name `read_file`, cloned arguments, and the same correlated cancellation signal

#### Scenario: Server generation was replaced
- **ID**: `mcp.tool.import.server-generation-was-replaced`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::replaces a valid server generation with aliases and disablement`
- **WHEN** a retained descriptor targets a disposed or replaced MCP server generation
- **THEN** descriptor revision or generation validation fails closed and the call is not rerouted to a different server process or endpoint

### Requirement: MCP result and failure mapping
The extension SHALL parse the negotiated MCP result union. It SHALL map `complete` tool results to JSON-compatible portable values while preserving supported content blocks, `structuredContent`, and tool-originated `isError` meaning. For an older negotiated protocol whose result omits `resultType`, it SHALL apply the protocol's backward-compatible `complete` interpretation. Because the first version does not advertise elicitation or implement multi-round input, a current `input_required` result SHALL become a bounded structured `MCP_INPUT_REQUIRED` failure preserving safe request context. Invalid arguments, unknown tool, unsupported method or result variant, transport failure, protocol failure, output-schema failure, stale generation, cancellation, and tool-originated error SHALL remain distinguishable. No failure SHALL silently become an empty successful result.

#### Scenario: MCP tool returns a domain error
- **ID**: `mcp.tool.import.mcp-tool-returns-a-domain-error`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** `tools/call` returns a valid result with `isError: true`
- **THEN** the portable invocation returns a structured tool-domain failure whose bounded data remains visible to the model and adapter

#### Scenario: MCP transport fails
- **ID**: `mcp.tool.import.mcp-transport-fails`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** the process exits or HTTP request fails before a valid MCP result
- **THEN** the portable invocation reports a transport or availability failure distinct from a tool-domain error

#### Scenario: Current tool requests additional input
- **ID**: `mcp.tool.import.current-tool-requests-additional-input`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** `tools/call` returns `resultType: "input_required"`
- **THEN** the extension returns bounded `MCP_INPUT_REQUIRED` data and does not fabricate a complete result, advertise elicitation support, or enter an unowned multi-round exchange

#### Scenario: Older negotiated server omits result type
- **ID**: `mcp.tool.import.older-negotiated-server-omits-result-type`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** a valid result from an older negotiated protocol version omits `resultType`
- **THEN** the extension treats it as `complete` according to the MCP backward-compatibility rule

### Requirement: MCP annotations do not grant authority
MCP tool annotations SHALL be treated only as untrusted behavioral hints. They SHALL NOT create an approval grant, actor binding, availability decision, or permission to bypass host policy. Runtime Preset configuration MAY explicitly disable an imported tool or add portable required approval with an optional advisory reason.

#### Scenario: Server marks a tool read-only
- **ID**: `mcp.tool.import.server-marks-a-tool-read-only`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** an MCP server supplies `readOnlyHint: true`
- **THEN** the extension may preserve the hint diagnostically but does not treat it as proof that approval is unnecessary

#### Scenario: Preset requires approval for imported tool
- **ID**: `mcp.tool.import.preset-requires-approval-for-imported-tool`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** configuration adds a required-approval policy to one exact imported tool or alias
- **THEN** the shared Runtime Host bridge requires a matching one-shot host grant before the MCP request is issued

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

### Requirement: MCP scope is tools-only
The first MCP extension version SHALL import only MCP tools. It SHALL NOT expose MCP prompts, resources, resource subscriptions, sampling, elicitation, roots, tasks, logging, or native host MCP configuration through the Runtime Host API.

#### Scenario: Server advertises non-tool capabilities
- **ID**: `mcp.tool.import.server-advertises-non-tool-capabilities`
- **EVIDENCE**: `packages/extension-mcp/tests/integration.spec.ts::imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes`
- **WHEN** an MCP server advertises prompts, resources, sampling, elicitation, roots, or tasks
- **THEN** the extension leaves those capabilities unprojected and continues tool import only when the server's tool capability is valid

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
