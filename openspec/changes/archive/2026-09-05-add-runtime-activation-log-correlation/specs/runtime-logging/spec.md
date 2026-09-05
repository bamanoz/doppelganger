## ADDED Requirements

### Requirement: Runtime logging exposes one concrete activation identity
Composition Runtime SHALL generate one opaque bounded path-component-safe `runtimeActivationId` for every Runtime Session activation. It SHALL expose an immutable logging scope containing `runtimeActivationId`, host `sessionId`, and Runtime Preset ID through the session-isolated `doppelgangerLogging` service before exporter rows activate. The activation ID SHALL remain stable across Loader reload, rollback, and exporter replacement for that session owner, while every newly activated Runtime Session SHALL receive a new value even when the host reuses a logical `sessionId`.

#### Scenario: Loader generation reloads
- **ID**: `runtime.logging.activation-correlation.reload-stable`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::activates a file exporter only through an explicit Runtime Patch`
- **WHEN** a Runtime Session commits or rolls back one or more Loader generations
- **THEN** `doppelgangerLogging.scope.runtimeActivationId` and every subsequent normalized record retain the activation ID created for that session owner

#### Scenario: Logical session activates twice
- **ID**: `runtime.logging.activation-correlation.new-activation`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::creates distinct activation identities when a logical session ID is reused`
- **WHEN** two concrete Runtime Session activations use the same host `sessionId`
- **THEN** they expose distinct `runtimeActivationId` values while preserving the common host session correlation

### Requirement: File exporter resolves activation path templates safely
The file exporter SHALL accept either the existing static absolute normalized `path` or a mutually exclusive absolute normalized `pathTemplate`. A template SHALL contain exactly one `{runtimeActivationId}` token and no other placeholder or unmatched placeholder syntax. During Loader activation, before opening the writer or registering its sink, the exporter SHALL replace that token with `doppelgangerLogging.scope.runtimeActivationId` and SHALL validate the resolved concrete path against the same absolute and normalization rules as a static path. All writer safety, rotation, failure, and disposal behavior SHALL apply to the resolved concrete path.

#### Scenario: Concurrent Runtime Sessions use one authored template
- **ID**: `runtime.logging.file.template-concurrent-sessions`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::resolves one path template to isolated files for concurrent Runtime Sessions`
- **WHEN** concurrent Runtime Sessions compose the same valid `pathTemplate`
- **THEN** each exporter opens and rotates a distinct concrete path derived from its own activation ID without sharing an active file

#### Scenario: Concurrent OMP children use one authored template
- **ID**: `runtime.logging.file.template-concurrent-processes`
- **EVIDENCE**: `packages/host-omp/tests/runtime-logging.spec.ts::isolates concurrent OMP children using one authored path template and logical session ID`
- **WHEN** separate OMP child processes activate Runtime Sessions from the same Runtime Preset and file path template
- **THEN** each child writes complete records to its own activation-derived file without interprocess rotation coordination or RPC output

#### Scenario: File template is malformed
- **ID**: `runtime.logging.file.template-invalid`
- **EVIDENCE**: `packages/extension-logging-file/tests/file-exporter.spec.ts::rejects unknown fields, invalid bounds, invalid levels, and invalid path forms`
- **WHEN** file exporter configuration supplies both path forms, neither path form, a relative or non-normalized template, a missing or repeated activation token, an unknown token, or unmatched placeholder syntax
- **THEN** synchronous configuration validation rejects the Loader generation before any destination file or sink is created

#### Scenario: Static file path remains configured
- **ID**: `runtime.logging.file.static-path-compatible`
- **EVIDENCE**: `packages/extension-logging-file/tests/file-exporter.spec.ts::resolves one activation placeholder while preserving static paths`
- **WHEN** a file exporter uses the existing `path` field without `pathTemplate`
- **THEN** it opens the exact configured concrete path and retains the documented one-operating-system-process-per-concrete-path invariant

## MODIFIED Requirements

### Requirement: Normalized records are bounded and transport-neutral
Each runtime log record SHALL contain only validated JSON-compatible fields: runtime activation identity, router sequence, timestamp, severity, logger name, rendered message, Runtime Session ID, Runtime Preset ID, and an optional bounded error description. Rendering SHALL handle cyclic, throwing, oversized, and non-JSON Cordis arguments without throwing from the source plugin call, and SHALL enforce configured repository-wide maximum lengths before a sink receives the record. The record's `runtimeActivationId` SHALL equal the immutable activation identity exposed by the owning session's `doppelgangerLogging` scope.

#### Scenario: Plugin logs hostile arguments
- **ID**: `runtime.logging.record.hostile-arguments`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::normalizes cyclic throwing and oversized Cordis logger arguments within bounds`
- **WHEN** a plugin logs cyclic objects, values with throwing inspection hooks, errors, symbols, functions, or oversized strings
- **THEN** the router emits a bounded immutable JSON-compatible record or a bounded rendering marker without propagating an exception to the plugin

#### Scenario: Record carries session and activation correlation
- **ID**: `runtime.logging.record.session-correlation`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::routes existing ctx.logger calls without a replacement logging facade`
- **WHEN** a session-owned Cordis log message is normalized
- **THEN** the record identifies the concrete runtime activation, owning Runtime Session, and Runtime Preset without adding logging fields to general Runtime Session metadata

### Requirement: Rolling file exporter writes durable JSONL records
`@doppelganger/doppelganger-logging-file` SHALL expose a Loader plugin that requires same-realm `doppelgangerLogging`, accepts exactly one static absolute file `path` or activation `pathTemplate`, resolves any template before writer creation, creates only the required resolved parent directory, and appends one complete normalized record per UTF-8 JSON line through a serialized writer. It SHALL reject directories, symlinks at the resolved active path, and unsupported existing file types. The trusted operator explicitly owns the destination, so the exporter SHALL impose no hidden workspace or Doppelganger-home confinement policy.

#### Scenario: Valid file exporter receives records
- **ID**: `runtime.logging.file.append-jsonl`
- **EVIDENCE**: `packages/extension-logging-file/tests/file-exporter.spec.ts::appends ordered complete JSONL records at an explicit absolute path`
- **WHEN** a valid static or activation-templated file exporter is composed and admitted records are emitted
- **THEN** the resolved file contains those immutable records as parseable newline-delimited JSON in delivery order

#### Scenario: Configured or resolved path is unsafe to open
- **ID**: `runtime.logging.file.path-rejected`
- **EVIDENCE**: `packages/extension-logging-file/tests/file-exporter.spec.ts::rejects relative directory symlink and unsupported destination paths`
- **WHEN** the configured path form is invalid or resolves at open time to a directory, symlink, or unsupported file type
- **THEN** the exporter fails activation before accepting records and does not follow or replace the unsafe destination

### Requirement: Sentry maps records to errors and breadcrumbs
The Sentry exporter SHALL add each admitted non-error record as a bounded breadcrumb carrying concrete runtime activation, Runtime Session, Runtime Preset, logger, severity, and sequence correlation. It SHALL submit each admitted `error` record as one event with the same correlation in tags or context. When the normalized record carries an error description, the exporter SHALL preserve its bounded error semantics; otherwise it SHALL capture the rendered message. It SHALL not send raw Cordis arguments.

#### Scenario: Warning precedes an error
- **ID**: `runtime.logging.sentry.breadcrumb-and-error`
- **EVIDENCE**: `packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::attaches admitted breadcrumbs and runtime correlation to an error event`
- **WHEN** an admitted warning is followed by an admitted error in one Runtime Session
- **THEN** the exporter sends one error event containing the warning breadcrumb and bounded activation, session, and Runtime Preset correlation without raw logger arguments

#### Scenario: Separate activations share a logical session
- **ID**: `runtime.logging.sentry.activation-correlation`
- **EVIDENCE**: `packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::keeps private clients and breadcrumbs isolated across activations sharing one logical session`
- **WHEN** Sentry receives records from concrete activations that use the same host `sessionId`
- **THEN** their breadcrumbs and error events remain distinguishable by `runtimeActivationId`

#### Scenario: Network delivery fails
- **ID**: `runtime.logging.sentry.delivery-contained`
- **EVIDENCE**: `packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::contains rejected transport delivery without affecting the caller`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::contains throwing and rejecting sinks without losing healthy siblings`
- **WHEN** the private Sentry transport rejects or cannot deliver an accepted event
- **THEN** the exporter contains the failure and does not fail the source logger call, Runtime Session, or sibling exporters
