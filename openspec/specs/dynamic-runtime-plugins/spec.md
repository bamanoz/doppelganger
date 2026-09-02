# dynamic-runtime-plugins Specification

## Purpose
Defines the opt-in, Runtime-Session-owned workflow for inspecting, defining, approving, running, updating, stopping, and disposing temporary Cordis plugins through bounded guarded capabilities.
## Requirements
### Requirement: Dynamic Runtime Plugins are explicit Runtime Preset capability
The system SHALL provide Dynamic Runtime Plugins as an optional ordinary Cordis Loader plugin. Omission of the plugin SHALL leave existing Runtime Preset, context, tool, Persona, memory, reload, and host behavior unchanged, and the shipped `standard` Runtime Preset SHALL NOT compose the capability.

#### Scenario: User Runtime Preset opts in
- **ID**: `dynamic-runtime-plugins.activation.opt-in`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/plugin.spec.ts::is Loader-visible, isolated with protocol services, and neutral when omitted`
- **WHEN** a user Runtime Preset composes the Dynamic Runtime Plugins row with its required isolated services
- **THEN** the current Runtime Session exposes the temporary plugin control tools

#### Scenario: Runtime Preset omits the extension
- **ID**: `dynamic-runtime-plugins.activation.omitted`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/plugin.spec.ts::is Loader-visible, isolated with protocol services, and neutral when omitted`
- **WHEN** a Runtime Preset does not compose Dynamic Runtime Plugins
- **THEN** it exposes no temporary plugin registry or control tools and otherwise activates as before

#### Scenario: Shipped standard remains inert
- **ID**: `dynamic-runtime-plugins.activation.standard-unchanged`
- **EVIDENCE**: `packages/runtime-presets/tests/plugin-and-standard.spec.ts::is package-owned, healthy, actor-neutral, and selected by the standard deployment default`
- **WHEN** the shipped `standard` Runtime Preset activates
- **THEN** it does not grant generated-code definition or execution authority

### Requirement: Temporary plugin state is Runtime-Session-owned and ephemeral
Every temporary Plugin, immutable Package, activation pointer, run, diagnostic, and generated Fiber SHALL belong to exactly one active Runtime Session. The extension SHALL NOT write Runtime Presets, patches, source files, repositories, user configuration, or durable state, and SHALL NOT restore definitions after owner replacement, Runtime Session disposal, child or process exit, or host restart.

#### Scenario: Concurrent sessions use the same plugin prefix
- **ID**: `dynamic-runtime-plugins.ownership.concurrent-sessions`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::does not leak Package identities or source across Runtime Sessions`
- **WHEN** two Runtime Sessions independently define temporary Plugins from the same semantic prefix
- **THEN** each session can inspect, run, stop, and remove only its own definitions and effects

#### Scenario: Session is disposed
- **ID**: `dynamic-runtime-plugins.ownership.session-disposal`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::undefines exhaustively, invalidates identities, and owner disposal is repeatable`
- **WHEN** the owning Runtime Session is disposed
- **THEN** every generated Fiber and registration is released and all Plugin and Package records are forgotten

#### Scenario: Extension row is replaced by reload
- **ID**: `dynamic-runtime-plugins.ownership.owner-replacement`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::clears ephemeral state on valid owner replacement and retains active effects plus approval after invalid reload`
- **WHEN** a valid composition reload replaces or removes the Dynamic Runtime Plugins Loader row
- **THEN** the prior extension instance disposes its runs and definitions instead of migrating them into the replacement

#### Scenario: Invalid composition reload is rejected
- **ID**: `dynamic-runtime-plugins.ownership.invalid-reload-retains`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::clears ephemeral state on valid owner replacement and retains active effects plus approval after invalid reload`
- **WHEN** a candidate composition reload fails and Composition Runtime retains the previous audited generation
- **THEN** the existing Dynamic Runtime Plugins instance and its active temporary Plugins remain usable

### Requirement: Control surface uses stable qualified portable tools
The extension SHALL register exactly the qualified tools `runtime-plugin.inspect-list`, `runtime-plugin.inspect-query`, `runtime-plugin.inspect-self`, `runtime-plugin.define`, `runtime-plugin.run`, `runtime-plugin.stop`, and `runtime-plugin.undefine`. Tool inputs and outputs SHALL be bounded JSON-compatible values, and malformed or unsupported fields SHALL fail with structured errors before state changes.

#### Scenario: Host lists the control surface
- **ID**: `dynamic-runtime-plugins.tools.complete-surface`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::publishes strict complete schemas and shell-equivalent exact-run approval`
- **WHEN** the extension activates with the portable tool registry
- **THEN** the registry exposes exactly the seven Dynamic Runtime Plugins tools with complete input schemas

#### Scenario: Input contains an unsupported field
- **ID**: `dynamic-runtime-plugins.tools.strict-input`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::rejects malformed additional fields before mutation`
- **WHEN** a control tool receives malformed input or an undeclared additional property
- **THEN** the call returns a structured validation failure and the registry state remains unchanged

### Requirement: Inspection is progressive, read-only, and source-verified
`runtime-plugin.inspect-list` SHALL return a compact manifest of currently supported inspect providers and methods. `runtime-plugin.inspect-query` SHALL accept only a provider and method returned by that manifest, validate its input and bounded JSON output, and SHALL NOT invoke business operations or mutate runtime state. Service and event coding contracts SHALL be generated from selected public source declarations and SHALL fail repository verification when the generated catalog is stale.

#### Scenario: Agent discovers providers before coding
- **ID**: `dynamic-runtime-plugins.inspect.provider-list`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/catalog.spec.ts::lists only provider capabilities before returning exact contracts`
- **WHEN** the agent calls `runtime-plugin.inspect-list`
- **THEN** it receives the exact Service, Event, Builtin, and Tool providers currently supported by this installed version

#### Scenario: Agent queries one exact service
- **ID**: `dynamic-runtime-plugins.inspect.exact-service`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/catalog.spec.ts::lists only provider capabilities before returning exact contracts`
- **WHEN** the agent queries an exact Service provider method and approved service key from the current manifest
- **THEN** it receives that service's generated methods, properties, referenced types, owner-independent purpose, and current live or absent state without receiving a callable service object

#### Scenario: Agent guesses an uncatalogued provider or service
- **ID**: `dynamic-runtime-plugins.inspect.uncatalogued-rejected`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/catalog.spec.ts::rejects uncatalogued providers, methods, names, and oversized output`
- **WHEN** `runtime-plugin.inspect-query` names a provider, method, event, or service outside the current approved catalog
- **THEN** the query fails without exposing private Cordis reflection, registry, Loader, Fiber, or Context internals

#### Scenario: Generated catalog drifts from source
- **ID**: `dynamic-runtime-plugins.inspect.catalog-freshness`
- **EVIDENCE**: `scripts/tests/dynamic-runtime-plugin-catalog.spec.ts::changes the generated freshness identity when a selected declaration changes`
- **WHEN** a selected public service or event declaration changes without regenerating the inspection catalog
- **THEN** repository integrity verification fails and identifies the stale generated artifact

### Requirement: Self inspection reveals state progressively
`runtime-plugin.inspect-self` SHALL list source-free Plugin summaries when no ID is supplied, SHALL return one Plugin's version pointers, Package summaries, active run, and latest bounded diagnostic when only `pluginId` is supplied, and SHALL return exact immutable Package source and digest only when both owning `pluginId` and `packageId` are supplied. A `packageId` without its owning `pluginId` or a cross-session identity SHALL be rejected.

#### Scenario: Agent lists temporary Plugins
- **ID**: `dynamic-runtime-plugins.inspect-self.summary`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::mints ordered non-reused identities without evaluating exact source`
- **WHEN** the agent calls `runtime-plugin.inspect-self` without IDs
- **THEN** it receives bounded source-free summaries of Plugins owned by the current Runtime Session

#### Scenario: Agent inspects an exact Package
- **ID**: `dynamic-runtime-plugins.inspect-self.package-source`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::mints ordered non-reused identities without evaluating exact source`
- **WHEN** the agent supplies an owned `pluginId` and one of that Plugin's `packageId` values
- **THEN** it receives the exact stored source, semantic metadata, digest, current and target pointers, active run, and latest relevant diagnostic without changing execution state

#### Scenario: Package identity is unscoped or foreign
- **ID**: `dynamic-runtime-plugins.inspect-self.foreign-rejected`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::does not leak Package identities or source across Runtime Sessions`
- **WHEN** the caller supplies `packageId` without `pluginId` or names a Plugin or Package not owned by the current Runtime Session
- **THEN** inspection returns a bounded not-found or invalid-input error without leaking source or metadata

### Requirement: Package definitions are immutable, bounded, and non-executing
`runtime-plugin.define` SHALL create a stable Plugin from a validated lowercase semantic prefix or append a new immutable Package to an owned Plugin. It SHALL require bounded non-empty name, purpose, and plain-JavaScript source, enforce configured per-source, per-Plugin Package-count, and total-registry limits, reject syntax errors before storage, mint opaque non-reused identities and a SHA-256 source digest, and SHALL NOT evaluate source, mount a Fiber, request execution approval, or change current or target version pointers.

#### Scenario: First Package is defined
- **ID**: `dynamic-runtime-plugins.define.first-package`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::mints ordered non-reused identities without evaluating exact source`
- **WHEN** the agent defines valid plain JavaScript for a new semantic Plugin prefix
- **THEN** the extension returns minted Plugin and Package identities, metadata, and source digest while no generated effect has run

#### Scenario: Existing Plugin gains a version
- **ID**: `dynamic-runtime-plugins.define.append-version`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::mints ordered non-reused identities without evaluating exact source`
- **WHEN** the agent defines valid source for an existing owned Plugin
- **THEN** a new Package is appended in define order and every earlier Package remains byte-for-byte inspectable

#### Scenario: Source does not parse
- **ID**: `dynamic-runtime-plugins.define.syntax-diagnostic`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::rejects syntax and unsupported source forms without partial records`
- **WHEN** source is invalid JavaScript, uses unsupported module or compilation syntax, or exceeds a configured bound
- **THEN** definition fails with a bounded actionable diagnostic and no Plugin or Package record is partially created

#### Scenario: Registry limit is reached
- **ID**: `dynamic-runtime-plugins.define.registry-limit`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/definition.spec.ts::enforces Plugin Package source aggregate and inspection limits without eviction`
- **WHEN** another definition would exceed a configured Plugin, Package, source-byte, or total-registry bound
- **THEN** the call fails without evicting, overwriting, or executing an existing Package

### Requirement: Generated source runs only after exact native approval
`runtime-plugin.run` SHALL declare required portable approval with a reason that identifies generated JavaScript as process-authority equivalent to granting shell access. Every exact run, restart, update, or rollback attempt SHALL require a new native one-shot grant before source evaluation. The handler SHALL verify the supplied Plugin ID, Package ID, mode, name, purpose, and source digest against the immutable Package after approval and before evaluation; permissive modes, prior grants, prior runs, or DSH dynamic-runner authorization SHALL NOT satisfy the call.

#### Scenario: Exact activation is granted
- **ID**: `dynamic-runtime-plugins.approval.exact-grant`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** the host presents the exact Package metadata and arguments and grants that `runtime-plugin.run` invocation once
- **THEN** the handler validates the immutable target and begins exactly one activation attempt

#### Scenario: Host is permissive
- **ID**: `dynamic-runtime-plugins.approval.permissive-still-prompts`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** OMP runs in permissive or `yolo` mode and the model calls `runtime-plugin.run`
- **THEN** OMP still requires one explicit native decision before the child evaluates stored source

#### Scenario: Approval is rejected or unavailable
- **ID**: `dynamic-runtime-plugins.approval.denied-no-evaluation`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** the exact native approval is rejected, cancelled, stale, or unavailable
- **THEN** no Package source is evaluated, no version pointer changes, and no generated Fiber or effect is created

#### Scenario: Approved arguments are stale or substituted
- **ID**: `dynamic-runtime-plugins.approval.target-mismatch`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::revalidates every immutable approved field before evaluation`
- **WHEN** the invoked name, purpose, source digest, Package identity, or transition mode does not match the immutable Package and current state
- **THEN** the handler fails closed before evaluation even if the host granted the call

### Requirement: Version transitions preserve explicit current and target semantics
A Plugin SHALL retain the last successfully activated `currentPackageId` and an optional failed or in-progress `nextPackageId`. `mode: "run"` SHALL be valid only for first activation or the current known-good Package. `mode: "update"` SHALL be required to switch from a current Package to any different Package, including an older version. Transition requests for missing identities, invalid modes, or a Plugin already transitioning SHALL fail without disturbing the active run.

#### Scenario: First version starts
- **ID**: `dynamic-runtime-plugins.run.first-current`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::mounts a first Package, commits current after activation, and follows parking semantics`
- **WHEN** an approved `mode: "run"` targets a Plugin with no current Package
- **THEN** successful activation sets that Package as current and clears the target pointer

#### Scenario: New version replaces current
- **ID**: `dynamic-runtime-plugins.run.update-version`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::updates and explicitly rolls back immutable Packages with clean cutover`
- **WHEN** an approved `mode: "update"` targets a Package different from current
- **THEN** the old run is disposed before the candidate mounts and success makes the target Package current

#### Scenario: Older version is selected explicitly
- **ID**: `dynamic-runtime-plugins.run.rollback-version`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::updates and explicitly rolls back immutable Packages with clean cutover`
- **WHEN** an approved `mode: "update"` targets an older Package owned by the Plugin
- **THEN** the older Package becomes current only after its activation succeeds

#### Scenario: Transition mode is inconsistent
- **ID**: `dynamic-runtime-plugins.run.invalid-mode`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::rejects inconsistent and overlapping transitions before disturbing current`
- **WHEN** `run` targets a non-current Package or `update` targets a missing or already current Package
- **THEN** the request fails before evaluation and the active run and pointers remain unchanged

### Requirement: Activation uses a guarded plain-JavaScript Cordis lifecycle
After approval, source SHALL evaluate in a fresh `node:vm` realm with a configured synchronous timeout and only documented builtins. The returned value SHALL be a Cordis Plugin function or object with `apply(ctx)`. The extension SHALL mount it as a child Fiber under the extension owner, await settlement, report declared approved services that remain absent, and dispose a failed candidate before returning. The VM and guard SHALL be documented as API shaping and failure reduction, not hostile-code containment.

#### Scenario: Valid Plugin activates
- **ID**: `dynamic-runtime-plugins.lifecycle.valid-activation`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::uses a fresh realm, enforces synchronous timeout, and validates the returned Plugin`
- **WHEN** approved source returns a valid Plugin whose required services are available
- **THEN** its `apply` runs in the guarded Context and the activation reports a running generated Fiber

#### Scenario: Plugin waits for approved service
- **ID**: `dynamic-runtime-plugins.lifecycle.waiting-service`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::mounts a first Package, commits current after activation, and follows parking semantics`
- **WHEN** source declares an approved hard dependency that is currently absent
- **THEN** the settled run is reported as waiting for that exact service and follows normal Cordis reactivation semantics

#### Scenario: Evaluation or apply fails
- **ID**: `dynamic-runtime-plugins.lifecycle.failed-candidate-cleanup`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/effects.spec.ts::removes every failed candidate effect and preserves unrelated registrations`
- **WHEN** evaluation returns an invalid Plugin, exceeds the synchronous timeout, throws, or the candidate Fiber rejects during apply
- **THEN** every reachable candidate resource is disposed and the latest attempt records phase, message, optional bounded stack, and exact identities

#### Scenario: Update candidate fails after current is stopped
- **ID**: `dynamic-runtime-plugins.lifecycle.failed-update-stopped`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::retains known-good current and failed target while a failed update stays stopped`
- **WHEN** a different Package evaluates successfully but fails after the prior active run has been disposed
- **THEN** the known-good current pointer is retained, the failed Package remains the target, and no generated run is active until another approved call

### Requirement: Guarded code can reach only approved disposable capabilities
The guarded Context SHALL expose only documented lifecycle-safe effect verbs and services selected by the generated catalog. Property access to a service SHALL require that service in the Plugin's declared injection contract; optional `ctx.get(name)` SHALL return only catalogued services. The guard SHALL reject raw Context, Fiber, Loader, HMR, registry, root, plugin-construction, and uncatalogued-service access, SHALL reject any service result that returns a Cordis Context, and SHALL record post-activation guard failures diagnostically.

#### Scenario: Plugin uses an approved service
- **ID**: `dynamic-runtime-plugins.guard.approved-service`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::allows declared and optional approved services but rejects uncatalogued and framework access`
- **WHEN** generated source uses an exact catalogued service according to its inspected contract
- **THEN** the call reaches that live service through a guarded façade and its lifecycle-owned registrations dispose with the generated Fiber

#### Scenario: Plugin guesses a live but uncatalogued service
- **ID**: `dynamic-runtime-plugins.guard.uncatalogued-service`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::allows declared and optional approved services but rejects uncatalogued and framework access`
- **WHEN** generated source requests a service that exists in the Runtime Session but is absent from the approved catalog
- **THEN** the guard rejects access without returning the live service

#### Scenario: Plugin requests framework internals
- **ID**: `dynamic-runtime-plugins.guard.framework-internals`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::allows declared and optional approved services but rejects uncatalogued and framework access`
- **WHEN** generated source reads a withheld framework property or a service returns another Cordis Context
- **THEN** the guard throws a bounded actionable error and records it against the active run

#### Scenario: Plugin uses unavailable globals
- **ID**: `dynamic-runtime-plugins.guard.node-global-redirects`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::teaches unavailable globals and withholds tool invocation and mutable registrations`
- **WHEN** source attempts `import`, `require`, process access, Buffer, native fetch, or native timer globals
- **THEN** parsing or execution fails with guidance to use an inspected approved Cordis service instead

### Requirement: Generated portable tools cannot bypass host policy
The guarded `doppelgangerTools` façade SHALL permit source-free descriptor listing and lifecycle-owned registration through the existing Tool Registry, but SHALL NOT expose `invoke`, live handlers, another registration's mutable object, or the reserved `runtime-plugin` control namespace. Registered definitions SHALL pass the same JSON, schema, name, approval, duplicate, result, and lifecycle validation as any ordinary extension tool.

#### Scenario: Generated Plugin registers a tool
- **ID**: `dynamic-runtime-plugins.generated-tools.registration`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/effects.spec.ts::unwinds generated context, tool, lifecycle subscription, and service effects on stop`
- **WHEN** generated source registers a valid qualified tool outside the reserved control namespace
- **THEN** the ordinary registry exposes it to the host and removes it when the generated Fiber stops or is replaced

#### Scenario: Generated Plugin attempts direct invocation
- **ID**: `dynamic-runtime-plugins.generated-tools.invoke-withheld`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::teaches unavailable globals and withholds tool invocation and mutable registrations`
- **WHEN** generated source tries to invoke another portable tool or obtain its live handler through the guarded registry
- **THEN** no such capability is available and required host approval cannot be bypassed

#### Scenario: Generated Plugin claims the control namespace
- **ID**: `dynamic-runtime-plugins.generated-tools.reserved-prefix`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/guard.spec.ts::teaches unavailable globals and withholds tool invocation and mutable registrations`
- **WHEN** generated source attempts to register `runtime-plugin.run` or another `runtime-plugin.*` name
- **THEN** registration fails without replacing or shadowing the control surface

### Requirement: Context, tool, service, event, and external effects unwind with the run
Every contribution made through approved Cordis or extension APIs SHALL be owned by the generated Fiber. Stop, successful replacement, failed candidate cleanup, undefine, extension disposal, and Runtime Session disposal SHALL remove those contributions before the operation reports completion. A stale host tool proxy or retained generated callback SHALL NOT reactivate a removed handler.

#### Scenario: Generated context and tool are stopped
- **ID**: `dynamic-runtime-plugins.effects.stop-unwinds`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/effects.spec.ts::unwinds generated context, tool, lifecycle subscription, and service effects on stop`
- **WHEN** a running generated Plugin owns context, tool, event, service, timer, and external subscription effects and is stopped
- **THEN** all owned contributions are disposed while the immutable Package definitions remain available

#### Scenario: Generated Package is replaced
- **ID**: `dynamic-runtime-plugins.effects.update-cutover`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** an approved update replaces a generated Package with another version
- **THEN** the host observes only the successfully committed version's active tool and context contributions

#### Scenario: Stale proxy is called after removal
- **ID**: `dynamic-runtime-plugins.effects.stale-proxy`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** a caller retains a host proxy after stop, update, undefine, owner replacement, or session disposal removed its generated tool
- **THEN** the proxy fails unavailable without approval or invocation of the removed handler

### Requirement: Stop and undefine have distinct idempotent semantics
`runtime-plugin.stop` SHALL cancel or serialize behind an in-flight transition, dispose the active run exhaustively, and retain all immutable Packages and version pointers; calling it when already stopped SHALL succeed idempotently. `runtime-plugin.undefine` SHALL stop the Plugin if necessary, remove every Package and diagnostic, invalidate its identities for the current session, and SHALL return only after reachable cleanup completes.

#### Scenario: Running Plugin is stopped
- **ID**: `dynamic-runtime-plugins.stop.retain-definitions`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::serializes mutations deterministically and supports idempotent stop and restart`
- **WHEN** the agent calls `runtime-plugin.stop` for a running owned Plugin
- **THEN** its effects are gone and its Packages, current pointer, target pointer, and inspection history remain available

#### Scenario: Stopped Plugin is restarted
- **ID**: `dynamic-runtime-plugins.stop.restart-current`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::serializes mutations deterministically and supports idempotent stop and restart`
- **WHEN** the agent later calls approved `runtime-plugin.run` for the retained current Package
- **THEN** a new run identity activates that Package without redefining or mutating its source

#### Scenario: Plugin is undefined
- **ID**: `dynamic-runtime-plugins.undefine.permanent-session-removal`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::undefines exhaustively, invalidates identities, and owner disposal is repeatable`
- **WHEN** the agent calls `runtime-plugin.undefine` for an owned Plugin
- **THEN** any run is disposed and later inspection or execution of its Plugin and Package identities fails as missing

### Requirement: Concurrent mutation and disposal are deterministic and exhaustive
The extension SHALL serialize all state-changing control operations, reject new work after disposal begins, memoize disposal, attempt cleanup of every active Plugin even when another disposer fails, clear registry ownership in a finally-equivalent path, and report collected cleanup failures only after all reachable cleanup settles.

#### Scenario: Concurrent updates target one Plugin
- **ID**: `dynamic-runtime-plugins.concurrency.one-transition`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::rejects inconsistent and overlapping transitions before disturbing current`
- **WHEN** two approved calls concurrently attempt different transitions for the same Plugin
- **THEN** they execute in queue order and each validates against the state produced by the preceding transition

#### Scenario: One generated disposer fails
- **ID**: `dynamic-runtime-plugins.disposal.failure-exhaustion`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::exhausts sibling run cleanup when one generated disposer rejects and memoizes failure`
- **WHEN** extension or session disposal encounters a failing generated disposer while other runs and definitions remain
- **THEN** it still attempts every sibling cleanup, clears all registry ownership, and reports an aggregate failure afterward

#### Scenario: Disposal is repeated
- **ID**: `dynamic-runtime-plugins.disposal.idempotent`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/tools.spec.ts::exhausts sibling run cleanup when one generated disposer rejects and memoizes failure`
- **WHEN** cleanup is requested again after successful or partially failing disposal
- **THEN** it reuses the settled result without repeating side effects or accepting new definitions

### Requirement: Configuration and diagnostics are strict and bounded
The extension SHALL reject unknown configuration fields and invalid values before registering tools. Configuration SHALL bound synchronous VM evaluation, source bytes, names, purposes, Plugins, Packages per Plugin, aggregate stored source, inspection output, diagnostic messages, and stacks. Errors SHALL identify the phase and exact Plugin, Package, and run identities when those identities exist, while omitting unbounded host objects and secrets.

#### Scenario: Configuration contains unknown or unsafe values
- **ID**: `dynamic-runtime-plugins.config.strict-bounds`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/plugin.spec.ts::normalizes safe bounded configuration and rejects unknown unsafe values`
- **WHEN** Loader configuration contains an unknown field, non-finite timeout, negative limit, or value beyond the supported maximum
- **THEN** activation fails before the control tools or registry become available

#### Scenario: Run fails after identities are minted
- **ID**: `dynamic-runtime-plugins.diagnostics.correlated-bounded`
- **EVIDENCE**: `packages/extension-dynamic-runtime-plugins/tests/lifecycle.spec.ts::retains known-good current and failed target while a failed update stays stopped`
- **WHEN** an activation, guarded callback, or cleanup operation fails
- **THEN** inspection reports a bounded phase-specific diagnostic correlated to the exact temporary identities without serializing raw runtime objects

### Requirement: Generated-code trust boundary is explicit
Documentation, tool descriptions, approval reasons, and the development skill SHALL state that Dynamic Runtime Plugins execute trusted process code, that `node:vm` is not a security sandbox, that OMP's child process is a failure boundary rather than hostile-code containment, and that native DSH execution occurs in the DSH process. The system SHALL NOT describe generated plugins as safely sandboxed.

#### Scenario: User reviews activation approval
- **ID**: `dynamic-runtime-plugins.trust.approval-warning`
- **EVIDENCE**: `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts::projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation`
- **WHEN** the host presents a `runtime-plugin.run` approval request
- **THEN** the user sees the exact Package metadata and an explicit process-authority warning before deciding

#### Scenario: Documentation describes the VM
- **ID**: `dynamic-runtime-plugins.trust.no-sandbox-claim`
- **EVIDENCE**: `scripts/tests/dynamic-runtime-plugin-docs.spec.ts::states the generated-code trust boundary without sandbox claims`
- **WHEN** repository integrity checks inspect the owning architecture, operations, and host documentation
- **THEN** the documents distinguish API guarding and lifecycle cleanup from hostile-code security isolation
