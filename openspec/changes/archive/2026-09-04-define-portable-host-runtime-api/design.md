## Context

Doppelganger already has three relevant layers:

1. `runtime-presets` discovers and selects complete Loader trees;
2. `composition-runtime` activates one isolated Runtime Session, applies protected runtime-owned plugins after authored layers, audits reload, and owns disposal;
3. `extension-protocols` provides independent optional actor identity plus request-time context, tools, required approval metadata, and normalized lifecycle events inside that session.

OMP adds a fourth layer in `host-omp`: a native adapter, framed RPC transport, and OMP-named runtime-side bridge. The active DSH change needs approximately the same bridge in-process. Research across Codex, Claude Code, OpenCode, OpenClaw, Hermes Agent, DSH, Gemini CLI, Goose, Pi, and OMP shows a stable semantic intersection but no shared native plugin ABI. Some hosts support per-model-request context and exact dynamic tools; others expose only session-start text, restart-bound MCP tools, or partial lifecycle hooks.

The design therefore defines a common semantic API without pretending all hosts have identical fidelity. Cordis services remain the plugin capability system. The host API describes the adapter's supported delivery guarantees, while concrete host-only functionality remains separately typed and namespaced.

## Goals / Non-Goals

**Goals:**

- Give every host adapter one shared, transport-independent API for a single Runtime Session.
- Preserve the existing roster and Composition Runtime APIs instead of creating a monolithic host SDK.
- Make context, tools, approval, cancellation, and lifecycle fidelity explicit and inspectable by Runtime Preset plugins.
- Make dynamic tool projection revision-safe across direct calls, child RPC, and stateless host transports.
- Centralize validation and fail-closed enforcement that must not drift between adapters.
- Let a host add explicit native hooks or services to the same Runtime Session without widening the portable API.
- Support a generic MCP client plugin whose server configuration moves with a Runtime Preset and whose discovered tools are ordinary portable tools.
- Migrate OMP cleanly and provide the contract consumed by the active DSH implementation plan.

**Non-Goals:**

- A union of every native host API or a raw host event bus.
- Identical behavior on hosts that do not expose equivalent request, approval, reload, or commit boundaries.
- Portable commands, Agent Skills, agents, subagents, delegation, provider registration, UI, session navigation, or marketplaces.
- Automatic MCP prompt, resource, sampling, elicitation, root, or metadata projection.
- Making MCP the Runtime Host transport for hosts with stronger native integration.
- A generic sidecar supervisor before a second sidecar host proves a reusable transport boundary.
- Replacing Cordis injection, effects, isolation, Loader, or Composition Runtime lifecycle.

## Decisions

### 1. The common API is a set of layers, not one host facade

A host integration composes existing public layers:

```text
Runtime Preset roster
        |
Composition Runtime activation
        |
protected Runtime Host plugin + optional host-specific plugins
        |
portable Cordis services inside one Runtime Session
```

The change adds the missing shared Runtime Host bridge to `extension-protocols`. It does not add a facade that reimplements roster selection, activation, reload, diagnostics, or disposal. OMP continues to use a child transport; DSH uses the same bridge directly under its agent Cordis context; future adapters choose their own native or transported integration.

Composition Runtime also stops owning the OMP-discriminated serialized activation request. `host-omp` owns its `hostKind`, actor, watch, and transport decoding while reusing exported generic composition canonicalization. DSH uses direct activation and does not satisfy an OMP transport schema. This removes the last concrete host field from the domain-neutral kernel without duplicating path or patch validation.

Alternative: expose one `DoppelgangerHostSdk` that discovers presets, starts runtimes, projects tools, and translates hooks. Rejected because selection, process ownership, native projection, and trust differ materially by host and already have separate owners.

### 2. One bridge instance belongs to exactly one Runtime Session

The shared contract is conceptually:

```ts
interface RuntimeHostBridge {
  readonly capabilities: RuntimeHostCapabilities
  resolveContext(request: HostContextRequest): Promise<AssembledContext>
  snapshotTools(): ToolCatalogSnapshot
  invokeTool(request: ToolInvocationRequest): Promise<ToolInvocationResult>
  cancelTool(request: ToolCancellationRequest): Promise<ToolCancellationResult>
  publishLifecycle(event: LifecycleEvent): Promise<void>
}

interface RuntimeHostBinding {
  attach(bridge: RuntimeHostBridge): void
  detach(bridge: RuntimeHostBridge): void
  toolCatalogChanged(revision: string): void
}
```

`createRuntimeHostPlugin(binding, capabilities)` installs only validated host capabilities, resolves optional context/tool services from the owning isolated realm, attaches one frozen bridge, calls `toolCatalogChanged(revision)` after a committed catalog mutation, and detaches through a Cordis effect. It has no actor identity, host kind, native session object, transport, UI, projection logic, or generic notification envelope.

Actor identity is deliberately outside this bridge and its capability profile. Its three observable states are: no `doppelgangerActor` service means the host does not support or did not install Actor Identity; `{ state: 'unbound' }` means the independent provider is installed but has no resolved user; `{ state: 'bound', actorId }` means it has one immutable resolved user. Persona activation neither owns nor derives that binding. A host that implements Actor Identity mounts `createActorIdentityPlugin(actorId)` separately in bound or unbound form; OMP preserves this behavior, while actor-independent hosts and Runtime Presets may omit the provider entirely.

`RuntimeHostBinding` remains adapter-owned. A direct adapter binds the bridge and `toolCatalogChanged` callback in memory. A transported adapter serializes bridge requests and that one explicit callback over its existing connection. Attachment is single-owner: a second attachment before exact detach is an activation error.

Alternative: one process-global bridge routing by `sessionId`. Rejected because it creates ambient mutable routing, complicates disposal, and permits one host session to address another session's services.

### 3. Host fidelity is an immutable semantic capability profile

The bridge exposes a frozen, versioned profile and provides it inside Cordis as `doppelgangerHostCapabilities`:

```ts
type ContextDelivery = 'none' | 'session-start' | 'per-turn' | 'per-request'
type ToolDelivery = 'none' | 'session-start' | 'dynamic'
type LifecycleEventType = LifecycleEvent['type']

interface RuntimeHostCapabilities {
  readonly protocolVersion: 2
  readonly context: {
    readonly delivery: ContextDelivery
  }
  readonly tools: {
    readonly delivery: ToolDelivery
    readonly requiredApproval: boolean
    readonly cancellation: boolean
  }
  readonly lifecycle: {
    readonly events: readonly LifecycleEventType[]
  }
}
```

The profile is a closed validated object: all listed fields are required, unknown keys are rejected at construction and transport boundaries, lifecycle values must be unique members of the standard event union, and adding another common dimension requires a protocol-version change plus the promotion gate below. There is no `features`, `extensions`, or arbitrary string capability field.

The profile describes semantic guarantees, not native feature names:

- `per-turn` means context is resolved once for each direct user turn and reused for model continuations within that turn;
- `per-request` means context can be freshly resolved before every model request;
- `dynamic` means committed catalog changes can replace active host tools during the session;
- `session-start` tool delivery means later changes require a host reconnect or new session;
- lifecycle lists only event kinds the adapter can faithfully publish;
- required approval is true only when the adapter can obtain one explicit grant for the exact call;
- cancellation is true only when an active native call can signal the portable invocation.

A plugin that requires a guarantee injects this service and fails activation or explicitly disables that behavior when absent. Portable plugins do not branch on host names. Host-specific capabilities are not added as arbitrary strings to this profile; they use typed services or events.

Alternative: infer capabilities from whether `doppelgangerContext` or `doppelgangerTools` exists. Rejected because service presence does not state delivery timing, dynamic replacement, approval, cancellation, or lifecycle completeness.

Alternative: expose a generic string capability bag including native hook names. Rejected because it becomes an untyped host API mirror and cannot define payload ownership or lifecycle.

### 4. Context resolution gains request correlation but retains current assembly

`HostContextRequest` uses the existing `ContextResolveRequest` semantics and adds a required adapter-minted `requestId` for one model request:

```ts
interface HostContextRequest {
  readonly requestId: string
  readonly turn: {
    readonly input: string
    readonly turnId?: string
  }
  readonly tokenBudget: number
}
```

The result remains `AssembledContext`: accepted contributions, omitted sources, token count, and flattened content. A rich host such as DSH may project accepted contributions individually to preserve authority; OMP may use the flattened content. The shared bridge does not edit native messages or prompts.

A host with `context.delivery === 'session-start'` may resolve once using a stable synthetic request ID. A host with `per-turn` resolves once for each direct user turn and must reuse that snapshot for continuations within the turn; provider changes become visible at the next turn. A host with `per-request` may resolve again before every model request. A host with `none` receives the frozen empty result.

Alternative: transport raw native prompt/message objects. Rejected because message types, authority, persistence, and model-provider envelopes differ by host.

### 5. Tool registration supports atomic owned-set replacement

Dynamic MCP servers and runtime reload need a transaction rather than a sequence of visible single-tool mutations. `ToolRegistry` gains an owned-set registration:

```ts
interface ToolSetRegistration {
  replace(definitions: readonly ToolDefinition[]): void
  dispose(): void
}

registerSet(ownerId: string, definitions: readonly ToolDefinition[]): ToolSetRegistration
```

A set replacement validates the complete candidate, rejects duplicate names and collisions with other owners, commits all additions/updates/removals atomically, increments one catalog revision, and emits one `doppelganger/tools-changed`. Existing single-tool registration becomes a convenience over an owned set and every existing caller migrates to the canonical implementation.

Each immutable `ToolDescriptor` receives an opaque `revision` that changes only when that tool's callable definition, schema, availability, or approval metadata changes. `ToolRegistry.snapshot()` returns:

```ts
interface ToolCatalogSnapshot {
  readonly revision: string
  readonly tools: readonly ToolDescriptor[]
}
```

The catalog revision changes on every committed set mutation; unchanged tools may retain their descriptor revision. Ordering remains deterministic by canonical tool name.

Alternative: let MCP import unregister and register tools sequentially. Rejected because hosts could observe partial catalogs, duplicate notifications, or a removed old set when candidate validation later fails.

### 6. Tool invocation is correlated, revision-checked, cancellable, and approval-safe

The adapter invokes the descriptor it projected, not merely a current name:

```ts
interface ToolInvocationRequest {
  readonly callId: string
  readonly turnId?: string
  readonly name: string
  readonly toolRevision: string
  readonly input: JsonValue
  readonly approval?: ToolApprovalGrant
}

interface ToolApprovalGrant {
  readonly kind: 'one-shot'
  readonly grantId: string
  readonly callId: string
  readonly toolRevision: string
  readonly inputDigest: string
}

interface ToolInvocationContext {
  readonly sessionId: string
  readonly callId: string
  readonly turnId?: string
  readonly signal: AbortSignal
}

interface ToolDefinition {
  // existing fields
  invoke(input: JsonValue, context: ToolInvocationContext): JsonValue | Promise<JsonValue>
}
```

The bridge validates non-empty identities, resolves the current descriptor, requires an exact `toolRevision`, clones and canonically hashes the input, and checks approval before calling the handler. A stale descriptor fails with `TOOL_REVISION_STALE`; it never dispatches the current same-name handler.

For `approval.policy === 'required'`, the bridge requires a one-shot grant whose call ID, tool revision, and input digest match the invocation. Grant IDs are consumed within the Runtime Session and cannot authorize a second call. The host owns native policy and presentation and may deny more calls; the bridge owns the final portable fail-closed check. Unexpected grants for tools without a portable requirement are rejected rather than treated as authority.

The bridge creates one `AbortController` per active invocation. `cancelTool({ callId, reason? })` aborts the matching signal and is idempotent. Cancellation is cooperative: a handler that observes abort returns or throws normally; a handler that ignores it may still settle. The bridge removes active-call state after settlement and maps an observed abort failure to structured `TOOL_CANCELLED` without fabricating cancellation when the handler completed successfully.

A direct host may translate its native signal into `cancelTool`. A transported host sends an explicit cancellation message. A host that advertises no cancellation never calls it, but every handler still receives a valid never-aborted signal.

Alternative: pass native approval callbacks or native `AbortSignal` objects through the portable descriptor. Rejected because they are not JSON-compatible and let feature plugins depend on host execution objects.

Alternative: keep `invoke(name, input)`. Rejected because it cannot distinguish retained stale closures, correlate cancellation, or bind approval to the exact projected definition and arguments.

### 7. Standard lifecycle stays closed and availability is explicit

The existing versioned event union remains the only shared lifecycle vocabulary. `publishLifecycle` validates that the event kind was advertised in `capabilities.lifecycle.events`, then applies existing normalization, bounds, deep freezing, subscriber containment, and deterministic delivery IDs.

Hosts omit unsupported events. Similar names are insufficient for normalization: an OMP event and a Claude hook become the same portable event only when ownership, timing, correlation, commit, failure, and disposal semantics match.

No generic `publishHostEvent(name, payload)` is added.

Alternative: add every discovered host hook to one lifecycle union. Rejected because it would make portable consumers depend on accidental host vocabulary and would imply false equivalence.

### 8. Host-specific extension points use protected typed Cordis plugins

A host adapter may pass additional runtime-owned plugins through the existing `runtimePlugins` and `runtimePluginIsolation` activation fields. The shared bridge is one protected plugin; host-specific providers are siblings inserted after authored layers.

Conventions:

- the provider lives in the host package or a separately named host extension package;
- services are explicitly typed and host-namespaced, and events use `doppelganger/host/<host>/...`;
- values crossing a child or process boundary are validated, bounded, and JSON-compatible;
- communication with the native host reuses the one adapter-owned in-process binding or existing transport, routing, and process lifecycle;
- a host-specific provider SHALL NOT create a second host RPC connection, socket, sidecar, request router, or independent session-binding path;
- registration and native subscription cleanup are Cordis effects owned by the Runtime Session;
- a Runtime Preset consumer declares required or optional injection normally;
- a preset requiring the service is intentionally host-bound and fails visibly on another host;
- the provider never exposes a raw native runtime, registry, UI, session object, credential store, or unrestricted event bus.

For example, an OMP-only native `todo_completed` hook may become a typed `doppelganger/host/omp/todo-completed` event. It is not added to the standard lifecycle union. The OMP adapter may subscribe eagerly and publish only while the owning binding is current, or use a native dynamic subscription if OMP supports one; that implementation detail stays in `host-omp`.

For OMP, both shared and OMP-specific runtime providers use the existing per-session child and framed RPC owned by `host-omp`. For DSH they use the existing in-process Cordis hierarchy. This one-host-transport rule does not prohibit an ordinary Runtime Preset plugin such as `extension-mcp` from owning connections to its external service; those are plugin dependencies, not parallel channels into the native agent host.

Alternative: a portable plugin asks for native hook names at runtime. Rejected because payload schemas, registration timing, trust, and disposal are host-specific.

### 9. `extension-mcp` is a Runtime Preset MCP client and tool importer

The new package is an ordinary Loader plugin configured inside the preset:

```yaml
- id: mcp
  plugin: "@doppelganger/doppelganger-extension-mcp"
  inject:
    required:
      - doppelgangerTools
  config:
    servers:
      filesystem:
        transport:
          type: stdio
          command: filesystem-mcp
          args: ["/workspace"]
```

Each server ID is lowercase kebab-case and is the stable configuration identity; MCP `serverInfo.name` is informational and is not used for disambiguation. The first implementation supports current stdio and stateless Streamable HTTP transports. The plugin does not write native OMP, Claude, Gemini, or other host MCP configuration.

For every active server generation the plugin:

1. starts or connects and negotiates capabilities;
2. calls `tools/list`, following protocol pagination when present;
3. creates a complete candidate owned tool set;
4. commits it atomically through `doppelgangerTools.registerSet`;
5. refreshes the set after `notifications/tools/list_changed`;
6. maps portable invocation to exact MCP `tools/call` with the original case-sensitive name;
7. forwards `ToolInvocationContext.signal` to the MCP client request;
8. disposes registrations, subscriptions, transport, and owned process exhaustively.

Canonical imported names use `mcp-<server-id>.<local-id>`. The default local ID lowercases ASCII MCP names, maps `_` and `.` to `-`, collapses repeated separators, and validates the existing portable segment grammar. Because MCP names are case-sensitive and normalization may collide, configuration may map an exact original MCP name to an explicit lower-kebab alias. Invalid, colliding, or unrepresentable candidates are omitted with diagnostics; unrelated valid tools remain available. The invocation closure always retains the exact original MCP name and server generation.

MCP tool annotations are untrusted behavioral hints and do not create a portable approval grant or required-approval policy. Configuration may explicitly add a portable approval requirement or disable an imported tool. The MCP server never supplies host actor identity or native host authority.

Successful `complete` calls return structured MCP content as a JSON-compatible value, preserving `structuredContent` and supported content blocks. A missing `resultType` from an older negotiated protocol version is treated as `complete`; current `input_required` results become an explicit bounded `MCP_INPUT_REQUIRED` structured failure because this version does not advertise elicitation or implement the multi-round input protocol. MCP tool-originated `isError` results become structured domain errors with bounded data; protocol, transport, schema, stale-generation, and unavailable-server failures retain distinct codes. No protocol failure or unsupported result variant silently becomes an empty successful tool result.

The current HTTP request format is stateless, but Runtime Session ownership still governs stdio processes, client objects, subscriptions, active calls, registrations, and disposal. A valid Runtime Preset reload builds replacement server generations before withdrawing committed tools where the transport permits; failure retains the prior healthy generation. Session disposal cancels active requests and exhaustively closes every owned resource.

Alternative: expose one generic `mcp.call` tool. Rejected because the model loses concrete names, descriptions, and schemas, host approval cannot reason about individual tools, and tool discovery becomes a prompt convention.

Alternative: configure MCP separately in every host. Rejected because the same Runtime Preset would no longer carry its dependency/tool roster between agents.

### 10. Commands, skills, and agents stay outside the Runtime Host API

Commands duplicate portable Agent Skill workflows and are not projected. Agent Skills remain independently distributed, including Doppelganger-specific skills through `skills.sh`. Native agent/subagent definitions and execution remain host-owned; this change adds neither a portable agent registry nor a custom model loop.

A future feature may define a narrow delegation capability only after at least two hosts demonstrate matching task ownership, context/tool inheritance, streaming, cancellation, approval, lineage, persistence, and disposal semantics.

### 11. Common API promotion requires proof and conformance

Every host adapter must pass one transport-independent Runtime Host conformance suite before it is supported. The suite covers two-session isolation, empty context and tools, rejection of unknown capability fields, atomic catalog replacement, stale descriptor invocation, one-shot approval replay, cancellation/completion races, undeclared lifecycle events, actor-provider absence/unbound/bound independence, disposal during active work, and late callbacks after binding replacement.

A host-specific service or event may move into the common API only after at least two implemented adapters demonstrate equivalent:

- event or operation timing and commit boundary;
- operation owner and authority source;
- session, turn, request, call, and delivery correlation identities as applicable;
- success, failure, partial, cancellation, retry, and replay semantics;
- ordering, replacement, and stale-callback behavior;
- resource ownership, rollback, and disposal.

Matching names, approximately similar payloads, or a speculative second adapter are insufficient. Promotion changes the versioned shared contract, conformance fixtures, both proven adapters, owning documentation, and active OpenSpec requirements in one change. Until then the capability remains a typed host-specific Cordis plugin.

## Risks / Trade-offs

- **The common profile exposes partial hosts rather than hiding them.** Plugins may need explicit required-capability checks. This is preferable to silently stale context or missing lifecycle.
- **Tool invocation is a breaking contract.** Every tool registration, host projection, fixture, generated plugin wrapper, and active DSH design must migrate together. The benefit is one enforceable stale/approval/cancellation boundary.
- **Approval remains dependent on a trusted adapter.** The bridge prevents accidental dispatch without a matching grant but cannot protect against a malicious host adapter that fabricates grants or controls the runtime process.
- **Cancellation is cooperative.** Aborting a signal cannot force arbitrary plugin or MCP code to stop. Disposal must still bound and escalate owned subprocess cleanup.
- **MCP naming trades readability against protocol fidelity.** Default normalization is readable but not bijective; explicit aliases are required for collisions or unusual case-sensitive names.
- **MCP servers can be privileged.** Configuration may launch local code or contact remote services with user credentials. Runtime Preset trust, visible diagnostics, environment handling, and documentation must make that authority explicit.
- **MCP capability scope is deliberately narrow.** Users may expect prompts, resources, elicitation, and sampling. Importing them without separate authority models would be incorrect.
- **Host-specific services reduce preset portability by design.** The dependency is explicit and auditable; accidental fallback to a different host meaning is forbidden.
- **Cross-change drift remains possible.** The active DSH proposal, design, spec, and tasks now consume the finalized shared bridge, capability profile, actor separation, revisioned tools, cancellation, declared lifecycle, conformance suite, and typed host-extension rule; implementation must preserve that alignment rather than introducing a host-local variant.
