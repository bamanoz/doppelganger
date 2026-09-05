## Why

A static rolling-file path cannot safely be shared by concurrent operating-system processes, while the current logging service exposes correlation only after the file exporter has already opened its destination. Runtime logging needs one safe activation identity available to every destination before registration so file paths and remote events can distinguish concrete Runtime Session activations.

## What Changes

- Generate one opaque `runtimeActivationId` for every Composition Runtime activation and keep it stable across Loader reloads for that Runtime Session.
- Expose immutable Runtime Session logging scope through `doppelgangerLogging` and include `runtimeActivationId` in every normalized runtime log record.
- Let the rolling file exporter resolve an explicit `{runtimeActivationId}` placeholder before opening its destination while preserving existing static absolute paths.
- Add `runtimeActivationId` to Sentry event and breadcrumb correlation alongside the existing session and Runtime Preset identifiers.
- Reject unknown or malformed file-path placeholders and keep the resolved destination subject to the existing absolute-path, normalization, symlink, writer, rotation, and disposal rules.
- Verify concurrent in-process sessions, concurrent OMP child processes, HMR stability, static-path compatibility, and destination correlation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-logging`: Add activation-level correlation shared by all destinations and safe per-activation file path resolution.

## Impact

- `packages/composition-runtime`: public logging service and record contracts plus activation identity ownership.
- `packages/extension-logging-file`: path-template validation and resolution before writer creation.
- `packages/extension-logging-sentry`: activation correlation in private Sentry scope and events.
- Runtime logging tests in Composition Runtime, file exporter, Sentry exporter, and real OMP children.
- Authoritative runtime logging, composition, configuration, OMP, and usage documentation.
