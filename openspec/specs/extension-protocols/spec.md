# Extension Protocols Specification

## Purpose

Defines host-neutral context, tool, and lifecycle contracts through which arbitrary Cordis plugins can affect an agent without depending on a concrete host.
## Requirements

### Requirement: Context provider registry
Feature plugins SHALL be able to register scoped context providers whose registrations follow the owning plugin lifecycle.

#### Scenario: Provider contributes context
- **ID**: `extension-protocols.context.provider-contributes`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::assembles instruction and data authority without promotion`
- **WHEN** a host requests context for a turn
- **THEN** every active provider in the session scope can return context contributions for that request

#### Scenario: Provider is disposed
- **ID**: `extension-protocols.context.provider-disposed`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::assembles instruction and data authority without promotion`
- **WHEN** the plugin owning a context provider is disposed or reloaded
- **THEN** the provider is no longer included in subsequent context resolution

### Requirement: Context assembly
The context assembler SHALL combine active contributions deterministically and SHALL enforce the token budget supplied for the host request.

#### Scenario: Contributions exceed budget
- **ID**: `extension-protocols.context.budget-priority`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::assembles instruction and data authority without promotion`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::truncates opted-in contributions and omits lower-priority content`
- **WHEN** resolved contributions exceed the available persona-context budget
- **THEN** the assembler retains higher-priority configured contributions and excludes lower-priority content until the result fits the budget

#### Scenario: Turn-sensitive provider
- **ID**: `extension-protocols.context.turn-sensitive-provider`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::assembles instruction and data authority without promotion`
- **WHEN** a provider uses the current turn to select relevant content
- **THEN** the assembled result reflects the current request without changing the provider's registration

### Requirement: Transport-neutral tool registry
Feature plugins SHALL register namespaced tool definitions in a session-scoped registry that supports discovery and invocation without exposing host-specific tool objects.

#### Scenario: Host discovers tools
- **ID**: `extension-protocols.tools.host-discovers`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** a host adapter lists active persona tools
- **THEN** it receives each tool's stable namespaced name, description, input contract, and availability

#### Scenario: Host invokes a tool
- **ID**: `extension-protocols.tools.host-invokes`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns structured domain and execution errors`
- **WHEN** a host invokes a listed tool with valid input
- **THEN** the registry executes the owning plugin handler and returns a transport-neutral result or structured error

#### Scenario: Plugin tool is removed
- **ID**: `extension-protocols.tools.plugin-tool-removed`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the owning plugin is disposed or reloaded without the tool
- **THEN** the tool is no longer reported as available

### Requirement: Normalized lifecycle events
Host plugins SHALL emit normalized session, turn, and tool observation events through the session Cordis event system.

#### Scenario: Agent turn completes
- **ID**: `extension-protocols.lifecycle.agent-turn-completes`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** the host reports completion of a model turn
- **THEN** active plugins observing the normalized turn event receive its session identity and outcome

#### Scenario: Host tool executes
- **ID**: `extension-protocols.lifecycle.host-tool-executes`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host tool starts and completes
- **THEN** active observers receive normalized before and after events associated with the same tool call

### Requirement: Optional host-specific services
A host MAY expose additional operations as explicitly named optional services, and absence of an optional service SHALL NOT prevent an otherwise compatible plugin from activating.

#### Scenario: Optional service unavailable
- **ID**: `extension-protocols.plugins.optional-service-unavailable`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::joins runtime-owned plugins to explicitly declared optional service realms`
- **WHEN** a plugin can operate without a host-specific optional service and the host does not provide it
- **THEN** the plugin activates with the related optional behavior disabled

### Requirement: Context contributions preserve authority and provenance
Context providers SHALL return source-identified contributions with explicit `instruction` or `data` authority and deterministic priority. Assembly SHALL enforce one shared token budget while retaining authority-separated immutable projections; it SHALL NOT flatten data-authority text into an instruction-authority string. Accepted and omitted sources SHALL remain observable.

#### Scenario: Multiple providers contribute context
- **ID**: `extension-protocols.context.authority-aware-assembly`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::assembles instruction and data authority without promotion`
- **WHEN** instruction providers and attacker-influenced data providers resolve context for one turn
- **THEN** both are ordered and budgeted deterministically while the assembled result keeps their authority distinct for host projection

#### Scenario: Provider contribution is too large
- **ID**: `extension-protocols.context.oversized-contribution-omitted`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::truncates opted-in contributions and omits lower-priority content`
- **WHEN** a whole contribution cannot fit and it does not explicitly permit truncation
- **THEN** it is omitted from its authority-specific projection and its source is reported

### Requirement: Tool definitions use transport-neutral JSON Schema
A tool definition SHALL include a stable qualified name, description, supported JSON Schema input contract, availability, transport-neutral invocation result, and optional validated approval requirement. An approval requirement SHALL be JSON-compatible metadata containing `policy: "required"` and MAY contain a bounded non-empty advisory reason. Discovery SHALL preserve the same immutable approval metadata in the tool descriptor, and registration changes SHALL be observable by active host adapters. The reason SHALL NOT be required for enforcement or treated as authorization.

#### Scenario: Tool is added during reload
- **ID**: `extension-protocols.tools.added-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition update registers a tool
- **THEN** the host adapter receives the new descriptor, including exact approval metadata when declared, and can project it without restarting the session

#### Scenario: Tool is removed during reload
- **ID**: `extension-protocols.tools.removed-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** the owning extension unloads
- **THEN** the tool becomes unavailable and active hosts are notified

#### Scenario: Tool declares malformed approval metadata
- **ID**: `extension-protocols.tools.malformed-approval-rejected`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** a definition supplies an unknown policy, a supplied blank or oversized reason, unsupported value, or non-JSON-compatible approval field
- **THEN** registration fails before the descriptor becomes discoverable

### Requirement: Tool invocation errors remain structured
Tool invocation SHALL return a success value or a structured error with a stable code and message. Host transport failures SHALL remain distinguishable from domain invocation failures.

#### Scenario: Memory rejects a secret
- **ID**: `extension-protocols.tools.memory-secret-error`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns structured domain and execution errors`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** a host invokes a memory tool with secret content
- **THEN** the host receives the memory error code rather than a generic transport failure

### Requirement: Lifecycle events identify committed work
Host-neutral lifecycle SHALL distinguish session start/completion, turn start/commit, tool start/completion, and pre-compaction. Every event SHALL carry stable session identity, relevant events SHALL carry stable turn and call identities, and each completed tool result SHALL be represented only by its correlated `tool-completed` event rather than duplicated in `turn-committed`.
Turn and delivery identifiers SHALL be opaque to portable consumers. A host adapter SHALL assign distinct identities to new work even when it resumes a prior logical session, while genuine event replay SHALL preserve the original identities. The protocol SHALL NOT prescribe an adapter's identifier format, persistent counter strategy, or native session restoration mechanism.

#### Scenario: Turn completes normally
- **ID**: `extension-protocols.lifecycle.turn-committed-payload`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host commits a completed assistant turn that included tool calls
- **THEN** one `turn-committed` event contains the principal input, completed assistant output, timestamp, and completed outcome without tool outcome payloads

#### Scenario: Tool completes within a turn
- **ID**: `extension-protocols.lifecycle.tool-outcome-owned-by-completion`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host tool completes before its enclosing turn is committed
- **THEN** the bounded result or structured error is carried only by the correlated `tool-completed` event with stable turn and call identities

#### Scenario: Host emits streaming updates
- **ID**: `extension-protocols.lifecycle.streaming-is-not-committed`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** partial assistant or tool updates occur before commit
- **THEN** they do not masquerade as a committed turn or completed tool result

### Requirement: Lifecycle outcomes and errors are faithful
Completion events SHALL represent completed, failed, or cancelled outcomes using available host facts and SHALL include structured error information when the host provides it. Adapters SHALL NOT report unknown shutdown or aborted work as successful completion.

#### Scenario: Tool execution fails
- **ID**: `extension-protocols.lifecycle.failed-tool-outcome`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns structured domain and execution errors`
- **WHEN** the host reports a tool error and result payload
- **THEN** the normalized tool-completed event retains the failed outcome and serializable result or structured error information available from the host

#### Scenario: Session shutdown has no outcome evidence
- **ID**: `extension-protocols.lifecycle.neutral-session-disposal`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** the host only announces teardown without a completion reason
- **THEN** the adapter emits a neutral disposal notification or omits session completion rather than fabricating a completed outcome

### Requirement: Lifecycle delivery supports idempotent consumers
Events that can cause persistent mutations SHALL carry deterministic delivery identity. Duplicate publication of the same committed event SHALL be recognizable by consumers.

#### Scenario: Adapter retries event publication
- **ID**: `extension-protocols.lifecycle.idempotent-delivery`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::captures committed OMP turns only as idempotent review candidates`
- **WHEN** the same turn-committed event is delivered more than once after a transport uncertainty
- **THEN** consumers receive the same event identity and can avoid duplicate mutations

### Requirement: Protocol payloads are serializable and bounded
Context requests, tool descriptors, invocation inputs and results, normalized lifecycle events, diagnostics, and notifications crossing a host transport SHALL satisfy their explicit size and depth limits. Protocol-owned JSON values SHALL be strictly validated before cloning, digesting, or transport serialization without executing coercion hooks or silently changing unsupported values. Host observation material entering the dedicated bounded lifecycle serializer SHALL retain its intentional lossy projection: unsupported details SHALL be omitted or represented as structured truncation metadata before the normalized event is validated. Strict command/result admission SHALL NOT be replaced by that observation projection.

#### Scenario: Tool result contains non-serializable host details
- **ID**: `extension-protocols.lifecycle.bounded-serializable-tool-result`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::serializes circular, binary, oversized, deep, and unsupported host values within explicit bounds`
- **WHEN** an adapter forwards a completed tool result containing unsupported values
- **THEN** it emits a bounded serializable representation and records that information was omitted

### Requirement: Subscriber failure is contained
A lifecycle subscriber failure SHALL be reported diagnostically without corrupting protocol registration or terminating unrelated host operation. A host adapter MAY apply event-specific deadlines and fail-open behavior.

#### Scenario: Optional capture fails on turn commit
- **ID**: `extension-protocols.lifecycle.subscriber-failure-contained`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::contains subscriber failure while independent subscribers observe committed work`
- **WHEN** a capture subscriber throws
- **THEN** the committed host turn remains successful and the failure is observable through diagnostics

### Requirement: Protocols remain domain-neutral
The context, tool, and lifecycle contracts SHALL NOT require persona, memory, project, SQLite, OMP, or model-provider concepts. Domain extensions and host adapters translate their own metadata at the protocol seam.

#### Scenario: Non-persona composition uses protocols
- **ID**: `extension-protocols.domain-neutral.generic-composition`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** a generic composition registers context, tools, or lifecycle subscribers
- **THEN** it can use the protocols without installing persona or memory extensions

### Requirement: Required portable approval is one-shot and fail-closed
A host adapter SHALL enforce `approval.policy: "required"` before invoking the portable handler. The decision SHALL be correlated to the exact projected tool and invocation arguments, SHALL require an explicit one-shot user grant, and SHALL NOT be satisfied by a permissive host mode, automatic allow tier, model text, prior grant, or default policy. Rejection, cancellation, or an unavailable approval channel SHALL prevent handler invocation.

#### Scenario: Host grants one invocation
- **ID**: `extension-protocols.approval.one-shot-grant`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a required-approval portable tool is called and the native host obtains an explicit grant for that exact call
- **THEN** the adapter invokes the current portable handler once and the grant does not authorize a later call

#### Scenario: Host runs in a permissive mode
- **ID**: `extension-protocols.approval.permissive-mode-still-prompts`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the native host would normally auto-approve write or execution tools
- **THEN** the portable tool's required policy still requests an explicit one-shot decision

#### Scenario: Host cannot enforce required approval
- **ID**: `extension-protocols.approval.unavailable-fails-closed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** an adapter or active host surface has no supported approval channel for the call
- **THEN** it fails the call closed or keeps the tool unavailable and never invokes the portable handler

#### Scenario: Approval policy changes during reload
- **ID**: `extension-protocols.approval.reload-current-descriptor`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a committed runtime reload adds, removes, or changes a tool's approval requirement
- **THEN** the next host invocation uses exactly the newly committed descriptor and a stale closure cannot bypass the current requirement

### Requirement: Portable approval remains domain-neutral
The tool protocol SHALL express only generic invocation approval policy and an optional advisory reason. It SHALL NOT contain Persona, memory, filesystem, OMP, DSH, UI widget, actor, or command concepts. Hosts own presentation and decision transport; feature plugins MAY explain why their specific operation is sensitive without changing authorization semantics.

#### Scenario: A non-Persona plugin requires approval
- **ID**: `extension-protocols.approval.domain-neutral-plugin`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::revalidates exact one-shot approval grants and rejects replay or unexpected authority`
- **WHEN** any feature plugin registers a sensitive portable tool with required approval
- **THEN** compatible hosts enforce it through the same generic projection path without importing the feature package

### Requirement: Host-facing tool schema
The tool protocol SHALL expose a transport-neutral `ToolDescriptor` containing the canonical tool name, display label, description, JSON Schema input, opaque tool revision, and explicit availability state. The schema SHALL remain free of OMP, Pi SDK, DSH, MCP client, or other host execution objects. The shared Runtime Host API SHALL expose descriptors only through immutable revisioned catalog snapshots.

#### Scenario: OMP requests runtime tools
- **ID**: `extension.protocols.omp-requests-runtime-tools`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the OMP adapter snapshots tools from an active Runtime Session
- **THEN** it receives transport-neutral descriptors that it can translate into native OMP tools while retaining each descriptor's exact revision for invocation

#### Scenario: DSH requests runtime tools
- **ID**: `extension.protocols.dsh-requests-runtime-tools`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the DSH adapter snapshots tools from an active Runtime Session
- **THEN** it receives the same descriptor contract without importing OMP or MCP transport types

### Requirement: Invocation results remain separate from definitions
Tool handlers SHALL receive the portable invocation context and return structured protocol results at the invocation boundary; runtime result values SHALL NOT be embedded into the tool-definition schema. The bridge SHALL distinguish successful values, tool-domain failures, invalid input, unavailable tools, stale descriptor revisions, missing or invalid approval, and observed cancellation using structured JSON-compatible result or error codes. Transport adapters SHALL map those outcomes explicitly rather than collapsing them into successful text or untyped exceptions.

#### Scenario: Handler returns a structured value
- **ID**: `extension.protocols.handler-returns-a-structured-value`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects non-plain tool input before cloning or approval digesting`
- **WHEN** a registered handler returns a JSON-compatible value
- **THEN** the invocation result returns that value separately from the tool definition and the descriptor remains immutable

#### Scenario: Host invokes a stale descriptor
- **ID**: `extension.protocols.host-invokes-a-stale-descriptor`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** the supplied tool revision no longer matches the current descriptor
- **THEN** the invocation returns `TOOL_REVISION_STALE` before any handler runs

#### Scenario: Handler observes abort
- **ID**: `extension.protocols.handler-observes-abort`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** an active handler terminates because its supplied signal was aborted
- **THEN** the invocation returns a structured cancelled outcome rather than a successful empty value

### Requirement: Required tool approval metadata
The tool contract SHALL support `approval.policy: "required"` with an optional bounded non-empty advisory reason as portable metadata, and the shared Runtime Host bridge SHALL revalidate one protected approval grant against the exact call ID, tool revision, and canonical input digest before dispatch. The reason SHALL NOT be required for enforcement or treated as authorization. This metadata is a lower-bound safety requirement: an adapter MAY impose stricter native policy on any tool, but an imported protocol annotation or host policy SHALL NOT weaken or fabricate the portable requirement.

#### Scenario: Required approval is unsupported
- **ID**: `extension.protocols.required-approval-is-unsupported`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::revalidates exact one-shot approval grants and rejects replay or unexpected authority`
- **WHEN** a tool requiring portable approval is projected by a host whose capability profile declares no required-approval support
- **THEN** the host adapter omits or blocks the tool diagnostically rather than invoking it without approval

#### Scenario: Matching one-shot grant is supplied
- **ID**: `extension.protocols.matching-one-shot-grant-is-supplied`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::revalidates exact one-shot approval grants and rejects replay or unexpected authority`
- **WHEN** the native host obtains explicit user approval for the exact projected call and supplies a matching unused protected grant
- **THEN** the bridge consumes the grant and invokes the handler once

#### Scenario: Input changes after approval
- **ID**: `extension.protocols.input-changes-after-approval`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::revalidates exact one-shot approval grants and rejects replay or unexpected authority`
- **WHEN** an adapter changes the invocation input after obtaining approval
- **THEN** the canonical input digest no longer matches and the bridge rejects the call before handler invocation

### Requirement: Registry effects are scoped and reversible
Each single-tool registration or owned-set registration SHALL install through the owning Cordis context and SHALL be removed when that context is disposed. Dynamic tool updates SHALL preserve deterministic replacement behavior, update catalog and descriptor revisions as required, and SHALL NOT leave stale handlers callable through retained host closures.

#### Scenario: Tool plugin is reloaded
- **ID**: `extension.protocols.tool-plugin-is-reloaded`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** Loader replaces or disables a plugin that owns one or more tool sets
- **THEN** the prior effects are disposed, one complete successor catalog is committed, stale descriptor revisions fail closed, and unrelated registrations remain active

#### Scenario: Tool set registration is explicitly disposed
- **ID**: `extension.protocols.tool-set-registration-is-explicitly-disposed`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the owning plugin disposes a set registration
- **THEN** all tools in that set are removed in one committed mutation and repeated disposal is a no-op

### Requirement: Host capability service
The protocol package SHALL expose a frozen Runtime Session-scoped `doppelgangerHostCapabilities` service whose versioned closed value contains exactly context delivery, tool delivery, required-approval support, cancellation support, and faithfully available standard lifecycle event kinds. Every field SHALL be required; unknown keys, host-native names, and arbitrary string capability bags SHALL be rejected at construction and transport boundaries.

#### Scenario: Portable plugin inspects delivery guarantees
- **ID**: `extension.protocols.portable-plugin-inspects-delivery-guarantees`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** a plugin needs context at a known session, turn, or request cadence or exact dynamic tool replacement
- **THEN** it determines that semantic guarantee from the capability service without branching on the host package or process topology

#### Scenario: Empty optional protocol stack
- **ID**: `extension.protocols.empty-optional-protocol-stack`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** the capability profile permits context or tools but the selected Runtime Preset does not install those protocol services
- **THEN** the shared bridge remains valid and exposes their canonical empty behavior

#### Scenario: Capability object contains an extension bag
- **ID**: `extension.protocols.capability-object-contains-an-extension-bag`
- **EVIDENCE**: `packages/extension-protocols/tests/host-capabilities.spec.ts::validates, deeply freezes, and provides the closed session capability value`
- **WHEN** an adapter supplies an otherwise valid profile with `features`, `extensions`, or another undeclared field
- **THEN** protocol validation rejects it before the service is provided

### Requirement: Runtime Host and actor providers are independent
The shared Runtime Host plugin SHALL NOT construct, provide, require, or infer `doppelgangerActor`. Actor Identity remains independently mountable with three observable states: absent service means unsupported or not installed, `unbound` means installed without a resolved user, and `bound` means one immutable resolved user. Context, tools, lifecycle, and host capabilities SHALL remain usable without actor identity.

#### Scenario: Generic preset uses the shared bridge
- **ID**: `extension.protocols.generic-preset-uses-the-shared-bridge`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** an actor-independent Runtime Preset activates through a supported host
- **THEN** the Runtime Host plugin provides no bound or synthetic actor and all actor-independent shared protocols remain usable

#### Scenario: Adapter also mounts actor identity
- **ID**: `extension.protocols.adapter-also-mounts-actor-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** actor-aware plugins are selected and the host supplies a stable principal identifier
- **THEN** a separate actor plugin provides `doppelgangerActor` in its declared isolation realm without adding `actorId` to Runtime Host contracts

#### Scenario: Adapter mounts an unbound actor provider
- **ID**: `extension.protocols.adapter-mounts-an-unbound-actor-provider`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** a host implements Actor Identity but has no resolved principal
- **THEN** the separate provider exposes `unbound`, distinguishable from an absent service, without changing Runtime Host contracts

### Requirement: Runtime-to-host change callback is narrow
The public Runtime Host binding SHALL expose attachment, detachment, and the explicit `toolCatalogChanged(revision)` callback only. It SHALL NOT expose `notify(type, payload)`, an open notification union, an arbitrary event name, or a mutable tool registry. A second unrelated outbound signal requires its own versioned semantic design.

#### Scenario: Tool registry commits a new catalog
- **ID**: `extension.protocols.tool-registry-commits-a-new-catalog`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the registry completes one valid atomic mutation
- **THEN** the shared plugin calls `toolCatalogChanged` once with the committed revision

#### Scenario: Provider wants an unrelated outbound signal
- **ID**: `extension.protocols.provider-wants-an-unrelated-outbound-signal`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::returns authority-separated context through the shared bridge`
- **WHEN** a shared or host-specific provider needs to report another condition to the adapter
- **THEN** it cannot send that condition through a generic Runtime Host notification channel

### Requirement: Atomic owned tool sets
The tool registry SHALL support registering one owner-scoped set and atomically replacing its complete definitions. Replacement SHALL validate every candidate and all cross-owner collisions before mutation, SHALL preserve the previous committed set on failure, SHALL emit one post-commit change event, and SHALL dispose through one idempotent Cordis effect.

#### Scenario: MCP list refresh succeeds
- **ID**: `extension.protocols.mcp-list-refresh-succeeds`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::replaces complete owner sets atomically and preserves the old set on validation failure`
- **WHEN** an MCP importer replaces ten old definitions with twelve valid new definitions
- **THEN** observers see either the complete old set or the complete new set, one catalog revision is committed, and one change event is emitted

#### Scenario: Replacement contains one invalid definition
- **ID**: `extension.protocols.replacement-contains-one-invalid-definition`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::replaces complete owner sets atomically and preserves the old set on validation failure`
- **WHEN** a replacement candidate contains a duplicate, invalid schema, invalid portable name, or cross-owner collision
- **THEN** the entire replacement fails and the previous owner set remains active unchanged

### Requirement: Revisioned tool snapshots
The tool registry SHALL return immutable deterministic catalog snapshots with an opaque catalog revision and descriptors ordered by canonical tool name. Each descriptor SHALL include an opaque revision derived from the current callable definition and SHALL retain that revision only while its externally relevant definition is unchanged.

#### Scenario: Unrelated owner updates its set
- **ID**: `extension.protocols.unrelated-owner-updates-its-set`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::replaces complete owner sets atomically and preserves the old set on validation failure`
- **WHEN** one owner changes tools without changing another owner's definition
- **THEN** the catalog revision changes while the unchanged descriptor may retain its existing tool revision

#### Scenario: Same-name tool is replaced
- **ID**: `extension.protocols.same-name-tool-is-replaced`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** an owner changes the handler, schema, approval metadata, or availability of a tool while retaining its name
- **THEN** that descriptor receives a new tool revision

### Requirement: Correlated cancellable tool handler contract
A portable tool definition SHALL receive JSON-compatible input and a frozen invocation context containing Runtime Session ID, stable call ID, optional turn ID, and an `AbortSignal`. The registry SHALL prevent concurrent reuse of an active call ID and SHALL remove call state after every successful, failed, or cancelled settlement.

#### Scenario: Handler observes cancellation
- **ID**: `extension.protocols.handler-observes-cancellation`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** the shared bridge aborts the active call controller
- **THEN** the handler observes the same signal supplied at invocation and can terminate owned work without importing a native host type

#### Scenario: Duplicate active call identity
- **ID**: `extension.protocols.duplicate-active-call-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** a second invocation uses a call ID that is already active in the Runtime Session
- **THEN** the registry rejects it before invoking a second handler

### Requirement: Closed protocol values reject executable object coercion
Tool inputs, schemas, results, lifecycle values, capability values, and other protocol-owned JSON data SHALL be validated as plain JSON-compatible values before cloning, hashing, freezing, or transport. Validation SHALL reject cycles, unsupported prototypes, accessors or coercion hooks whose execution could change the represented value, and non-finite numbers.

#### Scenario: Tool input supplies a custom coercion hook
- **ID**: `extension-protocols.closed-json.reject-custom-coercion`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects non-plain tool input before cloning or approval digesting`
- **WHEN** a tool invocation input contains a class instance or custom `toJSON` implementation
- **THEN** the registry returns an invalid-input result without executing the hook or deriving approval authority from its coerced output

### Requirement: Tool owner disposal settles owned active calls
Each active tool invocation SHALL retain the exact owning tool-set identity and tool revision. Replacing or disposing an owned set SHALL abort calls whose implementation is removed or revised, await their settlement during owner disposal, and prevent a removed implementation from returning a successful current result.

#### Scenario: Tool owner is disposed during an active call
- **ID**: `extension-protocols.tools.owner-disposal-cancels-active-call`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::aborts and settles active calls when their owner is disposed`
- **WHEN** a plugin is disposed while one of its handlers is still executing
- **THEN** that call observes its abort signal and completes with a structured unavailable or cancelled result before owner disposal settles

#### Scenario: Unchanged tool survives owner-set replacement
- **ID**: `extension-protocols.tools.unchanged-revision-retains-active-call`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::retains active calls only for unchanged definitions during owner replacement`
- **WHEN** an atomic owner-set replacement retains an exactly unchanged definition and revision
- **THEN** its already active calls may finish while calls belonging to removed or revised definitions are aborted

### Requirement: Tool catalog observers cannot invalidate commits
A valid registry mutation SHALL commit its complete immutable snapshot independently of notification observers. Observer failure SHALL be contained and reported diagnostically without making registration, replacement, or disposal appear to have failed after the catalog changed.

#### Scenario: Catalog observer throws during registration
- **ID**: `extension-protocols.tools.catalog-observer-contained`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::contains catalog observer failure after an atomic commit`
- **WHEN** one `tools-changed` observer throws after a valid set is committed
- **THEN** registration returns successfully, the new snapshot remains current, independent observers still run, and the observer failure is diagnostic only

### Requirement: Lifecycle event validation is a closed union
Lifecycle normalization SHALL reject every event type outside the protocol's own event-name keys, including inherited object-property names, and SHALL validate the required and permitted fields for the selected variant before publication.

#### Scenario: Capability profile uses an inherited property name
- **ID**: `extension-protocols.lifecycle.reject-inherited-event-name`
- **EVIDENCE**: `packages/extension-protocols/tests/host-capabilities.spec.ts::rejects inherited object property names as lifecycle events`
- **WHEN** a capability profile lists `constructor`, `toString`, or another inherited property as a lifecycle event
- **THEN** capability validation rejects it as unsupported

#### Scenario: Unknown lifecycle variant is normalized
- **ID**: `extension-protocols.lifecycle.reject-unknown-variant`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::rejects unknown variants and malformed variant payloads`
- **WHEN** publication supplies an unknown type or a known type with missing, extra, or malformed variant fields
- **THEN** normalization fails before any subscriber observes the event

