## Purpose

Define the native DeepSeek Harness host boundary that activates isolated Doppelganger Runtime Sessions inside DSH agent scopes and projects host-neutral context, tools, lifecycle events, actor identity, reload, and failure behavior without an RPC child.

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

### Requirement: DSH supplies host-owned activation inputs
The native host SHALL derive the stable Runtime Session ID from the DSH session, derive the optional workspace root from the DSH session header, request selection and canonical user/project patch paths from the injected roster service, and install the protected protocol bridge after caller-controlled layers. Authored Runtime Presets and patches SHALL NOT replace or remove the bridge. The host SHALL NOT duplicate roster roots, trust, discovery, authoring, or deployment-default policy.

#### Scenario: Project and user patches apply in order
- **ID**: `host.dsh.activation.patch-order`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::applies user and project patches in canonical order`
- **WHEN** both optional user and project Runtime Preset patches exist for a DSH workspace
- **THEN** activation applies the selected preset, user patch, project patch, explicit host patch, and protected bridge in canonical order

#### Scenario: Agent has no workspace root
- **ID**: `host.dsh.activation.workspace-optional`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::activates a user-selected preset without workspace metadata`
- **WHEN** a DSH session has no workspace path but user configuration selects a Runtime Preset
- **THEN** the Runtime Session activates without project discovery and omits workspace metadata

### Requirement: DSH actor binding is host-authoritative
The native host SHALL install the existing actor-identity protocol through the protected bridge. By default it SHALL bind a namespaced stable identifier derived from DSH's host-owned anonymous harness-home identity. Configuration MAY instead supply a validated actor identifier, select explicit unbound mode, or use a trusted deployment resolver. The chosen state SHALL be snapshotted outside authored Runtime Presets and remain immutable for the Runtime Session.

#### Scenario: DSH uses its default installation actor
- **ID**: `host.dsh.actor.default-anonymous`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::binds the namespaced DSH harness-home actor by default`
- **WHEN** the host uses default actor configuration
- **THEN** actor-aware extensions observe one namespaced stable installation identity owned by DSH rather than a session, workspace, or preset value

#### Scenario: DSH starts a bound actor session
- **ID**: `host.dsh.actor.bound`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::binds and isolates host-authoritative DSH actors`
- **WHEN** the DSH host configuration or trusted resolver supplies a valid actor identifier for an agent
- **THEN** actor-aware extensions observe that immutable bound identity only in that Runtime Session

#### Scenario: DSH starts an unbound generic session
- **ID**: `host.dsh.actor.unbound`
- **EVIDENCE**: `planned:packages/host-dsh/tests/activation.spec.ts::exposes explicit unbound actor state to generic presets`
- **WHEN** host configuration explicitly selects unbound mode and the selected composition is actor-independent
- **THEN** the Runtime Session activates with explicit unbound actor state

### Requirement: Portable context participates in DSH prompt assembly
For every DSH model step, the native host SHALL resolve the active Doppelganger context protocol with the stable turn identity, the direct principal input for that turn, and a configured hard token budget. It SHALL add accepted `instruction` contributions to DSH prompt sections and accepted `data` contributions to DSH dynamic contexts without replacing existing DSH prompt material or bypassing DSH complete-prompt and runtime-context suppression rules.

#### Scenario: Instruction and data context are projected
- **ID**: `host.dsh.context.authority-projection`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::projects instruction and data contributions through DSH prompt assembly`
- **WHEN** active providers return accepted instruction and data contributions for a DSH turn
- **THEN** the request contains deterministic Doppelganger prompt sections and dynamic contexts with their authority preserved

#### Scenario: Context exceeds its host budget
- **ID**: `host.dsh.context.hard-budget`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::enforces the configured context budget before DSH projection`
- **WHEN** active context providers offer more content than the configured Doppelganger budget
- **THEN** only the context protocol's accepted bounded contributions are projected into DSH

#### Scenario: Later tool step assembles context
- **ID**: `host.dsh.context.stable-turn-input`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::retains one direct principal input across all steps of a DSH turn`
- **WHEN** a DSH turn performs multiple model steps after tool calls
- **THEN** every step resolves context with the same stable turn identity and original direct principal input

#### Scenario: Evolution context is projected generically
- **ID**: `host.dsh.context.evolution-generic`
- **EVIDENCE**: `planned:packages/host-dsh/tests/context.spec.ts::projects Evolution instruction and reminder data without interpreting proposals`
- **WHEN** an active Runtime Preset composes Evolution and its context provider returns policy instruction plus one due reminder candidate
- **THEN** DSH projects both contributions with their declared authority and adds no host-owned Evolution behavior

### Requirement: Portable tools are native scoped DSH tools
The native host SHALL translate each available portable tool descriptor into an agent-scoped DSH tool definition, validate its JSON Schema and optional approval metadata before registration, invoke the portable registry with JSON-compatible arguments, return the canonical JSON value on success, and preserve structured domain failures as failed DSH tool results. A portable descriptor with `approval.policy: "required"` SHALL enter DSH's scoped `tools/pre-execute` ask path and SHALL reach the portable handler only after `ApprovalService` returns `allowed-once`. Portable tool registrations SHALL not mask unrelated DSH tools.

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

### Requirement: Tool projection exactly follows committed runtime state
The native host SHALL serialize tool-set refreshes, validate the complete candidate set before replacing registrations, and commit one exact scoped DSH projection only after a successful Runtime Preset activation or reload. Tool approval metadata SHALL participate in the same candidate commit. Removed or unavailable portable tools SHALL disappear, stale closures SHALL NOT invoke a removed handler, and stale approval state SHALL NOT authorize a changed or removed descriptor. Invalid reload SHALL retain the previous DSH projection and approval behavior.

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

### Requirement: DSH durable facts drive normalized lifecycle events
The native host SHALL derive lifecycle publication from DSH agent notifications and committed session-log events rather than streaming guesses. It SHALL publish stable deterministic delivery identities, map DSH numeric turns and tool call IDs to stable portable identities, publish each completed tool result only through its correlated `tool-completed` event, and publish `turn-committed` only after DSH appends `turn/end`.

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

### Requirement: The native host preserves one trusted Cordis runtime
The DSH host package SHALL use the host-provided `@deepseek-ai/cordis` identity as a peer, consume the roster through its public Cordis service in that same root, depend only on the DSH packages whose public APIs it consumes, run as trusted same-process plugin code, and SHALL NOT introduce a second dependency-injection container, Loader tree, roster implementation, agent loop, RPC process, generated-code runner, or sandbox claim.

#### Scenario: DSH loads the host package
- **ID**: `host.dsh.architecture.single-cordis-root`
- **EVIDENCE**: `planned:packages/host-dsh/tests/composition.spec.ts::loads the native host through one DSH Cordis root`
- **WHEN** the native host is composed into a DSH installation
- **THEN** its services, effects, scopes, and Runtime Sessions belong to the same Cordis registry and disposal tree as the host agent

#### Scenario: Native host runs in-process
- **ID**: `host.dsh.architecture.no-rpc-bridge`
- **EVIDENCE**: `planned:packages/host-dsh/tests/composition.spec.ts::projects protocols without starting an OMP child transport`
- **WHEN** a DSH agent activates Doppelganger
- **THEN** context, tool, lifecycle, and actor projection use direct Cordis APIs without starting the OMP child or JSON-RPC transport

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
