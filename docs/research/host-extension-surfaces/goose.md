# Goose host extension surface

## Snapshot

| Field | Value |
|---|---|
| Repository | [block/goose](https://github.com/block/goose) |
| Exact commit | `0f7d763b3f5ee6d2f12c7f997b5bed9f5aa7f205` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

This is a static source review of the checked-out revision above, not evidence of a live integration. Observations describe Goose; recommendations describe a possible adapter and do not claim that Goose supports Doppelganger.

## Native extension model

Goose has three distinct extension surfaces. Its common `McpClientTrait` abstracts tools and, where implemented, resources, prompts, notifications, per-session MOIM content, and working-directory changes. `ExtensionConfig` instantiates stdio, streamable-HTTP, built-in MCP, or platform extensions through the same manager.

Platform extensions are compiled into Goose. A static `PLATFORM_EXTENSIONS` registry assigns each a name, visibility, default-enabled setting, whether its tools remain unprefixed, and an in-process client factory. When enabled, the manager gives that factory a `PlatformExtensionContext` containing host-managed session and related services. This is materially different from a remote MCP server: platform code can use host session state directly.

Plugins are a separate disk-discovered layer. Goose searches project and user plugin roots, selects enabled plugins, imports their skill directories, and loads command hooks from each plugin's `hooks/hooks.json`. Recipes are configuration adapters over the same extension configuration variants, rather than a general dynamic native-code extension mechanism.

## Context and prompt transformation

`PromptManager` builds the system prompt from extension information, prompt extras, hints, mode, and optional subagent/code-execution state. It sorts extension information for stable prompt-tool ordering and sanitizes Unicode tags in extension instructions before rendering. During a reply, the agent obtains extension information and appends project instructions to the built prompt.

MCP clients can return server instructions through initialization, while a platform client may override `get_instructions()` to compute instructions dynamically. This gives a remote server a prompt-advice channel, but it is not an arbitrary host-side prompt interception API. Recipe prompts are generated separately for recipe creation.

## Tools

`McpClientTrait` requires tool listing and invocation; optional defaults cover resources, prompts, subscriptions, MOIM, and working-directory updates. The manager aggregates tools from every client, prefixes ordinary extension tools, applies each extension's `available_tools` allowlist, and caches the resulting list. Tool dispatch carries the session ID, working directory, cancellation token, and optional tool-call request ID.

Goose's client implementation advertises MCP roots, sampling, and elicitation. It injects session and tool-call context into outgoing MCP requests, allowing a remote server to associate an interaction with the active Goose session. It also fans out tool-list-change notifications and propagates working-directory changes to connected clients. These are useful portable bridge primitives, but they do not expose the host's in-process services.

Platform extensions can provide more than MCP alone. For example, the Todo platform client writes versioned data into the current session's `extension_data`; the static registry gives it direct host context. High-fidelity behavior involving session mutation, host scheduling, nested agent work, or host-only services therefore needs a native platform extension adapter, with MCP retained as the narrower remote-tools/resources bridge.

## Approval and user interaction

Goose persists per-tool permissions as `AlwaysAllow`, `AskBefore`, or `NeverAllow`. Tool annotations declaring a non-read-only tool seed the smart-approval setting as `AskBefore`; permission changes are serialized to `permission.yaml`. This is an observed policy store, not a generic extension-defined approval user interface.

MCP elicitation is the explicit request/response interaction surface. An installed elicitation handler receives the MCP request directly; otherwise Goose resolves the request's session and active tool-call ID, waits for an action-required response for up to 300 seconds, and maps accept, decline, or cancel back to MCP. A native adapter can map Doppelganger approval to this correlated interaction, but must define its own behavior when no handler or interactive client is present.

Plugin pre-tool hooks can separately deny a call. A hook may deny with exit status 2 or JSON `{ "decision": "block" }`; a hook execution failure normally fails open, except a `PreToolUse` action configured with `on_failure: block`. Hook policy is command execution from a discovered plugin, so it is not equivalent to a trusted, capability-isolated approval provider.

## Lifecycle

The hook layer defines `SessionStart`, `SessionEnd`, `UserPromptSubmit`, pre/post tool events, file and shell events, and `Stop`. At startup it discovers enabled plugins and loads their hook rules; individual hook errors are logged rather than propagated from ordinary event emission, so a failing non-blocking hook does not crash the host tool.

For MCP interaction, the client forwards progress and logging notifications to subscribers, handles a server tool-list-changed notification, and supports cancellation of in-flight requests. A platform client factory is invoked while an extension is added and can decline registration when required host services are unavailable.

Summon implements nested work as a platform extension: it creates a `SessionType::SubAgent` session and records the parent session ID. This is a native Goose feature rather than an MCP capability supplied to arbitrary remote servers.

## Scope, state, reload, and trust

Plugin discovery is scoped to a project root and user install root. Project entries sort before user entries, and duplicate plugin names are removed after enablement filtering. On enabled-skill-directory lookup, Goose may auto-update eligible git-installed plugins; installation metadata records the source type, auto-update flag, and last update check. Hook processes receive a `PLUGIN_ROOT` environment variable and, when configured, a login-shell-derived `PATH`.

Session data is a versioned key/value container whose keys are `extension_name.version`. It persists both extension-specific state and the enabled-extension configuration. Session storage includes `extension_data`, session type, working directory, conversation, and parent session ID; copying or importing a session preserves extension data. The agent reloads enabled configurations from session data and persists the actual loaded configurations after extension changes.

Extension add compares both raw and resolved configuration; identical pairs skip restart, while a changed resolved configuration (including a changed resolved secret) restarts the client. Additions and removals invalidate the tool cache; the cache uses a version check so a concurrent mutation does not install stale results. Server tool-list-changed notifications also invalidate cached tools. There is no observed public hot-reload API for compiled platform extension code or plugin hook definitions.

Trust controls are bounded. Configured extension environments reject path, dynamic-linker, interpreter, and other process-hijacking variables. Stdio extensions are checked for malicious command arguments before launch. Goose removes MCP-app metadata claimed by an untrusted tool result, then only inserts a separately hydrated trusted attachment. These controls reduce specific risks; they do not make plugin shell hooks or in-process platform extensions sandboxed.

## Doppelganger adapter fit

**Recommendation.** Implement a Goose-specific native platform extension that owns a thin, session-scoped Doppelganger adapter. Map host session IDs and working directories to adapter session context; surface approved capabilities as namespaced JSON-schema tools through `McpClientTrait`; persist adapter data in a versioned `extension_data` key; and translate lifecycle, tool, cancellation, and subagent-parent events into portable callbacks.

Use Goose's action-required/elicitation path for explicit, correlated approval and user-data requests. Apply the host permission store before tool execution and treat plugin-hook denials as an additional host policy signal, not as portable authorization semantics. Expose remote MCP servers through a smaller bridge for tools, resources, prompts, roots, sampling, elicitation, notifications, and working-directory updates.

Keep platform-only UI, provider access, scheduler access, recipe packaging, plugin discovery, shell hooks, and installation/update policy out of the portable core. An MCP-only adapter is partial: it can exchange protocol-level capabilities, but it cannot faithfully implement direct session-state access, host-managed subagent sessions, or the compiled client factory's host context.

## Compatibility gaps

- Compiled platform extensions are registered in a static Rust map; this checkout exposes no general third-party dynamic platform-extension loader or hot-reload contract.
- MCP exposes tools and several protocol capabilities, but not arbitrary access to `SessionManager`, scheduler, provider, or other `PlatformExtensionContext` services.
- Plugin hooks execute shell commands with a plugin-root path and optional login-shell `PATH`; no general plugin sandbox or per-plugin capability model was observed.
- The permission store is tool-name policy and annotations, not a portable consent contract with a specified non-interactive fallback.
- Elicitation relies on a session and active tool-call correlation and can time out; a bridge must preserve both IDs and model cancellation/timeout outcomes.
- Session `extension_data` is JSON keyed by extension name and version. Its storage and copy/import behavior are host-specific; portable state needs its own schema and migration ownership.
- Hook failure handling is event- and configuration-dependent: ordinary hook failures can fail open, while opted-in pre-tool failures block. Portable authorization must not inherit that default implicitly.
- Recipe extension definitions and `available_tools` filtering are Goose configuration surfaces, not portable core plugin packaging.
- MCP app metadata is explicitly treated as untrusted until the host hydrates it. An adapter must not treat remote extension result metadata as trusted host data.

## Source evidence

Source paths below are repository-relative code spans in the reviewed Goose checkout.

| Claim | Path | Symbol | Lines |
|---|---|---|---:|
| MCP client contract requires tool listing/calling and defines optional resources, prompts, subscriptions, MOIM, and working-directory updates | `crates/goose/src/agents/mcp_client.rs` | `McpClientTrait` | 107-180 |
| Extension configuration supports stdio, built-in, platform, and streamable HTTP variants | `crates/goose/src/agents/extension.rs` | `ExtensionConfig` | 160-264 |
| Platform extensions are defined as in-process extensions with direct agent access | `crates/goose/src/agents/extension.rs` | `ExtensionConfig::Platform` documentation | 201-215 |
| Static registry supplies platform metadata and in-process client factories | `crates/goose/src/agents/platform_extensions/mod.rs` | `PLATFORM_EXTENSIONS` | 29-179 |
| Manager carries session manager, scheduler, provider, and MCP capabilities into extension setup | `crates/goose/src/agents/extension_manager.rs` | `ExtensionManager::new` | 1367-1417 |
| Add suppresses restart only when both raw and resolved configs match, then creates platform clients with session context | `crates/goose/src/agents/extension_manager.rs` | `ExtensionManager::add_extension` | 1435-1539 |
| Stdio clients receive session ID, undergo command malware checking, and are launched with merged environments | `crates/goose/src/agents/extension_manager.rs` | `ExtensionManager::add_extension` | 1600-1659 |
| `available_tools` is an allowlist when nonempty | `crates/goose/src/agents/extension.rs` | `ExtensionConfig::is_tool_available` | 372-392 |
| System prompt construction stably orders and sanitizes extension instructions | `crates/goose/src/agents/prompt_manager.rs` | `SystemPromptBuilder::build` | 110-143 |
| Reply preparation obtains extension information and appends project instructions | `crates/goose/src/agents/agent.rs` | reply preparation | 2394-2408 |
| Plugin discovery covers project and user roots, enables by settings, orders scopes, and de-duplicates names | `crates/goose/src/plugins/discovery.rs` | `discover_enabled_plugins_with_config` | 51-101 |
| Enabled skill discovery may auto-update eligible git plugin installs and tracks update checks in metadata | `crates/goose/src/plugins/mod.rs` | `enabled_plugin_skill_dirs_with_config`, `auto_update_plugins_at_root` | 126-150, 194-239 |
| Hook model includes session, prompt, tool, file, shell, and stop events and loads rules from discovered plugins | `crates/goose/src/hooks/mod.rs` | `HookEvent`, `HookManager::load` | 55-84, 425-520 |
| Pre-tool hook outcomes distinguish policy denial, failed-open failure, and opted-in blocking failure | `crates/goose/src/hooks/mod.rs` | `apply_verdict`, `classify_output` | 853-965 |
| Hook shell processes receive `PLUGIN_ROOT` and optionally a login-shell-derived `PATH` | `crates/goose/src/hooks/mod.rs` | `run_command_hook_inner`, `hook_command`, `resolve_hook_path` | 1068-1189 |
| Permission levels are persisted and write annotations seed ask-before smart approval | `crates/goose/src/config/permission.rs` | `PermissionLevel`, `PermissionManager::apply_tool_annotations`, `update_permission` | 15-115, 171-213 |
| Client advertises roots, sampling, elicitation, and configured MCP extensions | `crates/goose/src/agents/mcp_client.rs` | `GooseClient::get_info` | 594-612 |
| Elicitation resolves session and tool-call identifiers and waits for accept, decline, or cancel | `crates/goose/src/agents/mcp_client.rs` | `GooseClient::create_elicitation` | 526-592 |
| MCP calls inject session/working-directory/tool-call context and support cancellation | `crates/goose/src/agents/mcp_client.rs` | `send_request_with_context`, `McpClientTrait::call_tool` | 758-792, 920-987 |
| Working-directory changes update roots and notify the peer | `crates/goose/src/agents/mcp_client.rs` | `McpClient::do_update_working_dir` | 750-756 |
| Extension changes invalidate the cache and cached tools are version-checked before storage | `crates/goose/src/agents/extension_manager.rs` | `get_all_tools_cached`, `invalidate_tools_cache_and_bump_version` | 1828-1896 |
| Untrusted MCP-app metadata is removed before a host-hydrated trusted attachment is inserted | `crates/goose/src/agents/extension_manager.rs` | `remove_untrusted_mcp_app_meta`, `insert_trusted_tool_update_meta` | 343-389 |
| Environment validation rejects process-hijacking variables before extension use | `crates/goose/src/agents/extension.rs` | `Envs::DISALLOWED_KEYS`, `Envs::new` | 77-155 |
| Versioned extension data persists extension states and enabled extension configurations | `crates/goose/src/session/extension_data.rs` | `ExtensionData`, `ExtensionState`, `EnabledExtensionsState` | 13-141 |
| Agent persists and restores enabled extension configurations through session extension data | `crates/goose/src/agents/agent.rs` | `persist_extension_configs`, `load_extensions_from_session` | 1218-1334 |
| Todo platform extension reads and writes versioned session extension state | `crates/goose/src/agents/platform_extensions/todo.rs` | `TodoClient::handle_write_todo` | 58-110 |
| Summon creates subagent sessions and records parent-session linkage | `crates/goose/src/agents/platform_extensions/summon.rs` | `SummonClient::create_subagent_session` | 570-594 |
| Recipes map YAML-defined stdio, built-in, platform, and HTTP entries to runtime extension configuration | `crates/goose/src/recipe/recipe_extension_adapter.rs` | `RecipeExtensionConfigInternal`, `deserialize_recipe_extensions` | 6-147 |
