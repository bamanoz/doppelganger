# Pi host extension surface

## Snapshot

| Field | Value |
|---|---|
| Repository | [earendil-works/pi](https://github.com/earendil-works/pi) |
| Exact commit | `4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

This record is a static source review of the checkout at the commit above. It describes observed Pi APIs and separates adapter recommendations from those observations.

## Native extension model

Pi's `packages/coding-agent` loads TypeScript or JavaScript extension modules. An extension exports a default synchronous or asynchronous factory receiving `ExtensionAPI`; Pi awaits an async factory before startup continues. The API combines lifecycle event subscriptions, LLM-callable tools, commands/shortcuts/flags, provider registration, session operations, persistence, and interactive UI.

Discovery covers global `~/.pi/agent/extensions` and project-local `.pi/extensions` (direct `.ts`/`.js` files or one-level directories with `index.ts`/`index.js` or a `package.json` `pi.extensions` manifest), plus explicitly configured paths. The loader de-duplicates resolved paths. Extensions execute with full system permissions; Pi's documentation explicitly advises installing only trusted sources and using a container or sandbox when stronger boundaries are needed.

Project-local extensions are trust-gated: user/global and CLI extensions can participate in `project_trust` before project resources load, while local extensions are loaded only after trust is resolved. The trust handler may return yes/no/undecided and optionally persist the decision. This is a host policy gate, not a sandbox for an already-loaded extension.

## Context and prompt transformation

The event pipeline exposes `before_agent_start` after prompt submission and before the agent loop. A handler can inspect the expanded prompt, attached images, current system prompt and structured system-prompt options, then return a persistent custom message and/or a replacement system prompt. The structured options include selected tools, snippets, guidelines, working directory, context files, and skills.

During each turn, `context` receives the current agent messages and handlers chain replacements in extension load order. The runner clones the incoming messages before applying handlers. `before_provider_request` similarly chains replacement payloads: each defined return value becomes the payload for the next handler. `before_provider_headers` is an in-place header mutation hook. These are per-request interception points suitable for an adapter's context and provider transforms, subject to Pi's payload types and provider protocol.

## Tools

`registerTool()` registers a schema-described tool callable by the LLM. Registration works during load and after startup; post-start registration refreshes the tool registry immediately and does not require `/reload`. `setActiveTools()` controls the active subset by registered name. Pi supports additive dynamic activation: newly active tools are recorded on the loader tool result and exposed before the next model request, using provider-native deferred loading where supported or the complete active list as fallback. Tool removal or non-additive replacement falls back to ordinary active-list transmission.

The `tool_call` event runs after tool execution starts but before execution and can mutate arguments in place or block with a reason (and optionally terminate). Handlers run in extension order, and later handlers see prior mutations; Pi does not revalidate after mutation. `tool_result` runs after execution and can return partial patches to content, details, error state, or usage. This gives an adapter both approval/preflight and post-execution observation or normalization seams.

## Approval and user interaction

`ExtensionUIContext` supplies `select`, `confirm`, `input`, `editor`, `custom`, `notify`, status/widget/header/footer controls, and editor interaction. Dialogs are asynchronous and can receive an abort signal or timeout; timeout returns undefined for selection/input and false for confirmation. The `tool_call` hook can therefore implement an approval gate by calling `ctx.ui.confirm()` and returning `{ block: true, reason }` on denial.

The runner wraps select/confirm/input/editor/custom calls and emits `ui_prompt_start` and `ui_prompt_end` around the outermost prompt. UI availability is mode-dependent: interactive mode has UI, while print/RPC modes provide their own implementation or no-op behavior. An adapter should preserve this distinction rather than assuming an interactive prompt is always possible.

## Lifecycle

The documented event sequence includes `project_trust`, `session_start`, and `resources_discover` at startup; prompt/agent and turn events; provider request hooks; tool execution hooks; `agent_end`; and `agent_settled` once retries, compaction, and follow-ups are complete. Session replacement emits cancellable `session_before_switch` or `session_before_fork`, then `session_shutdown`, reload/rebind, and a fresh `session_start` with a reason of `new`, `resume`, or `fork`. `session_shutdown` is the cleanup boundary for resources started by session hooks.

`reload()` reloads extensions, skills, prompts, themes, and context files. In the observed implementation it emits shutdown, invalidates the old runner, reloads settings/resources, rebuilds runtime state while preserving flag values and active tool names, then emits `session_start { reason: "reload" }` and resource discovery. Captured extension contexts become stale after replacement or reload; post-replacement work must use the `withSession` context supplied by new-session, fork, or switch-session operations, and old context must not be used after reload.

## Scope, state, reload, and trust

Extension discovery has global, project-local, and explicit-path scope. Provider and tool registrations belong to the loaded extension runtime and are merged into Pi's runtime registries. Pi has no observed first-class native subagent extension API in this checkout; the repository exposes agent core and coding-agent packages, but static review found no subagent-host registration or lifecycle seam.

For durable state, `appendEntry(customType, data)` writes a custom session entry that is not sent to the LLM. Extensions reconstruct state in `session_start` by reading session entries (or tool-result `details` when state must follow conversation branching). `sendMessage()` instead creates a custom message that participates in LLM context, and `sendUserMessage()` creates an actual user message. This distinction should map to separate adapter operations rather than a single generic state channel.

Provider registration accepts either a complete native provider or a named provider configuration. Registration during initial loading is queued and flushed before startup; after initial load, registration and unregistration take effect immediately without `/reload`. Provider definitions can add models, override endpoints/headers, provide authentication, or implement custom streaming APIs. These provider and UI details are host-specific and should remain outside a portable core contract.

Trust decisions are resolved by override, extension `project_trust` handlers, saved trust-store decisions, and the configured/default trust flow. If no UI is available, the trust resolver declines rather than prompting. The trust boundary permits project settings/resources, package installation, and execution of project extensions; Pi's README points to external containerization/sandbox patterns for stronger isolation.

## Doppelganger adapter fit

An OMP-like sidecar adapter is the best fit based on the observed Pi surface. The sidecar should load as a normal Pi extension and translate Pi events into a portable host bridge: `pi.on` for lifecycle and request events; `registerTool`, `setActiveTools`, `tool_call`, and `tool_result` for tool discovery, activation, approval, and results; `context`, `before_agent_start`, `before_provider_request`, and `before_provider_headers` for context/provider transforms; `ctx.ui` plus `ui_prompt_start`/`ui_prompt_end` for approval and user interaction; and session events plus `appendEntry` for lifecycle rebinding and durable state.

The adapter must treat extension contexts as session-scoped capabilities. It should unregister/close resources at `session_shutdown`, rebuild volatile state at `session_start`, and use `withSession` after new/fork/switch operations. It should expose Pi's trust result as a gate before project-local behavior and avoid interpreting Pi's full-permission extension model as a sandbox guarantee.

The recommendation is specifically an adapter around Pi's observed extension API, not a claim that Pi natively supports Doppelganger. Portable core recommendations should not depend on Pi's TUI widgets, dialog rendering, provider packaging, provider-native deferred-loading protocols, or package-manager conventions; those belong in the host adapter.

## Compatibility gaps

- No first-class native subagent registration, delegation, or subagent lifecycle API was found; an adapter cannot claim native subagent support.
- Pi extensions run with full system permissions, and the observed documentation does not define a plugin sandbox. Isolation requires a separately configured container or sandbox.
- Extension contexts and command contexts are invalidated on session replacement and reload, so long-lived integrations cannot safely retain host objects across those boundaries.
- `before_provider_request` receives an `unknown` payload and `before_provider_headers` relies on in-place mutation; an adapter must bind to each provider protocol rather than assume a uniform request object.
- Tool argument mutation is not revalidated after `tool_call`; an adapter that changes schemas or safety-sensitive values must perform its own validation.
- UI is mode-dependent and may be a no-op outside interactive operation; approval policy needs an explicit non-interactive behavior.
- Dynamic tool loading has provider-specific deferred-loading optimizations and a full-list fallback; portable contracts should not require Pi's native tool-reference representations.
- Provider registration is Pi-specific and can override built-ins, add models, and provide auth/streaming. Portable core must not absorb those provider configuration and packaging semantics.
- Persistent custom entries are session storage, not LLM context; integrations must intentionally choose `appendEntry`, `sendMessage`, or `sendUserMessage`.

## Source evidence

Source paths below are repository-relative code or documentation spans in the reviewed Pi checkout. The repository is identified once in the Snapshot table above.

| Claim | Path | Symbol | Lines |
|---|---|---|---:|
| Extensions are TS modules with events, tools, UI, and persistence capabilities | `packages/coding-agent/docs/extensions.md` | Extensions overview | 3-16 |
| Auto-discovery locations and explicit `-e` loading are documented | `packages/coding-agent/docs/extensions.md` | Extension placement | 5-7, 109-137 |
| Extensions have full system permissions and project-local trust gating | `packages/coding-agent/docs/extensions.md` | Security / Extension Locations | 111-119 |
| Async factories finish before startup, resources, and provider flush | `packages/coding-agent/docs/extensions.md` | Async factory functions | 154-181 |
| Discovery resolves manifests/index files and limits recursion | `packages/coding-agent/src/core/extensions/loader.ts` | `resolveExtensionEntries`, `discoverExtensionsInDir` | 670-719 |
| Standard discovery order is local, global, then configured paths | `packages/coding-agent/src/core/extensions/loader.ts` | `discoverAndLoadExtensions` | 758-805 |
| Startup/session/resource event ordering is explicit | `packages/coding-agent/docs/extensions.md` | Lifecycle Overview | 273-349 |
| Trust handlers can decide, defer, and remember decisions | `packages/coding-agent/docs/extensions.md` | `project_trust` | 351-368 |
| Session replacement performs shutdown and rebinds extensions | `packages/coding-agent/docs/extensions.md` | `session_before_switch`, `session_before_fork` | 416-450 |
| Session shutdown is the cleanup boundary | `packages/coding-agent/docs/extensions.md` | `session_shutdown` | 516-525 |
| Before-agent hook can inject a message or replace system prompt | `packages/coding-agent/docs/extensions.md` | `before_agent_start` | 528-560 |
| API declares request, header, and agent-start interception events | `packages/coding-agent/src/core/extensions/types.ts` | `ExtensionAPI.on` overloads | 1252-1284 |
| Context transforms chain cloned messages | `packages/coding-agent/src/core/extensions/runner.ts` | `emitContext` | 1034-1064 |
| Provider payload transforms chain replacement values | `packages/coding-agent/src/core/extensions/runner.ts` | `emitBeforeProviderRequest` | 1066-1098 |
| Provider header transforms mutate headers in place | `packages/coding-agent/src/core/extensions/runner.ts` | `emitBeforeProviderHeaders` | 1100-1128 |
| Tool calls can mutate inputs or block before execution | `packages/coding-agent/docs/extensions.md` | `tool_call` | 776-817 |
| Tool results can be patched after execution | `packages/coding-agent/docs/extensions.md` | `tool_result` | 842-875 |
| Tools register immediately and active sets can change without reload | `packages/coding-agent/docs/extensions.md` | `pi.registerTool` | 1361-1377 |
| Additive dynamic tool activation is applied before the next model request | `packages/coding-agent/docs/extensions.md` | Dynamic Tool Loading | 2365-2398 |
| UI dialogs and notifications are available, with timeout semantics | `packages/coding-agent/docs/extensions.md` | Dialogs | 2502-2558 |
| UI prompts emit start/end events around outermost prompt | `packages/coding-agent/src/core/extensions/runner.ts` | `wrapUIPrompt`, `withUIPrompt` | 441-486 |
| Session replacement/reload contexts expose operations and stale invalidation | `packages/coding-agent/src/core/extensions/types.ts` | `ExtensionCommandContext`, `ReplacedSessionContext` | 362-396 |
| Runtime explicitly invalidates contexts after replacement/reload | `packages/coding-agent/src/core/extensions/runner.ts` | `invalidate` | 593-595 |
| Custom entries persist outside LLM context and can be restored at session start | `packages/coding-agent/docs/extensions.md` | `appendEntry`, State Management | 1471-1487, 1879-1910 |
| Provider registration supports native/config forms and immediate mutation | `packages/coding-agent/src/core/extensions/types.ts` | `registerProvider`, `unregisterProvider` | 1486-1502 |
| Provider changes after initial load do not require reload | `packages/coding-agent/src/core/extensions/runner.ts` | provider runtime binding | 356-394 |
| Session reload tears down, rebuilds, and emits fresh lifecycle/resource events | `packages/coding-agent/src/core/agent-session.ts` | `reload` | 2810-2835 |
| Pi product scope exposes agent core and coding-agent, with no native subagent seam observed | `README.md` | package overview | 15-18 |
