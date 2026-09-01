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
- OMP packaging changes: use temporary OMP registry, profile, session, workspace, and Doppelganger homes; link `packages/omp` through the real plugin manager; verify discovery without `-e`, fresh-home shipped `standard` activation, optional external actor binding, package-relative child startup, and cleanup before deleting temporary roots. Also exercise the repository-local `.omp/extensions/doppelganger.ts` delegation with explicit `DOPPELGANGER_HOME` and `DOPPELGANGER_ACTOR_ID`, and verify Mark context plus actor-aware tools through a real OMP session.
- Persona asset changes: wait for observable reload success/failure and verify last-good retention rather than sleeping for an assumed watcher interval.
- Memory changes: verify mutation idempotency, canonical revalidation, deletion, partition/temporal eligibility, and lexical fallback as applicable.
- Semantic resource changes: verify initialization failure, retry, close during acquisition, exactly-once candidate cleanup, and one real inference/backend path where available.
- UI-free integration experiments: run the actual path; test-file success alone is not a smoke test. OMP plugin-link and repository dogfood smokes must use mutually exclusive discovery paths so the extension is never loaded twice.
- Persona evolution skill changes: install the canonical repository source with current `npx skills add` into a temporary project's `universal` target, verify the exact copy under `.agents/skills`, load it through actual OMP and DSH project discovery, and exercise `/skill:doppelganger-persona-evolution review --dry-run` plus `/doppelganger-persona-evolution review --dry-run`. Do not claim a shared global install path; current project scope is the portable intersection.

## Opt-in real backend suites

The normal workspace suite skips service-dependent tests. Run opt-in suites only against disposable model caches and test services:

| Backend/path | Test | Environment |
| --- | --- | --- |
| Local embedding | `packages/extension-embedding-local/tests/local-embedder.spec.ts` | `DOPPELGANGER_RUN_LOCAL_EMBEDDING_SMOKE=1` |
| Chroma | `packages/extension-memory-vectors/tests/chroma.smoke.spec.ts` | `CHROMA_SMOKE_URL` and optional tenant/database/token-env settings |
| Qdrant | `packages/extension-memory-vectors/tests/qdrant.real.spec.ts` | `QDRANT_URL` |
| pgvector | `packages/extension-memory-vectors/tests/pgvector.smoke.spec.ts` | `DOPPELGANGER_TEST_PGVECTOR_DSN` |

Never point tests at `dev/doppelganger/instances/aiden/storage` or production state. Dispose Runtime Sessions, Cordis roots, database handles, clients, candidate runtimes, and child processes before deleting temporary directories. Record unavailable external services explicitly rather than substituting mocks for a real-service smoke claim.

## Dependency audit

`npm run check:security` is separate from the deterministic `npm run check` because it queries the npm registry. It runs the production audit, prints unresolved advisories and the trusted-artifact deployment restriction, and compares the result with `scripts/security-advisory-baseline.json`.

The command fails on a new advisory, baseline drift, a reviewed advisory disappearing or changing dependency path, or `fixAvailable` becoming true. If the command passes while entries remain, report the exact unresolved count and baseline date; never describe that result as a clean production dependency audit.
