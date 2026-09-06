## ADDED Requirements

### Requirement: Native preset-neutral OpenClaw integration
The OpenClaw adapter SHALL be an installable native plugin using public host APIs and the existing Runtime Preset roster, Composition Runtime, shared Runtime Host bridge and workspace Cordis peer. It SHALL own one direct binding per native session generation and SHALL NOT depend semantically on optional feature packages, embed a named preset, reuse OMP transport, introduce a generic host framework, patch OpenClaw, or take the selected context-engine slot.

#### Scenario: Native plugin activates an empty preset
- **ID**: `openclaw.activation.empty-preset`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::activates an empty preset through the native plugin`
- **WHEN** the installed plugin selects a valid empty Runtime Preset
- **THEN** its direct Runtime Session activates with canonical empty optional context and tools without requiring Persona, memory, MCP or a context-engine replacement

#### Scenario: Installation uses public exports
- **ID**: `openclaw.packaging.public-exports`
- **EVIDENCE**: `packages/host-openclaw/tests/exports.spec.ts::loads the packaged plugin and preparation entrypoint with one Cordis root`
- **WHEN** a clean deployment loads the packaged plugin and preparation entrypoint against the supported OpenClaw runtime
- **THEN** both resolve their declared public dependencies without repository-private source imports or a duplicate Cordis installation

### Requirement: Prepared concrete native tool declarations
Deployment preparation SHALL activate the selected composition through the ordinary roster and audited activation path, validate one immutable portable catalog, and stage an installable artifact with exact manifest tool names and deterministic native-to-canonical mappings. Unsupported names, collisions or unrepresentable schema semantics SHALL fail preparation rather than widen inputs, truncate identities or substitute a dispatcher. Preparation SHALL dispose its owned Runtime Session before removing temporary resources and SHALL NOT invoke discovered tools or mutate authored presets, patches, unrelated files or an existing installed artifact implicitly. Preparation SHALL NOT interpret process-local descriptor revisions as durable authorization.

#### Scenario: Preparation publishes exact declarations
- **ID**: `openclaw.preparation.exact-declarations`
- **EVIDENCE**: `packages/host-openclaw/tests/preparation.spec.ts::prepares exact native declarations from an audited catalog`
- **WHEN** preparation successfully activates a composition with representable portable tools
- **THEN** its published artifact contains only the validated concrete names and mappings from that catalog after its temporary Runtime Session is disposed

#### Scenario: Preparation rejects incompatible names or schemas
- **ID**: `openclaw.preparation.invalid-contract`
- **EVIDENCE**: `packages/host-openclaw/tests/preparation.spec.ts::rejects unrepresentable tool contracts without replacing prior output`
- **WHEN** preparation encounters colliding native names or a schema it cannot preserve
- **THEN** it reports the incompatible descriptors and exhausts temporary ownership without replacing prior output or authored configuration

#### Scenario: Strict MCP startup precedes preparation snapshot
- **ID**: `openclaw.preparation.awaited-mcp`
- **EVIDENCE**: `packages/host-openclaw/tests/preparation.spec.ts::includes awaited MCP tools without host knowledge of MCP services`
- **WHEN** the prepared composition explicitly configures MCP initial startup as await-ready and every enabled server succeeds
- **THEN** preparation obtains the completed ordinary tool catalog after audited activation without querying an MCP-specific service or rewriting the Loader row

### Requirement: Authoritative Runtime Preset selection
The adapter SHALL consume normal explicit, project, user and deployment-default selection precedence and ordered patches through the roster. It SHALL validate the selected activation against its prepared deployment contract rather than override a conflicting selection. An explicitly defaultless roster SHALL leave the integration inactive; invalid explicit selection SHALL remain distinguishable from absence. Runtime plugin configuration and durable state SHALL remain Loader-owned.

#### Scenario: Selection does not match the prepared deployment
- **ID**: `openclaw.selection.prepared-mismatch`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::rejects a selected preset that conflicts with prepared deployment metadata`
- **WHEN** authoritative selection resolves a composition incompatible with the installed prepared deployment contract
- **THEN** Doppelganger remains unavailable with a selection or regeneration diagnostic instead of silently selecting a different preset

#### Scenario: Deployment has no selected preset
- **ID**: `openclaw.selection.inactive`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::keeps a defaultless deployment inactive without blocking OpenClaw`
- **WHEN** a defaultless roster resolves no Runtime Preset
- **THEN** OpenClaw remains usable with no Doppelganger context or tools and no fabricated activation failure

### Requirement: Synchronous registration and guarded asynchronous warmup
Native registration SHALL synchronously install the prepared tool factory, hooks and cleanup. The asynchronous before-model warmup SHALL share one activation promise per immutable binding, publish ready state only after audited activation, and own a finite deadline and stale-result fence. Synchronous tool factories SHALL read ready snapshots only, never return a Promise or perform blocking waits. Because host hooks can be skipped or errors contained, both factories and invocation SHALL independently enforce readiness. Hook failure SHALL NOT be misrepresented as blocking the native host turn.

#### Scenario: First embedded run observes warmed tools
- **ID**: `openclaw.warmup.first-run`
- **EVIDENCE**: `packages/host-openclaw/tests/native-lifecycle.spec.ts::awaits embedded warmup before synchronous tool construction`
- **WHEN** a supported embedded run executes enabled before-model warmup before its first factory construction
- **THEN** the factory returns current prepared tools only after the shared audited activation completes

#### Scenario: Concurrent warmups share activation
- **ID**: `openclaw.warmup.concurrent`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::shares one activation across concurrent warmups for the same binding`
- **WHEN** concurrent warmups request the same immutable native binding
- **THEN** exactly one Runtime Session is activated for that binding and all successful callers observe its same ready snapshot

#### Scenario: Host skips or times out warmup
- **ID**: `openclaw.warmup.unready-factory`
- **EVIDENCE**: `packages/host-openclaw/tests/native-lifecycle.spec.ts::keeps tools unavailable when warmup is skipped`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::times out held embedded activation and fences late completion`
- **WHEN** native tool construction occurs without completed activation because the hook was skipped, failed or timed out
- **THEN** the factory exposes no Doppelganger tools and reports readiness failure without fabricating host admission failure or exposing a stale snapshot

#### Scenario: Retired warmup completes late
- **ID**: `openclaw.warmup.late-completion`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::times out held embedded activation and fences late completion`
- **EVIDENCE**: `packages/host-openclaw/tests/disposal.spec.ts::exhausts native and Cordis cleanup after one disposer fails`
- **WHEN** activation finishes after its deadline, session replacement or disposal retired its binding
- **THEN** the late Runtime Session is disposed and cannot publish context, tools or callbacks into the replacement

### Requirement: Immutable actor and workspace custody
Each native binding SHALL distinguish agent identity, rotatable native session identity, workspace and trusted principal configuration from routing aliases. The adapter SHALL mount an independent immutable bound or unbound Actor Identity provider, never infer a user from Persona, prompt text, project files or optional sender metadata alone, and SHALL NOT apply one gateway-global actor to unrelated users. A principal/workspace/session-generation change SHALL retire the old binding before replacement. Actor identity SHALL remain outside the shared Runtime Host API.

#### Scenario: Two users share a gateway
- **ID**: `openclaw.identity.isolation`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **WHEN** two native sessions use different trusted principal and workspace bindings under one gateway
- **THEN** their actor-aware context, tool invocations and persistent effects resolve only their own immutable binding

#### Scenario: Sender custody is unresolved
- **ID**: `openclaw.identity.unbound`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::keeps sessions without an exact trusted tuple unbound`
- **WHEN** native ingress has no trusted single-principal binding or contains mixed sender custody
- **THEN** the actor provider stays unbound and actor-dependent operations fail according to their existing contract rather than guessing a principal

#### Scenario: Session route changes underlying identity
- **ID**: `openclaw.identity.rotated-session`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::retires prior closures when a route rotates workspace or session identity`
- **WHEN** a reused route alias changes native session generation, trusted principal or workspace
- **THEN** old closures become unusable before a separate replacement binding is exposed

### Requirement: Authority-preserving per-turn context
The supported embedded direct-user profile SHALL resolve common budgeted context once per correlated turn/run and retain its immutable assembly across retries and tool continuations. Instruction contributions SHALL use native system-context additions; data contributions SHALL use transient user-context projection. The adapter SHALL preserve provenance and SHALL NOT persist injected text into canonical transcript, promote data authority, replace unrelated system instructions or reuse another turn's assembly. Unverified execution paths SHALL NOT advertise per-request or equivalent context fidelity.

#### Scenario: Tool continuation reuses transient context
- **ID**: `openclaw.context.continuation`
- **EVIDENCE**: `packages/host-openclaw/tests/context.spec.ts::preserves instruction and transient data authority across tool continuation`
- **WHEN** an embedded direct-user turn with both instruction and data contributions makes another model request after a tool call
- **THEN** that request retains the same budgeted authority-separated assembly without copying injected text into canonical transcript

#### Scenario: Retry does not duplicate resolution
- **ID**: `openclaw.context.retry`
- **EVIDENCE**: `packages/host-openclaw/tests/context.spec.ts::reuses one context assembly across retries without cross-turn leakage`
- **WHEN** the supported native route repeats prompt hooks for a retry of the same correlated turn
- **THEN** it reuses the retained assembly without duplicate contribution accumulation or reuse in a later turn

#### Scenario: Context provider fails
- **ID**: `openclaw.context.failure`
- **EVIDENCE**: `packages/host-openclaw/tests/context.spec.ts::omits failed context without leaking another session assembly`
- **WHEN** context resolution fails for the current native binding
- **THEN** the adapter reports bounded omission and projects no stale assembly from another turn or session

### Requirement: Prepared native catalog obeys delivery boundaries
The adapter SHALL advertise tools delivery as session-start, project exact immutable descriptors only at supported native factory construction boundaries, and retain exact runtime revisions in native closures. Registry notifications SHALL update validated pending state and diagnostics without claiming dynamic native registration or mid-loop refresh. Undeclared names and incompatible prepared contracts SHALL remain unprojected with explicit regeneration/restart diagnostics; removals and revision changes SHALL immediately make retained calls fail closed. The adapter SHALL NOT silently retarget an old closure to a current implementation.

#### Scenario: Registry adds an undeclared tool
- **ID**: `openclaw.catalog.undeclared`
- **EVIDENCE**: `packages/host-openclaw/tests/reload.spec.ts::diagnoses undeclared tools without expanding the prepared native catalog`
- **WHEN** MCP refresh, Loader reload or generated code registers a name absent from the prepared manifest
- **THEN** the native model catalog does not gain that name and the adapter identifies the required regeneration boundary

#### Scenario: Retained tool revision is replaced
- **ID**: `openclaw.catalog.stale-revision`
- **EVIDENCE**: `packages/host-openclaw/tests/runtime-host-conformance.spec.ts::passes common semantics through the real fixed-catalog OpenClaw adapter`
- **WHEN** a native closure invokes a portable descriptor that has since been replaced or removed
- **THEN** invocation fails with the existing structured stale or unavailable result before either handler runs

#### Scenario: Native factory rebuild sees compatible current descriptors
- **ID**: `openclaw.catalog.next-boundary`
- **EVIDENCE**: `packages/host-openclaw/tests/reload.spec.ts::rejects retained closures after descriptor replacement and binds replacement only at a new factory boundary`
- **WHEN** OpenClaw constructs a new tool set after a compatible declared descriptor changed
- **THEN** the new factory result captures its current revision without mutating an already-running tool loop

#### Scenario: Schema no longer matches prepared contract
- **ID**: `openclaw.catalog.schema-drift`
- **EVIDENCE**: `packages/host-openclaw/tests/reload.spec.ts::rejects incompatible schema drift under an already declared name`
- **WHEN** a declared tool's schema changes incompatibly with the prepared contract
- **THEN** the adapter leaves that descriptor unprojected and reports regeneration instead of using an old schema with new execution semantics

### Requirement: Exact native one-shot tool approval
For required portable approval, the adapter SHALL request real native allow-once or deny using the public before-tool requireApproval route. It SHALL record the native resolution synchronously in call-owned state and mint a protected bridge grant only after execute revalidates final cloned input, call identity, descriptor revision, binding epoch and cancellation. The grant SHALL be consumed at most once. Hook completion, a native approval ID alone, prompt assent, annotations, persistent approval or a decision for another call SHALL NOT authorize execution.

#### Scenario: Native user allows one exact call
- **ID**: `openclaw.approval.exact-call`
- **EVIDENCE**: `packages/host-openclaw/tests/approval.spec.ts::dispatches one exact call after native allow-once resolution`
- **WHEN** native approval allows the exact still-current portable call and final input matches its captured request
- **THEN** one protected grant reaches the bridge and exactly one handler invocation occurs

#### Scenario: Native finalization changes approved input
- **ID**: `openclaw.approval.changed-input`
- **EVIDENCE**: `packages/host-openclaw/tests/approval.spec.ts::rejects final input changes after native approval`
- **EVIDENCE**: `packages/host-openclaw/tests/approval.spec.ts::revokes allow-once when the catalog generation changes before dispatch`
- **WHEN** input, descriptor revision or binding changes after native approval resolves
- **THEN** execute fails closed before handler invocation rather than reusing the earlier decision

#### Scenario: Approval is denied unavailable or cancelled
- **ID**: `openclaw.approval.failure`
- **EVIDENCE**: `packages/host-openclaw/tests/approval.spec.ts::fails closed on denial timeout absent route and cancellation`
- **WHEN** native approval denies, times out, lacks a route or is cancelled
- **THEN** no protected grant is minted and the portable handler is not called

#### Scenario: Approval resolution is replayed
- **ID**: `openclaw.approval.replay`
- **EVIDENCE**: `packages/host-openclaw/tests/approval.spec.ts::rejects replayed native approval across repeated calls and bindings`
- **WHEN** a consumed approval record is reused for the same call or another binding
- **THEN** the bridge receives no reusable authority and no additional handler invocation occurs

### Requirement: Correlated cooperative tool cancellation
Native invocation SHALL preserve canonical names, opaque revisions, JSON-compatible results and errors, and correlated call identity through the shared bridge. Native abort SHALL cancel only its active portable call; signal listeners SHALL be removed after settlement. Completion and cancellation races SHALL report observed handler outcomes without fabricating successful side effects or reviving disposed bindings.

#### Scenario: Native tool abort reaches portable handler
- **ID**: `openclaw.tools.cancellation`
- **EVIDENCE**: `packages/host-openclaw/tests/tools.spec.ts::forwards native cancellation to only the correlated portable call`
- **WHEN** OpenClaw aborts one of two active portable calls
- **THEN** only that call's signal is cancelled and both results remain correlated to their original calls

#### Scenario: Portable tool returns a structured domain error
- **ID**: `openclaw.tools.structured-result`
- **EVIDENCE**: `packages/host-openclaw/tests/tools.spec.ts::preserves portable domain errors separately from adapter failures`
- **WHEN** a portable handler returns a structured failure with bounded data
- **THEN** the native result preserves its error meaning and data without treating it as an adapter transport failure

### Requirement: Lifecycle claims preserve committed-turn semantics
The immutable OpenClaw profile SHALL list only faithfully implemented standard lifecycle kinds and SHALL omit turn-committed in this baseline integration. It SHALL NOT infer accepted turns from agent_end, transcript writes, idle, stop, session-end or disposal, and SHALL NOT replace the selected context engine for capture. Explicit memory operations SHALL remain distinct from unavailable automatic candidate capture. Unsupported external harness or background/group paths SHALL not inherit unproved embedded-context or principal-fidelity claims.

#### Scenario: Attempt ends before later failure
- **ID**: `openclaw.lifecycle.no-false-commit`
- **EVIDENCE**: `packages/host-openclaw/tests/lifecycle.spec.ts::never publishes committed turns from attempt or transcript observations`
- **WHEN** agent_end or persisted transcript rows are observed for an attempt that is later retried, aborted or fails
- **THEN** no portable turn-committed event or resulting automatic capture is emitted

#### Scenario: Preset requires committed-turn capture
- **ID**: `openclaw.lifecycle.capture-unavailable`
- **EVIDENCE**: `packages/host-openclaw/tests/lifecycle.spec.ts::reports missing committed-turn capability without replacing the context engine`
- **WHEN** an optional feature requires committed-turn events absent from the OpenClaw profile
- **THEN** that feature is inactive or fails visibly according to its own capability requirement while the user's selected context engine remains unchanged

### Requirement: Reload and disposal preserve session ownership
The adapter SHALL use Composition Runtime's single serialized reload path and audited rollback, not create a second watcher or mutate authored input. Session reset/replacement/end, plugin disable and gateway shutdown SHALL fence stale work before detachment and attempt every owned cancellation, unsubscription, Runtime Session and Cordis cleanup stage. Failures SHALL remain isolated to affected bindings and cleanup errors SHALL be aggregated after all reachable stages.

#### Scenario: Invalid composition reload restores prior audited state
- **ID**: `openclaw.reload.rollback`
- **EVIDENCE**: `packages/host-openclaw/tests/reload.spec.ts::preserves audited rollback and rejects stale native closures`
- **WHEN** an invalid composition candidate fails and the prior composition passes restoration audit
- **THEN** the binding reports rollback with the restored state while old changed descriptor closures remain unusable

#### Scenario: Disposal continues after one cleanup failure
- **ID**: `openclaw.disposal.exhaustive`
- **EVIDENCE**: `packages/host-openclaw/tests/disposal.spec.ts::exhausts native and Cordis cleanup after one disposer fails`
- **WHEN** binding disposal encounters a failing cleanup stage while calls, subscriptions and sibling resources remain owned
- **THEN** every reachable remaining stage is attempted, late callbacks stay fenced and aggregate cleanup failure is reported without disposing another session

### Requirement: Native host support requires adapter-level proof
Support SHALL require common semantic conformance through real adapter entrypoints with its fixed capability profile, native embedded smoke evidence, and unchanged OMP regression coverage. Direct bridge tests SHALL NOT substitute for OpenClaw registration, factory, approval or lifecycle evidence. Fixture-only controls SHALL preserve OMP dynamic/transported cases and all supported actor-state cases. Documentation SHALL identify the tested host revision, required hook permissions, startup/deployment procedure and unsupported behaviors without claiming full dynamic or automatic-capture parity.

#### Scenario: Fixed-catalog adapter runs common conformance
- **ID**: `openclaw.conformance.shared`
- **EVIDENCE**: `packages/host-openclaw/tests/runtime-host-conformance.spec.ts::passes common semantics through the real fixed-catalog OpenClaw adapter`
- **WHEN** common isolation, revision, approval, cancellation, lifecycle and teardown cases run through the prepared native adapter fixture
- **THEN** the supported profile satisfies them without substituting a direct bridge or changing OMP's dynamic expectations

#### Scenario: Native integration smoke exercises the installed artifact
- **ID**: `openclaw.conformance.native-smoke`
- **EVIDENCE**: `packages/host-openclaw/tests/native-smoke.spec.ts::runs the installed plugin through embedded context tools approval and shutdown`
- **WHEN** a prepared artifact is installed in a temporary supported OpenClaw deployment with configured test services
- **THEN** real embedded execution demonstrates initial tools, authority-separated context, exact native approval and cleanup while undeclared tools and false committed turns remain absent
