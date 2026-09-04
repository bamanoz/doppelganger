## Purpose

Define the native DeepSeek Harness host boundary that activates isolated Doppelganger Runtime Sessions inside DSH agent scopes, binds the actor-neutral shared Runtime Host API directly in-process, projects context, revisioned tools, cancellation, declared lifecycle events, and independently configured Actor Identity, and preserves reload and failure behavior without an RPC child or parallel bridge.

## ADDED Requirements

### Requirement: DSH activates one selected Runtime Session per agent
The native DSH host SHALL resolve the Runtime Preset through the injected authoritative roster using explicit, project, user-default, and deployment-default precedence. The normal roster deployment SHALL select the shipped actor-neutral `standard` preset on a fresh home. For a selection, the host SHALL activate one independent Doppelganger Runtime Session under the DSH agent-owned Cordis Context using the DSH session identity and optional absolute workspace root. It SHALL complete or join activation before the first Doppelganger-dependent prompt assembly or tool projection is used.

#### Scenario: Selected preset activates before first request
- **ID**: `host.dsh.activation.selected-before-request`
- **EVIDENCE**: `planned:packages/host-dsh/tests/vertical.spec.ts::activates a selected preset before the first DSH model request`
- **WHEN** a DSH agent with a selected healthy Runtime Preset begins its first prompt assembly
- **THEN** that agent has one audited Runtime Session whose context and tools are available to the request


#### Scenario: Fresh DSH home activates standard
- **ID**: `host.dsh.activation.standard-default`
- **EVIDENCE**: `planned:packages/host-dsh/tests/vertical.spec.ts::activates the shipped standard preset on a fresh DSH home`
- **WHEN** a DSH deployment uses the normal roster configuration and no higher-precedence selection exists
- **THEN** the agent activates the shipped actor-neutral `standard` Runtime Preset without copying preset assets into Doppelganger home

#### Scenario: No preset is selected
- **ID**: `host.dsh.activation.no-selection`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::leaves DSH usable when no Runtime Preset is selected`
- **WHEN** the injected roster is explicitly configured without a deployment default and explicit, project, and user configuration select no Runtime Preset
- **THEN** Doppelganger remains inactive for that agent while the DSH agent continues without Doppelganger context or tools

#### Scenario: Two DSH agents select the same preset
- **ID**: `host.dsh.activation.concurrent-isolation`
- **EVIDENCE**: `planned:packages/host-dsh/tests/vertical.spec.ts::isolates concurrent DSH agents using the same Runtime Preset`
- **WHEN** two live DSH agents activate the same Runtime Preset concurrently
- **THEN** each agent owns distinct plugin instances, registrations, lifecycle state, and reload ownership

### Requirement: DSH supplies host-owned activation inputs and protected plugins
The native host SHALL derive the stable Runtime Session ID from the DSH session, derive the optional workspace root from the DSH session header, request selection and canonical user/project patch paths from the injected roster service, and install the shared Runtime Host plugin after caller-controlled layers with one immutable closed DSH capability profile. Actor Identity SHALL be mounted only through a separate protected actor plugin in configured absent, unbound, or bound state. Authored Runtime Presets and patches SHALL NOT replace or remove runtime-owned plugins. The host SHALL NOT duplicate roster roots, trust, discovery, authoring, deployment-default policy, protocol service lookup, or shared bridge contracts.

#### Scenario: Project and user patches apply in order
- **ID**: `host.dsh.activation.patch-order`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::applies user and project patches in canonical order`
- **WHEN** both optional user and project Runtime Preset patches exist for a DSH workspace
- **THEN** activation applies the selected preset, user patch, project patch, explicit host patch, and one deterministic protected runtime-owned plugin set in canonical order

#### Scenario: Agent has no workspace root
- **ID**: `host.dsh.activation.workspace-optional`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::activates a user-selected preset without workspace metadata`
- **WHEN** a DSH session has no workspace path but user configuration selects a Runtime Preset
- **THEN** the Runtime Session activates without project discovery and omits workspace metadata

### Requirement: DSH Actor Identity is host-authoritative and independent
The native host SHALL keep actor state outside the shared Runtime Host bridge, binding, capability profile, requests, tool-catalog callback, and lifecycle contracts. The default configuration SHALL mount a separate actor plugin with a namespaced stable identifier derived from DSH's host-owned anonymous harness-home identity. Configuration MAY instead supply a validated actor identifier, select explicit unbound mode, use a trusted deployment resolver, or disable the actor provider entirely. A mounted bound or unbound state SHALL be snapshotted outside authored Runtime Presets and remain immutable for the Runtime Session; disabled mode SHALL leave `doppelgangerActor` absent while actor-independent shared protocols remain usable.

#### Scenario: DSH uses its default installation actor
- **ID**: `host.dsh.actor.default-anonymous`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::binds the namespaced DSH harness-home actor by default`
- **WHEN** the host uses default actor configuration
- **THEN** actor-aware extensions observe one namespaced stable installation identity owned by DSH rather than a session, workspace, preset, or shared bridge value

#### Scenario: DSH starts a bound actor session
- **ID**: `host.dsh.actor.bound`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::binds and isolates host-authoritative DSH actors`
- **WHEN** the DSH host configuration or trusted resolver supplies a valid actor identifier for an agent
- **THEN** the separate actor plugin exposes that immutable bound identity only in that Runtime Session

#### Scenario: DSH starts an unbound generic session
- **ID**: `host.dsh.actor.unbound`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::exposes explicit unbound actor state to generic presets`
- **WHEN** host configuration explicitly selects unbound mode and the selected composition is actor-independent
- **THEN** the Runtime Session activates with an explicit unbound actor provider and an unchanged shared Runtime Host API

#### Scenario: DSH omits Actor Identity
- **ID**: `host.dsh.actor.absent`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::keeps shared protocols usable without an actor provider`
- **WHEN** host configuration disables Actor Identity and the selected composition is actor-independent
- **THEN** `doppelgangerActor` is absent while context, tools, cancellation, lifecycle, and host capabilities remain usable

### Requirement: Portable context participates in DSH prompt assembly
For each direct DSH user turn, the native host SHALL mint one non-empty request ID and call the active bridge exactly once with that request ID, the stable turn identity, the direct principal input, and a configured hard token budget. It SHALL retain the accepted contribution snapshot for that turn, add `instruction` contributions to DSH prompt sections and `data` contributions to DSH dynamic contexts on every model step, and SHALL NOT resolve providers again after tool calls in the same turn.

#### Scenario: Instruction and data context are projected
- **ID**: `host.dsh.context.authority-projection`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::projects instruction and data contributions through DSH prompt assembly`
- **WHEN** active providers return accepted instruction and data contributions for a DSH turn
- **THEN** every model step contains deterministic Doppelganger prompt sections and dynamic contexts from the same turn snapshot with authority preserved

#### Scenario: Context exceeds its host budget
- **ID**: `host.dsh.context.hard-budget`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::enforces the configured context budget before DSH projection`
- **WHEN** active context providers offer more content than the configured Doppelganger budget
- **THEN** only the context protocol's accepted bounded contributions enter the turn snapshot

#### Scenario: Later tool step reuses context
- **ID**: `host.dsh.context.stable-turn-snapshot`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::resolves context once and reuses it across tool steps in one DSH turn`
- **WHEN** a DSH turn performs multiple model steps after tool calls
- **THEN** every step uses the same accepted contributions and the bridge receives only one context request for the direct principal input

#### Scenario: Evolution context is projected generically
- **ID**: `host.dsh.context.evolution-generic`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::projects Evolution instruction and reminder data without interpreting proposals`
- **WHEN** an active Runtime Preset composes Evolution and its context provider returns policy instruction plus one due reminder candidate
- **THEN** DSH projects both contributions from the turn snapshot with their declared authority and adds no host-owned Evolution behavior

### Requirement: Portable tools are exact native scoped DSH tools
The native host SHALL translate each available descriptor from one immutable revisioned bridge snapshot into an agent-scoped DSH tool definition, validate its JSON Schema and optional approval metadata before registration, retain the exact portable name and descriptor revision in the native closure, and invoke only through `bridge.invokeTool` with stable call ID, optional turn ID, exact tool revision, JSON-compatible input, and an optional protected approval grant. It SHALL return the canonical JSON value on success and preserve structured protocol/domain failures as failed DSH tool results. A portable descriptor with `approval.policy: "required"` SHALL enter DSH's scoped `tools/pre-execute` ask path and SHALL reach the bridge only after `ApprovalService` returns `allowed-once`; the adapter SHALL then mint a one-shot grant bound to call ID, tool revision, and canonical input digest for bridge revalidation. Portable tool registrations SHALL not mask unrelated DSH tools.

#### Scenario: DSH invokes a portable tool
- **ID**: `host.dsh.tools.native-invocation`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::invokes a portable tool through the native DSH pipeline`
- **WHEN** the model invokes a projected Doppelganger tool with valid arguments
- **THEN** DSH records a native tool call and result whose canonical value came from the owning portable handler

#### Scenario: Evolution controls are projected generically
- **ID**: `host.dsh.tools.evolution-generic`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::projects Evolution controls without host-specific routing`
- **WHEN** an active Runtime Preset registers the seven portable `evolution.*` descriptors
- **THEN** DSH exposes and invokes them through the same scoped portable tool path without interpreting proposal state or granting executor authority

#### Scenario: Portable tool returns a structured error
- **ID**: `host.dsh.tools.structured-error`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::preserves portable tool error codes in failed DSH results`
- **WHEN** the portable registry rejects an invocation with a structured domain error
- **THEN** the DSH tool result is failed and retains the portable error code and message in bounded model-facing content

#### Scenario: Portable schema is unsupported by DSH
- **ID**: `host.dsh.tools.schema-rejected`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::rejects unsupported portable schemas before native registration`
- **WHEN** an active portable tool uses JSON Schema features the DSH registry cannot validate or execute
- **THEN** projection fails visibly for the affected Runtime Session before that tool becomes model-visible

#### Scenario: Required portable tool is approved once
- **ID**: `host.dsh.tools.required-approval-granted`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::routes required portable approval through the native DSH gate`
- **WHEN** a projected portable tool requires approval and the owning DSH approval answerer grants the exact call
- **THEN** the portable handler runs once and the grant does not authorize a later invocation

#### Scenario: Required portable tool is rejected
- **ID**: `host.dsh.tools.required-approval-rejected`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::does not invoke required portable tools after rejection`
- **WHEN** the owning DSH approval answerer rejects or cancels the exact call
- **THEN** DSH returns a denied tool result and the portable handler is not invoked

#### Scenario: Required portable approval is unavailable
- **ID**: `host.dsh.tools.required-approval-unavailable`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::fails required portable tools closed without an approval answerer`
- **WHEN** no ApprovalService or owning answerer can resolve a required portable tool call
- **THEN** the call fails closed before portable dispatch while the DSH agent and unrelated tools remain usable

#### Scenario: DSH cancels a portable tool call
- **ID**: `host.dsh.tools.cancellation`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::forwards native cancellation to the exact portable call`
- **WHEN** DSH aborts an active projected tool execution
- **THEN** the adapter calls `bridge.cancelTool` with that call ID, the portable handler observes its invocation signal, unrelated calls remain active, and the settled structured result is preserved

#### Scenario: Native closure carries a stale tool revision
- **ID**: `host.dsh.tools.stale-revision`
- **EVIDENCE**: `planned:packages/host-dsh/tests/tools.spec.ts::rejects stale descriptor revisions before portable dispatch`
- **WHEN** a retained DSH closure invokes after the same portable name has a new descriptor revision
- **THEN** bridge invocation returns `TOOL_REVISION_STALE` and neither the old nor current handler runs

### Requirement: Tool projection exactly follows committed runtime state
The native host SHALL accept only the shared binding's explicit `toolCatalogChanged(revision)` callback, fetch and validate the matching complete immutable snapshot, serialize refreshes, and commit one exact scoped DSH projection only after successful candidate registration. It SHALL define no generic runtime notification envelope or DSH-local mutable bridge registry. Tool approval metadata SHALL participate in the same candidate commit. Removed or unavailable portable tools SHALL disappear, stale catalog callbacks SHALL NOT restore an older projection, stale closures SHALL NOT invoke a removed or replaced handler, and stale approval state SHALL NOT authorize a changed or removed descriptor. Invalid reload SHALL retain the previous DSH projection and approval behavior.

#### Scenario: Valid reload replaces tools
- **ID**: `host.dsh.reload.tool-cutover`
- **EVIDENCE**: `planned:packages/host-dsh/tests/reload.spec.ts::exactly replaces native tools after a valid Runtime Preset reload`
- **WHEN** a valid watched Runtime Preset update adds, changes, or removes portable tools
- **THEN** the next DSH request observes exactly the newly committed portable tool set

#### Scenario: Invalid reload preserves tools
- **ID**: `host.dsh.reload.invalid-preserves-projection`
- **EVIDENCE**: `planned:packages/host-dsh/tests/reload.spec.ts::keeps the prior native projection after invalid reload`
- **WHEN** a watched Runtime Preset update fails Loader settlement or activation audit
- **THEN** the Runtime Session and its prior DSH tool projection remain usable while diagnostics expose the failed candidate

#### Scenario: Valid reload changes required approval
- **ID**: `host.dsh.reload.approval-cutover`
- **EVIDENCE**: `planned:packages/host-dsh/tests/reload.spec.ts::cuts over portable approval metadata only after committed reload`
- **WHEN** a valid watched Runtime Preset update adds, removes, or changes required approval on a portable tool
- **THEN** the next call uses exactly the newly committed approval behavior without restarting the agent

#### Scenario: Invalid reload changes required approval
- **ID**: `host.dsh.reload.invalid-approval-preserved`
- **EVIDENCE**: `planned:packages/host-dsh/tests/reload.spec.ts::retains prior approval behavior after invalid reload`
- **WHEN** a candidate update changes approval metadata but fails validation or activation audit
- **THEN** the previous tool and approval behavior remain active

#### Scenario: Stale tool closure executes after removal
- **ID**: `host.dsh.reload.stale-tool-denied`
- **EVIDENCE**: `planned:packages/host-dsh/tests/reload.spec.ts::denies a stale DSH closure after its portable tool is removed`
- **WHEN** a caller retains a previously projected DSH tool closure after committed removal
- **THEN** the closure returns an unavailable failure without invoking the removed portable handler or consuming a prior approval grant

### Requirement: DSH durable facts drive declared normalized lifecycle events
The native host SHALL derive lifecycle publication from DSH agent notifications and committed session-log events rather than streaming guesses. Its frozen capability profile SHALL declare only the standard lifecycle kinds DSH can publish faithfully, and `bridge.publishLifecycle` SHALL reject any undeclared kind. For declared events, the host SHALL publish stable deterministic delivery identities, map DSH numeric turns and tool call IDs to stable portable identities, publish each completed tool result only through its correlated `tool-completed` event, and publish `turn-committed` only after DSH appends `turn/end`. Teardown alone SHALL NOT advertise or synthesize `session-completed`.

#### Scenario: DSH turn commits normally
- **ID**: `host.dsh.lifecycle.committed-turn`
- **EVIDENCE**: `planned:packages/host-dsh/tests/lifecycle.spec.ts::publishes one committed event from a completed DSH turn`
- **WHEN** DSH appends a completed `turn/end` after one or more model steps
- **THEN** the host publishes one `turn-committed` event with direct principal text, completed assistant text, completed outcome, and no duplicated tool results

#### Scenario: DSH turn fails or is cancelled
- **ID**: `host.dsh.lifecycle.turn-outcome`
- **EVIDENCE**: `planned:packages/host-dsh/tests/lifecycle.spec.ts::maps DSH failure cancellation and interruption without fabricating success`
- **WHEN** DSH closes a turn with an error, aborted, or interrupted reason
- **THEN** the normalized committed event reports the corresponding failed or cancelled outcome and available structured error facts

#### Scenario: DSH tool call completes
- **ID**: `host.dsh.lifecycle.tool-correlation`
- **EVIDENCE**: `planned:packages/host-dsh/tests/lifecycle.spec.ts::correlates DSH tool call and result events by call identity`
- **WHEN** DSH appends a `tool/call` and its correlated `tool/result`
- **THEN** the host publishes one `tool-started` and one `tool-completed` event with the same stable session, turn, call, and tool identities

#### Scenario: DSH starts compaction
- **ID**: `host.dsh.lifecycle.pre-compaction`
- **EVIDENCE**: `planned:packages/host-dsh/tests/lifecycle.spec.ts::publishes bounded pre-compaction material from the durable DSH marker`
- **WHEN** DSH appends a live `compaction/start` event after the session seed boundary
- **THEN** the host publishes one bounded `pre-compaction` event correlated to the compaction identity and owning turn when present

### Requirement: Replay and duplicate observation do not duplicate committed work
The native host SHALL ignore seed history as new live work and SHALL derive lifecycle delivery IDs deterministically from DSH durable identities. Re-observing or retrying publication of the same live committed event SHALL preserve the delivery ID so persistent consumers can deduplicate it.

#### Scenario: Persisted session resumes
- **ID**: `host.dsh.lifecycle.seed-not-republished`
- **EVIDENCE**: `planned:packages/host-dsh/tests/lifecycle.spec.ts::does not republish seeded DSH history on resume`
- **WHEN** a DSH agent resumes a session whose prior turns and tool calls precede its live seed boundary
- **THEN** the host publishes lifecycle events only for work committed by the resumed live lifecycle

#### Scenario: Lifecycle publication is retried
- **ID**: `host.dsh.lifecycle.delivery-idempotence`
- **EVIDENCE**: `planned:packages/host-dsh/tests/lifecycle.spec.ts::reuses deterministic delivery identity for retried committed events`
- **WHEN** publication of one live DSH committed event is observed or attempted more than once
- **THEN** every attempt carries the same delivery identity

### Requirement: DSH host failures are session-contained
Activation, context projection, schema translation, tool refresh, tool invocation, lifecycle subscriber, and reload failures SHALL be reported through DSH logging and Doppelganger diagnostics without terminating the DSH process or corrupting sibling agents. A failed Runtime Session SHALL withdraw its projected context and tools; committed DSH host work SHALL remain committed when an optional Doppelganger subscriber fails.

#### Scenario: Runtime activation fails
- **ID**: `host.dsh.failure.activation-contained`
- **EVIDENCE**: `planned:packages/host-dsh/tests/failure.spec.ts::contains failed activation to one DSH agent`
- **WHEN** one selected Runtime Preset cannot activate
- **THEN** that agent receives no partial Doppelganger projection, the failure is visible, and sibling DSH agents continue

#### Scenario: Lifecycle subscriber fails
- **ID**: `host.dsh.failure.subscriber-contained`
- **EVIDENCE**: `planned:packages/host-dsh/tests/failure.spec.ts::preserves committed DSH work when a lifecycle subscriber fails`
- **WHEN** an optional Doppelganger lifecycle subscriber rejects a committed DSH event
- **THEN** the DSH turn or tool result remains committed and the subscriber failure is diagnostic only

### Requirement: DSH teardown reaches Cordis quiescence
The native host SHALL bind Runtime Session ownership to the DSH agent lifecycle, stop accepting new projection work during teardown, drain serialized activation, reload, tool-refresh, and lifecycle publication work, publish neutral session disposal without inventing successful completion, and await idempotent Runtime Session disposal before the agent scope finishes unwinding.

#### Scenario: DSH agent is disposed
- **ID**: `host.dsh.disposal.agent-quiescence`
- **EVIDENCE**: `planned:packages/host-dsh/tests/disposal.spec.ts::drains native host work and disposes the Runtime Session with its agent`
- **WHEN** DSH disposes an agent with an active Doppelganger Runtime Session
- **THEN** projected tools and context disappear and all session-owned Cordis fibers, effects, watchers, and queues reach quiescence

#### Scenario: DSH session ends without completion evidence
- **ID**: `host.dsh.disposal.neutral-session`
- **EVIDENCE**: `planned:packages/host-dsh/tests/disposal.spec.ts::publishes neutral disposal without fabricated completion`
- **WHEN** DSH tears down an agent without an explicit successful session outcome
- **THEN** the host publishes neutral session disposal and does not publish a fabricated completed session

### Requirement: The native host preserves one trusted Cordis runtime and one shared bridge
The DSH host package SHALL use the host-provided `@deepseek-ai/cordis` identity as a peer, consume the roster through its public Cordis service in that same root, depend only on the DSH packages whose public APIs it consumes, and run as trusted same-process plugin code. Each selected agent SHALL bind exactly one shared `extension-protocols` Runtime Host bridge directly in-process. `host-dsh` SHALL NOT introduce a second dependency-injection container, Loader tree, roster implementation, agent loop, DSH-local bridge contract, generic runtime notification channel, RPC process, router, sidecar, generated-code runner, sandbox claim, or parallel session-binding path.

#### Scenario: DSH loads the host package
- **ID**: `host.dsh.architecture.single-cordis-root`
- **EVIDENCE**: `planned:packages/host-dsh/tests/composition.spec.ts::loads the native host through one DSH Cordis root`
- **WHEN** the native host is composed into a DSH installation
- **THEN** its services, effects, scopes, bridge, and Runtime Sessions belong to the same Cordis registry and disposal tree as the host agent

#### Scenario: Native host runs in-process
- **ID**: `host.dsh.architecture.no-rpc-bridge`
- **EVIDENCE**: `planned:packages/host-dsh/tests/composition.spec.ts::binds the shared Runtime Host API directly without another transport`
- **WHEN** a DSH agent activates Doppelganger
- **THEN** context, tool, cancellation, lifecycle, and optional separate Actor Identity projection use direct Cordis APIs without an OMP child, JSON-RPC transport, or DSH-specific bridge

### Requirement: DSH passes shared Runtime Host conformance
Before native DSH support is considered implemented, the adapter SHALL pass the same transport-independent Runtime Host conformance suite as OMP without process-topology exceptions. Coverage SHALL include two-session isolation, canonical empty context and tools, closed capability validation, atomic catalog replacement, stale descriptor invocation, one-shot approval replay, cancellation/completion races, undeclared lifecycle rejection, actor-provider absence/unbound/bound independence, disposal during active work, and late callbacks after binding replacement.

#### Scenario: Direct adapter claims shared API support
- **ID**: `host.dsh.architecture.shared-conformance`
- **EVIDENCE**: `planned:packages/host-dsh/tests/runtime-host-conformance.spec.ts::passes the shared Runtime Host conformance suite`
- **WHEN** `host-dsh` binds the common bridge directly in-process
- **THEN** it satisfies the same observable Runtime Host contract as the transported OMP adapter

### Requirement: DSH-only extensions remain typed and host-specific
A DSH-only service or event SHALL be provided only by an explicitly typed `doppelganger/host/dsh/...` protected Cordis plugin that is isolated to the owning Runtime Session, validates bounded JSON-compatible values, owns registration and cleanup as Cordis effects, and reuses the existing agent-owned in-process binding and lifecycle. It SHALL NOT expose raw DSH runtime objects or create another channel. Promotion into the common Runtime Host API SHALL require two implemented adapters proving equivalent timing, authority, correlation, failure/cancellation/replay semantics, stale behavior, rollback, and disposal.

#### Scenario: DSH exposes a native-only hook
- **ID**: `host.dsh.architecture.typed-host-extension`
- **EVIDENCE**: `planned:packages/host-dsh/tests/composition.spec.ts::keeps native-only hooks in typed protected plugins`
- **WHEN** DSH needs to project a native observation with no proven common semantic equivalent
- **THEN** it uses one typed DSH-namespaced protected provider in the existing agent binding and does not expand or bypass the shared Runtime Host API

### Requirement: DSH projects opt-in Dynamic Runtime Plugins through the portable surface
When a selected Runtime Preset explicitly composes Dynamic Runtime Plugins and the optional extension package is resolvable by the DSH deployment, the native host SHALL project the exact portable `runtime-plugin.inspect-list`, `runtime-plugin.inspect-query`, `runtime-plugin.inspect-self`, `runtime-plugin.define`, `runtime-plugin.run`, `runtime-plugin.stop`, and `runtime-plugin.undefine` descriptors through its ordinary scoped tool path. It SHALL NOT import, delegate to, or duplicate `@deepseek-ai/dsh-cordis-host-runner` registry, evaluator, inspection, or version-transition semantics. Every exact `runtime-plugin.run` first run, restart, update, or rollback SHALL require a new native one-shot approval before portable dispatch. Generated context and tools SHALL follow the same committed dynamic projection and stale-closure rules as other portable effects. Ordinary structured extension failures SHALL remain agent-contained, while documentation SHALL state that generated code executes in the native DSH process and is not hostile-code containment. Agent and host teardown SHALL await exhaustive Runtime Session disposal of every reachable generated Fiber.

#### Scenario: Opt-in preset exposes the portable control surface
- **ID**: `host.dsh.dynamic-runtime-plugins.opt-in-surface`
- **EVIDENCE**: `planned:packages/host-dsh/tests/dynamic-runtime-plugins.spec.ts::projects the exact portable control surface without the DSH runner`
- **WHEN** a DSH agent activates a Runtime Preset containing Dynamic Runtime Plugins and the standard protocol services
- **THEN** the exact seven qualified control tools are native scoped DSH tools and no host-specific runner or dispatch surface is created

#### Scenario: Every generated activation is approved exactly once
- **ID**: `host.dsh.dynamic-runtime-plugins.approval-exact`
- **EVIDENCE**: `planned:packages/host-dsh/tests/dynamic-runtime-plugins.spec.ts::requires native approval for every exact run update restart and rollback`
- **WHEN** the model requests a first run, restart, update, or rollback for one immutable generated Package
- **THEN** DSH presents the exact Plugin, Package, mode, name, purpose, and source digest and dispatches only after one `allowed-once` decision

#### Scenario: Generated projection cuts over transactionally
- **ID**: `host.dsh.dynamic-runtime-plugins.effects-cutover`
- **EVIDENCE**: `planned:packages/host-dsh/tests/dynamic-runtime-plugins.spec.ts::cuts over generated context and tools through ordinary projection refresh`
- **WHEN** an approved generated Package starts, successfully updates, stops, or is undefined
- **THEN** subsequent DSH prompt and tool projection reflects exactly the committed generated effects while unrelated native and portable tools remain active

#### Scenario: Retained generated closure is stale
- **ID**: `host.dsh.dynamic-runtime-plugins.stale-closure-denied`
- **EVIDENCE**: `planned:packages/host-dsh/tests/dynamic-runtime-plugins.spec.ts::denies retained generated closures before approval or portable invocation`
- **WHEN** a caller retains a DSH closure after stop, update, undefine, owner replacement, or Runtime Session disposal removes its generated descriptor
- **THEN** the closure fails unavailable without asking for approval or invoking the removed generated handler

#### Scenario: Generated code crosses the native process boundary
- **ID**: `host.dsh.dynamic-runtime-plugins.native-failure-boundary`
- **EVIDENCE**: `planned:packages/host-dsh/tests/dynamic-runtime-plugins.spec.ts::distinguishes structured generated failures from native process compromise`
- **WHEN** generated evaluation, apply, guard, or disposal fails through the extension's structured path
- **THEN** the failure is contained to the owning agent state, while the host makes no containment claim for code that terminates, corrupts, or blocks the shared DSH process

#### Scenario: Agent disposal exhausts generated cleanup
- **ID**: `host.dsh.dynamic-runtime-plugins.agent-disposal`
- **EVIDENCE**: `planned:packages/host-dsh/tests/dynamic-runtime-plugins.spec.ts::disposes every reachable generated Fiber before agent quiescence`
- **WHEN** a DSH agent or the host plugin is disposed while one or more generated Packages are active
- **THEN** teardown attempts every generated cleanup through Runtime Session disposal, removes projected effects and ephemeral definitions, and reports aggregate failures only after reachable work settles
