## MODIFIED Requirements

### Requirement: OMP session transitions are serialized
The adapter SHALL serialize initial activation, committed OMP session rebinding, projection refresh, failure handling, lifecycle publication, and shutdown through one session-ownership mutation path. A superseded binding SHALL NOT publish events, retain active proxies, or become active again after a newer binding owns the OMP extension.

#### Scenario: Session changes while activation is pending
- **ID**: `omp.session-transition.pending-activation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::commits only the latest requested binding when activation overlaps a session switch`
- **WHEN** OMP commits a session switch while the previous binding is still activating
- **THEN** the adapter settles and disposes the superseded attempt, activates only the current OMP session, and exposes no tools or context from the previous session

#### Scenario: Old hook completes after rebinding
- **ID**: `omp.session-transition.stale-hook`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::discards stale context notifications lifecycle callbacks and proxy closures after replacement`
- **WHEN** asynchronous work captured for the old binding settles after a new binding becomes current
- **THEN** it cannot publish through, fail, replace tools for, or otherwise mutate the new binding

#### Scenario: New session activation fails
- **ID**: `omp.session-transition.failed-rebind`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** OMP has committed a new session identity and its Doppelganger activation fails
- **THEN** the previous binding remains disposed, Doppelganger stays unavailable for the new session with an actionable diagnostic, and ordinary OMP behavior remains usable

### Requirement: Session-owned runtime process
The adapter SHALL bind at most one Node runtime child to the current OMP agent session with a selected Runtime Preset and SHALL communicate with it over framed JSON-RPC on stdio. After OMP commits a new, resumed, forked, or branched session identity, the adapter SHALL withdraw the previous projection, publish neutral disposal for the previous binding when active, dispose its child, and resolve and activate a fresh binding from the new session ID and current working directory. Navigation within the current session tree SHALL retain the existing binding because it does not change Runtime Session identity.

#### Scenario: OMP session starts
- **ID**: `runtime.session.child.ownership`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **WHEN** generic Runtime Preset activation is required for a new OMP agent session
- **THEN** the adapter starts a dedicated child, performs activation, and associates the child only with that session

#### Scenario: Concurrent OMP sessions
- **ID**: `runtime.session.concurrent.children`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::owns independent children for concurrent OMP sessions`
- **WHEN** two OMP agent sessions activate Runtime Presets concurrently
- **THEN** each extension instance owns a different child process and protocol connection

#### Scenario: OMP creates or resumes another session
- **ID**: `runtime.session.switch.rebind`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** OMP emits a committed `session_switch` whose current session ID differs from the active binding
- **THEN** the old child is neutrally disposed and a fresh child activates with the new session ID and current workspace before Doppelganger projection resumes

#### Scenario: OMP branches the conversation into a new session
- **ID**: `runtime.session.branch.rebind`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** OMP emits `session_branch` after creating a branch session
- **THEN** the adapter replaces the old binding with one whose Runtime Session metadata uses the branch session ID

#### Scenario: OMP navigates within the current session tree
- **ID**: `runtime.session.tree.retained`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** OMP emits `session_tree` without changing its session ID
- **THEN** the adapter retains the existing child and does not publish another session start or disposal event

### Requirement: Runtime context projection
Before each user-initiated OMP agent run, the adapter SHALL request current assembled context exactly once from the active binding using the direct principal input and a newly established stable turn identity. It SHALL append non-empty context to the existing OMP system prompt for that run without discarding host instructions or persisting synthetic conversation history. Every model continuation after tool calls in the same run SHALL use the same resolved snapshot and SHALL NOT trigger another context request.

#### Scenario: Runtime context changes between user turns
- **ID**: `runtime.context.reload`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a valid composition or asset update reloads successfully
- **THEN** the next user-initiated OMP agent run receives the current assembled context

#### Scenario: Tool continuation reuses turn context
- **ID**: `runtime.context.same-run-snapshot`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::resolves runtime context once per agent run and keeps one snapshot through tool continuations`
- **WHEN** one OMP agent run performs additional model requests after tool calls
- **THEN** those requests retain the system-prompt snapshot resolved for the direct user input and send no additional `context.resolve` request

#### Scenario: Existing host instructions are preserved
- **ID**: `runtime.context.system-prompt-append`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** a non-empty Doppelganger assembly is resolved before an agent run
- **THEN** the adapter appends it to the existing OMP system prompt rather than replacing host instructions or adding retained conversation messages

#### Scenario: Context resolution fails before an agent run
- **ID**: `runtime.context.request-failure`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::resolves runtime context once per agent run and keeps one snapshot through tool continuations`
- **WHEN** the current child times out, exits, or rejects the once-per-turn context resolution
- **THEN** OMP continues without a Doppelganger prompt override, the failing binding becomes unavailable, and no stale runtime context is injected

### Requirement: Lifecycle event forwarding
The adapter SHALL forward normalized session, turn, tool, and compaction observation events through the child connection owned by one immutable OMP session binding. Every forwarded `sessionId`, `turnId`, `callId`, and `deliveryId` SHALL derive from that binding and its active turn rather than mutable OMP session state read after asynchronous work begins. OMP agent-loop settlement SHALL NOT be reported as `session-completed`; replacement and shutdown without terminal outcome evidence SHALL use neutral `session-disposed`.

#### Scenario: OMP tool completes
- **ID**: `lifecycle.tool.completion.forwarding`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** an OMP tool invocation finishes for the current active turn
- **THEN** the owning runtime binding receives the normalized completion event with its stable session, turn, and call identities

#### Scenario: OMP session changes between asynchronous callbacks
- **ID**: `lifecycle.binding.identity-stability`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** mutable OMP session state changes after a lifecycle callback captured the current turn
- **THEN** the callback either publishes only through the captured owning binding or is discarded as stale and never combines old child state with the new OMP session ID

#### Scenario: OMP agent loop becomes idle
- **ID**: `lifecycle.omp-idle-not-session-complete`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::publishes no session completion for resumable OMP settle hooks`
- **WHEN** OMP emits `agent_end` or `session_stop` for an idle but resumable session
- **THEN** the adapter emits no `session-completed` event

#### Scenario: Active binding is replaced
- **ID**: `lifecycle.rebind.neutral-disposal`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rebinds new resumed forked and branched sessions while retaining same-session tree navigation`
- **WHEN** OMP commits a different session identity while a runtime binding is active
- **THEN** the old binding receives one deterministic `session-disposed` event before disposal and the new binding receives its own `session-started` event only after successful activation

### Requirement: Graceful shutdown
OMP process shutdown SHALL atomically detach the current binding from projection, clear active turn ownership, and begin bounded exhaustive disposal without relying on a long-lived daemon. Shutdown SHALL share the serialized session-ownership path with activation and rebinding, publish at most one neutral `session-disposed` event for the detached active binding, and SHALL NOT allow pending activation or notification work to restore projections afterward.

#### Scenario: OMP session closes normally
- **ID**: `runtime.shutdown.graceful`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **WHEN** OMP emits session shutdown
- **THEN** the adapter releases the bounded host handler, requests runtime disposal, closes the protocol connection, and ensures the owned child exits

#### Scenario: Shutdown races with activation or rebinding
- **ID**: `runtime.shutdown.transition-race`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::invalidates an activation that settles after shutdown begins`
- **WHEN** shutdown begins while session activation or replacement is unsettled
- **THEN** no binding becomes active afterward, projected tools remain withdrawn, and every reachable owned child is disposed

#### Scenario: Shutdown has no terminal session outcome
- **ID**: `runtime.shutdown.neutral-disposal`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** OMP only reports process teardown without a completed, failed, or cancelled session outcome
- **THEN** the adapter publishes `session-disposed` with a bounded reason and does not publish `session-completed`

## REMOVED Requirements

### Requirement: Runtime context is appended without replacing OMP instructions
The adapter SHALL preserve OMP's existing system prompt and append non-empty assembled runtime context only through the run-scoped `before_agent_start` result. It SHALL NOT register a per-request `context` message transformation or persist a synthetic message.

**Migration**: Use the `Runtime context projection` requirement and OMP's run-scoped system-prompt override. Callers may expect `before_agent_start` to return an appended system prompt when runtime context is non-empty.
