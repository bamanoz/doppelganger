## Context

Focused specifications already have one parser and validator in `scripts/lib/focused-specs.mjs`. It resolves each `EVIDENCE` value to a direct Vitest `it`/`test` call and enforces globally unique Scenario IDs. The missing layer is execution: selecting only those resolved test cases, preserving package-local Vitest roots, and translating machine-readable results back to scenarios.

## Goals / Non-Goals

**Goals:**
- Reuse the existing focused-spec parser, ownership checks, and evidence resolver.
- Execute exact evidence cases rather than whole files or workspaces.
- Support current specifications and one archive-readiness change scope.
- Deduplicate evidence shared by multiple scenarios.
- Produce stable scenario-oriented `PASS`, `SKIP`, and `FAIL` output.

**Non-Goals:**
- Replace Vitest, add a second scenario format, or infer evidence from test names.
- Add the focused runner to the full `npm run check` path and duplicate the workspace test suite.
- Provision optional external smoke-test services.
- Run planned evidence from unrelated active changes.

## Decisions

### Reuse the focused-spec graph

`planFocusedSpecRun` will live beside the existing parser. It will first run the same current/change validation, then collect scenarios only from the requested execution scope and resolve every evidence reference with `resolveEvidence`.

Alternative: parse Markdown again in the runner. Rejected because two parsers would drift on ownership, status, or evidence rules.

### Select Vitest cases by absolute file and source line

The resolver already returns the direct test call's source line. Vitest 4 supports multiple exact `file:line` filters, so each unique evidence target can be selected without fragile name-pattern quoting. Absolute paths avoid ambiguity between the repository working directory and package-local roots.

Alternative: pass `--testNamePattern`. Rejected because duplicate titles and regex escaping weaken exactness.

### Group by repository test root

Evidence below `packages/<name>/` runs with that package as the Vitest root; evidence below `scripts/` runs with `scripts/` as the root. Each group writes a JSON reporter result to a temporary file. Groups run sequentially to avoid multiplying the memory footprint of the existing package suites.

Alternative: one repository-root Vitest process. Rejected because package roots own their test discovery and configuration.

### Report resolved outcomes by scenario

The runner maps each selected assertion back by absolute file and resolved title. Shared evidence executes once and contributes the same outcome to every referencing scenario. A failed or missing assertion is `FAIL`; an intentionally skipped assertion is `SKIP`; otherwise it is `PASS`. `FAIL` and validation errors return a non-zero exit. `SKIP` remains visible but non-fatal so opt-in service smoke scenarios can coexist with deterministic local evidence.

### Keep the runner separate from `npm run check`

`test:focused-specs` is an explicit audit command. The existing full check already executes every workspace test, so adding focused execution there would repeat the same cases and materially increase verification time.

## Risks / Trade-offs

- **Vitest JSON shape changes:** the implementation validates required report fields and fails selected evidence if it cannot map a result.
- **Large filter lists:** evidence is grouped per root and deduplicated. The current repository is well below platform argument limits; batching can be added if that changes.
- **Optional service tests skip locally:** the report retains `SKIP` rather than presenting incomplete evidence as `PASS`.
- **New test roots:** evidence outside `packages/*` and `scripts/` fails planning until an explicit root convention is added.
