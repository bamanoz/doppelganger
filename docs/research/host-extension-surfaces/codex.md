# Codex host extension surface

## Snapshot

| Field | Value |
|---|---|
| Repository | [OpenAI Codex](https://github.com/openai/codex) |
| Exact commit | `4fdf4c11131ec901a303f68e5ad8962469697bb6` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

This is static source research at the commit above. It describes the typed Rust extension API separately from Codex's legacy command/MCP hook pipeline; those are related host surfaces, not one interchangeable extension mechanism.

## Native extension model

Codex's native seam is an in-process Rust contributor registry. `ExtensionRegistryBuilder<Config>` accepts `Arc`-wrapped typed contributors while mutable, then `build()` freezes an `ExtensionRegistry<Config>` containing ordered vectors for lifecycle, context, MCP, tools, approval, and turn-item contributors. The app-server assembles one registry and installs feature extensions before handing the resulting `Arc` to the runtime. This is a host-integrated ABI/type contract, not a network protocol or a dynamically discovered script package.

Registration order is observable: contributors are retained in vectors, and approval and MCP resolution walk those vectors. A native extension therefore needs to compile against Codex's extension API and be installed by host code (or an upstream-supported loading mechanism). An MCP server can supply model-callable tools, but cannot become a `ContextContributor`, `ToolLifecycleContributor`, or `ApprovalReviewContributor` merely by speaking MCP.

### Prompt and context

`ContextContributor` has separate thread-context, turn-context, and world-state methods. Thread and turn methods return host prompt fragments; world state returns extension-owned sections that can carry a stable ID, comparison snapshot, and diff renderer. `TurnContextContributionInput` exposes `ThreadId`, turn ID, three `ExtensionData` stores, and the effective model context window. `TurnInputContributor` is a distinct seam for additional model input on a submitted turn and receives resolved user input and ordered environments.

World-state inputs also carry selected capability roots and an executor materialization snapshot for the exact sampling step. The extension owns its stable section identity and rendering policy, while the host owns persistence and the concrete model-context envelope. This preserves host authority over environment and executor resources.

### Native tools

`ToolContributor::tools` returns native `ToolExecutor` implementations bound to session/thread stores; `tools_for_step` can vary tools for a sampling step. Native tool ownership is distinct from `ToolLifecycleContributor`, whose callbacks observe execution and MCP results without rewriting invocation. The API explicitly directs policy that changes tool payloads to legacy hooks instead.

For MCP-backed calls, Codex freezes `McpToolContext` from the prepared call. It exposes copied tool metadata and a source classification (`Connector`, configured server, plugin with host root, selected plugin, or `Other`) without exposing the executable client. Tool callbacks receive model-visible call ID, turn/root correlation, tool name, finalized payload, conversation snapshot, source, and scoped stores.

### Approval and review

`ApprovalReviewContributor` offers two deliberately narrow paths: `fast_decision` can return an existing `ReviewDecision`, while `full_review` receives immutable structured action evidence, a canonical conversation snapshot, thread/turn identity, and approval/retry reasons. The registry uses first-claim semantics for both paths: a contributor returning `None` leaves the request for the next contributor or host fallback; the first claimed assessment/decision wins. Errors distinguish failure, timeout, and cancellation. There is no generic extension-level multi-step approval workflow or UI protocol.

The legacy hook-side `PermissionRequest` is separate. It runs before guardian or user approval UI, executes all matching handlers, and folds decisions conservatively: any deny wins; otherwise the last allow wins; no decision leaves normal approval in control. `PreToolUse` can additionally block, add model context, or rewrite tool input. Those mutation and blocking semantics are not supplied by the typed tool-lifecycle trait.

### Thread, turn, and tool lifecycle

Thread lifecycle callbacks are `on_thread_start`, `on_thread_ready`, `on_thread_resume`, `on_thread_idle`, and `on_thread_stop`. Their inputs expose host configuration/session source, persistent-state availability, selected environments, optional MCP resource client and metrics, plus session/thread stores. Turn lifecycle callbacks are `on_turn_start`, `on_turn_stop`, `on_turn_abort`, and `on_turn_error`; their inputs carry turn IDs where applicable, collaboration mode/token snapshot or error/abort reason, and session/thread/turn stores.

The core session emits those callbacks at the corresponding gates. Tool lifecycle emits start after pre-tool hooks finalize an invocation, optional MCP-result processing before result publication, and finish after completed, blocked, failed, or aborted outcomes. Cancellation may happen before a matching start callback; contributors must not assume start/finish pairing. `ToolCallOutcome` preserves whether a handler ran for failures and whether a call was blocked or aborted.

On shutdown, the host shuts down the hook command runtime and MCP runtime, invokes thread-stop lifecycle, and flushes thread persistence. Typed contributors do not receive an independent universal disposal trait; their teardown opportunity is lifecycle callbacks and the lifetime of their installed values. The legacy hook runtime explicitly joins/aborts outstanding async work through `Hooks::shutdown`.

### Scope, state, reload, and trust

`ExtensionDataInit` is a typed, host-supplied initializer whose attachment map is frozen when cloned; `ExtensionData` is one host-owned scope with a string level ID and a mutex-protected `TypeId` map. It supports typed get, lazy get-or-init, insert, conditional insert, and remove. Values are `Arc<dyn Any + Send + Sync>`, so extensions share typed state without receiving raw session/task internals. Codex creates session, thread, and turn scopes; a turn context retains its extension data when turn state is cloned across turns.

MCP contribution resolution is context-sensitive. `McpServerContributionContext` exposes configuration and, for thread resolution, thread initialization/store, session source, originator, selected capability roots, and the exact executor discovery snapshot. Contributions can set/replace or remove a named server, register hosted Apps, and identify selected plugin packages. Later contributions for the same name replace earlier ones. Contributors must apply source policy and retain package provenance; global resolution does not get a local fallback.

There are two different replacement models. The typed registry itself is built once for a host runtime. The MCP runtime publishes immutable connection/configuration snapshots atomically with `ArcSwap`; existing bindings retain their exact connections while new publication becomes current. Dynamic tools selected for a thread are snapshotted and persisted in rollout metadata rather than being an extension-owned hot-reload channel. Hook configuration can instead be reconstructed with `Hooks::reconfigured`, preserving in-flight background command hooks, and executor hook sources can be replaced on a cloned hook object.

Hook trust is host policy, not a property of MCP transport. Discovery receives `bypass_hook_trust`, supports managed-only requirements, computes normalized configuration hashes, and classifies hooks as trusted, managed, modified, or untrusted. Built-in and managed hooks are trusted/required according to source policy; user/project/plugin hooks can be disabled or trusted by matching hash. Plugin and executor paths preserve authority-bound roots/filesystems. Public hook summaries omit executor-scoped hooks, which remain asynchronous host execution details.

## Doppelganger adapter fit

The highest-fidelity adapter is an upstream/native Rust integration that installs a Doppelganger contributor value into Codex's `ExtensionRegistryBuilder`, rather than an MCP-only server. Map actor identity and causal correlation to `ThreadId`, `turn_id`, `root_turn_id`, and `call_id`; map durable request state to the host-provided session/thread/turn `ExtensionData`; map prompt/model input to `ContextContributor`, `TurnInputContributor`, and (where appropriate) world-state sections; map owned tools to `ToolContributor`; map telemetry and observation to `ToolLifecycleContributor`; map structured one-shot review to `ApprovalReviewContributor`; and map startup/rehydration/idle/stop to thread and turn lifecycle contributors.

The adapter must keep Codex-owned capability roots, executor snapshots, MCP bindings, transcript/history snapshots, and approval authority on the host side. It should not emulate atomic MCP publication by mutating plugin-owned state: ask the host to resolve `McpServerContribution`s and publish a new snapshot. Legacy hooks remain useful as a compatibility adapter for command/MCP rewrite, block, add-context, and permission-decision behavior, but they should not be mistaken for the typed contributor registry or used as a substitute for native lifecycle integration.

A high-fidelity adapter therefore requires upstream/native Rust integration (or an explicitly supported Codex loader that can construct these typed traits). An external MCP process can participate only at the MCP server/tool boundary; it cannot observe all thread/turn/tool lifecycle gates, access typed stores, contribute native prompt/world-state sections, or claim the structured approval-review seam.

## Compatibility gaps

- Codex has no single generic extension callback that combines prompt mutation, tool payload rewriting, approval policy, tool execution, and lifecycle observation. A Doppelganger adapter must compose multiple contributor traits and the host event sink.
- Typed tool lifecycle intentionally observes finalized calls and MCP results; it does not rewrite invocations. Rewrite/block behavior lives in legacy `PreToolUse` hooks, whose competing rewrites resolve by completion order and whose block suppresses the rewritten input.
- Typed approval is first-claim, one-shot fast/full review. Legacy permission hooks execute all matching handlers and use deny-wins/last-allow folding. Neither is a general multi-round approval protocol.
- The registry is frozen after installation. Runtime MCP replacement is host-owned snapshot publication; it is not permission for an extension to mutate the registry or retain borrowed contribution context.
- Extension state is typed `Send + Sync` attachments scoped to host objects, not a portable persistence API. Durable state must use host lifecycle and persistence facilities.
- Hook discovery and trust are configured by Codex layers and plugin roots. A portable core must not absorb Codex-specific managed/user/project/plugin trust or executor filesystem rules.
- MCP snapshots carry Codex-specific server catalogs, credentials, selected roots, executor files, and plugin provenance. A portable Doppelganger design should model the capability boundary, not copy these host-specific packaging/provider details.
- No Doppelganger support is implemented in the cited Codex checkout; the mapping above is a recommendation for integration, not an observed Codex feature.

## Source evidence

| Claim | Path | Symbol | Lines |
|---|---|---|---|
| App-server builds one typed registry and installs feature extensions | `codex-rs/app-server/src/extensions.rs` | `thread_extensions` | 55-58, 75-134 |
| Builder starts with ordered contributor collections | `codex-rs/ext/extension-api/src/registry.rs` | `ExtensionRegistryBuilder::default` | 25-49 |
| Builder registration is typed and ends in immutable `build` | `codex-rs/ext/extension-api/src/registry.rs` | `ExtensionRegistryBuilder` methods | 70-143 |
| Frozen registry stores all contributor categories | `codex-rs/ext/extension-api/src/registry.rs` | `ExtensionRegistry` | 146-161 |
| Approval registry uses first claimed full review | `codex-rs/ext/extension-api/src/registry.rs` | `full_approval_review` | 205-217 |
| Approval registry uses first claimed fast decision | `codex-rs/ext/extension-api/src/registry.rs` | `fast_approval_decision` | 219-241 |
| Context contributor separates thread, turn, and world-state methods | `codex-rs/ext/extension-api/src/contributors.rs` | `ContextContributor` | 87-128 |
| Turn context carries identity, stores, and context window | `codex-rs/ext/extension-api/src/contributors/context.rs` | `TurnContextContributionInput` | 5-20 |
| Turn input exposes user input and prioritized environments | `codex-rs/ext/extension-api/src/contributors/turn_input.rs` | `TurnInputContext` | 18-27 |
| World state preserves extension sections while host owns envelope/persistence | `codex-rs/ext/extension-api/src/contributors/world_state.rs` | `WorldStateContributionInput`, `WorldStateSectionContribution` | 12-26, 74-87 |
| Native tools and tool lifecycle are separate traits | `codex-rs/ext/extension-api/src/contributors.rs` | `ToolContributor`, `ToolLifecycleContributor` | 301-347 |
| Approval input is immutable structured host evidence | `codex-rs/ext/extension-api/src/contributors/approval_review.rs` | `ApprovalReviewInput` | 55-71 |
| Approval assessment and operational errors are structured | `codex-rs/ext/extension-api/src/contributors/approval_review.rs` | `ApprovalAssessment`, `ApprovalReviewError` | 19-53 |
| Thread lifecycle has start/ready/resume/idle/stop gates | `codex-rs/ext/extension-api/src/contributors/thread_lifecycle.rs` | `ThreadLifecycleContributor` inputs | 17-84 |
| Turn lifecycle has start/stop/abort/error gates | `codex-rs/ext/extension-api/src/contributors/turn_lifecycle.rs` | `TurnStartInput`, `TurnStopInput`, `TurnAbortInput`, `TurnErrorInput` | 8-58 |
| Core emits turn lifecycle callbacks and idle/abort/error notifications | `codex-rs/core/src/tasks/lifecycle.rs` | `Session` lifecycle emitters | 10-104 |
| Tool callback phases and abort path are host-emitted | `codex-rs/core/src/tools/lifecycle.rs` | `notify_tool_start`, `process_mcp_tool_result`, `notify_tool_finish`, `notify_tool_aborted` | 17-104 |
| Tool outcomes include completed/blocked/failed/aborted | `codex-rs/ext/extension-api/src/contributors/tool_lifecycle.rs` | `ToolCallOutcome` | 21-40 |
| Tool provenance is frozen without exposing executable client | `codex-rs/ext/extension-api/src/contributors/tool_lifecycle.rs` | `McpToolContext::from_prepared_call` | 42-113 |
| Extension data uses typed `TypeId` attachments and scoped IDs | `codex-rs/ext/extension-api/src/state.rs` | `ExtensionDataInit`, `ExtensionData` | 10-18, 47-80 |
| Extension data supports lazy/conditional mutation and removal | `codex-rs/ext/extension-api/src/state.rs` | `ExtensionData` methods | 82-137 |
| MCP resolution context carries roots, executor snapshot, stores, and originator | `codex-rs/ext/extension-api/src/contributors/mcp.rs` | `McpServerContributionContext` | 9-29, 84-113 |
| MCP overlays support set, hosted Apps, selected plugin, package, and remove | `codex-rs/ext/extension-api/src/contributors/mcp.rs` | `McpServerContribution` | 130-157 |
| MCP runtime uses atomic published snapshots and retains old bindings | `codex-rs/codex-mcp/src/runtime.rs` | `McpRuntime`, `PublishedMcpRuntime` | 89-120 |
| MCP replace publishes a new current snapshot | `codex-rs/codex-mcp/src/runtime.rs` | `replace`, `replace_fresh`, `publish` | 258-319 |
| Dynamic tool/extension data is created per turn and carried across cloned context | `codex-rs/core/src/session/turn_context.rs` | `TurnContext` construction and clone | 238-246, 542-546, 780-816 |
| Root turn IDs propagate through queued trigger-turn options | `codex-rs/core/src/session/input_queue.rs` | trigger-turn start option propagation | 163-180, 322-327 |
| Hook registry supports reconfiguration, executor hook replacement, and shutdown | `codex-rs/hooks/src/registry.rs` | `Hooks::new`, `reconfigured`, `with_executor_hooks`, `shutdown` | 68-105, 139-142 |
| Hook discovery applies managed-only and bypass trust policy | `codex-rs/hooks/src/engine/discovery.rs` | `discover_handlers` | 94-116, 118-198 |
| Hook trust status is hash-based and source-sensitive | `codex-rs/hooks/src/engine/discovery.rs` | `hook_hash`, `hook_trust_status`, `hook_enabled` | 766-821 |
| Pre-tool hooks can block, add context, and rewrite input | `codex-rs/hooks/src/events/pre_tool_use.rs` | `PreToolUseOutcome`, `run` | 38-53, 72-146 |
| Competing pre-tool rewrites resolve by completion order | `codex-rs/hooks/src/events/pre_tool_use.rs` | `latest_updated_input` | 149-167 |
| Permission hooks execute all matching handlers with deny-wins folding | `codex-rs/hooks/src/events/permission_request.rs` | `run`, `resolve_permission_request_decision` | 87-169 |
| Session shutdown flushes hooks, MCP, thread lifecycle, and persistence | `codex-rs/core/src/session/handlers.rs` | `shutdown_session_runtime`, `emit_thread_stop_lifecycle`, `shutdown` | 402-466, 725-733 |
