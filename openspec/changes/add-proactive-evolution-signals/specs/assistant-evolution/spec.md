## ADDED Requirements

### Requirement: Evolution captures only committed lifecycle evidence
When proactive signal capture is enabled, Evolution SHALL observe completed `turn-committed` events and their correlated `tool-completed` events through the existing host-neutral lifecycle protocol. It SHALL ignore partial turns, failed or cancelled turns, session disposal, and uncommitted tool activity. Re-delivery of the same lifecycle event SHALL be idempotent by stable delivery identity, and stored signal provenance SHALL retain stable session, turn, call, and delivery identifiers without persisting an unbounded raw transcript.

#### Scenario: Completed turn contains correlated tool outcomes
- **ID**: `evolution.signals.committed-correlated-capture`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::captures one committed turn with correlated tool outcomes and bounded provenance`
- **WHEN** completed tool outcomes are followed by a completed committed turn with the same session and turn identity
- **THEN** Evolution evaluates the bounded turn material and correlated tool outcomes once and records only validated signal summaries and provenance

#### Scenario: Turn delivery is retried
- **ID**: `evolution.signals.delivery-idempotency`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::deduplicates correlated deliveries and ignores uncommitted work`
- **WHEN** the host publishes the same committed turn delivery more than once
- **THEN** Evolution records no duplicate signal, aggregate evidence, promotion, or proposal mutation

#### Scenario: Work is not committed successfully
- **ID**: `evolution.signals.uncommitted-ignored`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::deduplicates correlated deliveries and ignores uncommitted work`
- **WHEN** a turn is partial, failed, cancelled, or only disposed without a completed commit
- **THEN** Evolution creates no signal or proposal from that work

### Requirement: Signal extraction is deterministic with optional structured inference
Evolution SHALL always provide a deterministic built-in extractor and MAY additionally call the session-scoped `doppelgangerInference` service when inference-assisted extraction is explicitly enabled. Both paths SHALL receive only size-bounded, credential-screened committed material and SHALL produce bounded Persona or capability hypotheses with a normalized pattern key, summary, proposed scope, severity, and likely reuse value. Evolution SHALL define the exact transport-neutral JSON Schema supplied to inference and SHALL boundary-validate the returned value again as untrusted data. Extracted text SHALL never become instruction-authority context or execution authority. The coordinator SHALL derive recurrence from distinct stored provenance and novelty from the current authoritative proposal and aggregate state rather than trusting inferred claims.

#### Scenario: Deterministic evidence repeats
- **ID**: `evolution.signals.deterministic-extractor`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::extracts deterministic correction and tool-failure patterns without structured inference`
- **WHEN** committed work contains a supported explicit correction, limitation, or repeated structured tool-failure pattern
- **THEN** the built-in extractor emits a canonical bounded signal without requiring an inference provider or host-specific API

#### Scenario: Inference returns malformed or sensitive output
- **ID**: `evolution.signals.inference-boundary`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::rejects malformed secret-bearing and authority-shaped inference output`
- **WHEN** structured inference returns an unknown field, invalid factor, unsupported scope, credential-shaped content, oversized value, or instruction-shaped payload
- **THEN** Evolution rejects that output diagnostically and preserves unrelated deterministic signals and host work

### Requirement: Extraction runs through a bounded fail-open worker
Evolution SHALL NOT await model-assisted extraction or proposal promotion in the host lifecycle publication path. It SHALL use one session-owned serialized worker with explicit queue and material bounds, deterministic overload behavior, cancellation, and Cordis-scoped disposal. Inference absence, timeout, cancellation, provider failure, invalid output, persistence failure, or promotion failure SHALL be contained as bounded diagnostics and SHALL NOT fail the committed host turn or stop later queued work. If inference is disabled or unavailable, the worker SHALL continue with deterministic extraction only.

#### Scenario: Inference is slow
- **ID**: `evolution.signals.async-nonblocking`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::returns from lifecycle delivery before slow structured inference settles`
- **WHEN** the inference provider remains pending after a committed event is accepted
- **THEN** lifecycle publication completes without awaiting inference and the serialized worker continues processing within its configured bounds

#### Scenario: Queue reaches its configured limit
- **ID**: `evolution.signals.overload-policy`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::applies deterministic queue bounds and reports dropped extraction work`
- **WHEN** accepted committed material exceeds the configured pending-work limit
- **THEN** Evolution applies its documented deterministic drop policy, emits a bounded diagnostic, and never grows an unbounded queue

#### Scenario: Runtime Session is disposed
- **ID**: `evolution.signals.disposal-cancels-work`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::aborts in-flight inference and prevents post-disposal writes`
- **WHEN** the owning Evolution plugin scope is disposed or replaced
- **THEN** queued work is cleared, in-flight inference is aborted, no stale generation writes afterward, and disposal does not wait indefinitely

### Requirement: Signals aggregate deterministically before proposal promotion
Evolution SHALL persist validated signal summaries in its plugin-owned global SQLite namespace, partitioned by Persona Instance, bound actor, and optional current project identity. It SHALL aggregate by kind, scope, and normalized pattern key using distinct committed turns and sessions, preserve bounded evidence, and apply a versioned deterministic promotion policy based on recurrence, novelty, severity, and likely reuse value. A one-off weak observation SHALL NOT create a proposal, and configurable thresholds SHALL NOT permit bypassing kind-specific minimum independent evidence requirements.

#### Scenario: Weak observation occurs once
- **ID**: `evolution.signals.weak-observation-retained`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::retains weak evidence without promoting a proposal`
- **WHEN** one valid low-support signal has not met the configured and kind-specific evidence threshold
- **THEN** Evolution retains only the bounded aggregate and creates no Persona or capability proposal

#### Scenario: Recurring pattern crosses its threshold
- **ID**: `evolution.signals.threshold-promotion`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::captures deterministic committed evidence by default and deduplicates lifecycle retries`
- **WHEN** distinct committed evidence makes one novel and reusable aggregate satisfy its versioned promotion policy
- **THEN** Evolution promotes it exactly once into an ordinary proposal using a deterministic operation identity and deduplication key

#### Scenario: Equivalent active proposal already exists
- **ID**: `evolution.signals.existing-proposal-deduplicated`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::replays crash-safe promotion linkage and suppresses terminal dedupe collisions`
- **WHEN** a promotable aggregate matches an active proposal in the same authoritative scope
- **THEN** Evolution uses the existing exact proposal deduplication contract and does not create a second proposal

### Requirement: Automatically promoted proposals remain inert and correctly scoped
Automatic promotion SHALL use the existing Evolution proposal schema, authoritative store selection, immutable history, credential policy, and actor partition. Persona hypotheses SHALL promote only to global Persona proposals after evidence from the required distinct Runtime Sessions. Project-specific capability hypotheses SHALL promote only to canonical project YAML when an absolute current workspace is available; unavailable project scope SHALL remain pending with a diagnostic and SHALL NOT fall back to global storage. Automatic promotion SHALL NOT advance a proposal beyond `proposed` or invoke review, research, planning, implementation, Persona revision, code execution, package installation, Runtime Preset editing, or host plugins.

#### Scenario: Persona pattern meets promotion policy
- **ID**: `evolution.signals.persona-global-only`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::requires cross-session Persona evidence and promotes only to global proposed state`
- **WHEN** a stable Persona-quality aggregate has enough evidence from distinct Runtime Sessions
- **THEN** Evolution creates or deduplicates one global Persona proposal in `proposed` state and performs no Persona inspection or revision

#### Scenario: Project signal has no workspace
- **ID**: `evolution.signals.project-without-workspace`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::keeps project promotion pending when workspace metadata is unavailable`
- **WHEN** a promotable capability aggregate requires project scope but the Runtime Session has no absolute workspace root
- **THEN** Evolution records a diagnostic and leaves the aggregate pending without creating global state as a fallback

#### Scenario: Proposal is promoted automatically
- **ID**: `evolution.signals.proposal-remains-inert`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::promotes lifecycle evidence through generic OMP events while preserving every consent gate`
- **WHEN** lifecycle evidence causes automatic proposal promotion through a compatible host
- **THEN** the proposal is only available for ordinary inspection and reminder selection until the user explicitly starts its existing owning workflow

### Requirement: Proactive signal and inference policy is configurable and omission-neutral
Evolution SHALL expose strict serializable configuration for enabling proactive capture, explicitly enabling inference-assisted extraction, bounded event material, worker capacity, inference timeout, retention, and promotion thresholds. Proactive capture SHALL be enabled by default only when the optional Evolution plugin is composed; inference-assisted extraction SHALL remain disabled until explicitly enabled and SHALL require a composed `doppelgangerInference` provider in the same session isolation realm. Operators SHALL be able to disable proactive capture while retaining ordinary Evolution controls. Invalid configuration or inference enablement without the required provider SHALL fail Evolution activation visibly. Presets that omit Evolution SHALL receive no lifecycle subscriber, signal state, worker, diagnostics, proposals, inference call, or behavior change.

#### Scenario: Evolution is composed with signal capture disabled
- **ID**: `evolution.signals.explicitly-disabled`
- **EVIDENCE**: `packages/extension-evolution/tests/protocol.spec.ts::preserves proposal-only behavior when proactive capture is disabled`
- **WHEN** valid Evolution configuration disables proactive signal capture
- **THEN** existing proposal tools, reminders, and consent workflows remain available while no lifecycle evidence is captured, inferred, or promoted

#### Scenario: Inference-assisted extraction is not enabled
- **ID**: `evolution.signals.inference-opt-in`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::uses deterministic extraction only until inference is explicitly enabled`
- **WHEN** Evolution is composed without explicit inference-assisted extraction enablement, whether or not an inference provider exists
- **THEN** Evolution performs no model call and continues the bounded deterministic signal pipeline

#### Scenario: Inference is enabled without a provider
- **ID**: `evolution.signals.inference-provider-required`
- **EVIDENCE**: `packages/composition-runtime/tests/inference.spec.ts::resolves an Evolution inference dependency after a later provider row and rejects omission only when enabled`
- **WHEN** Evolution configuration enables inference-assisted extraction but the effective Runtime Session provides no `doppelgangerInference` service in the matching isolation realm
- **THEN** activation or reload fails visibly before lifecycle listeners register and the previous valid generation remains active

#### Scenario: Evolution is omitted
- **ID**: `evolution.signals.omission-neutral`
- **EVIDENCE**: `packages/composition-runtime/tests/evolution.spec.ts::activates an arbitrary isolated Runtime Preset and remains neutral when omitted`
- **WHEN** a Runtime Preset does not compose Evolution
- **THEN** activation, lifecycle delivery, storage, prompt context, tools, Persona, and memory remain unchanged

#### Scenario: Stored signal state exceeds retention limits
- **ID**: `evolution.signals.retention-bounded`
- **EVIDENCE**: `packages/extension-evolution/tests/signals.spec.ts::coalesces bounded credential-safe diagnostics and prunes internal state only`
- **WHEN** signal, receipt, diagnostic, or aggregate state exceeds its configured age or count bound
- **THEN** Evolution prunes eligible internal signal state deterministically while preserving ordinary proposal records and immutable proposal history
