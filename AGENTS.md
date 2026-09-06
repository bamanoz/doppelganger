# AGENTS.md

Doppelganger is a portable Cordis extension runtime for AI-agent hosts. Start with the documentation tree in [docs/README.md](docs/README.md), then read every owning document relevant to the change. Use [README.md](README.md) for setup and usage.

This file contains durable operating instructions for coding agents. Current architecture, behavior, operations, and product scope belong in `docs/`; setup and usage belong in `README.md`; OpenSpec owns change requirements and history.

## Repository layout

```text
packages/
  runtime-presets/       discovery, strict selection, preset metadata
  composition-runtime/   Loader activation, patches, sessions, audit, reload
  host-extension-runtime/ exact-host definitions, trusted catalogs, plans, protected entries
  extension-protocols/   host-neutral context, tools, and lifecycle protocols
  extension-sqlite/      plugin-owned SQLite infrastructure
  extension-persona/     Persona activation, identity, and traits
  extension-memory/      canonical memory, lexical/hybrid retrieval, and semantic contracts
  extension-embedding-local/ lazy local ONNX embedder Loader plugin
  extension-memory-vectors/ semantic coordinator and vector-backend Loader plugins
  host-omp/              OMP adapter, child runtime, RPC, and process lifecycle
dev/doppelganger/         development Runtime Presets and local durable state
.omp/extensions/          project-local OMP bootstrap
scripts/                  repository invariant checks
docs/                    authoritative architecture, feature, host, operations, scope, and audit documentation
```

Allowed internal package edges are defined only in `scripts/package-boundaries.json` and enforced by `scripts/check-package-boundaries.mjs`. Architecture prose describes intent; do not maintain a second executable edge list. Change the manifest only when intentionally changing an architectural seam.

## Documentation contract

- Before starting any repository task, run `tree docs` to capture the current documentation tree and keep that output in working context. If `tree` is unavailable, install it before proceeding: on macOS install the `tree` utility (for example with Homebrew); on Windows find and install a suitable equivalent that can print the documentation directory tree. Request user authorization only when the installation mechanism requires it.
- Always keep the documentation tree and its topic-ownership map from `docs/README.md` in working context while making changes.
- Before editing behavior, architecture, configuration, protocols, lifecycle, persistence, or operations, read every affected owning document.
- Update affected documentation in the same change as code. A code change with stale docs is incomplete.
- When adding, moving, or removing documentation, update `docs/README.md` and every affected link. Keep one authoritative owner per topic instead of duplicating normative prose.
- Reconcile active OpenSpec requirements with the documentation tree before archiving a change. Archived OpenSpec artifacts are historical, not current system documentation.

## Architecture rules

- Use Cordis for dependency injection, plugins, lifecycle, services, scopes, Loader semantics, and HMR. Do not introduce a parallel framework for any of them.
- Keep the kernel domain-neutral. Persona, identity, traits, storage, memory, and capture are ordinary plugins, not composition-runtime concepts.
- Treat a Runtime Preset as one complete portable Cordis Loader tree. Hosts append one separately selected protected Host Extension composition; presets never embed, select, or target Host Extensions.
- Keep `host-omp` and `host-openclaw` preset- and feature-neutral. They may depend on composition, Host Extension, Runtime Preset selection, and standard protocols, never Persona, memory, SQLite, or a named preset.
- Keep `extension-protocols`, `extension-sqlite`, and `runtime-presets` independent of other Doppelganger packages. Keep `host-extension-runtime` independent of concrete hosts and feature packages.
- Use the workspace `@deepseek-ai/cordis` peer everywhere. Duplicate Cordis installations break service identity and isolation.
- Host Extension definitions target one exact host kind, receive only closed JSON-compatible session facts, instantiate fresh plugin entries per Runtime Session, and reuse the adapter's one binding or transport. Module/configuration/fact changes replace the Runtime Session; Runtime Preset HMR never mutates the protected composition.
- Keep Runtime Session metadata limited to stable session ID, selected Runtime Preset ID, and optional absolute workspace root. Feature metadata belongs to its owning extension.
- Keep runtime-owned user and project configuration selection-only. Plugin configuration and durable state belong to Loader rows and plugin-owned paths.
- Never write normalized Loader input back to authored base or patch files.

## Cordis and Loader conventions

- Required services belong in `inject`. Services shared within a Runtime Session require matching Loader `isolate` realms.
- Registrations and watchers are Cordis effects and must dispose with their plugin scope.
- Loader wrappers await nested plugin Fibers. Returning a Fiber as an effect is incorrect.
- Base and patch paths in normalized activation contracts are absolute. Relative plugin assets resolve from the Runtime Preset directory.
- Apply patches in the specified order and preserve Cordis replacement semantics. Invalid activation fails visibly; invalid reload retains the previous audited generation.
- Serialize all reload mutations. Do not create a second watcher or mutation path beside composition-runtime.
- Empty presets and absent optional standard protocols are valid. Do not make context, tools, lifecycle, Persona, or memory implicit runtime requirements.

## Protocol invariants

- Values crossing YAML, RPC, tool, settings, lifecycle, or persistence boundaries are JSON-compatible and validated at the boundary.
- Context contributions declare `instruction` or `data` authority. Priority never promotes data into instructions, and assembly always enforces its token budget.
- Tool definitions use transport-neutral JSON Schema. OMP translates that schema and exactly replaces dynamic proxies; stale closures must not invoke removed tools.
- Lifecycle events are versioned, normalized, deeply frozen, and bounded. Publish them through `publishLifecycleEvent` so payload validation and subscriber failure containment remain uniform.
- Preserve stable `sessionId`, `turnId`, `callId`, and `deliveryId` semantics across host transport.
- Candidate capture consumes committed turns only. It never consumes partial turns or disposal.

## Memory invariants

- Memory remains a plugin service; do not add a kernel memory interface.
- Explicit mutations create active memory. Inference and capture create candidates only.
- Every mutation uses a stable `operationId`; retries replay the prior result or reject a changed command digest.
- Corrections append immutable revisions and use compare-and-swap. Hard deletion removes the canonical record and all locally derived rows.
- Apply partition, status, and temporal eligibility before ranking. Revalidate asynchronous semantic results before returning them.
- Preserve lexical retrieval when an optional semantic provider is absent or fails.
- Use the shared content policy for direct mutations and capture. Identity and traits are not writable memory.

## Engineering conventions

- Node.js 26 or newer. TypeScript is strict NodeNext ESM; relative imports include `.ts`.
- `exactOptionalPropertyTypes` is enabled. Omit absent optional fields instead of assigning `undefined`.
- Use package names across packages. Export public contracts from each package's `src/index.ts`; Loader-only entries use declared package subpath exports.
- Prefer one transaction per persistent mutation and deterministic tie-breakers for externally visible ordering.
- Dispose Runtime Sessions, Cordis roots, SQLite services, and child processes before deleting temporary directories.
- Tests use temporary instance roots. Never point tests at `dev/doppelganger/instances/aiden/storage`.
- Test observable behavior and failure boundaries, not source layout or implementation plumbing.
- Make clean cutovers: migrate every caller and remove obsolete aliases, re-exports, fixtures, packages, and compatibility paths.

## DeepSeek Harness work

Before proposing or implementing the native DeepSeek Harness host, complete the research gate in [docs/hosts/deepseek-harness.md](docs/hosts/deepseek-harness.md) against the actual DSH source. Trace boot, Loader activation and rollback, Fiber disposal, service isolation, agent/session scopes, dynamic runners, and package topology to exact files and symbols. Do not infer DSH behavior from upstream Cordis or duplicate its frameworks.

## Verification

Use the narrowest relevant checks while iterating:

```sh
npx tsc -p packages/<package>/tsconfig.json --noEmit
npx vitest run --root packages/<package> <test-file>
```

Run `npm run check` before handing off a permanent or cross-package change. It runs all workspace typechecks and tests, the single-Cordis-root check, manifest-driven package-boundary enforcement, and documentation/live-spec integrity checks. Run the registry-backed `npm run check:security` for releases and dependency updates; unresolved reviewed advisories are residual risk, not a clean result.

For OMP behavior, also exercise the real project-local extension from `.omp/extensions/doppelganger.ts`. Child transport, failure, patch, persistence, capture, dynamic-tool, and asset-reload scenarios live in `packages/host-omp/tests/`.

Keep this file limited to durable operating instructions. Update current architecture, behavior, operations, scope, and the documentation ownership map under `docs/`; update setup and usage in `README.md`.
