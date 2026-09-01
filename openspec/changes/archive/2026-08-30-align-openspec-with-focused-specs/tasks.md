## 1. Focused-spec validation foundation

- [x] 1.1 Inventory all current OpenSpec scenarios with proposed owner, stable ID, disposition (`retain`, `move`, `merge`, `split`, `remove`), and existing or missing Vitest evidence; confirm every pre-change scenario is classified before editing live specs.
- [x] 1.2 Add `scripts/lib/focused-specs.mjs` to parse current specs and active delta sections into requirements and scenarios with source locations, IDs, evidence rows, one `WHEN`, and one `THEN`.
- [x] 1.3 Add fixture-driven parser and shape tests in `scripts/tests/focused-specs.spec.ts`, including malformed headings, missing or duplicate metadata, multiple request/outcome rows, archive exclusion, and active-delta operation handling.
- [x] 1.4 Implement TypeScript-AST evidence resolution for repository-relative `*.spec.ts::static test title` references, rejecting traversal, missing or duplicate targets, modified/conditional/parameterized cases, and skipped or conditional containing suites.
- [x] 1.5 Add evidence-resolution tests for direct `it`/`test` cases, duplicate titles, stale paths and titles, invalid modifiers, conditional suites, and additive versus exact evidence expectations.
- [x] 1.6 Implement standard current-spec validation plus active-change `planned:` handling and strict selected-change pre-archive validation, with diagnostics that include path, line, scenario ID, and failed rule.
- [x] 1.7 Add `scripts/check-focused-specs.mjs` and root package scripts for direct standard and strict selected-change checks, but do not compose standard validation into `check:integrity` until the live corpus is migrated.

## 2. Runtime, preset, and Persona ownership migration

- [x] 2.1 Reconcile all activation, isolation, audit, reload, and disposal contracts into `composition-runtime`, preserve or focus their executable evidence, and remove the superseded `runtime-kernel` live capability.
- [x] 2.2 Reconcile home resolution, discovery/health, metadata, selection precedence, activation input, and Runtime Session metadata into `runtime-presets`, preserve or focus their evidence, and remove the superseded `runtime-preset-roster` live capability.
- [x] 2.3 Reconcile Persona Activation, stable instance semantics, identity, ordered traits, host neutrality, reload, and session isolation into `extensions/persona`, preserve or focus their evidence, and remove the superseded `persona-composition` live capability.
- [x] 2.4 Reduce `loader-plugin-composition` to package naming, Loader mountability, capture separation, and Runtime Preset topology; remove duplicated feature behavior while retaining evidence for each remaining infrastructure contract.
- [x] 2.5 Assign stable IDs and resolved evidence to every retained runtime, Runtime Preset, Persona, and Loader scenario, splitting any independently failing outcomes encountered during consolidation.

## 3. Memory, protocol, and host ownership migration

- [x] 3.1 Consolidate `persona-memory` partition, provenance, mutation, correction, deletion, idempotency, and secret-rejection requirements around the refined contracts; remove their superseded formulations and preserve complete executable evidence.
- [x] 3.2 Consolidate `persona-memory` candidate review, promotion, contradiction, capture, and extraction requirements; split independently failing outcomes and add focused evidence where existing tests are too broad.
- [x] 3.3 Consolidate `persona-memory` lexical/semantic retrieval, recall authority, projection, temporal eligibility, ranking, and fallback requirements without restating vector-backend ownership.
- [x] 3.4 Focus `memory-semantic-indexes` on embedder-space identity, local embedding, backend conformance, projection data minimization, filters, and initialization; split compound configuration outcomes and resolve their evidence.
- [x] 3.5 Focus `memory-semantic-indexes` generation rebuild, synchronization, health, maintenance, diagnostics, retry, and real-backend smoke contracts without duplicating canonical memory behavior.
- [x] 3.6 Assign stable IDs and resolved evidence to all `extension-protocols` context, tool, lifecycle, serialization, authority, and subscriber-containment scenarios; split independently failing outcomes.
- [x] 3.7 Consolidate OMP process, transport, RPC state, shutdown, and failure-isolation scenarios under `hosts/oh-my-pi`, removing terse duplicates while retaining each current host contract.
- [x] 3.8 Consolidate OMP context, tool, lifecycle, identity, and dynamic-proxy scenarios, split compound outcomes, and resolve every retained scenario to focused host tests.
- [x] 3.9 Assign stable IDs and resolved evidence to the remaining `runtime-patch-layering` and current `repository-integrity` scenarios, adding focused script tests where no current evidence proves the stated outcome.

## 4. Checker cutover and documentation

- [x] 4.1 Run the focused-spec checker directly against the fully migrated current corpus and fix every missing ID, duplicate owner, malformed scenario, invalid evidence target, or unresolved test title without adding an allowlist.
- [x] 4.2 Compose standard focused-spec validation into `scripts/lib/repository-integrity.mjs`, update its fixtures for valid focused scenarios, and add repository-integrity regression tests for the new composed check.
- [x] 4.3 Update `docs/modes/focused-specs.md` with the OpenSpec `WHEN`/`THEN`, stable ID, resolved evidence, and active-change `planned:` conventions.
- [x] 4.4 Update `docs/operations/verification.md` with standard repository validation and the strict selected-change pre-archive command; keep the existing `docs/README.md` topic ownership unchanged.
- [x] 4.5 Replace every `planned:` reference in this active change with its now-existing test path and static title, then prove strict pre-archive validation succeeds for `align-openspec-with-focused-specs`.

## 5. Verification and cleanup

- [x] 5.1 Run the focused-spec and repository-integrity script tests and confirm the checker accepts the complete current corpus while rejecting each fixture violation.
- [x] 5.2 Run every affected package test suite referenced as evidence and verify any added focused tests fail against a plausible broken contract before retaining them.
- [x] 5.3 Run strict OpenSpec validation for `align-openspec-with-focused-specs` and confirm all delta requirements and scenarios are valid.
- [x] 5.4 Remove migration-only inventories or scaffolding, confirm no archived change was modified, and run the complete `npm run check` workflow successfully.
