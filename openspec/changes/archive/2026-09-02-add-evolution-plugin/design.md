## Context

Doppelganger currently has two execution mechanisms but no durable improvement coordinator. Persona Authoring can replace one explicitly writable trait after exact native approval and HMR confirmation. Dynamic Runtime Plugins can activate temporary session-owned Cordis code after exact native approval. Both are deliberately opt-in and non-autonomous. The existing Persona evolution and runtime-plugin development skills teach those workflows, but neither observes recurring gaps, stores proposals, applies reminder policy, or owns a cross-session lifecycle.

The new feature must remain an ordinary installable Cordis extension. It cannot add an Evolution concept to the kernel, make hosts Persona-aware, mutate authored Runtime Presets automatically, treat model output as approval, or turn `node:vm` into a persistence mechanism. It must work through existing Runtime Session metadata, actor binding, Persona activation, instance SQLite, context, and tool protocols. OMP and the planned DSH host must project its portable tools through their generic dynamic paths.

Two storage requirements differ intentionally. A Persona evolution proposal describes the durable behavior of one Persona Instance for one actor and is therefore global. A capability opportunity may be globally reusable or repository-specific; repository-specific state must be reviewable and versionable with the project.

## Goals / Non-Goals

**Goals:**

- Ship `@doppelganger/doppelganger-evolution` as a separately resolvable workspace/npm package with a native Loader entry.
- Persist bounded, auditable, deduplicated Persona and capability proposals across Runtime Sessions.
- Keep observation and reminders non-executing and proposal-first.
- Give the model one stable instruction policy for both Persona and capability evolution, independent of the writable Persona trait's current contents.
- Preserve user control over review, research, option selection, planning, implementation, rejection, and snoozing.
- Support global actor-partitioned SQLite state and project-canonical versioned YAML state without conflating either with memory.
- Surface at most one relevant due reminder after primary work, with a default seven-day confirmed-delivery cooldown.
- Route capability implementation toward existing capabilities, then temporary or permanent Doppelganger mechanisms, before host-specific plugins.
- Keep omission neutral and require no Evolution-specific host adapter code.

**Non-Goals:**

- Autonomous Persona revision, external research, code generation, code execution, package installation, Runtime Preset editing, or implementation.
- A scheduler, daemon, notification service, or reminders outside active host conversations.
- Raw transcript storage, hidden behavioral telemetry, or automatic inference from uncommitted turns.
- Treating Evolution proposals as memory records or adding Evolution to Runtime Session metadata.
- Public marketplace publication, automatic dependency solving, compatibility policy, or automatic activation after installation.
- Persistent promotion of Dynamic Runtime Plugin Packages.
- A universal plugin abstraction covering arbitrary product roadmaps, issue trackers, or project tasks.
- Host Client UI in the first implementation.

## Decisions

### 1. Use one coordinator package with typed proposal kinds

Create `packages/extension-evolution` and publish/resolve it as `@doppelganger/doppelganger-evolution`. Its public surface exports the Loader plugin, `EvolutionService`, typed proposal contracts, validation errors, and testable storage adapters. The service name is `doppelgangerEvolution`; the Loader diagnostic name is `doppelganger-evolution`.

The ledger uses a discriminated union rather than a generic untyped payload:

```ts
type EvolutionProposal = PersonaEvolutionProposal | CapabilityOpportunity

type EvolutionScope =
  | { kind: 'global' }
  | { kind: 'project'; projectId: string; workspaceRoot: string }
```

Both kinds share identity, deduplication, evidence, revision, transition history, reminder state, and terminal outcomes. Persona payload owns the proposed behavioral delta and target logical trait. Capability payload owns the capability gap, research summary, candidate options, selected mechanism, and planning/implementation references. Persona proposals reject project scope.

Alternative: separate Persona and capability plugins. Rejected because proposal identity, evidence, deduplication, decisions, cooldown, listing, and reminder selection would be duplicated, while execution still remains outside either coordinator.

Alternative: one free-form proposal schema. Rejected because it would move validation into prompt convention and make state transitions untestable.

### 2. Keep execution authority outside Evolution

Evolution records and retrieves decisions; it never invokes Persona Authoring, Dynamic Runtime Plugins, web research, OpenSpec, filesystem implementation tools, package managers, or host plugin APIs. The user-facing skills orchestrate those mechanisms after explicit user decisions and then report observable outcomes back through revision-checked Evolution mutations.

The Persona skill gains an optional proposal-first entry path but retains direct `review` and `review --dry-run`. A reminder only offers review. After the user chooses review, the existing inspect-first and native approval guarantees remain unchanged. Only HMR-confirmed `applied` or `already-current` may complete the proposal.

The new capability skill gains the research and routing workflow. It may transition to `researching` only after explicit current consent, to `options-ready` only after a sourced comparison is presented, to `selected` only after the user's choice, and to `planned` only after a complete planning artifact exists. Implementation remains a later explicit workflow.

Alternative: let the plugin call executor services directly. Rejected because that converts benign proposal storage into ambient mutation authority and couples the coordinator to every present and future executor.

### 3. Inject existing session services explicitly

The Loader plugin requires and declares:

- `doppelgangerRuntimeSession` for stable session identity and optional workspace root;
- `doppelgangerActor` for immutable host-owned actor partitioning;
- `doppelgangerPersona` for Persona Instance identity and project metadata consistency;
- `doppelgangerInstanceSqlite` for the global ledger;
- `doppelgangerContext` for policy and reminder candidates;
- `doppelgangerTools` for portable controls.

Every session-scoped service uses the matching Loader `isolate` realm. An unbound actor fails Evolution activation before opening its namespace. Missing workspace metadata rejects only project-scoped operations; it does not invalidate global proposals.

Alternative: derive actor identity from session, workspace, or Persona. Rejected because it violates the protected host binding and would merge or fragment durable state incorrectly.

### 4. Use one global SQLite ledger and project-canonical YAML adapters

Global state opens the `evolution` namespace from `doppelgangerInstanceSqlite`. The initial transactional schema contains separate normalized tables for proposals, immutable revisions, bounded evidence, transitions, mutation receipts, and reminder deliveries. Every mutation is one transaction and uses `(instance_id, actor_id, operation_id)` idempotency with a canonical command digest. Proposal revisions are monotonically increasing integers used for compare-and-swap.

Project capability opportunities live under:

```text
<workspaceRoot>/.doppelganger/evolution/opportunities/<proposal-id>.yaml
```

Each file is one canonical version-1 document containing the complete current proposal plus immutable history. Reads enumerate only direct `.yaml` children, validate every document independently, and return diagnostics for invalid files without suppressing healthy proposals. Writes acquire a bounded adjacent project Evolution lock, verify the expected content revision, write a same-directory temporary file, fsync, rename atomically, and preserve unrelated files. Symlinks and path-derived identities are rejected. YAML rendering is deterministic and uses the existing workspace `js-yaml` dependency.

A proposal's scope is immutable in the first milestone. Misclassification is corrected by explicitly rejecting the old proposal and creating a linked replacement in the intended scope; the coordinator never silently copies or promotes records across stores. This avoids pretending that SQLite plus Git-backed files can provide one atomic cross-store move.

Alternative: store every proposal in memory. Rejected because proposals have workflow state, reminders, research artifacts, and user decisions rather than recall semantics.

Alternative: keep project proposals in SQLite and export YAML projections. Rejected because the user-selected project contract requires version-controlled canonical state, and dual canonical/projection state would introduce reconciliation.

Alternative: store global proposals directly under `$DOPPELGANGER_HOME`. Rejected because instance SQLite already owns durable plugin namespaces, transactions, lifecycle, and actor-partitioned persistence.

### 5. Use explicit deterministic deduplication and bounded evidence

`evolution.propose` requires a caller-generated stable operation ID and a normalized semantic `dedupeKey`, not a model-generated filesystem name. Deduplication searches active proposals of the same kind and authoritative scope. An exact key match appends new distinct bounded evidence to the active proposal under compare-and-swap and returns that proposal; terminal matches produce an explicit conflict so a materially new opportunity must use a new key.

Evidence stores summaries and bounded provenance identifiers such as session, turn, memory-evidence, or external source IDs. It never stores raw conversation transcripts or copied articles. Proposal text and evidence reject known credential-shaped content at the mutation boundary. To avoid a second secret detector, extract the existing domain-neutral credential-pattern check from memory into `extension-protocols` under a generic name and migrate memory to that shared primitive; memory-specific recursive-content policy stays in memory.

Alternative: fuzzy semantic deduplication. Rejected for the first milestone because it requires an optional embedding dependency and creates unstable merge behavior. The model may inspect candidates and choose a stable key; canonical deduplication remains exact and deterministic.

### 6. Expose seven portable controls with typed transitions

Evolution registers:

1. `evolution.propose`
2. `evolution.list`
3. `evolution.inspect`
4. `evolution.transition`
5. `evolution.snooze`
6. `evolution.reject`
7. `evolution.reminder.record`

`list` filters by kind, scope, status, direct-input query, and due-reminder eligibility. `inspect` returns one proposal, exact revision, evidence, transitions, and reminder history. `transition` accepts a discriminated target-state payload so `options-ready`, `selected`, `planned`, `implementing`, `reviewing`, and `done` each require the fields meaningful to that state. `snooze` stores a bounded future deadline and prior forward state. `reject` is terminal. `reminder.record` requires exact revision and stable turn identity so selection alone never advances cooldown.

All tool schemas reject unknown properties and actor/persona override fields. Mutation results are deeply frozen JSON-compatible values. Domain failures use structured error codes preserved by generic host projection.

Alternative: a generic patch tool. Rejected because it would permit invalid state combinations and make user-decision boundaries implicit.

### 7. Contribute separate instruction and data context

One context provider returns two independently budgeted contributions:

- a short, stable `instruction` contribution defining the evolution policy;
- at most one `data` contribution describing a due relevant proposal candidate.

The instruction is the stable equivalent of a non-writable `evolution` trait: evaluate completed work and dialogue for stable Persona improvements and material reusable capability gaps; distinguish Persona from user memory; prefer existing mechanisms; finish and verify the current task first; present at most one concise proposal or reminder afterward; require user consent before review or research; prefer a portable Doppelganger implementation whenever its seams suffice.

The policy is owned by the installed Evolution plugin rather than `trait:evolving-profile`, so a future Persona replacement cannot accidentally delete the ability to notice further evolution. Personal presets may add complementary identity wording, but no duplicate operational trait is required for correctness.

Reminder selection tokenizes the direct principal input and the proposal's bounded title, rationale, and tags with deterministic locale-independent normalization. It excludes stop words, requires at least one meaningful overlap, ranks by overlap score, oldest confirmed reminder time, creation time, then proposal ID, and emits only the top candidate. It searches the current global partition plus the current project's valid YAML proposals. No input or no token budget yields no candidate.

Alternative: append evolution policy into the writable evolving trait. Rejected because replacing that trait could remove the mechanism that enables future review.

Alternative: a background model or lifecycle listener that analyzes committed turns autonomously. Rejected because it adds hidden inference cost and storage. The active assistant performs the evaluation under visible composed instructions and explicitly calls `evolution.propose`.

### 8. Cooldown starts only after confirmed presentation

The default reminder cooldown is seven days. Configuration may disable reminders or increase the cooldown; it cannot reduce the cooldown below seven days or increase the candidate count above one. Context selection is read-only. After the assistant actually presents the proposal at the end of its primary response, it calls `evolution.reminder.record` with proposal ID, expected revision, session ID, and turn ID. A missing record leaves the proposal due, favoring occasional repeat over silently losing it.

Snooze and cooldown are distinct: snooze is a user decision suppressing proposal eligibility until a deadline; cooldown is delivery rate limiting.

Alternative: update cooldown while assembling context. Rejected because context inclusion does not prove the assistant presented the reminder.

### 9. Keep installation separate from activation

The package receives normal package metadata and exports so it can be packed and installed independently in a compatible Doppelganger deployment. A generated consumer smoke installs the packed workspace package and resolves its Loader export by bare package name. Installing the package does nothing until a selected Runtime Preset explicitly composes the Evolution row with required services.

The private `@doppelganger/doppelganger-omp` distribution includes Evolution in its dependency closure for repository dogfood and user-preset resolution, while the Evolution package remains independently packable and installable. `host-omp` remains Evolution-neutral and the shipped `standard` preset continues to omit the row. Tests use generated arbitrary user presets rather than personal files. Public marketplace publication and automatic preset editing remain deferred.

Alternative: embed Evolution into Persona or the OMP adapter. Rejected because that makes it mandatory, host-specific, and unavailable to non-Persona or future compatible deployments.

## Risks / Trade-offs

- [Model instruction cannot guarantee every opportunity is noticed] → Keep the policy concise and always composed, expose explicit review/list commands, and test discovery/invocation behavior rather than claim autonomous completeness.
- [Project YAML may contain sensitive material and be committed] → Store summaries only, reject known credential-shaped content, document the Git-visible boundary, and never copy raw dialogue or articles.
- [Two authoritative storage adapters can drift in behavior] → Define one service contract and run the same conformance suite against SQLite and YAML adapters; keep scope immutable in the first milestone.
- [Concurrent project sessions can race] → Use bounded interprocess locking, exact revision checks, atomic replacement, and idempotent mutation receipts embedded in canonical documents.
- [Invalid project files could block all reminders] → Isolate diagnostics per file and continue with healthy documents; never rewrite invalid user-authored YAML automatically.
- [Generic transition APIs can hide invalid decisions] → Use target-state discriminated schemas and an explicit state matrix; reject unknown metadata and invalid kind/state combinations.
- [Reminder relevance may be noisy without embeddings] → Require meaningful lexical overlap, return only one candidate, use confirmed-delivery cooldown, and allow reminders to be disabled or snoozed.
- [A model could call a transition without genuine user direction] → Keep the authority boundary explicit in both installed instruction and skills; transitions remain auditable, revision-checked records and grant no executor authority.
- [Adding a shared credential detector broadens protocol package responsibility] → Export only a small domain-neutral pure boundary helper; keep all memory-specific content policy in memory and enforce package-boundary tests.
- [Installable may be mistaken for publicly published] → Verify `npm pack` and external consumer installation while documenting that registry publication and marketplace distribution remain deferred.

## Migration Plan

1. Add the new package, internal dependency edge declarations, schemas, storage adapters, service, context provider, tools, and focused tests without composing it into shipped presets.
2. Extract the generic credential-pattern helper and migrate memory callers in the same clean cutover.
3. Add the capability-evolution skill and extend the Persona evolution skill; verify OMP and DSH project discovery syntax using temporary installations.
4. Add generated Runtime Preset and packed-consumer smokes proving bare-package installability, omission neutrality, actor binding, generic host projection, persistence, reload, and cleanup.
5. Reconcile current documentation, focused specs, repository status, package topology, and the active DSH planning artifacts.
6. Opt the user-owned Mark Runtime Preset into the installed Evolution row only as an explicit deployment step after repository verification; do not alter shipped `standard`.
7. Initialize empty global schema on first activation. Create no project directory until the first project proposal mutation.

Rollback removes the Evolution Loader row from affected user presets and starts a new Runtime Session. Omission removes context and tools while leaving global SQLite and project YAML state recoverable. Package removal follows only after no selected Runtime Preset references it. No Persona or capability implementation is rolled back because Evolution never performs either.

## Open Questions

None for implementation. Project proposal filenames use opaque stable proposal IDs; the human-readable title remains document content. Reminder cooldown defaults to seven days and may only be disabled or increased.
