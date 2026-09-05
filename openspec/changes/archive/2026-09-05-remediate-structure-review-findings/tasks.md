## 1. Baseline and ownership

- [x] 1.1 Re-ground F01–F16 from the design traceability table against current source, owning docs and active deltas; preserve user work and record any material divergence before implementation instead of expanding scope.
- [x] 1.2 Confirm the implemented core/logging/inference baseline and the separate `advance-memory-context-engine` overlap; preserve full capability paths and scenario IDs, and record the prerequisite baseline promotion before this change is synchronized without archiving or rewriting another change implicitly.
- [x] 1.3 Resolve every consumer of the exported contracts being changed, using LSP references when available and scoped repository search otherwise; keep one integration owner for protocol/host edits and one for memory/coordinator edits when independent sections run concurrently.

## 2. Evolution read semantics and unchanged commands — F01, F02

- [x] 2.1 Turn the already demonstrated query-write and SQLite/YAML no-op disagreements into the planned unconditional storage/protocol regression cases in `specs/assistant-evolution/spec.md`, including new operation IDs, duplicate deliveries, exact replay and changed-digest rejection.
- [x] 2.2 Remove query and pre-command whole-ledger expiry sweeps; make list/inspect/reminder/context return persisted status and revision, use existing time-aware due eligibility, preserve stored-status filtering, and prove no proposal rows, receipts, YAML bytes, directories or write locks change on reads.
- [x] 2.3 Implement targeted atomic deadline resumption only when an explicit applicable mutation needs it, validating the originally inspected revision first; preserve the original command digest and seven-tool workflow, and prove failed mutation rolls back resumption and never changes neighboring proposals.
- [x] 2.4 Make both stores distinguish unchanged successful model outcomes from new revisions, commit receipt-only no-ops, and retain real revision/history constraint failures rather than suppressing them with broad conflict-ignore SQL.
- [x] 2.5 Verify expiry-aware reminder selection, future-snooze/cooldown exclusion, targeted resume-plus-delivery, current-revision conflicts, no-op delivery after expiry, exact replay after later state changes, and atomic failure against both SQLite and project YAML using the existing disposable fixtures.
- [x] 2.6 Update `docs/features/evolution.md` for persisted versus time-derived snooze state, explicit targeted mutation ownership and unchanged-result receipts; run focused Evolution storage/protocol/signal integration checks to preserve the implemented proactive pipeline.

## 3. Strict portable values and actual OMP conformance — F03, F09, F11

- [x] 3.1 Add the planned OMP JSON admission cases and reuse protocol invalid-value fixtures to cover non-finite numbers, undefined members, custom coercion, accessors, symbols, sparse arrays, cycles, depth/byte bounds, valid-value parity and rejection before approval or dispatch.
- [x] 3.2 Expose the narrow existing protocol-owned JSON validation/cloning contract and migrate all host descriptor/schema/input/result and pre-transport projection clones to it; keep OMP envelopes, versions, state errors and capability checks host-owned, and preserve bounded lifecycle observation projection.
- [x] 3.3 Remove the unused `OmpRpcMethods` declaration after reference confirmation, without adding a replacement unused map, changing route vocabulary, broadening the host root exports or altering the native todo route.
- [x] 3.4 Replace direct-bridge substitution in OMP conformance with the actual `OmpAdapterSession` plus child/RPC mapping and deterministic fixture controls; retain correctly labelled direct protocol/composition coverage and avoid new production test-control interfaces.
- [x] 3.5 Run the complete common semantic matrix through the real adapter seam: isolation, empty protocols, closed capabilities, real OMP unbound/bound actor states with separate protocol-level provider-absence evidence, atomic catalog replacement, stale revisions, one-shot approval/replay, cancellation/completion, undeclared lifecycle, active-call disposal and late callbacks; provide the three planned unconditional evidence cases in `specs/host-runtime-api/spec.md` without weakening the rest of the matrix.
- [x] 3.6 Update `docs/architecture/protocols.md`, `docs/hosts/oh-my-pi.md` and conformance guidance to distinguish strict values from bounded observations and real adapter proof; run affected protocol, host adapter, extension, transport and vertical checks.

## 4. Loader structure, generation preparation and rollback — F04, F12, F14, F16

- [x] 4.1 Add the planned roster/activation structural parity cases for missing or duplicate IDs, malformed supplied nested group arrays, empty trees and opaque non-group config, preserving source-labelled diagnostics and no plugin side effects for malformed trees.
- [x] 4.2 Centralize portable Loader structure validation in `runtime-presets` and migrate roster health plus base/inserted-entry validation callers; keep protected identities, patch-target rules and activation audit in Composition Runtime without introducing a reverse package dependency.
- [x] 4.3 Produce flattened patches and the effective generation from one preflight result, remove unread retained base/layers, and run existing ordering, replacement, malformed-target and authored-input immutability behavior checks rather than helper-call-count tests.
- [x] 4.4 Create deterministic F16 reproduction cases for restoration with pending/failed entries and thrown restore updates before changing rollback handling; preserve existing successful candidate and successful rollback cases.
- [x] 4.5 Apply the same settle-and-audit acceptance rule to restoration, emit successful rollback only after audit, aggregate candidate/restoration failures, and expose observed failed-restoration diagnostics while preserving explicit retry/disposal ownership.
- [x] 4.6 Correct public canonicalizer and host-owned serialized-decoder documentation in `docs/architecture/composition-and-reload.md`; update configuration/overview explanations where needed and run focused roster, patches, canonicalization, activation, reload and disposal checks without resurrecting a kernel host decoder.

## 5. Canonical plugin configuration and direct Sentry construction — F05, F13

- [x] 5.1 Add direct-versus-actual-Loader configuration parity cases for File, Sentry and Pi, including omitted/null/default handling, unknown fields, boundary values and no validation-time credential/provider/destination side effects.
- [x] 5.2 Route File and Sentry Loader admission through each existing canonical normalizer using the repository Standard Schema convention; retain all defaults, severity/filter rules and bound units, enforce the existing 4096-character file path/template and 256-character dsnEnv ceilings on direct calls, and preserve activation UUID/template/static-path behavior.
- [x] 5.3 Route Pi Loader admission through its canonical normalizer with unchanged installed-model/custom-route, paired fields, timeout/token/string limits, reasoning and per-call credential rules; prove existing immutable generation and cancellation behavior remains intact.
- [x] 5.4 Remove the mutable Sentry client factory, getter and test setter; make production construction direct and migrate the affected Loader lifecycle test to the existing transport or test-module seam while proving real private-client registration, accepted-record drain, bounded flush and close.
- [x] 5.5 Update `docs/features/runtime-logging.md` and the inference section of `docs/architecture/protocols.md`; run focused File, Sentry, Pi and composition logging/inference suites, retaining exporter omission neutrality and completed activation-log correlation coverage.

## 6. Memory-owned canonical projection persistence — F06

- [x] 6.1 Add the planned behavioral cases for post-I/O canonical acknowledgment revalidation and rejected obsolete/mismatched generation transitions, using current temporary memory/coordinator fixtures.
- [x] 6.2 Deepen `extension-memory/src/projection-store.ts` and existing memory-owned contracts to own canonical leasing/retry/acknowledgment, generation preparation/verification/activation/rollback/cleanup and status-count persistence with synchronous bounded transactions and no external I/O under a transaction.
- [x] 6.3 Migrate the vector coordinator and every test/caller from `canonicalDatabase` to the bounded memory-owned operations, remove unrestricted database access without an alias or callback escape hatch, and retain coordinator scheduling/deadlines plus concrete backend ownership.
- [x] 6.4 Update `docs/features/memory.md` and `docs/operations/semantic-memory.md`; verify transactional outbox failure, stale-work convergence, hard deletion, generation cutover/rollback, lexical fallback and disposal through the existing memory/coordinator tests and typechecks.

## 7. Finally revalidated automatic recall — F07

- [x] 7.1 Reproduce the stable-snapshot interleaving with controlled pending semantic work and correction/forget/expiry/status changes; add the planned combined-budget, deduplication and approved-unpinned-preference authority cases without introducing timing sleeps.
- [x] 7.2 Move whole-record stable/ranked assembly into one memory-owned recall path that finishes asynchronous work before final canonical validation, deduplicates and budgets the combined selection deterministically, and leaves no asynchronous gap before returning it.
- [x] 7.3 Reduce the memory protocol contribution adapter to request translation and rendering of the final selection; preserve explicit `memory.search`, stable-profile membership, preference instruction authority, ordinary-data authority, lexical fallback and optional-provider behavior.
- [x] 7.4 Reconcile `docs/features/memory.md` authority wording with current approved-preference semantics; run memory search/protocol tests and real OMP context projection coverage, then record the separate context-engine plan's required rebase without implementing its future features.

## 8. Meaningful maintenance conformance — F08

- [x] 8.1 Replace the tautological assertion with deterministic fixture controls that hold real supported exclusive work open; assert one underlying operation and the documented competing `already-running` outcome without production-only test switches.
- [x] 8.2 Add the planned unconditional evidence for genuinely overlapping maintenance and separately completed/noop operations, apply the strengthened shared checks across all supported adapters, and retain explicit unsupported-operation and real-service smoke coverage.
- [x] 8.3 Run coordinator and backend conformance suites and update `docs/operations/semantic-memory.md` and verification guidance so claims match the exercised maintenance ownership and fixture topology.

## 9. Caller-independent CodeGraph discovery — F15

- [x] 9.1 Reproduce overlapping status/explore discovery in both call orders for missing and incompatible binaries using the existing controlled process fixture; assert each caller's own outcome and no index work after failed prerequisites.
- [x] 9.2 Share only factual discovery results/diagnoses, apply status versus exploration failure policy after awaiting them, retain success-only generation caching, and preserve retry after failure plus disposal-time late-result rejection.
- [x] 9.3 Add the planned failure/retry/disposal evidence and update `docs/features/codegraph.md`; run focused CodeGraph discovery, queue, synchronization and disposal coverage without changing supported CLI versions or adding installation behavior.

## 10. Syntax-aware package dependency enforcement — F10

- [x] 10.1 Add spelling-equivalent guard fixtures for named, side-effect, type-only, re-export and literal dynamic imports, allowed package subpaths, legal intra-package paths, forbidden cross-package relative paths, and non-import comments/strings.
- [x] 10.2 Reuse the existing TypeScript AST import traversal convention and resolve source specifiers to workspace ownership before applying `scripts/package-boundaries.json`; preserve manifest validation, reject relative package crossings, and keep deterministic diagnostics without a second edge policy or new dependency.
- [x] 10.3 Run script fixture tests and the real package-boundary check; update `docs/architecture/overview.md` and `docs/operations/verification.md` to accurately state syntax coverage and the unchanged static-check limits.

## 11. Integrated evidence and documentation

- [x] 11.1 Verify every F01–F16 row maps to a completed implementation task and an observed behavior check or justified internal-removal review; confirm no unrelated watch item, new tool, storage migration, host protocol dimension or context-engine feature entered the change.
- [x] 11.2 Update every affected owning document alongside code, check public exports and all caller migrations, and update `docs/README.md` only if topic ownership or document paths changed; preserve historical audit and archived OpenSpec evidence.
- [x] 11.3 Exercise the real project-local OMP extension with disposable Runtime Presets and state for strict invocation values, adapter lifecycle/conformance, automatic recall, reload/failed-restoration diagnostics and logging continuity; dispose sessions/children/storage before removing temporary fixtures and leave personal state untouched.
- [x] 11.4 Run all affected package typechecks and focused suites, then `npm run check`; run applicable existing optional backend smokes only against disposable configured services and report unavailable external evidence explicitly rather than substituting mock success.
- [x] 11.5 Replace every `planned:` evidence reference in this change with its realized unconditional static test target, run `npm run check:focused-specs:change -- remediate-structure-review-findings`, execute `npm run test:focused-specs -- --change remediate-structure-review-findings`, and run `openspec validate remediate-structure-review-findings --strict` before implemented handoff; keep baseline synchronization/archive separately authorized and preserve newer active-delta content during reconciliation.
