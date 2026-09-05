## Context

This change plans all sixteen findings in the delivered structural review. It deepens existing Modules: a smaller honest Interface should hide more Implementation policy and improve Locality, without introducing a competing framework. Source references below identify the reviewed state and must be re-grounded before implementation.

Evidence categories are deliberately distinct:
- **Observed**: isolated real-function/runtime probes showed host JSON coercion, SQLite-versus-YAML no-op disagreement, and query-triggered project writes. Temporary state was disposed and removed; personal runtime state was not used.
- **Source**: inspected control flow, imports, declarations, and test assertions establish structural friction, but not a runtime failure.
- **Risk**: an interleaving or restoration failure still needs a deterministic reproduction before a behavioral fix is claimed.

### Findings and acceptance ownership

| ID | Finding and reviewed source | Evidence | Decision / task section | Capability or existing evidence |
| --- | --- | --- | --- | --- |
| F01 | Evolution query calls resume sweep: `extension-evolution/src/service.ts:156,214,335` | Observed YAML change and revision 2 to 3 | D1 / 2 | `assistant-evolution` read-only queries and expiry |
| F02 | SQLite persists unchanged revision: `extension-evolution/src/global-store.ts:88,209` | Observed UNIQUE failure; YAML succeeds | D1 / 2 | `assistant-evolution` no-effect receipts |
| F03 | Host JSON stringify clone versus strict protocol clone: `host-omp/src/contracts.ts:128,283`; `extension-protocols/src/json-value.ts` | Observed NaN becomes null and undefined disappears only in host path | D2 / 3 | `extension-protocols`, `hosts/oh-my-pi` |
| F04 | Roster and activation duplicate Loader shape rules: `runtime-presets/src/index.ts:322`; `composition-runtime/src/patches.ts:73,178` | Source disagreement on IDs and grouped config | D3 / 4 | `runtime-presets` parity |
| F05 | File/Sentry/Pi schema and normalizer admission differ | Source; File path 4096 and Sentry dsnEnv 256 ceilings diverge | D4 / 5 | `runtime-logging`, `structured-inference` |
| F06 | `MemoryService.canonicalDatabase` leaks canonical SQL to vector coordinator | Source, `extension-memory/src/service.ts:439`; `extension-memory-vectors/src/coordinator.ts:148,201,283` | D5 / 6 | `memory-semantic-indexes` |
| F07 | Stable recall captured before asynchronous ranked search | Source plus unexercised stale-result risk, `extension-memory/src/protocol.ts:325` | D6 / 7 | `persona-memory` |
| F08 | Maintenance assertion is a tautology | Source and truth-table evaluation, `extension-memory-vectors/tests/conformance.ts:162` | D7 / 8 | `memory-semantic-indexes` |
| F09 | OMP conformance substitutes direct Runtime Host bridge | Source, `host-omp/tests/runtime-host-conformance.spec.ts:95,113,134` | D7 / 3 | `host-runtime-api` |
| F10 | Package guard misses side-effect and relative package imports | Source and scanner demonstration, `scripts/lib/package-boundaries.mjs:6,105` | D8 / 10 | `repository-integrity` |
| F11 | `OmpRpcMethods` is unused and stale | Source, `host-omp/src/contracts.ts:92` | D9 / 3 | Existing transport tests; no artificial new capability |
| F12 | Generation preparation repeats preflight and retains unread base/layers | Source, `composition-runtime/src/runtime.ts:79,208`; `patches.ts:266` | D9 / 4 | Existing patch/reload behavior |
| F13 | Sentry test-only mutable global client factory | Source, `extension-logging-sentry/src/client.ts:150` | D9 / 5 | Existing private-client and Loader lifecycle evidence |
| F14 | Canonicalizer ownership document is stale | Source, `docs/architecture/composition-and-reload.md:37,85-87` | D10 / 4, 11 | Existing public canonicalizer/parity tests |
| F15 | Shared CodeGraph discovery captures first caller's required flag | Source plus unexercised concurrent policy risk, `extension-codegraph/src/adapter.ts:132` | D11 / 9 | `codegraph-code-intelligence` |
| F16 | Rollback skips acceptance audit and republishes old entry diagnostics | Source plus unexercised restoration-failure risk, `composition-runtime/src/runtime.ts:431-473` | D12 / 4 | `composition-runtime` |

Paths in this table are relative to `packages/` unless prefixed with `scripts/` or `docs/`.

## Goals / Non-Goals

**Goals:**
- Give every reviewed rule one owner and migrate every affected caller/test in a clean cutover.
- Restore documented read-only, exact-revision, strict-value, and real-adapter contracts.
- Keep behavior stable for valid configurations, empty/optional compositions, approved preference authority, logging activation IDs, actor isolation, lexical fallback, and private exporter resources.
- Make the existing tests fail on plausible contract violations, not source rearrangement.

**Non-Goals:**
- No implementation in this proposal workflow; no edits outside this change directory.
- No generic storage/validation/RPC framework, vector superclass, new host API, second watcher, scheduler, importer policy, or tool.
- No file splitting based only on line count, formatting campaign, dependency update, release, deployment, personal configuration change, or unreported audit watch item.
- No memory context-engine features: progressive tiers, query expansion, checkpoints, extraction queues, hotness, summaries, or relations remain in `advance-memory-context-engine`.
- No opportunistic changes to memory mutation-replay semantics or unrelated dynamic-plugin/transport/resource findings not included in the delivered review.

## Decisions

### D1. Evolution queries return stored truth; mutations own targeted expiry

`list`, `inspect`, `selectReminder`, and context resolution perform no proposal writes, receipt insertion, directory creation, project write-lock acquisition, or expired-proposal sweeps. They return persisted status/revision/history. A stored `snoozed` proposal whose deadline elapsed can be reminder-eligible through the existing time-aware predicate; `status` filtering continues to mean stored status, so `dueOnly` can include an expired stored-snoozed proposal. Do not fabricate a revision or history entry merely to display an effective state.

Remove whole-ledger resume sweeps from mutation entrypoints as well. Preserve the seven-tool workflow by handling necessary deadline resumption only for the explicitly targeted proposal, inside the same SQLite transaction or project lock-and-atomic-write operation as the requested mutation. Verify the caller's expected revision against the original stored proposal before any internal transition. A new reminder delivery after expiry can atomically append the existing resume transition and delivery and record one receipt keyed by the original command digest. The returned revision accounts for every actual model transition. A failed requested operation rolls back resumption too. Exact operation replay returns its recorded result without repeating expiry logic.

Recognize valid unchanged outcomes, including deduplicated proposals and duplicate reminder delivery, before inserting new immutable revisions; store only the successful new operation receipt. Required revision and command validation still applies. Do not use broad `INSERT OR IGNORE` to hide a genuine history conflict. Distinct SQLite/YAML storage mechanics remain explicit; share model meaning, not a generic repository implementation.

**Alternatives rejected:** hidden background expiry writes add lifecycle machinery; synthesizing revised query results lies about durable state; a mandatory extra resume tool/step needlessly expands or disrupts the existing workflow. The selected design changes query side effects intentionally while preserving consent, exact revisions, and useful reminder delivery.

### D2. Protocol values validate before cloning or transport

Reuse the existing descriptor-aware, bounded protocol JSON implementation and expose only the narrow package contract needed by host callers. Host-owned envelope/version/profile/state validation remains in `host-omp`; portable JSON object semantics, supported values, cloning and digest inputs have one protocol owner. Migrate descriptor/schema, invocation-input, result and pre-transport projection clones, not just one decoder.

Reject non-finite numbers, undefined members, non-plain/coercible objects, accessors, symbols, sparse arrays, cycles and existing size/depth violations without running user coercion hooks. Preserve valid JSON values and established structured error categories. Unknown envelope fields remain rejected. Do not tighten intentional lifecycle observation serialization: host observations can still become explicitly bounded/truncated data before their normalized event enters strict protocol validation.

**Alternative rejected:** another host helper around `JSON.stringify` preserves the inconsistency and can erase invalid values before validation. No wire protocol version or method vocabulary changes are required.

### D3. Share Loader structure inward, not runtime authority outward

Keep reusable Loader entry-shape validation in the foundation `runtime-presets` package, following the existing dependency direction `composition-runtime -> runtime-presets`. Require nonblank IDs and names, well-formed supplied nested group entry arrays, and unique IDs over the same tree scope. Empty top-level lists stay valid. Use the same structural checks for roster health, loaded base trees and patch-inserted trees; source/path-labelled diagnostics remain available.

Composition Runtime still exclusively owns protected identities, layered target relationships, patch semantics, activation settlement, audit and rollback. A healthy roster descriptor means structural/import validity, not proof that dependencies will activate. Never import composition-runtime into runtime-presets or interpret ordinary opaque plugin config as Loader entries.

**Alternative rejected:** maintaining two validators and a parity-only test leaves two owners. The parity matrix remains useful, but both entrypoints must consume the same rule implementation.

### D4. Each plugin has one canonical configuration admission path

Use the existing MCP/CodeGraph local Standard Schema adapter pattern: Loader admission delegates to that plugin's canonical normalizer. Apply-time normalization may call the same implementation again; the objective is one policy owner, not an unsafe skip of boundary validation. Preserve frozen normalized output, unknown-key rejection, supported null/omission behavior and existing valid defaults; compare actual Loader and direct calls before removing Schemastery schema metadata/default materialization.

Carry the current stricter Loader ceilings into the File and Sentry normalizers: path/pathTemplate maximum 4096 characters, dsnEnv maximum 256 characters. Preserve documented units and all existing numeric, UTF-8 logger/environment/release, enum, paired-field and URL constraints. File path/pathTemplate exclusivity, exactly one activation UUID token, safe canonical UUID resolution, static-path compatibility and raw-session exclusion remain unchanged. Pi model selection, per-call credential ownership, timeout and immutable provider snapshots remain unchanged; normalization itself must not resolve credentials or perform provider/destination I/O.

**Alternative rejected:** a cross-package validation framework adds a second abstraction problem. Keep local schema adapters and the established plugin-specific policy.

### D5. Memory owns canonical projection persistence

Deepen `extension-memory/src/projection-store.ts` and its existing memory-owned semantic contracts to own canonical queue leasing/retry/acknowledgment, generation preparation/verification/activation/rollback/cleanup and status-count SQL. Expose bounded domain operations that validate their partition, generation and revision inputs; do not replace `canonicalDatabase` with an unrestricted callback receiving a database.

The vector coordinator remains responsible for scheduling, deadlines, external embedder/index I/O and cancellation. Keep transactions synchronous and short, with no external await under a database transaction. Revalidate canonical source before delivery and acknowledgment, and verify generation eligibility before pointer mutation. Remove raw database access and migrate coordinator plus every test consumer in the same change. Keep SQL/schema knowledge in memory, backend-specific storage in concrete adapters, and the kernel independent.

**Alternative rejected:** move the entire coordinator into memory or unify backend adapters. Both blur real responsibilities. No canonical schema or remote vector-format migration is planned.

### D6. One final automatic-recall decision

Move stable/ranked selection, deduplication, final canonical eligibility and whole-record budget/priority planning into a memory-owned recall operation. The protocol Adapter handles portable requests and renders approved contributions rather than independently orchestrating two validity lifetimes. Finish asynchronous semantic work before the final canonical pass and do not await between that pass and returning the snapshot.

A forgotten/inactive/expired record is omitted; a changed current revision is revalidated and used only if still eligible; a stale ranked semantic hit cannot introduce a now-invalid revision. Apply the final combined host budget with stable pinned preferences ahead of stable identity and ordinary ranked results, maintaining existing deterministic ordering and fallback. Explicit `memory.search` retains its existing contract.

Preserve the current main-spec authority rule: approved active preferences can contribute behavioral instructions even when query-ranked and unpinned. Pinning affects stable inclusion and priority, not whether an approved preference can instruct. Correct the narrower documentation sentence instead of silently changing policy. Ordinary records remain data; candidates do not enter recall.

**Alternative rejected:** keep two snapshots and only recheck one, or absorb the unimplemented context-engine roadmap. This is a whole-record correctness/locality change, not a new retrieval algorithm.

### D7. Tests cross the actual Interface

OMP conformance must drive `OmpAdapterSession` and the real child/RPC mapping, using deterministic fixture controls to register/replace tools and hold calls. Preserve shared semantic cases for isolation, empty protocols, capability rejection, stale revisions, approvals, cancellation/completion, lifecycle rejection, disposal and late callbacks. OMP always installs Actor Identity: verify explicit unbound and bound states through its real transport. Verify true provider absence separately through the direct protocol fixture, not through an invented OMP absence mode or a substituted bridge. This topology clarification was explicitly approved during apply; all other shared cases remain mandatory through OMP. Adapt test-support async convergence rather than faking a synchronous direct bridge as a transported adapter. Existing direct bridge tests remain correctly named composition/protocol evidence, not OMP transport certification; retain existing vertical and real project-local OMP checks.

For vector maintenance, a latch holds actual supported exclusive work open while another request overlaps. Assert exactly one underlying exclusive operation and the documented competing outcome; test the fast-completed/noop case separately. A shared test that accepts every possible result is removed, not replaced with timing sleeps or a source-text assertion. Preserve backend-specific implementations and real-service smoke ownership.

**Alternative rejected:** duplicate generic bridge tests under host labels or grow test-only production interfaces. Test controls belong in the existing fixture seams.

### D8. Reuse AST import discovery and one ownership manifest

Follow the TypeScript AST traversal already used by repository integrity. Inspect import declarations (including side effects and type-only imports), re-exports and string-literal dynamic imports. Resolve internal package root/subpath specifiers and relative workspace paths to the owning manifest package before comparing edges. Reject cross-package relative imports as violations of the repository package-name rule, even when the equivalent named dependency edge is allowed; report the canonical target owner. Preserve legal intra-package relative imports and allowed declared subpaths. Unsupported computed imports are not newly banned by this change; keep the current static-check scope explicit.

The same `scripts/package-boundaries.json` remains the only allowed-edge policy. Retain deterministic diagnostics and manifest checks. Use spelling-equivalent fixtures, including comments/string contents that are not imports, to avoid regex false positives.

**Alternative rejected:** extend the regex incrementally or maintain another dependency inventory. AST traversal costs more but uses a dependency already installed for repository tooling.

### D9. Delete weightless state and indirection

- F11: remove the unused `OmpRpcMethods` declaration after checking references again. Keep actual runtime route validation; do not add an unused typed RPC framework or change native todo transport.
- F12: derive flattened patches and effective tree from one existing preflight result; remove retained base/layers with no consumers. Preserve native patch replacement order, source-labelled failure order and immutable authored input. Do not replace duplicated computation with persistent caches or add tests asserting a helper call count.
- F13: call the existing concrete owned Sentry client factory directly in production. Remove the module-global factory/getter/test setter and migrate the one Loader lifecycle test to the existing injected transport or test-module mocking seam. Prove actual private-client registration/flush/close behavior; no new production factory setting.

These fail the deletion test: removing them eliminates complexity instead of distributing it to meaningful callers. Retain small Cordis facades and separate identity/trait/back-end adapters that perform actual policy or lifecycle work.

### D10. Document the real owners

Correct composition docs to identify public host-neutral canonicalization in composition-runtime and OMP serialized activation decoding in `host-omp/src/contracts.ts`; do not restore the removed kernel decoder. Update each affected topic owner as its implementation lands, including memory authority wording, stored-versus-effective Evolution snooze state, projection ownership, valid configuration limits and conformance topology. Historical audit/archived OpenSpec evidence stays historical; no new audit document is required.

### D11. CodeGraph shares facts, not the first caller's policy

First write a deterministic overlapping status/explore scenario for both call orders and unavailable/incompatible binaries. The shared discovery attempt returns facts or a bounded discovery diagnosis independent of a `required` flag. Status maps unsuccessful discovery to its diagnostic result; exploration maps it to the existing structured prerequisite error and does not run status/sync/explore commands afterward. Cache only a compatible successful immutable result; after failure a later independent request may retry. Disposal prevents late publication.

**Alternative rejected:** separate status/explore discoveries duplicate subprocess work; caching the first caller's exception makes the Interface depend on scheduling.

### D12. Audit rollback using the same acceptance rule

First exercise candidate failure followed by restoration with pending/failed entries or a thrown restoration update. Candidate and restored trees use the same settle-and-audit acceptance rule. Log restoration completion only after a clean audit. On successful restoration preserve the prior effective revision and expose candidate failure diagnostics. On restoration failure retain truthful observed entry diagnostics and an explicit restoration failure within the existing failed-reload diagnostic envelope, aggregating candidate/restoration errors. If audit itself cannot complete, report that inability rather than restoring a stale healthy snapshot.

Keep the runtime owner alive for explicit retry/disposal; do not assert last-good usability unless its restoration audit succeeded, and do not add an automatic retry loop. Existing host diagnostic projection remains generic; no extra protocol version is planned.

**Alternative rejected:** unconditionally treat the previous diagnostics as proof of the restored tree. The additional audit runs only on failure and is cheaper than misleading operational state.

## Risks / Trade-offs

- [Boundary tightening] Malformed values previously coerced or weakly admitted will fail → preserve valid inputs and established limits; add parity matrices and document intentional rejection changes.
- [Expiry representation] Read-only queries expose persisted expired-snoozed status → explicitly distinguish stored status from due eligibility and atomically handle targeted delivery with the inspected revision.
- [Mutation atomicity] Resume plus delivery and no-effect receipts span multiple rows/history items → keep one transaction/lock commit, test failure rollback and exact replay across both stores.
- [Public memory seam removal] External users of raw canonicalDatabase would break → mark the clean cutover, migrate every in-repository caller, and document the memory-owned replacement; no alias.
- [Conformance runtime cost] Real transported cases require more fixture work → use controlled child startup and event/latch convergence; keep protocol-only identity assertions at their actual owner.
- [Refactor hides policy] A generic abstraction could recreate leaked behavior → retain domain-specific operations, explicit backend differences and a single owner per rule.
- [Unreproduced risk] F07/F15/F16 might have additional lifecycle constraints → add the named deterministic reproduction first; do not claim an observed bug or suppress an exception without evidence.
- [Overlapping active deltas] Full MODIFIED blocks can overwrite newer requirements → compare the effective implemented baseline before apply and again before sync; preserve unrelated scenarios and IDs.

## Migration Plan

1. Re-ground source references, exported-symbol consumers, owning docs and active deltas. Preserve current uncommitted work. This proposal does not execute these migrations.
2. Implement the task slices against the already implemented core/logging/inference baseline. Source-independent slices may proceed concurrently; serialize edits to shared protocol/host and memory/coordinator seams.
3. Land each behavioral reproduction, owner-local change, caller/test cutover and owning-doc update together. No DB/YAML/vector migration, tool-inventory expansion, or personal preset mutation is expected.
4. Keep `advance-memory-context-engine` separate and rebase its overlapping recall/projection design and MODIFIED blocks after this change, through its own planning update. Do not run its tasks here. Deferred DSH work may consume the improved conformance fixture later but is not implemented here.
   Apply handoff: the context-engine plan must rebase its recall orchestration on `MemoryService.automaticRecall` and its canonical projection changes on `MemoryProjectionStore`, not restore `canonicalDatabase` or a protocol-owned stable snapshot. Its overlapping requirement blocks must retain this change's final eligibility, approved-unpinned-preference authority, and bounded generation-transition guarantees. The separate plan and its implementation remain untouched here.
5. Before synchronizing this change, promote the already implemented `add-proactive-evolution-signals` capability baseline and reconcile implemented core/logging deltas through separately authorized sync/archive workflows. `structured-inference` is not currently a main-spec directory: this change adds only the independent config-parity requirement under that existing active capability and does not recreate its whole specification.
6. Run affected checks, real isolated OMP behavior, required full repository check and strict selected-change evidence validation. Replace every `planned:` marker with actual passing unconditional test evidence before implemented handoff.
7. Roll back code and its same-change documentation as a coherent unit if verification fails; durable formats remain unchanged. Do not undo unrelated user work or rely on compatibility shims. Newly corrected query/validation semantics should not be reverted piecemeal while their callers remain migrated.

## Open Questions

No user-facing scope decision is left open. Stored-status read semantics, targeted atomic expiry handling, approved-preference authority, direct-normalizer tightening and failed-restoration reporting are explicit above. Remaining unknowns are implementation evidence gates: reproduce the identified interleavings, confirm the current Loader schema adapter behavior, and re-check the active specification baseline before mutation. A discovery requiring a new schema migration, public tool, host protocol dimension or material behavior beyond these decisions must return to planning rather than silently expanding this change.
