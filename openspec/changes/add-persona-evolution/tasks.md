## 1. Reconcile cross-change contracts

- [x] 1.1 Update the active `add-deepseek-harness-host` proposal and design to consume portable required-approval metadata through scoped `tools/pre-execute` and DSH ApprovalService
- [x] 1.2 Extend the active DSH capability spec and tasks with approval grant, rejection, unavailable-answerer, reload-cutover, and stale-closure scenarios
- [x] 1.3 Validate both active OpenSpec changes before editing implementation code

## 2. Portable required approval

- [x] 2.1 Add immutable `ToolApprovalRequirement` types to `extension-protocols` definitions and descriptors with strict bounded validation
- [x] 2.2 Preserve approval metadata through tool registration, listing, updates, notifications, bridge results, and OMP wire validation
- [x] 2.3 Add protocol tests for absent, valid, malformed, cloned, frozen, updated, and removed approval metadata
- [x] 2.4 Export only the intended approval contracts from `extension-protocols/src/index.ts`

## 3. Revision-aware Persona asset lifecycle

- [x] 3.1 Add public Persona asset reload event types carrying canonical URL, outcome, and observed exact-byte SHA-256 revision
- [x] 3.2 Compute bounded exact-byte revisions without changing trimmed non-empty context contribution behavior
- [x] 3.3 Emit revision-correlated success and failure outcomes while retaining last-good content and subscriber containment
- [x] 3.4 Add Persona tests for valid, invalid, unreadable, repeated, unrelated, and disposed revision-aware reload events
- [x] 3.5 Preserve existing identity and trait activation, ordering, diagnostics, and no-authoring behavior

## 4. Persona Authoring package foundation

- [x] 4.1 Create `packages/extension-persona-authoring` with strict NodeNext TypeScript, focused exports, peer Cordis, and only Persona/protocol dependencies
- [x] 4.2 Add its package-boundary manifest entry and the private OMP product dependency needed for Loader resolution
- [x] 4.3 Implement strict config normalization for unique active `trait:<name>` writable targets and bounded operational limits
- [x] 4.4 Reject identity, paths, globs, absent traits, symlinks, non-regular files, unknown fields, and duplicate targets before tool registration

## 5. Persona inspection and mutation engine

- [x] 5.1 Implement exact-byte bounded UTF-8 asset inspection and SHA-256 revision calculation behind logical Persona targets
- [x] 5.2 Implement `persona.inspect` schemas, read-only results, writable-state reporting, and structured bounded failures
- [x] 5.3 Implement same-session mutation serialization and adjacent exclusive interprocess locks with token-checked release and conservative stale recovery
- [x] 5.4 Implement locked revalidation, already-current detection, exact compare-and-swap conflict handling, and same-directory atomic replacement
- [x] 5.5 Preserve target mode, flush temporary bytes, remove temporary files on every failure path, and never accept filesystem paths from tool input
- [x] 5.6 Implement revision-correlated HMR wait, candidate failure rollback, timeout rollback, restoration confirmation, and unconfirmed-rollback diagnostics
- [x] 5.7 Register `persona.revise` with required approval, complete-replacement input, bounded rationale/evidence references, and stable structured error codes
- [x] 5.8 Ensure disposal drains queued mutations, releases only owned locks, and performs no autonomous/background work

## 6. Persona Authoring verification

- [x] 6.1 Add focused activation tests for exact writable policy, protected assets, optional memory absence, and plugin omission
- [x] 6.2 Add inspection tests for exact bytes, invalid UTF-8, oversize, symlink, non-regular, unknown, protected, and writable targets
- [x] 6.3 Add mutation tests for approval-gated handler entry, success, no-op retry, conflict, invalid replacement, and unrelated-file protection
- [x] 6.4 Add multi-session and multi-process tests proving at most one same-revision writer commits and uncertain locks fail closed
- [x] 6.5 Add HMR tests for matching success, matching failure, unrelated revision, timeout, successful rollback, and unconfirmed rollback
- [x] 6.6 Add a real Composition Runtime smoke scenario proving the next context resolution observes only an HMR-confirmed revision

## 7. OMP native approval projection

- [x] 7.1 Map required portable approval to OMP native `policy: "prompt"` with write tier and the portable reason
- [x] 7.2 Add deterministic bounded approval details containing portable tool name and exact parsed invocation arguments
- [x] 7.3 Include approval metadata in exact dynamic proxy replacement while preserving unrelated tools and current-descriptor stale-closure checks
- [x] 7.4 Add OMP adapter tests for grant, rejection, cancellation/unavailable UI, handler non-invocation, and continued session health
- [x] 7.5 Add OMP tests proving required approval still prompts in `yolo` and each grant authorizes only one invocation
- [x] 7.6 Add reload tests for adding, removing, and invalidly changing approval metadata without restarting the session
- [x] 7.7 Exercise the real project-local OMP extension through an approved `persona.revise` call and observe the changed trait on the next turn/context resolution

## 8. Mark Runtime Preset rollout

- [x] 8.1 Add `traits/evolving-profile.md` to the development Mark preset with a narrow initial statement that does not duplicate identity, engineering, concise, or user-memory content
- [x] 8.2 Select the trait and compose Persona Authoring with only `trait:evolving-profile` writable; keep shipped `standard` unchanged
- [x] 8.3 Update Mark preset fixtures and vertical scenarios to include the new trait without making Persona Authoring a generic runtime requirement
- [x] 8.4 After the package is available, apply the same trait selection and authoring row to the current user `~/.doppelganger/.runtime-presets/mark` without replacing identity or existing traits
- [x] 8.5 Start a fresh OMP session and verify the current user Mark preset exposes inspect/revise while identity, engineer, and concise remain read-only

## 9. Repository skill distribution

- [x] 9.1 Add `skills/persona/doppelganger-persona-evolution/SKILL.md` to this repository as the canonical source
- [x] 9.2 Encode `review` and `review --dry-run` workflows, stable-evidence criteria, memory-versus-Persona boundaries, one-revision limit, and stop conditions
- [x] 9.3 Verify the skill contains no executable authority, path-based fallback, fake chat approval, retry-after-rejection, or claim-before-HMR-success
- [x] 9.4 Verify the current project-scoped `npx skills add` command copies the skill to `.agents/skills`, which both OMP and DSH scan, and document that shared global installation is unsupported
- [x] 9.5 Exercise host-native invocation in OMP and DSH skill discovery fixtures using the same canonical skill ID
- [ ] 9.6 Publish the owning Doppelganger revision and verify installation from the public repository before documenting it as available

## 10. Documentation and final verification

- [x] 10.1 Update Persona, extension-protocol, OMP host, composition/reload, configuration, verification, status/scope, and README ownership prose in one change
- [x] 10.2 Document the trusted-plugin boundary, required-approval guarantee, logical writable policy, CAS/lock limits, HMR rollback, crash window, and absence of persistent history
- [x] 10.3 Document Mark setup, skill installation, OMP/DSH invocation syntax, dry-run, approval, conflict, and recovery outcomes without adding a host-specific command
- [x] 10.4 Run focused typechecks and tests for `extension-protocols`, `extension-persona`, `extension-persona-authoring`, `host-omp`, and `omp`
- [x] 10.5 Run live-spec, package-boundary, single-Cordis-root, repository-integrity, and documentation integrity checks
- [x] 10.6 Run `npm run check` after the real OMP smoke scenario and confirm no shipped `standard` behavior or unrelated host tool changed
