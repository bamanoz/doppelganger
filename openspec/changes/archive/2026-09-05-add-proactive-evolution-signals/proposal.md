## Why

Doppelganger Evolution can preserve and revisit opportunities once the active assistant explicitly proposes them, but it has no durable mechanism that turns recurring committed-work evidence into proposals when the assistant does not notice or record the pattern in the foreground turn. A bounded lifecycle-driven signal loop plus an explicitly composed provider-neutral structured-inference service can improve discovery without granting autonomous research, Persona revision, code execution, or implementation authority.

## What Changes

- Extend the optional Evolution plugin with a lifecycle-driven signal pipeline that observes completed `turn-committed` events and their correlated `tool-completed` outcomes through the existing host-neutral lifecycle protocol.
- Persist bounded, credential-screened signals and aggregate them deterministically by stable pattern identity, recurrence, novelty, severity, and likely reuse value.
- Add optional model-assisted extraction through a new host-neutral structured-inference protocol and an independently composed Node-compatible Pi SDK adapter; deterministic extraction remains available without inference, and model calls require explicit Evolution opt-in.
- Promote only sufficiently supported hypotheses into ordinary inert Evolution proposals using the existing authoritative global SQLite or project YAML store, exact deduplication, bounded evidence, and immutable history.
- Make capture, extraction, retention, thresholds, and queue limits explicit Evolution configuration; omission or disabled signal capture preserves current behavior.
- Contain extractor, validation, storage, and disposal failures as bounded diagnostics; overload drops work according to a deterministic policy instead of creating unbounded queues or blocking Runtime Session lifecycle delivery.
- Preserve every current consent boundary: automatic discovery may create proposals only; Persona review, external capability research, planning, implementation, code or configuration mutation, and proposal completion still require their existing user-directed workflows.
- Keep the feature host-neutral and actor-partitioned. No scheduler, background daemon, host-specific integration, autonomous web research, automatic change preparation, or direct dependency on a host's agent loop or model service is introduced.

## Capabilities

### New Capabilities

- `structured-inference`: Add a session-scoped provider-neutral one-shot JSON inference service plus an installable Pi SDK adapter with strict configuration, cancellation, output validation, and omission neutrality.

### Modified Capabilities

- `assistant-evolution`: Add bounded lifecycle signal capture, deterministic and optional inference-assisted hypothesis extraction, aggregation and promotion, diagnostics, retention, configuration, and strict non-execution guarantees to the existing Evolution plugin.

## Impact

- Affected implementation: `packages/extension-protocols` inference contracts, a new `packages/extension-inference-pi` Loader plugin backed by `@earendil-works/pi-ai`, `packages/extension-evolution` model, storage, service, lifecycle subscriber, diagnostics, and focused tests.
- Existing lifecycle events remain the observation transport. Structured inference is a separate optional Runtime Session service; neither path requires a new host API, host callback, or access to the host agent loop.
- Global Evolution storage gains plugin-owned signal, aggregate, receipt, and diagnostic state; project proposal YAML remains the canonical project proposal store and does not become a raw transcript or signal log.
- Affected documentation: protocol architecture, Evolution, configuration and verification guidance, project scope, documentation ownership links if needed, and focused specifications.
- Existing Runtime Presets that omit Evolution or inference, compose Evolution with proactive signal capture disabled, or leave inference-assisted extraction disabled remain behaviorally unchanged.
