# MCP tool import

## Boundary

`@doppelganger/doppelganger-extension-mcp` is an optional Runtime Preset Loader plugin that connects to external Model Context Protocol servers and imports their tools into the ordinary portable `doppelgangerTools` registry. It is not a Runtime Host adapter, native-host MCP configuration bridge, actor provider, kernel service, or implicit Runtime Preset requirement. The shipped `standard` preset omits it.

The first version is tools-only. It does not project MCP prompts, resources, subscriptions, sampling, elicitation, roots, tasks, logging, native host configuration, or arbitrary server metadata. Host adapters observe only normal revisioned portable tool descriptors and invocations.

## Composition and configuration

A Runtime Preset composes the Loader row explicitly and shares the session-isolated tool registry:

```yaml
- id: doppelganger-tools
  name: "@doppelganger/doppelganger-protocols/tools"
  isolate: { doppelgangerTools: session }

- id: doppelganger-mcp
  name: "@doppelganger/doppelganger-extension-mcp/loader"
  inject: [doppelgangerTools]
  isolate: { doppelgangerTools: session, doppelgangerMcp: session }
  config:
    servers:
      filesystem:
        startupTimeoutMs: 60000
        transport:
          type: stdio
          command: filesystem-mcp
          args: ["/absolute/workspace"]
          cwd: /absolute/workspace
          environment:
            MCP_TOKEN: { env: FILESYSTEM_MCP_TOKEN }
        tools:
          read_file:
            alias: read-file
            approval:
              policy: required
              reason: Reads files through the configured MCP server
          delete_file:
            enabled: false
      remote:
        transport:
          type: streamable-http
          url: https://mcp.example.test/api
          headers:
            Authorization: { env: REMOTE_MCP_AUTHORIZATION }
```

`servers` is required. Server IDs and configured aliases are lowercase kebab-case. Servers and tools default to enabled; `enabled: false` prevents a server connection or omits the exact configured MCP tool. Tool-policy keys are exact case-sensitive names reported by that server. `startupTimeoutMs` is optional per server, defaults to 60000, and accepts safe integers from 1 through 600000 milliseconds. Unknown fields, relative `cwd` values, non-HTTP endpoints, URL credentials or fragments, malformed environment references, unsupported approval policies, blank or oversized supplied approval reasons, and out-of-range values fail synchronously before any external connection. `approval: { policy: required }` is sufficient; an optional non-empty `reason` is preserved only as a bounded host-presentation hint.

Stdio configuration supplies the exact executable command, bounded argument list, optional absolute working directory, and an allowlist of environment targets whose values are read from named process environment variables. Streamable HTTP configuration supplies the exact absolute HTTP or HTTPS URL plus headers resolved from named environment variables. Doppelganger does not install, download, upgrade, pin, rewrite, substitute, retry, or select a fallback command, package, endpoint, or version. A package manager such as `npx` is an ordinary operator-authored executable. Auth material is never authored inline by this schema, copied into descriptors, or returned by diagnostics.

The owning boundary permits at most 128 servers, 256 stdio arguments, 256 environment or header references per map, and 2,048 exact tool policies per server. General configuration strings are bounded to 4,096 characters; aliases to 128 characters and approval reasons to 1,024 characters.

## Discovery, activation, and naming

After complete synchronous configuration validation, the Loader plugin publishes `doppelgangerMcp`, installs one stable empty registry owner per enabled server, and returns without awaiting external work. Every server receives an independent Runtime Session-owned generation in `connecting` state and starts concurrently. One slow, missing, or invalid external server neither blocks another server nor invalidates the Loader Fiber or Runtime Session.

One generation-owned startup deadline spans transport start, MCP initialization, required tools-capability negotiation, paginated initial `tools/list`, schema validation, candidate construction, and atomic initial commit. Schema compilation follows the MCP SDK's draft-07-compatible AJV validator, including an explicit `http://json-schema.org/draft-07/schema#` declaration used by official reference servers. Pagination is bounded to 1,000 pages and repeated cursors fail discovery. A successful generation atomically replaces only its empty owner set and becomes `active`; a failure becomes terminal `failed`, leaves that set empty, closes reachable transport/process resources, records a stage-specific credential-safe diagnostic, and is not retried automatically.

Imported names are deterministic:

```text
mcp-<server-id>.<local-id>
```

For a default mapping, the exact MCP name must be bounded printable ASCII. It is lowercased, `_` and `.` become `-`, and repeated hyphens collapse. The result must satisfy lowercase kebab-case and the complete portable name must not exceed 128 characters. For example, server `filesystem` tool `read_file` becomes `mcp-filesystem.read-file`, while invocation still sends exact original name `read_file`.

Case and separator normalization can collide. If `Read_File` and `read-file` map to the same local ID, neither ambiguous default is registered; distinct exact-name aliases can enable either or both. Invalid, unrepresentable, overlong, and colliding names are omitted with diagnostics without suppressing unrelated valid tools. A collision with another portable registry owner rejects the candidate commit.

## Invocation, results, and approval

Every descriptor captures its exact server generation, original case-sensitive MCP name, input schema, and current portable tool revision. Invocation validates the portable input against the discovered MCP schema, clones JSON-compatible arguments, and issues `tools/call` only to that captured generation. A replaced or disposed generation fails closed rather than rerouting the call to a new process or endpoint.

The portable invocation `AbortSignal` is forwarded to the MCP SDK request. Host cancellation, Runtime Session disposal, or server-generation replacement aborts active requests. Concurrent calls remain independent.

A complete MCP result preserves supported `content` blocks and optional `structuredContent` as bounded JSON-compatible data. When the tool declares an output schema, returned structured content must satisfy it. Older compatible results without `resultType` are treated as complete. Current `input_required` results fail with `MCP_INPUT_REQUIRED`; this version neither advertises elicitation nor enters an unowned multi-round exchange. Tool-originated `isError`, argument, protocol, transport, schema, unavailable-server, stale-generation, and cancellation failures remain distinct structured outcomes. Results are limited to 1 MiB and retained error data to 64 KiB.

MCP annotations are untrusted hints. They do not establish actor identity, availability, read-only safety, approval, or permission to bypass host policy. Only the Runtime Preset's exact tool policy can add portable `approval.policy: required`, optionally with an advisory reason. The shared Runtime Host bridge then requires its normal protected one-shot grant before any MCP request is sent; a host may impose stricter native policy.

## Refresh, reload, failure, and disposal

A server that advertises tool-list changes may emit `notifications/tools/list_changed`. Refresh is serialized per generation, performs complete discovery and validation, and atomically replaces that server's owner-scoped tool set. A failed refresh records a diagnostic while retaining the prior active transport and committed callable set.

Unexpected active transport closure is different: the generation becomes terminal `failed` and atomically replaces its complete owner set with empty definitions. Dynamic-capable hosts receive the ordinary portable catalog mutation, and retained descriptor closures fail unavailable or stale rather than invoking a dead transport.

A valid Loader update retains byte-equivalent normalized server configurations. Changed and removed generations become stale and withdraw their tools before cleanup; removed slots disappear, while changed and added slots immediately install new `connecting` generations and start one tracked background operation each. Update returns after this local cutover without awaiting external connection success. An unavailable command, endpoint, credential value, or protocol after valid normalization is committed operational `failed` state and does not restore the retired configuration. Structurally invalid authored configuration still rejects synchronously and preserves the prior Loader generation through Composition Runtime rollback.

Every generation moves monotonically through `connecting`, `active`, `failed`, and `disposed`; disposal is idempotent from every state. The Loader Fiber and runtime track startup, retirement cleanup, notification refreshes, active calls, registrations, clients, transports, and child processes. Retirement removes current-generation identity before cancellation, so stale startup, refresh, close, or invocation continuations cannot mutate a replacement. Row or Runtime Session disposal withdraws complete tool sets, aborts startup and active requests, closes every reachable transport/process, observes background settlements, and reports aggregate cleanup failure only after exhaustive attempts.

`ctx.doppelgangerMcp.snapshot()` exposes immutable deterministic server state and a bounded chronological diagnostic list for operators. Snapshots include every current server ID, transport, state, negotiated protocol/server metadata when available, tool count, and sanitized warning or error records. They contain no credential values and are not projected as a host-specific UI or Runtime Host status protocol.

## Trust and disclosure

MCP servers and stdio executables are trusted external dependencies, not sandboxes. A stdio server runs with the Runtime Session process user's operating-system authority and receives the default safe MCP subprocess environment plus only configured referenced additions. An HTTP server receives configured referenced headers. Either server may process tool arguments and return content that enters the model through the normal host tool-result path.

Operators must trust each executable or endpoint, constrain its own filesystem/network authority, select credentials narrowly, review imported schemas and approval policy, and account for data disclosure. Stable server IDs are configuration identities; server-reported names and annotations do not grant authority.

Component lifecycle, server startup/refresh/failure, configuration replacement, sanitized diagnostic codes, and cleanup emit ordinary Cordis events under `doppelganger-mcp`; credentials, endpoints, commands, arguments, schemas, and tool results are excluded. The shared event vocabulary and destination behavior are owned by [Runtime logging](runtime-logging.md).

## Primary implementation

- `packages/extension-mcp/src/config.ts` — strict Loader configuration, startup timeout, and credential references.
- `packages/extension-mcp/src/client.ts` — MCP transport, bounded background startup, diagnostics, discovery, naming, invocation, refresh, cancellation, and generation disposal.
- `packages/extension-mcp/src/runtime.ts` — independent server slots, empty owner registrations, atomic commits/withdrawal, asynchronous reload cutover, diagnostics, settlement tracking, and aggregate disposal.
- `packages/extension-mcp/src/plugin.ts` — Cordis service publication before non-blocking runtime startup and update/disposal ownership.
- `packages/extension-mcp/tests/config.spec.ts` — configuration-boundary evidence.
- `packages/extension-mcp/tests/integration.spec.ts` — stdio and Streamable HTTP background activation, timeout, failure containment, refresh, reload, cancellation, and cleanup evidence.
