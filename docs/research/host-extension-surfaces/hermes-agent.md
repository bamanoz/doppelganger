# Hermes Agent host extension surface

This record is static-source research of [Hermes Agent](https://github.com/NousResearch/hermes-agent), covering the assigned snapshot rather than live execution. Hermes combines an in-process Python plugin API, config-owned shell hooks, and a constrained Agent Plugins v1/MCP translation layer.

## Snapshot

| Field | Value |
|---|---|
| Repository | `https://github.com/NousResearch/hermes-agent` |
| Exact commit | `5f24f291c2a99640ee695079ed1a62b6ed5c8a51` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

## Native extension model

**Observed.** Native plugins are Python modules loaded by `PluginManager`. A plugin receives `PluginContext`, through which it can register tools, lifecycle hooks, CLI commands, system-prompt sections, auxiliary tasks, and approval transports. The manager records registrations by plugin and in acquisition order so teardown can reverse them safely. Discovery is idempotent; startup may overlap discovery with other work, while synchronous consumers join the background thread before observing the registry.

Hermes has two separate declarative/portable-ish surfaces around that native API. Configured shell hooks are read from `~/.hermes/config.yaml` and registered during CLI startup; they are not plugin-owned registrations. Agent Plugins v1 packages are validated from `plugin.json`, then skills and `mcp.json` entries are translated into Hermes-native MCP configuration. This translation supports stdio and streamable HTTP, while portable SSE entries are rejected as unsupported.

**Recommendation.** Keep the portable Doppelganger core above these host-specific surfaces. Implement a native Python adapter that owns a Node sidecar for portable protocol/runtime work; the adapter should explicitly translate approved context, tools, approvals, lifecycle, and namespaced state rather than expose Hermes' raw Python runtime or process-global registries.

## Context and prompt injection

**Observed.** Hermes constructs the system prompt as stable, context, and volatile tiers. It caches the resulting prompt on the agent for the session lifetime, and deliberately does not re-render it on every turn. Plugin-rendered sections are frozen for a new session; on resume they are recovered from the persisted prompt bytes, avoiding a second plugin evaluation. Context includes workspace/context-file material and caller system text, while volatile material includes mutable skills and memory/timestamp content.

**Adapter treatment.** Translate only bounded, explicitly authorized context contributions into a portable context envelope. Do not expose the mutable prompt string, prompt-cache markers, or arbitrary system-prompt mutation to portable extensions. A Node sidecar may prepare portable context, but the Python adapter must decide when it enters Hermes' frozen/cacheable prompt tiers.

## Tools

**Observed.** `ctx.register_tool` places plugin-defined tools alongside built-ins. Tool invocation applies request middleware, then dispatches `pre_tool_call` before execution; a hook can block or modify arguments. Post-tool delivery carries the result and correlation identifiers. The native path also carries enabled tool names/toolsets and middleware traces into dispatch. Agent Plugins v1 does not itself define a native Python tool callback: its portable component surface is translated through MCP servers and discovered skills.

**Adapter treatment.** Register only portable tools with explicit JSON Schemas and stable names. Keep Hermes registry handles, middleware objects, and Python callback references adapter-owned. MCP tools should cross the sidecar boundary as validated JSON-RPC/MCP messages, never as raw in-process objects.

## Approval and user interaction

**Observed.** Approval is host-owned and keyed by the current approval session. Hermes supports CLI prompts, gateway notification/decision round trips, pending approval review when no notification callback exists, and explicitly selected plugin approval transports. A selected transport replaces built-in presentation surfaces only when the operator selected it; fallback to built-in presentation requires explicit opt-in. Timeout, notification failure, or denial is fail-closed on the gateway path, and the response tells the agent not to retry.

Session approval may be recorded for the current session; `always` additionally adds a permanent pattern and persists it to config. Command allowlist matching accepts exact commands and shell-style globs but refuses commands containing unsafe shell operators. Shell-hook registration has a separate allowlist and first-registration consent flow; `--accept-hooks`, `HERMES_ACCEPT_HOOKS=1`, or `hooks_auto_accept: true` bypasses the TTY prompt for configured shell hooks.

**Adapter treatment.** Translate a portable approval request/result into one Hermes host decision, preserving the host's session key, timeout, denial, and persistence policy. Do not let the sidecar choose an allowlist entry, bypass approval, or install a presentation transport. Operator-facing UI and shell-hook consent remain Python/host responsibilities.

## Lifecycle and events

**Observed.** The hook taxonomy includes tool, LLM/API, session, verification, gateway, skill, and subagent events. Observer hooks ignore returns; transform hooks consume a documented first-valid result; control hooks such as `pre_tool_call` can block. Bounded observer callbacks fail open on timeout, while `pre_tool_call` is fail-closed; `subagent_stop` remains serialized on the caller thread. The manager's registration ledger disposes callbacks, background tasks, and other registrations in reverse acquisition order.

Tool and approval callbacks carry `session_id`, `turn_id`, `tool_call_id`, and `api_request_id` where applicable. Subagent events include parent and child session/turn/subagent identity. These IDs are opaque correlation values, not portable authority handles.

**Adapter treatment.** Create one adapter lifecycle lease per host-loaded plugin instance and bind all sidecar subscriptions/resources to it. On session end/finalize/reset, child stop, disable, or unload, cancel sidecar work and release registrations. Preserve the distinction between observer timeout and policy-gate timeout without promising identical Python thread behavior in the portable API.

## Scope, state, and reload

**Observed.** The manager is profile-scoped by Hermes home, and its ledger is keyed by profile/plugin identity to avoid cross-profile teardown. It tracks tools, hooks, middleware, prompt sections, MCP servers, tasks, approval transports, and other registrations. Persistent process-global registrations are deliberately carried over during unload-all and stale ones are evicted after rediscovery. Force discovery unloads the prior registry, reloads plugins, refreshes toolsets, and re-registers config-owned shell hooks and outbound webhooks because those hooks are not plugin-owned.

Plugin toolset keys and portable MCP names are persisted in a cache file for startup paths that need a non-blocking snapshot while discovery is still in flight. MCP discovery is also background/deferred, with bounded waits and late binding so a dead or slow server cannot freeze startup.

Session state is durable when a caller supplies a SQLite session DB. The agent persists its cached system prompt and related session metadata; a fresh agent can restore the prompt and tool ordering. Prompt rebuilds and capability changes invalidate/update cached prompt state rather than allowing arbitrary mid-session mutation.

**Adapter treatment.** Use adapter-owned, namespaced JSON state keyed by portable plugin identity and Hermes session identity. Treat force reload as a host lifecycle event: stop the sidecar, invalidate portable registrations and cached snapshots, then create a fresh sidecar generation. Do not infer that a persisted MCP/toolset cache is an authoritative live registry.

## Trust envelope and privileged surfaces

**Observed.** Hermes defines its trust envelope as resources implicitly granted by running under the operator's account, typically whatever that account can reach. The default terminal executes on the host. A terminal backend sandbox confines shell and file operations but does not confine the Python process, code execution, MCP subprocesses, plugin loading, hooks, or skill loading. Whole-process wrapping is the stronger mode that covers shell, code execution, MCP, file tools, plugins, hooks, and skills together.

Native Python plugins and hooks therefore run inside the agent interpreter and may observe highly sensitive prompt, tool, approval, and provider data. `pre_gateway_dispatch` is especially privileged because its arguments include gateway/session-store objects. Raw host handles, provider credentials, filesystem access, and gateway control must not cross into portable sidecar code without an explicit host policy.

**Adapter treatment.** The Python adapter is the trust boundary. Give the Node sidecar a narrow message protocol, capability-scoped data, bounded resource limits, and redacted payloads by default. Run the sidecar under the strongest available process/container policy when untrusted extension code is involved; do not describe terminal-backend isolation as sufficient for native plugin or sidecar isolation.

## Doppelganger adapter fit

| Adapter responsibility | Hermes native seam | Portable treatment |
|---|---|---|
| Discovery | `PluginManager.discover_and_load`, background discovery, Agent Plugins v1 loader | Snapshot validated metadata once; keep discovery and install paths host-owned. |
| Context | Frozen `render_system_prompt_sections` output and prompt tiers | Translate bounded context contributions; host decides cache tier and timing. |
| Tools | `PluginContext.register_tool`, MCP translation | Register declared JSON-Schema tools; use sidecar MCP messages, not raw registry objects. |
| Approval | Approval gate, gateway/CLI surfaces, selected approval transports | One host-mediated approval request/result; preserve session/permanent policy and fail-closed outcomes. |
| Lifecycle | `VALID_HOOKS`, `invoke_hook`, ownership ledger | Bind sidecar generation and registrations to a lease; clean up on unload/reset/finalize. |
| State | Profile-keyed manager, session DB, prompt/toolset caches | Namespaced JSON state with explicit session scope; invalidate on reload. |
| Reload | `discover_and_load(force=True)`, MCP late refresh, config-hook re-registration | Stop/restart adapter generation; do not expose a generic live registry mutation API. |
| Trust | Python in-process plugin and whole-process sandbox modes | Keep privileged host handles in Python; constrain Node sidecar protocol and process. |

## Compatibility gaps

1. **Raw runtime authority is incompatible.** Native plugins execute in Hermes' Python process and can reach host-owned registries, callbacks, and sensitive data; portable extensions need a narrower sidecar protocol.
2. **Prompt caching is host policy.** Frozen plugin sections and persisted prompt bytes do not define a portable prompt mutation or cache-control API.
3. **Shell hooks are config-owned.** They are re-registered after force reload but are not ordinary plugin registrations, so they cannot be represented as portable plugin lifecycle callbacks without changing ownership semantics.
4. **MCP translation is intentionally partial.** Agent Plugins v1 validation covers declared manifests and supported stdio/streamable HTTP forms; SSE is diagnosed as unsupported and raw MCP runtime details remain Hermes-native.
5. **Approval transports are host-owned.** Hermes can install a plugin transport, but activation is explicitly selected by the operator and policy, not implied by registration. Allowlist persistence and unsafe-command matching have no host-neutral equivalent.
6. **Lifecycle timing differs by host.** Hermes uses Python callback timeout classes, caller-thread exceptions, background discovery joins, and late binding; a portable contract should preserve outcomes, not promise these exact timing/thread mechanics.
7. **Trust boundaries differ.** Terminal-backend isolation does not contain Python plugins, MCP subprocesses, or hooks; only whole-process wrapping covers the full extension process tree.
8. **Host UI/provider/packaging surfaces remain outside core.** CLI commands, gateway notifications, shell-hook UX, provider-specific prompt/cache behavior, plugin installation locations, and MCP transport setup belong in the Hermes adapter.

## Source evidence

All paths below are repository-relative to the snapshot above. Line spans were directly checked in the assigned checkout.

| Claim | Path | Symbol | Lines |
|---|---|---|---|
| Native plugin context is the facade used by plugins to register tools and hooks. | `hermes_cli/plugins.py` | `PluginContext` | 1458-1461 |
| Plugin tools delegate into the native tool registry. | `hermes_cli/plugins.py` | `PluginContext.register_tool` | 1777-1790 |
| Native hook taxonomy includes tool, LLM/API, session, subagent, and gateway events. | `hermes_cli/plugins.py` | `VALID_HOOKS` | 163-229 |
| Hook timeout policy distinguishes bounded fail-open hooks, fail-closed policy hooks, and caller-thread hooks. | `hermes_cli/plugins.py` | `_HOOK_TIMEOUT_BOUNDED_HOOKS`, `_HOOK_TIMEOUT_FAIL_CLOSED_HOOKS`, `_HOOK_CALLER_THREAD_HOOKS` | 425-447 |
| Plugin manager state tracks tools, hooks, middleware, prompt sections, MCP servers, tasks, and approval transports. | `hermes_cli/plugins.py` | `PluginManager.__init__` | 3741-3771 |
| Registrations are disposed in reverse acquisition order and exact-object inverses avoid removing later registrations. | `hermes_cli/plugins.py` | `PluginManager._unload_scoped` | 4037-4104 |
| Force rediscovery unloads before loading and re-registers config-owned shell hooks/webhooks afterward. | `hermes_cli/plugins.py` | `PluginManager.discover_and_load`, `_re_register_config_hooks_after_force` | 4226-4294 |
| Background plugin discovery joins before synchronous consumers observe the registry. | `hermes_cli/plugins.py` | `start_background_plugin_discovery`, `_join_background_discovery`, `discover_plugins` | 6316-6354 |
| Hook invocation lazily discovers plugins for gateway, TUI, query, and cron paths. | `hermes_cli/plugins.py` | `invoke_hook` | 6473-6483 |
| Prompt is assembled into stable/context/volatile cache tiers and cached for the agent lifetime. | `agent/system_prompt.py` | `build_system_prompt_parts` | 435-451 |
| Plugin prompt sections render once and are not re-evaluated when a persisted prompt is restored. | `agent/system_prompt.py` | `_frozen_plugin_prompt_sections` | 191-226 |
| Persisted plugin prompt frames are validated and restored from the cached full prompt. | `agent/system_prompt.py` | `_restore_plugin_prompt_sections` | 229-271 |
| Context and volatile prompt inputs include context files, caller system text, mutable skills, and memory/timestamp material. | `agent/system_prompt.py` | `build_system_prompt_parts` | 871-922 |
| Agent Plugins v1 and MCP schema URLs/field sets are explicit, with constrained names. | `hermes_cli/agent_plugins.py` | schema constants and field sets | 21-43 |
| Plugin path placeholders are scoped to `PLUGIN_ROOT` or `PLUGIN_DATA` and escape attempts are rejected. | `hermes_cli/agent_plugins.py` | `_expand`, `_resolve_scoped_path` | 255-286 |
| Agent Plugins v1 manifests require the supported schema and constrained plugin names. | `hermes_cli/agent_plugins.py` | `_validate_manifest` | 109-120 |
| Stdio MCP translation validates executable/args/env/cwd and reserves injected root/data variables. | `hermes_cli/agent_plugins.py` | `_translate_stdio` | 378-433 |
| Remote MCP translation validates HTTP(S), forbids user info/fragments, and enables strict redirect-header handling. | `hermes_cli/agent_plugins.py` | `_validate_remote_url`, `_translate_remote` | 310-375 |
| MCP discovery validates top-level shape, translates stdio/streamable HTTP, and rejects portable SSE. | `hermes_cli/agent_plugins.py` | `_discover_mcp` | 443-521 |
| Loaded Agent Plugins return validated manifest, skills, MCP servers, roots, and diagnostics. | `hermes_cli/agent_plugins.py` | `load_agent_plugin` | 524-548 |
| CLI startup discovers plugins/MCP and registers shell hooks from config. | `cli.py` | deferred startup block | 1025-1057 |
| MCP discovery uses deferred/background startup and bounded waiting with late refresh. | `hermes_cli/mcp_startup.py` | `defer_background_mcp_discovery`, `wait_for_mcp_discovery` | 163-185, 215-235 |
| Tool execution applies middleware and invokes a pre-tool policy hook with session/turn/call/request IDs. | `agent/agent_runtime_helpers.py` | `invoke_tool` | 3509-3576 |
| Native tool dispatch carries `tool_call_id`, `session_id`, `turn_id`, and `api_request_id`. | `agent/agent_runtime_helpers.py` | `invoke_tool` dispatch kwargs | 3763-3794 |
| CLI `--accept-hooks` auto-approves unseen config shell hooks in headless runs. | `hermes_cli/_parser.py` | `--accept-hooks` flag | 264-274 |
| Shell-hook management reads config entries and reports persisted approvals. | `hermes_cli/hooks.py` | `_cmd_list` | 51-83 |
| Config defaults define plugin callback timeout, config-owned hooks, and hook auto-accept. | `hermes_cli/config_defaults.py` | default configuration | 2688-2708 |
| Approval hooks bind session, turn, tool-call, and session correlation IDs. | `tools/approval.py` | `set_current_session_key`, `set_current_observability_context` | 189-212 |
| Permanent allowlist entries are loaded from and saved to config. | `tools/approval.py` | `load_permanent_allowlist`, `save_permanent_allowlist` | 3179-3205 |
| Permanent command matching supports exact/glob patterns but rejects unsafe shell operators. | `tools/approval.py` | `_command_matches_permanent_allowlist` | 3080-3171 |
| Selected approval transports replace built-in presentation only under explicit selection/fallback policy. | `tools/approval.py` | `_run_approval_gate` transport branch | 5120-5161 |
| Gateway approval timeout, notification failure, or denial returns a blocked non-consent result. | `tools/approval.py` | `_run_approval_gate` gateway branch | 3915-3977 |
| Session or permanent approval choices update in-memory and persisted allowlists. | `tools/approval.py` | `_run_approval_gate` choice handling | 3979-3985, 4065-4072 |
| Hermes defines the trust envelope as resources available to the operator's account. | `SECURITY.md` | Trust envelope | 43-55 |
| Terminal isolation does not contain Python process code, MCP subprocesses, plugins, hooks, or skills. | `SECURITY.md` | Terminal-backend isolation | 70-88 |
| Whole-process wrapping covers shell, code execution, MCP, file tools, plugins, hooks, and skill loading. | `SECURITY.md` | Whole-process wrapping | 90-95 |
