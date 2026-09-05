## 1. Structured Inference Protocol

- [x] 1.1 Add `packages/extension-protocols/src/inference.ts` with bounded request/result/usage types, stable `StructuredInferenceError` codes, Cordis service augmentation, and the public `doppelgangerInference` service constant.
- [x] 1.2 Implement `createStructuredInference` so every provider call validates exact request keys, portable JSON Schema shape and complexity, JSON compatibility, size limits, cancellation, returned value, and deep freezing before exposing a result.
- [x] 1.3 Add Ajv as the protocol package's exact runtime dependency, export the inference contract from `src/index.ts`, and preserve the package's independence from every other Doppelganger package.
- [x] 1.4 Add `packages/extension-protocols/tests/inference.spec.ts` coverage for valid structured calls, malformed requests, unsupported schemas, invalid/oversized results, cancellation, bounded errors, provider substitution, duplicate providers, and omission neutrality.

## 2. Pi Inference Provider

- [x] 2.1 Create `packages/extension-inference-pi` with public and Loader exports, strict NodeNext TypeScript configuration, workspace Cordis peer dependency, protocols dependency, Schemastery configuration, and the exact tested `@earendil-works/pi-ai` release.
- [x] 2.2 Implement strict provider/model, paired custom OpenAI-compatible URL/context-window, `apiKeyEnv`, reasoning, request-timeout, input/output-character, and output-token configuration validation with documented safe defaults and unknown-key rejection.
- [x] 2.3 Build one immutable Pi provider/model snapshot from the SDK's installed catalogs or one explicit OpenAI-compatible route, fail activation for unknown or invalid routes or models, and retain captured generations across valid Loader replacement.
- [x] 2.4 Adapt each structured request to Pi `completeSimple` with one schema-shaped result tool, constrained-sampling preference, explicit cancellation, timeout, output cap, optional reasoning, and `maxRetries: 0`; never execute a returned tool call.
- [x] 2.5 Normalize exactly one returned result call and bounded usage through `createStructuredInference`; reject missing, conflicting, malformed, oversized, error, and aborted SDK outcomes without returning prompts, text, thinking, payloads, diagnostics, or credentials.
- [x] 2.6 Resolve a configured environment credential per call with fail-loud no-fallback semantics, permit SDK ambient auth only when no reference is configured, and store no credentials or login state.
- [x] 2.7 Register the new package and dependency edge in `scripts/package-boundaries.json`, add it to the OMP distribution dependencies, and keep the shipped `standard` Runtime Preset unchanged.
- [x] 2.8 Add Pi faux-provider tests for structured completion, usage, missing result, invalid arguments, named credential failure, ambient-auth selection, timeout, caller abort, no SDK retry, immutable reload snapshots, and disposal without network access.

## 3. Evolution Signal Contracts and Migration

- [x] 3.1 Add strict signal material, hypothesis, occurrence, aggregate, diagnostic, inference prompt/schema, and policy types to `packages/extension-evolution`, including deep validation, credential rejection, normalized pattern keys, and package exports.
- [x] 3.2 Replace the Evolution SQLite version-1 exact initializer with an additive version-2 migration that preserves existing proposal rows and creates partitioned signal receipts, occurrences, aggregates, diagnostics, and metadata tables with required indexes.
- [x] 3.3 Add migration fixtures and focused tests proving fresh version-2 initialization, version-1 proposal preservation, unsupported-version failure, actor/Persona partition isolation, and no project YAML mutation.

## 4. Signal Storage and Promotion State

- [x] 4.1 Implement a `GlobalEvolutionSignalStore` that transactionally deduplicates committed delivery IDs, inserts bounded occurrences, updates aggregates from distinct turn/session provenance, and exposes eligible pending promotions.
- [x] 4.2 Implement deterministic signal/inference diagnostic persistence, coalescing, bounded listing, and credential-safe projection through existing Evolution list/inspect diagnostics.
- [x] 4.3 Implement incremental age/count pruning for receipts, occurrences, diagnostics, and pending aggregates while preserving promoted proposals and immutable proposal evidence/history.
- [x] 4.4 Implement deterministic promotion operation IDs, dedupe keys, proposal evidence projection, aggregate linkage, terminal-collision suppression, and crash-safe replay across SQLite aggregates and project YAML proposals.

## 5. Extraction and Correlation

- [x] 5.1 Implement the deterministic extractor for structured failed-tool patterns, explicit English/Russian principal corrections, and explicit English/Russian assistant limitation markers using fixed bounded templates.
- [x] 5.2 Define the exact bounded Evolution hypothesis JSON Schema and fixed system instruction that marks committed lifecycle material as untrusted data and forbids instruction following, actor/Persona overrides, recurrence/novelty claims, credentials, or execution requests.
- [x] 5.3 Implement optional inference-assisted extraction through `doppelgangerInference`, revalidate each returned hypothesis with Evolution content/scope/authority policy, merge valid inferred hypotheses without replacing deterministic results, and contain invalid items independently.
- [x] 5.4 Implement bounded in-memory correlation of `tool-completed` events by session/turn/delivery identity, deterministic tool-outcome truncation, orphan expiry, and cleanup when a turn commits unsuccessfully.
- [x] 5.5 Implement committed-turn material screening and bounding so credentials, partial work, uncommitted tool activity, complete prompts, and raw inference output are never persisted as signal state.

## 6. Bounded Worker and Lifecycle Integration

- [x] 6.1 Implement one FIFO session worker whose lifecycle listeners enqueue and return immediately without exposing inference, storage, or promotion promises to lifecycle publication.
- [x] 6.2 Implement queue capacity, oldest-pending drop policy, coalesced overload diagnostics, inference timeout, provider-failure isolation, deterministic-only fallback, and continuation after invalid or failed jobs.
- [x] 6.3 Implement Cordis-scoped worker disposal with generation closure, queue clearing, active abort, observed detached promises, bounded shutdown, and prevention of stale post-reload writes.
- [x] 6.4 Register the signal capture child plugin after the existing Evolution service/protocol plugins; conditionally require same-realm `doppelgangerInference` only when inference-assisted extraction is enabled.
- [x] 6.5 Prove duplicate lifecycle delivery, failed/cancelled turns, inference absence while disabled, explicit capture disable, and session disposal create no duplicate, model-assisted, or invalid state.

## 7. Promotion Policy and Evolution Configuration

- [x] 7.1 Implement versioned policy scoring from distinct recurrence, cross-session Persona stability, computed novelty, validated severity, and validated reuse value without trusting inferred recurrence, novelty, or confidence.
- [x] 7.2 Enforce capability minimum distinct turns, Persona minimum distinct sessions, reusable-value floor, configurable safe score threshold, and suppression of weak or inference-only observations.
- [x] 7.3 Extend strict Loader configuration and Schemastery metadata with proactive enablement, explicit inference enablement, material, tool correlation, queue, inference timeout, retention, occurrence, and promotion bounds; reject unknown or unsafe values before listener registration.
- [x] 7.4 Preserve default-on deterministic capture for composed Evolution, default-off inference calls, explicit `proactiveSignalsEnabled: false` proposal-only behavior, fail-loud inference enablement without a provider, and complete neutrality when either provider or Evolution rows are omitted.
- [x] 7.5 Update the stable Evolution instruction contribution to state that automatically discovered proposals are inert, consent-gated, and never interrupt primary work.

## 8. Behavioral Verification

- [x] 8.1 Add `packages/extension-evolution/tests/signals.spec.ts` coverage for committed correlation, retries, deterministic extraction, inference opt-in, exact inference schema/prompt, invalid inference output, non-blocking delivery, overload, disposal, retention, aggregation, deduplication, scope, and inert promotion scenarios named in both delta specs.
- [x] 8.2 Extend existing Evolution proposal/storage/protocol tests for merged diagnostics, unchanged seven-tool projection, unchanged explicit proposal workflows, exact proposal state, migration compatibility, and absence of prompts or raw inference results from durable stores.
- [x] 8.3 Extend Composition Runtime tests for inference provider composition/omission, duplicate provider failure, Pi replacement snapshots, Evolution inference dependency, invalid rollback, explicit disable, and omitted-row neutrality without adding a second watcher or host-specific path.
- [x] 8.4 Add one real OMP child integration scenario that publishes generic correlated tool/turn lifecycle events across independent sessions, uses a deterministic public-contract inference provider, observes one automatically promoted proposal, and proves review/research/implementation remain unstarted.
- [x] 8.5 Run the narrow protocols, Pi inference, Evolution, Composition Runtime, OMP distribution, and host-OMP typechecks/tests plus the real project-local OMP smoke; fix every observed regression before broad verification.

## 9. Documentation and Final Checks

- [x] 9.1 Update `docs/architecture/overview.md` and `docs/architecture/protocols.md` with the optional structured-inference seam, package topology, host/runtime boundary, provider substitution, and primary implementation.
- [x] 9.2 Update `docs/features/evolution.md` with signal lifecycle, deterministic/inference-assisted extraction, explicit cost/network opt-in, aggregation policy, storage/privacy boundary, diagnostics, retention, consent guarantees, reload, rollback, and primary evidence.
- [x] 9.3 Update `docs/operations/configuration.md`, `docs/operations/verification.md`, `docs/project/status-and-scope.md`, `docs/README.md` when ownership links change, and package setup guidance with exact inference and Evolution configuration ranges and operational behavior.
- [x] 9.4 Reconcile the live `structured-inference` and `assistant-evolution` specifications and every scenario evidence reference with implemented tests; keep archived OpenSpec artifacts historical rather than duplicating current documentation.
- [x] 9.5 Run `npm run check` and report unresolved registry-backed security work separately; do not claim success without focused inference conformance, Pi faux-provider, lifecycle-to-proposal, and complete workspace checks passing.
