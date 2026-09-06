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

The root gate is deterministic in command and ownership, while its mandatory canonical-PostgreSQL step uses a disposable real service as described below. It runs every workspace typecheck and test, verifies one Cordis installation, validates package dependencies/imports against `scripts/package-boundaries.json`, and runs documentation, legacy-contract, focused-spec ownership, executable-evidence, and repository-source integrity checks. The boundary checker derives edges from TypeScript syntax (imports, side-effect and type-only imports, re-exports, and literal dynamic imports), attributes named subpaths to their owning workspace package, rejects cross-package relative imports, and ignores comments and ordinary strings. Computed dynamic imports remain outside this static edge policy. Every helper imported by an executable repository command must exist as tracked source in a clean checkout.

`npm run check:integrity` independently verifies the documentation index and links, removed live paths and legacy contracts, unique focused-scenario ownership, resolved executable evidence, and the transitive helper inventory of repository check commands. It reports a missing helper and an ignore rule that excludes an imported helper as explicit failures. Active deltas may use syntactically valid `planned:` evidence only while implementation is incomplete; `check:focused-specs:change` rejects those references before archive or handoff as implemented evidence.

OMP conformance proof must instantiate `OmpAdapterSession` over the real child FramedJsonRpc transport rather than substituting a direct `RuntimeHostBridge`; direct bridge suites remain separately labelled. Strict protocol JSON admission rejects non-finite and undefined values, custom coercion/accessors, symbols, sparse arrays, and cycles before approval or dispatch, while bounded lifecycle observations intentionally project lossy values.
The shared matrix exercises OMP's actual bound/unbound Actor Identity states. Provider absence is a separate direct-protocol case, not an OMP mode. Backend maintenance overlap fixtures own and close their controlled adapter instances; SQLite's synchronous exclusive operation is probed reentrantly at the actual PRAGMA boundary.

## Canonical PostgreSQL gate

`npm run check` must exercise the real canonical PostgreSQL repository through `scripts/with-memory-postgresql.mjs`; canonical PostgreSQL is not an opt-in or missing-service-skippable suite. `DOPPELGANGER_TEST_POSTGRESQL_DSN` may name an explicit disposable PostgreSQL service. When it is absent, the wrapper provisions a bounded PostgreSQL 17 Docker container, waits for readiness, exports the test DSN only to the owned check, and cleans the container up on success or failure.

The gate fails when the explicit service is unusable or when automatic Docker provisioning is unavailable; it never substitutes an in-memory adapter or reports a missing service as a skip. The target must be disposable and must not be a personal, development, or production database. Canonical PostgreSQL verification covers schema migration, actor and Runtime Session isolation, concurrent writers and generation locking, asynchronous reads/mutations, fresh post-semantic canonical reload, transfer compatibility, and one real OMP child path. Existing real OMP packaging and transport requirements remain mandatory and are not replaced by direct service tests.

The checked-in `.github/workflows/check.yml` pins `actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0`, selects Node 26 on Ubuntu, runs `npm ci`, and invokes this same `npm run check` gate. It delegates the disposable PostgreSQL 17 service to `scripts/with-memory-postgresql.mjs` rather than maintaining a second CI service definition. This is the repository's CI configuration, not a claim that any remote workflow run passed.

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

- Runtime or patch changes: exercise structured patch diagnostics, activation, transactional watch acquisition, valid reload, invalid rollback, cleanup failure aggregation, shared-watch membership, and repeated disposal. A rollback succeeds only after restoration settles and passes activation audit; failed restoration must expose observed entry diagnostics and aggregate candidate and restoration errors.
- Runtime Preset changes: prove ordered short-circuit selection, strict validation at the winning level, no fallback from missing or broken winners, Loader-relative Node-style import-condition root/subpath resolution independent of `cwd`, and filesystem existence checks for resolved legacy deep imports.
- Shared Runtime Host changes: run the transport-independent conformance suite against every implemented adapter and prove two-session isolation, canonical empty protocols, closed capability and lifecycle rejection, immutable bridge session identity, atomic catalog replacement, contained observer failure, owner-scoped active-call retirement and settlement, stale revisions, approval replay failure, cancellation/completion races, actor-provider absence/unbound/bound independence, active-call disposal, and late callback containment.
- OMP transport changes: verify exact protocol/capability handshake rejection, closed request/result and lifecycle envelopes, request/turn/call/delivery correlation, instruction-only system projection, transient delimited synthetic user-role data projection on initial and continuation model requests without persisted history, revision-hint catalog refresh, stale descriptor rejection, exact one-shot approval and replay failure, cancellation, native-event validation, runtime-session isolation, replacement, failure containment, and bounded shutdown. Exercise the fake adapter seam, real child Runtime Session, and project-local extension vertical.
- OMP packaging changes: use temporary OMP registry, profile, session, workspace, and Doppelganger homes. Exercise linked-plugin and project-local modes as separate real OMP runs in the same explicitly selected profile. For linked mode, link `packages/omp` through the real plugin manager and verify discovery without `-e`, fresh-home shipped `standard` activation, optional external actor binding, package-relative child startup, and cleanup before deleting temporary roots. Before project-local mode, disable or uninstall the linked plugin; then exercise `.omp/extensions/doppelganger.ts` with a generated test Runtime Preset and test actor. Never enable both resolved entrypoint paths in one smoke invocation.
- Runtime logging changes: use generated disposable Runtime Presets and patches. Prove exporter omission and shipped-standard silence, activation replay, bounded hostile rendering and queues, independent filters/sinks, invalid activation and reload rollback, valid addition/removal, file rotation/retention/path rejection, private Sentry state and bounded close, concurrent session/child isolation, exhaustive cleanup, and searchable first-party core/Context/Tools events with sensitive payload markers absent. A real OMP child and one real project-local OMP invocation must show configured file output while stdout remains framed RPC and ordinary logs never reach OMP reports, UI, or stderr.
- File-retention changes additionally prove startup and actual periodic deletion, whole-family TTL and oldest-first quota, process-lifetime protection through silent/HMR gaps, crash recovery, competing collectors and busy claims, overlap/case-alias rejection, legacy/foreign/unsafe preservation, maintenance failure, and exhaustive registry/timer teardown. Keep active/protected over-budget outcomes explicit. Use real subprocesses and the real project-local OMP extension with disposable log directories; never sweep personal legacy logs as test fixtures.
- Persona asset changes: wait for observable reload success/failure and verify last-good retention rather than sleeping for an assumed watcher interval.
- Memory changes: verify both canonical SQLite and canonical PostgreSQL where applicable: mutation idempotency, schema migration, actor/Persona/scope isolation, durable instance-generation then actor locking, concurrent writers, asynchronous persisted reads and mutations, one fresh canonical bulk snapshot after semantic work, deletion, temporal eligibility, transfer rejection/rollback boundaries, and lexical fallback.
- Semantic-memory verification pairs deterministic temporary canonical-memory fixtures with controlled real-adapter maintenance latches: hold supported exclusive work at a backend boundary, prove one underlying operation and one `already-running` result, then verify completed/noop and unsupported outcomes separately. Real-service smoke remains required for Chroma, Qdrant, and pgvector; fixture-only adapter substitution is not service proof. These derived-backend smokes are independent of the mandatory canonical PostgreSQL gate.
- Dynamic Runtime Plugin changes: prove omission neutrality, exact seven-tool registration, catalog freshness and uncatalogued rejection, inert immutable definition, one-shot exact approval before every run/update, waiting dependencies, first run, update, explicit rollback, failed-candidate cleanup, stale-proxy failure, stop/undefine, owner reload boundaries, cross-session isolation, bounded diagnostics, and exhaustive session/host cleanup. Use a generated temporary Runtime Preset; never activate generated code in personal or durable runtime state.
- Semantic resource changes: verify initialization failure, retry, close during acquisition, exactly-once candidate cleanup, and one real inference/backend path where available.
- MCP import changes: prove synchronous structural validation, non-blocking Plugin and Composition Runtime activation, independent per-server startup, exact operator-authored command/arguments or endpoint, initialization and discovery timeout classification, atomic initial commit, retained tools after non-fatal refresh failure, atomic withdrawal after transport closure, asynchronous reload cutover, unchanged-generation retention, stale late-result rejection, and exhaustive cleanup during spawn, initialization, discovery, refresh, and active invocation. Add a real OMP child vertical that observes the initially absent tool appear through the ordinary dynamic catalog path; do not add MCP-specific host code or UI.
- UI-free integration experiments: run the actual path; test-file success alone is not a smoke test. OMP plugin-link and repository dogfood smokes must use mutually exclusive discovery paths so the extension is never loaded twice.
- Persona evolution skill changes: install the canonical repository source with current `npx skills add` into a temporary project's `universal` target, verify the exact copy under `.agents/skills`, load it through actual OMP and DSH project discovery, and exercise `/skill:doppelganger-persona-evolution review --dry-run` plus `/doppelganger-persona-evolution review --dry-run`. Do not claim a shared global install path; current project scope is the portable intersection.
- Runtime plugin development Skill changes: install the canonical repository source into a temporary project's `.agents/skills`, verify OMP and DSH native discovery/invocation syntax, and assert that the skill requires inspect-first operation, exact immutable metadata, reversible Cordis effects, explicit approval, and no fallback to files, shell, Loader mutation, DSH `cordis_*` tools, or private host APIs.
- Permanent plugin development Skill changes: install the canonical repository source into a temporary project's `.agents/skills`, load that same copy through actual OMP and DSH project discovery, and assert the permanent-package fit gate, explicit current/existing/new implementation-location choices before mutation, fresh target-repository discovery, source-verified Cordis and Doppelganger contracts, target-owned conditional planning, package contents and exports, disposable-consumer installation, Loader activation when applicable, lifecycle behavior, repository gates, and separate publication, release, remote, commit, and push authority.
- Evolution changes: prove strict configuration and missing-service failures, shipped-standard and omission neutrality, exact seven-tool registration, actor and project partitioning, stable operation replay, exact-revision transitions, deduplication, malformed/symlink project isolation, atomic cross-process writes, reminder relevance/snooze/cooldown/confirmed-delivery semantics, owner reload and omission cleanup, persistence into a new Runtime Session, generic OMP projection into the actual mounted-tool inventory, and stale-proxy rejection. Use generated temporary Runtime Presets and storage only.
- Structured inference changes: prove exact request-key validation, portable schema complexity bounds, JSON and output-schema validation, immutable results, bounded stable errors, cancellation, provider substitution, duplicate-provider rejection, and complete omission neutrality. Pi adapter changes additionally require faux-provider proof for installed provider/model selection, exact one-result-call normalization, no SDK retries, configured credential fail-loud behavior with no ambient fallback, ambient auth only when unconfigured, timeout, caller abort, bounded response, immutable reload snapshots, and disposal.
- Evolution signal changes: prove completed-turn and tool-outcome correlation, retry deduplication, failed/cancelled/uncommitted exclusion, deterministic English/Russian extraction, inference opt-in and deterministic fallback, exact inference prompt/schema, invalid hypothesis isolation, non-blocking publication, bounded FIFO overflow, disposal without stale writes, version-1 migration, retention without proposal loss, actor/Persona partitioning, capability distinct-turn and Persona distinct-session floors, inference-only suppression, project-unavailable diagnostics, idempotent promotion into ordinary `proposed` state, existing-proposal evidence merge, and unchanged seven-tool/consent boundaries. Include a real OMP child scenario across independent Runtime Sessions.
- Resume-sensitive lifecycle changes additionally require an adapter-generated-ID scenario with one retained logical session across fresh bindings, plus a real project-local OMP process restart. Check committed receipts, distinct occurrences, no promotion before the third distinct capability turn, exact replay without new evidence, and only `proposed` afterward. Keep host-neutral extraction/fallback tests separate from adapter proof. A controlled model response proves lifecycle plumbing, not a live model's extraction quality; successful inference or a receipt with zero occurrences is not proof that a signal was retained.
- CodeGraph changes: prove omission and shipped-standard neutrality, exact two-tool registration, strict configuration, compatible discovery cache and retry, exact workspace confinement, status validation, every unsafe index state, deduplicated incremental sync, bounded FIFO exploration, shell-free argv, telemetry overrides, timeout/output/process failures, reload cutover, stale-proxy rejection, and exhaustive child cleanup. Use the fixture executable for deterministic evidence and the real OMP project-local extension for generic projection.
- Evolution skill changes: verify current repository sources for both skills, install them into a temporary project's `.agents/skills`, load them through actual OMP and DSH project discovery, and assert direct Persona dry-run compatibility, proposal-first consent, bounded evidence/options, explicit selection, stop-at-selected handoff without repository, package, OpenSpec, planning, implementation, or execution authority, portability-first routing, and no alternate mutation, shell, Loader-edit, DSH private-API, or hidden file-write authority.

## Opt-in real backend suites

The normal workspace suite skips optional service-dependent semantic tests, but it does not skip canonical PostgreSQL. Run these additional opt-in suites only against disposable model caches and test services:

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
