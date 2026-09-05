## MODIFIED Requirements

### Requirement: Exporter configuration is Loader-owned and strict
Each first-party exporter SHALL be an independently mountable Cordis Loader plugin with closed, synchronously validated configuration. Exporter settings SHALL live only in Runtime Preset or Runtime Patch rows; Doppelganger home control configuration, project selection manifests, host options, Runtime Session metadata, and the Runtime Host API SHALL gain no logging destination fields.
Each exporter SHALL have one canonical admission contract shared by its direct normalizer and Loader schema, including unknown fields, omissions, defaults, string units, numeric limits and paired destination fields. Direct calls SHALL enforce the existing Loader limits of 4096 characters for file path/pathTemplate and 256 characters for Sentry dsnEnv. Admission SHALL remain side-effect-free; credential resolution and destination acquisition SHALL remain activation-owned. Existing static path behavior, activation-derived templates and activation correlation SHALL remain intact.

#### Scenario: Exporter configuration is malformed
- **ID**: `runtime.logging.config.invalid`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::rejects unknown and invalid exporter configuration through audited activation`
- **WHEN** an exporter row contains an unknown field, invalid bound, unsupported severity, invalid logger filter, or invalid destination configuration
- **THEN** audited Loader activation or candidate reload fails visibly and the prior valid generation remains authoritative

#### Scenario: Project patch adds an exporter
- **ID**: `runtime.logging.config.patch-opt-in`
- **EVIDENCE**: `packages/composition-runtime/tests/runtime-logging.spec.ts::activates a file exporter only through an explicit Runtime Patch`
- **WHEN** an ordered user or project Runtime Patch inserts a valid exporter row into the selected Runtime Preset
- **THEN** the exporter activates for that Runtime Session without changing preset selection, host configuration, or another session

#### Scenario: File configuration uses either public entrypoint
- **ID**: `runtime.logging.config.file-admission-parity`
- **EVIDENCE**: `packages/extension-logging-file/tests/file-exporter.spec.ts::uses identical direct and Loader file configuration admission`
- **WHEN** the same valid or invalid file configuration enters through its direct normalizer and actual Loader schema
- **THEN** both apply the same defaults, path/template constraints and bounds and reject malformed input before opening a destination

#### Scenario: Sentry configuration uses either public entrypoint
- **ID**: `runtime.logging.config.sentry-admission-parity`
- **EVIDENCE**: `packages/extension-logging-sentry/tests/sentry-exporter.spec.ts::uses identical direct and Loader Sentry configuration admission`
- **WHEN** the same valid or invalid Sentry configuration enters through its direct normalizer and actual Loader schema
- **THEN** both apply the same omission/default rules and bounded credential-reference configuration without resolving credentials or opening a client during validation
