# Extension protocols

Protocol plugins provide a host-neutral integration language without expanding the runtime kernel. Values crossing protocol, YAML, RPC, tool, lifecycle, settings, or persistence seams are JSON-compatible and validated at the seam.

## Actor identity

Actor Identity is an optional protected plugin separate from the shared Runtime Host bridge. A compatible host may mount one frozen, session-isolated `doppelgangerActor` value: `{ state: 'bound', actorId }` or `{ state: 'unbound' }`; if it mounts no provider, the service is absent. The host validates and binds the identifier outside Runtime Presets, patches, Persona configuration, model context, tools, bridge requests, and the capability profile. Reload cannot change it; switching actors requires a new Runtime Session.

Generic compositions and the shared Runtime Host API may run without the service. Persistent actor-aware extensions must explicitly inject it and fail activation when it is absent or unbound rather than inventing an anonymous, default, Persona-authored, bridge-authored, or model-selected identity.

## Structured inference

`extension-protocols` defines the optional session-scoped `doppelgangerInference` service for one-shot structured extraction. A request has exact keys: a bounded lowercase purpose identifier, bounded system instruction, untrusted input string, portable JSON output schema, optional output-token cap, and optional `AbortSignal`. The wrapper validates schema depth, node count, serialized size, supported keywords, request bounds, provider result shape, JSON compatibility, output size, schema conformance, and bounded token usage; accepted requests and results are immutable.

Providers return only the schema-shaped JSON value and optional usage. Stable errors distinguish invalid requests, unavailable providers, authentication, timeout, cancellation, provider failure, missing output, and invalid output. Raw prompts, provider payloads, thinking, tool text, credentials, and provider diagnostics are not part of the result contract. A Runtime Preset may substitute any conforming provider by composing one `doppelgangerInference` implementation in the session realm; duplicate providers fail rather than winning by order. Omitting the service is valid.

`extension-inference-pi` is one optional Node-compatible provider. Its Loader row selects an installed Pi provider/model snapshot or explicitly constructs one OpenAI-compatible endpoint snapshot at activation, optionally resolves one named environment credential per call, requests exactly one schema-shaped `return_result` tool call with SDK retries disabled, and maps timeout, caller cancellation, disposal, authentication, and malformed output into the shared error contract. It neither executes returned tool calls nor uses the host's agent loop, model selection, credentials, conversation, or transport. Provider traffic and cost occur only when a consuming plugin explicitly enables and invokes inference.

## Context

Feature plugins register scoped context providers as Cordis effects. A host resolves providers at the cadence declared by its immutable capability profile. `per-turn` resolution uses the current direct principal input once before one user-initiated agent run; every model continuation after tool calls receives that same snapshot. `per-request` remains available only for hosts and features that intentionally require fresh assembly before every model request. The assembler orders contributions deterministically and applies the supplied token budget.

Each contribution declares `instruction` or `data` authority. Priority orders contributions but never promotes data into instructions. Provider disposal, mutation, or reload affects the next resolution boundary promised by the host. Host projection does not become retained conversation history or a stale fallback after empty or failed resolution.

## Tools

Feature plugins register transport-neutral, namespaced tools with JSON Schema input definitions. The registry exposes a revisioned catalog snapshot and revisioned descriptors without leaking host-native tool objects. Registration follows the owning plugin lifecycle. Catalog-change events carry only the new catalog revision; adapters fetch and validate the matching full snapshot before committing an exact replacement. A definition may declare immutable `approval: { policy: "required", reason? }`; the optional bounded non-empty reason is an advisory presentation hint, not authorization and not Persona- or host-specific policy.

A host adapter translates supported JSON Schema into its native schema and exactly replaces dynamic proxies when definitions change. Removed tools disappear; stale proxy closures and stale descriptor revisions cannot invoke replaced handlers. Each invocation carries stable call identity, the exact descriptor revision, JSON-compatible input, and optional turn identity. Required approval is a tool-owned minimum: one explicit native grant is bound to that call ID, tool revision, and canonical input digest, is consumed once, and cannot authorize another call or an unprotected tool. Cancellation is a separate call-correlated operation. Invocation and cancellation return structured transport-neutral results.

Dynamic Runtime Plugins consume the same protocol rather than adding a host-specific execution channel. Their seven `runtime-plugin.*` control tools are ordinary portable definitions, and generated Packages may register further tools only through the guarded `doppelgangerTools` service. `runtime-plugin.run` declares required approval because it evaluates one exact immutable Package with process-level authority; the grant binds the submitted Plugin ID, Package ID, mode, name, purpose, and source digest. Inspection and definition do not execute source. Host denial, cancellation, or unavailable approval fails before dispatch.

Evolution uses the same context and tool protocols without an executor channel. Its seven `evolution.*` definitions are ordinary portable ledger controls whose schemas stay within the supported cross-host translation subset. `evolution.transition` publishes one object schema and enforces the selected target's required and irrelevant metadata at invocation. Stable operation IDs and exact revision checks remain mandatory, and no input accepts actor or Persona override fields. Its context provider contributes one instruction-authority policy and at most one data-authority reminder candidate. Its optional lifecycle signal worker may consume committed events and may call same-realm structured inference only when explicitly configured; neither path expands tool authority. Proposal or reminder state grants no approval to Persona Authoring, research, Dynamic Runtime Plugins, package installation, or host APIs.

## Typed host-specific extensions

Host-native observations that lack proven cross-host semantics remain outside the generic lifecycle vocabulary. A host package may install a protected runtime-owned Cordis plugin that exposes an explicitly typed host-namespaced service or event, isolated to the owning Runtime Session and registered/disposed as a Cordis effect. Transported values are closed, bounded, JSON-compatible, and validated on both sides of the process boundary. A host-bound plugin declares the namespaced dependency explicitly and fails visibly on hosts that do not provide it; no approximate fallback is synthesized.

Host-specific providers reuse the adapter's one in-process binding or its existing transport, router, and process lifecycle. They do not receive a raw native runtime, unrestricted event bus, registry, UI, credential store, or authority channel, and they do not create a second host RPC connection, socket, sidecar, request router, or session-binding path. OMP therefore carries `todo-reminder` over the same per-session framed RPC connection as the shared Runtime Host bridge, validates that the event belongs to the active Runtime Session, and emits `doppelganger/host/omp/todo-reminder`. Other hosts neither implement nor advertise that event.

This one-host-transport rule does not apply to ordinary Runtime Preset plugins connecting to their own external dependencies. For example, `extension-mcp` owns its MCP server transports under the Runtime Session; those connections do not provide a parallel path into the native agent host.

## Lifecycle

Host adapters publish normalized, deeply frozen, bounded lifecycle events through `publishLifecycleEvent`. Lifecycle protocol version 2 gives each event kind one payload owner: `turn-committed` carries committed principal input, assistant output, and turn outcome, while each tool result or structured tool error appears only in its correlated `tool-completed` event. Stable `sessionId`, `turnId`, `callId`, and `deliveryId` values preserve correlation across transport, including for consumers that reconstruct a turn from separate events.

The lifecycle event version is independent of any host transport version. Candidate capture and Evolution signal discovery consume completed committed turns only. Partial, failed, or cancelled turns never become evidence; uncommitted tool-completion events are bounded correlation material and expire without persistence. Lifecycle publication never awaits Evolution extraction, inference, storage, or promotion.

## Host seam

A host integration installs at most one shared Runtime Host bridge per Runtime Session. A direct host binds it in-process; a transported host serializes its requests over one adapter-owned connection:

```text
native host adapter <-> existing binding or versioned transport <-> protected runtime-owned plugins
```

The bridge exposes one frozen actor-neutral capability profile containing only context delivery, tool delivery, required-approval support, cancellation support, and faithfully available standard lifecycle event kinds. Unknown fields, arbitrary feature strings, unsupported versions, and malformed transported values fail at the boundary. Actor Identity remains a separate optional protected plugin: service absence, explicit `unbound`, and immutable `bound` state are distinct.

The runtime-side bridge maps correlated context requests, immutable revisioned tool catalogs, exact-revision invocation, call-correlated cancellation, protected one-shot approval grants, and declared lifecycle publication to optional standard protocols. Its binding has one explicit runtime-to-host signal, `toolCatalogChanged(revision)`; another outbound condition requires its own typed contract rather than a generic notification envelope. A host may add typed host-specific sibling plugins only under the convention above. Portable feature plugins, Evolution workflows, generated Packages, and MCP servers do not receive the raw host runtime.

Every supported adapter passes the same transport-independent Runtime Host conformance suite. A host-specific operation or event enters the common API only after two implemented adapters prove equivalent timing and commit boundaries, authority, correlation identities, success/failure/cancellation/retry/replay behavior, ordering and stale-callback semantics, and rollback/disposal ownership.

## Primary implementation

- `packages/extension-protocols/src/actor-identity.ts`
- `packages/extension-protocols/src/host-capabilities.ts`
- `packages/extension-protocols/src/context.ts`
- `packages/extension-protocols/src/tools.ts`
- `packages/extension-protocols/src/lifecycle.ts`
- `packages/extension-protocols/src/inference.ts`
- `packages/extension-protocols/src/runtime-host.ts`
- `packages/extension-protocols/tests/support/runtime-host-conformance.ts`
- `packages/extension-inference-pi/src/plugin.ts`
- `packages/extension-inference-pi/src/provider.ts`
- `packages/host-omp/src/contracts.ts`
- `packages/host-omp/src/omp-host-events.ts`
