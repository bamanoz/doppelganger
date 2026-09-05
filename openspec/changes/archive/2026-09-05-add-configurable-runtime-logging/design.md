## Context

Cordis already gives every plugin `ctx.logger`. A logger call creates a structured Cordis message and sends it to registered exporters; without a destination exporter, the built-in service only retains its own limited internal buffer. DeepSeek Harness uses this same mechanism and its console exporter is an ordinary Loader plugin that calls `ctx.logger.exporter(...)`. Source inspection also showed the failure mode to avoid: most DSH profiles mount no exporter, and a webworker host had to install an early warning/error sink because activation warnings were otherwise invisible.

Doppelganger currently creates or receives one Cordis root in Composition Runtime, owns a Fiber subtree per Runtime Session, and already tracks every Fiber in that subtree to collect cleanup failures. Existing feature plugins emit through `ctx.logger`, but no general exporter is mounted. OMP runs each committed Runtime Session in a child whose stdout is the framed JSON-RPC transport; writing console logs there would corrupt the protocol. The parent keeps only bounded child stderr for emergency process diagnostics and reports selected activation/transport failures.

The requested behavior is therefore not "show logs in OMP." It is an explicit Loader-owned destination model: no destination by default, with independently composable file, Sentry, and future exporters. The design must preserve session isolation, existing Cordis APIs, transactional Loader reload, host neutrality, bounded work, and exhaustive disposal.

## Goals / Non-Goals

**Goals:**

- Route existing `ctx.logger` records from one Runtime Session to explicitly composed exporters.
- Capture activation-time records even though sibling Loader rows start concurrently.
- Keep omission completely silent and allocation-bounded after activation.
- Let several exporters consume the same records with independent filters and failure boundaries.
- Provide a rolling JSONL file exporter and an isolated Sentry exporter.
- Preserve OMP stdout framing and keep ordinary logs out of OMP UI and RPC.
- Make exporter configuration, credentials, resources, reload, and disposal ordinary Cordis Loader concerns.
- Instrument Composition Runtime and every first-party Runtime Session component with stable operational event names, severity rules, and data-minimizing fields through native `ctx.logger`.

**Non-Goals:**

- Replacing Cordis `LoggerService` or introducing a second application logging API.
- Persisting logs into the Runtime Host API, lifecycle payloads, canonical memory, Evolution evidence, or host conversation.
- Shipping an enabled exporter in `standard` or a first-party console/stdout exporter.
- Building a daemon, remote log collector, general observability pipeline, metrics, traces, or log-query UI.
- Claiming automatic secret removal from arbitrary plugin-authored text.
- Coordinating rotation between unrelated operating-system processes writing the same path.
- Changing DSH host-owned diagnostics or its native logger configuration.

## Decisions

### 1. Composition Runtime installs a session router before the Loader tree

Add `packages/composition-runtime/src/runtime-logging.ts` and export its public contracts from the package root. During `activate()`, immediately after creating the session owner and Fiber tracker, Composition Runtime creates a `RuntimeLoggingRouter` under that owner and provides it as session-isolated `doppelgangerLogging` before mounting the authored Include tree.

The router registers one Cordis exporter through `sessionOwner.ctx.logger.exporter(...)`. That exporter sets Cordis's own threshold to the most verbose numeric level so it receives `error`, `warn`, `info`, and `debug`; filtering happens later with Doppelganger's explicit severity-name mapping. For every Cordis message it dereferences `message.fiber` and accepts the message only when the Fiber belongs to the existing session `WeakSet`. Messages without a live session Fiber are ignored.

This reuses the same proven Fiber-subtree technique already used for cleanup-failure collection and works when several sessions share a caller-owned root.

Alternative: let every destination plugin call `ctx.logger.exporter()` directly, as DSH's console plugin does. Rejected because sibling Loader rows start concurrently, so activation records can precede exporter registration, and a root-level exporter has no safe Runtime Session correlation by itself.

Alternative: replace or wrap `ctx.logger`. Rejected because existing and third-party Cordis plugins must continue using the native service unchanged.

### 2. The public seam is a small normalized sink service

`doppelgangerLogging` exposes registration, not Cordis internals:

```ts
interface RuntimeLogRecord {
  readonly sequence: number
  readonly timestamp: number
  readonly severity: 'error' | 'warn' | 'info' | 'debug'
  readonly logger: string
  readonly message: string
  readonly sessionId: string
  readonly runtimePresetId: string
  readonly error?: {
    readonly name: string
    readonly message: string
    readonly stack?: string
  }
}

interface RuntimeLogSink {
  write(record: RuntimeLogRecord): void | Promise<void>
}

interface RuntimeLogSinkOptions {
  readonly maximumPendingRecords: number
}

interface RuntimeLoggingService {
  register(sink: RuntimeLogSink, options: RuntimeLogSinkOptions): () => Promise<void>
}
```

The actual implementation follows the repository's existing service pattern: `register()` uses `this.ctx.effect(...)`, so registration belongs to the consuming exporter Fiber and unload removes it automatically. Records are deeply frozen and contain no Cordis `Fiber`, arbitrary `args`, closures, symbols, or host objects.

Sequence is local to one Runtime Session. Session ID and Runtime Preset ID are copied from the existing immutable metadata service into each record; logging configuration does not extend that metadata.

Alternative: expose Cordis `Message` directly. Rejected because it is not JSON-compatible, retains framework objects through `WeakRef<Fiber>`, makes every exporter duplicate unsafe rendering, and couples exporter packages to Cordis logger internals.

Alternative: put this seam in `extension-protocols`. Rejected because logs are process-local operational infrastructure, not a host-neutral context/tool/lifecycle contract crossing the Runtime Host API.

### 3. Rendering and queueing are centralized and bounded

The router renders Cordis arguments once. It preserves printf-style meaning through Cordis formatting behavior where safe, catches throwing getters/inspection, handles cycles and unsupported values with stable markers, and truncates by UTF-8 byte bounds. A leading `Error` additionally becomes a bounded plain error description. The renderer never invokes user-defined JSON serialization as a required success path and never lets rendering throw back into `ctx.logger`.

Repository constants bound logger name, message, error name/message/stack, early records, and synthetic drop notices. The initial implementation uses a 256-record activation FIFO, 256-byte logger names, 16 KiB rendered messages, and 32 KiB error stacks. Tests own these boundaries and use byte counts rather than JavaScript code-unit counts.

Every registered sink gets an independent FIFO and one serialized drain. `ctx.logger` only normalizes and enqueues; it never awaits file or network I/O. Registration requires `maximumPendingRecords`, validated from 1 through 16,384. On overflow the router drops the oldest pending records and delivers one coalesced synthetic record with the dropped count before the next retained record. One failed sink is stopped and detached after its current delivery rejects; sibling queues continue.

Alternative: call async sinks directly and ignore returned promises. Rejected because it loses ordering, creates unhandled rejections, and gives no bounded backpressure behavior.

Alternative: block logger calls until destinations accept records. Rejected because a filesystem or network destination must not control plugin execution or host latency.

### 4. The activation buffer exists only until audited settlement

The router starts with a bounded 256-record FIFO before any authored row starts. Each sink registering during initial activation receives a snapshot of the currently retained FIFO exactly once, then joins live delivery. This matters because Loader siblings activate concurrently; it avoids assigning special ordering to exporter rows.

After the Loader tree settles and passes activation audit, Composition Runtime calls `router.settleActivation()`. The router then releases the early FIFO. A session with no sinks performs no later record retention. A sink inserted by a future valid reload receives only records emitted after it registers; old runtime history is not reconstructed.

If activation fails, session-owner disposal removes the Cordis exporter, registered sinks, and queued work along with all other partial resources.

Alternative: retain a permanent session ring buffer even without destinations. Rejected because the requested default is off, and permanent retention would create hidden runtime cost and data lifetime.

### 5. Exporters are ordinary opt-in Loader packages

Add two private workspace packages:

- `packages/extension-logging-file` → `@doppelganger/doppelganger-logging-file`
- `packages/extension-logging-sentry` → `@doppelganger/doppelganger-logging-sentry`

Each exports public types from `.` and its Loader plugin from `./loader`, injects `doppelgangerLogging`, and requires the row to isolate that service as `session`. Neither package is imported by Composition Runtime or `host-omp`. The private `packages/omp` install unit includes both packages in its dependency closure so a selected user preset or patch can resolve them; installation alone is inert.

Example file row:

```yaml
- id: runtime-logs-file
  name: "@doppelganger/doppelganger-logging-file/loader"
  inject: [doppelgangerLogging]
  isolate:
    doppelgangerLogging: session
  config:
    path: "/absolute/path/doppelganger.jsonl"
    level: info
    levels:
      doppelganger-memory: debug
    maxBytes: 10485760
    maxFiles: 5
    maximumPendingRecords: 2048
```

Example Sentry row:

```yaml
- id: runtime-logs-sentry
  name: "@doppelganger/doppelganger-logging-sentry/loader"
  inject: [doppelgangerLogging]
  isolate:
    doppelgangerLogging: session
  config:
    dsnEnv: DOPPELGANGER_SENTRY_DSN
    level: info
    environment: production
    flushTimeoutMs: 2000
    maximumPendingRecords: 1024
```

Configuration schemas reject unknown keys. User-facing levels use the conventional ordered names `error < warn < info < debug`, independent of Cordis's internal numeric enum. `level` is the default threshold; `levels` contains exact logger-name overrides. Filtering occurs before the per-sink queue.

Alternative: configure destinations in `$DOPPELGANGER_HOME/config.yaml` or host options. Rejected because plugin behavior and credentials belong to Loader rows, while runtime-owned configuration remains selection-only and hosts stay preset-neutral.

Alternative: one aggregate logging package with destination discriminators. Rejected because it forces file and Sentry dependencies into every installation and makes destination lifecycle/configuration one coupled row.

### 6. The file exporter owns one serialized rolling writer

The file plugin validates an absolute normalized path, `level`, exact logger overrides, `maxBytes`, `maxFiles`, and queue capacity synchronously. Defaults are 10 MiB, five retained numbered files, `info`, and 2,048 pending records. Bounds are 64 KiB through 1 GiB for `maxBytes`, one through 100 for `maxFiles`, and the router's queue bounds.

Activation creates the parent directory, uses `lstat` to reject an existing symlink, directory, or non-regular file at the active path, and opens the active file in append mode without following an active-path symlink. A single writer tracks the current byte length and writes one pre-serialized UTF-8 JSON object plus newline per record.

Before a write that would cross `maxBytes` in a non-empty file, it closes the handle, removes the oldest retained generation, renames numbered generations from highest to lowest, renames the active file to `.1`, and opens a fresh active file. A single bounded record may exceed the threshold only when the active file is empty. Disposal unregisters first, drains accepted records, and closes the handle exactly once.

The package does not attempt interprocess locking. One active writer per concrete path is an operator invariant; deployments running several OMP processes should configure distinct paths, for example by generating a process- or session-specific absolute path in authored Loader configuration. Within one process, the package keeps a process-local set and rejects a second active writer for the same normalized path.

Alternative: depend on a general-purpose logging framework solely for rotation. Rejected because the writer contract is small, Node provides the required primitives, and another logging facade would duplicate Cordis.

Alternative: time-based rotation or compression in the first version. Rejected to keep rotation deterministic and cleanup bounded. They can be future exporter features.

### 7. The Sentry exporter uses a private manual client

The Sentry package depends on a pinned `@sentry/node` version and uses the SDK's manual client/scope APIs. It does not call global `Sentry.init`, `setCurrentClient`, or global breadcrumb APIs. The client disables default integrations, tracing, profiling, automatic request instrumentation, logs integration, client reports where applicable, and PII collection; the exporter is only a destination for normalized runtime records.

`dsnEnv` is required and is resolved once per Loader generation. Missing, empty, or invalid values fail that row without fallback or credential disclosure. Optional bounded `environment` and `release` strings become event metadata. The package permits injecting a client factory only through a package-private test seam.

Admitted `error` records create one Sentry event. A normalized error description is reconstructed into an `Error`-like event with bounded stack context; otherwise the exporter captures the rendered message at error level. Admitted `warn`, `info`, and `debug` records become breadcrumbs on the private scope. Every event includes session ID, Runtime Preset ID, logger, severity, and sequence tags/context; raw Cordis arguments are never available to this package.

During disposal the sink unregisters first, lets the router drain accepted sink deliveries, then calls the private client's bounded close/flush path with `flushTimeoutMs` (default 2 seconds, allowed 100 ms through 60 seconds). Failure or timeout is contained and only the private client is closed.

The manual-client approach follows current Sentry SDK support for binding a client to an isolated `Scope`, capturing through that scope, and flushing with a timeout. Exact constructor and transport wiring are verified against the pinned SDK types during implementation rather than hidden behind global initialization.

Alternative: call `Sentry.init`. Rejected because Doppelganger may run inside DSH or another host that already owns Sentry; global initialization would mutate or close host state.

Alternative: send every record as a Sentry event. Rejected because it is noisy and costly; non-errors are breadcrumbs for correlated error events.

### 8. OMP remains unaware of ordinary runtime logs

No `runtime.log` RPC notification, capability flag, host callback, OMP report call, context contribution, or portable tool is added. File and Sentry exporters run in the child because that is where the Runtime Session and plugin Fibers live. Child stdout remains framed JSON-RPC. Direct `console.*` remains prohibited for normal child logging; stderr remains the existing emergency channel for bootstrap, transport, and process-fatal diagnostics.

The real OMP vertical verifies both explicit file output and complete default silence. Sentry is tested at the exporter boundary with an injected transport, not by adding host code.

Alternative: forward all records to the parent and print there. Rejected because the user explicitly does not want Doppelganger operational logs in an OMP session and because this would add a host-specific transport for a portable plugin concern.

### 9. Documentation and package boundaries change with the feature

Add `docs/features/runtime-logging.md` as the single owner of logging behavior, exporter rows, operational boundaries, path ownership, Sentry credentials, and failure/disposal semantics; index it from `docs/README.md`. Update overview, composition/reload, configuration, OMP, verification, and project scope without duplicating the normative feature contract.

Register both exporter packages in `scripts/package-boundaries.json`. Their only internal dependency is Composition Runtime for the public logging service contract; the file package otherwise uses Node built-ins, and the Sentry package owns `@sentry/node`. Update `packages/omp` only to make the optional packages resolvable from its isolated installation, not to activate them.

### 10. First-party Runtime Session components emit bounded operational events

Composition Runtime and first-party session plugins use stable package logger names and native `ctx.logger` calls. `info` records state transitions, `debug` records bounded operation starts/results and counts, `warn` records contained degradation or rejected operations, and `error` is reserved for failures that invalidate activation or cleanup. Logs never include prompt/context content, memory content or subject keys, inference input/output, generated source, credentials, DSNs, endpoint URLs, filesystem paths, lifecycle payloads, or tool inputs/results.

The covered runtime surface is Composition Runtime activation/reload/watch/disposal; actor binding and protected Runtime Host bridge activation; context assembly; tool catalog/invocation; lifecycle publication; instance SQLite open/transaction/close; Persona activation and asset reload; Persona Authoring inspection/revision; canonical memory mutations/search and candidate capture; local embedding acquisition/fallback/execution; semantic vector coordinator and backend lifecycle; Evolution proposal/signal processing; Dynamic Runtime Plugin definition/transitions; CodeGraph discovery/synchronization/exploration; MCP server generation/refresh/failure/disposal; and Pi structured inference invocation/closure. File and Sentry exporters deliberately do not log through the routed service they consume, avoiding recursive delivery.

Control-plane Runtime Preset selection and host-owned OMP process/RPC diagnostics remain outside the Runtime Session router and keep their existing channels. Session-owned exporters can observe disposal-started and teardown failures, but cannot reliably receive a final disposal-completed record because they are themselves disposed within that boundary.

## Risks / Trade-offs

- **[Risk] Plugins can place secrets or personal data in log text.** → Document that normalization is a safety/bounds boundary, not a content-redaction guarantee; never add raw arguments to Sentry, never log the DSN, and require operators to choose destinations and access controls explicitly.
- **[Risk] Root Cordis logger export dispatch visits one filtering router per active Runtime Session.** → Keep the predicate to a WeakSet lookup before rendering; install only one router per active session and remove it with the session owner.
- **[Risk] A slow destination can overflow its queue and lose records.** → Bound each sink independently, drop oldest pending records deterministically, and emit a coalesced synthetic drop count so recent failure context survives without blocking plugins.
- **[Risk] Rolling rename is not a transaction across process crashes.** → Serialize operations, preserve complete JSON lines, recover from the actual numbered files on next activation, and document best-effort crash consistency rather than claiming atomic multi-file rotation.
- **[Risk] Two OS processes writing and rotating the same path can corrupt retention ordering.** → Reject duplicate paths inside one process and document one-writer-per-path; do not add a fragile cross-process lock protocol in this change.
- **[Risk] Sink failures are intentionally not surfaced in OMP.** → Keep them contained and stop the failed sink. Operators who require independent exporter-health alerting should compose another destination; this change does not create a host UI or recursive logger path.
- **[Trade-off] Later reload-added sinks do not receive pre-registration history.** → This preserves default-off semantics and bounded lifetime; only initial activation has a temporary replay window.

## Migration Plan

1. Add the session logging contract/router to Composition Runtime with no exporter packages activated. Existing presets and hosts remain silent.
2. Add and test the file exporter, then register its package boundary and optional OMP install dependency.
3. Add the pinned Sentry dependency and exporter with an isolated fake transport test; run the registry-backed security check and record any reviewed residual advisory.
4. Add disposable generated Runtime Presets and patches for Composition Runtime and real OMP child verification. Do not alter the shipped `standard` Loader tree.
5. Update focused evidence and authoritative documentation in the same implementation change.

Rollback removes exporter rows first, which disposes sinks and preserves existing log files or already delivered Sentry events. Code rollback then removes the optional packages and router. No database, Runtime Preset, manifest, or persistent-state migration is required.

## Open Questions

None. The first version deliberately chooses default-off operation, exact logger-name filters, size-based JSONL rotation, private Sentry clients, and no console exporter or cross-process file locking.
