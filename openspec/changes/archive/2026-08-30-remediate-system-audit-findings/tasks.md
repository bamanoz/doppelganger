## 1. Prerequisite and Contract Baseline

- [x] 1.1 Complete, sync, and archive `strengthen-persona-memory` through its own OpenSpec workflow before changing semantic-memory lifecycle code.
- [x] 1.2 Confirm `openspec/specs/memory-semantic-indexes/spec.md` exists after that archive and validate this change against the resulting main spec tree.
- [x] 1.3 Re-run the non-archived legacy-contract search and record the exact runtime-owned Persona-selection requirements and obsolete identifiers that this change must remove without touching archived evidence.

## 2. Composition Runtime Disposal and Canonicalization

- [x] 2.1 Add regressions where one session plugin disposer throws while sibling effects, config watches, session ownership, and an owned runtime root must still be released.
- [x] 2.2 Add regressions for multiple active sessions, caller-owned roots, repeated session disposal, and repeated runtime disposal after an aggregate cleanup failure.
- [x] 2.3 Implement exhaustive ordered cleanup in `composition-runtime`, unregister sessions in a `finally`-equivalent path, and report collected failures only after all reachable cleanup stages settle.
- [x] 2.4 Add table-driven tests proving direct Composition Definition and serialized activation inputs receive equivalent path, patch, immutability, optional-field, and diagnostic normalization.
- [x] 2.5 Introduce one package-private composition canonicalizer, migrate `definition.ts` and `serialized-activation.ts`, and remove the duplicate normalization helpers without changing public types.
- [x] 2.6 Run the composition-runtime typecheck and focused activation, reload, rollback, canonicalization, and disposal tests.

## 3. Transactional Embedder and Vector Acquisition

- [x] 3.1 Add deferred-loader tests for local embedder close during acquisition, post-load artifact-validation failure, accelerator failure before CPU fallback, and exactly-once candidate close.
- [x] 3.2 Refactor local embedder loading to retain a private candidate, close every failed or late candidate, publish active device/runtime only after validation and an open-state check, and keep close idempotent.
- [x] 3.3 Add deferred-runtime/pool tests for pgvector close during runtime loading, close during schema/table setup, setup failure, retry after failed initialization, and no published partial state.
- [x] 3.4 Refactor pgvector initialization to keep runtime module and pool local until setup commits, end every owned pool candidate on failure or late close, and clear retryable initialization state safely.
- [x] 3.5 Add Qdrant tests for first client-factory rejection followed by successful retry, concurrent retry sharing, close during client creation, and close during collection metadata validation.
- [x] 3.6 Refactor Qdrant client and collection acquisition to clear rejected current promises, close owned late clients, recheck open state before initialization commit, and preserve retryability.
- [x] 3.7 Extend the shared vector conformance suite with disposal-during-initialization and retryable-initialization cases applicable to each backend.
- [x] 3.8 Run focused embedder/vector typechecks and tests, real local inference, and available disposable Qdrant/pgvector backend smoke scenarios.

## 4. JSON-RPC Notification Failure Containment

- [x] 4.1 Add a protocol regression with one rejecting and one successful notification observer followed by a successful request/response and notification cycle.
- [x] 4.2 Add an optional bounded notification-observer error sink to `FramedJsonRpcPeer`, settle observers independently, and contain sink failures without changing framed wire messages or fatal decoder/stream behavior.
- [x] 4.3 Route observer diagnostics from process and child peer owners into their existing bounded diagnostic/logging paths without marking the healthy child or transport failed.
- [x] 4.4 Run focused protocol, child, process, adapter failure-isolation, and real project-local OMP extension scenarios.

## 5. Observable Reload Tests and Persona Asset Lifecycle

- [x] 5.1 Add package-private Persona asset-loader tests for canonical URL matching, non-empty reads, serialized successful reloads, failed-reload last-good retention, bounded diagnostics, and lifecycle disposal.
- [x] 5.2 Implement the shared Persona file-backed asset mechanism and migrate identity and traits while leaving source naming, priorities, trait order, and contribution authority explicit in their plugins.
- [x] 5.3 Replace arbitrary sleeps in composition reload tests with exact revision, reload-diagnostic, or lifecycle-transition barriers before issuing each subsequent filesystem mutation.
- [x] 5.4 Replace the trait failed-reload sleep with an observable diagnostic/reload barrier and verify the last valid contribution remains active.
- [x] 5.5 Replace child-integration timing assumptions with RPC responses, runtime-changed notifications, process-exit signals, and bounded promise barriers; retain timeouts only as failure bounds.
- [x] 5.6 Run the affected reload/HMR test files repeatedly under full-workspace concurrency and verify no timeout extension is used to hide missed events.

## 6. Intentional `host-omp` Public Surface

- [x] 6.1 Use LSP references and package manifests to classify every current `host-omp` root export as ordinary consumer API, intentional subpath API, or package-private implementation.
- [x] 6.2 Define the retained root exports and any required transport/child subpath exports in `package.json`, with focused import-contract tests for each supported entrypoint.
- [x] 6.3 Migrate all repository callers and tests to the retained root or explicit subpaths, remove obsolete root re-exports and aliases, and preserve the RPC protocol version and wire contracts.
- [x] 6.4 Run the host-omp typecheck, package tests, project-local extension load, child transport, failure, dynamic-tool, and shutdown scenarios through the final exports.

## 7. Executable Repository Integrity

- [x] 7.1 Add one JSON package-boundary manifest listing every workspace package and allowed internal package dependency, including schema validation and deterministic ordering.
- [x] 7.2 Refactor `check-package-boundaries.mjs` to consume the manifest and fail on missing/unknown packages, forbidden manifest dependencies, and forbidden source imports.
- [x] 7.3 Add focused checker fixtures for allowed edges, forbidden edges, an unregistered new package, malformed manifest data, and deterministic diagnostics.
- [x] 7.4 Add a network-free documentation/live-spec integrity script that validates the docs index, local Markdown links, removed live-document references, obsolete identifiers, and narrowly scoped legacy Persona-selection rules while excluding archived OpenSpec evidence.
- [x] 7.5 Add integrity-script fixtures proving broken links, unindexed docs, active legacy names, and runtime-owned Persona selection fail while extension-owned Persona `instanceId` configuration passes.
- [x] 7.6 Add the documentation/live-spec integrity command to `npm run check` and update repository verification output to identify each integrity stage.

## 8. Dependency Security and Freshness Policy

- [x] 8.1 Re-run registry-backed production audit and dependency freshness checks, determine whether compatible fixed `@huggingface/transformers`, `onnxruntime-node`, `adm-zip`, and `sharp` versions exist, and retain the raw evidence.
- [x] 8.2 If a compatible fixed dependency chain exists, upgrade it and verify cache validation, offline behavior, CPU fallback, dimensions, multilingual similarity, and one real local embedding; otherwise retain the pinned chain without pretending remediation.
- [x] 8.3 Add a reviewed production-advisory baseline containing advisory identity, dependency path, review date, fix availability, and deployment restriction without credentials or a clean-audit claim.
- [x] 8.4 Add `check:security` to run the production audit, print every unresolved advisory, and fail on new advisories, baseline drift, or a newly compatible fix while keeping ordinary `npm run check` network-free.
- [x] 8.5 Add deterministic unit fixtures for unchanged reviewed advisories, newly introduced advisories, resolved advisories, and `fixAvailable` transitions.

## 9. Runtime Preset and Persona Specification Cutover

- [x] 9.1 Remove every non-archived requirement or active artifact that assigns Persona Instance, trait, project identity, instance home, or storage selection to generic runtime configuration or Runtime Session metadata.
- [x] 9.2 Preserve explicit/project/user Runtime Preset precedence and migrate remaining live OMP scenarios and terminology from implicit Persona activation to generic Runtime Preset activation where Persona is not the subject.
- [x] 9.3 Confirm Persona Loader configuration remains the sole owner of stable instance/principal identity, identity assets, ordered traits, and Persona-specific state, with no compatibility parser or alias for removed selection fields.
- [x] 9.4 Validate every delta operation against the current main capabilities and verify archived OpenSpec changes remain byte-for-byte historical evidence.

## 10. Documentation and Audit Closure

- [x] 10.1 Update `docs/architecture/composition-and-reload.md` for exhaustive cleanup and shared canonicalization, and update `docs/features/persona.md` for the shared asset lifecycle and extension-owned activation.
- [x] 10.2 Update `docs/hosts/oh-my-pi.md` for observer containment, generic Runtime Preset terminology, and the retained package entrypoints.
- [x] 10.3 Update `docs/operations/semantic-memory.md` and `docs/operations/verification.md` for transactional acquisition, trusted-artifact restrictions, the security audit baseline, and the new integrity checks.
- [x] 10.4 Update `docs/architecture/overview.md`, `docs/README.md`, `README.md`, and `AGENTS.md` to reference the machine-readable boundary manifest and avoid duplicating its executable edge list.
- [x] 10.5 Add a dated follow-up section to the 2026-08-30 audit recording which findings were fixed, which advisories remain, and the exact verification evidence without rewriting the original findings.

## 11. End-to-End Verification

- [x] 11.1 Run focused typechecks and behavior tests for every changed package after its slice, including cleanup-failure, initialization-race, notification-observer, HMR, and package-export regressions.
- [x] 11.2 Exercise the real project-local `.omp/extensions/doppelganger.ts` flow for activation, context, dynamic tools, valid reload, invalid rollback, child failure, observer failure, and bounded shutdown.
- [x] 11.3 Run local embedding and every available disposable Chroma, Qdrant, and pgvector smoke; explicitly record unavailable external-service smokes rather than substituting mocks.
- [x] 11.4 Run `npm run check` and verify all workspace typechecks/tests, single-Cordis enforcement, package boundaries, documentation inventory, links, and live-spec legacy checks pass.
- [x] 11.5 Run `npm run check:security`, record the exact unresolved/fixed result, and confirm no output claims a clean production dependency set when reviewed advisories remain.
- [x] 11.6 Run `openspec validate remediate-system-audit-findings --type change --strict --no-interactive`, confirm every task and acceptance scenario is covered, and prepare the completed change for review without archiving it prematurely.
