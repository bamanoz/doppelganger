# OpenClaw host extension surface

OpenClaw exposes a native TypeScript plugin system whose control plane discovers and validates plugin metadata before its runtime plane synchronously registers capabilities into a guarded registry. This document preserves the original comparative static-source record and separately records the later implementation-target investigation. Neither source record is evidence that an installed native smoke passed.

## Snapshot

| Field | Value |
|---|---|
| Repository | `https://github.com/openclaw/openclaw` |
| Exact commit | `fc895e4f00ce2a54b1ebd83deeb30d75bfde4922` |
| Research date | 2026-09-03 |
| Support status | Historical source research retained; Doppelganger adapter certified separately against installed `openclaw@2026.9.1` build `ad6fe23` on September 6, 2026 |

### Current adapter target and separate source investigation

| Field | Value |
| --- | --- |
| Adapter package | private workspace `@doppelganger/doppelganger-host-openclaw` |
| Install candidate | `openclaw@2026.9.1` |
| Published build SHA | `ad6fe23aecb9b833d68139b0ddc9f239b894d2f1` |
| Adapter source investigation | OpenClaw commit `837e0b20f479f4fa060bd7a2d50112e279103fb8` |
| Investigation checkout/date | `/tmp/doppelganger-openclaw-research-20260905`, 2026-09-05 |
| Runtime evidence | repository adapter tests exist; installed-Gateway smoke outcome not yet recorded |

The published build SHA and source commit are distinct evidence. The source checkout established the public SDK shape and informed the adapter, but it does not prove that the published `2026.9.1` build behaves identically. The private package pins the version, and [Verification](../../operations/verification.md#openclaw-evidence) owns the real installed-host result.

The later source investigation found these implementation-critical constraints without altering the original snapshot below:

- native registration and tool factories are guarded and synchronous, and returned tool names must be concretely manifest-declared;
- normal embedded execution awaits `before_model_resolve` before constructing plugin tools, while locked-model or contained hook failure paths can continue without that warmup;
- `before_prompt_build` preserves separate system and ordinary context additions on the supported embedded route;
- public `before_tool_call` can return `requireApproval` with synchronous `onResolution`; the implemented adapter records exact pre-dispatch correlation for every declared tool and additionally requires `allow-once` for approval-required descriptors;
- native cleanup subscriptions exist, but `agent_end` and transcript observations do not prove a portable committed turn;
- plugin conversation hooks require configured host permission, and source/manifest changes require native inspection and restart rather than adapter-side registry mutation.

The installed `2026.9.1` package was also inspected independently of the research checkout:

- Its `openclaw/plugin-sdk/core` tool-factory context does not expose `runId`; the adapter obtains optional run correlation from the actual `before_tool_call` context instead of inventing a factory field or substituting the session ID. The published `plugin-sdk/types` entry does not provide the expected declaration surface, so shipping imports use the public core exports and callback-compatible local hook contracts.
- `dist/embedded-agent-DaSvA-Yk.js` constructs the ordinary embedded hook context with `runId`, `agentId`, canonical `sessionKey`, `sessionId`, and `workspaceDir` and forwards it through model setup. `dist/setup-1lxp_-pZ.js` awaits `runBeforeModelResolve` but returns earlier for locked model selection. This is installed-source evidence of ordering and available identities, not proof that every ingress executes the hook.
- `api.runtime.agent.session.getSessionEntry({ agentId, sessionKey, readConsistency: 'latest' })` is an existing synchronous public metadata reader returning the actual session entry when needed. The asynchronous `session_start` notification is not an awaited warmup barrier; gateway `sessions.resolve` returns route identity only and `sessions.get` returns messages, not a session-generation lookup.
- An isolated native installation was observed as loaded and activated through public runtime inspection with five typed hooks and three finite optional tools. Registration and installation evidence alone does not certify successful context/tool execution; that remains owned by the installed-Gateway smoke.

## Native extension model

**Observed.** OpenClaw has two distinct phases:

1. **Discovery and metadata control plane.** It scans configured, workspace, bundled, and global locations; caches the result; resolves manifests; rejects incompatible package/API versions; and resolves duplicate identities by origin precedence. Ordinary manifest readers reuse a gateway metadata snapshot when one is available. Gateway publication requires a complete startup inventory and forbids replacement while a gateway-owned snapshot remains active.
2. **Runtime registration plane.** The loader creates a registry and lazy runtime, then invokes each plugin's `register` function synchronously. The registration API is guarded after the call returns. A candidate registration failure rolls back that plugin's global side effects; an activation-path failure rolls back loaded inactive records in reverse order.

**Recommendation.** A Doppelganger integration should make this boundary explicit: first produce a host-native, immutable-by-adapter discovery inventory; then perform one synchronous, guarded registration pass against that inventory. The portable core should not query OpenClaw locations, load manifests, or mutate registry state after registration closes.

## Context and prompt injection

**Observed.** Typed hook names include `agent_turn_prepare`, `before_prompt_build`, and `heartbeat_prompt_contribution`; OpenClaw classifies those three as prompt-injection hooks. The prompt builder executes registered modifiers to inject context or a system prompt before submission. A `before_prompt_build` hook may request a tool-authority-bound lane, which receives only the finalized tool surface and yields context fields rather than arbitrary authority changes.

Prompt injection is configurable per plugin entry: it is enabled unless `allowPromptInjection` is explicitly false. Conversation-data hooks are more restrictive for non-bundled plugins: they require `allowConversationAccess: true`; bundled plugins default to permitted unless explicitly disabled.

**Recommendation.** Map portable prompt contribution to a narrow declarative context-contribution contract. Preserve OpenClaw's host policy gate around registration/execution, but do not make prompt mutation, conversation messages, provider/model hooks, or tool-authority objects portable Doppelganger APIs.

## Tools

**Observed.** Tool registration requires a non-empty `contracts.tools` declaration and rejects names not listed there. Agent-tool-result middleware must declare every target runtime in `contracts.agentToolResultMiddleware`; non-bundled middleware also requires explicit enablement.

**Recommendation.** Expose only contract-declared portable tools through the adapter. Keep OpenClaw-specific middleware runtimes and policy matchers inside the adapter.

## Approval and user interaction

**Observed.** Trusted tool policies are separate from ordinary tools: non-bundled plugins must declare each policy in `contracts.trustedToolPolicies` and be both enabled and explicitly enabled. Session actions provide a native user-interaction path with a handler, optional JSON Schema, and validated operator scopes. This source surface is a policy and action mechanism, not evidence of a portable or generic approval protocol.

**Recommendation.** A native adapter can translate trusted policy decisions and validated session actions into a one-shot Doppelganger approval boundary where one exists, while retaining native scopes and action vocabulary.

## Lifecycle, events, and rollback

**Observed.** Runtime lifecycle registrations carry cleanup callbacks and cleanup reasons (`disable`, `reset`, `delete`, or `restart`). Agent-event subscriptions are identified, optionally filtered by streams, and deduplicated per plugin. Terminal lifecycle events mark a run closed, wait up to five seconds for pending event handlers, then clear that run's context; expiration prevents late handlers from recreating state.

Registration is failure-atomic at the registry boundary: candidate registration errors invoke `rollbackPluginGlobalSideEffects`. If later activation/cache work throws, the loader rolls back loaded inactive records in reverse order without replacing the registry that already serves runtime consumers.

**Recommendation.** Bind adapter-owned registrations to a single host lifecycle lease. On disable, reset, delete, restart, failed registration, or terminal run, remove portable registrations and clear adapter-owned state. Do not provide plugin-controlled rollback hooks that can mutate the native registry outside that lease.

## Scope, state, and reload

**Observed.** Run context is keyed by run ID, plugin ID, and namespace. Values must be JSON-compatible and are cloned on both write and read, preventing plugins from retaining mutable aliases to host state. Session extensions similarly belong to a plugin namespace; an optional synchronous projector creates a safe view for host readers, while writes remain host-mediated. Duplicate namespaces and projected session slots are rejected.

Reload is explicit metadata rather than an observed generic plugin watcher API: a plugin supplies `restartPrefixes`, `hotPrefixes`, and/or `noopPrefixes`, and empty registrations are warned about. Gateway metadata publication is similarly explicit: complete inventory is required and replacement is deferred until gateway shutdown; lifecycle cleanup clears snapshots and memo caches only when no active gateway owner remains.

**Recommendation.** Map run and session values to Doppelganger-owned namespaced JSON state with copy-in/copy-out semantics. Treat OpenClaw reload prefixes as adapter metadata that chooses restart, hot reconfiguration, or no action. Do not expose a portable filesystem watcher or permit an extension to replace its own host inventory.

## Trust and privileged runtime surfaces

**Observed.** The injected `PluginRuntime` is explicitly described as a trusted in-process surface. It can issue gateway requests, request gateway scopes (honored only for bundled or trusted official plugins), run and manage subagents, invoke nodes, resolve sandbox authority, prepare workspace authority, and manage worktrees. These capabilities are beyond a portable plugin contract and depend on the active trusted gateway/session context.

**Recommendation.** Implement a thin native TypeScript adapter that performs trust checks before translating only the portable core: discovery snapshot, synchronous registration, declared tools, approved prompt contributions, namespaced state, approval translation, and lifecycle cleanup. Exclude raw gateway requests, privileged subagent management, node duplex calls, sandbox/workspace preparation, worktree management, provider hooks, control UI, channel surfaces, CLI/packaging, and any direct native runtime helper from the portable Doppelganger API.

## Doppelganger adapter fit

| Adapter responsibility | Native OpenClaw seam | Portable treatment |
|---|---|---|
| Discovery | `discoverOpenClawPlugins` and manifest registry | Capture a complete host inventory once and expose an immutable adapter snapshot. |
| Registration | `register` via `runPluginRegisterSyncInRegistry` | Call synchronously; invalidate normal registrar methods when it returns. |
| Context | Typed prompt hooks | Translate declared, policy-approved context contributions only. |
| Tools | `registerTool` plus contracts | Register declared portable tools only; retain host middleware and matcher details. |
| Approval | Trusted tool policies and session actions | Translate scoped decisions to a Doppelganger approval request; retain native scopes/actions. |
| State | Session extensions and run context | Own JSON-only namespaces in the adapter and clear them with lifecycle events. |
| Reload | Reload prefixes and metadata lifecycle | Interpret host metadata; perform host-owned cleanup/replacement rather than self-watching. |

## Compatibility gaps

1. **Broad native authority.** OpenClaw's trusted runtime includes gateway, subagent, node, sandbox, and worktree operations. A portable Doppelganger core must not inherit those capabilities merely by being registered in OpenClaw.
2. **Trust defaults are origin-sensitive.** Conversation access differs for bundled and non-bundled plugins, while prompt injection defaults differently. The adapter needs an explicit trust-policy translation rather than assuming one portable default can reproduce each host's policy.
3. **Approval semantics are host-specific.** The observed API offers trusted tool policies and scoped session actions, not a host-neutral approval object. The adapter must define the portable approval request/result contract.
4. **Reload is configuration metadata.** Prefix-based restart/hot/no-op guidance does not establish a portable live-reload protocol or a generic file watcher.
5. **Host-only presentation and packaging.** Control UI descriptors, gateway-local routes, CLI registrations, channel integrations, manifest/install resolution, and bundled/global/workspace precedence belong to the OpenClaw adapter, not the portable core.
6. **Lifecycle timing is native.** OpenClaw's bounded five-second terminal-event wait is a host implementation policy. Portable state cleanup should preserve the terminal-state invariant without promising identical timing on other hosts.

## Implemented Doppelganger boundary

The implemented adapter chose an in-process direct Composition Runtime rather than the earlier sidecar candidate. A generated artifact freezes concrete `dg_...` names and descriptor contracts before native installation. Runtime registration remains synchronous; `before_model_resolve` performs bounded warmup, `before_prompt_build` projects correlated context, and a synchronous factory exposes only ready prepared tools. `before_tool_call` records the exact binding, native call ID, optional run ID, names, revision, and catalog generation for every declared tool; dispatch consumes that correlation once. Ordinary tools may use valid final arguments changed by native middleware, while approval-required tools additionally need genuine `allow-once` and exact final-input digest equality.

The adapter does not use OpenClaw's privileged gateway, subagent, node, sandbox, worktree, provider, control-UI, session-extension, trusted-policy, or arbitrary registry surfaces. Runtime catalog changes can withdraw or refresh compatible declared descriptors but cannot add names. New names, incompatible contracts, or arbitrary generated Runtime Plugin tools require regenerated artifacts and native restart. Standard lifecycle capabilities are empty, so the integration provides no automatic committed-turn capture.

Actor custody is explicit configuration: a native `(agentId, sessionKey, workspaceRoot)` route maps to one actor ID, and every unmatched route is unbound. External harness, background/group principal inference, locked-model warmup bypass, context-engine takeover, and unrestricted mid-loop catalog replacement remain outside the supported profile. See [OpenClaw](../../hosts/openclaw.md) for the operational contract.

## Source evidence

All paths are repository-relative to the snapshot above. Line spans were directly checked in the assigned checkout.

| Claim | Path | Symbol | Lines |
|---|---|---|---|
| Discovery resolves source roots, caches a stable-keyed result, scans configured/workspace locations, then scans bundled and global locations. | `src/plugins/discovery.ts` | `discoverOpenClawPlugins` | 1324-1462 |
| Manifest loading reuses a gateway metadata snapshot for ordinary readers and otherwise invokes discovery. | `src/plugins/manifest-registry.ts` | `loadPluginManifestRegistryCore` | 843-887 |
| Non-bundled manifests are rejected when their minimum host version or plugin API range is incompatible. | `src/plugins/manifest-registry.ts` | `loadPluginManifestRegistryCore` | 961-1016 |
| Duplicate plugin identities are resolved by candidate precedence with a diagnostic for an overridden plugin. | `src/plugins/manifest-registry.ts` | `loadPluginManifestRegistryCore` | 1057-1139 |
| Runtime/module materialization is lazy before registry creation, and gateway subagent/node facilities are borrowed only when enabled. | `src/plugins/loader-runtime-load.ts` | `loadOpenClawPluginsInternal` | 116-161 |
| Registration wraps the API, rejects promise-returning `register` functions, and closes normal API methods immediately afterward. | `src/plugins/loader-module-runtime.ts` | `createGuardedPluginRegistrationApi`, `runPluginRegisterSync` | 47-102 |
| A plugin tool requires declared contract names and rejects undeclared tool names. | `src/plugins/registry-registrars-tools-hooks.ts` | `registerTool` | 212-242 |
| Tool-result middleware requires a declared runtime contract and explicit enablement for installed plugins. | `src/plugins/registry-registrars-tools-hooks.ts` | `registerAgentToolResultMiddleware` | 134-209 |
| Typed hook registration blocks prompt injection and conversation access according to per-plugin policy and origin. | `src/plugins/registry-registrars-tools-hooks.ts` | `registerTypedHook` | 361-428 |
| Prompt injection is the explicit set of turn-prepare, prompt-build, and heartbeat-contribution hooks. | `src/plugins/hook-types.ts` | `PROMPT_INJECTION_HOOK_NAMES`, `isPromptInjectionHookName` | 217-243 |
| The prompt builder runs modifiers before prompt submission; the authorized lane receives a finalized tool authority and returns context fields. | `src/plugins/hooks.ts` | `runBeforePromptBuild`, `runAuthorizedPromptBuild`, `runAgentTurnPrepare` | 1060-1161 |
| Prompt injection defaults on unless disabled; non-bundled conversation access requires explicit opt-in. | `src/plugins/hook-policy-decisions.ts` | `resolvePromptInjectionAllowed`, `resolveConversationAccessAllowed` | 6-17 |
| Session extensions require namespace/description, require synchronous projectors, and reject duplicate namespaces or slots. | `src/plugins/registry-registrars-host.ts` | `registerSessionExtension` | 114-184 |
| Trusted tool policies require a declaration and explicit enablement for non-bundled plugins, with bundled policies ordered first. | `src/plugins/registry-registrars-host.ts` | `registerTrustedToolPolicy` | 186-253 |
| Control UI descriptors validate native routes, JSON-compatible schemas, required scopes, and gateway-local absolute paths. | `src/plugins/registry-registrars-host.ts` | `registerControlUiDescriptor` | 313-406 |
| Runtime lifecycle and agent-event registrations are validated and deduplicated. | `src/plugins/registry-registrars-host.ts` | `registerRuntimeLifecycle`, `registerAgentEventSubscription` | 408-471 |
| Session actions validate handler, JSON Schema, and required operator scopes before registration. | `src/plugins/registry-registrars-host.ts` | `registerSessionAction` | 538-588 |
| The public contracts define session projection, policy evaluation, UI descriptors, actions, lifecycle callbacks, and event subscriptions. | `src/plugins/host-hooks.ts` | `PluginSessionExtensionRegistration` through `PluginAgentEventSubscriptionRegistration` | 29-203 |
| Run context is namespaced by run/plugin/namespace, only accepts JSON-compatible values, and clones on writes and reads. | `src/plugins/host-hook-runtime.ts` | `setPluginRunContext`, `getPluginRunContext` | 149-225 |
| Terminal lifecycle events close the run, await pending handlers with a bounded timeout, and clear run context. | `src/plugins/host-hook-runtime.ts` | `dispatchPluginAgentEventSubscriptions`, `waitForTerminalEventHandlers` | 111-147, 277-365 |
| Reload policy distinguishes restart, hot, and no-op configuration prefixes. | `src/plugins/plugin-registration.types.ts` | `OpenClawPluginReloadRegistration` | 195-199 |
| Empty reload declarations are warned about during registration. | `src/plugins/registry-registrars-operations.ts` | `registerReload` | 198-218 |
| Gateway metadata requires complete startup inventory and cannot be replaced until shutdown; a CLI snapshot will not displace an existing owner. | `src/plugins/current-plugin-metadata-snapshot.ts` | `setGatewayPluginMetadataSnapshot`, `adoptCurrentPluginMetadataSnapshotIfAbsent` | 166-198 |
| Metadata lifecycle cleanup preserves a live gateway-owned snapshot and otherwise clears snapshot, cache, and registered memos. | `src/plugins/plugin-metadata-lifecycle.ts` | `retainGatewayPluginMetadata`, `clearPluginMetadataLifecycleCaches` | 15-44 |
| Candidate registration invokes global-side-effect rollback on an error. | `src/plugins/loader-runtime-candidate.ts` | `loadRuntimePluginCandidate` | 538-566 |
| A later load/activation failure rolls back loaded inactive plugins in reverse order and does not strip the active registry. | `src/plugins/loader-runtime-load.ts` | `loadOpenClawPluginsInternal` | 293-311 |
| The trusted in-process runtime exposes gateway requests/scopes, subagent operations, node operations, and sandbox workspace authority. | `src/plugins/runtime/types.ts` | `PluginRuntime`, `RuntimeGatewayRequestOptions` | 118-182 |
