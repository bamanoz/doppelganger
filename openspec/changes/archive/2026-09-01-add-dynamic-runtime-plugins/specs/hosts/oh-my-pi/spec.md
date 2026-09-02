## ADDED Requirements

### Requirement: OMP projects opt-in Dynamic Runtime Plugins through the ordinary portable path
When the selected Runtime Preset composes Dynamic Runtime Plugins, OMP SHALL project its qualified control tools through the existing child transport and native tool registry without adding a second transport, host-specific dynamic runner, generic dispatch tool, or implicit generated-code capability. A Runtime Preset that omits the extension SHALL retain its prior OMP behavior.

#### Scenario: Opt-in preset exposes control tools
- **ID**: `omp.dynamic-runtime-plugins.opt-in-projection`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** OMP activates a user Runtime Preset containing the Dynamic Runtime Plugins extension and standard tool protocol
- **THEN** OMP exposes the exact qualified `runtime-plugin.*` tools through its ordinary runtime tool projection

#### Scenario: Preset omits dynamic plugins
- **ID**: `omp.dynamic-runtime-plugins.omitted-neutrality`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::keeps ordinary presets and shipped standard unchanged when the extension is omitted`
- **WHEN** OMP activates shipped `standard` or another Runtime Preset without Dynamic Runtime Plugins
- **THEN** no temporary plugin tools or generated-code authority appear and existing context and tools remain unchanged

#### Scenario: OMP package resolves an opt-in Loader row
- **ID**: `omp.dynamic-runtime-plugins.package-resolution`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::contains the resolvable dependency closure for shipped standard and opt-in dynamic plugins`
- **WHEN** a user Runtime Preset loaded through the private `@doppelganger/doppelganger-omp` product package imports the Dynamic Runtime Plugins package
- **THEN** the import resolves from the declared installed dependency closure without adding that product dependency to `host-omp`

### Requirement: OMP requires exact native approval for every generated-code activation
Every projected `runtime-plugin.run` call SHALL enter OMP's native required-approval path before the child receives `tools.invoke`. The prompt SHALL show the bounded exact parsed arguments, including Plugin ID, Package ID, name, purpose, mode, and source digest, together with the portable process-authority warning. `yolo`, permissive policy, earlier approvals, or prior Package runs SHALL NOT bypass the decision.

#### Scenario: User grants one activation
- **ID**: `omp.dynamic-runtime-plugins.approval.one-shot`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** the user grants one exact `runtime-plugin.run` prompt
- **THEN** OMP invokes the current child descriptor once and the grant cannot authorize a later restart, update, or rollback

#### Scenario: OMP runs in yolo mode
- **ID**: `omp.dynamic-runtime-plugins.approval.yolo-prompts`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** OMP is configured for `yolo` and the model calls `runtime-plugin.run`
- **THEN** OMP still prompts with the generated-code warning before sending any invocation to the child

#### Scenario: Approval is denied or unavailable
- **ID**: `omp.dynamic-runtime-plugins.approval.denied-no-child-call`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** the user rejects or cancels the prompt or OMP cannot present the required decision
- **THEN** the child handler is not invoked, stored source remains unevaluated, and the Runtime Session stays usable

### Requirement: OMP observes exact generated tool and context lifecycle
Generated tools and context contributions SHALL use the existing runtime notifications and per-turn context resolution. OMP SHALL activate newly registered generated tool proxies, exactly replace them after a successful Package update, remove them after stop, undefine, owner replacement, or session disposal, and SHALL NOT invoke a removed generated handler through a stale proxy closure. Invalid composition reload SHALL retain the prior audited extension instance and projection.

#### Scenario: Generated Plugin registers context and a tool
- **ID**: `omp.dynamic-runtime-plugins.effects.visible`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** an approved generated Package registers one context provider and one portable tool
- **THEN** the next context resolution includes the contribution and OMP exposes the new tool without restarting the session

#### Scenario: Generated Package updates successfully
- **ID**: `omp.dynamic-runtime-plugins.effects.update-cutover`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** an approved Package update removes one generated tool and registers another
- **THEN** OMP commits exactly the new generated tool set while unrelated OMP and Doppelganger tools remain active

#### Scenario: Generated Plugin stops
- **ID**: `omp.dynamic-runtime-plugins.effects.stop-removes`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** `runtime-plugin.stop` disposes an active generated Fiber
- **THEN** its generated context and tools disappear from subsequent OMP interactions while the control tools and immutable Package definitions remain

#### Scenario: Stale generated proxy is retained
- **ID**: `omp.dynamic-runtime-plugins.effects.stale-proxy`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** a caller retains a generated tool proxy after stop, update, undefine, extension replacement, or Runtime Session disposal
- **THEN** the closure fails unavailable without prompting or calling the removed child handler

#### Scenario: Composition reload is invalid
- **ID**: `omp.dynamic-runtime-plugins.effects.invalid-reload-retains`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::clears ephemeral state on valid owner replacement and retains active effects plus approval after invalid reload`
- **WHEN** a candidate Runtime Preset reload fails activation audit
- **THEN** OMP retains the previous audited Dynamic Runtime Plugins instance, active generated effects, and approval descriptors

### Requirement: OMP child ownership contains ordinary generated-plugin failure
Generated source SHALL execute inside the existing per-session OMP runtime child. A parse, evaluation, guarded-access, apply, waiting-dependency, or disposer failure contained and returned by Dynamic Runtime Plugins SHALL remain a structured domain failure and SHALL NOT disable a healthy child. If generated code crashes, terminates, or irrecoverably corrupts the child process, OMP SHALL apply its existing fatal child isolation by disabling Doppelganger only for that OMP session and preserving ordinary OMP behavior.

#### Scenario: Generated Package apply fails normally
- **ID**: `omp.dynamic-runtime-plugins.failure.domain-contained`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::contains structured generated failures and isolates a fatal child exit to its owning OMP session`
- **WHEN** an approved Package evaluates but its guarded Fiber rejects during apply and the extension cleans the candidate
- **THEN** OMP receives the structured run failure while context, control tools, and prior non-generated runtime features remain usable

#### Scenario: Generated code terminates the child
- **ID**: `omp.dynamic-runtime-plugins.failure.child-isolation`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::contains structured generated failures and isolates a fatal child exit to its owning OMP session`
- **WHEN** trusted generated code causes the owned runtime child to exit or lose its transport
- **THEN** OMP withdraws all Doppelganger projections for that session, reports the fatal child diagnostic, and continues ordinary host operation

### Requirement: OMP teardown disposes generated runs before child release
OMP session shutdown SHALL request Runtime Session disposal through the existing bounded detached teardown. That disposal SHALL exhaustively unwind active generated Fibers and forget temporary definitions before the child exits when graceful cleanup succeeds; if cleanup hangs or fails, OMP SHALL preserve its existing bounded escalation and honest diagnostic behavior.

#### Scenario: Session closes with active generated Plugins
- **ID**: `omp.dynamic-runtime-plugins.shutdown.graceful`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::disposes active generated effects during bounded session shutdown`
- **WHEN** an OMP session closes while temporary Plugins are active
- **THEN** child Runtime Session disposal removes their effects and ephemeral state before graceful child exit

#### Scenario: Generated disposer does not settle
- **ID**: `omp.dynamic-runtime-plugins.shutdown.escalation`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::forces bounded child termination when generated cleanup never settles`
- **WHEN** a generated disposer rejects or exceeds the existing child teardown deadline
- **THEN** OMP releases its shutdown handler, reports the observed cleanup failure, and escalates owned child termination without claiming graceful completion
