# Focused Specs

Focused Specs are small executable interpretations of behavior at the product boundary. Protect the smallest outcome that matters while leaving implementation free to change.

## OpenSpec shape

Every live scenario under `openspec/specs/` has one authoritative owner and this shape:

```markdown
#### Scenario: Runtime operator activates a composition
- **ID**: `runtime.activation.arbitrary-composition`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates arbitrary modules`
- **WHEN** the operator supplies a valid composition
- **THEN** the runtime activates it in an isolated session
```

- Use exactly one `WHEN` request and one `THEN` user-visible or durable outcome.
- Give independently failing outcomes separate scenarios. Keep observations together only when they prove one indivisible transaction, cleanup, rollback, or isolation boundary.
- Use one repository-unique lowercase dotted ID. Preserve it when ownership moves; assign a new ID only to an independently failing behavior.
- Remove superseded live formulations after moving or merging ownership. Archived changes remain historical and are not live owners.

## Executable evidence

Each `EVIDENCE` row uses `<repository-relative *.spec.ts path>::<static test title>`. The target must be one direct, unconditional `it(...)` or `test(...)` case with a string-literal title. Skipped, conditional, todo, parameterized, duplicate, missing, absolute, and repository-traversing targets are invalid.

Evidence asserts only the promised contract. Match structured values from the expected side and ignore unrelated additive fields or events. Require exact or empty results only when totality is itself the outcome, such as no emitted event, record, file mutation, or projected capability.

One test may evidence multiple scenarios only when its assertions independently prove each linked outcome. Multiple `EVIDENCE` rows are allowed when one scenario genuinely needs more than one boundary observation.

## Active changes

Active delta specs under `openspec/changes/<change>/specs/` follow the same shape. An added or modified scenario may temporarily use:

```markdown
- **EVIDENCE**: `planned:scripts/tests/example.spec.ts::proves the new behavior`
```

Standard validation accepts syntactically valid planned evidence while implementation is in progress. Before archive, replace every `planned:` reference with an existing executable target and run:

```sh
npm run check:focused-specs:change -- <change-name>
```

The strict command rejects planned or unresolved evidence. Archived changes under `openspec/changes/archive/` are excluded.

## Running evidence

Run every unique Vitest case referenced by current specifications and report the result for each Scenario ID:

```sh
npm run test:focused-specs
```

Run only the implemented evidence declared by one active change after strict current-plus-change validation:

```sh
npm run test:focused-specs -- --change <change-name>
```

The runner resolves each evidence target to an exact source line, deduplicates tests shared by multiple scenarios, and groups execution under the owning `scripts/` or `packages/<name>/` Vitest root. `PASS` means every linked assertion passed; `SKIP` keeps unavailable opt-in service evidence visible without claiming success; `FAIL`, unresolved evidence, and invalid ownership return a non-zero exit.

## Review

- Does one live capability own the behavior?
- Can the outcome fail independently from neighboring scenarios?
- Does the `THEN` explain why all linked evidence belongs together?
- Does each expected field, event, identity, effect, or exact value protect that outcome?
- Would additive fields, unrelated events, harmless copy or layout changes, and implementation refactoring leave the scenario valid?