## 1. Runtime Logging Contracts

- [x] 1.1 Add `packages/composition-runtime/src/runtime-logging.ts` with public immutable record, severity, bounded error, sink, sink-options, service, and repository limit contracts plus Cordis `Context` augmentation for `doppelgangerLogging`
- [x] 1.2 Implement UTF-8-bounded logger argument and error normalization that preserves safe Cordis formatting, handles cycles and throwing or non-JSON values, deep-freezes records, and never throws into the source `ctx.logger` call
- [x] 1.3 Implement shared severity-name ordering and exact logger-name filter helpers for exporter packages without exposing Cordis numeric levels as configuration
- [x] 1.4 Export the runtime logging contracts and helpers from `packages/composition-runtime/src/index.ts` without adding a protocol or host dependency

## 2. Session Router and Lifecycle

- [x] 2.1 Implement `RuntimeLoggingRouter` with one Cordis exporter, existing session-Fiber `WeakSet` correlation, per-session sequence and metadata projection, and complete exclusion of records outside the owning Runtime Session
- [x] 2.2 Implement the bounded initial-activation FIFO, per-initial-sink replay, audited-settlement release, exporter-omission no-retention path, and coalesced activation-overflow record
- [x] 2.3 Implement independent bounded per-sink FIFO drains, oldest-pending overflow accounting, serialized asynchronous delivery, sink failure quarantine, and sibling continuation without blocking logger calls
- [x] 2.4 Integrate router creation and `doppelgangerLogging` provision before the authored Include tree mounts, call activation settlement only after successful audit, and dispose the router through the existing session owner on partial activation, reload, and session shutdown
- [x] 2.5 Reconcile the existing cleanup-error Cordis exporter with the router so teardown errors remain exhaustively reported once and no second session-Fiber tracking convention is introduced
- [x] 2.6 Add `packages/composition-runtime/tests/runtime-logging.spec.ts` coverage for ordinary `ctx.logger` routing, hostile argument bounds, activation replay and overflow, concurrent-session isolation, omission release, multiple sinks, asynchronous ordering, sink overflow/failure, reload removal, partial activation cleanup, and idempotent disposal

## 3. Rolling File Exporter

- [x] 3.1 Create `packages/extension-logging-file` with strict NodeNext TypeScript setup, public and `./loader` exports, workspace Cordis peer, Composition Runtime dependency, Schemastery configuration, and no general logging-framework dependency
- [x] 3.2 Implement closed synchronous configuration for absolute normalized path, default and exact logger levels, `maxBytes`, `maxFiles`, and `maximumPendingRecords`, including unknown-key and numeric-bound rejection
- [x] 3.3 Implement safe destination acquisition with parent creation, active-path `lstat`, symlink/directory/non-regular rejection, append-mode byte accounting, and a process-local duplicate-active-path guard
- [x] 3.4 Implement one serialized JSONL writer that preserves complete records, rotates before a threshold-crossing append, shifts numbered generations deterministically, enforces retained-file count, and permits one bounded record in an empty active file
- [x] 3.5 Implement the Loader plugin with same-realm `doppelgangerLogging` injection, independent pre-queue filtering, registration ownership, valid replacement cutover, accepted-write draining, exactly-once close, and contained operational failure
- [x] 3.6 Add `packages/extension-logging-file/tests/file-exporter.spec.ts` coverage for strict configuration, safe paths, ordered JSONL append, exact filtering, threshold rotation, retention deletion, duplicate-path rejection, filesystem failures, reload replacement, queue drain, complete lines, and repeated disposal using temporary roots only

## 4. Sentry Exporter

- [x] 4.1 Verify the current manual-client and private-scope APIs in the chosen `@sentry/node` release, pin one exact compatible version, and create `packages/extension-logging-sentry` with public and `./loader` exports, Cordis peer, Composition Runtime dependency, Schemastery configuration, and package-private client-factory test seam
- [x] 4.2 Implement closed synchronous configuration for `dsnEnv`, default and exact logger levels, bounded environment/release metadata, `flushTimeoutMs`, and `maximumPendingRecords`; reject unknown keys and resolve only the exact named DSN variable per Loader generation
- [x] 4.3 Build one private Sentry client and Scope without global `Sentry.init`, global client replacement, tracing, profiling, automatic request instrumentation, default PII collection, unrelated integrations, or ownership of another Sentry client
- [x] 4.4 Map admitted non-error records to private-scope breadcrumbs and error records to one bounded event with Runtime Session, Runtime Preset, logger, severity, and sequence context while never exposing raw Cordis arguments or the DSN
- [x] 4.5 Implement Loader-owned registration, contained delivery failure, unregister-before-close ordering, bounded flush/close, timeout containment, reload replacement, and closure of only the exporter-owned client
- [x] 4.6 Add `packages/extension-logging-sentry/tests/sentry-exporter.spec.ts` coverage with an isolated fake transport for credential failure, global-state preservation, level filters, breadcrumbs, error mapping, metadata bounds, raw-argument exclusion, rejected delivery, flush success/timeout, reload, and repeated disposal without external network access

## 5. Composition, Distribution, and Boundaries

- [x] 5.1 Register both exporter packages and their exact internal edges in `scripts/package-boundaries.json`, update workspace lock metadata, and keep Composition Runtime and `host-omp` free of concrete exporter imports
- [x] 5.2 Add both optional packages to the private `@doppelganger/doppelganger-omp` installation closure so bare Loader exports resolve in an isolated linked plugin tree without activating either exporter
- [x] 5.3 Keep `packages/runtime-presets/presets/standard/runtime.cordis.yml`, runtime-owned home configuration, project selection manifests, Runtime Session metadata, and Runtime Host capabilities unchanged
- [x] 5.4 Extend package and repository integrity tests to prove public exports, Loader resolution, exact dependencies, installation-only inertia, and absence of obsolete or aggregate logging package paths

## 6. Runtime and OMP Behavioral Verification

- [x] 6.1 Add generated disposable Runtime Presets and Runtime Patches proving explicit file opt-in, independently filtered file and Sentry sinks, malformed-row activation failure, valid reload addition/removal, invalid reload rollback, and exporter-omission neutrality
- [x] 6.2 Add `packages/host-omp/tests/runtime-logging.spec.ts` with a real child Runtime Session proving configured child file output, no ordinary logging RPC message or callback, no OMP report/UI projection, stdout framing integrity, and unchanged bounded emergency stderr behavior
- [x] 6.3 Extend the shipped-standard test to prove no logging exporter row, destination side effect, or package activation is introduced by default
- [x] 6.4 Exercise concurrent Runtime Sessions and separate OMP children with distinct paths to prove record, sink, queue, file, Sentry client, reload, and disposal isolation
- [x] 6.5 Run narrow Composition Runtime, file exporter, Sentry exporter, runtime-presets, OMP package, and host-OMP typechecks/tests plus one real project-local OMP smoke with a disposable logging patch

## 7. Documentation and Focused Specifications

- [x] 7.1 Add `docs/features/runtime-logging.md` as the single authoritative owner for default-off behavior, Cordis logger reuse, session router, record bounds, sink queues, Loader examples, rolling file semantics, Sentry credentials/client isolation, failure containment, reload, disposal, and the one-writer-per-file-path invariant
- [x] 7.2 Update `docs/README.md`, `docs/architecture/overview.md`, and `docs/architecture/composition-and-reload.md` with logging ownership, package topology, session lifecycle, activation buffering, omission neutrality, and primary implementation links
- [x] 7.3 Update `docs/operations/configuration.md`, `README.md`, `docs/hosts/oh-my-pi.md`, `docs/operations/verification.md`, and `docs/project/status-and-scope.md` with exact opt-in rows, absolute path and environment-reference rules, OMP stdout/RPC neutrality, disposable verification, and accepted scope
- [x] 7.4 Replace every `planned:` runtime-logging evidence reference with exact implemented static Vitest titles and reconcile the new live `openspec/specs/runtime-logging/spec.md` owner without changing unrelated capability requirements

## 8. Final Gates

- [x] 8.1 Run `npm run check:focused-specs` and `npm run test:focused-specs -- --change add-configurable-runtime-logging`, fixing every ownership, evidence, or behavioral failure
- [x] 8.2 Run `npm run check` and fix every workspace typecheck, test, Cordis-root, package-boundary, catalog, documentation, and repository-integrity regression
- [x] 8.3 Run `npm run check:security` after adding `@sentry/node`; report the exact unresolved reviewed advisory count and baseline state rather than describing a passing baseline check as clean
- [x] 8.4 Review the final diff for default-off behavior, no console exporter, no logging host/RPC seam, no personal runtime-state access, complete cleanup, and documentation/spec consistency before declaring the change ready to archive

## 9. First-Party Operational Instrumentation

- [x] 9.1 Define stable logger names, event vocabulary, severity rules, data-minimization exclusions, exporter recursion exclusion, and the session-disposal completion boundary
- [x] 9.2 Instrument Composition Runtime activation, audit outcome, reload/rollback, watch registration, and disposal start/failure through the session router
- [x] 9.3 Instrument context, tools, lifecycle publication, instance SQLite, Persona, and Persona Authoring without logging content, paths, inputs, outputs, or credentials
- [x] 9.4 Instrument canonical memory, local embedding, semantic vector backends/coordinator, Evolution, Dynamic Runtime Plugins, CodeGraph, MCP import, and Pi inference with bounded identifiers/counts only
- [x] 9.5 Add behavioral file-export evidence covering core and representative component events, severity, disposal boundaries, and prohibited payload absence
- [x] 9.6 Update authoritative feature/architecture/component documentation with the implemented coverage matrix and residual control-plane/host boundaries

## 10. Instrumentation Verification

- [x] 10.1 Run affected package typechecks and focused behavioral suites
- [x] 10.2 Run `npm run check:focused-specs`, focused evidence, and `npm run check`
- [x] 10.3 Review the final diff for complete first-party session coverage, no exporter recursion, no sensitive payload logging, and unchanged host/RPC/default-off behavior
