# Agent Context

## Start here

Use this file as the handoff map, not as the product specification.

1. Read the relevant section of [`SPEC.md`](./SPEC.md) before changing behavior; it is authoritative.
2. Use [`README.md`](./README.md) for setup, package orientation, and local OMP usage.
3. Read [`CONTEXT.txt`](./CONTEXT.txt) only when a product rationale or previously rejected alternative matters; it is historical discussion, not current scope.
4. Inspect the implementation and adjacent tests before editing. Preserve the existing contract rather than introducing a second convention.
5. Finish with the narrow package check, then run `npm run check` for any cross-package or permanent change.

Completion means the changed behavior is exercised end to end, all affected callers are migrated, package boundaries still pass, and no obsolete compatibility path remains.

## Current state

The first OMP milestone is complete. The repository currently has:

- a generic Cordis composition runtime with isolated sessions and transactional hot reload;
- host-neutral context, tool, and committed lifecycle protocols;
- persona selection, activation metadata, identity, and traits;
- instance-owned SQLite persistence;
- production memory schema, mutations, provenance, conflicts, temporal eligibility, retrieval, and optional candidate capture;
- a preset-neutral OMP adapter using versioned framed JSON-RPC;
- Aiden activation assembly in the project bootstrap, outside `host-omp`;
- real child-process tests for persistence, capture, dynamic tools, failure isolation, and reload.

Candidate capture for the development Aiden instance is intentionally disabled in `dev/doppelganger/instances/aiden/instance.yaml`.

The next planned milestone is the native DeepSeek Harness host. `SPEC.md` section 14 is a mandatory research gate: trace actual DSH boot, Loader, Fiber, service isolation, agent scopes, dynamic runners, and package topology before proposing or implementing that host. DSH is the architectural reference, not code to copy wholesale.

## Governing architecture

**Deep kernel.** The kernel owns composition, session isolation, lifecycle, diagnostics, reload, and teardown. Persona concepts remain ordinary plugins.

**One framework.** Cordis supplies dependency injection, plugins, lifecycle, services, scopes, and Loader semantics. Add features through those mechanisms rather than creating parallel abstractions.

**Open persona model.** Core does not define identity, memory, relationship, reflection, or cognition. Those belong to plugins and presets.

**Portable definitions.** A Persona Definition contains no concrete host plugin. A host mounts its runtime-side plugin beside the persona tree at activation.

**Generic host boundary.** `packages/host-omp/src` consumes a generic serialized composition activation. Persona selection and Aiden-specific imports stay in `.omp/extensions/doppelganger.ts` and `packages/preset-aiden`.

**One Cordis root.** Every package uses the workspace `@deepseek-ai/cordis` peer. Duplicate Cordis installations break service identity and isolation. Keep `npm run check:cordis` green.

## Package seams

- `composition-runtime`: definition validation, serialized activation, activation audit, session/runtime ownership, reload.
- `extension-protocols`: only the transport-neutral context, tools, and lifecycle language. It must not depend on other Doppelganger packages.
- `extension-sqlite`: instance-scoped database infrastructure; feature packages own their schemas.
- `extension-persona`: configuration, selection, immutable activation metadata, identity, and traits.
- `extension-memory`: all memory policy and persistence, including its tool/context projection and capture plugin.
- `preset-aiden`: the concrete Aiden definition and composition imports. Preset policy belongs here, not in a host.
- `host-omp`: OMP native extension, child runtime, RPC contracts/framing, runtime-side host plugin, and process shutdown.

`scripts/check-package-boundaries.mjs` enforces the dependency direction. Update it deliberately if a real architectural seam changes; do not work around it with relative cross-package imports.

## Contracts that must survive

### Activation and state

- `PersonaActivation` carries stable `instanceId`, `principalId`, and `sessionId`; project identity and project root are present or absent together.
- Filesystem paths in activation metadata are absolute.
- Instance settings are JSON-compatible and copied into immutable session metadata.
- Parallel sessions share persistence only. They do not share mutable objects, fibers, or handlers.
- Project runtime state stays outside the repository manifest. Development SQLite data lives under ignored `instances/*/storage/` directories.

### Context and tools

- Context contributions have explicit authority. Data cannot override instructions merely through priority.
- Context assembly enforces a hard token budget.
- Tool definitions are transport-neutral JSON Schema plus an invocation function.
- OMP translates JSON Schema to native OMP schemas; schema text in descriptions is not validation.
- Dynamic OMP proxy updates are exact: removed tools become inactive, changed schemas are replaced, and stale closures cannot invoke removed runtime tools.

### Lifecycle

- Lifecycle events are versioned, normalized, deeply frozen, and bounded through `serializeLifecycleValue`.
- Stable `sessionId`, `turnId`, `callId`, and `deliveryId` values are semantic identities, not logging decoration.
- Capture consumes `turn-committed`, never partial turns or disposal.
- Publish through `publishLifecycleEvent`; it validates payloads and contains subscriber failures.
- OMP RPC has its own protocol version in addition to the lifecycle protocol version.

### Memory

- Memory is a plugin service, not a kernel interface.
- Project scope is the default. Relationship scope follows `principalId` plus Persona Instance.
- Explicit `remember` creates active memory. Inference/capture creates candidates only.
- Every mutation requires a stable `operationId`; retries must replay the prior result or reject a changed command digest.
- Records use stable `subjectKey` values to reconcile equivalent observations and expose conflicts.
- Corrections append immutable revisions and use compare-and-swap against the expected active revision.
- Evidence is bounded provenance. Candidate promotion requires policy-satisfying distinct-session evidence and no unresolved contradiction or subject conflict.
- Retrieval applies partition, status, and temporal eligibility before ranking and revalidates asynchronous semantic results before returning them.
- Hybrid retrieval uses deterministic reciprocal-rank fusion; absence or failure of an optional semantic provider leaves lexical retrieval usable.
- Hard deletion removes the canonical record and every locally derived row: revisions, evidence, candidate links, conflicts, receipts, FTS, and embeddings.
- Secret rejection is shared by direct mutations and capture.
- Authored identity and traits are not writable memory. Capture must not mutate them.

## Implementation map

Read these files when touching the corresponding seam:

```text
packages/composition-runtime/src/runtime.ts                 session/reload ownership
packages/composition-runtime/src/serialized-activation.ts   portable activation contract
packages/extension-protocols/src/context.ts                 context authority and budget
packages/extension-protocols/src/tools.ts                   tool registry contract
packages/extension-protocols/src/lifecycle.ts               committed event protocol
packages/extension-persona/src/config.ts                    YAML validation
packages/extension-persona/src/selection.ts                 user/project selection
packages/extension-persona/src/activation.ts                session metadata service
packages/extension-memory/src/schema.ts                     schema and migrations
packages/extension-memory/src/service.ts                    memory invariants and mutations
packages/extension-memory/src/eligibility.ts                shared read predicates
packages/extension-memory/src/protocol.ts                   memory tools and context source
packages/extension-memory/src/capture.ts                    optional candidate capture
packages/extension-memory/src/content-policy.ts             secret/recursive-content policy
packages/preset-aiden/src/index.ts                          Aiden composition and policy
packages/host-omp/src/contracts.ts                          RPC API and version
packages/host-omp/src/adapter.ts                            generic adapter state machine
packages/host-omp/src/extension.ts                          native OMP projection
packages/host-omp/src/runtime-host.ts                       Cordis-side host bridge
packages/host-omp/src/child.ts                              child runtime server
packages/host-omp/src/process.ts                            bounded child shutdown
.omp/extensions/doppelganger.ts                             project Aiden selection/bootstrap
```

## Engineering conventions

- TypeScript is strict NodeNext ESM. Relative imports include `.ts`.
- `exactOptionalPropertyTypes` is enabled: omit absent optional properties instead of assigning `undefined`.
- Values crossing RPC, settings, tools, or lifecycle boundaries remain JSON-compatible and are validated at the boundary.
- Public contracts are exported from each package `src/index.ts`.
- Prefer one transaction for each persistent mutation and deterministic ordering for all externally visible lists/rankings.
- Dispose sessions, runtimes, database services, and child processes before deleting temporary directories. This is required for reliable Windows tests because open SQLite files produce `EBUSY`.
- Tests use temporary instance roots. Never point tests at `dev/doppelganger/instances/aiden/storage`.
- Add tests for observable contracts and failure boundaries, not implementation plumbing.

## Verification

Use the narrowest relevant command while iterating:

```bash
npx tsc -p packages/<package>/tsconfig.json --noEmit
npx vitest run --root packages/<package> <test-file>
```

Before handing off a permanent change:

```bash
npm run check
```

For OMP behavior, also exercise the real surface. The project-local extension is auto-discovered from `.omp/extensions/doppelganger.ts`; a basic smoke is documented in `README.md`. Child transport, capture, persistence, and reload scenarios live in `packages/host-omp/tests/`.
