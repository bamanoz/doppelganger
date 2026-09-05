# Runtime logging

Runtime logging is an optional, session-owned destination layer for ordinary Cordis `ctx.logger` records. Plugins keep using Cordis directly; Doppelganger adds no second logging facade, host notification protocol, console exporter, daemon, metrics pipeline, or trace system.

## Default-off contract

Composition Runtime creates one bounded logging router for every Runtime Session before the authored Loader tree starts. Runtime and feature plugins may emit ordinary in-process records immediately, but a Runtime Preset or ordered Runtime Patch must explicitly compose at least one destination row before any record reaches a file or network service.

The shipped `standard` Runtime Preset contains no logging exporter. Exporter omission creates no destination file, network request, stdout or stderr output, host callback, context contribution, projected tool, durable history, or post-activation background queue. Installation of the optional exporter packages is inert.

## Session router and records

The router accepts only records whose Cordis Fiber belongs to that session's existing tracked Fiber subtree. Its `doppelgangerLogging` service and sinks are session-owned. The single low-level Cordis exporter registration is anchored on the runtime owner so it remains present while child Fiber disposers report errors, then explicit Runtime Session cleanup removes it after exhaustive teardown. Several Runtime Sessions sharing one Cordis root therefore retain separate records, sinks, queues, sequence numbers, reload state, and disposal.

`doppelgangerLogging` is a session-isolated service. Trusted destination plugins register a sink and a bounded `maximumPendingRecords`; producer plugins do not import it. Each immutable normalized record contains only:

- session-local `sequence` and numeric `timestamp`;
- `severity`: `error`, `warn`, `info`, or `debug`;
- bounded logger name and rendered message;
- stable Runtime Session ID and Runtime Preset ID;
- optional bounded error name, message, and stack.

Records contain no Cordis Fiber, arbitrary argument array, closure, symbol, host object, or credential. Rendering preserves ordinary Cordis formatting where safe, replaces cyclic, throwing, or unsupported values with bounded stable representations, and cannot throw back into the source logger call. Current UTF-8 ceilings are 256 bytes for logger and error names, 16 KiB for the rendered message, 4 KiB for the error message, and 32 KiB for the error stack.

This normalization is a bounds and transport-safety boundary, not automatic secret or personal-data redaction. Plugin authors and operators remain responsible for log content, destination access, and retention.

## Activation buffering and sink queues

Before audited activation settles, the router retains at most 256 normalized records. A sink registering during that initial window receives the retained suffix exactly once in sequence order before live records. Overflow drops the oldest activation records and prepends one coalesced synthetic drop-count record.

After successful audit the activation buffer is released. If no exporter registered, later records are not retained. A sink added by valid reload receives only records emitted after registration; runtime history is not reconstructed.

Every sink has an independent FIFO from 1 through 16,384 pending records and one serialized asynchronous drain. Filtering occurs before queue admission. A logger call never waits for file or network I/O. Sink overflow drops the oldest pending records and delivers one coalesced synthetic drop-count record before the retained suffix. A throwing or rejecting sink is quarantined; sibling sinks and the Runtime Session continue.

Registration is a Cordis effect owned by the exporter row. Replacement or removal unregisters the old sink before closing its destination. Invalid reload keeps the prior audited generation. Partial activation, valid replacement, row removal, and Runtime Session disposal release their owned queues and resources through the existing session owner. Disposal is idempotent and accepted destination work is drained within the destination's own bounded contract.

## Operational event vocabulary

First-party operational records use an exact logger name and an event identifier as the first message token. Remaining `key=value` fields are bounded operational metadata: counts, state names, result categories, configured backend or transport kinds, public component identifiers, and opaque revision identifiers. `debug` describes high-frequency resolution, catalog, search, and inspection work; `info` describes activation, committed mutations, transitions, reload, rollback, and disposal; `warn` describes rejected, degraded, retrying, or contained operations; `error` describes failed activation, rollback, watch setup, or cleanup.

| Logger | Covered event families |
| --- | --- |
| `doppelganger-composition-runtime` | Runtime Session activation and audit, reload/unchanged generation, rollback, watch registration/failure, and disposal start |
| `doppelganger-actor-identity`, `doppelganger-runtime-host`, `doppelganger-lifecycle` | actor binding state, protected bridge lifecycle, tool-catalog forwarding, and lifecycle publication outcomes |
| `doppelganger-context`, `doppelganger-tools` | component readiness/disposal, provider and catalog changes, resolution and invocation start/completion/rejection/failure/settlement |
| `doppelganger-sqlite` | service readiness, namespace open/close, and transaction failure categories |
| `doppelganger-persona`, `doppelganger-persona-asset`, `doppelganger-persona-authoring` | Persona lifecycle, asset load/reload, target inspection, exact-revision mutation, rejection, and disposal |
| `doppelganger-memory`, `doppelganger-memory-capture` | component lifecycle, canonical mutation outcomes, lexical/semantic search, semantic degradation, candidate extraction/write counts, and capture diagnostics |
| `doppelganger-inference-pi` | provider lifecycle and bounded structured-inference invocation outcomes |
| `doppelganger-evolution`, `doppelganger-evolution-signals` | component lifecycle, proposal listing/mutation, signal capture, bounded worker outcomes, and diagnostics |
| `doppelganger-dynamic-runtime-plugins` | component lifecycle plus Package definition, run/update, stop, undefine, rejection, and cleanup outcomes |
| `doppelganger-codegraph` | component lifecycle, status/exploration outcomes, incremental synchronization, process failure categories, and cleanup |
| `doppelganger-mcp` | component lifecycle, server startup/refresh/failure, configuration replacement, bounded diagnostics, and cleanup |
| `doppelganger-embedding-local`, `doppelganger-memory-vectors-*`, `doppelganger-memory-vector-coordinator` | embedder/vector/coordinator lifecycle, generation rebuild/rollback, projection retry, search degradation, and maintenance |

These records intentionally exclude raw context contribution text, principal input, tool arguments and results, memory contents, Evolution evidence, generated Package source, CodeGraph query or source output, MCP arguments and results, semantic vectors, credentials, and environment values. Third-party Runtime Preset plugins remain free to use ordinary `ctx.logger`; their own content policy is not implied by first-party coverage.

## Rolling JSONL file exporter

Use the independently mountable Loader entry:

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

Configuration is closed and synchronous. `path` is required, absolute, normalized, and explicitly operator-owned; the exporter applies no hidden workspace or Doppelganger-home confinement. `level` defaults to `info`. `levels` contains exact logger-name overrides. `maxBytes` defaults to 10 MiB and accepts 64 KiB through 1 GiB. `maxFiles` defaults to five retained numbered generations and accepts 1 through 100. `maximumPendingRecords` defaults to 2,048.

Activation creates only the required parent directory. It rejects an existing symlink, directory, or non-regular active path, opens a regular destination in append mode, and accounts for its existing bytes. A process-local guard rejects a second active writer for the same normalized path.

The writer serializes one complete normalized record plus newline per UTF-8 JSONL entry. Before a non-empty active file would cross `maxBytes`, it closes the handle, deletes generations beyond retention, shifts numbered generations from highest to lowest, moves the active file to `.1`, and opens a new active file. One individually bounded record may exceed `maxBytes` only in an otherwise empty active file. The retained-file count excludes the active file.

Rotation is serialized and preserves complete JSON lines, but a multi-file rename sequence is not crash-atomic. There is deliberately no interprocess rotation lock. **Exactly one operating-system process may actively write and rotate one concrete path.** Separate OMP processes or children must use distinct absolute paths.

Open failures invalidate the Loader generation. Later write, rotation, rename, deletion, or close failures stop only that exporter and remain contained from the Runtime Session and sibling sinks. Existing files remain operator-owned after row removal or shutdown.

## Sentry exporter

Use the independently mountable Loader entry:

```yaml
- id: runtime-logs-sentry
  name: "@doppelganger/doppelganger-logging-sentry/loader"
  inject: [doppelgangerLogging]
  isolate:
    doppelgangerLogging: session
  config:
    dsnEnv: DOPPELGANGER_SENTRY_DSN
    level: info
    levels:
      noisy-worker: error
    environment: production
    release: service-2026.09
    flushTimeoutMs: 2000
    maximumPendingRecords: 1024
```

`dsnEnv` is required and names exactly one environment variable resolved once for that Loader generation. Missing, empty, or invalid DSN values fail activation without fallback and without exposing the value. The optional Sentry `environment` and `release` metadata are bounded. `level` defaults to `info`, `flushTimeoutMs` defaults to 2,000 ms and accepts 100 through 60,000 ms, and `maximumPendingRecords` defaults to 1,024.

The package uses one private manually constructed Sentry client and private Scope per exporter generation. It does not call global `Sentry.init`, replace or close an application's current client, enable default integrations, tracing, profiling, automatic request instrumentation, default PII collection, or a logs integration.

Admitted `warn`, `info`, and `debug` records become private-scope breadcrumbs. An admitted `error` record emits one event with bounded error/message data and Runtime Session, Runtime Preset, logger, severity, and sequence correlation. Raw Cordis arguments and the DSN are unavailable to the exporter.

Replacement, removal, and Runtime Session disposal unregister the sink first, then close only the private client within `flushTimeoutMs`. Delivery rejection, flush failure, or timeout remains contained and cannot fail the source logger call, sibling destinations, or the Runtime Session.

## Host boundary

Runtime logging is process-local plugin infrastructure, not part of `extension-protocols` or the Runtime Host API. OMP adds no `runtime.log` RPC request or notification, capability flag, callback, context, tool, report, or UI projection. File and Sentry exporters execute inside the child Runtime Session. Child stdout remains exclusively framed JSON-RPC; child stderr remains the existing bounded emergency bootstrap, transport, and process-failure channel.

## Primary implementation

- `packages/composition-runtime/src/runtime-logging.ts` — normalized record contract, router, bounded activation and sink queues, Fiber correlation, and disposal.
- `packages/composition-runtime/src/runtime.ts` — session installation, audited activation settlement, reload, and cleanup integration.
- `packages/extension-logging-file/` — strict file configuration, Loader plugin, and rolling JSONL writer.
- `packages/extension-logging-sentry/` — strict environment-referenced configuration, private Sentry client, Loader plugin, and bounded shutdown.
- `packages/composition-runtime/tests/runtime-logging.spec.ts` — router and disposable Runtime Preset/patch behavior.
- `packages/host-omp/tests/runtime-logging.spec.ts` — real child file output and stdio neutrality.
