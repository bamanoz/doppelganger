# Extension protocols

Protocol plugins provide a host-neutral integration language without expanding the runtime kernel. Values crossing protocol, YAML, RPC, tool, lifecycle, settings, or persistence seams are JSON-compatible and validated at the seam.

## Actor identity

The protected runtime-side host bridge provides one frozen, session-isolated `doppelgangerActor` value: `{ state: 'bound', actorId }` or `{ state: 'unbound' }`. The host validates and binds the identifier outside Runtime Presets, patches, Persona configuration, model context, and tools. Reload cannot change it; switching actors requires a new Runtime Session.

Generic compositions may run unbound. Persistent actor-aware extensions must explicitly inject the service and fail activation when it is unavailable or unbound rather than inventing an anonymous, default, Persona-authored, or model-selected identity.

## Context

Feature plugins register scoped context providers as Cordis effects. A host resolves providers for the current turn; the assembler orders contributions deterministically and applies the supplied token budget.

Each contribution declares `instruction` or `data` authority. Priority orders contributions but never promotes data into instructions. Provider disposal or reload removes its contribution from subsequent resolution.

## Tools

Feature plugins register transport-neutral, namespaced tools with JSON Schema input definitions. The registry exposes discovery and invocation without leaking host-native tool objects. Registration follows the owning plugin lifecycle. A definition may declare immutable `approval: { policy: "required", reason }`; the bounded non-empty reason is generic protocol metadata, not Persona- or host-specific policy.

A host adapter translates supported JSON Schema into its native schema and exactly replaces dynamic proxies when definitions change. Removed tools disappear; stale proxy closures must not invoke removed handlers. Invocation returns a JSON-compatible value or structured transport-neutral error. Required approval is a tool-owned minimum: one explicit native grant authorizes only that exact call, permissive modes and prior grants do not satisfy it, and rejection, cancellation, or an unavailable approval channel fails closed before the portable handler. Hosts may impose stricter policy.

Dynamic Runtime Plugins consume the same protocol rather than adding a host-specific execution channel. Their seven `runtime-plugin.*` control tools are ordinary portable definitions, and generated Packages may register further tools only through the guarded `doppelgangerTools` service. `runtime-plugin.run` declares required approval because it evaluates one exact immutable Package with process-level authority; the grant binds the submitted Plugin ID, Package ID, mode, name, purpose, and source digest. Inspection and definition do not execute source. Host denial, cancellation, or unavailable approval fails before dispatch.

Evolution uses the same protocols without an executor channel. Its seven `evolution.*` definitions are ordinary portable ledger controls whose schemas stay within the supported cross-host translation subset. `evolution.transition` publishes one object schema and enforces the selected target's required and irrelevant metadata at invocation. Stable operation IDs and exact revision checks remain mandatory, and no input accepts actor or Persona override fields. Its context provider contributes one instruction-authority policy and at most one data-authority reminder candidate. Proposal or reminder state grants no approval to Persona Authoring, research, Dynamic Runtime Plugins, package installation, or host APIs.

## Lifecycle

Host adapters publish normalized, deeply frozen, bounded lifecycle events through `publishLifecycleEvent`. Lifecycle protocol version 2 gives each event kind one payload owner: `turn-committed` carries committed principal input, assistant output, and turn outcome, while each tool result or structured tool error appears only in its correlated `tool-completed` event. Stable `sessionId`, `turnId`, `callId`, and `deliveryId` values preserve correlation across transport, including for consumers that reconstruct a turn from separate events.

The lifecycle event version is independent of any host transport version. Candidate capture consumes committed turns only; partial turns, tool-completion events, and disposal are not committed capture input.

## Host seam

A host integration has two sides:

```text
native host adapter <-> versioned transport <-> runtime-side Cordis host plugin
```

The runtime-side bridge maps host actor identity, lifecycle, context requests, tool operations, and approval metadata to optional standard protocols. A host may expose extra functionality only through explicit optional Cordis services or explicit RPC capabilities; portable feature plugins, Evolution workflows, and generated Packages do not receive the raw host runtime.

## Primary implementation

- `packages/extension-protocols/src/context.ts`
- `packages/extension-protocols/src/tools.ts`
- `packages/extension-protocols/src/lifecycle.ts`
- `packages/host-omp/src/runtime-host.ts`
