## Why

A fresh-worktree review found correctness, authority, lifecycle, and repository-integrity defects in the domain-neutral core that are not covered by the current green package suites. The highest-risk defects allow data-authority context to be projected as host system instructions and allow committed verification sources to be absent from a clean checkout, so the core needs a coordinated hardening change before further host expansion.

## What Changes

- Preserve `instruction` and `data` authority through context assembly and host projection so data contributions cannot be promoted into host system instructions.
- Make the repository verification and security-audit implementation reproducible from a clean checkout by tracking every source module used by root scripts and tests and preventing ignore rules from hiding them.
- Make Composition Runtime activation acquire watcher ownership transactionally and exhaust attempted-session cleanup when registration fails.
- Apply Runtime Preset selection precedence before loading lower-precedence documents, while retaining strict validation for every document that can affect the winning choice.
- Validate bare package imports using Node-resolvable targets, including packages without an `exports` map, so nonexistent deep imports make a preset broken before activation.
- Return structured configuration diagnostics for malformed patch entries instead of allowing validation helpers to throw incidental JavaScript type errors.
- Close lifecycle event-kind and payload validation, including prototype-inherited names and unsupported event variants.
- Contain tool-catalog observer failures without turning a committed registry mutation into a caller-visible registration failure.
- Define and enforce owner-scoped active-call behavior when a tool set is replaced or disposed so removed implementations cannot continue as successful current calls.
- Deepen the context, tool-owner, composition-session, preset-resolution, and closed-value validation modules while preserving the existing package seams and clean public cutover.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `repository-integrity`: require every executable verification helper to be committed, available in a fresh checkout, and exercised by the root verification commands.
- `extension-protocols`: preserve context authority, close lifecycle validation, contain catalog observers, validate JSON values consistently, and bind active calls to tool ownership.
- `runtime-presets`: honor selection precedence without lower-precedence parse failures and classify unresolvable package imports as broken presets.
- `composition-runtime`: make watcher acquisition and failed activation cleanup transactional and preserve structured patch diagnostics.
- `host-runtime-api`: retain authority through the adapter-facing context result and define removed-owner active-call semantics.
- `hosts/oh-my-pi`: project instruction-authority and data-authority context through distinct host-safe paths instead of appending both as undifferentiated system prompt text.

## Impact

- Affected packages: `runtime-presets`, `composition-runtime`, `extension-protocols`, and `host-omp`; repository checks under `scripts/` are also affected.
- Existing context result and projection semantics change. This is a clean cutover within the private `0.0.0` workspace: all in-repository callers and conformance fixtures will migrate together with no compatibility alias.
- Tool replacement or owner disposal may now cancel in-flight calls that previously completed after removal; the exact structured result and race behavior will be specified and tested.
- No feature-domain behavior moves into the kernel, no new package dependency edge is introduced, and SQLite remains unchanged except for any test-only evidence needed to prove unaffected storage behavior.
