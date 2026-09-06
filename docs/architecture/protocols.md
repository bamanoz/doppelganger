# Protocols

Protocol plugins provide a host-neutral integration language without expanding the runtime kernel. Portable values crossing protocol, YAML, RPC, tool, lifecycle, settings, or persistence seams are admitted by the single descriptor-aware `cloneJsonValue` contract in `extension-protocols` before cloning, hashing, freezing, or transport. It rejects cycles, accessors, symbol or non-enumerable properties, unsupported prototypes, executable coercion such as custom `toJSON`, sparse arrays, non-finite numbers, and configured depth or byte overflow without running user code. `host-omp` owns only envelope, version, capability, and host-state validation and delegates portable value admission to this contract.

Host lifecycle observations are intentionally different: `serializeLifecycleValue` first produces a bounded, explicitly lossy projection (including truncation metadata), and only that projection enters strict lifecycle validation. This observation path must not be used for command, descriptor, invocation-input, or result admission.

## Actor identity

Actor Identity is an optional protocol service separate from the shared Runtime Host bridge. A compatible host may select the standard `actor` Host Extension to mount one frozen, session-isolated `doppelgangerActor` value: `{ state: 'bound', actorId }` or `{ state: 'unbound' }`; if it omits that selection, the service is absent. The host validates and binds the identifier outside Runtime Presets, patches, Persona configuration, model context, tools, bridge requests, and the capability profile. Reload cannot change it; switching actors requires a replacement Runtime Session and fresh protected composition.

Generic compositions and the shared Runtime Host API may run without the service. Persistent actor-aware extensions must explicitly inject it and fail activation when it is absent or unbound rather than inventing an anonymous, default, Persona-authored, bridge-authored, or model-selected identity.

## Structured inference

`extension-protocols` defines the optional session-scoped `doppelgangerInference` service for one-shot structured extraction. A request has exact keys: a bounded lowercase purpose identifier, bounded system instruction, untrusted input string, portable JSON output schema, optional output-token cap, and optional `AbortSignal`. The wrapper validates schema depth, node count, serialized size, supported keywords, request bounds, provider result shape, JSON compatibility, output size, schema conformance, and bounded token usage; accepted requests and results are immutable.
The Pi adapter’s direct normalizer and Loader admission share one plugin-owned Standard Schema contract. Both enforce closed fields, normalized provider/model identifiers, paired custom `baseUrl`/`modelContextWindow`, reasoning and timeout/token/response limits, and identical defaults/omission behavior. Validation is synchronous and side-effect-free: it does not resolve credentials or construct or call a provider. Credential resolution remains per-call, while each activated generation retains its immutable provider/model snapshot and cancellation semantics.

Providers return only the schema-shaped JSON value and optional usage. Stable errors distinguish invalid requests, unavailable providers, authentication, timeout, cancellation, provider failure, missing output, and invalid output. Raw prompts, provider payloads, thinking, tool text, credentials, and provider diagnostics are not part of the result contract. A Runtime Preset may substitute any conforming provider by composing one `doppelgangerInference` implementation in the session realm; duplicate providers fail rather than winning by order. Omitting the service is valid.

`extension-inference-pi` is one optional Node-compatible provider. Its Loader row selects an installed Pi provider/model snapshot or explicitly constructs one OpenAI-compatible endpoint snapshot at activation, optionally resolves one named environment credential per call, requests exactly one schema-shaped `return_result` tool call with SDK retries disabled, and maps timeout, caller cancellation, disposal, authentication, and malformed output into the shared error contract. It neither executes returned tool calls nor uses the host's agent loop, model selection, credentials, conversation, or transport. Provider traffic and cost occur only when a consuming plugin explicitly enables and invokes inference.

## Context

Feature plugins register scoped context providers as Cordis effects. A host resolves providers at the cadence declared by its immutable capability profile. Each request carries direct principal input, optional stable turn identity, one non-negative token budget, and an adapter-minted request ID. The assembler orders accepted contributions deterministically, applies the shared budget once, and returns immutable `instructions` and `data` projections plus accepted and omitted source provenance.

Each contribution declares `instruction` or `data` authority. Priority orders contributions but never promotes data into instructions, and an adapter never parses flattened delimiters to recover authority. Provider disposal, mutation, or reload affects the next resolution boundary promised by the host. Host projection does not become retained conversation history or a stale fallback after empty or failed resolution.

OpenClaw resolves one assembly for each correlated native `runId` and reuses it across that run's prompt-build callbacks. Instruction contributions map to native system-context additions and data contributions to ordinary transient context; a missing `runId`, failed resolution, or unready binding produces omission rather than a stale fallback. This guarantee is limited to the supported embedded route and does not claim external-harness, warmup-bypassed, or context-engine compaction parity.

## Tools

Feature plugins register transport-neutral, namespaced tools with JSON Schema input definitions. The registry exposes a revisioned immutable catalog snapshot and revisioned descriptors without leaking host-native tool objects. Registration belongs to one exact owner token. A definition may declare immutable `approval: { policy: "required", reason? }`; the optional bounded non-empty reason is an advisory presentation hint, not authorization and not Persona- or host-specific policy.

A valid owner-set mutation validates the complete candidate before commit, preserves revisions only for exactly unchanged definitions, commits the owner set and catalog snapshot atomically, and then dispatches catalog-change observers in parallel. Observer rejection is converted to a bounded tool diagnostic; it cannot roll back the committed snapshot, make registration appear to fail, or prevent independent observers from running. Adapters receive only the new revision hint and fetch and validate the matching complete snapshot before exact replacement.

Each invocation captures the owner token, portable tool name, exact descriptor revision, call identity, cancellation controller, and settlement promise. Replacing an owner set aborts calls only for removed or revised definitions; an exactly unchanged definition and revision retains its active calls. Owner disposal is asynchronous and idempotent: it withdraws the catalog entries, aborts every owned call, awaits their settlement, and only then completes. A retired handler that ignores cancellation cannot return success after its authority disappears. Host cancellation remains a separate call-correlated operation. Required approval is a tool-owned minimum: one explicit native grant is bound to that call ID, tool revision, and canonical input digest, is consumed once, and cannot authorize another call or an unprotected tool.
Dynamic Runtime Plugins consume the same protocol rather than adding a host-specific execution channel. Their seven `runtime-plugin.*` control tools are ordinary portable definitions, and generated Packages may register further tools only through the guarded `doppelgangerTools` service. `runtime-plugin.run` declares required approval because it evaluates one exact immutable Package with process-level authority; the grant binds the submitted Plugin ID, Package ID, mode, name, purpose, and source digest. Inspection and definition do not execute source. Host denial, cancellation, or unavailable approval fails before dispatch.

OpenClaw advertises `tools.delivery: "session-start"`. Deployment preparation converts each portable name to one concrete `dg_...` native name and freezes the manifest boundary. Every declared native call requires one exact `before_tool_call` record covering binding, native call ID, optional run ID, native/canonical name, descriptor revision, and catalog generation; execution consumes it once and forwards the captured run correlation. Required tools additionally require genuine `allow-once` and exact final-input digest equality. Ordinary tools may receive valid final arguments changed by native middleware because no approval authorization is bound to their earlier input. Runtime catalog notifications invalidate prior-generation records and closures and can refresh already declared compatible descriptors for later native factory construction, but they cannot register a new native name or promise mid-loop replacement. A new or contract-changed name requires regenerated artifacts and native restart. Dynamic Runtime Plugin control tools may be prepared; arbitrary tools generated afterward are not natively exposable.

Evolution uses the same context and tool protocols without an executor channel. Its seven `evolution.*` definitions are ordinary portable ledger controls whose schemas stay within the supported cross-host translation subset. `evolution.transition` publishes one object schema and enforces the selected target's required and irrelevant metadata at invocation. Stable operation IDs and exact revision checks remain mandatory, and no input accepts actor or Persona override fields. Its context provider contributes one instruction-authority policy and at most one data-authority reminder candidate. Its optional lifecycle signal worker may consume committed events and may call same-realm structured inference only when explicitly configured; neither path expands tool authority. Proposal or reminder state grants no approval to Persona Authoring, research, Dynamic Runtime Plugins, package installation, or host APIs.

Context resolution and tool registry operations emit metadata-only ordinary Cordis events under `doppelganger-context` and `doppelganger-tools`. They do not add fields to protocol results, lifecycle payloads, host capabilities, tool definitions, or the Runtime Host API; raw context, tool input, and tool output remain excluded. The event vocabulary is owned by [Runtime logging](../features/runtime-logging.md).

## Typed host-specific extensions

[Host Extensions](host-extensions.md) own admission, trusted selection, closed session facts, and protected composition. Host-native observations that lack proven cross-host semantics remain outside the generic lifecycle vocabulary. A host-specific definition targets one exact host kind and may expose an explicitly typed host-namespaced service or event, isolated to the owning Runtime Session and registered/disposed as a Cordis effect. Transported values are closed, bounded, JSON-compatible, and validated on both sides of the existing process boundary. A portable consumer declares the namespaced dependency explicitly and fails visibly on hosts that do not provide it; no approximate fallback is synthesized.

Host-specific providers reuse the adapter's one in-process binding or its existing transport, router, and process lifecycle. Their factories receive only closed Host Extension session facts, not a raw native runtime, unrestricted event bus, registry, UI, credential store, provider, filesystem, process manager, or authority channel. They do not create a second host RPC connection, socket, sidecar, request router, or session-binding path. OMP therefore carries `todo-reminder` over the same per-session framed RPC connection as the shared Runtime Host bridge, validates that the event belongs to the active Runtime Session, and emits `doppelganger/host/omp/todo-reminder`. Other hosts neither implement nor advertise that event.

OpenClaw uses the direct form of the same rule: preparation admits and bundles an exact `openclaw` Host Extension module set, while each native binding instantiates fresh entries under one in-process Composition Runtime root. Raw OpenClaw runtime, registry, gateway, credentials, UI, provider, sandbox, node, subagent, and worktree facilities remain adapter-private.

This one-host-transport rule does not apply to ordinary Runtime Preset plugins connecting to their own external dependencies. For example, `extension-mcp` owns its MCP server transports under the Runtime Session; those connections do not provide a parallel path into the native agent host.

## Lifecycle

Host adapters publish normalized, deeply frozen, bounded lifecycle events through `publishLifecycleEvent`. Lifecycle protocol version 2 is a closed discriminated union: the decoder accepts only own event-name keys, exact common and variant-specific fields, bounded nested JSON values and structured errors, and the immutable Runtime Session ID owned by the attached bridge. Unknown or inherited event names, missing fields, stale fields from another variant, malformed nested values, and cross-session publication fail before any subscriber runs.

Each event kind has one payload owner: `turn-committed` carries committed principal input, assistant output, and turn outcome, while each tool result or structured tool error appears only in its correlated `tool-completed` event. Stable `sessionId`, `turnId`, `callId`, and `deliveryId` values preserve correlation across transport. Candidate capture and Evolution signal discovery consume completed committed turns only. Partial, failed, or cancelled turns never become evidence; uncommitted tool-completion events are bounded correlation material and expire without persistence. Subscriber failure is contained as a lifecycle diagnostic and never invalidates already committed host work.

Identifiers are opaque to portable consumers. Every host adapter must distinguish new work from replay when a logical session is resumed: a new turn must not reuse a prior turn identity, and a new event must not reuse a prior delivery identity. A genuine replay preserves the original event identifiers. Identifier generation and native-session restoration belong to each adapter; the shared protocol requires neither a particular UUID format nor OMP counters, binding state, or logging activation metadata.

OpenClaw currently advertises an empty standard lifecycle set. Native reset, session end, runtime cleanup, and Gateway/plugin shutdown drive ownership teardown only. The adapter does not synthesize `turn-committed` from `agent_end`, transcript writes, tool completion, context resolution, or disposal; automatic candidate capture and completed-turn Evolution signals are therefore unavailable on this profile.

## Host seam

A host integration installs at most one shared Runtime Host bridge per Runtime Session through its standard `runtime-host` Host Extension. A direct host binds it in-process; a transported host serializes its requests over one adapter-owned connection:

```text
native host adapter <-> existing binding or versioned transport <-> protected Host Extension composition
```

The bridge exposes one frozen actor-neutral capability profile containing only context delivery, tool delivery, required-approval support, cancellation support, and faithfully available standard lifecycle event kinds. Unknown fields, arbitrary feature strings, unsupported versions, and malformed transported values fail at the boundary. Actor Identity remains an independently selected standard Host Extension: provider absence, explicit `unbound`, and immutable `bound` state are distinct. OpenClaw's profile is per-turn context, session-start tools, required approval, cancellation, and no lifecycle kinds; OMP retains its independently implemented profile.

The runtime-side bridge maps correlated context requests, immutable revisioned tool catalogs, exact-revision invocation, call-correlated cancellation, protected one-shot approval grants, and declared lifecycle publication to optional standard protocols. Its binding has one explicit runtime-to-host signal, `toolCatalogChanged(revision)`; another outbound condition requires its own typed Host Extension contract rather than a generic notification envelope. OpenClaw uses the signal to revalidate its prepared subset, not to enlarge its native manifest. Portable feature plugins, Evolution workflows, generated Packages, and MCP servers do not receive the raw host runtime.

Every supported adapter passes the same transport-independent Runtime Host conformance suite against its declared immutable profile. A host-specific operation or event enters the common API only after two implemented adapters prove equivalent timing and commit boundaries, authority, correlation identities, success/failure/cancellation/retry/replay behavior, ordering and stale-callback semantics, and rollback/disposal ownership.

Transported conformance instantiates the actual adapter, child, and request/response mapping. OMP verifies bound and explicit-unbound Actor Identity; true provider absence is covered separately by the direct protocol fixture because OMP always installs the provider. OpenClaw conformance instantiates its native plugin factory with a finite prepared catalog, exact actor route mapping, one-shot native pre-dispatch records for all calls, catalog-generation fencing, native middleware argument changes for ordinary tools, additional final-input digest and allow-once checks for required tools, direct bridge, and empty lifecycle set. Test-only registration and held-call controls remain outside production contracts.

## Primary implementation

- `packages/extension-protocols/src/actor-identity.ts`
- `packages/extension-protocols/src/host-capabilities.ts`
- `packages/extension-protocols/src/context.ts`
- `packages/extension-protocols/src/tools.ts`
- `packages/extension-protocols/src/lifecycle.ts`
- `packages/extension-protocols/src/inference.ts`
- `packages/extension-protocols/src/runtime-host.ts`
- `packages/host-extension-runtime/src/contracts.ts`
- `packages/host-extension-runtime/src/runtime.ts`
- `packages/host-extension-runtime/src/standard.ts`
- `packages/extension-protocols/tests/support/runtime-host-conformance.ts`
- `packages/extension-inference-pi/src/plugin.ts`
- `packages/extension-inference-pi/src/provider.ts`
- `packages/host-omp/src/contracts.ts`
- `packages/host-openclaw/src/direct.ts`
- `packages/host-openclaw/src/adapter.ts`
- `packages/host-openclaw/src/catalog.ts`
- `packages/host-omp/src/omp-host-events.ts`
