# OpenCode host extension surface

## Snapshot

| Field | Value |
|---|---|
| Repository URL | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| Exact commit | `68abdce1a092e6302e99c2821a76071ee998d8f2` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

This is static source research. The checkout reports the requested commit at `HEAD`; no claim here implies that the code was run as a host extension.

## Native extension model

OpenCode has two server-side plugin generations. The v2 Effect model defines a plugin as an ID plus an Effect whose context is supplied by the host (`packages/plugin/src/v2/effect/plugin.ts:4-11`). The Promise model is the corresponding ID plus synchronous-or-async `setup` function (`packages/plugin/src/v2/promise/plugin.ts:3-10`). Both expose a `plugin` domain that can add and remove plugins (`packages/plugin/src/v2/effect/plugin.ts:13-16`; `packages/plugin/src/v2/promise/plugin.ts:12-15`).

The v2 Effect context is deliberately a domain façade: options, agent, AISDK, catalog, command, integration, plugin, reference, and skill (`packages/plugin/src/v2/effect/context.ts:12-22`). Registration is scoped: each hook callback returns a registration with a `dispose` Effect and requires `Scope.Scope` (`packages/plugin/src/v2/effect/registration.ts:3-14`). Several mutable domains additionally expose `reload` (the host supplies the concrete mutable draft and reload functions).

The legacy API remains a broad compatibility surface. A legacy plugin receives an SDK client, project, directory, worktree, experimental workspace registration, server URL, and Bun shell (`packages/plugin/src/index.ts:56-66`), then returns hooks from a Promise (`packages/plugin/src/index.ts:68-80`). Its hooks include disposal, events/config, tools, auth/provider, chat message/parameters/headers, permission, command and tool before/after, shell environment, message/system transforms, small-model selection, compaction, autocontinue, text completion, and tool-definition mutation (`packages/plugin/src/index.ts:222-335`). This is more host/provider-specific than the v2 domain model and should be treated as a legacy compatibility adapter rather than the portable core contract.

## Configuration and plugin discovery

Config exposes `entries()`, documented as location documents and supplemental directories from lowest to highest priority (`packages/core/src/config.ts:128-133`). The service recognizes `opencode.json` and `opencode.jsonc` (`packages/core/src/config.ts:137-145`), loads each location once, and explicitly reuses the discovered values until the location is reopened (`packages/core/src/config.ts:173-177`). It searches global config, project/direct files, and `.opencode` directories, then orders general settings before more specific settings (`packages/core/src/config.ts:186-205`).

The internal boot plugin batches built-in and config plugins in a fixed order and forks the batch into the location scope (`packages/core/src/plugin/internal.ts:63-79`, `108-123`). External discovery reads configured plugin entries from document config, resolves `file://`, relative, and package references, and scans `{plugin,plugins}/*.{ts,js}` in directory entries (`packages/core/src/config/plugin/external.ts:39-71`). It imports/decodes each package as either Effect v2 or Promise v2, wraps Promise plugins, adds it to the v2 registry, passes per-entry options, and ignores a failed individual load (`packages/core/src/config/plugin/external.ts:73-89`).

## Context and host façade

The host constructs the v2 context by obtaining core services and returning mutable façade operations (`packages/core/src/plugin/host.ts:20-30`). Agent transforms can list/get/default/update/remove agent records (`packages/core/src/plugin/host.ts:31-41`); catalog transforms can update/remove providers and models and set the default model (`packages/core/src/plugin/host.ts:72-97`). Command is a transform plus reload (`packages/core/src/plugin/host.ts:99-102`).

Integration is a reloadable transform domain with connection resolution and mutable integration/method records; OAuth credentials are schema-normalized at the boundary (`packages/core/src/plugin/host.ts:103-111`, `112-191`). Reference and skill expose reloadable transform façades (`packages/core/src/plugin/host.ts:197-217`). AISDK has SDK and language hooks whose callback mutations are copied back to the host event (`packages/core/src/plugin/host.ts:44-70`). The plugin façade itself forwards add/remove to the runtime registry (`packages/core/src/plugin/host.ts:193-196`). This is a host-owned service mapping, not a general-purpose arbitrary dependency injection surface.

## Add, remove, wait, scopes, and reload

The v2 runtime owns one parent scope, active child scopes by plugin ID, loading IDs, waiters, and failure exits (`packages/core/src/plugin.ts:31-41`). `add` serializes by keyed plugin lock, closes an existing child, forks a replacement scope, runs the effect against the host, closes failed children, publishes `Event.Added`, records the active child, and resolves waiters (`packages/core/src/plugin.ts:43-70`). A load cycle is a defect; failure is retained and delivered to waiters (`packages/core/src/plugin.ts:43-44`, `73-80`).

`remove` rejects removal during loading, closes and clears the active child, and clears its failure (`packages/core/src/plugin.ts:85-98`). `wait` returns for an active plugin, propagates a remembered failure, or waits on a per-ID deferred until add succeeds/fails; waiter cleanup is serialized and guaranteed (`packages/core/src/plugin.ts:100-126`). Runtime finalization clears active state and closes the parent scope (`packages/core/src/plugin.ts:128-141`). Thus registrations are naturally disposed with the plugin child scope, while a successful add replaces the prior generation.

The v2 façade's reload methods are host-domain operations, not plugin-manager replacement by themselves: for example agent, catalog, command, integration, reference, and skill expose `reload` alongside transforms (`packages/plugin/src/v2/effect/context.ts:14-21`; `packages/core/src/plugin/host.ts:31-43`, `72-102`, `103-217`). Config itself is a location-open snapshot, so config/plugin discovery changes take effect through location reopen/reload rather than each `entries()` call rereading files (`packages/core/src/config.ts:173-177`, `213-217`).

## Tools, registry, and stale calls

The v2 tool registry exposes scoped `register` and policy-filtered `materialize`; materialization returns definitions and a settlement function (`packages/core/src/tool/registry.ts:23-32`). Registrations are stacked per tool name, carry a scope finalizer token, and remove only that scope's entries on disposal (`packages/core/src/tool/registry.ts:84-105`). Materialization overlays application tools with the latest local registration and removes wholly disabled tools under permission rules (`packages/core/src/tool/registry.ts:106-121`).

Settlement resolves the latest registration, distinguishes unknown from stale calls, and rejects a call whose captured registration identity no longer matches the materialized identity (`packages/core/src/tool/registry.ts:50-61`). It converts LLM tool failures to error results and bounds output before returning it (`packages/core/src/tool/registry.ts:62-81`). This identity check is the important reload boundary: an old advertised tool cannot silently invoke a replacement.

The current runner records tool calls durably, authorizes and executes local calls through the registry, waits for settlements, and starts continuation turns (`packages/core/src/session/runner/llm.ts:69-77`). The source comments also identify MCP, plugin, and structured-output definition resolution as an unfinished item in this slice (`packages/core/src/session/runner/llm.ts:60-64`); therefore MCP/plugin tool parity must not be inferred beyond the registry contracts observed here.

## Approval and permission

Permission evaluation uses last matching wildcard rule and defaults to `ask` (`packages/core/src/permission.ts:76-85`). The service provides `ask`, blocking `assert`, `reply`, lookup, session filtering, and listing (`packages/core/src/permission.ts:92-101`). An ask evaluates configured plus saved rules, creates a pending request only for `ask`, publishes `Event.Asked`, and returns the request ID/effect (`packages/core/src/permission.ts:155-195`).

An assertion denies immediately for deny, succeeds for allow, or waits on a deferred request; rejection becomes a declined/corrected error and pending state is cleaned up (`packages/core/src/permission.ts:197-218`). Reply publishes `Event.Replied`, rejects or resolves the deferred, can save an `always` rule, and may release other pending requests made allow-by-save (`packages/core/src/permission.ts:220-283`). Pending requests are in-memory and all are declined during service finalization (`packages/core/src/permission.ts:117-129`).

## Durable/live events and session lifecycle

The event service separates typed/all live streams from aggregate-scoped durable streams. Its interface includes publish, subscribe, all, durable-after-sequence, legacy listen, projectors, replay, replay-all, remove, and claim (`packages/core/src/event.ts:118-150`). Durable publication can run a local projection commit atomically with the durable event (`packages/core/src/event.ts:118-124`). Durable subscription first reads history after an optional sequence, then follows wakeups and rereads, concatenating historical and live events (`packages/core/src/event.ts:565-603`). This is a suitable replayable lifecycle backbone; `listen` is explicitly deprecated (`packages/core/src/event.ts:134-137`).

Session input admits a prompt idempotently: an existing input is returned, otherwise a durable `PromptAdmitted` event creates the admitted record with its aggregate sequence (`packages/core/src/session/input.ts:41-80`). Projection uses conflict checks and on-conflict behavior to prevent an ID from changing lifecycle meaning (`packages/core/src/session/input.ts:83-116`, `118-168`). Steers are promoted in admitted-sequence order up to a cutoff, while queued prompts promote one oldest row (`packages/core/src/session/input.ts:245-288`).

The session projector subscribes event types into durable session/message/part tables (`packages/core/src/session/projector.ts:210-234`, `260-321`). Its updater chooses the newest incomplete assistant projection and updates or appends canonical messages, preventing stale incomplete assistant rows from being resumed (`packages/core/src/session/projector.ts:111-189`). Canonical message/part schema is therefore the boundary an adapter should observe, not transient UI state.

Before a provider turn, the runner loads services for event, tools, model, session store, system context, guidance, config, snapshots, and compaction (`packages/core/src/session/runner/llm.ts:93-114`). It settles non-provider tool calls, publishes tool results, waits all tool fibers, handles interruption/failure, and emits step completion with snapshots/tokens (`packages/core/src/session/runner/llm.ts:250-340`).

A session context epoch initializes a baseline/snapshot, prepares by reconciling or replacing stored context, and emits a durable `ContextUpdated` with an atomic snapshot advance when context changes (`packages/core/src/session/context-epoch.ts:23-37`, `40-78`). Epoch replacement is tied to compaction sequence; unchanged or blocked reconciliation retains the stored baseline (`packages/core/src/session/context-epoch.ts:56-77`).

## Scope, state, trust, and exclusions

Plugin state is primarily scope-local: child scopes own registrations and are closed on replacement/removal, while config discovery is location-scoped and snapshot-like. Durable session state is event/table-backed; pending permission and active plugin maps are live runtime state. The host supplies IDs, schemas, and domain-specific mutation methods, reducing the portable adapter's need to understand provider internals.

TUI is an optional, host-specific legacy surface, importing OpenTUI renderer/keymap/Solid types and SDK v2 UI types (`packages/plugin/src/tui.ts:1-31`). Its API includes routes, keymaps, modes, commands, dialogs, prompts, toasts, and attention/soundboard controls (`packages/plugin/src/tui.ts:53-84`, `86-120`, `122-231`, `233-301`). It should remain outside a portable Doppelganger core adapter. MCP is likewise configuration/transport-specific: v2 config has server records under `mcp`, including local commands/cwd/environment and remote URL/headers (`packages/core/src/config/mcp.ts:15-21`, `34-48`), but the runner source explicitly marks MCP tool resolution unfinished (`packages/core/src/session/runner/llm.ts:60-64`). Neither TUI nor MCP is evidence of implemented Doppelganger support.

Trust is implicit in the host's config/package loading and permission policy rather than exposed as a portable plugin trust algebra. External plugin import failures are contained per package (`packages/core/src/config/plugin/external.ts:73-89`), but successfully loaded code receives powerful host façades and the legacy Bun shell (`packages/plugin/src/index.ts:56-66`). A Doppelganger adapter should therefore keep host-specific package policy, UI, MCP process/transport, and legacy provider hooks at the edge.

## Doppelganger adapter fit

**Observed fit.** The strongest portable mapping is one adapter host façade for reloadable domain mutation, one scoped registration primitive, one durable/live event stream, one session input/projector lifecycle, one tool registry with registration identity, and one permission ask/assert/reply primitive. OpenCode's v2 Effect model already provides the shape needed for safe child-scope teardown and stale-call rejection.

**Recommendation.** Map portable context, tools, approvals, and lifecycle to the domain/event/session seams above. Keep TUI, MCP configuration and transport, Bun shell, workspace adapters, provider auth/model hooks, and legacy chat hooks in an optional OpenCode edge adapter. Do not place OpenCode's mutable catalog/integration/provider details in portable core metadata. The recommendation is an architectural inference from the observed seams, not a claim that Doppelganger support exists.

**Planning decision (2026-09-04).** Native OpenCode host implementation is deferred until the public OpenCode 2.0 plugin surface stabilizes the seams required by the shared Runtime Host contract: scoped dynamic tool registration with exact replacement and removal, plugin readiness before the first model request, exact-call required approval, and committed session and turn lifecycle observations. Doppelganger will not add kernel, bridge, bootstrap-session, generic-dispatch-tool, or `extension-mcp` workarounds for limitations in the host API.

## Compatibility gaps

- OpenCode's v2 plugin context has no portable Doppelganger context/turn projection contract; an adapter must define stable principal, session, turn, and context-epoch identities.
- OpenCode's permission service is session/agent policy based and keeps pending requests in memory; it does not supply a portable approval descriptor or cross-process durable approval ledger.
- Tool materialization provides stale identity checks, but no portable tool-name namespace, descriptor revision, or host-neutral schema/approval projection is specified.
- Config is read once per location and external plugin loading is forked/contained; there is no observed transactional candidate-generation protocol that coordinates all adapter projections with reload rollback.
- Event durability is aggregate-oriented and has replay/claim ownership, but no observed portable lifecycle event vocabulary or exactly-once host notification contract.
- Session input and projector semantics are OpenCode-specific; an adapter needs explicit lowering from portable prompt/context/lifecycle events into canonical OpenCode messages and parts.
- The runner source still lists MCP/plugin tool-definition resolution as unchecked, so MCP and plugin tool behavior cannot be treated as complete compatibility evidence.
- TUI and legacy hooks expose UI, shell, provider, and SDK-specific capabilities that must remain optional and must not leak into a portable core recommendation.

## Source evidence

| Claim | Path | Symbol | Lines |
|---|---|---|---:|
| Effect v2 plugin is ID plus scoped Effect | `packages/plugin/src/v2/effect/plugin.ts` | `Plugin` | 4-11 |
| Effect plugin domain adds/removes plugins | `packages/plugin/src/v2/effect/plugin.ts` | `PluginDomain` | 13-16 |
| Promise v2 setup model | `packages/plugin/src/v2/promise/plugin.ts` | `Plugin` | 3-10 |
| Scoped registration has dispose and Scope requirement | `packages/plugin/src/v2/effect/registration.ts` | `Registration`, `Hooks` | 3-14 |
| v2 context domains | `packages/plugin/src/v2/effect/context.ts` | `PluginContext` | 12-22 |
| Legacy input carries client/project/worktree/shell | `packages/plugin/src/index.ts` | `PluginInput` | 56-66 |
| Legacy plugin returns hooks | `packages/plugin/src/index.ts` | `Plugin`, `PluginModule` | 68-80 |
| Legacy hook names and signatures | `packages/plugin/src/index.ts` | `Hooks` | 222-335 |
| Config names and decode policy | `packages/core/src/config.ts` | `layer` | 137-162 |
| Config snapshot is reused until reopen | `packages/core/src/config.ts` | `layer` | 173-177 |
| Config precedence ordering | `packages/core/src/config.ts` | `layer` | 186-205 |
| External plugin config and directory scan | `packages/core/src/config/plugin/external.ts` | `ConfigExternalPlugin.Plugin` | 39-71 |
| External Effect/Promise load and containment | `packages/core/src/config/plugin/external.ts` | `ConfigExternalPlugin.Plugin` | 73-89 |
| Internal boot ordering and batch | `packages/core/src/plugin/internal.ts` | `layer` | 63-79,108-123 |
| Plugin active/loading/wait/failure state | `packages/core/src/plugin.ts` | `layer` | 31-41 |
| Add closes/replaces scope and resolves waiters | `packages/core/src/plugin.ts` | `add` | 43-70 |
| Remove closes plugin scope | `packages/core/src/plugin.ts` | `remove` | 85-98 |
| Wait propagates failure or awaits add | `packages/core/src/plugin.ts` | `wait` | 100-126 |
| Host maps agent/catalog domains | `packages/core/src/plugin/host.ts` | `make` | 31-41,72-97 |
| Host maps integration/reference/skill reload façades | `packages/core/src/plugin/host.ts` | `make` | 103-217 |
| Tool registry registration/materialization contract | `packages/core/src/tool/registry.ts` | `Interface`, `Materialization` | 23-32 |
| Tool scope finalizer removes registrations | `packages/core/src/tool/registry.ts` | `register` | 84-105 |
| Stale tool call identity rejection | `packages/core/src/tool/registry.ts` | `settleWith` | 50-81 |
| Permission ask/assert/reply interface | `packages/core/src/permission.ts` | `Interface` | 92-101 |
| Permission ask queues pending request | `packages/core/src/permission.ts` | `ask`, `create` | 164-195 |
| Permission assert waits and cleans up | `packages/core/src/permission.ts` | `assert` | 197-218 |
| Permission reply saves and releases requests | `packages/core/src/permission.ts` | `reply` | 220-283 |
| Event durable/live API | `packages/core/src/event.ts` | `Interface` | 118-150 |
| Durable stream replay then live wakeups | `packages/core/src/event.ts` | `durable` | 565-603 |
| Prompt admission is idempotent and durable | `packages/core/src/session/input.ts` | `admit` | 41-80 |
| Prompt projection detects lifecycle conflicts | `packages/core/src/session/input.ts` | `projectAdmitted`, `projectPrompted` | 83-168 |
| Session projector persists events | `packages/core/src/session/projector.ts` | `layer` | 210-234,260-321 |
| Projector avoids stale incomplete assistant | `packages/core/src/session/projector.ts` | `getCurrentAssistant` | 131-149 |
| Runner wires tools/context/events | `packages/core/src/session/runner/llm.ts` | `layer` | 93-114 |
| Runner settles tools and emits step completion | `packages/core/src/session/runner/llm.ts` | provider stream settlement | 250-340 |
| Context epoch reconcile/replace/update | `packages/core/src/session/context-epoch.ts` | `prepareOnce` | 40-78 |
| TUI surface is OpenTUI-specific | `packages/plugin/src/tui.ts` | TUI exports/types | 1-31,53-120 |
| MCP config has local/remote server forms | `packages/core/src/config/mcp.ts` | `Local`, `Remote`, `Info` | 15-21,34-48 |
| MCP/plugin tool resolution is unfinished | `packages/core/src/session/runner/llm.ts` | orchestration checklist | 60-64 |
