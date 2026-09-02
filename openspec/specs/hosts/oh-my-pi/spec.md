# Oh My Pi Host Specification

## Purpose

Defines the first concrete host integration, allowing Oh My Pi sessions to activate and use portable Doppelganger compositions without embedding the runtime into OMP.

## Requirements

### Requirement: Project manifest discovery
The OMP adapter SHALL search from the session working directory upward to the Git root for `.doppelganger/manifest.yaml` and SHALL use the nearest valid manifest as the project Runtime Preset selection layer.

#### Scenario: Nested working directory
- **ID**: `manifest.nearest.selection`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::discovers the nearest manifest without walking above the Git root`
- **WHEN** an OMP session starts in a subdirectory below a configured project root
- **THEN** the adapter selects the Runtime Preset named by the nearest project manifest

#### Scenario: No project manifest
- **ID**: `manifest.user.default.selection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::resolves explicit, project, and user selection and rejects unhealthy winners`
- **WHEN** no project manifest exists before the Git root
- **THEN** the adapter uses the configured user `defaultRuntimePreset` if one exists

### Requirement: Session-owned runtime process
The adapter SHALL start one Node runtime child for each OMP agent session with a selected Runtime Preset and SHALL communicate with it over framed JSON-RPC on stdio.

#### Scenario: OMP session starts
- **ID**: `runtime.session.child.ownership`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **WHEN** generic Runtime Preset activation is required for a new OMP agent session
- **THEN** the adapter starts a dedicated child, performs activation, and associates the child only with that session

#### Scenario: Concurrent OMP sessions
- **ID**: `runtime.session.concurrent.children`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::owns independent children for concurrent OMP sessions`
- **WHEN** two OMP agent sessions activate Runtime Presets concurrently
- **THEN** each session owns a different child process and protocol connection

### Requirement: Runtime context projection
Before each model turn, the adapter SHALL request current assembled context from the active generic runtime and append it without discarding the host's existing system instructions.

#### Scenario: Runtime context changes during session
- **ID**: `runtime.context.reload`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a valid composition or asset update reloads successfully
- **THEN** the next OMP model turn receives the current assembled context

### Requirement: Runtime tool projection
The adapter SHALL project active runtime tools into OMP and proxy invocations and results over the session connection without requiring Persona or memory extensions.

#### Scenario: Runtime tool is added or updated
- **ID**: `runtime.tool.reload.upsert`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** hot reload adds a tool or changes its definition
- **THEN** the OMP session exposes the new active definition without restarting the session

#### Scenario: Runtime tool is removed
- **ID**: `runtime.tool.reload.remove`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** hot reload removes a previously exposed tool
- **THEN** the adapter deactivates that tool for the remainder of the OMP session

### Requirement: Lifecycle event forwarding
The adapter SHALL forward normalized session, turn, and tool observation events to the runtime-side host plugin.

#### Scenario: OMP tool completes
- **ID**: `lifecycle.tool.completion.forwarding`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** an OMP tool invocation finishes
- **THEN** the runtime receives the normalized completion event associated with the active runtime session

### Requirement: Graceful shutdown
OMP session shutdown SHALL dispose the runtime session and terminate its child process without relying on a long-lived daemon.

#### Scenario: OMP session closes normally
- **ID**: `runtime.shutdown.graceful`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **WHEN** OMP emits session shutdown
- **THEN** the adapter requests runtime disposal, closes the protocol connection, and ensures the owned child exits

### Requirement: Runtime failure isolation
Runtime startup, activation, protocol, notification-observer, or projection failure SHALL be classified at its owning boundary. Fatal child/transport failures SHALL disable Doppelganger for the affected OMP session and SHALL NOT terminate OMP; contained observer failures SHALL leave the healthy transport active.

#### Scenario: Manifest is invalid
- **ID**: `manifest.invalid.nonblocking`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** a discovered project manifest cannot be validated
- **THEN** Runtime Preset activation is skipped and the adapter reports the exact configuration problem without blocking OMP

### Requirement: Notification observer failure is contained
Each framed JSON-RPC notification observer SHALL run as an independently contained observer. A rejected observer SHALL produce a bounded diagnostic without closing the peer, preventing sibling observers, or rejecting unrelated pending requests.

#### Scenario: One notification observer throws
- **ID**: `transport.notification.observer.failure.containment`
- **EVIDENCE**: `packages/host-omp/tests/protocol.spec.ts::contains rejecting notification observers and preserves later traffic`
- **EVIDENCE**: `packages/host-omp/tests/protocol.spec.ts::bounds notification observer diagnostics`
- **WHEN** a notification has one observer that rejects and another that succeeds
- **THEN** the successful observer completes, the rejection is reported diagnostically, and a subsequent request/response and notification cycle still succeeds

### Requirement: Host package exports are intentional
The `host-omp` package SHALL expose the ordinary extension/adapter consumer API from its root and SHALL expose transport, child-runtime, or test-oriented contracts only through declared subpath exports when external use is intentional. Internal-only symbols SHALL not remain public solely because tests import the root.

#### Scenario: An OMP extension consumer imports the package root
- **ID**: `package.root.exports`
- **EVIDENCE**: `packages/host-omp/tests/exports.spec.ts::exposes only the ordinary extension constructor at runtime`
- **EVIDENCE**: `packages/host-omp/tests/exports.spec.ts::does not expose package-private transport or child modules`
- **WHEN** a normal consumer imports `@doppelganger/doppelganger-host-omp`
- **THEN** it receives the supported extension construction and adapter-facing contracts without unrelated child or framed-transport internals

### Requirement: OMP adapter is composition-neutral
The generic OMP adapter SHALL accept a fully resolved serialized composition activation and SHALL NOT select a named Runtime Preset, require Persona metadata, or import a specific Runtime Preset. Runtime selection outside the adapter SHALL resolve the winning Runtime Preset and ordered patches.

#### Scenario: Actor-aware Persona composition is activated
- **ID**: `activation.composition.neutral.actor-aware`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **WHEN** generic configuration selects an actor-aware Persona Runtime Preset for an OMP session
- **THEN** the adapter starts that serialized composition without containing named-preset or Persona-specific selection logic

#### Scenario: Non-persona composition is activated
- **ID**: `activation.composition.neutral.generic`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **WHEN** configuration resolves another valid Runtime Preset with the required host mount
- **THEN** the same OMP adapter activates it without Persona or memory extensions

### Requirement: OMP supplies actor identity outside Runtime Presets
The OMP extension SHALL accept an optional non-empty `actorId` host option, validate it before child activation, transport it across the versioned parent/child activation boundary, and provide it through the protected runtime-side actor service. Runtime Preset files, project manifests, patches, context, and tools SHALL NOT select or override that identifier.

#### Scenario: Local OMP actor is configured
- **ID**: `omp.actor.bound-session`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** an OMP session activates a Runtime Preset with a valid configured `actorId`
- **THEN** the child runtime exposes that exact immutable actor binding to actor-aware extensions for the lifetime of the session

#### Scenario: OMP actor identifier is invalid
- **ID**: `omp.actor.invalid-config`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rejects invalid actor configuration before starting a child`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the OMP extension receives an empty or non-string actor identifier
- **THEN** activation fails visibly before a child Runtime Session becomes active and ordinary OMP behavior remains usable

#### Scenario: OMP has no actor configuration
- **ID**: `omp.actor.unbound-generic`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** OMP activates an actor-independent Runtime Preset without `actorId`
- **THEN** the generic runtime remains usable with an explicit unbound actor service

### Requirement: OMP actor binding is not model-controlled
The OMP adapter SHALL NOT project actor selection, actor switching, or raw actor identifiers as model-invocable tools. Changing the configured actor SHALL require disposal and activation of a new Runtime Session.

#### Scenario: Memory tools are projected
- **ID**: `omp.actor.tool-neutrality`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::registers complete schemas and contributes authority-aware whole memory records`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** an actor-bound memory Runtime Preset activates successfully
- **THEN** projected memory schemas contain no `actorId` field and every invocation uses the session binding

#### Scenario: Runtime composition reloads
- **ID**: `omp.actor.reload-stability`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::isolates bound actors, exposes unbound state, and retains the host binding across reload`
- **WHEN** a valid Runtime Preset or patch reload commits during an active OMP session
- **THEN** the actor binding remains unchanged even if authored configuration attempts to add an actor-like field

### Requirement: One isolated runtime process serves one OMP session
Each active OMP session SHALL own a separate Doppelganger child process and composition session. Disposal or failure of one child SHALL not affect another session or ordinary OMP facilities.

#### Scenario: Child crashes
- **ID**: `runtime.failure.child.isolation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics`
- **WHEN** the Doppelganger child exits or reports unrecoverable failure
- **THEN** projected Doppelganger tools and context are disabled, a diagnostic is surfaced, and normal OMP prompts and tools continue working

### Requirement: Adapter transport exposes the host-neutral runtime surface
The OMP transport SHALL support composition activation with an optional host actor binding, disposal, context resolution, tool listing and invocation, lifecycle publication, and runtime notifications over framed request/response messages. Both endpoints SHALL validate the same actor-aware activation contract and reject malformed, version-mismatched, or out-of-state requests without corrupting the session.

#### Scenario: Context is requested before activation
- **ID**: `transport.context.inactive.error`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the extension requests context before a runtime session is active
- **THEN** the request fails with a transport-visible state error and OMP proceeds without Doppelganger context

#### Scenario: Runtime composition changes
- **ID**: `runtime.reload.projection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition reload changes context or tools
- **THEN** the child notifies the OMP extension and the next turn observes the current context and tool set without changing the actor binding

### Requirement: Runtime context is appended without replacing OMP instructions
Before an agent run, the adapter SHALL resolve Doppelganger context using the current principal input, stable turn identity, and configured budget, then append accepted content to the existing OMP system prompt. Failure SHALL leave the existing prompt unchanged.

#### Scenario: Context resolves successfully
- **ID**: `context.prompt.append`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** Doppelganger returns non-empty assembled context
- **THEN** OMP receives its existing system prompt followed by the assembled contribution

#### Scenario: Context resolution fails
- **ID**: `context.failure.fallback`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics`
- **WHEN** the child times out, crashes, or rejects context resolution
- **THEN** the current OMP turn continues with its original system prompt and Doppelganger is marked failed for the session

### Requirement: Projected OMP tools preserve supported schemas
For each available runtime tool, the adapter SHALL register an OMP proxy whose validation reflects the supported subset of the tool's JSON Schema, including object properties, required fields, arrays, scalar types, enumerations, descriptions, and additional-property policy. Unsupported schema constructs SHALL fail projection diagnostically rather than silently widening validation.

#### Scenario: Structured memory tool is projected
- **ID**: `tool.schema.validation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves nested objects, arrays, scalars, enums, descriptions, and additional-property policy`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** a runtime tool requires named fields with scalar and enumeration constraints
- **THEN** OMP validates those fields before sending a transport invocation

#### Scenario: Runtime tool schema is unsupported
- **ID**: `tool.schema.unsupported`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rejects unsupported constructs at their schema path instead of widening validation`
- **WHEN** a descriptor uses a construct the adapter cannot represent faithfully
- **THEN** that proxy remains unavailable and a diagnostic identifies the unsupported construct

### Requirement: OMP proxy names preserve readable portable identity
For every available portable tool whose qualified name satisfies the host-neutral tool-name grammar, the OMP adapter SHALL derive the proxy name as the exact ASCII prefix `doppelganger_` followed by the portable name with each `.` replaced by `_` and every segment character otherwise unchanged. Because `_` is not valid inside portable tool names, this projection SHALL be injective for valid descriptors. The adapter SHALL NOT register compatibility aliases using the removed hexadecimal separator encoding.

#### Scenario: Two-segment portable tool is projected
- **ID**: `omp.tool-name.readable-two-segment`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects readable proxy names, dispatches canonical names, and rejects stale closures after replacement`
- **WHEN** the runtime exposes `persona.revise`
- **THEN** OMP exposes `doppelganger_persona_revise` and does not expose a legacy encoded alias

#### Scenario: Multi-segment tool preserves segment characters
- **ID**: `omp.tool-name.readable-multi-segment`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects readable proxy names, dispatches canonical names, and rejects stale closures after replacement`
- **WHEN** the runtime exposes `runtime-plugin.inspect-list` and `memory.candidates.list`
- **THEN** OMP exposes `doppelganger_runtime-plugin_inspect-list` and `doppelganger_memory_candidates_list`

#### Scenario: Runtime tools change after activation
- **ID**: `omp.tool-name.clean-cutover-reload`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects readable proxy names, dispatches canonical names, and rejects stale closures after replacement`
- **WHEN** a committed runtime update removes one portable tool and adds another
- **THEN** the old readable proxy is inactive, the new readable proxy is active, and no legacy alias is active

### Requirement: OMP proxy invocation uses canonical descriptor identity
The adapter SHALL retain the exact dotted portable name with each committed projected descriptor and SHALL invoke `tools.invoke` with that canonical name. Dispatch, approval lookup, replacement, and stale-proxy checks SHALL use the committed proxy-to-descriptor association and SHALL NOT decode or otherwise reconstruct the portable name from the OMP proxy string.

#### Scenario: Readable proxy invokes dotted portable tool
- **ID**: `omp.tool-name.canonical-dispatch`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects readable proxy names, dispatches canonical names, and rejects stale closures after replacement`
- **WHEN** OMP calls `doppelganger_memory_candidates_list`
- **THEN** the child receives one `tools.invoke` request whose name is exactly `memory.candidates.list`

#### Scenario: Descriptor is replaced under the same portable name
- **ID**: `omp.tool-name.current-descriptor-replacement`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** reload replaces the descriptor for `persona.revise` while retaining its portable name
- **THEN** approval and invocation through `doppelganger_persona_revise` use the replacement descriptor rather than stale captured metadata

#### Scenario: Removed proxy closure is invoked
- **ID**: `omp.tool-name.stale-closure-rejected`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects readable proxy names, dispatches canonical names, and rejects stale closures after replacement`
- **WHEN** a caller retains an old `doppelganger_persona_revise` closure after `persona.revise` is removed
- **THEN** the closure returns `RUNTIME_UNAVAILABLE` and does not invoke another portable tool

### Requirement: OMP rejects provider-unsafe proxy names before registration
A projected OMP proxy name SHALL contain no more than 64 ASCII characters, including the `doppelganger_` prefix. If a portable descriptor would exceed that limit or collide with another projected name, the adapter SHALL keep that proxy unavailable and report a diagnostic identifying the portable name and violated constraint rather than registering a truncated, hashed, or ambiguous name. Unrelated valid portable tools SHALL remain projectable.

#### Scenario: Portable name exceeds the OMP projection budget
- **ID**: `omp.tool-name.excessive-length-rejected`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::accepts 64-character proxies while isolating overlong and colliding descriptors`
- **WHEN** prefixing and separator replacement would produce a 65-character OMP proxy name
- **THEN** that proxy is not registered and the diagnostic identifies the portable name and 64-character limit

#### Scenario: Portable name exactly fits the OMP projection budget
- **ID**: `omp.tool-name.maximum-length-accepted`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::accepts 64-character proxies while isolating overlong and colliding descriptors`
- **WHEN** prefixing and separator replacement produces a 64-character OMP proxy name
- **THEN** the adapter registers and invokes that proxy without truncation or hashing

#### Scenario: Two descriptors map to one proxy name
- **ID**: `omp.tool-name.collision-rejected`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::accepts 64-character proxies while isolating overlong and colliding descriptors`
- **WHEN** malformed runtime input bypasses the portable-name grammar and two descriptors would map to the same OMP proxy
- **THEN** the ambiguous proxy is unavailable, the diagnostic identifies both portable names, and unrelated valid tools remain projected

### Requirement: Tool proxies preserve results and errors
A proxy SHALL invoke the qualified runtime tool and return its serializable success value or structured domain error to OMP. Transport failure SHALL disable the broken runtime session without misreporting it as a domain error.

#### Scenario: Runtime tool rejects input semantically
- **ID**: `tool.error.structured`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns serializable structured domain and execution errors`
- **EVIDENCE**: `packages/host-omp/tests/protocol.spec.ts::round-trips requests and notifications while keeping remote errors structured`
- **WHEN** the proxied tool returns a structured error
- **THEN** OMP receives that code and message as an errored tool result while the runtime remains active

#### Scenario: RPC fails during invocation
- **ID**: `tool.rpc.failure.deactivation`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics`
- **WHEN** the child connection fails while invoking a tool
- **THEN** OMP receives a transport failure result and remaining Doppelganger projections are deactivated

### Requirement: OMP lifecycle mapping uses available authoritative hooks
The adapter SHALL map OMP session, turn, tool, and pre-compaction hooks to host-neutral lifecycle events using the authoritative payload for each event kind. Completed assistant content supplied by `turn_end` SHALL be forwarded through `turn-committed`, while completed tool results SHALL be forwarded only from `tool_execution_end` through correlated `tool-completed` events and SHALL NOT be duplicated from aggregate `turn_end` data.

#### Scenario: OMP turn ends
- **ID**: `lifecycle.turn.committed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** `turn_end` provides the completed assistant message and aggregate tool results
- **THEN** the normalized `turn-committed` event contains bounded principal input and assistant content with stable session and turn identities but no tool result payloads

#### Scenario: OMP tool ends
- **ID**: `lifecycle.tool.completed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** `tool_execution_end` provides a result and error flag
- **THEN** the normalized `tool-completed` event contains the actual bounded result and corresponding outcome correlated to the active session, turn, and call

#### Scenario: OMP begins compaction
- **ID**: `lifecycle.precompaction`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::publishes bounded pre-compaction lifecycle material`
- **WHEN** `session_before_compact` fires
- **THEN** the adapter publishes a bounded pre-compaction observation before allowing OMP compaction to continue

### Requirement: Stable turn and delivery identity
The adapter SHALL assign one stable turn identity before context resolution and reuse it for turn, tool, and commit events associated with that turn. Retried publication of an event SHALL reuse its deterministic delivery identity.

#### Scenario: Turn invokes multiple tools
- **ID**: `lifecycle.turn.call.identity`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** one OMP turn invokes several tools
- **THEN** all corresponding lifecycle events carry the same turn identity and distinct call identities

### Requirement: Dynamic tool projection is exact
Runtime tool notifications SHALL activate newly available proxies, refresh changed descriptors, and deactivate removed proxies while preserving non-Doppelganger OMP tools.

#### Scenario: Memory extension unloads
- **ID**: `tool.projection.memory.unload`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** runtime reload removes all memory tools
- **THEN** their OMP proxies become inactive and unrelated OMP tools remain active

### Requirement: Activation is discoverable but not implicit configuration mutation
When no configured activation resolves, the extension MAY expose an initialization action. Normal startup SHALL not create or rewrite project configuration without an explicit initialization invocation.

#### Scenario: No user or project configuration exists
- **ID**: `activation.unconfigured.initialization`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::initializes only without selection and writes a strict Runtime Preset manifest`
- **WHEN** an OMP session starts in an unconfigured project
- **THEN** no child process starts and ordinary OMP behavior remains available alongside an explicitly invoked initialization action

### Requirement: Shutdown is bounded and honest
OMP shutdown handling SHALL publish only lifecycle facts supported by the host, transfer runtime ownership to a detached bounded teardown without awaiting child disposal inside the host handler, request session disposal within a bounded deadline, and release the child process. A bare teardown hook SHALL not fabricate a successfully completed session.

#### Scenario: User exits after completed work
- **ID**: `shutdown.no.synthetic.outcome`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::bounds shutdown and reports forced completion honestly`
- **WHEN** prior committed-turn events were delivered and OMP emits shutdown without an outcome
- **THEN** the adapter disposes the runtime without inventing an additional successful session outcome

#### Scenario: Child does not stop promptly
- **ID**: `shutdown.deadline.detached.teardown`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::releases the OMP shutdown handler while bounded child disposal continues`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::bounds shutdown and reports forced completion honestly`
- **WHEN** graceful disposal exceeds the configured deadline
- **THEN** the host shutdown handler returns promptly while the detached teardown terminates the owned child process and reports the observed outcome

### Requirement: Private OMP plugin package is the local install unit
The workspace SHALL contain a private package named `@doppelganger/doppelganger-omp` at version `0.0.0`. Its package manifest SHALL declare one OMP extension entrypoint so OMP can discover and load Doppelganger through its normal plugin registry after linking the package, without a caller-supplied `-e` path.

#### Scenario: Developer links the workspace package
- **ID**: `omp.package.local-link`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::is discovered through real isolated OMP local plugin linking`
- **WHEN** a developer runs OMP's local plugin-link flow against `packages/omp`
- **THEN** OMP records `@doppelganger/doppelganger-omp` as an enabled plugin and loads its declared extension entrypoint on the next session

### Requirement: Installed OMP entrypoint is deployment-neutral
The OMP plugin entrypoint SHALL compose `@doppelganger/doppelganger-host-omp` without embedding a repository-relative Doppelganger home, repository-relative child path, actor identifier, Persona identifier, or named Runtime Preset. Home and Runtime Preset selection SHALL retain the standard runtime-owned precedence. An absent or blank `DOPPELGANGER_ACTOR_ID` SHALL produce an unbound session; a non-empty value SHALL supply the immutable host actor binding.

#### Scenario: Fresh local installation starts with standard defaults
- **ID**: `omp.package.neutral-fresh-home`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::activates shipped standard from a fresh home without authored package defaults`
- **WHEN** the linked plugin starts with a nonexistent Doppelganger home path and no actor environment value
- **THEN** it creates `config.yaml`, `runtime.cordis.patch.yml`, and `.runtime-presets/`, activates the shipped actor-neutral `standard` Runtime Preset with an unbound actor, and does not copy `.runtime-presets/standard`

#### Scenario: Actor binding is supplied externally
- **ID**: `omp.package.external-actor-binding`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::binds only a non-empty externally configured test actor`
- **WHEN** OMP starts with `DOPPELGANGER_ACTOR_ID=test-actor`
- **THEN** the plugin passes `test-actor` as the immutable OMP actor binding without storing it in the package, Runtime Preset, project manifest, or patch

### Requirement: OMP plugin package owns the standard deployment closure
The local OMP plugin package SHALL declare the complete package dependency closure needed to resolve and activate the shipped `standard` Runtime Preset from an installed plugin tree. The generic `host-omp` package SHALL remain free of Persona, memory, SQLite, embedding, vector, and named-preset dependencies.

#### Scenario: Standard resolves from the plugin dependency tree
- **ID**: `omp.package.standard-dependency-closure`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::contains the resolvable dependency closure for shipped standard and opt-in dynamic plugins`
- **WHEN** the OMP plugin package is inspected without relying on undeclared repository imports
- **THEN** every package referenced by `standard/runtime.cordis.yml` and every required runtime infrastructure peer resolves from the declared plugin dependency tree

#### Scenario: Host adapter boundaries remain neutral
- **ID**: `omp.package.host-boundary-neutrality`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::keeps product dependencies at the OMP package boundary`
- **WHEN** package boundaries are validated after adding the OMP plugin package
- **THEN** product-layer dependencies terminate at `@doppelganger/doppelganger-omp` and do not become dependencies of `@doppelganger/doppelganger-host-omp`

### Requirement: Child runtime location belongs to host package layout
The OMP extension package SHALL NOT supply a source-repository child path. `@doppelganger/doppelganger-host-omp` SHALL locate its private child runtime relative to its own installed module layout, and the package contents SHALL include that child entrypoint.

#### Scenario: Linked package starts its child runtime
- **ID**: `omp.package.installed-child-location`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::is discovered through real isolated OMP local plugin linking`
- **WHEN** the linked OMP plugin activates a selected Runtime Preset outside the repository bootstrap implementation
- **THEN** the adapter starts the child using the installed `host-omp` package location without any caller-provided `childPath`

### Requirement: Project-local bootstrap delegates to the OMP package
The repository's project-local `.omp/extensions/doppelganger.ts` SHALL contain no Doppelganger construction logic or development identity defaults. If retained for repository discovery, it SHALL only delegate to `@doppelganger/doppelganger-omp`; development home and actor values SHALL be supplied explicitly by the launch environment.

#### Scenario: Repository dogfoods the packaged entrypoint
- **ID**: `omp.package.project-bootstrap-delegation`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::uses the delegated repository extension with a generated test preset`
- **WHEN** OMP starts through the delegated repository extension with a generated temporary Runtime Preset and test actor
- **THEN** the generated preset activates through the same package entrypoint used by local plugin linking and the project extension contains no repository home, actor, child path, or local construction defaults

### Requirement: Local packaging does not imply public release
The new OMP plugin package SHALL remain `private: true` at version `0.0.0`. Verification SHALL cover local linking and package contents, but SHALL NOT publish, reserve a registry name, define independent release versioning, or claim marketplace compatibility.

#### Scenario: Package is prepared locally
- **ID**: `omp.package.private-release-boundary`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::remains private while exposing only local source package contents`
- **WHEN** repository package and OpenSpec checks run
- **THEN** the OMP package is usable through local linking while public release remains a separate explicit change

### Requirement: OMP enforces required portable-tool approval natively
For every projected runtime tool whose descriptor declares required approval, the OMP adapter SHALL register a native tool approval decision that forces `prompt` for the exact call even in permissive or `yolo` mode. The prompt SHALL identify the portable tool, include its declared reason, and render bounded exact invocation arguments. The adapter SHALL remain generic and SHALL NOT import or special-case Persona Authoring.

#### Scenario: Required tool is called in yolo mode
- **ID**: `omp.approval.yolo-prompts`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** OMP runs in `yolo` mode and the model calls a projected runtime tool with required approval
- **THEN** OMP still presents one native approval prompt and does not send `tools.invoke` before an explicit grant

#### Scenario: User approves the call
- **ID**: `omp.approval.one-shot-grant`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the user grants the native prompt for one exact projected invocation
- **THEN** the adapter invokes the current runtime descriptor once and returns its ordinary portable result

#### Scenario: User rejects or closes the prompt
- **ID**: `omp.approval.denied-fails-closed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the approval is rejected, cancelled, or unavailable
- **THEN** OMP returns its native denied outcome, does not invoke the child runtime handler, and keeps the runtime session usable

#### Scenario: Approval prompt renders arguments
- **ID**: `omp.approval.arguments-bounded`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a required projected tool receives structured arguments
- **THEN** the native prompt shows a bounded deterministic representation of those exact arguments together with the portable approval reason

### Requirement: OMP approval projection follows exact tool replacement
Required approval metadata SHALL participate in the same candidate validation and exact dynamic replacement as name, description, schema, and availability. A committed reload SHALL replace the native approval declaration; an invalid reload SHALL retain the prior declaration; and a stale proxy SHALL resolve the current committed descriptor before invocation.

#### Scenario: Reload makes an existing tool approval-required
- **ID**: `omp.approval.reload-required`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a valid runtime reload changes an existing portable descriptor from host-default approval to required approval
- **THEN** the next call prompts before transport invocation without restarting the OMP session

#### Scenario: Invalid reload changes approval metadata
- **ID**: `omp.approval.invalid-reload-retains`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a candidate reload contains malformed approval metadata or otherwise fails activation/projection
- **THEN** the previous projected tool and approval behavior remain active while diagnostics report the candidate failure

#### Scenario: Retained stale proxy is called after removal
- **ID**: `omp.approval.stale-proxy-removed`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a caller retains a proxy closure after the runtime removed the portable tool
- **THEN** the closure returns runtime-unavailable without prompting or invoking the removed handler

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
