# Evolution

Evolution is an optional installable Doppelganger feature that durably coordinates user-directed improvements to Persona behavior and reusable capabilities. It records proposals, decisions, and reminder delivery. It does not revise Persona, perform external research, generate or execute code, edit Runtime Presets, invoke host plugins, or install packages.

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
```

`namespace` defaults to `evolution`. `remindersEnabled` defaults to `true`. `reminderCooldownDays` is an integer from 7 through 3650. `projectLockTimeoutMs` is an integer from 100 through 60000. Unknown or invalid fields fail activation before context or tools register.

The actor must be bound before the storage namespace opens. Runtime Session workspace metadata and Persona project metadata must agree. Missing workspace metadata leaves global operations valid but makes project operations fail; it never redirects them into global state.

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

Evolution contributes one bounded instruction-authority policy. It tells the active assistant to evaluate completed work and dialogue for stable Persona improvements and material reusable capability gaps, distinguish Persona qualities from user facts and preferences, prefer existing capabilities, complete and verify the primary task first, present at most one concise opportunity afterward, require explicit consent before review or research, and prefer portable Doppelganger mechanisms when their seams fit.

A context resolution may additionally include at most one data-authority reminder candidate. Selection is read-only and uses deterministic lexical overlap with direct principal input across eligible global and current-project proposals. Done, rejected, currently snoozed, irrelevant, and cooled-down proposals are excluded. Ranking uses overlap, oldest confirmed delivery, creation time, then proposal ID.

The default cooldown is seven days from confirmed delivery. Selection alone does not advance it. After the assistant actually presents the candidate, the workflow calls `evolution.reminder.record`; omitting that record deliberately leaves the proposal due. Snooze is a user decision; cooldown is delivery rate limiting.

## Consent and execution boundary

Proposal creation and reminders are inert. A Persona review begins only after the user explicitly chooses review. The `doppelganger-persona-evolution` skill then preserves inspect-first reasoning, one exact native `persona.revise` approval, compare-and-swap, and HMR confirmation. The proposal becomes done only after `applied` or `already-current`; non-application leaves it open unless the user snoozes or rejects it.

Capability research begins only after the user explicitly selects research for an identified proposal. The `doppelganger-capability-evolution` skill compares current primary-source implementations, records bounded sourced options, waits for explicit option selection, records the chosen mechanism as `selected`, and stops. It does not choose or create a repository, package, planning system, OpenSpec change, or implementation artifact; write implementation instructions; advance the proposal to `planned`, `implementing`, or `done`; or execute the mechanism. Those later states remain available to separately invoked owning planning and executor workflows with their own user decisions and authority boundaries.

Capability routing is fit-driven in this order: reuse an existing capability; select Dynamic Runtime Plugins for reversible current-session behavior; recommend a permanent installable Doppelganger package and Loader plugin for portable persistent behavior; recommend a supported host plugin only for genuinely host-specific surfaces; otherwise offer explicit adaptation or alternatives. Selection records the mechanism, not its implementation details or location. Each later executor retains its own trust and approval boundary.

## Reload, rollback, and removal

A valid Loader config change replaces the Evolution service, context, and tool registrations through Composition Runtime. Plugin-owned global SQLite and project YAML persist across valid replacement and new Runtime Sessions. Invalid reload retains the previous audited generation.

Rollback removes the Evolution Loader row and starts a new Runtime Session. Omission removes the service, context, tools, and reminders while preserving durable state for later recovery. Remove the package only after no selected Runtime Preset references it. Evolution performs no Persona or capability implementation, so it has no executor changes to roll back.

After repository verification succeeds, opt the user-owned Mark Runtime Preset in by adding the exact Evolution row above to `~/.doppelganger/.runtime-presets/mark/runtime.cordis.yml`, preserving its existing session isolation and actor/Persona/SQLite/context/tool rows, then start a new OMP Runtime Session and inspect the projected controls and policy context. This post-implementation deployment change is personal configuration, not a shipped preset change or repository fixture. Shipped `standard` remains Evolution-neutral.

## Primary implementation and evidence

- `packages/extension-evolution/src/plugin.ts` — Loader entry and strict configuration.
- `packages/extension-evolution/src/service.ts` — actor-aware merged service and reminder selection.
- `packages/extension-evolution/src/global-store.ts` — partitioned SQLite ledger.
- `packages/extension-evolution/src/project-store.ts` — canonical YAML ledger and atomic writes.
- `packages/extension-evolution/src/protocol.ts` — policy context and seven portable controls.
- `packages/extension-evolution/tests/` — contracts, storage, tools, context, reminders, persistence, and concurrency.
- `skills/evolution/doppelganger-capability-evolution/SKILL.md` — consent-gated research and routing.
- `skills/persona/doppelganger-persona-evolution/SKILL.md` — direct and proposal-first Persona review.
- `packages/composition-runtime/tests/evolution.spec.ts` — arbitrary Runtime Preset composition, patch, reload, omission, dependency, and actor behavior.
- `packages/host-omp/tests/child-integration.spec.ts` and `packages/omp/tests/plugin-package.spec.ts` — generic projection and real OMP dogfood scenarios.
