# System audit — 2026-08-30

## Scope and evidence

The audit covered all nine workspace packages, package manifests and public exports, dependency-direction enforcement, Cordis lifecycle and reload paths, OMP RPC/process behavior, Persona assets, canonical and semantic memory, tests, README/AGENTS/OpenSpec documentation, and production dependency advisories.

Observed evidence:

- workspace TypeScript diagnostics: no issues;
- package graph: acyclic and consistent with `scripts/check-package-boundaries.mjs`;
- package tests and repository invariants are covered by `npm run check`;
- Chroma, Qdrant, and pgvector real-service smoke suites passed immediately before this documentation migration;
- `npm audit --omit=dev`: four high-severity transitive advisories, with no registry fix available;
- no critical implementation defect was found.

`npm outdated --long` could not complete because the npm registry request timed out; dependency freshness beyond the installed lockfile was not established.

## Strong seams

- `runtime-presets`, `extension-protocols`, and `extension-sqlite` are independent leaf modules.
- `composition-runtime` is domain-neutral and is the only activated-composition owner.
- `host-omp` does not import Persona, memory, SQLite, embedding, vectors, or a named Runtime Preset.
- Canonical memory remains authoritative; vector stores are identifier-only derived projections.
- Embedding and vector implementations depend inward on memory-owned interfaces.
- Activation, patching, protocol, memory, and host behavior have substantial observable test coverage.

## Findings

### High — unresolved transitive dependency advisories

**Files:** `packages/extension-embedding-local/package.json`, `package-lock.json`.

`@huggingface/transformers` brings vulnerable `onnxruntime-node -> adm-zip <0.6.0` and `sharp <0.35.0`. The reported advisories include crafted-ZIP memory allocation (`GHSA-xcpc-8h2w-3j85`) and inherited libvips vulnerabilities (`GHSA-f88m-g3jw-g9cj`). npm reported four high-severity vulnerabilities and no available fix.

**Action:** keep the local embedder opt-in; do not acquire model archives from untrusted sources; monitor upstream `transformers`, `onnxruntime-node`, and `sharp`; replace or upgrade the chain as soon as a fixed compatible release exists. If exposure expands beyond trusted pinned model artifacts, move acquisition/validation into a constrained preparation process before deployment.

**Verification:** rerun `npm audit --omit=dev`, model-cache integrity tests, and one real embedding after any dependency change.

### Medium — teardown can stop after the first failure

**File:** `packages/composition-runtime/src/runtime.ts`, session/runtime `dispose()`.

Session disposal removes watches, disposes the session Fiber, then removes the session from the set without `finally`. Runtime disposal uses `Promise.all` and does not continue to the owner/root cleanup if one session rejects. One failing plugin disposer can therefore strand sibling resources and make subsequent cleanup incomplete.

**Action:** make each cleanup stage unconditional, collect failures, remove registrations/sets in `finally`, dispose all sibling sessions, then report an aggregate error.

**Verification:** a plugin disposer throws while a sibling owns an observable effect; both effects and all config watches must still disappear, and repeated disposal must remain idempotent.

### Medium — local embedder acquisition can leak a late runtime

**File:** `packages/extension-embedding-local/src/embedder.ts`, `loadOn()`, `runtime()`, and `close()`.

After a runtime resolves, post-load artifact validation can fail without closing it. `close()` can also race acquisition: a late loader result may become active after `closed` was set.

**Action:** retain the candidate runtime locally, close it on every validation/load failure, recheck closed state after awaits, and make late resolution self-dispose rather than publish the runtime.

**Verification:** delayed fake acquisition plus concurrent `close()`, and successful load followed by failing validation; the fake runtime must close exactly once and later embedding must reject.

### Medium — pgvector initialization has the same late-close leak

**File:** `packages/extension-memory-vectors/src/pgvector.ts`, `initialize()` and `close()`.

If `close()` wins while `runtimeLoader()` is pending, `assertOpen()` throws after the runtime resolves. The catch ends only a created pool; the loaded runtime is not retained or closed. State is also published before all initialization queries settle.

**Action:** treat runtime and pool as local acquisition candidates until initialization commits, close both on failure or late close, and recheck state after awaited backend operations.

**Verification:** delay `runtimeLoader()`, close mid-initialization, then resolve it; no runtime/pool remains live and later operations reject as closed.

### Medium — Qdrant initialization caches transient failure and late state

**File:** `packages/extension-memory-vectors/src/qdrant.ts`, `client()` and `ensureCollection()`.

The first rejected client promise remains memoized forever. A transient import/factory failure therefore permanently poisons the adapter. Collection initialization also sets cached state after remote awaits without a final open-state check.

**Action:** clear the client promise on rejection, keep collection setup retryable, and reject/close late state after disposal before marking the collection initialized.

**Verification:** first client creation fails and the second succeeds; a close during delayed collection metadata fetch must not leave initialized state or a live owned client.

### Medium — one notification observer can kill JSON-RPC

**File:** `packages/host-omp/src/protocol.ts`, `FramedJsonRpcPeer.#dispatch()`.

Notification handlers run through `Promise.all`; one rejection reaches `#onData`, calls `#fail`, detaches the peer, and rejects unrelated pending requests. Request-handler failures are contained, but observer failures are not.

**Action:** contain each notification observer independently and route failures to a bounded diagnostic path without closing transport.

**Verification:** one observer throws while another succeeds; a subsequent request/response and notification cycle must still work.

### Medium — current OpenSpec main specs contain legacy contracts

**Files:** `openspec/specs/runtime-kernel/spec.md`, `openspec/specs/persona-composition/spec.md`, `openspec/specs/extensions/persona/spec.md`, `openspec/specs/hosts/oh-my-pi/spec.md`.

Several requirements still assign Persona Instance/project/trait selection to runtime-owned configuration, while the implemented Runtime Preset cutover makes selection generic and feature metadata extension-owned. Active memory change artifacts also referenced removed `preset-aiden` naming; direct active references were corrected during this audit.

**Action:** create a dedicated OpenSpec reconciliation change that supersedes or removes legacy Persona-selection requirements and promotes the semantic-index delta into current main specs. Do not rewrite archived change evidence.

**Verification:** search non-archived OpenSpec files for legacy fields/package names and compare every remaining requirement with the owning document and observable tests.

### Low — watcher tests use timing rather than state

**Files:** `packages/composition-runtime/tests/reload.spec.ts`, `packages/extension-persona/tests/traits.spec.ts`, `packages/host-omp/tests/child-integration.spec.ts`.

Fixed sleeps and short default polling windows make filesystem/HMR tests load-sensitive. During the immediately preceding repository verification, isolated reruns passed after full-suite watcher timeouts.

**Action:** wait on explicit reload revision/diagnostic events, or expose a test-only observable completion promise at the existing runtime interface; avoid arbitrary sleeps.

**Verification:** run affected files repeatedly under full-workspace concurrency without extending timeouts merely to hide lost events.

## Deepening opportunities

These are refactor candidates, not prerequisites for the documentation cutover.

1. **One package-boundary manifest**
   - **Files:** `scripts/check-package-boundaries.mjs`, `AGENTS.md`, `docs/architecture/overview.md`.
   - **Problem:** the dependency seam map is repeated in prose and executable rules.
   - **Solution:** move the machine-readable package graph into one small manifest consumed by the checker; docs describe intent and link to it.
   - **Benefit:** one change point, less drift, and direct tests of the actual seam.

2. **One composition canonicalizer**
   - **Files:** `packages/composition-runtime/src/definition.ts`, `serialized-activation.ts`.
   - **Problem:** non-empty values, absolute paths, patch cloning, and normalization are implemented twice with different field prefixes.
   - **Solution:** concentrate normalization in one internal module and let both public constructors supply only their context-specific fields.
   - **Benefit:** stronger locality for path/patch invariants and one table-driven test surface.

3. **One Persona asset-contribution module**
   - **Files:** `packages/extension-persona/src/identity.ts`, `traits.ts`.
   - **Problem:** file read/trim, canonical URL, serialized HMR reload, last-good retention, warnings, and context registration are duplicated.
   - **Solution:** deepen one internal asset loader/contribution module; keep identity and trait policy at their current call sites.
   - **Benefit:** reload correctness changes once, while identity/trait semantics remain explicit and separately tested.

4. **Narrow `host-omp` public entrypoints**
   - **Files:** `packages/host-omp/src/index.ts`, `packages/host-omp/package.json`.
   - **Problem:** one root export exposes extension API, adapter state machine, child process, framed transport, and runtime host internals as one interface.
   - **Solution:** keep the ordinary consumer surface at the root and expose transport/child testing seams through intentional subpaths, or make them package-private where no external caller exists.
   - **Benefit:** lower compatibility burden and clearer test ownership.

5. **Automated documentation integrity**
   - **Files:** `docs/README.md`, `README.md`, `AGENTS.md`, `package.json`, `scripts/`.
   - **Problem:** authority and links drifted until manually audited.
   - **Solution:** add a narrow repository check for the docs index inventory, local links, removed live-document references, and legacy non-archived package names.
   - **Benefit:** the documentation tree becomes an executable maintenance seam rather than an instruction only.

## Recommended order

1. Contain lifecycle/RPC failures and add race regressions.
2. Resolve the vulnerable embedder dependency chain or constrain its deployment explicitly.
3. Reconcile current OpenSpec requirements with the Runtime Preset architecture.
4. Replace watcher sleeps with event/state-driven tests.
5. Deepen normalization, Persona assets, package-boundary ownership, and host exports in separate focused changes.

## Post-change verification

- `npm run check` passed after the documentation migration: all nine workspace typechecks, all package tests, the single-Cordis-root check, and all nine package-boundary rules.
- Workspace TypeScript diagnostics reported no issues.
- Every Markdown file under `docs/` is present in `docs/README.md`; all local links from `README.md`, `AGENTS.md`, and `docs/**/*.md` resolve.
- The removed legacy top-level specification document is absent. Historical textual references remain only in archived OpenSpec evidence.
- `npm audit --omit=dev` remains non-clean with the four high-severity advisories recorded above.

## Remediation follow-up — 2026-08-30

The `remediate-system-audit-findings` change fixed the lifecycle, ownership, verification, and repository-maintenance findings without rewriting the original audit evidence:

- composition/session disposal now attempts every watcher, Fiber, sibling session, runtime owner, and owned-root cleanup stage before reporting collected failures; direct and serialized activation share one internal canonicalizer;
- local embedder, pgvector, and Qdrant acquisition use prepare/commit ownership, reject late publication after close, dispose candidates exactly once, and retain retryability after transient Qdrant client construction failure;
- JSON-RPC notification observers settle independently and report bounded diagnostics without closing healthy transport or rejecting unrelated requests;
- composition, Persona asset, and child integration tests wait for observable revisions, reload outcomes, notifications, responses, and process exit rather than using elapsed time to cause progress;
- Runtime Preset selection and Runtime Session metadata are generic in current specs; Persona instance identity, assets, traits, storage, and state remain Loader-owned extension configuration, while actor identity is host-owned session state;
- composition normalization and Persona file-backed asset lifecycle each have one package-private implementation; the `host-omp` package root retains only its intentional extension/adapter consumer surface;
- `scripts/package-boundaries.json` is the single executable package-edge source, and the root network-free gate now checks documentation inventory, local links, removed live paths, legacy active-spec contracts, unique focused-spec ownership, and resolved executable evidence.
  The `align-openspec-with-focused-specs` follow-up reconciled the remaining current OpenSpec ownership, removed superseded runtime/roster/Persona capabilities, and added a strict selected-change pre-archive evidence gate.

Observed verification for this follow-up:

- focused changed-package typechecks passed; focused suites passed with composition runtime 25 tests, Persona 7, local embedder 9 with the real smoke disabled, vector lifecycle 55 with 3 service-dependent skips, `host-omp` 29, and repository scripts 15;
- the real project-local OMP extension returned exactly `DOPPELGANGER_SMOKE_OK`; targeted OMP vertical, child, process, and extension scenarios passed 19 tests covering context, dynamic tools, valid reload, invalid rollback, child/runtime failure containment, notification-observer containment, and bounded shutdown;
- the opt-in real local embedding suite passed all 10 tests, including MiniLM and multilingual EmbeddingGemma inference, in 180.16 seconds;
- Chroma, Qdrant, and pgvector final service smokes were unavailable because `CHROMA_SMOKE_URL`, `QDRANT_URL`, and `DOPPELGANGER_TEST_PGVECTOR_DSN` were unset; no mock result is substituted for those real-service smokes;
- `npm run check` passed all nine workspace typechecks, 40 test files and 203 tests with 3 service-dependent files and 4 tests skipped, the single-Cordis-root check, manifest-driven package boundaries, and documentation/live-spec integrity;
- `npm run check:security` reported four unresolved reviewed high-severity entries—`@huggingface/transformers`, `onnxruntime-node`, `adm-zip` (`GHSA-xcpc-8h2w-3j85`), and `sharp` (`GHSA-f88m-g3jw-g9cj`)—all with `fixAvailable=false`, matching the baseline dated 2026-08-30;
- strict validation reported `remediate-system-audit-findings` valid.

Residual risk remains explicit: the local embedder is opt-in and may load only trusted, pinned model artifacts; untrusted model archives and image inputs remain prohibited until the reviewed transitive advisories are fixed upstream. A matching security baseline is not a clean production dependency audit.
