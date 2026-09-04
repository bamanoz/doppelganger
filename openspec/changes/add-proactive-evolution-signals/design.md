## Context

Evolution currently coordinates explicit proposals and reminders. Its service owns global actor-partitioned SQLite plus canonical project proposal YAML, while its protocol plugin contributes one instruction policy and seven portable controls. The active assistant must notice an opportunity and call `evolution.propose`; no component consumes committed lifecycle evidence.

The shared lifecycle protocol already publishes bounded, versioned `tool-completed` and `turn-committed` events with stable delivery, session, turn, and call identities. `turn-committed` deliberately excludes tool outcomes, so a signal pipeline must correlate completed tool events in session memory until the enclosing turn commits. Lifecycle subscriber failure is contained by the protocol, but an awaited slow subscriber still delays publication; extraction cannot run inside the listener promise.

The repository has no model-call seam. `@deepseek-ai/dsh-llm` is a strong provider-neutral design reference, but its public package is coupled to DSH attachment, branding, invariant, and timeout contracts. `@oh-my-pi/pi-ai` is tied to the OMP distribution and declares Bun as its runtime. DSH's maintained `@earendil-works/pi-ai` dependency is MIT-licensed, supports Node 22.19 or newer, exposes provider/model catalogs, `completeSimple`, cancellation, usage, structured tool schemas, and a faux provider, and therefore fits a portable Doppelganger adapter without implementing provider HTTP protocols.

The change must preserve Evolution's authority boundary. Automatically discovered material may become an inert `proposed` record only. Persona review, external research, option selection, planning, implementation, and every durable behavior or code mutation remain separately user-directed. Model-assisted local classification is also a network/cost boundary, so Evolution must require explicit Loader opt-in before making inference calls.

## Goals / Non-Goals

**Goals:**

- Discover recurring Persona and capability opportunities from successfully committed work even when the foreground assistant does not explicitly call `evolution.propose`.
- Add one reusable session-scoped structured-inference contract without adding model semantics to the runtime kernel or Runtime Host API.
- Provide an independently composable Node-compatible Pi SDK adapter rather than implementing provider HTTP protocols.
- Keep lifecycle handling bounded, idempotent, credential-screened, non-blocking, disposable, and actor-partitioned.
- Provide a useful deterministic baseline without inference, plus explicitly enabled model-assisted extraction through the generic service.
- Aggregate independent evidence before promotion, suppress weak one-off observations, and deduplicate promoted proposals exactly.
- Make capture, inference enablement, queue, timeouts, retention, and promotion thresholds strict serializable Loader configuration.
- Preserve omission neutrality and permit operators to disable either proactive capture or only model-assisted extraction.

**Non-Goals:**

- An agent loop, streaming chat API, conversation persistence, provider selector UI, tool execution loop, image input, model discovery UI, OAuth/login workflow, retry executor, or generic host model bridge.
- Exposing OMP or DSH native model services, credentials, messages, sessions, or provider clients to Runtime Preset plugins.
- Supporting arbitrary custom gateways in the first Pi adapter; it serves installed Pi provider catalogs and named environment credentials.
- Autonomous Persona inspection or revision, external research, OpenSpec creation, code generation, code execution, package installation, Runtime Preset editing, or proposal lifecycle advancement beyond `proposed`.
- Background daemons, scheduled campaigns, hidden host telemetry, raw transcript storage, remote analytics, or cross-actor learning.
- New host callbacks, host-specific adapter logic, portable tools for editing signals, or a second canonical project store.
- Perfect semantic deduplication or guaranteed discovery of every worthwhile opportunity.

## Decisions

### 1. Add a provider-neutral structured-inference service in `extension-protocols`

Add `inference.ts` to `@doppelganger/doppelganger-protocols` and export the service name `doppelgangerInference`. The service has one one-shot operation:

```ts
interface StructuredInferenceProvider {
  infer(request: StructuredInferenceRequest): Promise<StructuredInferenceResult>
}

interface StructuredInferenceRequest {
  readonly purpose: string
  readonly system: string
  readonly input: string
  readonly outputSchema: Readonly<Record<string, JsonValue>>
  readonly maxOutputTokens?: number
  readonly signal?: AbortSignal
}

interface StructuredInferenceResult {
  readonly value: JsonValue
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens?: number
  }
}
```

The protocol exports `createStructuredInference(provider)`, whose wrapper owns exact request/output validation, deep freezing, schema compilation, size ceilings, and `StructuredInferenceError` codes: `INVALID_REQUEST`, `UNAVAILABLE`, `AUTH`, `TIMEOUT`, `ABORTED`, `PROVIDER_FAILURE`, `MISSING_OUTPUT`, and `INVALID_OUTPUT`. Concrete plugins provide only the wrapped object, so callers cannot bypass the shared boundary. `purpose` is diagnostic classification, not prompt authority or a provider selector. The caller supplies one bounded system instruction and one bounded data input; no history, tools, host context, credentials, or arbitrary provider options cross the seam.

Use Ajv in the protocol package to validate the transport-neutral JSON Schema and returned JSON value. Accept only the documented portable object/array/scalar subset already usable by Doppelganger tool schemas; reject remote references, executable formats, unknown schema keywords, pathological depth/count, non-JSON values, and oversized serialized schemas before dispatch. Provider results are validated again at the service boundary and deeply frozen before return.

A concrete provider plugin wraps its private implementation with `createStructuredInference(...)` and calls `ctx.provide('doppelgangerInference', service)`. Consumers use required injection when inference is mandatory or optional `ctx.get` when they degrade deliberately. Matching Loader isolation is required. Duplicate providers in one realm fail instead of being selected by registration order.

Alternative: import `@deepseek-ai/dsh-llm`. Rejected because its vocabulary and peer dependencies are DSH product contracts; Doppelganger would cease to be host-neutral and would inherit attachment, branding, timeout, and provider-registry concerns unrelated to bounded structured inference.

Alternative: add inference to the Runtime Host API. Rejected because a Runtime Preset can own an external model dependency like it owns MCP, while a host bridge would require equivalent semantics in multiple native adapters and would expose host agent credentials and model lifecycle.

Alternative: keep an Evolution-specific callback service. Rejected because executable feature-specific callbacks duplicate provider, validation, timeout, and credential behavior and cannot be reused by other plugins.

### 2. Add an independently composable Pi SDK provider package

Add `packages/extension-inference-pi` with Loader entry `@doppelganger/doppelganger-inference-pi`. It depends on `@doppelganger/doppelganger-protocols`, peer-depends on the workspace Cordis root, and pins `@earendil-works/pi-ai` to the tested release used by the local DSH implementation. Register the package in the package-boundary manifest and the OMP distribution package so installed Runtime Presets can resolve it. Shipped `standard` remains unchanged.

Strict configuration:

- `provider` and `model`: required bounded provider/model identifiers;
- `baseUrl` and `modelContextWindow`: optional paired custom OpenAI-compatible route metadata; the absolute HTTP(S) URL contains no credentials;
- `apiKeyEnv`: optional bounded environment-variable name; a named but missing value fails without ambient fallback;
- `reasoning`: optional Pi common level (`minimal|low|medium|high|xhigh|max`);
- `requestTimeoutMs`: bounded positive integer, default `120_000`;
- `maximumInputCharacters`: bounded positive integer, default `64_000`;
- `maximumOutputTokens`: bounded positive integer, default `2_048`;
- `maximumResponseCharacters`: bounded positive integer, default `100_000`.

The plugin builds an immutable Pi `Models` snapshot from either the installed provider catalogs or one explicitly configured OpenAI-compatible provider/model route and resolves the configured exact model before providing the service. Invalid provider/model/configuration, invalid or credential-bearing URLs, and incomplete custom-route pairs fail activation before service publication. A valid reload creates a new provider generation; an in-flight call retains the snapshot and credential captured before its first await, while the next call uses the replacement.

For each request, the adapter calls Pi `completeSimple` with one user message and one synthetic `return_result` tool whose parameters are the caller's validated JSON Schema and whose constrained-sampling preference is `json_schema`. The tool is a response channel only; Doppelganger never executes it. Success requires exactly one matching tool call and no conflicting result call. The adapter validates its arguments through the shared protocol and returns only the normalized value and usage. Missing, malformed, oversized, or conflicting structured output fails closed.

The adapter passes `AbortSignal`, explicit output limit, optional reasoning, `requestTimeoutMs`, and `maxRetries: 0`. Pi terminal `error` and `aborted` messages are normalized to bounded shared errors; raw provider payloads, complete prompts, model thinking, response text, credentials, and SDK diagnostics are not returned. A configured `apiKeyEnv` is read per call, trimmed, and passed as the explicit SDK credential. If absent from configuration, Pi may use its provider-owned ambient mechanism. The adapter stores no credentials and implements no login flow.

Alternative: use `@oh-my-pi/pi-ai`. Rejected because the package declares Bun and couples a portable extension to the OMP product distribution.

Alternative: copy DSH's `llm-pi-ai` adapter. Rejected because it carries DSH settings, credential, attachment, authorization, retry, and replay contracts. Its snapshot, cancellation, and no-SDK-retry decisions are reused conceptually, not copied as a dependency.

Alternative: implement OpenAI-compatible fetch directly. Rejected because it would duplicate provider authentication, wire formats, cancellation, usage, and error handling already maintained by Pi.

### 3. Add a session-scoped signal capture plugin inside `extension-evolution`

Add `signals.ts` with an `EvolutionSignalCapturePlugin` installed by the existing `EvolutionPlugin` after `EvolutionService` and `EvolutionProtocolPlugin`. It subscribes to `doppelganger/tool-completed`, `doppelganger/turn-committed`, and session disposal through ordinary Cordis effects.

The plugin keeps a bounded in-memory correlation map keyed by `(sessionId, turnId)`. Each tool entry is keyed by delivery ID and retains only the already-bounded name, outcome, structured result/error projection, call ID, and timestamp. A completed `turn-committed` event atomically detaches the correlated entries, applies material limits, and enqueues one immutable work item. Non-completed turns discard correlation and enqueue nothing. A bounded age/count policy removes orphaned tool entries whose turn never commits.

Alternative: add tool outcomes back to `turn-committed`. Rejected because the protocol deliberately assigns tool results only to `tool-completed`; duplicating them would regress lifecycle ownership and every adapter.

Alternative: analyze assistant text in the context provider. Rejected because context resolution is a read path, lacks correlated outcomes, and would make proposal mutation depend on prompt assembly.

### 4. Return from lifecycle listeners immediately and drain one bounded worker

The lifecycle listeners perform only validation, correlation, bounded copying, and enqueue. They return `void`; they never return inference or promotion promises to `context.parallel`. One serialized session worker drains FIFO work to preserve deterministic mutation order. The queue has a configurable capacity and drops the oldest not-yet-started item on overflow so newer recurring evidence can still be observed; each drop emits one coalesced diagnostic rather than one unbounded record.

Each job receives an `AbortSignal`. When `signalInferenceEnabled` is true, the worker races `doppelgangerInference.infer()` against `signalInferenceTimeoutMs`; otherwise it performs no model call. Timeout, rejection, invalid output, absence after a supposedly valid activation, or storage failure records a bounded diagnostic and continues deterministic extraction and later jobs. The worker catches and observes every detached promise. On plugin disposal it marks the generation closed, clears queued material, aborts the active job, and prevents every later continuation from writing. Disposal does not await a non-cooperative provider indefinitely.

Alternative: await extraction in the lifecycle callback. Rejected because `publishLifecycleEvent` awaits subscribers and a slow provider would delay a committed host turn.

Alternative: parallel inference. Rejected because it complicates cost bounds, proposal ordering, exact promotion, overload, and disposal without evidence that throughput needs concurrency.

### 5. Keep deterministic extraction and treat inferred hypotheses as untrusted data

The deterministic extractor always runs. Its initial vocabulary is deliberately narrow:

- repeated structured failed tool outcomes produce capability hypotheses keyed by normalized tool name and stable error code/class;
- explicit English or Russian principal correction markers produce low-severity Persona hypotheses;
- explicit English or Russian assistant limitation markers produce capability hypotheses.

Titles and rationales use fixed templates plus credential-screened bounded summaries. Pattern keys are normalized and hashed when free text would exceed or violate the deduplication grammar.

When enabled, Evolution sends one fixed system instruction, the bounded committed material as data, and one exact object schema containing a bounded `hypotheses` array to `doppelgangerInference`. Prompt text states that lifecycle material is untrusted evidence, not instructions. Inference can add hypotheses but cannot remove, rewrite, or raise the authority of deterministic results.

Every returned hypothesis is validated and deeply frozen: `kind`, requested `scope`, `patternKey`, bounded title, rationale/summary, tags, severity (`low|medium|high`), reuse value (`low|medium|high`), and bounded provenance references. Unknown fields, actor/Persona/project overrides, instruction-shaped wrappers, credentials, invalid scope, or oversized content are rejected individually. Recurrence and novelty are coordinator calculations, never model claims.

Alternative: require inference. Rejected because Evolution must remain useful, deterministic, testable, and loadable without a provider.

Alternative: trust the inference schema alone. Rejected because model output remains untrusted and Evolution owns stricter content, scope, authority, and credential policy than the generic inference service.

### 6. Store internal signal state only in Evolution's global SQLite namespace

Bump the Evolution SQLite schema from version 1 to version 2 with an additive migration that preserves all proposal tables. Add normalized internal tables:

- `evolution_signal_receipts` — processed committed delivery IDs and retention timestamps;
- `evolution_signals` — bounded validated occurrences with session/turn/call provenance and summary, never complete principal or assistant text;
- `evolution_signal_aggregates` — one current aggregate per actor, kind, requested scope, optional project identity, and pattern key;
- `evolution_signal_diagnostics` — bounded credential-safe operational diagnostics;
- `evolution_signal_meta` — migration/policy version and last-prune metadata.

All rows retain `instance_id` and `actor_id`. Project-scoped aggregates additionally retain the current project ID when one exists. Ephemeral queue material may contain bounded committed input/output while extraction runs, but it is discarded after the job and is never written as raw transcript.

One SQLite transaction checks the committed-turn receipt, inserts accepted occurrences, updates aggregates, and marks threshold eligibility. This makes lifecycle retry idempotent. Promotion is a second idempotent step because canonical project YAML cannot share a transaction with SQLite. Eligible aggregates use deterministic operation IDs and proposal dedupe keys derived from policy version, kind, scope, project identity, and pattern key. A crash after proposal creation but before aggregate linkage safely replays the existing proposal operation on restart or the next matching signal.

Project YAML remains proposal-only. Signals, receipts, queue state, model prompts, model outputs, usage, and diagnostics are never copied into `.doppelganger/evolution/opportunities/`. A project hypothesis without current workspace/project identity remains a pending SQLite aggregate with a diagnostic and cannot fall back to global promotion.

Alternative: persist project signals beside project proposals. Rejected because it would create noisy Git-visible telemetry and a second project schema for non-authoritative working state.

Alternative: store signals as memory candidates. Rejected because recurrence scoring, promotion receipts, operational diagnostics, and proposal linkage are Evolution workflow state, not recall.

### 7. Use a versioned deterministic promotion policy

Policy version 1 computes recurrence from distinct committed turn IDs, Persona stability from distinct Runtime Session IDs, novelty from absence of an active or linked proposal with the same canonical dedupe key, and severity/reuse value from the highest validated level observed.

Default eligibility requires capability evidence from at least three distinct committed turns, Persona evidence from at least three distinct Runtime Sessions, reuse value of at least `medium`, no terminal proposal collision, and a score at or above the configured promotion score. Configuration may raise thresholds. It may lower the score threshold only within a safe range, but it cannot reduce the independent evidence floors. One weak or model-only assertion therefore never promotes.

Promotion constructs an ordinary `EvolutionProposeRequest` and calls the existing service path. Persona is forced to global scope. Capability uses the validated requested scope. The result always remains `proposed`; the signal worker has no transition, review, research, planning, or execution dependency.

Alternative: let inference decide when to promote. Rejected because model confidence is not independent evidence and would make consent/noise policy non-deterministic.

Alternative: promote every high-severity observation immediately. Rejected because many high-severity failures are environment or input incidents rather than reusable assistant evolution.

### 8. Extend existing diagnostics instead of adding portable signal tools

Extend `EvolutionDiagnostic` with bounded signal and inference codes plus optional delivery/pattern provenance. `EvolutionService.list()` merges current project-document diagnostics with the newest bounded signal diagnostics in deterministic order; `inspect()` includes only diagnostics related to the inspected promoted proposal when available. Existing seven portable tools and their approval posture remain unchanged.

Operational codes cover invalid material, credential rejection, inference absence/failure/timeout/invalid output, queue overflow, signal write failure, project-unavailable promotion, terminal collision, and retention failure. Messages are fixed or bounded and do not include lifecycle values, prompts, responses, provider payloads, or credentials.

Alternative: add `evolution.signals.list` and `evolution.signals.delete`. Rejected because internal evidence is not a second user backlog, and adding mutation controls before the promotion policy is exercised would widen surface and consent questions unnecessarily.

### 9. Add strict serializable Evolution configuration

Extend `EvolutionPluginConfig` with:

- `proactiveSignalsEnabled` — boolean, default `true`;
- `signalInferenceEnabled` — boolean, default `false`;
- `signalMaxInputCharacters` and `signalMaxOutputCharacters` — bounded positive integers, defaults `8_000`;
- `signalMaxToolOutcomesPerTurn` — bounded natural integer, default `16`;
- `signalQueueCapacity` — bounded positive integer, default `32`;
- `signalInferenceTimeoutMs` — bounded positive integer, default `30_000`;
- `signalRetentionDays` — integer from `7` through `3650`, default `90`;
- `signalMaxStoredOccurrences` — bounded positive integer, default `5_000` per actor/Persona partition;
- `capabilityPromotionMinTurns` — integer floor `3`, default `3`;
- `personaPromotionMinSessions` — integer floor `3`, default `3`;
- `signalPromotionScore` — bounded integer, default `6`.

Unknown fields and out-of-range values fail activation before lifecycle listeners register. `signalInferenceEnabled: true` adds required same-realm `doppelgangerInference` injection; absence fails activation/reload before listeners register. `proactiveSignalsEnabled: false` installs no signal listeners or worker and performs no inference, but leaves the existing Evolution service, tools, context, proposal stores, and reminders unchanged. Omitting Evolution remains completely neutral.

The existing Evolution instruction contribution gains one sentence: lifecycle discovery may create inert proposals automatically, but it never begins review, research, or implementation and must not interrupt primary work.

Alternative: enable model inference by presence. Rejected because silently spending network and model budget when another plugin composed inference violates operator intent.

Alternative: default proactive capture off. Rejected because the selected change is to make composed Evolution proactively discover opportunities; the entire Evolution plugin is optional, and explicit disable preserves the old mode.

### 10. Prune internal state incrementally without touching proposals

After successful service initialization and at most once per UTC day during signal processing, prune expired diagnostics, receipts, and occurrences in deterministic `(createdAt, id)` order. Enforce the occurrence count ceiling after age pruning. Recompute or remove pending aggregates whose supporting occurrences disappeared; promoted proposal records and immutable proposal evidence/history are never pruned by signal retention.

Pruning runs in a SQLite transaction and is best effort after migration. Failure records one bounded in-memory diagnostic and does not block proposal tools or lifecycle handling.

Alternative: retain all summaries forever. Rejected because automatic observation must have an explicit privacy and storage bound even though raw transcripts are not persisted.

## Risks / Trade-offs

- [The new inference protocol expands Doppelganger beyond its current no-model-provider boundary] → Keep it an optional extension protocol and provider package, not a kernel or host responsibility; expose only bounded one-shot structured inference.
- [Pi SDK catalog or API drift could break the adapter] → Pin the tested SDK version, use only public `Models`, `completeSimple`, provider catalog, cancellation, usage, and faux-provider APIs, and add compile/runtime drift tests before upgrades.
- [Pi's common API cannot force every provider to emit a tool call] → Treat the schema tool as preferred constrained output and fail closed with `MISSING_OUTPUT`; deterministic extraction continues.
- [Model calls cost money and send bounded work material to an external provider] → Require explicit `signalInferenceEnabled`, document the boundary, enforce material/time/output limits, and persist neither prompts nor raw responses.
- [Inference can hallucinate or echo prompt injection] → Delimit lifecycle material as untrusted data, validate exact schemas twice, apply Evolution content/credential rules, recompute recurrence/novelty, require independent evidence, and promote only inert proposals.
- [Automatic proposals can create noise] → Require kind-specific recurrence floors, reuse value, deterministic scoring, exact deduplication, retention, and existing reminder relevance/cooldown.
- [Lifecycle correlation retains bounded sensitive text briefly] → Apply configurable limits and credential screening before inference, never persist raw material, and clear it on completion/disposal/expiry.
- [Detached inference may outlive disposal if a provider ignores abort] → Race with timeout, attach terminal rejection handling, gate every write on the live generation, and never await it indefinitely during disposal.
- [SQLite signal state and project YAML proposal creation are not atomic] → Use eligible aggregate state plus deterministic idempotent proposal operation IDs; retry repairs linkage without duplicate proposals.
- [Default-on capture changes composed Evolution behavior] → Evolution remains optional, inference remains explicit opt-in, automatic output is inert, configuration can disable capture, and omission registers no subscriber or state.
- [Schema migration failure could make Evolution unavailable] → Use one additive versioned transaction, verify version 1 to 2 migration with existing proposal fixtures, and fail activation visibly without rewriting project YAML.

## Migration Plan

1. Add the structured-inference protocol, schema validator, conformance tests, and package exports.
2. Add the Pi provider package, exact SDK dependency, strict configuration, catalog/model resolution, structured-result adapter, faux-provider tests, package boundary entry, and OMP distribution dependency.
3. Add version-2 Evolution SQLite migration and signal store tests proving existing version-1 proposals survive unchanged.
4. Add signal contracts, deterministic and inference-assisted extraction, correlation buffer, bounded worker, aggregation, promotion, diagnostics, and retention under `packages/extension-evolution`.
5. Wire signal capture into the existing Evolution Loader plugin with strict configuration, explicit inference opt-in, and disabled/omitted neutrality.
6. Add focused package tests, Composition Runtime omission/reload tests, and one real OMP lifecycle-to-proposal scenario using a deterministic test inference provider through the same public service contract; verify the Pi adapter separately against the SDK faux provider without network access.
7. Update protocol architecture, Evolution, configuration, verification, project status, package topology, and focused specification documentation in the same change.
8. Run package checks, the real OMP scenario, and `npm run check` before handoff.

Rollback sets `signalInferenceEnabled: false`, sets `proactiveSignalsEnabled: false`, or removes the corresponding Loader rows, then starts a new Runtime Session. Existing proposals remain valid. Internal version-2 signal tables may remain dormant; rollback does not downgrade SQLite or delete user state. Removing the Pi row disables new inference only after no active consumer requires it.

## Open Questions

None for implementation. The initial provider intentionally supports Pi's installed catalogs and environment credentials only; custom gateway profiles, durable OAuth/login, streaming, retries, and host-native LLM bridges require separate evidence and authority design.
