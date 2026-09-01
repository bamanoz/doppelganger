## Context

The repository currently has 13 live capability specs with 288 scenarios. Their Markdown shape is regular, but ownership and evidence are implicit: `runtime-kernel` overlaps `composition-runtime`, Runtime Preset and Persona contracts have transitional owners, `persona-memory` contains old and refined formulations, and OMP contains terse and detailed versions of several behaviors. `scripts/lib/repository-integrity.mjs` validates documentation inventory, links, obsolete identifiers, and legacy phrases, but it does not parse scenario contracts or resolve them to tests.

`docs/modes/focused-specs.md` is the governing product-boundary specification mode. OpenSpec remains the requirement/change format; Vitest remains the executable evidence mechanism. The change must preserve all runtime behavior, archived history, package boundaries, and existing OpenSpec delta semantics.

## Goals / Non-Goals

**Goals:**

- Give every current independently failing behavior one authoritative capability and stable scenario identity.
- Reconcile duplicate and transitional live specs without losing implemented behavior.
- Link each current scenario to an executable Vitest test by repository-relative file and static test title.
- Validate scenario structure, identity uniqueness, ownership, and evidence resolution in repository checks.
- Permit active planning deltas to reference tests that the same change will add, while requiring resolved evidence before archive.
- Document the OpenSpec representation of Focused Specs and the strict pre-archive gate.

**Non-Goals:**

- Change runtime, host, Persona, memory, retrieval, persistence, or protocol behavior.
- Introduce a new behavior-test DSL, test runner, external dependency, or generated specification format.
- Rewrite archived OpenSpec changes.
- Infer semantic duplicate ownership with heuristics or natural-language similarity.
- Require one test case per scenario when one existing test proves multiple transactionally inseparable contracts.

## Decisions

### 1. Annotate scenarios in place

Each live OpenSpec scenario will retain its normal `#### Scenario`, `WHEN`, and `THEN` structure and add two metadata rows:

```markdown
#### Scenario: Runtime operator activates an arbitrary composition
- **ID**: `runtime.activation.arbitrary-composition`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules, protected root plugins, and immutable metadata`
- **WHEN** ...
- **THEN** ...
```

IDs use lowercase dotted semantic names and are independent of file location so they survive an ownership move. Evidence uses `<repository-relative-path>::<static Vitest title>`. Multiple `EVIDENCE` rows are allowed when one scenario genuinely needs more than one boundary observation.

Alternative considered: a central scenario-to-test manifest. Rejected because it would create a second ownership inventory separate from the scenario it governs.

Alternative considered: executable TypeScript specs generated from OpenSpec. Rejected because generated code and a second DSL add machinery without improving the existing Vitest boundary evidence.

### 2. Resolve evidence through the TypeScript syntax tree

A focused-spec checker will parse only referenced `*.spec.ts` files with the workspace TypeScript dependency. It will resolve direct, statically named `it(...)` and `test(...)` calls whose first argument is a string literal. Modified, skipped, conditional, todo, or parameterized cases (`.only`, `.skip`, `.todo`, `.skipIf`, `.runIf`, `.each`) and cases nested under a skipped or conditional suite are not valid evidence targets; add a small unconditionally executed wrapper test with a static title instead.

The checker will reject absolute paths, traversal outside the repository, missing files, duplicate matching test titles in one file, and titles that do not resolve. This proves that an unconditionally selected executable case exists in the default Vitest corpus; the test run remains the proof that it passes.

Alternative considered: regular-expression lookup. Rejected because comments, helper calls, quoting, and nested syntax create avoidable false matches.

### 3. Use scenario ID as the ownership key

Repository-wide uniqueness of a realized current ID establishes one live owner. Moving a behavior preserves its ID and removes the old scenario. Splitting a compound behavior retains the original ID for the dominant contract and assigns new IDs to independently failing outcomes. Merging duplicates selects one canonical ID and removes the others after their complete current contract is represented.

The checker cannot prove that differently worded scenarios with different IDs are semantically duplicate. The initial migration therefore includes a complete manual ownership reconciliation, and later review treats assigning a new ID as an explicit claim that the behavior is independent.

Alternative considered: a separate capability ownership manifest. Rejected because it would duplicate the live specs and still require semantic review.

### 4. Separate current, active-change, and archived validation

Validation has three scopes:

- `openspec/specs/`: strict current-state validation. IDs must be unique and evidence must resolve.
- `openspec/changes/<active>/specs/`: delta validation. Shape and IDs are checked within the change. A `planned:` evidence prefix is allowed for a test introduced by the change. A delta may reuse a current ID only under `MODIFIED` or `REMOVED Requirements`.
- `openspec/changes/archive/`: ignored by focused-spec validation as historical evidence.

A strict pre-archive command validates the selected active change after implementation and rejects `planned:` or unresolved evidence. Implementation of this change will replace its own planned references with resolved references before archive.

Alternative considered: exempt all active changes from repository verification. Rejected because malformed or duplicate delta identities would remain invisible until archive.

Alternative considered: require all active-change evidence to exist during proposal creation. Rejected because planning artifacts legitimately describe tests that implementation has not created yet.

### 5. Keep focused-spec parsing isolated and compose it into integrity checks

Add a dedicated `scripts/lib/focused-specs.mjs` parser/checker with fixture-driven tests in `scripts/tests/focused-specs.spec.ts`. `scripts/lib/repository-integrity.mjs` will call the standard mode, and a small CLI entry will expose strict change validation. `npm run check` continues to reach the standard checker through `check:integrity`; the pre-archive workflow runs the strict selected-change command explicitly.

Diagnostics use stable, actionable text containing the spec path, scenario line, scenario ID when available, and failed rule. No baseline or grandfathered allowlist will be added; the full live corpus migrates before the check is enabled.

### 6. Apply one explicit ownership map

The migration uses these owners:

- `composition-runtime`: composition activation, mount points, session isolation, activation audit, reload, disposal, and kernel public surface. Reconcile and remove `runtime-kernel`.
- `runtime-presets`: Doppelganger home, discovery and health, optional preset metadata, selection inputs and precedence, domain-neutral activation, and Runtime Session metadata. Reconcile and remove `runtime-preset-roster`.
- `extensions/persona`: Persona Activation metadata, stable instance semantics, identity, ordered traits, host neutrality, asset reload, and session isolation. Reconcile and remove `persona-composition`; keep `loader-plugin-composition` limited to Loader/package topology.
- `persona-memory`: canonical memory, partitions, mutations, candidates, capture policy, retrieval, recall authority, temporal eligibility, and deletion. Retain the refined contracts and remove superseded formulations within the file.
- `memory-semantic-indexes`: embedder identity, vector backends, projection generations, synchronization, health, and semantic fallback contracts. Do not restate canonical memory ownership.
- `extension-protocols`: host-neutral context, tools, lifecycle, serialization, authority, and failure-containment semantics.
- `hosts/oh-my-pi`: OMP-specific discovery invocation, child process/RPC lifecycle, projection, hook mapping, failure isolation, and dynamic proxy behavior. Remove terse duplicates where detailed host scenarios already own the same outcome.
- `loader-plugin-composition`: package naming, Loader mountability, and Runtime Preset topology only; references to feature invariants become links to their owning capabilities rather than duplicate requirements.

### 7. Preserve Focused Specs as the owning guidance

Update `docs/modes/focused-specs.md` to define how OpenSpec represents one request (`WHEN`), one outcome (`THEN`), stable IDs, evidence references, planned active-change evidence, and the strict pre-archive gate. Update `docs/operations/verification.md` with standard and strict commands. No new documentation page is needed, so `docs/README.md` retains the same topic map.

## Risks / Trade-offs

- [Risk] Mapping 288 current scenarios can hide a dropped contract during consolidation. → Build a before/after inventory keyed by requirement and scenario, classify every removal as moved, merged, split, or obsolete, and review each owner group before deletion.
- [Risk] A test title can exist while its assertions do not prove the promised outcome. → Treat static resolution as integrity, not semantic proof; review the referenced assertions during migration and add focused boundary tests where evidence is too broad.
- [Risk] Test title references add rename coupling. → Emit precise stale-reference diagnostics and require spec updates in the same change as test renames.
- [Risk] Dynamic or parameterized tests cannot be referenced directly. → Add thin statically named boundary cases rather than weakening resolution or depending on generated titles.
- [Risk] Duplicate semantics with different IDs remain mechanically invisible. → Make ID assignment part of ownership review and reject a second ID unless the behavior can fail independently.
- [Risk] Enabling strict current validation before migration would break every repository check. → Implement and test the checker first, migrate all current specs and evidence, then compose it into `check:integrity` as the final cutover.
- [Trade-off] Some existing broad tests may evidence more than one scenario. This is allowed only when their assertions independently prove each linked outcome; otherwise split the test.

## Migration Plan

1. Inventory every current requirement and scenario with its proposed owner, stable ID, disposition, and existing or missing test evidence.
2. Implement the parser/checker and fixture tests without enabling it in the root integrity workflow.
3. Reconcile capability ownership in small owner groups, assign IDs, split compound scenarios, and add or focus Vitest evidence where needed.
4. Resolve every current evidence reference, then enable standard focused-spec validation in repository integrity and document the commands.
5. Replace this active change's `planned:` references with resolved references and run strict pre-archive validation.
6. Run OpenSpec validation, script tests, affected package tests, and the complete `npm run check` workflow.

Rollback is a single change revert: no production code, persisted data, package API, or migration state is modified.

## Open Questions

None. The evidence syntax, ownership map, active-change lifecycle, and validation boundaries are fixed by this design.
