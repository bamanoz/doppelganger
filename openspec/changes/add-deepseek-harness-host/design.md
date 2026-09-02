## Context

Doppelganger currently has one concrete host, OMP. OMP cannot share its Cordis process with the runtime, so `packages/host-omp` uses a Node child and framed JSON-RPC. DeepSeek Harness already owns the compatible Cordis root, Loader family, agent scopes, system-prompt registry, native tool pipeline, append-only Session log, and quiescent agent teardown. A native DSH adapter should therefore run in-process and reuse those host APIs instead of reusing the OMP transport.

The research gate was revalidated against DeepSeek Harness commit `4e84901e6471b79ec0338099867ebb4606d12bb5` on September 1, 2026. The relevant source contracts are:

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

Doppelganger's host-neutral seams exist in `runtime-presets`, `composition-runtime`, and `extension-protocols`. The companion shipped-roster change makes `runtime-presets` the authoritative ordered multi-root roster, exposes the same API as a Cordis service, and supplies the `standard` deployment default. `CompositionRuntime` accepts a caller-owned Context and mounts protected runtime plugins after authored layers. The remaining work is a DSH lifecycle owner and direct projection adapter.

## Goals / Non-Goals

**Goals:**

- Add `packages/host-dsh` as a native Cordis plugin package.
- Activate exactly one isolated Doppelganger Runtime Session per selected live DSH agent.
- Preserve Runtime Preset precedence across explicit, project, user-default, and deployment-default selection, patch ordering, activation audit, rollback, actor binding, and protocol contracts.
- Project portable context and tools through DSH's scoped registries without modifying the DSH agent loop.
- Translate committed DSH Session events into lifecycle protocol version 2 with stable identities and replay safety.
- Make activation, reload, projection, and teardown serialized, idempotent, and session-contained.
- Prove portability with hermetic tests against the actual DSH public package APIs.
- Prove that an opt-in Runtime Preset can expose the portable Dynamic Runtime Plugins control surface, execute one exactly approved Package, project its effects, replace or stop it, and dispose it through the ordinary Runtime Session lifecycle.
- Prove that an opt-in Runtime Preset can expose Evolution's stable instruction, relevant reminder data, and exact portable controls while all proposal persistence and user-directed workflow remain owned by the extension.

**Non-Goals:**

- Replacing or extending the DSH agent loop, Session log, Loader, scope system, prompt registry, or tool scheduler.
- Reusing the OMP child process, framed RPC, process failure boundary, or OMP schema translator.
- Sharing one Doppelganger plugin tree across DSH agents through a standing preset generation.
- Treating DSH scope routing, `node:vm`, the Cordis runners, or Dynamic Runtime Plugins as a security sandbox.
- Adding account authentication, actor onboarding, in-session actor switching, Runtime Preset package installation, or cross-host behavioral identity.
- Changing the existing Runtime Preset, composition-runtime, actor-identity, or lifecycle protocol requirements.

## Decisions

### 1. Ship a native `host-dsh` Cordis plugin

`packages/host-dsh` exports one ordinary Cordis plugin and configuration schema. It injects the public `doppelgangerRuntimePresets` service, normally mounted beside it in the same standing DSH composition. Because DSH scoped events flow from descendant agents to ancestor listeners, one plugin instance can observe every joined agent while still creating a separate adapter state and Composition Runtime per agent.

The package declares `@deepseek-ai/cordis` and each consumed `@deepseek-ai/dsh-*` package as peers, with matching development dependencies. It never imports upstream `cordis`, DSH private source subpaths, OMP, Persona, memory, SQLite, or a named Runtime Preset. Its only internal edges are `runtime-presets`, `composition-runtime`, and `extension-protocols`; the roster service owns roots, trust, discovery, authoring, and deployment default semantics outside the host adapter.

Alternative considered: add the adapter directly to DSH. Rejected because Doppelganger owns Runtime Preset selection and protocol translation, and the portable host package must remain versioned and testable with this repository.

Alternative considered: use DSH's dynamic Cordis runner to implement Doppelganger Dynamic Runtime Plugins. Rejected because the optional Runtime-Session extension owns the portable registry, immutable Packages, inspection catalog, guarded evaluator, and transition semantics; `host-dsh` must only project its ordinary portable descriptors and must not duplicate or delegate that product contract to a host-specific runner. Neither mechanism provides hostile-code containment.

### 2. Start per-agent activation from `agent/session-start`; await it at projection barriers

The plugin keeps a `WeakMap<Agent, DshRuntimeState>`. A scoped `agent/session-start` listener creates the state synchronously and starts one memoized asynchronous activation. DSH emit listeners are not awaited, so correctness does not depend on the notification finishing before dispatch returns.

The awaited `system-prompt/assemble` waterfall is the first hard projection barrier. For an active selected state it awaits the same activation promise before resolving Doppelganger context. Tool projection is installed by activation before the barrier returns. Thus the first model request cannot observe a half-activated Runtime Session even though DSH's session-start notification itself is fire-and-forget.

A `session/created` fallback covers agents already live when the host plugin is hot-loaded. Initial plugin setup also enumerates `ctx.agents.list()` and starts states for existing agents visible to its scope. Creation is idempotent by exact Agent identity.

Alternative considered: activate only on first prompt assembly. Rejected because agents that execute lifecycle operations before their first request would lack a session-start state, and the lazy path makes diagnostics and teardown harder to correlate.

Alternative considered: require every DSH agent creator to compose Doppelganger through `CreateAgentOptions.setup`. That would give an earlier awaited boundary, but it would require invasive changes across Web, ACP, headless, subagent, and custom factories. The scoped listener plus awaited assembly barrier uses existing public extension points and covers all factory callers.

### 3. One caller-owned Composition Runtime per DSH agent

Each state creates `createCompositionRuntime({ context: agent.ctx, watch, onReload, onReloadFailure })`, resolves selection through the injected `ctx.doppelgangerRuntimePresets.select(...)`, creates a Composition Definition, and activates it with:

- `sessionId: String(agent.session.id)`;
- `workspaceRoot: agent.session.header.cwd` when present;
- canonical user and project patch paths returned by roster selection;
- optional trusted host patches from plugin configuration;
- one protected protocol bridge runtime plugin;
- explicit session isolation for `doppelgangerActor`, `doppelgangerContext`, `doppelgangerTools`, and `doppelgangerLifecycle`.

The roster applies strict first-match precedence: explicit host selection, project selection, user default, then deployment default. Its normal Cordis plugin deployment defaults to the shipped `standard` Runtime Preset. A deployment that intentionally needs an inactive no-selection state configures the roster service without a deployment default; the DSH host does not invent a second host-local switch or discovery path.

Using `agent.ctx` makes the runtime a descendant of the DSH agent scope and preserves the single Cordis root. The adapter still owns an explicit memoized `runtime.dispose()` because Composition Runtime must drain watches and mutation queues before the enclosing agent Fiber completes. Cleanup is registered immediately through `agent.ctx.effect`, before activation awaits, so agent teardown racing startup finds the same disposal promise.

A defaultless no-selection state is valid and installs no protected runtime bridge, context, or tools. A selection or configuration failure marks only that state failed, logs an actionable diagnostic, removes any partial projection, and disposes the attempted runtime.

Alternative considered: one Composition Runtime shared by every DSH agent. Rejected because Runtime Sessions need independent plugin trees, reload state, protocol services, and disposal; sharing also couples sibling cleanup.

Alternative considered: create a second root Context per agent. Rejected because it splits Cordis service identity and prevents direct scoped DSH projection.

### 4. Extract the protected runtime protocol bridge from `host-omp`

`packages/host-omp/src/runtime-host.ts` already implements the protected in-runtime bridge: bind actor identity, read optional context/tools services, invoke tools, publish lifecycle events, and observe tool changes. The second host should not copy that behavior.

Move the host-neutral bridge contract and plugin factory into `extension-protocols`, for example `host-bridge.ts`, exported from its public index. The bridge exposes only:

- `resolveContext(input, turnId, tokenBudget)`;
- `listTools()`;
- `invokeTool(name, input)`;
- `publishEvent(event)`;
- attach/detach and tools-changed notifications.

OMP migrates to that implementation without behavioral changes. DSH binds the same direct interface in-process. Host-specific reload notifications, diagnostics, tool projection, and transport remain in their host packages.

Alternative considered: duplicate the approximately equivalent bridge in `host-dsh`. Rejected because actor/context/tool/lifecycle optional-service semantics are one protocol contract and a second implementation would drift.

### 5. Actor identity defaults to DSH's anonymous harness-home identity

The checked-out DSH source has no authenticated account/principal service. It does provide `@deepseek-ai/dsh-anonymous-user-id`, a stable random UUID per `$DSH_HOME`, already shared by telemetry, feedback, and DeepSeek requests. The default DSH actor resolver uses `getOrCreateAnonymousUserId()` and prefixes or namespaces the value as documented so it cannot be confused with a future account identifier.

Configuration may instead select explicit unbound mode or provide a trusted host callback/API entry point for a deployment-specific actor ID. Runtime Presets, project manifests, session metadata, prompts, and tools cannot supply it. The resolved identity is snapshotted once per Runtime Session and cannot change on reload.

This is installation identity, not authenticated human identity. Actor onboarding and multi-user account binding remain deferred. Deleting the DSH anonymous ID file intentionally creates a new actor partition on a later process launch.

Alternative considered: use the DSH session ID. Rejected because it destroys persistence continuity across sessions.

Alternative considered: use workspace, hostname, git remote, or model-visible metadata. Rejected because those values are neither user identity nor privacy-preserving host authority.

Alternative considered: remain unbound by default. Rejected because DSH owns an appropriate anonymous installation identity for actor-aware Runtime Presets. The shipped `standard` deployment default is actor-neutral and can activate regardless; stable default binding additionally lets a later explicit actor-aware memory preset preserve partitioned persistence. Explicit unbound mode remains available for generic deployments.

### 6. Project context through `system-prompt/assemble`, preserving authority

A scoped `system-prompt/assemble` waterfall listener receives `AssembleContext.agent`. It finds that agent's state, awaits activation, and resolves the bridge context with:

- portable `turnId = "<sessionId>:turn:<DSH turn number>"`;
- the direct principal text captured from `agent/inbox/claimed` messages whose `source.kind === "user"`;
- configured `tokenBudget`.

The state records the first direct user batch for a turn and reuses it for later tool-driven steps. Text blocks are joined deterministically; non-text blocks do not become invented text. Lifecycle publication may retain bounded structured host facts, but memory capture continues to receive strings only.

The adapter maps each accepted contribution independently:

- `authority: "instruction"` -> an appended DSH `PromptAssembly.sections` row;
- `authority: "data"` -> an appended DSH `PromptAssembly.contexts` row.

Names include a reserved `doppelganger:` prefix plus source and stable ordinal. Existing DSH rows remain intact. The adapter does not call `SystemPrompt.section()` for asynchronous providers, because section callbacks are synchronous; the awaited waterfall is the supported asynchronous seam. DSH's post-waterfall complete-section restoration and runtime-context suppression remain authoritative, so the adapter cannot bypass host prompt governance.

Alternative considered: append the flattened assembled string as one system section. Rejected because it erases instruction/data authority and provenance.

Alternative considered: inject a `user/message` through `agent.inject()`. Rejected because instruction contributions would be demoted to data and persisted as synthetic user history.

### 7. Translate portable tools to exact agent-scoped DSH registrations

After bridge attachment and on every tools-changed/reload notification, the state builds a complete candidate projection from `bridge.listTools().filter(available)`. Before changing live registrations it:

1. rejects duplicate names;
2. validates each raw input schema with DSH's public `assertObjectJsonSchema`/`assertSupportedJsonSchema` boundary;
3. validates optional portable approval metadata and rejects unsupported policies;
4. rejects the DSH-reserved `run_code` name;
5. builds every `ToolDefinition` using the portable name and description, raw parameters, output schema `{ type: "json" }`, and deterministic JSON text rendering.

The per-agent state retains the current committed descriptor map. One agent-scoped `tools/pre-execute` waterfall listener resolves the exact current descriptor for projected portable calls. A descriptor with `approval.policy === "required"` returns `{ kind: "ask", reason }`; ordinary projected tools and unrelated native DSH tools delegate with `next()`. DSH Tool Runtime then routes the exact `agent`, `callId`, tool name, and reason through its `ApprovalService`. Only `allowed-once` reaches dispatch; rejection, cancellation, a missing service, or an unavailable answerer fails closed without invoking the portable handler. Host deployment policy may deny more operations but cannot silently auto-allow a portable required approval.

The tool closure reads the current committed descriptor/bridge from state at execution time. It invokes `bridge.invokeTool`, returns the success JSON value, and converts a portable structured failure into a DSH/Harness error retaining the portable code and message. It forwards `exec.signal` only if the portable tool contract later grows cancellation; the initial adapter declares no DSH timeout because the current portable invocation API has no AbortSignal.

Refresh is serialized. Candidate validation happens first; then new registrations are installed on `agent.ctx`; only after all installs succeed does the state swap the committed map and dispose obsolete registrations. Approval metadata participates in that same commit. If installation fails, candidate registrations are disposed and the previous map, registrations, and approval behavior remain. Removed closures and the pre-execute listener consult the committed map and fail unavailable rather than calling or approving a captured old handler.

Native DSH tools outside the adapter's agent-scoped registrations are untouched. DSH's own scope shadowing rules decide name collisions; a collision in the same scope is a visible projection failure, not an automatic rename.

Alternative considered: prefix or encode portable tool names as OMP does. Rejected because DSH accepts the qualified names directly and renaming would make one Runtime Preset expose different tool identities by host.

An opt-in Dynamic Runtime Plugins row needs no host-specific registration path. Its exact seven `runtime-plugin.*` descriptors enter this same candidate projection unchanged. Every `runtime-plugin.run` descriptor carries portable required approval, so each exact first run, restart, update, or rollback asks through the native gate before portable dispatch. Generated context and tools appear and disappear through the existing bridge notifications and transactional refresh; a retained DSH closure consults current committed state and cannot approve or invoke a removed generated handler.

An opt-in Evolution row follows the same host-neutral path. Its instruction-authority policy and at most one data-authority reminder candidate enter ordinary prompt projection, while its seven `evolution.*` descriptors enter ordinary tool projection unchanged. The adapter does not interpret proposal kinds, stores, state transitions, cooldown, review consent, research consent, or executor routing. Evolution requires a bound actor through the protected bridge; an explicitly unbound DSH agent can still run actor-neutral presets, but a selected preset requiring Evolution fails that row visibly.

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

Delivery IDs are deterministic strings derived from session ID, event kind, and durable DSH identity (`turn`, `callId`, or `compactionId`). Publication is serialized in Session event order. Subscriber failures remain contained by `publishLifecycleEvent`; they do not fail DSH Session append or committed host work.

Alternative considered: use stream chunks and live tool scheduler callbacks. Rejected because partial work is not committed and replay/idempotence would depend on timing rather than the durable log.

### 9. Reload refreshes projection only after audited commit

Composition Runtime remains the sole watch/mutation/rollback owner. The injected roster service owns discovery and selection but does not add an activation watcher. `onReload` enqueues one projection refresh after the new generation is audited. `onReloadFailure` records diagnostics and does not refresh tools or bridge identity, so the prior generation remains visible.

Context is resolved from the bridge at each assembly and therefore observes the committed generation without cached provider objects. Tool refresh uses the serialized exact-replacement transaction above. Actor identity and Runtime Session metadata are outside reload and remain unchanged.

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
- **Anonymous actor semantics**: the default identifies a DSH home, not a verified person, and deletion intentionally forks memory. Mitigation: document the boundary, namespace the identifier, support explicit unbound and trusted deployment resolvers, and do not call it authentication.
- **Tool schema intersection**: portable JSON Schema may exceed DSH's supported subset. Mitigation: validate the complete candidate projection before commit and fail visibly rather than silently weakening schemas.
- **Required approval composition**: DSH may run without an ApprovalService or interactive answerer. Mitigation: portable `required` tools ask through the native pre-execute seam and fail closed before handler dispatch when the approval path is unavailable.
- **Tool cancellation**: the current portable invocation API has no AbortSignal. Mitigation: do not advertise DSH tool timeouts and await invocation quiescence. A cancellation-capable protocol is a separate cross-host change.
- **Prompt governance**: DSH complete prompts or runtime-context suppression can intentionally hide projected contributions. Mitigation: preserve DSH's governing semantics and test that the adapter does not bypass them.
- **Turn text projection**: memory capture accepts only strings, while DSH supports rich blocks. Mitigation: use only direct user/model text for capture and never stringify image or tool metadata into invented principal text.
- **Standing plugin lifetime**: one host plugin observes many descendant agents. Mitigation: WeakMap by exact Agent, exact Session filtering, per-agent queues, per-agent Composition Runtime ownership, and exhaustive host-plugin disposal.
- **Same-process failure boundary**: unlike OMP, a malicious or non-cooperative plugin can affect the DSH process. This is an explicit trust model, not a regression hidden by sandbox language. The milestone provides lifecycle containment for ordinary failures, not hostile-code isolation.
