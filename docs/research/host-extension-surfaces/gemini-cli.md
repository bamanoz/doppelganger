# Gemini CLI host extension surface

## Snapshot

| Field | Value |
|---|---|
| Repository | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| Exact commit | `55b495d6db1794bf5b7f37a9bc03ebcab5103673` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

This is static source research against the pinned checkout. Observed behavior is separated from adapter recommendations below.

## Native extension model

Gemini CLI has a CLI-facing extension manager and a core extension loader. Installed extensions are discovered as directories under the user extension storage directory, built from their manifests, and then started when active. The CLI exposes `extensions` commands for install, uninstall, list, update, enable, disable, link, validate, configure, and related management. An extension can contribute MCP servers, context files, hooks, policy rules/checkers, themes, skills, commands, and tool exclusions. Hook definitions are conventionally loaded from `hooks/hooks.json`; extension settings are hydrated into hook and manifest values.

Activation is not a generic plugin RPC. It is host orchestration around filesystem manifests, subprocess/remote MCP configuration, and Gemini-specific registries. The extension manager checks administrator source restrictions, user enablement, and trust before features become active.

## Context and memory files

An extension's declared context file names are resolved relative to its extension directory and rejected if they escape that directory. Active extension paths are converted to absolute paths, deduplicated case-insensitively, and sorted. `MemoryContextManager.refresh()` discovers global, extension, project, and user-project memory concurrently, reads the files, categorizes/concatenates them, and emits a memory-change event. Project memory is only discovered for a trusted folder; extension memory is associated with active extensions. MCP server instructions are appended to project memory during categorization, so a server's instructions can change the model context after MCP discovery or reload.

This is a memory-file/context-string model, not a portable context graph: ordering, boundary markers, path identity, and `GEMINI.md` naming are host semantics.

## Tools and MCP

MCP is a first-class extension contribution. `McpClientManager.startExtension()` registers each extension server, connects/discovers its tools, and schedules a context refresh; `stopExtension()` removes associated configurations, disconnects clients, and refreshes context. Configured servers are skipped in untrusted folders, while admin allowlists/blocklists and user session/file enablement can independently prevent discovery. The manager also supports whole-manager restart, per-server restart, application-exit stop, discovery state, diagnostics, and retrieval of server instructions.

When a discovered MCP tool executes, the tool-hook wrapper can expose non-sensitive server context (server/tool name, command/args/cwd, URL, or TCP details) to hooks. It fires `BeforeTool` before execution and `AfterTool` after execution. A before hook can stop the agent, block execution, or modify parameters (with the invocation rebuilt and validated); an after hook can stop/block the result, add `<hook_context>`, or request a tail tool call. This couples the native hook payload to Gemini tool invocation and MCP details; a bridge should project only declarative tool identity and sanitized request/result data.

MCP config merging is security-oriented: scalar properties from the override win, `includeTools` allowlists intersect, `excludeTools` blocklists union, and environment objects merge. A user config overrides an extension config when the same server name is encountered. A changed client configuration is hot-reloaded by disconnecting the old client before discovery of the new one.

## Approval and consent

Extension installation/update consent is rendered as user-facing text. It identifies MCP servers as local or remote, displays their command/URL, identifies context-file injection and excluded core tools, warns that hooks can automatically execute commands, and lists skills and their source directories. Consent is requested when there is no prior config or when the rendered consent changes; refusal throws. This is an extension-install consent flow, not a general per-tool policy RPC.

Tool approval is governed by Gemini CLI's approval modes (`default`, `auto_edit`, and `plan`; YOLO is command-line-only) and by hook decisions/policy. Hook outputs can express `ask`, `block`, `deny`, `approve`, or `allow`, but the host interprets them through fixed event-specific result handling. A portable adapter should expose an awaited, one-shot approval callback rather than leak terminal prompts or config files.

## Hook lifecycle and fixed merge rules

Hook event names are a closed enum: `BeforeTool`, `AfterTool`, `BeforeAgent`, `Notification`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`, `BeforeModel`, `AfterModel`, and `BeforeToolSelection`. Hook configs are either command hooks or runtime hooks, with optional matcher, timeout, source, and sequential behavior. Inputs have a fixed envelope including `session_id`, `transcript_path`, `cwd`, event name, and timestamp; outputs have fixed optional control/result fields.

The registry initializes by retaining runtime entries and processing configured hooks, filters enabled entries by event, and orders them by source priority. Sequential execution awaits each hook and applies a successful hook output to the next hook's input; parallel execution uses `Promise.all`. Aggregation is event-specific: `BeforeModel` and `AfterModel` use later-field-replacement (including shallow hook-specific replacement); `AfterAgent` and `SessionStart` use OR-style decisions with concatenated messages/reasons/system messages; `BeforeToolSelection` unions function names, sorts them deterministically, and chooses `NONE` over `ANY` over `AUTO`; other events use simple merge. Thus hook composition is deterministic but not an extensible merge protocol.

The model pipeline invokes before-model, before-tool-selection, and after-model hooks around generation. Before-model hooks may block, stop, synthesize a response, or modify model/config/contents. After-model hooks may stop/block or replace a response. These are useful host interception points, but their schemas and error handling are Gemini-specific.

## Lifecycle, scope, state, and reload

`ExtensionLoader.start()` starts all active extensions once. With extension reloading enabled, dynamic load/unload and restart are supported after startup. Starting an extension activates MCP, refreshes tools where needed, registers policy rules/checkers, and batches memory/system-instruction/hook/agent/skill refreshes after all concurrent starts/stops complete. Stopping reverses MCP and policy registration and performs the same coordinated refresh. `SimpleExtensionLoader` explicitly supports dynamic additions and removals.

Extension enablement is persisted by scope (user or workspace; session can be handled without persistence), while system/system-default scopes are rejected by the manager operation. Extension settings use user and workspace scopes. Non-sensitive values are stored in scoped `.env` files; sensitive values use the OS keychain. Workspace settings override user settings, and workspace settings are read only when the workspace is trusted. Settings are injected as environment variables into resolved extension configuration and hooks.

The canonical settings schema marks MCP servers and extensions as restart-required, exposes `hooksConfig.enabled`, `hooksConfig.disabled`, hook notifications, `extensionReloading`, extension enablement, and experimental `agentSessionSubagentEnabled`. The subagent toggle routes local/remote subagent invocations through session wrappers instead of legacy executors. The agent registry reload clears/reloads definitions, reports new/updated/deleted agents and local/remote counts, and emits an agents-refreshed event. Agent-session stream wrappers preserve event history, replay, subscription, and reattachment semantics.

## Trust and source gates

Extension source restrictions include administrator `allowedExtensions` regex matching against install metadata, and an option to block Git/GitHub-release extension sources. MCP servers are independently subject to admin allowlists/blocklists, user enablement, and trusted-folder checks. Project memory, project agents, and project hooks are also trust-sensitive. Project-hook initialization checks a per-project trusted-hook store and warns about new hooks before recording them as trusted; the warning explicitly states that the hooks will execute. This is a host-specific trust-folder and filesystem policy, not a portable sandbox contract.

## AgentProtocol and subagents

`AgentProtocol.send()` returns the affected `streamId`; when a new stream is created, it must be returned before `agent_start`. Events carry an event id, stream id, timestamp, and optional `threadId` for subagent threads. Tool updates and responses carry `requestId`; elicitation requests/responses correlate through request IDs. `AgentSession.sendStream()` sends, captures the returned stream ID, and streams only that activity; the wrapper can replay or reattach by event ID or stream ID and ends on the matching `agent_end`.

The legacy session starts a new stream before scheduling the run loop, deliberately deferring `agent_start` to a macrotask so callers can attach without racing startup. `AgentTool` resolves a named registry definition, maps the generic prompt to the agent schema, and dispatches to browser, local, remote, local-session, or remote-session invocation classes. `agentSessionSubagentEnabled` is the host toggle selecting the session-based classes for local and remote agents.

## Doppelganger adapter fit

**Recommendation (host-owned bridge):** keep Gemini discovery, consent, settings, filesystem context, trust, and MCP process/client management on the host side. Build a bridge around normalized hook lifecycle events, declarative MCP/tool catalogs, approval callbacks, memory refresh notifications, and AgentProtocol stream events. Map a Doppelganger actor/session to host `sessionId` plus `streamId`; map nested agent execution to optional `threadId`; map an awaited action/tool request to `requestId`; and map host hook decisions to a narrow allow/ask/block result.

The portable layer should not expose Gemini config paths, `.env`/keychain storage, raw command lines, trust files, terminal UI, or `GEMINI.md` path traversal. It may receive sanitized context snapshots and declarative tool metadata supplied by the bridge. No Doppelganger support is implemented in this checkout; this section is an integration recommendation only.

## Compatibility gaps

- Hook event names, envelopes, timeouts, matchers, and event-specific aggregation are fixed and Gemini-specific; there is no arbitrary bidirectional hook RPC.
- Consent is install/update text plus a callback, while tool approval and project-hook trust use separate host flows; there is no single portable policy engine.
- MCP context refresh mutates model instructions and tool registries asynchronously, so a bridge needs explicit refresh/version boundaries.
- Context is assembled from host filesystem memory files with trust and boundary-marker rules, not from portable context objects.
- Extension settings combine scoped `.env` files, keychain secrets, and environment substitution; portable plugins must not depend on these storage details.
- Agent/session behavior differs between legacy and session-based local/remote invocation and is controlled by an experimental toggle; a bridge must normalize stream lifecycle and subagent identity.
- Reload is host-coordinated and batches memory, tools, hooks, agents, skills, policy, and system instructions; a portable lifecycle cannot assume an atomic extension reload.
- Source allowlists, Git blocking, trusted folders, and trusted-hook records have no portable equivalent and must remain host policy.

## Source evidence

| Claim | Path | Symbol | Lines |
|---|---|---|---|
| CLI exposes extension management subcommands | `packages/cli/src/commands/extensions.tsx` | `extensionsCommand` | `21-42` |
| CLI exposes hook management command | `packages/cli/src/commands/hooks.tsx` | `hooksCommand` | `11-27` |
| Extension discovery scans user extension directories and starts active extensions | `packages/cli/src/config/extension-manager.ts` | `loadExtensions` | `608-670` |
| Extension manifests are source-gated and settings are hydrated | `packages/cli/src/config/extension-manager.ts` | `_buildExtension` | `708-787` |
| Extension context files are confined to extension directory | `packages/cli/src/config/extension-manager.ts` | `_buildExtension` | `862-875` |
| Extension hooks load from `hooks/hooks.json` | `packages/cli/src/config/extension-manager.ts` | `loadExtensionHooks` | `1054-1102` |
| Hook loading is controlled by the hooks enabled setting | `packages/cli/src/config/extension-manager.ts` | `_buildExtension` | `885-891` |
| Extension enable/disable persists scoped state and can stop extension | `packages/cli/src/config/extension-manager.ts` | `disableExtension` | `1173-1202` |
| Extension lifecycle starts MCP, policy, and coordinated refresh | `packages/core/src/utils/extensionLoader.ts` | `startExtension`, `maybeRefreshMemories` | `64-132` |
| Dynamic load/unload/restart are supported by loader | `packages/core/src/utils/extensionLoader.ts` | `restartExtension`, `SimpleExtensionLoader` | `241-292` |
| Hook event enum and fixed input/output types | `packages/core/src/hooks/types.ts` | `HookEventName`, `HookType`, `HookInput`, `HookOutput` | `43-155` |
| Hook registry processes config and orders enabled hooks | `packages/core/src/hooks/hookRegistry.ts` | `registerHook`, `initialize`, `getHooksForEvent` | `45-93` |
| Sequential hooks feed successful output into next input | `packages/core/src/hooks/hookRunner.ts` | `executeHooksSequential` | `139-162` |
| Event-specific hook output merge rules | `packages/core/src/hooks/hookAggregator.ts` | `mergeOutputs` | `81-110` |
| OR decision aggregation concatenates messages and context | `packages/core/src/hooks/hookAggregator.ts` | `mergeWithOrDecision` | `113-216` |
| Before-tool-selection merge uses restrictive mode and sorted union | `packages/core/src/hooks/hookAggregator.ts` | `mergeToolSelectionOutputs` | `239-312` |
| MCP tool wrapper extracts sanitized MCP context and fires before/after hooks | `packages/core/src/core/coreToolHookTriggers.ts` | `extractMcpContext`, `executeToolWithHooks` | `27-95,155-246` |
| Model pipeline invokes before-model/tool-selection/after-model hooks | `packages/core/src/core/geminiChat.ts` | generation hook call sites | `991-1059,1465-1469` |
| Extension consent identifies MCP, context, excluded tools, hooks, and skills | `packages/cli/src/config/extensions/consent.ts` | `extensionConsentString` | `151-216` |
| Consent is requested when installation state differs | `packages/cli/src/config/extensions/consent.ts` | `maybeRequestConsentOrFail` | `241-275` |
| Settings scopes and keychain/.env paths are distinct | `packages/cli/src/config/extensions/extensionSettings.ts` | `ExtensionSettingScope`, `getEnvFilePath` | `19-60` |
| Sensitive settings use keychain and non-sensitive settings use env files | `packages/cli/src/config/extensions/extensionSettings.ts` | `maybePromptForSettings` | `62-139` |
| Workspace values override user values | `packages/cli/src/config/extensions/extensionSettings.ts` | `getEnvContents` | `206-227` |
| MCP extension start/stop and context refresh | `packages/core/src/tools/mcp-client-manager.ts` | `startExtension`, `stopExtension` | `205-254` |
| MCP servers are gated by admin, user, trust, and active-extension checks | `packages/core/src/tools/mcp-client-manager.ts` | `maybeDiscoverMcpServer` | `375-466` |
| MCP configs intersect allowlists and union blocklists | `packages/core/src/tools/mcp-client-manager.ts` | `mergeMcpConfigs` | `328-372` |
| MCP restart and application-exit cleanup | `packages/core/src/tools/mcp-client-manager.ts` | `restart`, `restartServer`, `stop` | `619-679` |
| MCP instructions are collected for context injection | `packages/core/src/tools/mcp-client-manager.ts` | `getMcpInstructions` | `696-708` |
| Memory refresh merges global/extension/project/user-project memory and MCP instructions | `packages/core/src/context/memoryContextManager.ts` | `refresh`, `discoverMemoryPaths`, `categorizeMemoryContents` | `38-64,108-130` |
| Active extension context paths are deduplicated and sorted | `packages/core/src/utils/memoryDiscovery.ts` | `getExtensionMemoryPaths` | `383-403` |
| Project memory traverses only trusted roots to boundary | `packages/core/src/utils/memoryDiscovery.ts` | `getEnvironmentMemoryPaths` | `405-431` |
| AgentProtocol returns stream ID before agent start and correlates events | `packages/core/src/agent/types.ts` | `AgentProtocol`, `AgentEventCommon` | `14-44,67-80` |
| Agent sessions stream and reattach by stream/event ID | `packages/core/src/agent/agent-session.ts` | `sendStream`, `stream` | `47-69,105-188` |
| Legacy session creates stream before deferred agent start | `packages/core/src/agent/legacy-agent-session.ts` | `send`, `_scheduleRunLoop`, `_beginNewStream` | `108-153,369-375` |
| Agent tool dispatches browser/local/remote/session invocation paths | `packages/core/src/agents/agent-tool.ts` | `AgentTool`, `buildChildInvocation` | `43-124,156-205` |
| Subagent session toggle is experimental and restart-required | `packages/cli/src/config/settingsSchema.ts` | `agentSessionSubagentEnabled` | `2213-2222` |
| Extension reload setting and enablement settings are explicit | `packages/cli/src/config/settingsSchema.ts` | `extensionReloading`, `extensions` | `2281-2289,2481-2513` |
| Hooks have enable/disable and notification settings | `packages/cli/src/config/settingsSchema.ts` | `hooksConfig` | `2548-2593` |
| Agent registry reload reports changes and emits refresh | `packages/core/src/agents/registry.ts` | `reload` | `87-134` |
| Project hooks warn and persist trust decisions | `packages/core/src/hooks/hookRegistry.ts` | `checkProjectHooksTrust` | `137-166` |
