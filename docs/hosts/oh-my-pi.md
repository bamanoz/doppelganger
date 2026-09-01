# Oh My Pi host

Oh My Pi (OMP) is the implemented host integration. `host-omp` is Runtime-Preset-neutral and has no dependency on Persona, memory, SQLite, embedding, vector packages, or a named preset.

## Activation

The neutral `@doppelganger/doppelganger-omp` entrypoint resolves generic host options, validates optional non-empty `DOPPELGANGER_ACTOR_ID`, and delegates to `createDoppelgangerOmpExtension`. The repository-local `.omp/extensions/doppelganger.ts` only re-exports that package entrypoint. Runtime Preset selection discovers the nearest `.doppelganger/manifest.yaml` from the working directory up to the Git root and follows strict precedence:

1. explicit host/session Runtime Preset;
2. project `runtimePreset`;
3. user `defaultRuntimePreset`;
4. optional deployment default.

OMP's normal roster configuration uses the shipped actor-neutral `standard` deployment default. First selection from an uninitialized home creates `config.yaml`, an empty `runtime.cordis.patch.yml`, and `.runtime-presets/`, then activates `standard` without copying its package-owned assets; later starts preserve user edits. A winning missing or broken preset fails visibly and never falls through. Deployments that intentionally disable the shipped root or otherwise configure a defaultless roster can still leave OMP inactive; that state keeps OMP fully usable and exposes initialization that writes only `version` and `runtimePreset` to the project manifest.

`runtimePresets` host options configure the pure roster's roots, trust, derived shipped/user roots, and optional deployment default. OMP does not compose the Cordis roster plugin into the child and does not implement a second discovery path.

`actorId` is host configuration, not selection or Persona configuration. The protected OMP bridge transports one validated immutable binding to the child and exposes it as `doppelgangerActor`; absence produces explicit unbound state. The shipped `standard` and other actor-independent presets still activate. A memory-bearing preset fails visibly before memory storage or tools become active when the actor is unbound. Changing actors requires a new OMP Runtime Session.
## Process and transport

Each active OMP agent session owns one Node child runtime and one framed, versioned JSON-RPC connection over stdio. `host-omp` resolves the private child entry relative to its own installed module layout; callers may override that path only through the explicit embedding/test seam. Its package contents include the child and every private runtime module the child imports. The serialized activation carries the optional host actor binding alongside stable session, turn, call, and delivery identities. Both endpoints validate it. Lifecycle events currently use lifecycle protocol version 2 independently of the unchanged OMP framed RPC protocol version. Protocol decode errors, malformed frames, request/response failures, stream failure, child exit, and bounded shutdown remain fatal only to that OMP session.

Notification observers are a contained boundary rather than a transport-failure boundary. Observers settle independently; one rejection is converted to a bounded method/message diagnostic, sibling observers still run, unrelated pending requests remain active, and failure in the diagnostic sink is also contained. The process owner records the diagnostic in its bounded stderr history and the OMP extension reports it without marking a healthy child failed.

The runtime-owned host plugin is appended through the protected final patch and cannot be forged by authored input. It owns actor identity as well as the optional context, tool, and lifecycle bridge services.

## Projection

Before each model turn, the adapter requests current assembled runtime context and appends it without discarding host instructions. Runtime tool JSON Schemas are validated and translated to OMP parameter schemas. Dynamic proxies are replaced exactly after reload; removed definitions become inactive and stale closures cannot invoke them. Actor selection or switching is never projected as a tool, and memory schemas expose no actor field.

Portable tools declaring required approval become native OMP write-tier prompts with the portable reason and a bounded deterministic rendering of the exact parsed arguments. The prompt remains mandatory in permissive and `yolo` modes; only one explicit grant reaches `tools.invoke`, while rejection, cancellation, or unavailable UI leaves the child handler untouched. Approval metadata participates in exact dynamic replacement, so committed reload changes the next call and invalid reload retains the previous behavior. OMP encodes portable dots in tool names: `persona.inspect` is `doppelganger_persona_x2e_inspect` and `persona.revise` is `doppelganger_persona_x2e_revise`; the adapter contains no Persona-specific branch.

OMP lifecycle observations are normalized and forwarded to the runtime-side plugin. `tool_execution_end` is the sole source for bounded `tool-completed` results and errors. Final assistant content from `turn_end` becomes `turn-committed`; aggregate `turn_end.toolResults` are not copied or synthesized into lifecycle events. The events remain correlated by stable session, turn, call, and delivery identities. Only committed turns are candidate-capture input. These generic context, tool, lifecycle, approval, and actor-binding paths do not require Persona or memory extensions.

## Failure and shutdown

Invalid selection/configuration, activation failure, fatal transport failure, runtime failure, or child failure disables Doppelganger for the affected session, reports a visible diagnostic, and leaves OMP usable. A contained notification-observer rejection reports its diagnostic but does not disable the runtime. The `session_shutdown` handler transfers ownership immediately to a detached bounded teardown so OMP's two-second handler cap is never consumed by child disposal. That teardown emits the neutral disposal lifecycle event available from OMP, requests Runtime Session disposal, closes transport, reports the observed outcome, and escalates child termination when necessary.

## Package boundaries

`@doppelganger/doppelganger-omp` is the private, version `0.0.0` local install unit understood by OMP's plugin manager. Its manifest declares exactly one extension entrypoint. That neutral entrypoint supplies no home, child path, actor default, Persona instance, or named Runtime Preset; a non-empty `DOPPELGANGER_ACTOR_ID` is the only package-level host binding input. The package owns the product dependency closure required to resolve the shipped `standard` Runtime Preset from an isolated linked plugin tree.

`@doppelganger/doppelganger-host-omp` remains the generic Runtime-Preset-neutral adapter library. Its only declared package entrypoint exports `createDoppelgangerOmpExtension`, `DoppelgangerOmpExtensionOptions` including pure-roster configuration, and the adapter-facing `OmpChildConnection`, `OmpChildDisposal`, and `OmpChildFactory` types. It has no dependency on Persona, SQLite, memory, embedding, vector packages, or a named preset. Child runtime, process owner, framed protocol, wire contracts, and runtime-host implementation modules are package-private.

The local plugin package remains private and source-first. Local linking and package inspection are supported; npm publication, marketplace distribution, independent versioning, provenance, and public compatibility policy are separate future work.

## Primary implementation and scenarios

- `packages/omp/src/index.ts` — neutral OMP plugin entrypoint.
- `packages/omp/tests/plugin-package.spec.ts` — package contract, isolated link, and delegated-bootstrap scenarios.
- `.omp/extensions/doppelganger.ts` — project-local default re-export from the plugin package.
- `packages/host-omp/src/index.ts` — supported adapter package root.
- `packages/host-omp/src/extension.ts` — OMP hooks and projection.
- `packages/host-omp/src/adapter.ts` — session state machine and retained child-factory contracts.
- `packages/host-omp/src/process.ts` — child lifecycle and bounded diagnostic history.
- `packages/host-omp/src/protocol.ts` — framed JSON-RPC and observer containment.
- `packages/host-omp/src/child.ts` — private package-relative child runtime endpoint.
- `packages/host-omp/tests/exports.spec.ts` — adapter root import contract.
- `packages/host-omp/tests/` — transport, failure, patch, persistence, capture, dynamic-tool, reload, and shutdown scenarios.

