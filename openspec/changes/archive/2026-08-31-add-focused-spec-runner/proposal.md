## Why

Focused specifications currently verify that every live scenario points to a resolvable Vitest case, but engineers must still discover and invoke those tests manually. A repository runner should turn the existing `Scenario ID -> EVIDENCE` graph into an executable, auditable command for current specifications and archive-ready changes.

## What Changes

- Add a focused-spec evidence runner that validates live scenario ownership, resolves exact Vitest source locations, deduplicates shared evidence, and executes only the referenced cases.
- Add current-spec and `--change <name>` selection modes; change mode rejects planned or unresolved evidence before execution.
- Group evidence by its Vitest root so package-local configuration remains authoritative.
- Report each scenario as `PASS`, `SKIP`, or `FAIL`, with evidence-level diagnostics and a non-zero exit for failed or unresolved execution.
- Add repository scripts and verification documentation for local use.

## Capabilities

### New Capabilities
- `focused-spec-execution`: Selects and executes exact Vitest evidence referenced by current or change-scoped focused specifications and reports results by Scenario ID.

### Modified Capabilities
- None.

## Impact

- Affected code: `scripts/lib/focused-specs.mjs`, a new focused runner CLI, and focused-runner tests under `scripts/tests/`.
- Affected commands: root `package.json` gains `test:focused-specs` without changing the existing `npm run check` sequence.
- Affected documentation: focused-spec authoring and repository verification guidance.
- Dependencies: no new runtime or development dependency; execution uses the workspace Vitest installation.
