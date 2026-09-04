## ADDED Requirements

### Requirement: OMP declares its Runtime Host capability profile
The OMP adapter SHALL install the shared Runtime Host plugin with an immutable closed capability profile matching its implemented semantics. OMP SHALL advertise per-turn context, dynamic tool replacement, native required approval, cooperative tool cancellation, and only the standard lifecycle events it can publish faithfully. Its local and transported decoders SHALL reject unknown capability keys and host-native feature names.

#### Scenario: Runtime Session inspects OMP capabilities
- **ID**: `host.omp.runtime-session-inspects-omp-capabilities`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** an OMP Runtime Session activates successfully
- **THEN** plugins observe the shared versioned capability service rather than an OMP-named bridge service or raw extension context

#### Scenario: OMP cannot prove terminal session completion
- **ID**: `host.omp.omp-cannot-prove-terminal-session-completion`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** OMP exposes only resumable settle or shutdown hooks for a session
- **THEN** the capability profile and publication omit terminal completion semantics that OMP cannot prove

#### Scenario: OMP activation carries an unknown capability
- **ID**: `host.omp.omp-activation-carries-an-unknown-capability`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** the parent or child receives a profile containing an undeclared key or arbitrary feature string
- **THEN** activation fails diagnostically before the bridge attaches

### Requirement: OMP forwards native invocation cancellation
The OMP adapter SHALL mint one stable call ID for each projected runtime invocation and SHALL translate the native execution `AbortSignal` into an explicit child cancellation request for that call. The child SHALL route cancellation through the shared bridge and SHALL keep unrelated requests and the framed transport usable.

#### Scenario: User aborts a running portable tool
- **ID**: `host.omp.user-aborts-a-running-portable-tool`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** OMP aborts the native projected tool execution while the child invocation is active
- **THEN** the adapter sends one correlated cancellation request, the portable handler signal aborts, and the resulting native outcome is cancelled or the handler's actual earlier settlement

#### Scenario: Cancellation races with completion
- **ID**: `host.omp.cancellation-races-with-completion`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** the portable handler settles before the child processes cancellation
- **THEN** cancellation is an idempotent no-op and does not alter another call or close the session transport

### Requirement: OMP host-specific providers use protected typed plugins
OMP MAY add typed OMP-namespaced Cordis services or events beside the shared bridge for native hooks with no proven common semantic equivalent. Such providers SHALL be session-isolated, dispose with the active binding, and reuse the existing OMP extension, per-session child, framed RPC peer, request router, and shutdown path. They SHALL NOT expose the raw OMP `ExtensionContext`, native registries, or unrestricted hook subscription API and SHALL NOT create another host RPC connection, socket, child, sidecar, or session-binding path.

#### Scenario: OMP-bound preset consumes a native hook
- **ID**: `host.omp.omp-bound-preset-consumes-a-native-hook`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** a Runtime Preset explicitly requires a supported OMP-specific provider
- **THEN** the OMP adapter supplies it as a protected sibling plugin and stale callbacks cannot publish after session rebinding

#### Scenario: OMP-specific provider crosses the child boundary
- **ID**: `host.omp.omp-specific-provider-crosses-the-child-boundary`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates the shipped standard Runtime Preset from an empty home`
- **WHEN** the provider must receive a native OMP hook inside the Runtime Session
- **THEN** `host-omp` adds a validated message to its existing framed protocol and retains sole routing and process ownership

#### Scenario: Provider attempts a private host channel
- **ID**: `host.omp.provider-attempts-a-private-host-channel`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** an OMP-specific provider proposes its own child, socket, or RPC connection to OMP
- **THEN** the integration is rejected in favor of the existing adapter transport

### Requirement: OMP passes shared Runtime Host conformance
The OMP adapter SHALL pass the transport-independent Runtime Host conformance suite without exceptions for its child-process topology, including two-session isolation, closed capabilities, catalog replacement, stale calls, approval replay, cancellation races, lifecycle rejection, all three Actor Identity states, disposal, and late callbacks.

#### Scenario: OMP implementation changes its framed transport
- **ID**: `host.omp.omp-implementation-changes-its-framed-transport`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** an internal OMP transport or projection change is made
- **THEN** the same shared conformance suite continues to prove the externally visible Runtime Host semantics

## MODIFIED Requirements

### Requirement: Runtime tool projection
The adapter SHALL project the current immutable shared Runtime Host tool snapshot into OMP and proxy correlated invocations, cancellation, approval grants, and results over the session connection without requiring Persona, memory, or MCP extensions. Projection SHALL commit an exact candidate snapshot atomically, retain descriptor revisions in native closures, ignore stale `toolCatalogChanged` callbacks whose catalog revision precedes the active projection, and treat JSON Schema defaults as validation annotations rather than host-side value factories.

#### Scenario: Runtime tool is added or updated
- **ID**: `host.omp.runtime-tool-is-added-or-updated`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** a committed catalog revision adds a tool or changes its descriptor revision
- **THEN** the OMP session atomically exposes the new active definition without restarting and every new closure retains its exact canonical name and tool revision

#### Scenario: Runtime tool declares a mutable default
- **ID**: `host.omp.runtime-tool-declares-a-mutable-default`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::treats mutable JSON Schema defaults as annotations without materializing shared values`
- **WHEN** a projected tool schema declares an omitted array or object property with a mutable default
- **THEN** OMP projects the schema without materializing or sharing that default and forwards only caller-supplied arguments

#### Scenario: Runtime tool is removed
- **ID**: `host.omp.runtime-tool-is-removed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** a committed catalog revision removes a previously exposed tool
- **THEN** the adapter deactivates that native proxy for the remainder of the OMP session and retained closures fail unavailable or stale without dispatch

#### Scenario: Delayed old catalog callback arrives
- **ID**: `host.omp.delayed-old-catalog-callback-arrives`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::commits only the exact catalog revision named by the callback`
- **WHEN** the adapter has already projected catalog revision B and later receives `toolCatalogChanged` for revision A
- **THEN** it keeps revision B and does not restore removed or replaced native tools

### Requirement: OMP adapter is composition-neutral
The generic OMP adapter SHALL accept and validate its own serialized OMP activation request, reuse Composition Runtime canonicalization for the contained fully resolved composition, and SHALL NOT select a named Runtime Preset, require Persona metadata, or import a specific Runtime Preset. OMP-only host-kind, watch, transport, capability, and optional actor-provider configuration SHALL remain owned by `host-omp`; actor identity SHALL be mounted as a separate protected plugin rather than entering the shared bridge.

#### Scenario: Actor-aware Persona composition is activated
- **ID**: `host.omp.actor-aware-persona-composition-is-activated`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** generic configuration selects an actor-aware Persona Runtime Preset for an OMP session
- **THEN** the adapter decodes the OMP request, independently supplies the shared bridge and actor plugin, and starts the canonical composition without containing named-preset or Persona-specific selection logic

#### Scenario: Non-persona composition is activated
- **ID**: `host.omp.non-persona-composition-is-activated`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** configuration resolves another valid Runtime Preset with no Persona or memory extensions
- **THEN** the same OMP adapter activates it through the shared bridge and canonical Composition Runtime contract

#### Scenario: Another host consumes Composition Runtime
- **ID**: `host.omp.another-host-consumes-composition-runtime`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** DSH activates the same canonical composition in process
- **THEN** it does not import or satisfy the OMP serialized activation schema

### Requirement: OMP supplies actor identity outside Runtime Presets
The OMP extension SHALL accept an optional non-empty `actorId` host option, validate it before child activation, transport it across the versioned parent/child activation boundary, and always provide Actor Identity through a separate protected actor plugin: `bound` when the identifier is resolved and explicit `unbound` otherwise. The shared Runtime Host bridge, capability profile, requests, and tool-catalog callback SHALL contain no `actorId`. Runtime Preset files, Persona configuration, project manifests, patches, context, and tools SHALL NOT select or override that identifier.

#### Scenario: Local OMP actor is configured
- **ID**: `host.omp.local-omp-actor-is-configured`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** an OMP session activates a Runtime Preset with a valid configured `actorId`
- **THEN** the child mounts a separate actor provider exposing that exact immutable binding to actor-aware extensions for the lifetime of the Runtime Session

#### Scenario: OMP actor identifier is invalid
- **ID**: `host.omp.omp-actor-identifier-is-invalid`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the OMP extension receives an empty or non-string actor identifier
- **THEN** activation fails visibly before a child Runtime Session becomes active and ordinary OMP behavior remains usable

#### Scenario: OMP has no actor configuration
- **ID**: `host.omp.omp-has-no-actor-configuration`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** OMP activates an actor-independent Runtime Preset without `actorId`
- **THEN** the generic runtime remains usable, the separate OMP actor provider exposes explicit `unbound` rather than an absent service, and the shared bridge remains unchanged

### Requirement: OMP proxy invocation uses canonical descriptor identity
The adapter SHALL retain the exact dotted portable name and opaque tool revision with each committed projected descriptor and SHALL invoke the shared bridge with both values plus stable call and turn identities. Dispatch, approval lookup, replacement, cancellation, and stale-proxy checks SHALL use the committed proxy-to-descriptor association and SHALL NOT decode or reconstruct portable identity from the OMP proxy string.

#### Scenario: Readable proxy invokes dotted portable tool
- **ID**: `host.omp.readable-proxy-invokes-dotted-portable-tool`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** OMP calls `doppelganger_memory_candidates_list`
- **THEN** the child receives one invocation request whose name is exactly `memory.candidates.list` and whose tool revision is the one projected into that native closure

#### Scenario: Descriptor is replaced under the same portable name
- **ID**: `host.omp.descriptor-is-replaced-under-the-same-portable-name`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** reload replaces the descriptor for `persona.revise` while retaining its portable name
- **THEN** the retained old closure fails `TOOL_REVISION_STALE` and a newly projected closure uses the replacement descriptor and approval metadata

#### Scenario: Removed proxy closure is invoked
- **ID**: `host.omp.removed-proxy-closure-is-invoked`
- **EVIDENCE**: `packages/omp/tests/plugin-package.spec.ts::contains the resolvable dependency closure for shipped standard and opt-in Loader plugins`
- **WHEN** a caller retains an old `doppelganger_persona_revise` closure after `persona.revise` is removed
- **THEN** the closure returns `RUNTIME_UNAVAILABLE` or `TOOL_REVISION_STALE` and does not invoke another portable tool

### Requirement: OMP enforces required portable-tool approval natively
For every projected descriptor declaring required approval, the OMP adapter SHALL register a native decision that forces `prompt` for the exact call even in permissive or `yolo` mode. The prompt SHALL identify the portable tool and render bounded exact invocation arguments. When the descriptor supplies an advisory reason, OMP SHALL preserve it in native approval metadata; absence of a reason SHALL NOT weaken or disable required approval. After explicit approval, the trusted adapter SHALL create one protected grant bound to the call ID, descriptor revision, and canonical input digest; the child bridge SHALL revalidate and consume it before handler dispatch. The adapter SHALL remain generic and SHALL NOT import or special-case Persona Authoring or MCP.

#### Scenario: Required tool is called in yolo mode
- **ID**: `host.omp.required-tool-is-called-in-yolo-mode`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** OMP runs in `yolo` mode and the model calls a projected runtime tool with required approval
- **THEN** OMP presents one native prompt and sends no invocation or grant before an explicit decision

#### Scenario: User approves the call
- **ID**: `host.omp.user-approves-the-call`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** the user grants the native prompt for one exact projected invocation
- **THEN** the adapter sends the exact one-shot grant, the child revalidates it, and the current handler may run once

#### Scenario: User rejects or closes the prompt
- **ID**: `host.omp.user-rejects-or-closes-the-prompt`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** approval is rejected, cancelled, or unavailable
- **THEN** OMP returns its native denied outcome, sends no usable grant, does not invoke the child handler, and keeps the Runtime Session usable

#### Scenario: Approval prompt renders arguments
- **ID**: `host.omp.approval-prompt-renders-arguments`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a required projected tool receives structured arguments
- **THEN** the native prompt shows a bounded deterministic representation of the exact arguments used to compute the grant digest and includes the portable approval reason only when one was declared

#### Scenario: Grant is replayed or input changes
- **ID**: `host.omp.grant-is-replayed-or-input-changes`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation with the closed OMP capability profile`
- **WHEN** a grant is reused or the transported call ID, tool revision, or input digest differs from the approved values
- **THEN** the child bridge fails closed before the handler or an imported MCP server is invoked

### Requirement: OMP approval projection follows exact tool replacement
Required approval metadata and tool revision SHALL participate in the same candidate validation and exact dynamic replacement as name, description, schema, and availability. A committed catalog update SHALL replace the native approval declaration and closure revision atomically; an invalid runtime reload or projection candidate SHALL retain the prior declaration; and a stale proxy SHALL never resolve itself to the current descriptor before invocation.

#### Scenario: Reload makes an existing tool approval-required
- **ID**: `host.omp.reload-makes-an-existing-tool-approval-required`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a valid runtime reload changes an existing portable descriptor from host-default approval to required approval
- **THEN** a newly projected closure prompts before invocation while any retained old closure fails stale

#### Scenario: Invalid reload changes approval metadata
- **ID**: `host.omp.invalid-reload-changes-approval-metadata`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a candidate reload contains malformed approval metadata or otherwise fails activation or projection
- **THEN** the previous projected tool, revision, and approval behavior remain active while diagnostics report the candidate failure

#### Scenario: Retained stale proxy is called after removal
- **ID**: `host.omp.retained-stale-proxy-is-called-after-removal`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::discards stale context notifications lifecycle callbacks and proxy closures after replacement`
- **WHEN** a caller retains a proxy closure after the runtime removed the portable tool
- **THEN** the closure returns runtime-unavailable or stale without prompting, granting, or invoking the removed handler
