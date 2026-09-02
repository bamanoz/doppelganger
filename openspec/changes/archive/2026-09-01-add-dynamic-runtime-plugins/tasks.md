## 1. Reconcile active cross-host contracts

- [x] 1.1 Update the active `add-deepseek-harness-host` proposal and design to consume the portable `runtime-plugin.*` surface and remove `@deepseek-ai/dsh-cordis-host-runner` from the planned product path
- [x] 1.2 Add the DSH host capability scenarios for exact generated-code approval, native in-process failure boundaries, dynamic projection cutover, stale closure denial, and exhaustive agent disposal
- [x] 1.3 Update DSH implementation tasks to cover the opt-in extension without duplicating its registry, evaluator, inspection catalog, or transition semantics
- [x] 1.4 Validate both active OpenSpec changes before implementation edits

## 2. Package foundation and architectural boundaries

- [x] 2.1 Create `packages/extension-dynamic-runtime-plugins` with strict NodeNext TypeScript, public and Loader exports, peer Cordis, focused scripts, and no host or composition-runtime dependency
- [x] 2.2 Add the package-boundary manifest entry and only the approved independent/protocol package edges
- [x] 2.3 Add the private `@doppelganger/doppelganger-omp` dependency required for user Runtime Preset Loader resolution without adding the extension to `host-omp`
- [x] 2.4 Define strict JSON-compatible extension configuration with safe defaults and bounded VM timeout, source, name, purpose, Plugin, Package, registry, inspection, message, and stack limits
- [x] 2.5 Reject unknown, non-finite, negative, inconsistent, and excessive configuration before registry or tool activation
- [x] 2.6 Add activation tests proving explicit opt-in, independent Loader visibility, isolated protocol service use, omission neutrality, and unchanged shipped `standard`

## 3. Source-verified inspection catalog

- [x] 3.1 Define the generated catalog schema for approved Service, Event, Builtin, Tool, purpose, referenced type, input, output, and availability metadata
- [x] 3.2 Select the minimal initial public source declarations for host-neutral context, tool, lifecycle, logging, HTTP, timers, events, and other explicitly supported services
- [x] 3.3 Implement deterministic catalog generation from those exact declarations with stable ordering and bounded transport-neutral JSON output
- [x] 3.4 Add repository freshness verification that fails when a selected declaration changes without regenerating the catalog
- [x] 3.5 Implement `runtime-plugin.inspect-list` as a compact source-free manifest of current providers and methods
- [x] 3.6 Implement `runtime-plugin.inspect-query` with exact provider/method schemas, approved-name lookup, live service availability, referenced contracts, and no business-operation invocation
- [x] 3.7 Reject guessed providers, methods, services, events, builtins, oversized output, private Cordis reflection, Loader, registry, root, Fiber, and Context inspection
- [x] 3.8 Add inspection tests for manifest discovery, exact contract lookup, live/absent state, referenced types, strict input, bounded output, uncatalogued access, and stale generated artifacts

## 4. Ephemeral registry and immutable definitions

- [x] 4.1 Implement one extension-instance registry owning opaque non-reused Plugin, Package, and run identities in deterministic creation order
- [x] 4.2 Model immutable Package source, SHA-256 digest, semantic metadata, current and target pointers, active run state, waiting services, and latest bounded diagnostic
- [x] 4.3 Implement `runtime-plugin.inspect-self` summary, Plugin-detail, and exact Package-source views with progressive disclosure and strict ownership checks
- [x] 4.4 Implement `runtime-plugin.define` for validated lowercase semantic prefixes, first Package creation, and immutable version append without pointer or execution changes
- [x] 4.5 Parse plain JavaScript before storage and return actionable bounded diagnostics for syntax, TypeScript, JSX, import, module, and configured-limit violations
- [x] 4.6 Enforce per-source, per-Plugin Package-count, Plugin-count, and aggregate stored-source limits without eviction or partial creation
- [x] 4.7 Add registry and definition tests for stable identities, byte-exact source retention, digest correctness, version ordering, strict fields, parse failures, limit failures, and cross-session isolation

## 5. Guarded evaluator and capability façades

- [x] 5.1 Implement a fresh `node:vm` evaluation realm for each approved attempt with configured synchronous timeout and only documented builtins
- [x] 5.2 Validate that evaluated source returns a Cordis Plugin function or object with `apply(ctx)` before mounting it
- [x] 5.3 Implement a generated-Context guard exposing only approved lifecycle-safe effect verbs and services declared through the Package Plugin's `inject` contract
- [x] 5.4 Implement optional guarded `ctx.get(name)` for catalogued services while withholding raw Context, Fiber, Loader, HMR, registry, root, plugin construction, and uncatalogued services
- [x] 5.5 Reject service results that expose another Cordis Context and record post-activation guard failures against the owning run
- [x] 5.6 Provide teaching failures for unavailable imports, `require`, process, Buffer, native fetch, native timers, and uninspected globals without describing the VM as a security sandbox
- [x] 5.7 Implement approved lifecycle-aware façades for context contribution, tool registration, events, timers, HTTP/logging, and each selected initial service contract
- [x] 5.8 Withhold portable tool invocation, live handlers, mutable registrations, and the reserved `runtime-plugin` namespace from generated code
- [x] 5.9 Add evaluator and guard tests for valid plugins, timeout, invalid return, approved services, optional absent services, uncatalogued access, framework internals, context-returning services, unavailable globals, generated tool validation, and reserved namespace rejection

## 6. Fiber lifecycle and version transitions

- [x] 6.1 Mount each evaluated Plugin as an ordinary child Fiber under the extension owner and await settled activation instead of treating a returned Fiber as an effect
- [x] 6.2 Report catalog-approved missing hard dependencies as explicit `waitingFor` state while preserving normal Cordis parking and reactivation semantics
- [x] 6.3 Implement first `run` transition semantics that commit `currentPackageId` only after successful activation
- [x] 6.4 Implement `update` as dispose-old-then-start-new with explicit `nextPackageId`, known-good current retention, and no automatic rollback after candidate failure
- [x] 6.5 Implement explicit approved rollback to an older immutable Package through the same update transition
- [x] 6.6 Reject inconsistent modes, missing identities, already-current updates, non-current runs, and overlapping transitions before disturbing the active Fiber
- [x] 6.7 Capture bounded parse, evaluation, apply, waiting, guard, and disposal diagnostics with exact Plugin, Package, run, phase, message, and optional stack correlation
- [x] 6.8 Add lifecycle and transition tests for valid activation, waiting dependencies, first run, update, rollback, invalid modes, failed candidates, failed stopped updates, and known-good pointer preservation

## 7. Control tools, approval, stop, and disposal

- [x] 7.1 Register exactly `runtime-plugin.inspect-list`, `runtime-plugin.inspect-query`, `runtime-plugin.inspect-self`, `runtime-plugin.define`, `runtime-plugin.run`, `runtime-plugin.stop`, and `runtime-plugin.undefine` through the ordinary Tool Registry
- [x] 7.2 Define complete strict JSON Schemas, bounded JSON-compatible results, stable structured error codes, and descriptions that distinguish non-executing definition from approved execution
- [x] 7.3 Mark `runtime-plugin.run` with required portable approval whose reason states shell-equivalent process authority and identifies exact Plugin, Package, mode, name, purpose, and source digest arguments
- [x] 7.4 Verify the approved handler revalidates every immutable identity and metadata field before evaluation so stale or substituted arguments fail closed
- [x] 7.5 Implement serialized per-Plugin state-changing operations and deterministic validation against the state committed by preceding calls
- [x] 7.6 Implement idempotent `runtime-plugin.stop` that settles or cancels transitions, exhaustively disposes active effects, and retains immutable definitions and pointers
- [x] 7.7 Implement `runtime-plugin.undefine` that stops if necessary, removes every Package and diagnostic, invalidates identities, and returns only after reachable cleanup settles
- [x] 7.8 Implement memoized extension disposal that rejects new work, attempts every active Plugin cleanup despite sibling failures, clears registry ownership, and reports aggregate cleanup failure afterward
- [x] 7.9 Add control-tool tests for exact surface, strict validation, metadata mismatch, one-shot approval entry, serialized mutation, stop/restart, undefine, stale identities, disposer failure exhaustion, repeated disposal, and post-disposal rejection

## 8. Portable effect lifecycle and Composition Runtime proof

- [x] 8.1 Prove generated context, tool, service, event, timer, and external-subscription effects are owned by the generated Fiber and removed before stop or undefine completes
- [x] 8.2 Prove successful update exposes only the new committed context and tool set while unrelated runtime registrations remain active
- [x] 8.3 Prove failed candidate cleanup removes every reachable candidate effect and leaves the documented stopped transition state
- [x] 8.4 Add a real Composition Runtime scenario covering optional activation, generated child Fiber settlement, owner replacement, Runtime Session disposal, and Cordis quiescence
- [x] 8.5 Add reload scenarios proving a valid row replacement drops ephemeral definitions while invalid reload retains the previous audited registry and active effects
- [x] 8.6 Verify no Dynamic Runtime Plugins code creates a second watcher, composition runtime, durable store, authored-file mutation, or implicit kernel requirement

## 9. OMP product and host integration

- [x] 9.1 Add an opt-in temporary OMP test Runtime Preset that composes standard protocols and Dynamic Runtime Plugins while leaving shipped `standard` unchanged
- [x] 9.2 Add an isolated linked-install test proving `@doppelganger/doppelganger-omp` can resolve the optional extension from its declared package closure
- [x] 9.3 Add OMP projection tests for the exact seven control tools, schema fidelity, generated context, generated tool registration, and unrelated native/runtime tool preservation
- [x] 9.4 Add OMP approval tests for grant, rejection, cancellation, unavailable UI, exact displayed arguments, source digest, shell-equivalent warning, handler non-invocation, and continued session health
- [x] 9.5 Prove every run, restart, update, and rollback prompts independently even in `yolo`, with no reusable or stale grant
- [x] 9.6 Add OMP dynamic replacement tests proving successful generated-tool cutover, removal on stop and undefine, and stale proxy denial before approval or child invocation
- [x] 9.7 Add OMP reload tests proving valid owner replacement clears ephemeral state and invalid composition reload retains prior generated effects and approval descriptors
- [x] 9.8 Add child-failure tests distinguishing structured evaluator/apply failure from fatal generated-code child exit, with fatal isolation limited to the owning OMP session
- [x] 9.9 Add bounded shutdown tests proving active generated Fibers dispose before graceful child exit and hanging or rejecting cleanup follows existing detached teardown escalation honestly
- [x] 9.10 Exercise the real project-local OMP extension with an opt-in disposable fixture Plugin, observe its context/tool effect, update it, stop it, and confirm the session remains usable

## 10. Cross-host runtime plugin development Skill

- [x] 10.1 Add canonical `skills/runtime/doppelganger-runtime-plugin-development/SKILL.md` with the exact skill identity and temporary Runtime-Session purpose
- [x] 10.2 Encode fit assessment that routes permanent code, authored composition, package installation, persistence, one-shot commands, browser Client work, and host UI away from Dynamic Runtime Plugins
- [x] 10.3 Encode mandatory `inspect-list`, exact contract query, existing Package inspection, plain-JavaScript, declared inject, reversible-effect, and no-guessed-API workflow
- [x] 10.4 Encode define-then-approved-run, immutable update, explicit rollback, waiting-state, technical repair, stop, undefine, rejection, and no-promotion-fallback behavior
- [x] 10.5 State the trusted process-code boundary, `node:vm` limitation, OMP child failure boundary, native DSH shared-process risk, and authority of each native approval decision
- [x] 10.6 Document exact OMP `/skill:doppelganger-runtime-plugin-development` and DSH `/doppelganger-runtime-plugin-development` invocation forms without claiming Skill invocation grants execution authority
- [x] 10.7 Add repository integrity tests for canonical frontmatter, universal project installation, host discovery, required workflow clauses, forbidden fallbacks, and exact trust language
- [x] 10.8 Verify project-scoped installation discovers the same canonical Skill in OMP and DSH fixtures without maintaining host-specific copies

## 11. Documentation and final verification

- [x] 11.1 Update architecture overview, composition/reload, protocols, configuration, verification, status/scope, OMP host, DSH host plan, and `docs/README.md` ownership map in the same change
- [x] 11.2 Document opt-in Runtime Preset configuration, exact seven-tool workflow, plain-JavaScript contract, immutable version model, waiting state, explicit rollback, stop/undefine distinction, and ephemeral restart behavior
- [x] 11.3 Document generated-code trust, API guard limits, OMP child and native DSH failure boundaries, no persistence, no package installation, no Client UI, and no hostile-code sandbox claim
- [x] 11.4 Update root setup and usage documentation with generic Runtime Preset opt-in, Skill installation, host-native invocation, approval, rejection, diagnosis, rollback, cleanup, and recovery examples
- [x] 11.5 Run focused typechecks and tests for `extension-dynamic-runtime-plugins`, `extension-protocols`, `composition-runtime`, `host-omp`, and `omp`
- [x] 11.6 Run catalog freshness, Skill integrity, live-spec, package-boundary, single-Cordis-root, product-package install, and documentation integrity checks
- [x] 11.7 Run the real OMP smoke scenario after focused checks and confirm shipped `standard`, Persona, memory, existing tools, and unrelated host behavior remain unchanged
- [x] 11.8 Run `npm run check` and validate both active OpenSpec changes with no unresolved artifact or live-spec disagreement
