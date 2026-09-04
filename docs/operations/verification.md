# Verification

## Repository gate

Run the narrowest relevant typecheck and behavior test while iterating:

```sh
npx tsc -p packages/<package>/tsconfig.json --noEmit
npx vitest run --root packages/<package> <test-file>
```

Before handing off a permanent or cross-package change, run:

```sh
npm run check
```

The network-free root gate runs every workspace typecheck and test, verifies one Cordis installation, validates package dependencies/imports against `scripts/package-boundaries.json`, and runs documentation, legacy-contract, focused-spec ownership, and executable-evidence integrity checks.

`npm run check:integrity` independently verifies that every authoritative `docs/**/*.md` file is indexed by `docs/README.md`, local Markdown links resolve, removed live-document paths are absent outside excluded archives, configured obsolete identifiers or runtime-owned Persona-selection contracts do not re-enter main specs or active changes, and every current focused scenario has a unique stable ID and resolved executable evidence. Active deltas are shape-checked and may temporarily use syntactically valid `planned:` evidence.

Run focused-spec validation directly when editing requirements:

```sh
npm run check:focused-specs
```

Before archiving an implemented OpenSpec change, require all selected-change evidence to exist:

```sh
npm run check:focused-specs:change -- <change-name>
```

Execute the exact evidence graph when auditing current focused behavior or an archive-ready change:

```sh
npm run test:focused-specs
npm run test:focused-specs -- --change <change-name>
```

The runner validates ownership first, runs each unique referenced Vitest case once under its package-local root, and reports `PASS`, `SKIP`, or `FAIL` per Scenario ID. Skipped opt-in service evidence is non-fatal but remains explicit; validation, failed assertions, execution errors, and missing result mappings fail the command.

## Behavior-specific proof

- Runtime or patch changes: exercise activation, valid reload, invalid rollback, cleanup failure containment, and repeated disposal.
- Shared Runtime Host changes: run the transport-independent conformance suite against every implemented adapter and prove two-session isolation, canonical empty protocols, closed capability rejection, atomic catalog replacement, stale revisions, approval replay failure, cancellation/completion races, undeclared lifecycle rejection, actor-provider absence/unbound/bound independence, active-call disposal, and late callback containment.
- OMP transport changes: verify exact protocol/capability handshake rejection, closed request/result envelopes, request/turn/call/delivery correlation, revision-hint catalog refresh, stale descriptor rejection, exact one-shot approval and replay failure, cancellation, native-event validation, runtime-session isolation, replacement, failure containment, and bounded shutdown. Exercise both the fake adapter seam and a real child Runtime Session.
- OMP packaging changes: use temporary OMP registry, profile, session, workspace, and Doppelganger homes. Exercise linked-plugin and project-local modes as separate real OMP runs in the same explicitly selected profile. For linked mode, link `packages/omp` through the real plugin manager and verify discovery without `-e`, fresh-home shipped `standard` activation, optional external actor binding, package-relative child startup, and cleanup before deleting temporary roots. Before project-local mode, disable or uninstall the linked plugin; then exercise `.omp/extensions/doppelganger.ts` with a generated test Runtime Preset and test actor. Never enable both resolved entrypoint paths in one smoke invocation.
- Persona asset changes: wait for observable reload success/failure and verify last-good retention rather than sleeping for an assumed watcher interval.
- Memory changes: verify mutation idempotency, canonical revalidation, deletion, partition/temporal eligibility, and lexical fallback as applicable.
- Dynamic Runtime Plugin changes: prove omission neutrality, exact seven-tool registration, catalog freshness and uncatalogued rejection, inert immutable definition, one-shot exact approval before every run/update, waiting dependencies, first run, update, explicit rollback, failed-candidate cleanup, stale-proxy failure, stop/undefine, owner reload boundaries, cross-session isolation, bounded diagnostics, and exhaustive session/host cleanup. Use a generated temporary Runtime Preset; never activate generated code in personal or durable runtime state.
- Semantic resource changes: verify initialization failure, retry, close during acquisition, exactly-once candidate cleanup, and one real inference/backend path where available.
- MCP import changes: prove synchronous structural validation, non-blocking Plugin and Composition Runtime activation, independent per-server startup, exact operator-authored command/arguments or endpoint, initialization and discovery timeout classification, atomic initial commit, retained tools after non-fatal refresh failure, atomic withdrawal after transport closure, asynchronous reload cutover, unchanged-generation retention, stale late-result rejection, and exhaustive cleanup during spawn, initialization, discovery, refresh, and active invocation. Add a real OMP child vertical that observes the initially absent tool appear through the ordinary dynamic catalog path; do not add MCP-specific host code or UI.
- UI-free integration experiments: run the actual path; test-file success alone is not a smoke test. OMP plugin-link and repository dogfood smokes must use mutually exclusive discovery paths so the extension is never loaded twice.
- Persona evolution skill changes: install the canonical repository source with current `npx skills add` into a temporary project's `universal` target, verify the exact copy under `.agents/skills`, load it through actual OMP and DSH project discovery, and exercise `/skill:doppelganger-persona-evolution review --dry-run` plus `/doppelganger-persona-evolution review --dry-run`. Do not claim a shared global install path; current project scope is the portable intersection.
- Runtime plugin development Skill changes: install the canonical repository source into a temporary project's `.agents/skills`, verify OMP and DSH native discovery/invocation syntax, and assert that the skill requires inspect-first operation, exact immutable metadata, reversible Cordis effects, explicit approval, and no fallback to files, shell, Loader mutation, DSH `cordis_*` tools, or private host APIs.
- Permanent plugin development Skill changes: install the canonical repository source into a temporary project's `.agents/skills`, load that same copy through actual OMP and DSH project discovery, and assert the permanent-package fit gate, explicit current/existing/new implementation-location choices before mutation, fresh target-repository discovery, source-verified Cordis and Doppelganger contracts, target-owned conditional planning, package contents and exports, disposable-consumer installation, Loader activation when applicable, lifecycle behavior, repository gates, and separate publication, release, remote, commit, and push authority.
- Evolution changes: prove strict configuration and missing-service failures, shipped-standard and omission neutrality, exact seven-tool registration, actor and project partitioning, stable operation replay, exact-revision transitions, deduplication, malformed/symlink project isolation, atomic cross-process writes, reminder relevance/snooze/cooldown/confirmed-delivery semantics, owner reload and omission cleanup, persistence into a new Runtime Session, generic OMP projection into the actual mounted-tool inventory, and stale-proxy rejection. Use generated temporary Runtime Presets and storage only.
- CodeGraph changes: prove omission and shipped-standard neutrality, exact two-tool registration, strict configuration, compatible discovery cache and retry, exact workspace confinement, status validation, every unsafe index state, deduplicated incremental sync, bounded FIFO exploration, shell-free argv, telemetry overrides, timeout/output/process failures, reload cutover, stale-proxy rejection, and exhaustive child cleanup. Use the fixture executable for deterministic evidence and the real OMP project-local extension for generic projection.
- Evolution skill changes: verify current repository sources for both skills, install them into a temporary project's `.agents/skills`, load them through actual OMP and DSH project discovery, and assert direct Persona dry-run compatibility, proposal-first consent, bounded evidence/options, explicit selection, stop-at-selected handoff without repository, package, OpenSpec, planning, implementation, or execution authority, portability-first routing, and no alternate mutation, shell, Loader-edit, DSH private-API, or hidden file-write authority.

## Opt-in real backend suites

The normal workspace suite skips service-dependent tests. Run opt-in suites only against disposable model caches and test services:

| Backend/path | Test | Environment |
| --- | --- | --- |
| Local embedding | `packages/extension-embedding-local/tests/local-embedder.spec.ts` | `DOPPELGANGER_RUN_LOCAL_EMBEDDING_SMOKE=1` |
| CodeGraph | `packages/extension-codegraph/tests/codegraph.smoke.spec.ts` | `DOPPELGANGER_RUN_CODEGRAPH_SMOKE=1`; compatible standalone `codegraph` 1.6.x on `PATH` |
| Chroma | `packages/extension-memory-vectors/tests/chroma.smoke.spec.ts` | `CHROMA_SMOKE_URL` and optional tenant/database/token-env settings |
| Qdrant | `packages/extension-memory-vectors/tests/qdrant.real.spec.ts` | `QDRANT_URL` |
| pgvector | `packages/extension-memory-vectors/tests/pgvector.smoke.spec.ts` | `DOPPELGANGER_TEST_PGVECTOR_DSN` |

Never point tests at personal, development, or production runtime state. Build Runtime Presets and storage under temporary roots, then dispose Runtime Sessions, Cordis roots, database handles, clients, candidate runtimes, and child processes before deleting them. Record unavailable external services explicitly rather than substituting mocks for a real-service smoke claim.

## Dependency audit

`npm run check:security` is separate from the deterministic `npm run check` because it queries the npm registry. It runs the production audit, prints unresolved advisories and the trusted-artifact deployment restriction, and compares the result with `scripts/security-advisory-baseline.json`.

The command fails on a new advisory, baseline drift, a reviewed advisory disappearing or changing dependency path, or `fixAvailable` becoming true. If the command passes while entries remain, report the exact unresolved count and baseline date; never describe that result as a clean production dependency audit.
