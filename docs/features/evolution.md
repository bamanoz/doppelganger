# Evolution

Evolution is an optional installable Doppelganger feature that durably coordinates user-directed improvements to Persona behavior and reusable capabilities. It records proposals, decisions, reminder delivery, and bounded recurring signals from completed work. It does not revise Persona, perform external research, generate or execute code, edit Runtime Presets, invoke host plugins, or install packages.

`@doppelganger/doppelganger-evolution` is an ordinary Cordis Loader plugin named `doppelganger-evolution`. Installation only makes the package resolvable. A selected Runtime Preset must explicitly compose the row; shipped `standard` omits it and remains behaviorally unchanged.

## Composition

Evolution requires one Runtime Session realm containing Runtime Session metadata, a bound host actor, Persona activation, instance SQLite, context, and tools:

```yaml
- id: doppelganger-evolution
  name: "@doppelganger/doppelganger-evolution"
  inject:
    - doppelgangerRuntimeSession
    - doppelgangerActor
    - doppelgangerPersona
    - doppelgangerInstanceSqlite
    - doppelgangerContext
    - doppelgangerTools
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerActor: session
    doppelgangerPersona: session
    doppelgangerInstanceSqlite: session
    doppelgangerContext: session
    doppelgangerTools: session
    doppelgangerEvolution: session
  config:
    namespace: evolution
    remindersEnabled: true
    reminderCooldownDays: 7
    projectLockTimeoutMs: 2000
    proactiveSignalsEnabled: true
    signalInferenceEnabled: false
```

Deterministic proactive capture defaults on for a composed Evolution row; model calls default off. `proactiveSignalsEnabled: false` restores proposal-only behavior with no lifecycle listeners. `signalInferenceEnabled: true` additionally requires exactly one same-realm `doppelgangerInference` provider declared in the Evolution row's `inject` and `isolate` maps. Missing or duplicate providers fail activation; omitting any inference provider remains valid while inference is disabled. Unknown or invalid fields fail before context, tools, or lifecycle listeners register.

Signal material defaults to 8000 input characters, 8000 output characters, and 16 correlated tool outcomes; accepted ranges are 1-64000, 1-64000, and 0-128. The FIFO queue defaults to 32 entries and accepts 1-1024. Inference timeout defaults to 30000 milliseconds and accepts 100-600000.

Signal retention defaults to 90 days and accepts 7-3650. Stored occurrences default to 5000 and accept 1-100000. Capability promotion defaults to at least 3 distinct turns; Persona promotion defaults to at least 3 distinct sessions; each threshold accepts 3-100. The versioned promotion score defaults to 6 and accepts 4-10.

The actor must be bound before the storage namespace opens. Runtime Session workspace metadata and Persona project metadata must agree. Missing workspace metadata leaves global operations valid but makes project operations fail; it never redirects them into global state.

### Optional Pi inference provider

To augment deterministic extraction, place one provider row before Evolution and add `doppelgangerInference` to the Evolution row's `inject` and `isolate` maps:

```yaml
- id: doppelganger-inference-pi
  name: "@doppelganger/doppelganger-inference-pi"
  isolate:
    doppelgangerInference: session
  config:
    provider: openai
    model: gpt-5
    apiKeyEnv: OPENAI_API_KEY

# On the Evolution row:
# inject: [..., doppelgangerInference]
# isolate: { ..., doppelgangerInference: session }
# config: { ..., signalInferenceEnabled: true }
```

The provider/model pair must exist in the installed Pi catalog. A custom OpenAI-compatible route instead supplies `baseUrl` and `modelContextWindow` together; the URL must be absolute HTTP(S) and contain no credentials. `apiKeyEnv` is optional; when present, its non-empty value is resolved per call with no ambient fallback. When absent, the selected Pi provider may use its own ambient authentication. Optional `reasoning` is `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Request timeout defaults to 120000 milliseconds (maximum 600000), input to 64000 characters (maximum 1000000), output to 2048 tokens (maximum 65536), response size to 100000 characters (maximum 2000000), and custom context windows accept 1-10000000 tokens. Unknown keys, unavailable routes, invalid URLs, incomplete custom-route pairs, or invalid bounds fail activation.

## Proposal model

Every proposal has an opaque stable ID, normalized deduplication key, bounded title and rationale, bounded tags and evidence summaries, exact integer revision, timestamps, immutable transition history, and confirmed reminder deliveries. Evidence contains bounded summaries and provenance identifiers, never raw dialogue or copied articles. Credential-shaped content is rejected.

Kinds and authoritative scopes:

- `persona`: global only; describes one Persona Instance's durable assistant behavior for one bound actor.
- `capability`: global or project; describes a reusable functionality gap.

The common initial state is `proposed`. Persona proposals may advance to `reviewing`; capability proposals may advance through `researching`, `options-ready`, `selected`, `planned`, and `implementing`. Both kinds may become `done`, `snoozed`, or terminal `rejected`. Snooze retains the prior forward state and a future deadline; expiry or an explicit exact-revision resume restores that state. Done and rejected proposals do not reopen implicitly.

Every mutation uses a stable `operationId`. An exact retry replays its prior result; reusing the ID for different arguments fails. Revision-sensitive mutations require the current exact revision. Scope is immutable: correct a misclassification by rejecting the old proposal and creating a distinct linked opportunity in the intended scope.

## Storage

Global proposals use the `evolution` instance SQLite namespace and are partitioned by both Persona Instance ID and bound actor ID on every read and mutation. Schema initialization is transactional. Proposals, revisions, evidence, transitions, operation receipts, and reminder deliveries remain plugin-owned state.

Project capability proposals are Git-visible canonical documents at:

```text
<workspaceRoot>/.doppelganger/evolution/opportunities/<proposal-id>.yaml
```

Each direct `.yaml` child is one version-1 document with exactly `version`, `proposal`, and `operations`. `proposal` contains the complete current project capability proposal and its immutable history; `operations` stores command digests and exact replay results. The filename is the opaque proposal ID, not user-authored text. Rendering uses deterministic sorted YAML keys.

Project reads validate files independently. A malformed, identity-mismatched, or symlinked document produces a per-file diagnostic without hiding unrelated healthy proposals, and Evolution never rewrites invalid user-authored YAML automatically. Writes use a bounded adjacent interprocess lock, reject unsafe paths and symlinks, recheck the expected revision, create an owner-only same-directory temporary file, fsync, and atomically rename it. The directory is not created before the first project mutation.

Project YAML is suitable for version control but is not a secret store. Titles, rationales, tags, evidence, transition details, and operation receipts may be committed. Keep them bounded and non-sensitive.

## Proactive signal lifecycle

When proactive capture is enabled, Evolution subscribes to the existing host-neutral `tool-completed`, `turn-committed`, and `session-disposed` events. Tool outcomes are held only in a bounded in-memory correlation map keyed by session and turn. A completed `turn-committed` event consumes correlated outcomes and enqueues bounded material. Failed or cancelled turns, orphaned tool outcomes, partial work, and disposal create no durable evidence. Duplicate committed delivery IDs are transactionally deduplicated. Lifecycle publication returns before extraction, inference, storage, promotion, or retention work completes.

The deterministic extractor recognizes structured failed-tool classes, explicit English or Russian principal corrections, and explicit English or Russian assistant limitation markers. It emits fixed bounded hypotheses rather than storing full prompts. Credential-shaped material is rejected before persistence; a tool error with a sensitive message may retain only its non-sensitive structural fields.

Optional inference-assisted extraction sends the same bounded committed material through `doppelgangerInference` with purpose `evolution.signal-extraction`, a fixed instruction that treats lifecycle material as untrusted data, and an exact bounded hypothesis schema. Every returned item is revalidated locally for kind, scope, pattern identity, bounds, credentials, and authority-shaped text. Valid inferred hypotheses augment deterministic results; invalid items, timeout, provider failure, or cancellation produce bounded diagnostics while deterministic extraction continues. Inference-only recurrence never satisfies promotion.

Signals aggregate transactionally by Persona Instance, actor, optional project, kind, scope, and normalized pattern key. Capability promotion requires the configured number of distinct committed turns and never fewer than three. Persona promotion is always global, requires the configured number of distinct Runtime Sessions and never fewer than three. At least one deterministic occurrence and `medium` reuse value are mandatory. Policy version 1 scores capped recurrence plus severity (`low` 1, `medium` 2, `high` 3), reuse value, and computed novelty; inferred recurrence or novelty claims are ignored.

An eligible aggregate creates only an ordinary `proposed` proposal through the existing mutation path. Stable policy-derived operation and deduplication keys make crash replay idempotent. Equivalent active proposals receive bounded new evidence instead of duplicates. A terminal collision is diagnosed and suppressed. Project promotion requires matching active workspace metadata; otherwise the aggregate remains pending with `PROJECT_PROMOTION_UNAVAILABLE`. Automatic promotion never advances review, research, planning, implementation, execution, or completion.

Receipts, occurrences, aggregates, retention metadata, and coalesced diagnostics live only in actor- and Persona-partitioned plugin SQLite. Raw inference results and complete prompts are not stored; project YAML receives only a promoted proposal's bounded evidence and immutable proposal history. Retention runs at most daily, expires receipts and old diagnostics or occurrences, enforces the configured occurrence cap, and recomputes only pending aggregates. Promoted proposals and their evidence or history are never pruned with signal state.

The session worker is FIFO and bounded. When full, it drops the oldest pending item and coalesces a `SIGNAL_QUEUE_OVERFLOW` diagnostic. Extraction, inference, storage, promotion, and retention failures are contained as bounded credential-safe diagnostics returned by `evolution.list` and relevant `evolution.inspect` calls. Reload or disposal clears correlation and queued work, aborts active inference, waits only a bounded interval, and prevents stale generation writes.

## Portable controls

The composed feature registers exactly seven transport-neutral tools:

1. `evolution.propose` records or exactly deduplicates one non-executing proposal.
2. `evolution.list` filters proposals by kind, scope, status, direct-input query, or reminder eligibility and returns project-file diagnostics.
3. `evolution.inspect` returns one proposal with exact revision, evidence, history, reminders, and diagnostics.
4. `evolution.transition` applies one kind-specific exact-revision forward transition.
5. `evolution.snooze` suppresses an active proposal until a future deadline.
6. `evolution.reject` records a terminal user decision.
7. `evolution.reminder.record` records a confirmed presentation using exact revision, Runtime Session ID, and turn ID.

Schemas stay within the supported host-portable JSON Schema subset and reject unknown properties plus actor, Persona, instance, or project override fields. `evolution.transition` exposes one object schema with the common mutation fields and optional target-detail fields; its invocation boundary requires exactly the metadata for the selected target and rejects metadata belonging to another target. Results are deeply frozen JSON-compatible values. These controls mutate only the Evolution ledger and grant no executor authority.

## Context and reminders

Evolution contributes one bounded instruction-authority policy. It tells the active assistant to evaluate completed work and dialogue for stable Persona improvements and material reusable capability gaps, distinguish Persona qualities from user facts and preferences, prefer existing capabilities, complete and verify the primary task first, present at most one concise opportunity afterward, require explicit consent before review or research, and prefer portable Doppelganger mechanisms when their seams fit. It explicitly marks automatically discovered proposals as inert, consent-gated, and unable to interrupt primary work.

A context resolution may additionally include at most one data-authority reminder candidate. Selection is read-only and uses deterministic lexical overlap with direct principal input across eligible global and current-project proposals. Done, rejected, currently snoozed, irrelevant, and cooled-down proposals are excluded. Ranking uses overlap, oldest confirmed delivery, creation time, then proposal ID.

The default cooldown is seven days from confirmed delivery. Selection alone does not advance it. After the assistant actually presents the candidate, the workflow calls `evolution.reminder.record`; omitting that record deliberately leaves the proposal due. Snooze is a user decision; cooldown is delivery rate limiting.

## Consent and execution boundary

Manual and automatic proposal creation plus reminders are inert. A Persona review begins only after the user explicitly chooses review. The `doppelganger-persona-evolution` skill then preserves inspect-first reasoning, one exact native `persona.revise` approval, compare-and-swap, and HMR confirmation. The proposal becomes done only after `applied` or `already-current`; non-application leaves it open unless the user snoozes or rejects it.

Capability research begins only after the user explicitly selects research for an identified proposal. The `doppelganger-capability-evolution` skill compares current primary-source implementations, records bounded sourced options, waits for explicit option selection, records the chosen mechanism as `selected`, and stops. It does not choose or create a repository, package, planning system, OpenSpec change, or implementation artifact; write implementation instructions; advance the proposal to `planned`, `implementing`, or `done`; or execute the mechanism. Those later states remain available to separately invoked owning planning and executor workflows with their own user decisions and authority boundaries.

Capability routing is fit-driven in this order: reuse an existing capability; select Dynamic Runtime Plugins for reversible current-session behavior; recommend a permanent installable Doppelganger package and Loader plugin for portable persistent behavior; recommend a supported host plugin only for genuinely host-specific surfaces; otherwise offer explicit adaptation or alternatives. Selection records the mechanism, not its implementation details or location. A later permanent-package request routes to `doppelganger-plugin-development`, which must obtain an explicit current, named existing, or user-located new repository choice before any mutation and then obey that target repository's planning and engineering rules. Each executor retains its own trust and approval boundary.

## Reload, rollback, and removal

A valid Loader config change replaces the Evolution service, context, tools, lifecycle correlation, and signal worker through Composition Runtime. Plugin-owned global SQLite and project YAML persist across valid replacement and new Runtime Sessions. The retired generation clears pending correlation, drops queued work, aborts active inference, and cannot write after disposal. Invalid reload retains the previous audited generation.

Rollback removes the Evolution Loader row and starts a new Runtime Session. Omission removes the service, context, tools, reminders, lifecycle listeners, and signal worker while preserving durable proposal and signal state for later recovery. Removing only the inference provider requires first disabling Evolution signal inference; deterministic capture remains available without it. Remove packages only after no selected Runtime Preset references them. Evolution performs no Persona or capability implementation, so it has no executor changes to roll back.

After repository verification succeeds, opt the user-owned Mark Runtime Preset in by adding the exact Evolution row above to `~/.doppelganger/.runtime-presets/mark/runtime.cordis.yml`, preserving its existing session isolation and actor/Persona/SQLite/context/tool rows, then start a new OMP Runtime Session and inspect the projected controls and policy context. This post-implementation deployment change is personal configuration, not a shipped preset change or repository fixture. Shipped `standard` remains Evolution-neutral.

## Primary implementation and evidence

- `packages/extension-evolution/src/plugin.ts` — Loader entry, strict configuration, and conditional signal composition.
- `packages/extension-evolution/src/service.ts` — actor-aware merged service, signal promotion, diagnostics, and reminder selection.
- `packages/extension-evolution/src/global-store.ts` — partitioned SQLite proposal ledger.
- `packages/extension-evolution/src/signal-model.ts`, `signal-extractor.ts`, `signal-store.ts`, and `signal-worker.ts` — bounded signal contracts, extraction, aggregation, policy, lifecycle correlation, retention, and worker disposal.
- `packages/extension-evolution/src/project-store.ts` — canonical YAML proposal ledger and atomic writes.
- `packages/extension-evolution/src/protocol.ts` — policy context and seven portable controls.
- `packages/extension-inference-pi/src/` — optional Pi structured-inference provider.
- `packages/extension-evolution/tests/` — contracts, migration, signal lifecycle, storage, promotion, tools, context, reminders, persistence, and concurrency.
- `skills/evolution/doppelganger-capability-evolution/SKILL.md` — consent-gated research and routing.
- `skills/persona/doppelganger-persona-evolution/SKILL.md` — direct and proposal-first Persona review.
- `skills/development/doppelganger-plugin-development/SKILL.md` — ownership-gated permanent installable plugin development after mechanism selection.
- `packages/composition-runtime/tests/evolution.spec.ts` — arbitrary Runtime Preset composition, patch, reload, omission, dependency, and actor behavior.
- `packages/host-omp/tests/child-integration.spec.ts` and `packages/omp/tests/plugin-package.spec.ts` — generic projection and real OMP dogfood scenarios.
