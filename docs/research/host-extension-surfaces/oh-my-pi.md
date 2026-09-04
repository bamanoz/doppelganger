# Oh My Pi host-extension surface

## Snapshot

| Field | Value |
|---|---|
| External source repository | [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) |
| Exact external commit | `39cf639c7bb6b5014a1cc8ea8175558cccb23905` |
| Current adapter evidence | `/Users/mak/src/doppelganger` (`packages/host-omp`) |
| Research date | 2026-09-03 |
| Support status | Implemented |

The external checkout used for OMP evidence is `/Users/mak/src/doppelganger-host-research.zyXlnh/oh-my-pi`. The current Doppelganger implementation is the source of truth for the adapter mapping; this record does not imply that unrelated OMP extension surfaces are portable or implemented by Doppelganger.

## Native extension model

OMP exposes an in-process `ExtensionAPI` to an extension factory. The API combines registration, event subscription, session actions, tool management, provider/model controls, file-mutation fallbacks, renderers, and UI. `on(event, handler)` covers session, context, agent, turn, message, tool, user-command, approval, MCP, compaction, retry, and other events. Extensions register tools and commands directly into the host registry rather than through a portable RPC protocol.

The API is deliberately usable in phases. During factory loading, action methods are throwing stubs; provider registrations are buffered and rolled back if the factory throws. `initialize` later wires host actions, context actions, command actions, UI, and mode. This makes load-time registration distinct from runtime invocation.

OMP extensions run in the host process. OMP therefore supplies managed timers and documents that raw detached timer failures can become process-fatal, while managed timer failures are reported through the extension error channel. The host also supplies a broad native UI: dialogs, notifications, terminal input, status/widget/header/footer customization, editor operations, custom components, and composer shapes.

## Context

Native context handlers can observe or replace the model context, and `before_agent_start` can replace the system prompt for one user-initiated agent run. OMP preserves that override through model continuations after tool calls and clears it when the run ends. The context event remains a host-native per-request mutation point over the current outbound message set; it is not equivalent to a durable portable context store.

The implemented adapter uses the turn boundary. `before_agent_start` sends one `context.resolve` request over the child RPC connection with the direct principal input, turn ID, and token budget, then appends a non-empty result to the existing system prompt. Repeated model requests in the same run reuse that stable prompt snapshot; the result is neither persisted as conversation history nor recomputed after each tool call. Empty resolution leaves the host prompt unchanged, and a result from a detached or no-longer-current binding is discarded.

## Tools

OMP's native `registerTool` registry supports schemas, active-tool selection, load mode, execution, updates, and native metadata. Its wrapper emits `tool_call` before scheduling (where handlers can block or replace input), re-resolves approval against the effective input, executes, and emits `tool_result` (where handlers can replace content/details/error state). Native wrappers can delegate to a same-name built-in through `ctx.invokeTool` without bypassing approval.

Doppelganger projects the active portable `ToolDescriptor` list into OMP tools. It translates the supported JSON-Schema subset to OMP parameter schemas and performs exact replacement on committed `tools.changed` or `runtime.changed` notifications: removed descriptors are withdrawn, newly invalid descriptors are omitted, and unrelated valid tools remain available. Each proxy closure captures its binding generation and canonical descriptor. A stale closure or a connection that is no longer current returns `RUNTIME_UNAVAILABLE` and cannot invoke a newer runtime.

The dotted portable name remains canonical and is sent unchanged in `tools.invoke`. OMP's display name is `doppelganger_` plus dots replaced with underscores. The adapter enforces OMP's 64-character name limit and detects collisions, hiding collided descriptors with diagnostics. **Documentation defect:** portable tool names may contain underscores; therefore `docs/hosts/oh-my-pi.md` MUST NOT claim collision-freedom by excluding underscores. `one.two` and `one_two` demonstrably collide as `doppelganger_one_two`, and the implementation correctly fails closed for that pair.

## Approval and user interaction

OMP natively models approval-requested and approval-resolved events and its tool wrapper presents an interactive select prompt when approval is required. Provider safety checks cannot be bypassed by `yolo`; a required check with no interactive UI fails closed. These are OMP UI and policy semantics, not portable-core APIs.

The adapter preserves portable approval metadata. A portable descriptor with required approval becomes an essential top-level OMP tool with a write-tier prompt, the portable reason, and a bounded deterministic rendering of the exact parsed arguments. It is not left as an `xd://` discoverable tool, so permissive modes cannot bypass its required prompt. One explicit grant then permits the child `tools.invoke`; denial, cancellation, or unavailable UI leaves the child handler untouched. A descriptor without required approval remains discoverable. Approval metadata is part of exact replacement, so a committed reload changes both presentation and approval behavior; a failed reload does not replace the last committed behavior.

## Lifecycle

OMP natively exposes before/after session switching, branching, compaction, tree navigation, shutdown, agent, turn, message, tool execution, and resumable `session_stop` events. Before-events can cancel or alter operations; `session.compacting` can add summary context or change its prompt; `session_stop` can request continuation. These controls are intentionally not fabricated as portable lifecycle events.

The adapter serializes ownership in one coordinator. `session_start`, `session_switch`, `session_branch`, and `session_tree` request a binding keyed by generation, session ID, and canonical working directory. A tree navigation that leaves both session ID and directory unchanged can retain the binding; a changed tuple or forced request detaches and disposes the old child before activating the new one. Only the latest desired generation may commit. Lifecycle events are normalized and sent to the child using IDs captured by that binding: `session-started`, `turn-started`, `tool-started`, `tool-completed`, `turn-committed`, `pre-compaction`, and `session-disposed`.

`tool_execution_end` is the source of bounded portable tool results/errors. Final assistant content from `turn_end` becomes `turn-committed`; OMP aggregate `turn_end.toolResults` is not copied into a portable completion event. Resumable `agent_end` and native `session_stop` do not create a portable `session-completed` event. Once detached, late callbacks are ignored.

## Scope, state, reload, and trust

The adapter uses one Node child runtime per active OMP binding and framed, content-length JSON-RPC over stdin/stdout. The versioned protocol carries activation, context resolution, tool listing/invocation, lifecycle publication, and disposal. The child installs a protected OMP host plugin, exposing only actor identity and optional `doppelgangerContext`, `doppelgangerTools`, and lifecycle services to the composed runtime. Raw OMP runtime objects are not exposed to portable plugins.

`OmpAdapterSession` transitions through `inactive`, `starting`, `active`, `failed`, and `disposed`. Activation discovers the nearest `.doppelganger/manifest.yaml` while stopping at the Git root. Activation, runtime, child, context, tool, and event-forwarding failures fail the affected adapter binding, withdraw its projection, report a diagnostic, and leave OMP usable. Notification-observer failures are contained as diagnostics and do not by themselves mark a healthy child failed. Stderr diagnostics are bounded; concrete unexpected child-exit details are retained for failed requests.

Reload notifications replace the runtime revision, diagnostics, and tool descriptors only through the current binding. Replacement is detach-first: projections are withdrawn, a neutral disposal event is attempted for the captured session, Runtime Session disposal is requested, transport closes, and child termination escalates from graceful disposal to `SIGTERM` and then `SIGKILL` if needed. Shutdown applies the same containment and does not invent a successful completion outcome.

OMP project-local inputs are loaded under OMP's own model; its compatibility `isProjectTrusted()` reports that OMP has already trusted project-local inputs rather than adding a separate per-directory gate. The portable recommendation should therefore retain actor binding, context, tools, lifecycle, and failure containment, while leaving OMP UI, provider, filesystem fallback, command/session-control, timer, MCP, and trust-policy details host-specific.

## Doppelganger adapter fit

The fit is strong for the narrow portable seam and intentionally not for the whole native API. The neutral `@doppelganger/doppelganger-omp` entrypoint reads only the optional `DOPPELGANGER_ACTOR_ID` and delegates to `createDoppelgangerOmpExtension`. The adapter's immutable per-binding tuple and child/RPC boundary isolate runtime state from mutable OMP session state. Per-turn context, exact tool replacement, required approval, normalized lifecycle, and fail-closed stale closures all map cleanly to portable semantics.

The portable core should not absorb OMP's UI widgets/dialogs, commands and shortcuts, composer shapes, provider registration and model hooks, file-write/delete fallback, MCP notifications, managed timers, native session navigation/reload, system-prompt replacement, or OMP-specific trust and packaging rules. Optional portable loaders (for example Dynamic Runtime Plugins, Evolution, or CodeGraph) can use the same generic context/tools/lifecycle bridge; they do not require OMP-specific routing. OMP package internals, child process details, and proxy naming remain adapter concerns.

## Compatibility gaps

- OMP's native API is substantially broader than the portable host contract; UI, provider, command, renderer, composer, filesystem, MCP, timer, and session-control surfaces have no portable equivalent and should remain host-only.
- OMP's `tool_call` permits input replacement and blocking, whereas the portable tool contract is represented here by immutable descriptors plus invocation and result/error handling; importing native interception semantics would couple the core to OMP's execution order.
- OMP can replace the system prompt for one agent run through `before_agent_start`; the adapter uses that boundary so identity, traits, memory, and reminders are resolved once per direct user turn and remain stable across tool continuations.
- OMP approval prompts and provider safety checks depend on interactive UI. The adapter can preserve required portable approval only through native top-level approval metadata and must fail closed when UI is unavailable.
- The adapter's JSON-Schema translator is intentionally narrower than OMP's native schema authoring options. Unsupported schema keywords or tuple forms are rejected or made unavailable rather than passed through unsafely.
- Portable tool names exclude underscores, so dot-to-underscore projection is collision-free for descriptors produced by the validated portable registry. The adapter still rejects collisions defensively because the child RPC boundary validates only that descriptor names are non-empty; malformed or foreign wire input must fail closed instead of replacing an unrelated proxy.
- OMP's in-process extension failure model differs from the child-isolated portable runtime. The adapter contains RPC observer and child/runtime failures at the binding boundary, but does not make arbitrary OMP extensions process-isolated.

## Source evidence

Paths below are repository-relative to the checkout named by their prefix (`oh-my-pi` for the external OMP checkout and `doppelganger` for the current implementation). Line spans were verified directly at the recorded commit/current tree.

| Claim | Path | Symbol | Lines |
|---|---|---|---|
| Native API exposes broad event and registration surface | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts` | `ExtensionAPI` | 1212-1292 |
| Native UI includes dialogs, terminal input, widgets, editor, and custom components | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts` | `ExtensionUIContext` | 251-333 |
| Native context includes compaction, abort/shutdown, timers, and trust query | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts` | `ExtensionContext` | 455-539 |
| Command context exposes session creation, branch, tree navigation, switch, and reload | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts` | `ExtensionCommandContext` | 550-577 |
| Resource discovery and provider request/response hooks are native | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts` | `ResourcesDiscoverEvent`, `BeforeProviderRequestEvent`, `AfterProviderResponseEvent` | 704-753 |
| Input, shell/Python, and approval events are native | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts` | `UserBashEvent`, `UserPythonEvent`, `InputEvent`, `ToolApprovalRequestedEvent`, `ToolApprovalResolvedEvent` | 870-928 |
| Tool-call can block or replace effective input; session-before results can cancel | `oh-my-pi/packages/coding-agent/src/extensibility/shared-events.ts` | `ToolCallEventResult`, `SessionBefore*Result` | 310-409 |
| Load-time action methods throw until initialization | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/loader.ts` | `ExtensionRuntimeNotInitializedError`, `ExtensionRuntime` | 65-145 |
| Failed extension factory rolls back pending provider registrations | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/loader.ts` | `runExtensionFactory` | 363-379 |
| Runtime/UI actions and per-invocation file fallback contexts are wired at initialize | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/runner.ts` | `ExtensionRunner.initialize` | 646-744 |
| Native tool wrapper gates approval around effective parameters and emits results | `oh-my-pi/packages/coding-agent/src/extensibility/extensions/wrapper.ts` | `ExtensionToolWrapper.execute` | 178-415 |
| Native file-write fallback is an OMP-specific permission-error seam | `oh-my-pi/docs/extensions.md` | `File write fallback` | 421-439 |
| Native composer-shape registration is an editor/layout seam | `oh-my-pi/docs/extensions.md` | `registerComposerShape` | 628-655 |
| Adapter root exports only extension factory and child-factory types | `doppelganger/packages/host-omp/src/index.ts` | root exports | 1-7 |
| Adapter package is private and exposes only one package entrypoint | `doppelganger/packages/host-omp/package.json` | `exports`, package metadata | 1-27 |
| Activation discovers nearest manifest and stops at Git root | `doppelganger/packages/host-omp/src/adapter.ts` | `discoverOmpProject` | 77-81 |
| Adapter has inactive/starting/active/failed/disposed states and fail containment | `doppelganger/packages/host-omp/src/adapter.ts` | `OmpAdapterSession` | 192-286 |
| Adapter disposal withdraws tools and disposes the child connection | `doppelganger/packages/host-omp/src/adapter.ts` | `OmpAdapterSession.dispose` | 288-296 |
| Versioned RPC carries activation, context, tools, lifecycle, and disposal methods | `doppelganger/packages/host-omp/src/contracts.ts` | `OMP_RPC_PROTOCOL_VERSION`, `OmpRpcMethods` | 15-69 |
| Child exposes session activation, context, tools, events, and disposal | `doppelganger/packages/host-omp/src/child.ts` | `serveOmpRuntime` | 79-177 |
| Protected bridge exposes actor/context/tools/lifecycle only | `doppelganger/packages/host-omp/src/runtime-host.ts` | `createOmpRuntimeHostPlugin` | 43-77 |
| Child uses framed RPC, bounded stderr, and concrete exit diagnostics | `doppelganger/packages/host-omp/src/process.ts` | `NodeOmpChildConnection` | 36-111 |
| Child disposal escalates graceful request, SIGTERM, then SIGKILL | `doppelganger/packages/host-omp/src/process.ts` | `NodeOmpChildConnection.dispose` | 126-164 |
| Proxy naming enforces character/length limits | `doppelganger/packages/host-omp/src/extension.ts` | `proxyName` | 243-254 |
| Exact projection maps approval metadata and stale calls fail closed | `doppelganger/packages/host-omp/src/extension.ts` | `setProjectedTools` | 376-496 |
| Binding reconciliation is serialized and detach-first across session changes | `doppelganger/packages/host-omp/src/extension.ts` | `disposeBinding`, `reconcile`, `requestBinding` | 514-649 |
| Context is resolved per request and appended ephemerally | `doppelganger/packages/host-omp/src/extension.ts` | `context` hook | 695-734 |
| Lifecycle events use binding-local identities and ignore stale bindings | `doppelganger/packages/host-omp/src/extension.ts` | lifecycle hooks | 498-511, 735-824 |
| Shutdown closes the current binding without fabricating completion | `doppelganger/packages/host-omp/src/extension.ts` | `session_shutdown` hook | 826-840 |
| Neutral package entrypoint reads environment options and delegates | `doppelganger/packages/omp/src/index.ts` | default export | 1-4 |
| Actor binding is the only environment-derived package option | `doppelganger/packages/omp/src/options.ts` | `optionsFromEnvironment` | 3-6 |
| Defensive collision test proves malformed underscore-containing wire descriptors collide and are hidden | `doppelganger/packages/host-omp/tests/extension.spec.ts` | overlong/collision test | 693-729 |
