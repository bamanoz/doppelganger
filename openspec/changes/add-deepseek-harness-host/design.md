## Context

Doppelganger currently has one concrete host, OMP. OMP cannot share its Cordis process with the runtime, so `packages/host-omp` uses a Node child and framed JSON-RPC. DeepSeek Harness already owns the compatible Cordis root, Loader family, agent scopes, system-prompt registry, native tool pipeline, append-only Session log, and quiescent agent teardown. A native DSH adapter should therefore run in-process and reuse those host APIs instead of reusing the OMP transport.

The research gate was revalidated against DeepSeek Harness commit `4e84901e6471b79ec0338099867ebb4606d12bb5` on September 3, 2026. The relevant source contracts are:

- `apps/cli/src/profile-boot.ts`, `packages/boot/app-boot/src/index.ts`, and `apps/cli/src/process-shutdown.ts`: one root Cordis Context, Loader activation audit, and bounded process shutdown.
- `vendor/loader/src/config/{entry,group,tree}.ts`, `vendor/include/src/index.ts`, and `vendor/cordis/src/fiber.ts`: serialized Include mutation, Loader-owned rollback, Fiber settlement, and quiescent disposal.
- `packages/core/agent-loop/src/index.ts::AgentLoop.prepare/setupAndPublish` and `packages/core/agent-loop/src/agent.ts::ReactLoopAgent`: agent scope creation, setup-before-publication, turn boundaries, and disposal order.
- `packages/core/scope/src/index.ts`: ancestor-routed scoped registrations and events; this is routing/lifecycle isolation, not a security boundary or wildcard service container.
- `packages/core/system-prompt/src/index.ts::SystemPrompt.assemble`: scoped prompt layers, centrally resolved section/context ordering, and an awaited `system-prompt/assemble` waterfall.
- `packages/core/tools/src/index.ts::ToolRuntime.register`: scoped native tools, supported JSON Schema validation, canonical JSON outputs, result rendering, effect-owned removal, and the `tools/pre-execute` ask path.
- `packages/interaction/user-approval/src/index.ts::ApprovalService.request`: turn-enclosed audited one-shot approval with `ask`/`never` policy and fail-closed rejected, cancelled, or unavailable outcomes.
- `packages/core/session/src/index.ts` and `packages/core/session/src/types.ts::SessionEventMap`: post-commit `session/event` observation, branded `SessionSeq` event identities, distinct `SessionLogOffset` boundaries, `eventAt`, and durable turn/tool facts.
- `packages/compaction/compaction/src/types.ts`: durable `compaction/start`, `compaction/summary`, and `compaction/end` markers keyed by branded Session event sequences.
- `packages/preset/agent-presets/src/index.ts` and `mount.ts`: standing preset scopes, live-mount-first inventory, per-runtime mount filtering, and descendant-agent routing; shared standing plugin objects remain unsuitable for Doppelganger's per-session mutable plugin trees.
- `packages/extensions/cordis-{host,client}-runner`: trusted dynamic-code façades, explicitly not containment; the refreshed host runner preserves the same immutable Package, guarded evaluator, current/next, and Fiber lifecycle model and remains unnecessary for this adapter.

Doppelganger's host-neutral seams exist in `runtime-presets`, `composition-runtime`, `extension-protocols`, and `host-extension-runtime`. The implemented roster is the authoritative ordered multi-root service and supplies the `standard` deployment default. `CompositionRuntime` accepts a caller-owned Context and one immutable `ProtectedComposition` after authored layers. `host-extension-runtime` validates versioned Host Extension definitions, normalizes ordered selections, and instantiates fresh protected entries for each Runtime Session. `extension-protocols` provides the actor-neutral shared Runtime Host bridge, closed semantic capability profile, revisioned tool catalogs, exact invocation/approval/cancellation contracts, declared lifecycle availability, and transport-independent conformance suite. The remaining work is a DSH lifecycle owner and direct projection adapter using those contracts unchanged.

## Goals / Non-Goals

**Goals:**

- Add `packages/host-dsh` as a native Cordis plugin package.
- Activate exactly one isolated Doppelganger Runtime Session per selected live DSH agent.
- Preserve Runtime Preset precedence across explicit, project, user-default, and deployment-default selection, patch ordering, activation audit, rollback, independent actor binding, and protocol contracts.
- Project portable context and tools through DSH's scoped registries without modifying the DSH agent loop.
- Declare one frozen DSH Runtime Host capability profile matching implemented context, tool, approval, cancellation, and lifecycle semantics.
- Translate committed DSH Session events into lifecycle protocol version 2 with stable identities and replay safety.
- Make activation, reload, projection, and teardown serialized, idempotent, and session-contained.
- Pass the same transport-independent Runtime Host conformance suite as OMP against the actual DSH public package APIs.
- Prove that an opt-in Runtime Preset can expose the portable Dynamic Runtime Plugins control surface, execute one exactly approved Package, project its effects, replace or stop it, and dispose it through the ordinary Runtime Session lifecycle.
- Prove that an opt-in Runtime Preset can expose Evolution's stable instruction, relevant reminder data, and exact portable controls while all proposal persistence and user-directed workflow remain owned by the extension.

**Non-Goals:**

- Replacing or extending the DSH agent loop, Session log, Loader, scope system, prompt registry, or tool scheduler.
- Reusing the OMP child process, framed RPC, process failure boundary, or OMP schema translator.
- Sharing one Doppelganger plugin tree across DSH agents through a standing preset generation.
- Treating DSH scope routing, `node:vm`, the Cordis runners, or Dynamic Runtime Plugins as a security sandbox.
- Adding account authentication, actor onboarding, in-session actor switching, Runtime Preset package installation, or cross-host behavioral identity.
- Changing the existing Runtime Preset, composition-runtime, actor-identity, or lifecycle protocol requirements.
- Adding a DSH-specific common bridge, generic runtime notification channel, parallel router, sidecar, or second host binding.
- Promoting a DSH-only service or event into the common API without two implemented adapters proving semantic equivalence.

## Decisions

### 1. Ship a native `host-dsh` Cordis plugin

`packages/host-dsh` exports one ordinary Cordis plugin and configuration schema. It injects the public `doppelgangerRuntimePresets` service, normally mounted beside it in the same standing DSH composition. Because DSH scoped events flow from descendant agents to ancestor listeners, one plugin instance can observe every joined agent while still creating a separate adapter state and Composition Runtime per agent.

The package declares `@deepseek-ai/cordis` and each consumed `@deepseek-ai/dsh-*` package as peers, with matching development dependencies. It never imports upstream `cordis`, DSH private source subpaths, OMP, Persona, memory, SQLite, or a named Runtime Preset. Its only internal edges are `runtime-presets`, `composition-runtime`, `extension-protocols`, and `host-extension-runtime`; the roster service owns roots, trust, discovery, authoring, and deployment-default semantics, while the Host Extension catalog owns runtime-owned protected composition.

Alternative considered: add the adapter directly to DSH. Rejected because Doppelganger owns Runtime Preset selection and protocol translation, and the portable host package must remain versioned and testable with this repository.

Alternative considered: use DSH's dynamic Cordis runner to implement Doppelganger Dynamic Runtime Plugins. Rejected because the optional Runtime-Session extension owns the portable registry, immutable Packages, inspection catalog, guarded evaluator, and transition semantics; `host-dsh` must only project its ordinary portable descriptors and must not duplicate or delegate that product contract to a host-specific runner. Neither mechanism provides hostile-code containment.

### 2. Start per-agent activation from `agent/session-start`; await it at projection barriers

The plugin keeps a `WeakMap<Agent, DshRuntimeState>`. A scoped `agent/session-start` listener creates the state synchronously and starts one memoized asynchronous activation. DSH emit listeners are not awaited, so correctness does not depend on the notification finishing before dispatch returns.

The awaited `system-prompt/assemble` waterfall is the first hard projection barrier. For an active selected state it awaits the same activation promise before resolving Doppelganger context. Tool projection is installed by activation before the barrier returns. Thus the first model request cannot observe a half-activated Runtime Session even though DSH's session-start notification itself is fire-and-forget.

A `session/created` fallback covers agents already live when the host plugin is hot-loaded. Initial plugin setup also enumerates `ctx.agents.list()` and starts states for existing agents visible to its scope. Creation is idempotent by exact Agent identity.

Alternative considered: activate only on first prompt assembly. Rejected because agents that execute lifecycle operations before their first request would lack a session-start state, and the lazy path makes diagnostics and teardown harder to correlate.

Alternative considered: require every DSH agent creator to compose Doppelganger through `CreateAgentOptions.setup`. That would give an earlier awaited boundary, but it would require invasive changes across Web, ACP, headless, subagent, and custom factories. The scoped listener plus awaited assembly barrier uses existing public extension points and covers all factory callers.

### 3. One caller-owned Composition Runtime and Host Extension plan per DSH agent

Host setup creates one immutable `HostExtensionCatalog<DshHostSessionFacts>` from the standard `runtime-host` and `actor` definitions plus explicitly configured trusted DSH-only definitions. Configuration names ordered Host Extension selections and JSON-compatible configuration; the adapter validates and normalizes that plan before creating a Composition Runtime. The `runtime-host` selection is required whenever a Runtime Preset is selected. The `actor` selection is independent and may be omitted.

Each state resolves Runtime Preset selection through `ctx.doppelgangerRuntimePresets.select(...)`, creates a Composition Definition, freezes closed DSH session facts containing only `hostKind`, DSH session identity, optional absolute workspace root, and bounded host-owned routing facts, then instantiates a fresh `ProtectedComposition` from the normalized Host Extension plan. It activates `createCompositionRuntime({ context: agent.ctx, watch, onReload, onReloadFailure })` with:

- `sessionId: String(agent.session.id)`;
- `workspaceRoot: agent.session.header.cwd` when present;
- canonical user and project patch paths returned by roster selection;
- optional trusted host patches from plugin configuration;
- the instantiated protected composition, whose ordered entries receive explicit session isolation from their definitions.

The standard `runtime-host` definition creates the shared Runtime Host plugin from the state's one direct binding and `DSH_RUNTIME_HOST_CAPABILITIES`. The standard `actor` definition resolves the configured DSH actor mode from the closed session facts and creates the separate actor plugin. `host-dsh` never builds a second protected-plugin map, lets authored Loader rows select Host Extensions, or passes raw Agent, Session, Context, registry, approval, logger, filesystem, process, network, or credential objects through facts or extension configuration.

The roster applies strict first-match precedence: explicit host selection, project selection, user default, then deployment default. Its normal Cordis plugin deployment defaults to the shipped `standard` Runtime Preset. A deployment that intentionally needs an inactive no-selection state configures the roster service without a deployment default; the DSH host does not invent a second host-local switch or discovery path. A defaultless no-selection state creates no Runtime Session or protected composition.

Using `agent.ctx` makes the runtime a descendant of the DSH agent scope and preserves the single Cordis root. The adapter still owns an explicit memoized `runtime.dispose()` because Composition Runtime must drain watches and mutation queues before the enclosing agent Fiber completes. Cleanup is registered immediately through `agent.ctx.effect`, before activation awaits, so agent teardown racing startup finds the same disposal promise.

Unknown, duplicate, incompatible, or invalidly configured Host Extension selections fail before Fiber creation. A later Runtime Preset selection or activation failure marks only that state failed, logs an actionable diagnostic, removes any partial projection, and disposes the attempted runtime.

Alternative considered: one Composition Runtime shared by every DSH agent. Rejected because Runtime Sessions need independent plugin trees, Host Extension instances, reload state, protocol services, and disposal; sharing also couples sibling cleanup.

Alternative considered: create a second root Context per agent. Rejected because it splits Cordis service identity and prevents direct scoped DSH projection.

Alternative considered: accept ad hoc protected plugin objects directly in host configuration. Rejected because it bypasses definition API compatibility, JSON-compatible normalization, deterministic selection, trust admission, and fresh per-session instantiation.

### 4. Consume the shared Runtime Host API through one standard Host Extension

`extension-protocols` owns the actor-neutral Runtime Host bridge contract. `host-dsh` imports `RuntimeHostBridge`, `RuntimeHostBinding`, capability types, tool snapshots, exact invocation and cancellation requests, and approval helpers from that public package. Its standard `runtime-host` definition is built with `createRuntimeHostExtension(...)` from `host-extension-runtime`; `host-dsh` does not call `createRuntimeHostPlugin(...)` during activation, define a DSH-local bridge interface, copy protocol-service lookup logic, or expose native DSH objects through the common API.

Each agent state owns one direct in-memory `RuntimeHostBinding`. `attach` accepts exactly one bridge, `detach` clears only that bridge, and `toolCatalogChanged(revision)` enqueues a snapshot refresh for the current state. A second attachment before exact detach is an activation error. Delayed callbacks from a detached or replaced state are ignored through exact state identity and committed catalog revision checks.

The bridge surface is used unchanged:

- `resolveContext({ requestId, turn: { input, turnId? }, tokenBudget })`;
- `snapshotTools()` returning one immutable catalog revision and revisioned descriptors;
- `invokeTool({ callId, turnId?, name, toolRevision, input, approval? })`;
- `cancelTool({ callId, reason? })`;
- `publishLifecycle(event)` constrained by the declared capability profile;
- `attach`, `detach`, and the single explicit `toolCatalogChanged(revision)` callback.

DSH has no bridge transport: the adapter and instantiated Host Extensions share the agent-owned Cordis process and lifecycle. A DSH-only service or event must be one typed Host Extension definition admitted into the catalog by trusted host configuration. Its factory returns a fresh entry in the same protected composition and may use only closed facts and explicitly captured host-owned capabilities; it cannot expose raw DSH runtime objects or add a generic notification envelope, second bridge, router, connection, sidecar, or session-binding path. Such a contract remains host-specific until two implemented adapters prove the common-API promotion criteria.

Alternative considered: duplicate an approximately equivalent bridge in `host-dsh`. Rejected because it would create a second protocol implementation, bypass shared capability and approval validation, and drift from the conformance suite.

### 5. Actor Identity is an independently selected standard Host Extension

The checked-out DSH source has no authenticated account/principal service. It does provide `@deepseek-ai/dsh-anonymous-user-id`, a stable random UUID per `$DSH_HOME`, already shared by telemetry, feedback, and DeepSeek requests. Before session activation, host-owned actor resolution maps configuration to one immutable actor result: default namespaced anonymous-home identity, explicit unbound, explicit bound, trusted deployment resolver result, or provider absence.

When Actor Identity is enabled, the ordered Host Extension selection includes `actor`; its standard definition closes over the trusted resolver and uses `createActorIdentityHostExtension(...)` to produce one fresh session-isolated actor entry. Disabled mode omits the `actor` selection entirely, leaving `doppelgangerActor` absent. The `runtime-host` selection, bridge, capability profile, Runtime Preset, project files, prompts, tools, and session metadata cannot supply or infer actor state. The resolved value is snapshotted once per Runtime Session and cannot change on reload.

This is installation identity, not authenticated human identity. Actor onboarding and multi-user account binding remain deferred. Deleting the DSH anonymous ID file intentionally creates a new actor partition on a later process launch.

Alternative considered: put actor identity back into the shared bridge or `runtime-host` Host Extension. Rejected because actor absence, explicit unbound, and immutable bound state are independent from context, tools, cancellation, and lifecycle capabilities.

Alternative considered: use the DSH session ID, workspace, hostname, git remote, or model-visible metadata. Rejected because those values are neither stable user identity nor host-authoritative privacy-preserving binding.


### 6. Resolve context once per DSH turn and preserve authority

An agent-scoped turn snapshot records the direct principal text captured from `agent/inbox/claimed` messages whose `source.kind === "user"`. On the first `system-prompt/assemble` for that turn, the adapter awaits activation and calls `bridge.resolveContext` with:

- one adapter-minted `requestId` for the turn snapshot;
- portable `turnId = "<sessionId>:turn:<DSH turn number>"`;
- the direct principal text for that turn;
- configured `tokenBudget`.

Text blocks are joined deterministically; non-text blocks do not become invented text. Later tool-driven model steps reuse the accepted contribution snapshot and do not call `resolveContext` again. A new direct user turn creates a new snapshot, so memory retrieval, reminders, Persona asset reloads, and other provider changes become visible at the next turn boundary.

Every prompt assembly maps the cached accepted contributions independently:

- `authority: "instruction"` -> an appended DSH `PromptAssembly.sections` row;
- `authority: "data"` -> an appended DSH `PromptAssembly.contexts` row.

Names include a reserved `doppelganger:` prefix plus source and stable ordinal. Existing DSH rows remain intact. The adapter does not call `SystemPrompt.section()` for asynchronous providers, because section callbacks are synchronous; the awaited waterfall is used once to create the turn snapshot and then projects that immutable result. DSH's post-waterfall complete-section restoration and runtime-context suppression remain authoritative, so the adapter cannot bypass host prompt governance.

Alternative considered: resolve again for every model step. Rejected because identity, traits, memory, and reminders belong to one direct user turn; recomputing them after each tool call creates duplicate semantic injections and unstable turn behavior.

Alternative considered: append the flattened assembled string as one system section. Rejected because it erases instruction/data authority and provenance.

Alternative considered: inject a `user/message` through `agent.inject()`. Rejected because instruction contributions would be demoted to data and persisted as synthetic user history.

### 7. Translate immutable revisioned snapshots to exact agent-scoped DSH tools

After bridge attachment, the state reads `bridge.snapshotTools()`. On `toolCatalogChanged(revision)`, it ignores a revision already committed or superseded, fetches a fresh complete snapshot, requires the fetched revision to match the callback before commit, and repeats if a newer callback arrived during preparation. Only descriptors with `available: true` are candidates; unavailable descriptors remain absent with diagnostics where required.

Before changing live registrations, candidate preparation:

1. rejects duplicate portable names and duplicate descriptor revisions for one name;
2. validates each raw input schema with DSH's public `assertObjectJsonSchema`/`assertSupportedJsonSchema` boundary;
3. validates portable required-approval metadata and blocks such a descriptor if the declared host profile did not support native required approval;
4. rejects the DSH-reserved `run_code` name;
5. builds every `ToolDefinition` using the portable name and description, raw parameters, output schema `{ type: "json" }`, and deterministic JSON text rendering;
6. retains the exact portable name, descriptor revision, and catalog revision in every native closure.

One agent-scoped `tools/pre-execute` waterfall listener resolves the exact current descriptor for projected portable calls. A descriptor with `approval.policy === "required"` returns `{ kind: "ask", ...(reason === undefined ? {} : { reason }) }`; ordinary projected tools and unrelated native DSH tools delegate with `next()`. DSH Tool Runtime routes the exact agent, call ID, tool name, and optional advisory reason through ApprovalService. Only `allowed-once` authorizes the adapter to mint one protected grant bound to a fresh grant ID, the exact call ID, descriptor revision, and `digestToolInput` of the parsed canonical input. Rejection, native cancellation, a missing service, or an unavailable answerer fails closed without calling `bridge.invokeTool`. Host deployment policy may deny more operations but cannot silently weaken or fabricate the portable requirement, and reason absence never bypasses the gate.

The native tool closure verifies that its captured catalog and tool revisions are still the committed state, then calls `bridge.invokeTool({ callId, turnId, name, toolRevision, input, approval? })`. It returns the success JSON value and maps each structured portable failure code to a bounded failed DSH result. It never calls a portable handler or registry directly. If the DSH execution signal aborts before settlement, the adapter calls `bridge.cancelTool({ callId, reason })`; completion/cancellation races preserve the bridge's actual structured result and never fabricate success. Every invocation still receives a valid portable signal even if a future DSH configuration truthfully advertises no native cancellation.

Refresh is serialized and transactional. Candidate validation and registration happen first; only after all installs succeed does the state atomically swap the committed catalog revision, descriptor map, registrations, and approval behavior, then dispose obsolete registrations. Failure disposes candidates and retains the previous complete projection. Removed closures, stale descriptor revisions, delayed catalog callbacks, and stale grants fail unavailable or revision-stale before approval consumption or portable dispatch.

Native DSH tools outside the adapter's agent-scoped registrations are untouched. DSH's own scope shadowing rules decide name collisions; a collision in the same scope is a visible projection failure, not an automatic rename.

An opt-in Dynamic Runtime Plugins row needs no host-specific registration path. Its seven `runtime-plugin.*` descriptors enter this same projection unchanged. Every `runtime-plugin.run` descriptor carries portable required approval, so each exact first run, restart, update, or rollback asks through the native gate before the shared bridge revalidates and dispatches it. Generated context and tools appear and disappear through catalog revision callbacks and transactional refresh; a retained DSH closure cannot approve or invoke a removed generated handler.

An opt-in Evolution row follows the same host-neutral path. Its context contributions and seven `evolution.*` descriptors are projected without interpreting proposal kinds, stores, state transitions, cooldown, review consent, research consent, or executor routing. Evolution may require separately provided bound Actor Identity; the shared bridge itself remains usable when the actor service is absent or unbound.

Alternative considered: register one generic dispatch tool. Rejected because it hides schemas, weakens DSH policy/presentation, and breaks normal durable tool correlation.

Alternative considered: call `ctx.approval.request()` inside each projected tool body. Rejected because it bypasses DSH's native pre-execute policy chain and can produce duplicate prompts when another scoped gate also asks.

### 8. Translate lifecycle from durable DSH facts

The state observes scoped `session/event` notifications only for its exact Session and only for events whose branded `event.seq` is at or after the numeric `session.firstLiveSeq` `SessionLogOffset`. Seeded history is never republished. Event positions use `SessionSeq`; prefix lengths and replay boundaries use `SessionLogOffset` and are never treated as interchangeable identities. A small per-state reducer tracks turns, calls, assistant text, principal text, and compaction identities.

Mapping:

| DSH fact | Portable event |
|---|---|
| successful bridge activation | `session-started` |
| `turn/start` | `turn-started` |
| `tool/call` | `tool-started` |
| correlated `tool/result` | `tool-completed` |
| `turn/end` | `turn-committed` |
| live `compaction/start` | `pre-compaction` |
| state cleanup | `session-disposed` |

`turn-committed` is emitted only after durable `turn/end`. Its principal input is the joined text from entered `user/message` events with `source.kind === "user"`; plugin, tool, compaction checkpoint, and injected context messages are excluded. Assistant output is the joined text from the turn's durable `assistant/message` events; tool-call blocks and tool results remain owned by tool events. DSH turn reasons map as follows:

- `completed`, `blocked`, `max-tokens` -> `completed` (the durable assistant prefix is committed; max-token status may be retained in bounded metadata only if the lifecycle contract later adds a field);
- `aborted`, `interrupted` -> `cancelled`;
- `error` -> `failed` with the DSH structured failure.

A raw `tool/call.arguments` string is parsed as JSON when valid; invalid model JSON is serialized as the raw string. `tool/result.message.source.callId` correlates the call, while the result content and DSH error identity are bounded through `serializeLifecycleValue`. PTC nested dispatch events are not mapped in the first milestone because they are internal sub-dispatch observations; the top-level `run_code` call remains the lifecycle owner.

`pre-compaction` is emitted on the durable start marker, using `compactionId` for deterministic delivery and bounded material containing the marker facts and the current surface summary needed by subscribers. Seed-orphaned markers are ignored through the live-seq boundary.

Delivery IDs are deterministic strings derived from session ID, event kind, and durable DSH identity (`turn`, `callId`, or `compactionId`). Publication is serialized in Session event order and sent only through `bridge.publishLifecycle` for event kinds listed in `DSH_RUNTIME_HOST_CAPABILITIES.lifecycle.events`; `session-completed` is omitted because teardown alone does not prove a terminal committed outcome. Subscriber failures remain contained by `publishLifecycleEvent`; they do not fail DSH Session append or committed host work.

Alternative considered: use stream chunks and live tool scheduler callbacks. Rejected because partial work is not committed and replay/idempotence would depend on timing rather than the durable log.

### 9. Reload refreshes projection only after audited commit

Composition Runtime remains the sole watch/mutation/rollback owner. The injected roster service owns discovery and selection but does not add an activation watcher. `onReload` enqueues one projection refresh after the new generation is audited. `onReloadFailure` records diagnostics and does not refresh the committed tool projection, so the prior generation remains visible.

Context is resolved from the bridge at each assembly and therefore observes the committed generation without cached provider objects. Tool refresh uses the explicit catalog revision callback and serialized exact-replacement transaction above. The separately mounted Actor Identity value and Runtime Session metadata are outside reload and remain unchanged.

The adapter does not add a second filesystem watcher or write normalized Loader input back to Runtime Preset or patch files.

### 10. Failure and disposal use one per-agent serialized state machine

Each state owns one tail promise for activation, tool refresh, lifecycle publication, and disposal ordering. State transitions are `inactive -> starting -> active|failed -> disposing -> disposed`; no operation starts after `disposing`.

Failures before active state dispose the attempted Composition Runtime and all candidate DSH registrations. Failures after active state withdraw Doppelganger prompt/tool projection for that agent, log through the DSH plugin logger, retain structured diagnostics, and leave sibling agents untouched. Invalid reload is the exception: Composition Runtime already retains the prior generation, so the state remains active.

Cleanup is memoized and exhaustive:

1. mark disposing and stop new projection;
2. await activation and queued refresh/publication work;
3. publish bounded neutral `session-disposed` when a bridge was active;
4. dispose every DSH tool registration;
5. dispose the Composition Runtime, which drains reload and watch queues and disposes its Runtime Session;
6. clear state references in a finally-equivalent path;
7. report collected cleanup failures after all reachable stages settle.

The agent-owned effect invokes this cleanup before its scope reaches quiescence. The host plugin's own disposer snapshots and settles every remaining state so plugin unload is safe even if DSH teardown order changes.

Active generated Packages remain owned by the Runtime Session below the Composition Runtime. Ordinary evaluation, apply, guard, waiting, and cleanup failures returned by the optional extension stay structured and agent-contained. Generated code nevertheless executes in the DSH process: deliberate process termination, corruption, or non-cooperative work is outside lifecycle containment and can affect the native host. Agent or host-plugin cleanup must still await Composition Runtime disposal so every reachable generated Fiber is attempted before the state is cleared.

Alternative considered: rely only on parent Fiber recursive disposal. Rejected because Composition Runtime has explicit serialized mutation queues and aggregate cleanup semantics that must be awaited and diagnosed.

## Risks / Trade-offs

- **DSH API maturity**: the adapter targets `0.1.2-alpha.4` APIs at commit `4e84901e...`; package changes can be breaking. Mitigation: exact compatible peer ranges, compile-time API coverage, and a native composition smoke test.
- **Activation starts after publication**: DSH's public observer is not awaited. Mitigation: start immediately at `agent/session-start`, memoize the operation, and make the awaited prompt waterfall the first hard barrier. An upstream setup-composition hook would be cleaner but is not required.
- **Anonymous actor semantics**: the default identifies a DSH home, not a verified person, and deletion intentionally forks memory. Mitigation: document the boundary, namespace the identifier, support disabled, explicit unbound, and trusted deployment resolvers, and do not call it authentication.
- **Tool schema intersection**: portable JSON Schema may exceed DSH's supported subset. Mitigation: validate the complete candidate projection before commit and fail visibly rather than silently weakening schemas.
- **Required approval composition**: DSH may run without an ApprovalService or interactive answerer. Mitigation: portable `required` tools ask through the native pre-execute seam, mint an exact protected grant only after `allowed-once`, and rely on bridge revalidation before handler dispatch.
- **Tool cancellation is cooperative**: DSH supplies a fused execution signal but neither host nor bridge can force arbitrary plugin code to stop. Mitigation: call `cancelTool` with the exact call ID, preserve the settled structured result, and await invocation quiescence during disposal.
- **Prompt governance**: DSH complete prompts or runtime-context suppression can intentionally hide projected contributions. Mitigation: preserve DSH's governing semantics and test that the adapter does not bypass them.
- **Turn text projection**: memory capture accepts only strings, while DSH supports rich blocks. Mitigation: use only direct user/model text for capture and never stringify image or tool metadata into invented principal text.
- **Standing plugin lifetime**: one host plugin observes many descendant agents. Mitigation: WeakMap by exact Agent, exact Session filtering, per-agent queues, per-agent Composition Runtime ownership, and exhaustive host-plugin disposal.
- **Same-process failure boundary**: unlike OMP, a malicious or non-cooperative plugin can affect the DSH process. This is an explicit trust model, not a regression hidden by sandbox language. The milestone provides lifecycle containment for ordinary failures, not hostile-code isolation.
- **Host Extension trust**: DSH runs native plugins and admitted Host Extension modules in-process. Mitigation: admit definitions only through explicit host-owned configuration, validate API version and JSON-compatible configuration before Fiber creation, pass only closed bounded session facts, instantiate fresh entries per agent, and make no sandbox claim.
