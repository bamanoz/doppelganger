## ADDED Requirements

### Requirement: Runtime logging is disabled by exporter omission
Doppelganger SHALL continue to expose Cordis `ctx.logger` to trusted plugins, but the new runtime logging capability SHALL produce no destination output unless the effective Runtime Preset explicitly composes at least one logging exporter row. The shipped `standard` Runtime Preset SHALL omit every logging exporter.

#### Scenario: Runtime Preset omits logging exporters
- **ID**: `runtime.logging.omission.silent`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::keeps exporter-omitting sessions silent while plugins use ctx.logger`
- **WHEN** a Runtime Session activates a composition whose plugins emit Cordis log messages but no logging exporter row is present
- **THEN** the logging capability creates no file, network request, stdout or stderr output, host notification, projected tool, or persistent background work

#### Scenario: Shipped standard preset activates
- **ID**: `runtime.logging.standard.silent`
- **EVIDENCE**: `planned:packages/runtime-presets/tests/shipped-standard.spec.ts::keeps the shipped standard Runtime Preset free of logging exporters`
- **WHEN** the package-owned `standard` Runtime Preset is selected without an exporter patch
- **THEN** it retains its existing behavior and activates no logging destination

### Requirement: One session-owned router observes Cordis records
Composition Runtime SHALL install one runtime logging router under each Runtime Session owner before the authored Loader tree starts. The router SHALL observe existing Cordis logger records from only that session's Fiber subtree, normalize them into immutable bounded records, and expose sink registration through a session-isolated `doppelgangerLogging` service without replacing `ctx.logger` or requiring plugins to use a new logging API.

#### Scenario: Plugin logs during activation
- **ID**: `runtime.logging.router.activation-record`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::captures activation logs before exporter rows settle`
- **WHEN** an authored plugin emits a Cordis log message while its Runtime Session Loader tree is activating
- **THEN** the session router captures the record early enough for an explicitly composed exporter to receive it after registering

#### Scenario: Concurrent sessions emit records
- **ID**: `runtime.logging.router.session-isolation`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::isolates records and sinks across concurrent Runtime Sessions`
- **WHEN** two Runtime Sessions sharing one caller-owned Cordis root emit interleaved log records
- **THEN** each session's sinks receive only records emitted by that session's Fiber subtree

#### Scenario: Plugin uses ordinary Cordis logger
- **ID**: `runtime.logging.router.cordis-api`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::routes existing ctx.logger calls without a replacement logging facade`
- **WHEN** an existing or future trusted plugin calls `ctx.logger` without importing a Doppelganger logging API
- **THEN** any configured session exporter can consume the normalized record without changing that plugin

### Requirement: Normalized records are bounded and transport-neutral
Each runtime log record SHALL contain only validated JSON-compatible fields: router sequence, timestamp, severity, logger name, rendered message, Runtime Session ID, Runtime Preset ID, and an optional bounded error description. Rendering SHALL handle cyclic, throwing, oversized, and non-JSON Cordis arguments without throwing from the source plugin call, and SHALL enforce configured repository-wide maximum lengths before a sink receives the record.

#### Scenario: Plugin logs hostile arguments
- **ID**: `runtime.logging.record.hostile-arguments`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::normalizes cyclic throwing and oversized Cordis logger arguments within bounds`
- **WHEN** a plugin logs cyclic objects, values with throwing inspection hooks, errors, symbols, functions, or oversized strings
- **THEN** the router emits a bounded immutable JSON-compatible record or a bounded rendering marker without propagating an exception to the plugin

#### Scenario: Record carries session correlation
- **ID**: `runtime.logging.record.session-correlation`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::adds stable Runtime Session correlation to normalized records`
- **WHEN** a session-owned Cordis log message is normalized
- **THEN** the record identifies the owning Runtime Session and Runtime Preset without adding logging fields to Runtime Session metadata

### Requirement: Early buffering is bounded and conditional
Before successful activation settlement, the router SHALL retain only a bounded FIFO of normalized records from its Runtime Session. Every sink that registers during that activation window SHALL receive the currently retained records exactly once in sequence order before its live deliveries. After successful activation settlement, the router SHALL discard the early buffer; a sink registered by a later valid reload SHALL begin with records emitted after that registration. If no sink registered, later records SHALL not be retained until a sink exists.

#### Scenario: Exporters register after an early warning
- **ID**: `runtime.logging.buffer.activation-replay`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::replays the bounded activation buffer once to every initial sink`
- **WHEN** a plugin emits records before two configured exporter rows register during initial activation
- **THEN** each initial sink receives the retained records once in original sequence order followed by its live records

#### Scenario: No exporter registers
- **ID**: `runtime.logging.buffer.omission-release`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::releases early records after exporter-omitting activation settles`
- **WHEN** Runtime Session activation succeeds without any sink registration
- **THEN** the early buffer is discarded and subsequent Cordis records incur no retained runtime logging queue

#### Scenario: Early traffic exceeds capacity
- **ID**: `runtime.logging.buffer.overflow`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::drops the oldest activation records at the fixed buffer bound`
- **WHEN** more activation records arrive than the early buffer can hold before sinks register
- **THEN** the router replays only the newest bounded suffix plus one synthetic record carrying the dropped count without allocating an unbounded queue

### Requirement: Sink registration is lifecycle-owned, bounded, and failure-contained
A logging exporter SHALL register one sink through the same session-isolated `doppelgangerLogging` service as its producer plugins. Each registration SHALL declare a bounded pending-record capacity; the router SHALL enqueue without awaiting the destination, serialize delivery per sink, and drop the oldest pending records with a synthetic count record when that capacity is exceeded. Registration SHALL be a Cordis effect removed during exporter replacement, failed candidate cleanup, row removal, and Runtime Session disposal. The router SHALL isolate synchronous throws and asynchronous delivery rejections so one sink cannot fail the source logger call, the Runtime Session, or sibling sinks.

#### Scenario: Multiple exporters are composed
- **ID**: `runtime.logging.sink.multiple`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::delivers one record independently to multiple session sinks`
- **WHEN** one Runtime Session composes two exporter rows whose filters admit the same record
- **THEN** both sinks receive the record independently with no load-order winner

#### Scenario: One exporter rejects delivery
- **ID**: `runtime.logging.sink.failure-contained`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::contains throwing and rejecting sinks without losing healthy siblings`
- **WHEN** one registered sink throws or rejects while consuming a record
- **THEN** the logger call and Runtime Session remain usable and every healthy sibling sink still receives the record

#### Scenario: Exporter row is removed by reload
- **ID**: `runtime.logging.sink.reload-removal`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::removes replaced exporter effects and rejects stale deliveries after reload`
- **WHEN** a valid Runtime Patch removes or replaces an exporter row
- **THEN** the prior sink stops receiving records and releases its resources before the replacement generation becomes authoritative

### Requirement: Exporter configuration is Loader-owned and strict
Each first-party exporter SHALL be an independently mountable Cordis Loader plugin with closed, synchronously validated configuration. Exporter settings SHALL live only in Runtime Preset or Runtime Patch rows; Doppelganger home control configuration, project selection manifests, host options, Runtime Session metadata, and the Runtime Host API SHALL gain no logging destination fields.

#### Scenario: Exporter configuration is malformed
- **ID**: `runtime.logging.config.invalid`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::rejects unknown and invalid exporter configuration through audited activation`
- **WHEN** an exporter row contains an unknown field, invalid bound, unsupported severity, invalid logger filter, or invalid destination configuration
- **THEN** audited Loader activation or candidate reload fails visibly and the prior valid generation remains authoritative

#### Scenario: Project patch adds an exporter
- **ID**: `runtime.logging.config.patch-opt-in`
- **EVIDENCE**: `planned:packages/host-omp/tests/runtime-logging.spec.ts::activates a file exporter only through an explicit Runtime Patch`
- **WHEN** an ordered user or project Runtime Patch inserts a valid exporter row into the selected Runtime Preset
- **THEN** the exporter activates for that Runtime Session without changing preset selection, host configuration, or another session

### Requirement: Exporters apply independent severity and logger filters
Every first-party exporter SHALL accept an explicit maximum verbosity plus optional ordered logger-name overrides. Severity SHALL follow Cordis's `error`, `info`, `warn`, and `debug` vocabulary while configuration SHALL use names rather than numeric levels. Filtering SHALL occur before destination queueing or network work.

#### Scenario: File and Sentry use different filters
- **ID**: `runtime.logging.filter.independent-exporters`
- **EVIDENCE**: `planned:packages/composition-runtime/tests/runtime-logging.spec.ts::applies severity and logger filters independently per sink`
- **WHEN** one file exporter admits `debug` for a selected logger and one Sentry exporter admits only `error`
- **THEN** each destination receives exactly the records admitted by its own configuration

### Requirement: Rolling file exporter writes durable JSONL records
`@doppelganger/doppelganger-logging-file` SHALL expose a Loader plugin that requires same-realm `doppelgangerLogging`, accepts an explicit absolute file path, creates only the required parent directory, and appends one complete normalized record per UTF-8 JSON line through a serialized writer. It SHALL reject directories, symlinks at the configured active path, and unsupported existing file types. The trusted operator explicitly owns the destination, so the exporter SHALL impose no hidden workspace or Doppelganger-home confinement policy.

#### Scenario: Valid file exporter receives records
- **ID**: `runtime.logging.file.append-jsonl`
- **EVIDENCE**: `planned:packages/extension-logging-file/tests/file-exporter.spec.ts::appends ordered complete JSONL records at an explicit absolute path`
- **WHEN** a valid file exporter is composed and admitted records are emitted
- **THEN** the configured file contains those immutable records as parseable newline-delimited JSON in delivery order

#### Scenario: Configured path is unsafe to open
- **ID**: `runtime.logging.file.path-rejected`
- **EVIDENCE**: `planned:packages/extension-logging-file/tests/file-exporter.spec.ts::rejects relative directory symlink and unsupported destination paths`
- **WHEN** the configured path is relative or resolves at open time to a directory, symlink, or unsupported file type
- **THEN** the exporter fails activation before accepting records and does not follow or replace the unsafe destination

### Requirement: File rotation is deterministic and bounded
The file exporter SHALL rotate before appending a record that would make the active file exceed configured `maxBytes`, except that one individually bounded record MAY occupy an otherwise empty active file. Rotation SHALL close the active handle, shift retained files from `<path>.<n>` to `<path>.<n+1>`, move the prior active file to `<path>.1`, delete generations beyond configured `maxFiles`, and reopen a fresh active file. The configured retained-file count SHALL exclude the active file.

#### Scenario: Append crosses the rotation threshold
- **ID**: `runtime.logging.file.rotate-threshold`
- **EVIDENCE**: `planned:packages/extension-logging-file/tests/file-exporter.spec.ts::rotates before the threshold-crossing record and retains exact generations`
- **WHEN** the next serialized JSONL record would exceed `maxBytes` in a non-empty active file
- **THEN** the exporter rotates first and writes the complete record only to the fresh active file

#### Scenario: Rotation exceeds retention
- **ID**: `runtime.logging.file.rotate-retention`
- **EVIDENCE**: `planned:packages/extension-logging-file/tests/file-exporter.spec.ts::deletes only generations beyond the configured retained-file count`
- **WHEN** repeated rotation produces more numbered generations than `maxFiles`
- **THEN** only the active file and exactly the newest configured number of numbered files remain

#### Scenario: Runtime Session disposes with pending writes
- **ID**: `runtime.logging.file.dispose-drain`
- **EVIDENCE**: `planned:packages/extension-logging-file/tests/file-exporter.spec.ts::drains accepted writes and closes the file exactly once on disposal`
- **WHEN** the exporter is disposed while admitted records remain queued
- **THEN** it stops accepting new records, settles all accepted writes within its owned queue, closes the handle, and leaves complete JSON lines

### Requirement: File destination failures remain contained
A file open failure SHALL fail the exporter Loader row. A write, rotate, rename, delete, or close failure after activation SHALL stop that exporter from accepting further destination work, SHALL settle or reject its owned queue deterministically, and SHALL remain contained from the Runtime Session and sibling exporters.

#### Scenario: Active file write fails
- **ID**: `runtime.logging.file.operational-failure`
- **EVIDENCE**: `planned:packages/extension-logging-file/tests/file-exporter.spec.ts::contains operational filesystem failure and stops the failed sink`
- **WHEN** the active destination rejects a write or rotation operation after exporter activation
- **THEN** the file exporter becomes inert without failing the Runtime Session or preventing another registered sink from receiving later records

### Requirement: Sentry exporter is explicit and isolated
`@doppelganger/doppelganger-logging-sentry` SHALL expose a Loader plugin that requires same-realm `doppelgangerLogging` and uses its own manually constructed Sentry client and scope rather than calling global `Sentry.init` or replacing an application's current client. It SHALL disable tracing, profiling, automatic request instrumentation, default PII collection, and unrelated integrations unless this capability later specifies them.

#### Scenario: Sentry exporter activates beside another Sentry user
- **ID**: `runtime.logging.sentry.client-isolation`
- **EVIDENCE**: `planned:packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::uses a private client without mutating global Sentry state`
- **WHEN** the exporter activates in a process that already has unrelated Sentry state
- **THEN** it sends logging events through its own client and scope without reading, replacing, or closing the unrelated client

### Requirement: Sentry credentials are environment-referenced
The Sentry exporter SHALL require `dsnEnv` to name one environment variable and SHALL resolve that exact variable when its Loader generation activates. The value SHALL be non-empty and valid for the Sentry client, SHALL never enter normalized records or diagnostics, and SHALL not fall back to another environment variable, ambient Sentry client, or hard-coded DSN.

#### Scenario: Named Sentry credential is unavailable
- **ID**: `runtime.logging.sentry.credential-required`
- **EVIDENCE**: `planned:packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::fails activation when the exact configured DSN environment variable is unavailable`
- **WHEN** `dsnEnv` is configured but that exact environment variable is missing, empty, or invalid
- **THEN** the Sentry exporter row fails activation without sending a request or exposing the credential value

### Requirement: Sentry maps records to errors and breadcrumbs
The Sentry exporter SHALL add each admitted non-error record as a bounded breadcrumb on its private scope and SHALL submit each admitted `error` record as one event with runtime session, Runtime Preset, logger, severity, and sequence metadata. When the normalized record carries an error description, the exporter SHALL preserve its bounded error semantics; otherwise it SHALL capture the rendered message. It SHALL not send raw Cordis arguments.

#### Scenario: Warning precedes an error
- **ID**: `runtime.logging.sentry.breadcrumb-and-error`
- **EVIDENCE**: `planned:packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::attaches admitted breadcrumbs and runtime correlation to an error event`
- **WHEN** an admitted warning is followed by an admitted error in one Runtime Session
- **THEN** the exporter sends one error event containing the warning breadcrumb and bounded runtime correlation without raw logger arguments

#### Scenario: Network delivery fails
- **ID**: `runtime.logging.sentry.delivery-contained`
- **EVIDENCE**: `planned:packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::contains rejected transport delivery without affecting sibling sinks or the session`
- **WHEN** the private Sentry transport rejects or cannot deliver an accepted event
- **THEN** the exporter contains the failure and does not fail the source logger call, Runtime Session, or sibling exporters

### Requirement: Sentry shutdown is bounded
On exporter replacement, row removal, or Runtime Session disposal, the Sentry exporter SHALL stop accepting records and flush its private client for at most configured `flushTimeoutMs`. Timeout or flush failure SHALL be contained, and the exporter SHALL close only its own client resources.

#### Scenario: Sentry flush completes
- **ID**: `runtime.logging.sentry.dispose-flush`
- **EVIDENCE**: `planned:packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::flushes and closes only the private client during disposal`
- **WHEN** the exporter is disposed with accepted events pending and the transport drains within `flushTimeoutMs`
- **THEN** it completes its private flush and closes its client before disposal settles

#### Scenario: Sentry flush times out
- **ID**: `runtime.logging.sentry.dispose-timeout`
- **EVIDENCE**: `planned:packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::bounds shutdown when the private transport does not drain`
- **WHEN** the private Sentry transport does not drain within `flushTimeoutMs`
- **THEN** exporter disposal settles without extending the configured deadline or preventing remaining Runtime Session cleanup

### Requirement: OMP transport and UI remain logging-neutral
The OMP adapter and child protocol SHALL add no ordinary runtime-log RPC method, notification, host callback, projected context, tool, or UI output. The child SHALL keep stdout exclusively for framed JSON-RPC and SHALL retain its existing bounded stderr history only for emergency process and transport diagnostics; configured file and Sentry exporters SHALL operate inside the child Runtime Session.

#### Scenario: OMP child writes configured file logs
- **ID**: `runtime.logging.omp.file-without-rpc`
- **EVIDENCE**: `planned:packages/host-omp/tests/runtime-logging.spec.ts::writes configured child file logs without changing framed RPC or host reports`
- **WHEN** an OMP Runtime Session explicitly composes the file exporter and a plugin emits admitted records
- **THEN** records reach the configured child-owned file without appearing in OMP output or adding a logging wire message

#### Scenario: OMP session omits exporters
- **ID**: `runtime.logging.omp.default-silent`
- **EVIDENCE**: `planned:packages/host-omp/tests/runtime-logging.spec.ts::keeps exporter-omitting OMP sessions silent and preserves stdout framing`
- **WHEN** an OMP Runtime Session uses the shipped standard preset or another exporter-omitting composition
- **THEN** ordinary plugin logs neither corrupt stdout framing nor appear in the OMP conversation, terminal UI, or child stderr diagnostic history
