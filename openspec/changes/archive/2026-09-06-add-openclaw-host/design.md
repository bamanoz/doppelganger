## Context

This change implements an ordinary OpenClaw plugin. The accepted boundary excludes OpenClaw changes and preserves OMP. Source research used OpenClaw commit `837e0b20f479f4fa060bd7a2d50112e279103fb8` in `/tmp/doppelganger-openclaw-research-20260905`; it does not establish identical behavior for a published release. Implementation pins the separately installed `openclaw@2026.9.1` build `ad6fe23aecb9b833d68139b0ddc9f239b894d2f1`. The older checked-in comparative research is a third, distinct snapshot; `docs/operations/verification.md` owns the actual installed-host acceptance outcome.

Governing owners are `docs/architecture/{overview,composition-and-reload,protocols}.md`, `docs/features/mcp-tool-import.md`, `docs/operations/{configuration,verification}.md`, `docs/hosts/oh-my-pi.md`, and live `host-runtime-api`, `extension-protocols`, `mcp-tool-import`, `actor-identity` and `runtime-preset-roster` specifications. The active DSH and memory-context-engine changes remain independent; do not consume their unimplemented APIs or silently rewrite their requirements.

### Source evidence and its limits

| Boundary | Source in the pinned OpenClaw checkout | Observed constraint |
| --- | --- | --- |
| Native registration | `src/plugins/loader-module-runtime.ts`, `registry-registrars-tools-hooks.ts`, `tool-contracts.ts`, `tools.ts` | Registration is guarded and synchronous; factories are synchronous; concrete returned names must be manifest-declared. A wildcard is not an arbitrary-name authorization. |
| Startup ordering | `src/agents/embedded-agent-runner/run/model-setup.ts`, `run/setup.ts`, `run/runtime-preparation.ts`, `run/attempt-tool-prepare.ts` | Normal embedded execution awaits `before_model_resolve` before constructing plugin tools. Locked model selection can bypass the hook; errors/timeouts can continue host execution. |
| Prompt projection | `run/attempt-prompt-helpers.ts`, `run/attempt-prompt-build.ts`, `run/attempt-llm-boundary.ts`, `run/attempt-prompt-submit.ts` under the embedded runner | `before_prompt_build` separates system additions from user/data additions. Embedded execution applies transient projection across the prompt loop and removes it afterward. Retry calls can repeat; compaction that removes the original target needs a dedicated check. |
| Approval and dispatch | `src/agents/agent-tools.before-tool-call.approval.ts`, `agent-tools.before-tool-call.policy.ts`, `agent-tools.before-tool-call.wrapper.ts`, `src/gateway/server-methods/plugin-approval.ts` | Native approval exists; exact portable authorization must still bind the final input, call and revision and survive cancellation checks. |
| Committed transcript observations | `src/plugins/runtime/runtime-events.ts`, `src/sessions/transcript-events.ts` | Post-write rows are observable but optional identities/invalidation-only events do not prove acceptance of a whole turn. |
| Attempt versus accepted turn | `run/attempt-finalize.ts`, `run/attempt-settle.ts`, `run-entry.ts`, `src/auto-reply/reply/agent-lifecycle-terminal.ts` | `agent_end` precedes outer acceptance and can precede later failure. `executionSettled` plus terminal receipts is stronger, but complete original-principal/accepted-response joining is not proved. |
| Exclusive accepted-turn API | `src/context-engine/types.ts`, `src/agents/harness/context-engine-turn-attempt.ts`, `context-engine-turn-outbox.ts` | `commitTurn` has accepted anchors but belongs to the selected context engine. This plugin does not take that slot merely to capture memory. |
| Lifecycle ownership | `src/plugins/host-hook-cleanup.ts`, `src/plugins/host-hook-runtime.ts`, `src/plugins/runtime.ts` | Public cleanup/subscription seams exist; adapter-owned immutable binding epochs and exhaustive cleanup remain necessary. |

The readiness investigation also identified that `McpClientGeneration.start()` contains operational failure and awaits cleanup. Promise fulfillment is not proof of active tools, and `startupTimeoutMs` is not a bound on cleanup completion.

## Goals / Non-Goals

**Goals:**

- Install a real native OpenClaw plugin with individually named native tools, portable Runtime Preset selection and one isolated direct Runtime Host binding per native session generation.
- Make initial MCP tools available predictably with optional strict plugin activation, while preserving existing background behavior for OMP and other consumers.
- Preserve exact tool schema/revision/approval/cancellation semantics, context authority, actor isolation, rollback and teardown.
- State a finite supported execution profile and verify it through the actual native route.

**Non-Goals:**

- No upstream patches, private OpenClaw imports as a shipping dependency, context-engine takeover or mutation of host registries after registration closes.
- No arbitrary dynamic native names, dispatcher tool accepting a tool name, wildcard manifest, automatic manifest rewrite, or promise of mid-loop catalog replacement.
- No generic transport extraction, second host connection/router, new kernel readiness concept, MCP-specific host service, or OMP redesign.
- No automatic candidate capture from approximate turn-end hooks, durable host transcript reconstruction or inference that a channel sender is an authenticated principal.

## Decisions

### 1. A direct preset-neutral host package

`packages/host-openclaw` owns the native plugin entrypoint, deployment preparation, native configuration, immutable session-binding manager, projection and public OpenClaw API translation. Reuse the roster and Composition Runtime public exports and the protected shared Runtime Host/Actor Identity plugins. Keep one workspace Cordis peer. Feature packages remain Loader-composed; the host must not import MCP, memory, Persona or Evolution to discover tools or check feature readiness.

Use an in-process Cordis root owned by the plugin and isolated Runtime Sessions. No OMP child/RPC reuse or generalized transport is necessary. Portable plugin code receives only established protocols; raw OpenClaw APIs and credentials remain adapter-private. Package-boundary changes must be explicit in `scripts/package-boundaries.json`.

Alternative: extracting OMP internals would couple two hosts before common transport requirements exist and risk a working adapter. Rejected.

### 2. Prepared manifest names are a deployment boundary

The preparation entrypoint resolves the selected Runtime Preset with the authoritative roster and normal patch precedence, activates a disposable audited composition, obtains the ordinary immutable tool snapshot, validates native names/schema representability and creates an installable generated plugin artifact. The artifact contains native manifest declarations and a deterministic native-to-canonical mapping, descriptor contract information, and a fingerprint of the preparation inputs/catalog. Do not persist process-local tool revisions for use across activations. Do not include actor identity, secrets, runtime state or raw plugin assets in diagnostic fingerprints.

Preparation runs trusted composition code and configured external MCP commands; it is not passive metadata extraction. Its temporary Runtime Session must be disposed before its temporary root is removed. No invocation of discovered tools is required. Write only the explicitly selected deployment output; never overwrite authored Runtime Preset files, patches, a currently installed plugin, or unrelated user files implicitly. Stage and validate output before publishing it; preparation failure leaves the prior artifact intact.

If an operator wants MCP discovery included before preparation returns, the MCP row must explicitly choose `await-ready`. The generic preparation entrypoint does not inspect `doppelgangerMcp` or secretly rewrite the row. A background catalog may be incomplete; documentation must explain this and runtime undeclared-name diagnostics remain mandatory.

The generated artifact supports its prepared selection/contract, not every arbitrary future preset. At runtime a conflicting explicit/project/user selection is reported, not silently overridden. Preparing another preset means generating its own compatible deployment artifact. Use the same checked native-name projection in preparation and invocation; reject collisions, unsupported JSON Schema semantics and name-length violations before publication rather than truncate or widen them.

Alternative: delaying native `registerTool` until MCP completes is invalid because registration closes synchronously. Registering a universal dispatcher would change the requested native-tool UX and bypass the finite declaration model. Both rejected.

### 3. Synchronous registration, asynchronous warmup, synchronous factories

Plugin registration only declares hooks, services, cleanup and a finite tool factory under the prepared names. It neither awaits a composition nor returns asynchronous factories. Normal embedded `before_model_resolve` awaits one shared activation promise for the immutable native binding. The configured OpenClaw conversation-hook permission is a deployment prerequisite.

The manager tracks absent/activating/ready/failed/disposing/disposed states and binding epochs. Concurrent warmups for the same native session share activation; different native sessions never share a Runtime Session. Host warmup timeout or scope disposal fences the attempt against late publication and starts owned cancellation/disposal; do not claim an OpenClaw hook timeout automatically aborts the underlying work. An aborted activation is not automatically retried in the same binding; an explicit fresh binding/restart is the recovery boundary.

Factories read only a successfully published immutable ready snapshot. If the hook was skipped, timed out or failed, they return no Doppelganger tools and report a bounded readiness diagnostic. They never block synchronously, return a Promise, expose stale tools or start an unowned connection. Invocation rechecks readiness and epoch independently. The native host may continue without Doppelganger: the hook is warmup, not a fail-closed host admission gate. The adapter must not report the Runtime Session as healthy in that case.

The host package must use a finite activation deadline consistent with its supported deployment, account for configured hook timeout policy, and name the deadline in diagnostics. This is distinct from each MCP startup deadline and exhaustive cleanup. Before shipping, verify a public cancellation/disposal route for activation-in-progress; if it is unavailable, retain owned settlement/cleanup and reject the supported-startup claim rather than leak a late session.

### 4. MCP readiness stays inside the ordinary Loader plugin

Authored root field: `startupMode: background | await-ready`, default `background`. Normalize all configuration before any connection. Unknown modes fail at this boundary. Disabled servers are excluded; no enabled servers satisfy the readiness barrier immediately.

Both modes install all initial server owners and start enabled generations concurrently. The service can be published before external readiness. Each successful server still commits its complete set atomically; valid zero-tool sets count as ready. There is no new globally atomic cross-server publication promise.

For `await-ready`, capture the initial generation identities and await explicit startup outcomes through successful initialization, paginated discovery, schema validation and atomic commit. Before successful apply completion, revalidate every captured generation as current and active. A failed, timed-out, cancelled, replaced or disposed generation must not satisfy the barrier or be silently replaced by a different generation. Throwing from apply uses the existing Loader/Composition activation failure path and tears down all owners in that attempted Runtime Session, including already-ready siblings.

Expose the terminal outcome internally separately from cleanup tracking. Existing `start()` promise fulfillment must not be interpreted as success. Keep per-server `startupTimeoutMs` spanning startup through commit; asynchronous waiting does not block the JavaScript event loop. On failure stop publication eligibility promptly, then await exhaustive owned cleanup before activation rejection is finally handed to the caller. The startup decision is bounded; cleanup duration is not promised to fit the startup deadline. No new retry, required-server subset, aggregate user setting, fallback command or public readiness protocol is introduced.

Mode applies to initial plugin apply, including fresh row insertion/recreation. Accepted in-place `internal/update` retains equivalent generations and starts changed/added generations in the background after retiring prior ones. List-change refresh remains dynamic at the portable registry. Changing the mode in-place changes configuration for the next apply, not a retroactive startup barrier. A fresh apply during composition reload can fail strict readiness and participate in existing audited rollback; do not confuse that with background operational failure of an accepted in-place replacement.

Alternative: all-startup-promises-settled would allow failed servers and is not the selected all-ready policy. Polling service snapshots from the host would couple it to MCP and miss clean generation/cancellation ownership. Rejected.

### 5. Fixed native catalog with live stale-call protection

Advertise `tools.delivery: session-start`, not `dynamic` and not the nonexistent enum `static`. The ready snapshot may be used at the next native factory construction boundary. Within an active tool loop, captured native closures keep their exact session epoch, canonical name and runtime descriptor revision.

`toolCatalogChanged(revision)` remains the only registry-change callback. It can update the adapter's validated pending snapshot and diagnostics, but cannot mutate the host registry or promise a rebuild. A removed/replaced descriptor immediately fails through existing bridge revision/availability checks. Never silently retarget an old closure to a new implementation. A later factory construction can bind a current declared descriptor; new undeclared names require artifact regeneration and native plugin reload/restart. Descriptor schema changes invalidate old closures even when the name remains declared; projection at a later native construction boundary requires schema validation and explicit compatibility with the prepared contract, otherwise regeneration is required.

Catalog refresh, valid Loader reload and MCP `list_changed` continue to work inside Doppelganger. They do not enlarge the native manifest. If the host happens to rebuild tools for permission changes, this is not a general refresh API and must not be advertised as one.

This supports prepared Persona/memory/Evolution/MCP control names. Dynamic Runtime Plugin controls may be prepared, but arbitrary generated native tool names are not supported. Generated code still requires exact native approval; successful registry registration is not proof of native tool exposure. Do not label that integration full unrestricted Dynamic Runtime Plugin parity.

### 6. Native approval and cancellation remain exact

Use ordinary public `api.on('before_tool_call', handler)` returning `requireApproval` with `allowedDecisions: ['allow-once', 'deny']` and `onResolution`. The host owns its native approval request/wait path; a separate trusted-tool-policy registration or direct `runtime.gateway.request` is not needed. Capture run/call identity, binding epoch, canonical name, revision and cloned arguments in the handler closure. `onResolution` receives only a decision and its Promise is not awaited: record the result synchronously in adapter-owned call state; do not dispatch from the callback. Native finalizers/validation can run after approval, so execute must compare final arguments and consume the exact record atomically immediately before bridge invocation. The approval RPC does not carry Doppelganger revision or input digest; adapter validation supplies that boundary.

Capture and clone final input, canonical tool name, opaque revision, native call ID and binding epoch. Present the real native approval request and mint the portable protected grant only after its genuine allow-once result. Revalidate input digest, current descriptor, epoch and cancellation after the approval wait. Denial, timeout, absent presentation route, untrusted policy result, changed input or revoked session fail before invocation. No persistent allow grant, chat yes/no approval, fabricated UI, or approval derived from a tool annotation.

Forward the native execute signal into `cancelTool(callId)` and remove listeners after settlement. Disposal cancels all active calls and approval waits. Cancellation is cooperative: do not fabricate a cancelled/successful result after an irreversible side effect. Detached callbacks cannot complete a call belonging to a replacement binding.

### 7. Context, principal identity and lifecycle are separate

For the supported embedded direct-user route, resolve portable context once per admitted run/turn and reuse that assembly across retries and tool continuations. Use bounded adapter-minted request IDs; never infer an accepted turn merely from a run ID. `before_prompt_build` maps instruction projection to system-context additions and data projection to transient user-context additions, preserving deterministic order/provenance and the common token budget. Do not concatenate data into system text or replace the user's entire system prompt.

Prove that injected context does not persist in canonical transcript and remains correctly scoped through continuation. Treat context resolution failures as bounded omission, not reuse from another user/turn. Mid-turn compaction, raw probes and external harness paths need explicit supported-route tests; unsupported paths get diagnostics and no unverified delivery claim.

Native `sessionKey` is a route alias; `sessionId` can rotate. Bind an immutable tuple of native agent/session generation, workspace and explicitly trusted actor configuration. A project path or optional sender field alone cannot identify a principal. Install a separate bound/unbound actor provider; unresolved/group/mixed sender custody remains unbound or rejected for actor-dependent use, never first-sender-wins. Do not map a gateway-global configured actor onto arbitrary multi-user sessions. On changed principal, workspace, reset or replacement, retire the old binding before creating another; old callbacks stay fenced. No actor fields enter shared Runtime Host metadata.

Initial lifecycle profile includes only events proven through the adapter's owned session/call transitions; determine exact standard names from the existing protocol, not native-name similarity. Explicitly omit `turn-committed` in the baseline. Consequently automatic candidate capture is unavailable in this profile; explicit memory operations and recall are separate capabilities. Neither `agent_end` nor successful transcript writes can synthesize acceptance. A future live-only accepted-turn join may be investigated without requiring crash replay, but enabling it requires separate requirement/evidence changes. Do not reserve the context-engine slot.

### 8. Exhaustive teardown and truthful conformance

Register Cordis disposal and native unsubscribe ownership before external startup. On reset/end/replacement/plugin disable/gateway shutdown, fence the binding first, reject new calls, cancel active work, detach callbacks, dispose Runtime Sessions and owned roots, and attempt all cleanup stages even if one throws. Report aggregate sanitized cleanup failures; never leave the session map pointing to a disposed instance.

Adapt only test fixture support for fixed-capability adapters. Exercise the real plugin/factory/invocation binding, not a direct bridge labelled OpenClaw. Predeclare the fixture's finite names. Preserve common isolation, revision, approval, cancellation, undeclared lifecycle and teardown cases; add separate checks that the native model cannot discover undeclared names or receive an unsupported mid-loop refresh. Keep OMP's existing dynamic and transported cases unchanged and retain actor absence at the common protocol boundary.

## Risks / Trade-offs

- [Ready manifest does not imply ready runtime] → Separate preparation, runtime activation and synchronous factory guards; test startup failure and skipped hooks.
- [OpenClaw source differs from release] → Pin an installable supported revision/version and public SDK exports, run native smoke there, publish the tested matrix; no compatibility claim from a version string alone.
- [Native parameters can change after approval] → Execute revalidates final input, binding and revision against the synchronous allow-once record; a pre-tool hook merely having run is never a grant.
- [Warmup hook is bypassable and timeout does not cancel work] → Fence manager epochs and factories independently; report unavailable integration without claiming host admission was blocked.
- [Strict startup failure tears down healthy sibling servers] → Explicit opt-in and documentation; preserve background default and test both policies.
- [Slow cleanup outlives startup timeout] → Separate terminal readiness outcome from awaited resource cleanup; expose diagnostics without claiming a hard cleanup deadline.
- [MCP catalog or generated tools drift after preparation] → No native wildcard/dispatcher; reject undeclared/incompatible descriptors and instruct explicit regeneration/restart.
- [Group/aggregate ingress cannot identify one principal] → No guessed actor or candidate capture; require trusted binding and mark unsupported paths.
- [Context compaction/external harness retention differs] → Verify actual supported surface and exclude unproved routes; do not claim per-request delivery.
- [Runtime plugins execute trusted code in-process] → Preserve existing process-authority warning; native approval is not a sandbox.

## Migration Plan

1. Implement and verify the optional MCP mode while retaining the existing default and OMP behavior. No existing preset migration is required.
2. Add the native package and preparation command, pin a tested OpenClaw SDK/runtime, validate packaging and one Cordis root, and produce an installable artifact from a temporary test composition.
3. Opt in to `await-ready` in the operator-owned MCP row when a complete initial MCP catalog is required. Prepare and inspect the generated tool declaration artifact, then install it with OpenClaw's normal plugin configuration and conversation-hook permission.
4. Run the native embedded smoke with two sessions, initial MCP discovery, context, exact approval/cancellation and failure/teardown boundaries. Document unsupported paths before declaring support.
5. Roll back by disabling/removing the generated OpenClaw plugin through native lifecycle, retaining authored presets/state, and optionally removing the MCP startupMode field to restore its default. Do not roll back or mutate unrelated OMP deployments.

## Open Questions

No user product choice blocks this planning artifact. These are implementation research gates, not permission to weaken the contract:

- Which installable OpenClaw version/revision preserves the observed public SDK exports and `before_tool_call.requireApproval.onResolution` behavior? Verify before dependency pinning.
- What public cancellation/disposal route covers a warmup activation still in progress, and what finite activation deadline fits the tested OpenClaw hook policy? Prove late-result fencing even if cleanup settles later.
- Which standard lifecycle events can the real embedded adapter publish faithfully? Keep unproved kinds, especially `turn-committed`, absent.
- Does the chosen embedded compaction path retain the original user projection through continuation? If not, explicitly scope the supported route rather than silently claim stronger context delivery.

None of these gates authorizes an upstream patch, a context-engine replacement, a generic transport extraction, or automatic expansion of this change.
