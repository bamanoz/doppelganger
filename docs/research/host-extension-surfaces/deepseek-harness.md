# DeepSeek Harness host-extension surface

This record captures the DeepSeek Harness (DSH) host surface for the planned Doppelganger adapter. It is static source research, not a claim that a host adapter is running.

## Snapshot

| Field | Value |
|---|---|
| Repository | [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| Exact commit | `4e84901e6471b79ec0338099867ebb4606d12bb5` |
| Research date | 2026-09-03 |
| Support status | Designed in the active OpenSpec change; not implemented |

## Native extension model

DSH is a Cordis composition runtime. A thin CLI selects a profile, plugin-management, or config-dump mode; profile boot creates one root Cordis `Context`, installs `Loader`, mounts the root Include tree, awaits the loader, and audits activation. Profile layers and user overlays are patch-composed, with optional HMR watchers. A plugin is a Cordis entry/fiber, and service values are resolved through proxy-scoped contexts. This makes an in-process adapter the natural boundary: the host owns the root context and can mount a Doppelganger composition as ordinary Cordis plugins without a second transport or a second Cordis singleton.

The current host wording requires the adapter to reuse that host-owned root, agent scopes, awaited prompt assembly, scoped native tools, committed Session log, and quiescent teardown. It also explicitly keeps host-specific UI/provider/packaging details out of the portable core. The active design therefore treats DSH projection as a host integration layer, while context, tool, lifecycle, actor, and state contracts remain portable.

## Root boot, Loader update, and rollback

`apps/cli/src/bin.ts` dynamically imports only the selected runner. `runProfile()` composes bundle/profile/home/overlay patches, snapshots launch environment and command-line facts before config-tree entries mount, then calls `boot()`. `boot()` creates the sole root Context, installs Loader, runs host preparation, mounts `cordis:include`, awaits the complete tree, and runs the loaded/activated audits. A failure disposes the partial root fiber before rethrowing a labelled error. `installFailLoud()` handles late unhandled rejections and gives teardown a bounded chance before fatal exit.

Reload is a transactional Loader/fiber operation rather than a mutable global registry. `watchUserPatches()` re-reads and updates the Include entry through HMR; Cordis Fiber `update()` validates/resolves the new configuration, runs `internal/update`, and restarts. Fiber disposal is the rollback primitive: failed activation is disposed and previously registered effects unwind. `runPlugin()` initializes a missing profile, forwards pnpm arguments, and reconciles bundle layers only after a successful package operation. `runDumpConfig()` uses composition preparation without booting or evaluating config code.

**Adapter consequence:** install Doppelganger only during `prepare`, under this root, and retain the returned disposer in the owning root/agent fiber. Never construct an independent Cordis root or mutate DSH's Loader tree behind its transaction boundaries.

## Fiber disposal and lifecycle

Cordis effects return synchronous or asynchronous disposers. Disposers run in reverse registration order, await asynchronous cleanup, and are single-shot. Child fibers are themselves effects of their parent; failed setup is cleaned before the error escapes. A running dynamic host half is a child of the `cordis-dynamic` group and `retract()` removes handlers, awaits its Fiber disposal, then emits the retraction event. DSH's profile shutdown calls the root fiber disposer, so adapter resources must be owned by that same tree.

The lifecycle boundary is quiescent rather than cancellation-only: started tool bodies are allowed to settle, pending initiator work is drained as the registry closes, and teardown must not publish an event after its owning attachment has been removed. The adapter should use ordinary Cordis effects and await their release, not detached process callbacks.

## Service isolation and injection

A Cordis Context is a proxy-scoped object. `extend()` adds metadata, `isolate(name, label?)` gives a service a new independent scope (same labels join), and `intercept()` supplies descendant-only configuration. Service configuration is merged through `resolveConfig()` from ancestor intercepts followed by local values. DSH uses these seams for provider and consumer scope isolation; service injection can leave a Fiber pending until required services appear, while optional lookups use `ctx.get()`.

The DSH dynamic host runner deliberately exposes a whitelist façade (`ctx.get`, `ctx.on`, `ctx.provide`, `ctx.effect`) rather than framework internals. Its sandbox redirects filesystem, network, process, and timers to declared Cordis services. This is cooperative isolation, not a security sandbox: generated same-process code and host extensions remain trusted. A Doppelganger adapter should use the real in-process Context for its own trusted bridge and should not describe Cordis scopes as authorization or security boundaries.

## Agent and session scopes

`SessionStore` mints collision-checked `session-<n>` identities and creates immutable headers carrying version, id, timestamp, cwd, parent lineage, seed status, origin, delegation depth, and agent preset. `Session.id` comes from the durable header, not the event log. Sessions can be prepared, entered, announced, flushed, and forked; the advanced prepare/enter/announce path lets an agent factory place session and agent publication in one ordered effect.

`AgentRegistry` uses the same `SessionId` as live agent identity but keeps runtime ownership separate from durable lineage. `enter()` records an exact live instance and owner, `announce()` publishes `agent/created`, and disposal emits the paired `agent/disposed`. `roots()` reports runtime roots, so a resumed/forked session may be a runtime root. Agent dispatch fuses the payload's agent subject with `scopeTarget(agent, agent)`, preventing a mismatched subject and scope. `assembleContextFor()` supplies `{ agent, scope, signal? }` for each request.

`UserQuestionService` is intentionally separate from approval. Human questions are valid only for the exact live runtime root; a delegated child has no answerer and fails rather than waiting forever. This distinction matters to an adapter: actor ownership and human-answer routing must use live agent identity, not merely durable parent metadata.

## Prompt assembly and context

`SystemPrompt.assemble(context)` collects global and scope-chain variables, sections, contexts, and tool providers. Scoped definitions shadow global definitions by name; sections are sorted by explicit order and name, and tools use configured order with a required rest marker or deterministic lexical order. Provider functions run during each awaited assembly, so dynamic Doppelganger context belongs in the `system-prompt/assemble` waterfall, not in a synchronous global provider. A complete section is restored after cooperative assembly, and multiple complete sections fail.

The assembly context's signal is request-specific and must not be retained for later turns. Model selection is captured at assembly time. Surface-visible history is not an arbitrary prompt side channel: only `user/message`, `assistant/message`, and `tool/result` events are eligible, each with explicit surface operations and provenance constraints. The adapter should contribute portable actor/workspace context through this awaited, agent-scoped seam and preserve DSH's ordering and complete-section rules.

## Native tool and approval pipeline

`ToolRuntime` centralizes `tools/pre-execute`, approval resolution, guard checks, `tools/execute`, cancellation fusion, `tools/post-execute`, final materialization, and `tools/result`. Agent-scoped listeners are filtered by the tool's agent. The original caller signal is fused back into around-wrapper execution; cancellation does not abandon an already-started body. Results are frozen before observer notification and observer failures are contained.

An `ask` pre-execute decision goes to `ApprovalService` when present. The service accepts only `allowed-once`; `rejected`, `cancelled`, and `unavailable` become distinct fail-closed outcomes. Requests require an open turn and append a durable `approval/asked`/`approval/decided` pair. A missing service or agent also denies. `policy: never` is represented in the prompt and is an explicit deny posture; `approval/policy` is log-only state, not a bypass.

The native DSH tool path is therefore the adapter's preferred tool seam. Portable Doppelganger qualified tools should be registered in DSH's scoped registry and dispatched through `tools/pre-execute` plus ApprovalService. Do not route required approval through a second host UI or grant a portable one-shot operation merely because a DSH dynamic runner has its own client authorization.

## Durable Session events, replay, and state

`Session.append()` snapshots and validates lossless JSON, assigns contiguous branded `SessionSeq`, validates surface metadata, commits to the append-only log, and then synchronously notifies contained observers. Observer failure cannot retract a committed event. `Session.snapshotEvents()` returns immutable ranges; `ownEvents()` separates fork-inherited history from child-owned events. `request/header` is log-only and reconstructed by folding snapshots, not maintained as mutable durable state.

The type vocabulary explicitly includes turn/step, user and assistant messages, tool calls/results, request headers/context, approval records, lifecycle records, and extension-compatible events. `KNOWN_SESSION_EVENT_TYPES` rejects unknown non-ignorable events during persistence reads, so a normalized adapter must either use known portable vocabulary or mark truly omission-safe foreign events ignorable according to the host contract. Distinguish `SessionSeq` (an existing event identity) from `SessionLogOffset` (a prefix length/read offset); replay boundaries such as `firstLiveSeq` must not conflate them.

Persistence is plugin-owned: `SessionStore.flush(session)` is the single awaited `session/flush` entry point and dispatches through the captured scope carrier. A host adapter should append durable state through Session APIs and flush through the store, never write a parallel conversation log or call a raw unscoped flush event.

## Dynamic runners, trust, and reload

The implemented DSH extension package `@deepseek-ai/dsh-cordis-host-runner` owns a process-local definition registry, VM sandbox, host-half Fiber lifecycle, and invoke handlers. Definitions are session-scoped and disappear on DSH restart. A Plugin contains immutable Package versions; `currentPackageId` and `nextPackageId` encode successful and target revisions, while `run` versus `update` distinguishes restart from version switch. Host-only packages activate directly; packages with client code emit a request and wait for a page/user outcome. `stop` retracts handlers and awaits the host Fiber, retaining the definition; `undefine` stops and deletes it.

The runner's `node:vm` environment removes or redirects Node APIs, validates JSON/schema boundaries, and exposes `harness.handle`, `harness.defineTool`, and `harness.registerTool`. Its own README explicitly says the sandbox is not containment. Host runner approval and browser-half authorization are host-specific; portable Doppelganger Runtime Plugins remain a separate Runtime Preset feature and must not depend on the DSH runner's semantics. In particular, each portable `runtime-plugin.run` needs its own one-shot portable approval even if DSH's dynamic runner would otherwise authorize a client run.

The browser half is a separate package. `DynamicCordisPackageRunner` evaluates each client half in its own closure, serializes load/unload by plugin id, tracks component ownership, and seats it under the page Loader. Reload invalidates the module before registering a new factory; page refresh clears live definitions. This is useful evidence for DSH's native dual-half model, but a portable in-process Doppelganger adapter should not require a browser half for core context, tools, actor, or persistence behavior.

## Scope, state, reload, and trust summary

| Surface | Native DSH behavior | Adapter rule |
|---|---|---|
| Context | One host-owned root plus proxy/scoped child contexts | Mount directly in that root; use explicit agent carriers |
| Tools | Scoped registry and ordered pre/execute/post pipeline | Register portable tools natively; preserve schemas and signal fusion |
| Approval | Turn-enclosed durable ask/decision, only `allowed-once` grant | Delegate required approval to ApprovalService; fail closed |
| Lifecycle | Loader entries and Fibers with awaited reverse disposal | Own every bridge resource with a Fiber effect |
| Agent/session | Runtime ownership is distinct from durable lineage | Partition by exact live agent/session identity |
| Prompt | Awaited per-assembly scoped waterfall and deterministic ordering | Inject dynamic context in `system-prompt/assemble` |
| State | Append-only Session events; header fold; store-owned flush | Use known event vocabulary and the single flush entry point |
| Reload | Patch/HMR updates are transactional; dynamic package versions immutable | Treat current/next as explicit transition state; rollback by disposal |
| Trust | Cordis scopes and VM façade are cooperative, not security boundaries | Keep portable policy/approval separate from host trust |
| Packaging | Workspace packages use peer Cordis dependencies and shared fallback healing | Avoid duplicate Cordis roots; keep host-specific packages out of portable core |

## Doppelganger adapter fit

Direct in-process Cordis integration is preferred because it preserves the governing DSH invariants instead of recreating them over RPC: one Loader/Cordis root, one service graph, one Fiber ownership tree, agent-scoped dispatch carriers, awaited prompt assembly, native tool/approval sequencing, and Session's commit/flush boundaries. The adapter consumes the shared actor-neutral Runtime Host bridge directly and projects it onto DSH's actual Context, AgentRegistry, SystemPrompt, ToolRuntime, ApprovalService, and SessionStore. This also lets DSH's own rollback dispose the bridge before the terminal or process exits.

An out-of-process or child-transport adapter would duplicate context identity, lose exact Fiber disposal ordering, require a second cancellation/approval protocol, and risk writing events outside the committed Session append boundary. It would also make package resolution prone to a second Cordis installation. DSH's package manifests reinforce the direct approach: core and extension packages declare `@deepseek-ai/cordis` as a peer, while workspace fallback healing projects one shared installation into profiles. The adapter must therefore bind the public shared API under the existing root, not define another bridge or standalone runtime product.

## Compatibility gaps

- **Support is not live:** DSH support is designed in an active OpenSpec change and is not implemented in this repository.
- **No portable transport substitute:** DSH's browser runner, remote Typert namespaces, and UI/provider packages are host-specific; portable core must not require them.
- **Trust is cooperative:** Cordis service isolation and the dynamic VM façade do not establish a security sandbox. Authorization must remain an explicit portable policy.
- **Approval seams differ:** ApprovalService handles tool approval; UserQuestionService handles human questions. They cannot be collapsed into one generic answer channel.
- **Event vocabulary is strict:** Unknown durable events require an explicit ignorable marker; a portable adapter must plan its event mapping rather than silently dropping data.
- **Identity types differ:** Session event positions and replay offsets are branded separately, and runtime agent ownership differs from durable session lineage.
- **Ephemeral dynamic definitions:** DSH dynamic runner definitions are process-local and are not durable package state. Portable Runtime Plugin Package versions need their own persistence/transition contract.
- **Package topology is split:** Host runner and client runner are separate packages, with client-only dependencies kept off host composition. A host-only adapter must not pull browser UI/provider dependencies into portable core.
- **Host reload ownership:** DSH Loader/HMR owns profile recomposition. An adapter cannot assume it may independently replace root entries or retain stale service references across generations.

## Seven-item research-gate checklist

1. **PASS — Root boot and Loader activation/rollback:** CLI routing, `boot()`, root Include mount, activation audits, fail-loud release, and partial-root disposal traced.
2. **PASS — Fiber disposal:** reverse-order awaited effects, failed-child cleanup, root shutdown, dynamic retract, and single-shot disposer semantics traced.
3. **PASS — Services, injection, and isolation:** proxy contexts, isolated service labels, intercept config merge, pending required injection, and cooperative trust boundary traced.
4. **PASS — Agent/session scopes:** Session headers/store lifecycle, AgentRegistry ownership and paired publication, fused agent scope carriers, and root-vs-lineage distinction traced.
5. **PASS — Prompt assembly:** deterministic sections/tools, scoped shadowing, awaited assembly context, complete-section restoration, and signal lifetime traced.
6. **PASS — Native tools and ApprovalService:** pre/approval/guard/execute/post/result pipeline, cancellation fusion, turn-enclosed audit pair, and fail-closed outcomes traced.
7. **PASS — Dynamic runners and package topology:** immutable package transitions, host/client runners, sandbox trust, retract/disposal, peer Cordis dependencies, and fallback healing traced.

## Source evidence

| Claim | Path | Symbol | Lines |
|---|---|---|---:|
| CLI selects profile, plugin, or dump-config runner | `apps/cli/src/bin.ts` | mode dispatch | 24-45 |
| CLI parses profile, patch, and dump modes | `apps/cli/src/args.ts` | `parseDshArgs`, `resolveBoot` | 83-145 |
| Config dump is boot-free and composes layers | `apps/cli/src/dump-config.ts` | `runDumpConfig` | 30-36 |
| Profile boot composes patches and owns shutdown | `apps/cli/src/profile-boot.ts` | `runProfile` | 209-263 |
| Live patch watchers update Include transactionally | `apps/cli/src/profile-boot.ts` | `runProfile` | 270-298 |
| Layered environment is loaded before composition | `packages/boot/app-boot/src/index.ts` | `loadLayeredEnv` | 180-183 |
| HMR watcher updates Include config and handles disposal race | `packages/boot/app-boot/src/index.ts` | `watchUserPatches` | 235-263 |
| Root Include mounts Loader and group builtins | `packages/boot/app-boot/src/index.ts` | `mountRootInclude` | 501-543 |
| Late rejection handling releases before fatal exit | `packages/boot/app-boot/src/index.ts` | `installFailLoud` | 624-663 |
| Loader entries are audited for load/activation failures | `packages/boot/app-boot/src/index.ts` | `assertEntriesLoaded`, `assertEntriesActivated` | 673-740 |
| Boot creates one Context, installs Loader, mounts, audits, and disposes on error | `packages/boot/app-boot/src/index.ts` | `boot` | 742-818 |
| Profile fallback creates managed links/proxies | `packages/boot/app-boot/src/profile.ts` | `ensureSymlink`, `ensureModuleProxy` | 229-299, 434-480 |
| Shared fallback reconciliation uses a file lock | `packages/boot/app-boot/src/profile.ts` | `healProfilesModuleFallback` | 579-591 |
| Profile-local fallback is projected and reconciled | `packages/boot/app-boot/src/profile.ts` | `healProfileModuleFallback` | 643-675 |
| Contexts extend, isolate, and intercept service scopes | `vendor/cordis/src/context.ts` | `extend`, `isolate`, `intercept` | 99-145 |
| Service intercept configuration merges through ancestors | `vendor/cordis/src/service.ts` | `Service.resolveConfig` | 86-101 |
| Cordis has explicit dispatch modes and diagnostics | `vendor/cordis/src/events.ts` | `DispatchMode`, `dispatch` | 32-35, 160-170 |
| Effects dispose reverse-order and await async cleanup | `vendor/cordis/src/fiber.ts` | `Disposable`, `effect` | 69-72, 475-548 |
| Fiber restart/update validates and runs update waterfall | `vendor/cordis/src/fiber.ts` | `restart`, `update` | 718-752 |
| Loader normalizes exports and locates owning entries | `vendor/loader/src/index.ts` | `Loader.locate`, `unwrapExports` | 172-199 |
| Prompt definitions and assembly semantics are scoped and ordered | `packages/core/system-prompt/src/index.ts` | `PromptSection`, `assemble` | 20-73, 536-600 |
| Prompt tools use deterministic configured/rest ordering | `packages/core/system-prompt/src/index.ts` | `orderTools` | 200-219 |
| Agent payload and scope carrier are fused | `packages/core/agent/src/dispatch.ts` | `agentEvents`, `assembleContextFor` | 94-175 |
| Agent registry separates owner from lineage and pairs lifecycle | `packages/core/agent/src/index.ts` | `AgentRegistry.enter`, `announce`, `roots` | 426-611 |
| Session IDs derive from durable headers | `packages/core/session/src/index.ts` | `Session.id`, `Session.header` | 435-459 |
| Session append snapshots, sequences, commits, and notifies | `packages/core/session/src/index.ts` | `Session.append` | 628-713 |
| Request headers fold from durable events | `packages/core/session/src/request-header.ts` | `foldRequestHeader` | 56-70 |
| Session event positions and offsets are distinct brands | `packages/core/session/src/types.ts` | `SessionSeq`, `SessionLogOffset` | 28-55 |
| Surface eligibility is limited to three event types | `packages/core/session/src/types.ts` | `SurfaceEventType` | 365-377 |
| Surface fold rejects unsupported metadata and constrains rewrites | `packages/core/session/src/surface.ts` | `isSurfaceEligibleType`, `assertToolResultRewrite` | 22-35, 296-325 |
| Unknown durable events require known type or ignorable marker | `packages/core/session/src/known-event-types.ts` | `KNOWN_SESSION_EVENT_TYPES` | 9-24, 49-74 |
| SessionStore mints, enters, announces, and flushes sessions | `packages/core/session/src/index.ts` | `SessionStore.create`, `prepare`, `enter`, `flush` | 856-905, 927-1010, 1073-1103 |
| Tool pipeline includes pre/execute/post/result and scoped signals | `packages/core/tools/src/index.ts` | Tool event declarations | 144-189 |
| Tool execution applies approval, guards, cancellation, and dispatch | `packages/core/tools/src/index.ts` | `prepareExecution`, `dispatchToolBody` | 1466-1551 |
| Tool results are materialized, frozen, and observer-contained | `packages/core/tools/src/index.ts` | `finishScheduledExecution`, `notifyResult` | 1592-1667 |
| Tool approval maps all outcomes fail-closed | `packages/core/tools/src/index.ts` | `serviceAsk` | 1669-1719 |
| Approval is turn-enclosed and durably audited | `packages/interaction/user-approval/src/index.ts` | `ApprovalService.request` | 189-225 |
| Approval policy is scoped and prompt-visible | `packages/interaction/user-approval/src/index.ts` | `ApprovalService` | 142-166 |
| User questions are a separate live-root-only seam | `packages/interaction/user-questions/src/index.ts` | `UserQuestionService.ask` | 64-89 |
| Dynamic runner owns registry, sandbox, and host lifecycle | `packages/extensions/cordis-host-runner/src/index.ts` | `DynamicCordisRunnerService` | 123-149 |
| Dynamic runs arm approval and track immutable targets | `packages/extensions/cordis-host-runner/src/index.ts` | `DynamicCordisRunnerService.run` | 238-312 |
| Dynamic runner retracts handlers and awaits host Fiber | `packages/extensions/cordis-host-runner/src/index.ts` | `retract`, `requireGroup` | 1219-1240 |
| Dynamic registry stores immutable packages and transition pointers | `packages/extensions/cordis-host-runner/src/registry.ts` | `DynamicCordisPlugin`, `DynamicCordisDefinition` | 37-70 |
| Host dynamic lifecycle disposes failed starts and reports missing services | `packages/extensions/cordis-host-runner/src/lifecycle.ts` | `startHostHalf`, `missingServices` | 15-56 |
| VM sandbox redirects Node APIs and is not containment | `packages/extensions/cordis-host-runner/src/sandbox.ts` | `createSandbox`, `NODE_API_REDIRECTS` | 1-11, 89-145 |
| Host façade exposes restricted Context and tool handlers | `packages/extensions/cordis-host-runner/src/sandbox.ts` | `HOST_BUILTIN_INSPECTION` | 17-43 |
| Host inspect registry validates and routes scoped queries | `packages/extensions/cordis-host-runner/src/inspect-registry.ts` | `CordisInspectRegistryService.query` | 44-125 |
| Host runner package peers the shared Cordis and core contracts | `packages/extensions/cordis-host-runner/package.json` | `peerDependencies` | 46-70 |
| Client runner is a separate browser-facing package | `packages/extensions/cordis-client-runner/package.json` | package exports and client injection | 16-37, 44-61 |
| Browser runner serializes load/unload and tracks package ownership | `packages/extensions/cordis-client-runner/src/client/runtime.ts` | `DynamicCordisPackageRunner` | 176-220, 334-380 |
| Workspace topology separates vendor, package, app, and runtime roots | `pnpm-workspace.yaml` | `packages` | 1-17 |
| Host aggregate type-checks the host side separately from client | `tsconfig.host.json` | host aggregate | 1-10 |
