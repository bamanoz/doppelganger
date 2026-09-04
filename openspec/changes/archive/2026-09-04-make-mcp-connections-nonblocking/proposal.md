## Why

MCP server startup currently blocks the owning Loader Fiber and therefore the entire Runtime Session, so a slow user-configured command such as `npx` can delay or time out an otherwise healthy coding-agent session. MCP is an optional portable extension dependency and should connect independently while the runtime, Persona, memory, and already-available tools remain usable.

## What Changes

- Activate the host-neutral MCP Loader plugin immediately after publishing its service and lifecycle ownership, then connect every enabled MCP server asynchronously in the background.
- Track each configured server independently through `connecting`, `active`, `failed`, and `disposed` states; one slow or failed server no longer blocks or invalidates unrelated servers or the Runtime Session.
- Publish each server's imported tool set atomically only after initialization, complete `tools/list` discovery, and schema validation succeed; existing Runtime Host catalog-change projection remains the only host-facing mechanism.
- Remove a server's imported tools when its transport becomes unavailable, while retaining the last committed tool set after a non-fatal list refresh failure.
- Make valid configuration reloads replace affected server generations without waiting for external connection success, with stale-generation protection and exhaustive cancellation/disposal of background startup work.
- Add a bounded per-server startup timeout with stage-specific, credential-safe diagnostics for spawn, initialization, initial discovery, transport closure, and cleanup failures.
- Preserve operator ownership of `command`, arguments, endpoint, package manager, and version. Doppelganger does not install MCP servers, rewrite commands, select versions, retry automatically, or add host-specific UI.
- **BREAKING**: a valid MCP configuration whose external server cannot connect no longer rejects Runtime Session activation or rolls back the Loader generation; the server instead becomes operationally `failed` with no published tools.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-tool-import`: Change MCP activation, failure containment, reload, timeout, diagnostics, and disposal requirements from blocking all-server preparation to independent background server connections.

## Impact

- Affected implementation: `packages/extension-mcp/src/config.ts`, `client.ts`, `runtime.ts`, `plugin.ts`, service snapshots, and MCP package tests/fixtures.
- Affected integration: Composition Runtime activation evidence and Runtime Host/OMP dynamic-catalog integration tests; production host adapters continue consuming only ordinary portable tool catalog changes.
- Affected documentation: `docs/features/mcp-tool-import.md`, composition activation wording, configuration examples, verification guidance, and project status where applicable.
- No new dependency on OMP or any native host API; no Runtime Host protocol or UI-status contract is added.
- No automatic installation, package-version pinning, fallback command, reconnection policy, MCP prompts/resources/sampling/elicitation, or host-native MCP configuration import is introduced.
