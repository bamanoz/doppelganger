## Context

Doppelganger's runtime already accepts arbitrary Cordis Loader rows, isolates one plugin tree per Runtime Session, projects portable context and tools through host adapters, and disposes every effect with its owning Fiber. What is missing is a model-facing authoring loop: the active agent cannot discover the exact runtime surface, define a temporary plugin without touching authored files, activate one immutable version, inspect failures, replace or roll back that version, and tear it down.

The reference implementation is DeepSeek Harness commit `4e84901e6471b79ec0338099867ebb4606d12bb5`, re-read on September 1, 2026 for this design. Its `packages/extensions/cordis-host-runner` and `packages/extensions/tool-cordis` establish the useful pattern:

- progressive `inspect-list` / `inspect-query` / `inspect-self` discovery;
- stable Plugin identities containing immutable Package versions;
- separate define and run operations;
- explicit `run` versus `update` version transitions with current/next pointers;
- ordinary child Fibers whose effects unwind on stop or replacement;
- a guarded plain-JavaScript evaluator with actionable parse/apply diagnostics;
- a development skill that insists on inspection before code and distinguishes stop from permanent removal.

The 648-commit refresh from the prior baseline changed the runner sources only mechanically: lossless JSON moved to `@deepseek-ai/dsh-util-values`, prompt placement moved behind `SystemPrompt.getSectionOrder`, and obsolete invariant companions were removed. The seven-tool workflow, immutable version state, guarded evaluator, approval distinctions, and Fiber lifecycle remain unchanged.

Doppelganger cannot reuse the DSH runner. The DSH service mounts under its own Host root, owns DSH Agent identities, includes a browser Client half and DSH UI/steering contracts, and does not necessarily inhabit a Doppelganger Runtime Session's isolated protocol realms. The new runner must be an ordinary optional Doppelganger extension mounted inside the selected Runtime Preset.

The change also crosses a deliberate trust boundary. `node:vm` supplies a fresh realm, withheld globals, and a synchronous evaluation timeout; it is not containment. Host-realm services and callbacks remain escape routes, asynchronous or non-cooperative code can outlive a VM timeout, and an in-process DSH deployment has no child-process fault boundary. Running generated code therefore carries authority comparable to granting shell access and must remain an explicit native host decision.

## Goals / Non-Goals

**Goals:**

- Add an optional `@doppelganger/doppelganger-dynamic-runtime-plugins` Loader plugin with one Runtime-Session-owned registry and mutation queue.
- Give an agent source-verified progressive inspection of the supported Cordis surface before it writes code.
- Define bounded immutable JavaScript Package versions without executing them.
- Activate, update, restart, explicitly roll back, stop, inspect, and remove temporary plugins through stable namespaced portable tools.
- Require one native host approval for every exact activation attempt before any stored generated source is evaluated or mounted.
- Mount active packages as guarded ordinary Cordis child Fibers so context, tools, services, event listeners, timers, and external effects use normal Cordis lifecycle ownership.
- Keep current/target pointers and bounded diagnostics sufficient for autonomous technical repair without silently discarding a known-good version.
- Make the same control surface portable through OMP now and native DSH after the active host change lands.
- Ship a cross-host Agent Skill that teaches the workflow and forbids direct Runtime Preset mutation as a fallback.

**Non-Goals:**

- Persisting definitions, source, grants, or running state across owner reload, Runtime Session disposal, child/process restart, or host restart.
- Promoting generated code into `runtime.cordis.yml`, writing plugin files, changing patches, or installing packages.
- Supporting imports, TypeScript, JSX, bundling, npm dependencies, browser Client halves, host UI slots, or DSH-specific steering/cards.
- Claiming security isolation from hostile code, bounding arbitrary asynchronous work, or protecting an in-process host from deliberate process compromise.
- Exposing uncatalogued Cordis internals, raw Context/Fiber/Loader objects, or a direct path that invokes portable tools while bypassing host approval.
- Adding the feature to shipped `standard`, automatically generating plugins, or restoring them after restart.

## Decisions

### 1. Implement one optional session extension, not a second runtime

Create `packages/extension-dynamic-runtime-plugins`. Its Loader plugin requires `doppelgangerRuntimeSession` and `doppelgangerTools`; it may use `doppelgangerContext`, actor metadata, lifecycle events, and other approved services when those services are present in the same isolated Runtime Session. The package depends inward only on `composition-runtime` for stable session metadata and `extension-protocols` for JSON, context, tool, and approval contracts.

The extension creates one inert Cordis group Fiber below its own plugin scope. Every active generated Package is mounted below that group. It does not create a Composition Runtime, Include tree, HMR watcher, filesystem mutation queue, or host-specific adapter. Its packages are absent when the Loader row is omitted. Shipped `standard` remains unchanged.

`packages/omp` includes the optional package in its private install dependency closure so a user Runtime Preset can resolve the bare package import without adding product-layer dependencies to `host-omp`. The future DSH deployment must make the package resolvable without adding it as a semantic dependency of generic `host-dsh`.

Alternative considered: make the runner a protected runtime plugin installed by every host. Rejected because opt-in policy and configuration belong to the Runtime Preset, and generic hosts must not silently grant generated-code authority.

Alternative considered: edit `runtime.cordis.yml` and let HMR activate generated files. Rejected because it conflates experimentation with persistent authoring, bypasses immutable versions and exact approval, and creates crash/rollback and concurrent-write obligations unrelated to the temporary workflow.

### 2. Mirror DSH's seven-step portable control surface

Register these qualified tools:

- `runtime-plugin.inspect-list`
- `runtime-plugin.inspect-query`
- `runtime-plugin.inspect-self`
- `runtime-plugin.define`
- `runtime-plugin.run`
- `runtime-plugin.stop`
- `runtime-plugin.undefine`

`inspect-list` returns compact provider manifests. `inspect-query` validates an exact provider/method/input tuple and returns a bounded JSON result. `inspect-self` lists source-free Plugin summaries by default, one Plugin's version state when given `pluginId`, and exact immutable source plus diagnostics only when both `pluginId` and `packageId` are supplied.

`define` creates a Plugin from a short lowercase semantic prefix or appends a Package to an existing Plugin. It validates bounds and parses source, then returns the host-minted `pluginId`, `packageId`, semantic metadata, and SHA-256 source digest. It never evaluates source, mounts a Fiber, changes current/next pointers, or asks for execution approval.

`run` takes exact `pluginId`, `packageId`, `mode`, `name`, `purpose`, and `sourceDigest`; the metadata and digest must match the immutable Package so the native approval prompt identifies the reviewed target rather than accepting a stale or substituted version. `mode: "run"` starts the first version, restarts the current version, or explicitly rolls back to the current known-good version. `mode: "update"` is required to switch from a current Package to a different Package.

`stop` is idempotent and retains every Package and version pointer. `undefine` first stops the active run, then removes the Plugin and all Package source from session memory.

Alternative considered: one generic dispatch tool. Rejected because exact schemas, host policy, approval presentation, discoverability, and lifecycle correlation are stronger with ordinary portable tools.

Alternative considered: DSH's underscore names. Rejected because Doppelganger's protocol requires lowercase plugin-qualified dot names; the semantic workflow is preserved without importing host naming conventions.

### 3. Keep immutable session-local state with explicit current and target semantics

Each extension instance owns all state for exactly one Runtime Session. IDs are opaque, monotonically minted within that instance, and never reused. A Plugin record contains immutable Packages in define order, optional `currentPackageId`, optional `nextPackageId`, one active run, and one bounded latest-attempt diagnostic.

A single extension-wide serialized mutation queue orders define, run/update, stop, undefine, and disposal. Inspection reads immutable snapshots. This avoids cross-tool races and gives deterministic collision outcomes even when a host dispatches tool calls concurrently.

Activation follows this order:

1. validate the requested transition and exact Package digest/metadata;
2. create a run-attempt identity and record the target;
3. parse/evaluate the source into a plugin value before disturbing the old run;
4. if evaluation succeeds, dispose the old active run;
5. mount and settle the guarded child Fiber;
6. on success, set `currentPackageId` to the target and clear `nextPackageId`;
7. on failure, dispose every candidate effect, retain the prior `currentPackageId`, retain the failed target as `nextPackageId`, record the phase/message/stack, and leave the Plugin stopped.

The extension does not automatically restart the prior Package after a failed update. Reactivating old code is another generated-code execution and must occur through a separately approved `mode: "run"` call. This is the same explicit rollback model as DSH's current/next pointers, tightened to Doppelganger's per-call approval rule.

A settled Fiber waiting on declared but absent approved services is a successful run with `waitingFor`; ordinary Cordis dependency semantics activate or park it as providers appear or disappear. The skill still queries live availability first and avoids speculative hard dependencies.

### 4. Generate an approved inspect catalog and intersect it with live state

Add a repository generator and check mode that project selected public Cordis service/event declarations, method signatures, property shapes, referenced types, and JSDoc into a generated runtime catalog owned by the new package. A small reviewed manifest selects which declarations are safe for generated plugins; generator freshness is part of repository integrity. This follows DSH's generated Cordis catalog rather than maintaining unverified prose signatures.

Initial providers are:

- `Service`: approved services, compact signatures, live/absent state, exact methods/properties, and referenced types;
- `Event`: approved event names, dispatch/listener mode, exact signatures, and referenced types;
- `Builtin`: the evaluator globals and guarded Context façade available to Package source;
- `Tool`: current source-free portable tool descriptors visible in the Runtime Session.

Runtime discovery tests `ctx.get()` only for catalogued service keys; it does not walk private reflect/registry internals. An uncatalogued service may exist in the composition but is neither advertised nor reachable through the guarded Context. This makes inspection an enforceable authority boundary, not advice that guessed code can bypass.

The first milestone does not let generated plugins publish new inspect-provider contracts. Two temporary plugins that need a shared private abstraction should remain one Package or use an already catalogued service. A future explicit provider-registration protocol can extend the catalog without weakening this boundary.

### 5. Use a guarded `node:vm` realm for API shaping, not security claims

Package source is the body of a plain JavaScript function that must return a Cordis Plugin function or an object with `apply(ctx)`. Define-time compilation rejects syntax errors before storing the Package. Run-time evaluation uses a fresh `node:vm` Context with a configured synchronous timeout and a filename derived from the Package ID.

The realm exposes only documented builtins such as a Package-tagged console, `TextEncoder`, `TextDecoder`, `atob`, and `btoa`, plus normal language intrinsics. Module imports, `require`, `process`, `Buffer`, `fetch`, and native timer globals are absent or throw a teaching error directing the author to an approved service. There is no TypeScript, JSX, import transformation, or bundling.

The plugin's `apply` receives a read-only Context proxy. It exposes lifecycle-safe effect verbs and approved services only. Direct access to `root`, `fiber`, `registry`, `plugin`, Loader/HMR internals, or another Context is rejected and recorded. Declared `inject` names must be catalogued before mount; property access additionally requires declaration, while optional `ctx.get(name)` is limited to catalogued names. Service return values are guarded so a returned Cordis Context is rejected.

The `doppelgangerTools` façade allows source-free listing and lifecycle-owned registration but withholds `invoke` and live handler objects. Generated code therefore cannot call a required-approval portable tool behind the host's back. Registrations returned by context/tool/service APIs are wrapped in the generated Fiber's effects even when the underlying service owns its own registration context.

Alternative considered: evaluate directly with `new Function` in the host realm. Rejected because it exposes accidental globals and produces a weaker, less teachable contract.

Alternative considered: describe the VM as a sandbox. Rejected because host closures, service capabilities, asynchronous work, and known `node:vm` limitations make that claim false.

### 6. Make activation approval exact, native, and stricter than DSH's reusable grants

Only `runtime-plugin.run` declares portable `approval: { policy: "required", reason }`. The reason states that the call executes generated JavaScript with process-level authority comparable to shell access. Existing host adapters must ask through their native one-shot path before invoking the handler; permissive/yolo modes, prior Package approvals, prior runs, and DSH runner grants do not satisfy the call.

The immutable Package digest and semantic metadata in the arguments are checked again inside the handler. Rejection, cancellation, missing UI/answerer, descriptor replacement, or stale arguments fails before evaluation. Define and inspect remain non-executing reads/writes to process memory. Stop and undefine only reduce active authority and use the host's ordinary policy tier.

This deliberately differs from DSH, where some Host-only packages can start without the Client approval flow and Client grants can cover later versions. Doppelganger has a portable generic approval contract and uses it uniformly for every generated-code activation.

### 7. Preserve normal protocol and host projection behavior

Generated plugins register context and tools through existing `doppelgangerContext` and `doppelgangerTools` contracts. Context appears on the next resolution. Tool registration emits the existing tools-changed event; OMP and the planned DSH host perform their existing exact projection refresh. Stopping, replacing, or disposing a generated Fiber removes its registrations, and stale host proxy closures fail unavailable rather than invoking removed code.

The control extension does not add a new transport. OMP invokes its tools through the existing child JSON-RPC bridge; the generated code runs in that session's owned child. The native DSH adapter will project the same qualified tools through DSH's scoped registry and native approval gate. It must not route them through `@deepseek-ai/dsh-cordis-host-runner`.

The active `add-deepseek-harness-host` plan should gain a focused vertical scenario proving that an opt-in Runtime Preset can define, approve, run, observe, and stop one temporary Host plugin through the portable surface. That reconciliation changes host evidence, not the host-neutral contract designed here.

### 8. Treat owner replacement and session disposal as hard ephemeral boundaries

The registry is process memory owned by the extension Fiber. An unrelated reload that leaves the extension Fiber intact may leave temporary plugins running. A committed composition reload that replaces or removes the extension disposes every active generated Fiber and drops all definitions. Invalid composition reload retains the previous audited generation and therefore retains the existing extension and its temporary state.

Extension disposal snapshots every Plugin, rejects new mutations, drains the mutation queue, disposes every active run even when another disposer fails, clears definitions in a finally-equivalent path, and reports collected cleanup failures after all reachable work settles. Runtime Session and OMP child disposal inherit this behavior through normal Cordis ownership. No state is written for restoration.

### 9. Ship one cross-host development skill based on DSH's inspect-first discipline

Add `skills/runtime/doppelganger-runtime-plugin-development/SKILL.md`. The skill first decides whether a temporary host-side runtime plugin is the right mechanism; ordinary code changes, persistent Runtime Preset authoring, host UI, and one-shot tool calls are routed elsewhere.

For a fitting request it must:

1. call `runtime-plugin.inspect-list`;
2. query only the exact Service/Event/Builtin/Tool contracts needed;
3. inspect exact current Package source before modifying an existing Plugin;
4. write plain JavaScript with reversible Cordis effects;
5. define one immutable Package;
6. run the exact returned Package and handle native approval;
7. inspect and repair technical failure, explicitly roll back when needed, stop for temporary disablement, and undefine only for permanent session-local removal.

A rejected approval ends the attempt without retry. Missing control tools means the active Runtime Preset omitted the capability; the skill does not edit files, patches, compositions, or call DSH's native `cordis_*` tools as an alternate authority.

## Risks / Trade-offs

- **Generated code is trusted process code**: the VM reduces accidental reachability but does not contain hostile code. Mitigation: opt-in composition, explicit shell-equivalent warning, native approval on every run/update, guarded API, and documentation that DSH is same-process while OMP has only a child-process failure boundary.
- **Asynchronous and non-cooperative code cannot be reliably bounded**: a VM timeout covers synchronous evaluation only, and service calls or plugin apply/dispose can hang or crash. Mitigation: bounded source/state, ordinary Cordis disposal, host process/child failure handling, and no sandbox claim. Strong isolation requires a separate future worker/process design.
- **Catalog incompleteness limits usefulness**: uncatalogued services are intentionally inaccessible. Mitigation: generate from selected source declarations, fail on drift, expose live/absent status, and extend the reviewed manifest rather than enabling guessing.
- **Source and diagnostics consume model context and memory**: immutable versions can accumulate. Mitigation: strict per-source, per-Plugin, Package-count, total-registry, string, stack, and query-output bounds; source appears only in exact Package inspection.
- **Failed update leaves the Plugin stopped**: simultaneous old/new activation cannot safely stage duplicate services or tools. Mitigation: pre-evaluate before stopping old code, preserve the known-good current pointer, and make rollback an explicit separately approved run.
- **Composition reload may erase temporary work**: the extension is itself an ordinary Loader row. Mitigation: document the hard ephemeral boundary and keep persistent promotion explicitly out of this milestone.
- **Host availability differs**: OMP can verify the complete behavior now; DSH proof depends on the active native-host change. Mitigation: keep all semantics in portable tools and session Cordis APIs, add planned DSH evidence, and do not add a DSH-specific fallback.
- **Optional package resolution is deployment work**: a Runtime Preset cannot import a package absent from the installed product closure. Mitigation: include it in the private OMP product package, document DSH installation requirements, and leave automatic package installation/distribution to a later change.
