## Context

The audit established that the package graph and core behavior are sound, but several boundaries are only locally correct:

- `composition-runtime` cleanup is ordered but short-circuits on the first rejection;
- lazy native/server resources can resolve after their owner has closed or can publish state before initialization commits;
- framed notification observers share the peer's fatal dispatch promise;
- watcher tests sometimes use elapsed time as a proxy for a committed reload;
- Runtime Preset architecture is current in code and `docs/`, while several main OpenSpec requirements still describe runtime-owned Persona selection;
- package boundaries, documentation inventory, and legacy-reference rules are maintained through separate prose and ad hoc checks;
- activation canonicalization and Persona file-backed reload behavior have parallel implementations;
- `host-omp` exports internal transport and child symbols from the package root;
- the optional local embedder has reviewed transitive production advisories with no compatible registry fix as of 2026-08-30.

The active `strengthen-persona-memory` change owns the initial `memory-semantic-indexes` capability and still has unfinished tasks. This change must not apply its semantic lifecycle delta until that change is completed, synced/archived, and the capability exists in the main spec tree.

### Prerequisite legacy-contract baseline — 2026-08-30

The post-archive non-historical scan found five live requirement targets that still encode runtime-owned Persona selection or terminology: `runtime-kernel` → `Scoped activation metadata`; `persona-composition` → `Project persona selection` and `Global persona selection`; `extensions/persona` → `Existing persona selection precedence`; and `hosts/oh-my-pi` → `Project manifest discovery`. The OMP spec additionally retains the requirement names `Persona context projection`, `Persona tool projection`, and `Persona context is appended without replacing OMP instructions`, plus runtime-failure prose that says Persona is disabled rather than the selected runtime.

No obsolete concrete package or aggregate-preset identifier remains in live source or active artifacts. The only live `@doppelganger/extension-*` / `@doppelganger/preset-aiden` text is the intentional negative compatibility scenario in `loader-plugin-composition`; archived OpenSpec changes remain excluded historical evidence. Valid extension-owned `instanceId`, `principalId`, `projectId`, identity, trait, storage, and memory fields are not legacy runtime contracts and must remain accepted.

## Goals / Non-Goals

**Goals:**

- Make disposal and asynchronous acquisition complete, idempotent, race-safe, and diagnostically honest.
- Preserve healthy JSON-RPC traffic when one notification observer fails.
- Make reload verification state/event-driven instead of sleep-driven.
- Make Runtime Preset and extension ownership consistent across live specs, docs, code, and tests.
- Establish one executable package-boundary map and an executable documentation/legacy integrity gate.
- Reduce duplicated normalization and Persona asset lifecycle code without introducing public frameworks.
- Reduce the supported `host-omp` root surface and migrate every in-repository caller cleanly.
- Treat unresolved dependency advisories as explicit operational risk rather than suppressing or overstating remediation.

**Non-Goals:**

- No new host, agent/model loop, daemon, sandbox, memory authority, vector backend, or Runtime Preset format.
- No change to framed JSON-RPC wire messages or the generic Runtime Session metadata fields.
- No compatibility shim for removed root exports or legacy Persona-selection fields.
- No automatic rewrite of archived OpenSpec changes.
- No speculative replacement of `@huggingface/transformers` while no verified compatible fixed chain exists.
- No broad rewrite of all tests or package internals merely to standardize style.

## Decisions

### 1. Sequence the change, but keep one acceptance gate

Implementation proceeds in ordered slices: prerequisite OpenSpec reconciliation, lifecycle failure containment, event-driven tests, architecture deepening/export cleanup, repository integrity/security policy, then documentation and full verification. The semantic backend slice starts only after `strengthen-persona-memory` is archived.

This keeps the user-selected “entire audit” scope in one reviewable change while preventing two active changes from independently defining `memory-semantic-indexes`.

**Alternative considered:** split every finding into separate changes. That gives smaller diffs, but leaves cross-cutting source-of-truth and verification guarantees temporarily inconsistent and does not match the selected scope.

### 2. Cleanup uses exhaustive settlement with stable ownership removal

Add a small internal cleanup collector that executes all registered cleanup stages, records non-duplicate failures, and throws one `AggregateError` only after all stages settle.

Session disposal ordering remains:

1. mark disposing and await the serialized mutation queue;
2. remove every exact input watch;
3. dispose the session owner Fiber;
4. remove the session from runtime ownership in `finally`.

Each stage is attempted even when the previous stage rejects. Runtime disposal snapshots active sessions, settles every session, then attempts runtime-owner and owned-root disposal separately. A caller-owned root is never disposed. The memoized disposal promise remains the idempotency mechanism, including when the first call rejects after exhaustive cleanup.

**Alternative considered:** swallow disposer failures. Rejected disposers are operationally relevant; suppressing them would make cleanup appear successful and hide broken plugins.

### 3. Async initialization is a prepare/commit transaction

Lazy resource owners use local candidate variables and publish instance fields only at a single commit point after every awaited validation/setup step and a final open-state check.

- **Local embedder:** load runtime candidate, validate post-load artifacts, recheck `closed`, then set active device and return/publish. Any failure after candidate creation closes the candidate exactly once. A late result after `close()` self-disposes. CPU fallback is attempted only after the failed candidate is closed.
- **pgvector:** load the runtime module locally, create a local pool, run extension/schema/table setup, recheck `closed`, then assign runtime/pool fields. Failure or late close ends the local pool. The runtime module is not treated as closeable because its contract owns no resource handle.
- **Qdrant:** client construction uses one shared promise. Rejection clears that exact promise when still current. Owned late clients are closed if the adapter closed before publication/use. Collection readiness remains retryable; a final open-state check precedes `initialized = true`.

Close paths snapshot and clear published ownership before awaiting close operations. No adapter publishes half-initialized state.

**Alternative considered:** cancellation tokens. Current loaders/clients do not uniformly support cancellation; prepare/commit plus late disposal provides deterministic ownership without a parallel cancellation abstraction.

### 4. Notification failure gets a diagnostic sink, not peer failure

`FramedJsonRpcPeer` gains an optional notification-observer error sink supplied at construction. Notification handlers are settled independently. Each rejection is normalized and sent to the bounded sink; sink failure is itself contained. Decoder errors, stream errors, malformed frames, and request/response protocol failures retain their existing fatal behavior.

Process and child owners route the sink into their existing bounded diagnostic/logging paths. The RPC wire format is unchanged.

**Alternative considered:** use `Promise.allSettled` and silently ignore rejections. That preserves transport but violates the requirement that subscriber failure remain observable.

### 5. Tests observe commits, diagnostics, or owned effects

Remove arbitrary sleeps from the identified watcher/HMR tests.

- Composition reload tests wait for the exact `onReload` revision, failed reload diagnostic, or observable lifecycle transition before issuing the next mutation.
- Persona asset logic receives direct unit coverage through the shared internal asset loader for successful reload, rejected reload, serialization, and last-good retention; plugin integration waits on observable context changes or captured diagnostics.
- Child/process integration uses existing RPC responses, runtime-changed notifications, process exit, and bounded promise helpers rather than elapsed-time staging.

Timeouts remain only as failure bounds around an awaited observable, not as a mechanism that makes the behavior happen.

### 6. Reconcile ownership by removing, not aliasing, legacy selection

Main OpenSpec requirements are updated through delta operations:

- generic runtime metadata remains `sessionId`, Runtime Preset ID, and optional workspace root;
- explicit/project/user precedence selects a Runtime Preset;
- Persona instance, principal, identity, ordered traits, storage, and state remain Loader-composed Persona/feature configuration;
- OMP terminology and scenarios use Runtime Preset activation except where Persona is the explicit extension under test.

All in-repository configuration and references migrate in the same cutover. No legacy fields, aliases, or compatibility parsing remain. Archived changes remain untouched.

### 7. One JSON package-boundary manifest drives enforcement

Create one small JSON manifest under `scripts/` containing every workspace package and its allowed internal package dependencies. `check-package-boundaries.mjs` loads and validates this manifest, rejects missing/unknown workspace packages, checks dependency sections and source imports, and emits deterministic violations.

`AGENTS.md` and architecture docs state the principles and point to the manifest; they do not repeat an independently maintained edge table.

**Alternative considered:** generate the manifest from package.json files. That would encode the current graph, not the intended architecture, and could not reject an accidental new edge.

### 8. Documentation and live-spec integrity are one local script

Add a deterministic, network-free script that:

- inventories `docs/**/*.md` against `docs/README.md`;
- resolves local Markdown links from `README.md`, `AGENTS.md`, and `docs/**/*.md`;
- rejects configured removed live-document references outside archived OpenSpec history;
- scans main specs and active changes for a narrow list of obsolete package/preset identifiers and legacy runtime-owned Persona-selection phrases.

The script uses explicit roots and exclusions rather than a broad text ban. It is added to `npm run check`. Unit fixtures cover valid extension-owned Persona fields so the guard does not reject legitimate `instanceId` configuration.

### 9. Share deep internals, not public abstractions

- Add internal composition normalization helpers for non-empty strings, absolute supported Loader paths, patch cloning/freezing, and optional omission. `createCompositionDefinition` and serialized activation keep their public types and context-specific field labels.
- Add an internal Persona asset module owning canonical URL resolution, trimmed non-empty reads, serialized HMR reload, last-good retention, and bounded warning callbacks. Identity and traits continue to construct their own sources, priorities, ordering, and contribution shapes.

Neither helper is exported from package public entrypoints.

### 10. Narrow `host-omp` exports after reference analysis

Use LSP references during implementation before changing exports. The package root retains the normal OMP extension constructor and its consumer configuration/types. Internal adapter, process, child, runtime-host, raw protocol, and wire contracts are removed from the root unless a real external package-level consumer exists. Any genuinely supported non-root seam receives a named package subpath and focused contract tests; repository tests may import package-private source paths and do not justify public API.

Every in-repository caller is migrated in the same change. No root re-export shim remains.

### 11. Security policy distinguishes local reproducibility from network audit

Keep `npm run check` deterministic and network-free. Add a separate `check:security` command that runs the production audit, compares advisories and `fixAvailable` state with a reviewed baseline, prints unresolved items, and fails on new drift or newly compatible fixes. The baseline records advisory identity, affected dependency path, review date, and restriction—not secrets or a claim of safety.

The local embedder documentation continues to require trusted pinned model artifacts and opt-in deployment. If a compatible fixed transformer/runtime/sharp chain is available during implementation, upgrade and verify it. Otherwise retain the reviewed baseline and explicitly report the residual risk.

**Alternative considered:** force `npm audit` into every `npm run check`. Network and registry availability would make ordinary repository verification nondeterministic.

## Risks / Trade-offs

- **Large coordinated change:** multiple packages and specs move together. Mitigation: implement in ordered slices with focused checks and one final repository gate.
- **Active semantic change dependency:** applying too early can conflict with `strengthen-persona-memory`. Mitigation: make archival of that change the first hard prerequisite for semantic work and validation.
- **Aggregate cleanup errors change failure shape:** callers may observe `AggregateError` instead of the first disposer error. Mitigation: preserve original errors as ordered members and document the contract.
- **Late-close tests can be nondeterministic if based on timing:** use deferred fake loaders/clients and explicit barriers, never sleeps.
- **Export narrowing is breaking:** unknown external consumers could rely on the current private workspace root. Mitigation: use references and package consumers as evidence, document retained APIs, and perform a clean cutover without pretending compatibility.
- **Legacy text checks can overmatch:** legitimate Persona extension fields resemble removed runtime fields. Mitigation: use scoped paths and precise patterns with positive and negative fixtures.
- **Security baseline can become suppression:** a baseline may hide risk if it never expires. Mitigation: include a review date, fail when `fixAvailable` changes, print unresolved advisories every run, and update operational docs.
- **No upstream fix may exist:** the high-severity advisories may remain after implementation. This is an accepted residual risk only for the opt-in trusted-artifact path, not a claim of remediation.

## Migration Plan

1. Complete, sync, and archive `strengthen-persona-memory`; verify `memory-semantic-indexes` exists in the main spec tree.
2. Apply OpenSpec ownership reconciliation and confirm non-archived specs no longer describe runtime-owned Persona selection.
3. Add lifecycle race/failure regressions, then implement exhaustive cleanup and prepare/commit resource ownership.
4. Add RPC observer-containment regression and diagnostic sink.
5. Replace timing-based watcher tests and introduce the internal canonicalization/Persona asset helpers under existing public behavior.
6. Analyze and narrow `host-omp` exports; migrate every repository caller.
7. Add package-boundary manifest, docs/legacy integrity script, and separate security audit policy.
8. Update owning docs, README/AGENTS guidance, and the audit follow-up with observed results.
9. Run focused package checks, real OMP behavior, applicable real embedding/vector smoke tests, `npm run check`, and `npm run check:security` with the exact unresolved result recorded.

Rollback is by reverting the complete change. Persistent canonical memory and vector data formats are unchanged; no data migration rollback is required.

## Open Questions

- Whether a compatible fixed `@huggingface/transformers` dependency chain exists must be re-evaluated during implementation against the registry. The design is valid either way: upgrade when compatible, otherwise retain explicit residual-risk controls.
- The final retained `host-omp` root and subpath export list depends on LSP/reference evidence at implementation time; the invariant is that only intentional consumer seams remain public.
