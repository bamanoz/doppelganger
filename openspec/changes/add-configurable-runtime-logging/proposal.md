## Why

Doppelganger plugins already emit operational messages through Cordis `ctx.logger`, but without a configured exporter those messages remain effectively invisible while activation snapshots and bounded child stderr reveal only selected failures. Doppelganger needs explicit, session-isolated logging destinations that operators can compose without sending routine logs into OMP, corrupting its stdout RPC transport, or enabling any output by default.

## What Changes

- Add a session-scoped runtime logging router that observes Cordis log records before the authored Loader tree activates, correlates records to the owning Runtime Session, retains only a bounded early buffer, and contains sink failures.
- Expose a small public sink-registration contract so first-party and future trusted Cordis Loader plugins can receive normalized runtime records without depending on a concrete host.
- Add an opt-in rolling JSONL file exporter with an explicitly configured absolute path, severity and logger filters, bounded record rendering, serialized writes, deterministic size-based rotation, retained-file limits, reload cutover, and exhaustive disposal.
- Add an opt-in Sentry exporter that resolves its DSN only from a named environment variable, sends configured error events and lower-severity breadcrumbs, bounds payloads, and flushes within a configured disposal deadline without controlling Runtime Session health.
- Keep the shipped `standard` Runtime Preset and every exporter-omitting composition silent: no stdout, stderr, host UI, RPC notification, file, network request, or background exporter work is produced by the new capability.
- Preserve OMP stdout exclusively for framed JSON-RPC. Logging destinations run inside the child Runtime Session; ordinary logs are not projected into the OMP conversation or terminal UI, and child stderr remains only the existing emergency process-diagnostic channel.
- Permit several exporter rows in one Runtime Session. Each independently filters and consumes the same session-owned records, owns its resources through Cordis effects, and cannot prevent sibling exporters or the runtime from continuing when it fails.
- Do not add a new logging framework, daemon, global configuration section, generic host notification channel, telemetry protocol, or first-party console exporter. Plugins continue to use the existing Cordis `ctx.logger` API.

## Capabilities

### New Capabilities

- `runtime-logging`: Define default-off session logging, the sink contract, bounded early capture, exporter isolation, rolling JSONL files, Sentry delivery, Loader composition, reload/disposal behavior, and OMP transport neutrality.

### Modified Capabilities

None. Existing Runtime Preset, Composition Runtime, Loader composition, and OMP guarantees remain valid; the new capability adds optional behavior without changing their established contracts.

## Impact

- Affected implementation: Composition Runtime session ownership and Fiber correlation; new logging contract/router code; new `@doppelganger/doppelganger-logging-file` and `@doppelganger/doppelganger-logging-sentry` Loader packages; the private OMP install dependency closure; package-boundary and workspace manifests; focused tests and disposable filesystem/Sentry fixtures.
- Affected configuration: exporter settings remain entirely inside explicit Loader rows in Runtime Presets or ordered Runtime Patches. Runtime-owned `config.yaml`, project selection manifests, host options, and Runtime Session metadata gain no logging fields.
- Affected hosts: OMP gains no logging RPC method, callback, projected tool, or UI. The planned native DSH adapter can compose the same portable exporters in-process and may continue using DSH's own logger for host-owned diagnostics.
- Affected documentation: system overview, composition and reload, configuration, OMP failure/transport behavior, verification guidance, project scope, and a new logging feature owner indexed from `docs/README.md`.
- Compatibility: compositions that omit exporters remain behaviorally unchanged. Invalid exporter configuration fails the affected Loader generation; operational destination failures after activation are contained and cannot terminate the Runtime Session or disable sibling exporters.
