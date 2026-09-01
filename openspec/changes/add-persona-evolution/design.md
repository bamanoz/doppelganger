## Context

Doppelganger already separates three concerns that this change must preserve:

- a Runtime Preset is a complete portable Cordis Loader tree;
- Persona owns immutable activation metadata plus file-backed identity and ordered traits;
- hosts project transport-neutral context, tools, lifecycle events, and actor binding without importing feature packages.

The current Persona path is deliberately read-only from the model's point of view. `doppelgangerPersona` exposes normalized selected asset paths, and the Persona asset lifecycle retains last-good content and emits `doppelganger/persona-asset-reloaded`, but no extension can safely coordinate a user-approved write. The current portable `ToolDescriptor` also has no approval metadata, so host permissive modes can auto-run a projected mutating tool.

The intended product is narrower than a general Persona editor. Mark gets one explicitly writable `trait:evolving-profile`; identity and all other traits remain protected. An Agent Skill helps the model decide whether a stable collaboration pattern belongs in that trait. The Cordis plugin performs the actual mutation. The host only enforces a generic tool-owned approval declaration.

Relevant host facts:

- OMP native tools support per-tool approval decisions, `policy: "prompt"`, prompt reasons, argument detail rendering, and tool-owned policy that remains effective in `yolo` mode.
- The active native DSH design projects portable tools into the scoped DSH Tool Runtime. DSH can return `ask` from `tools/pre-execute`; `ApprovalService` resolves one exact call to `allowed-once`, `rejected`, `cancelled`, or `unavailable`, with non-grants failing closed.
- OMP runs each Runtime Session in a separate child process. Multiple sessions can therefore target the same user-owned Persona file concurrently; a process-local mutex is insufficient.
- Persona HMR currently identifies an asset by canonical URL and reports success/failure. Authoring needs the observed byte revision in that outcome so an unrelated edit cannot satisfy the wait.

## Goals / Non-Goals

**Goals:**

- Add one portable, optional, narrowly scoped writable Persona capability.
- Keep the Runtime Preset as the source of feature composition and writable policy.
- Make every mutation an exact compare-and-swap against inspected bytes.
- Require an explicit one-shot native host approval even in permissive host modes.
- Serialize competing writers across OMP child processes and same-process DSH sessions.
- Commit only after the active Persona accepts the exact new revision through HMR.
- Restore previous bytes when candidate reload fails or cannot be confirmed.
- Ship one host-independent Agent Skill from this repository through skills.sh-compatible tooling with a stable `doppelganger-` prefix.
- Preserve host neutrality, single-Cordis-root rules, clean dynamic tool replacement, and shipped `standard` behavior.

**Non-Goals:**

- General identity editing, arbitrary filesystem access, or writable policy selected by the model.
- Autonomous/background self-modification, scheduled reviews, or model calls outside a user turn.
- A principal-review protocol, slash-command protocol, OMP-specific `/persona` command, or DSH Web panel.
- A persistent proposal queue, durable rejected proposals, automatic merging, or multi-writer CRDT.
- Copying facts, secrets, project state, or ordinary user preferences from memory into Persona.
- Making Persona, memory, SQLite, or Agent Skills mandatory runtime dependencies.
- Treating Runtime Presets, Cordis plugins, skills, or host scopes as hostile-code sandboxes.

## Decisions

### 1. Split capability, workflow, and enforcement

Three independent layers own the feature:

```text
Runtime Preset
└── persona-authoring Cordis plugin
    ├── logical writable policy
    ├── persona.inspect
    ├── persona.revise
    ├── CAS + target lock
    └── atomic write + HMR rollback

Repository skill catalog
└── skills/persona/doppelganger-persona-evolution/SKILL.md
    └── evidence and review workflow

Host adapter
└── generic required portable-tool approval
```

The skill has no authority. The plugin has no host UI. The host has no Persona knowledge.

Alternative: register `/doppelganger review` in `packages/omp`. Rejected because a Runtime Preset capability would become a manually maintained product feature of one host.

Alternative: add a generic Commands Protocol immediately. Rejected because the first workflow already fits inspect/revise tools plus Agent Skills; commands would add a second projection subsystem without enabling the core mutation.

### 2. Add `packages/extension-persona-authoring`

The new package exports one Loader-compatible plugin and focused public types. Its package edges are limited to:

- peer `@deepseek-ai/cordis`;
- `@doppelganger/doppelganger-persona`;
- `@doppelganger/doppelganger-protocols`.

It does not depend on runtime-presets, composition-runtime, OMP, DSH, memory, SQLite, embeddings, or vector storage. It injects `doppelgangerPersona` and `doppelgangerTools` in the same Runtime Session isolation realm.

Configuration is strict and small:

```ts
interface PersonaAuthoringConfig {
  readonly writableTargets: readonly `trait:${string}`[]
  readonly maximumAssetBytes?: number      // bounded default
  readonly hmrTimeoutMs?: number            // bounded default
  readonly lockTimeoutMs?: number           // bounded default
}
```

Only unique `trait:<name>` values are accepted. Each must resolve to exactly one selected active trait. `identity`, paths, globs, absent traits, blank names, unknown fields, and duplicate targets fail activation before tools register.

Alternative: configure paths directly. Rejected because model/tool policy should refer to active Persona semantics, not an arbitrary filesystem capability.

Alternative: put write methods on `doppelgangerPersona`. Rejected because Persona core should remain an immutable description and read/reload provider; mutability is optional product behavior.

### 3. Expose two tools only

`persona.inspect` is read-only:

```ts
{
  target: "identity" | `trait:${string}`
}
```

It returns:

```ts
{
  target: string
  writable: boolean
  content: string
  revision: `sha256:${string}`
}
```

The revision hashes the exact current file bytes, not trimmed rendered content. This makes newline, encoding, and external-edit changes visible to CAS. The returned `content` is the validated UTF-8 text the user would replace. Inspection rejects non-regular files, symlinks, invalid UTF-8, and oversized files. It never accepts a path argument.

`persona.revise` is mutation-capable:

```ts
{
  target: `trait:${string}`
  expectedRevision: `sha256:${string}`
  replacement: string
  rationale: string
  evidenceIds?: string[]
}
```

The complete replacement is required; patch syntax is intentionally absent. The plugin validates target policy, field bounds, UTF-8, non-empty trimmed content, and changed content before mutation. `evidenceIds` are bounded opaque references for the approval display/result only; Persona Authoring does not query memory or assign truth to them.

The tool descriptor declares:

```ts
approval: {
  policy: "required",
  reason: "This changes active Persona instructions."
}
```

Alternative: expose `persona.apply(path, diff)`. Rejected because paths and fuzzy patches create general file authority and ambiguous conflict behavior.

Alternative: persist a proposal and approve later. Rejected for the first milestone because the native tool call already carries the exact proposed replacement and the host already owns one-shot approval. A proposal database would add expiry, reconciliation, and UI state without improving the core guarantee.

### 4. Extend the portable Tool Protocol with required approval

`ToolDefinition` and `ToolDescriptor` gain one optional immutable JSON-compatible field:

```ts
interface ToolApprovalRequirement {
  readonly policy: "required"
  readonly reason: string
}
```

The protocol validates a non-empty bounded reason, clones/freezes the value, includes it in descriptor equality/change notifications, and carries it through the OMP wire contract and direct DSH bridge. There is no `allow`, `deny`, tier, callback, host widget, or feature-specific data in the portable contract.

Host obligation:

- no declaration: existing host policy;
- `required`: one explicit grant for this exact call before portable invocation;
- rejection/cancellation/unavailable channel: no handler invocation;
- host cannot implement the guarantee: fail the call closed or keep the tool unavailable.

This is a tool-owned minimum, not a replacement for stricter host policy. A host may still deny the tool completely.

Alternative: classify `persona.revise` as `write` and rely on host mode. Rejected because OMP `yolo` and DSH deployment policy could otherwise auto-allow the mutation.

Alternative: make approval a Persona-specific RPC. Rejected because it couples hosts to one extension and repeats the architectural mistake the generic tool protocol exists to avoid.

### 5. Map approval through native host mechanisms

#### OMP

For a required portable descriptor, the dynamically registered OMP proxy sets a native approval decision equivalent to:

```ts
{
  tier: "write",
  policy: "prompt",
  reason: descriptor.approval.reason
}
```

OMP's tool-owned `policy: "prompt"` remains authoritative in `yolo`. `formatApprovalDetails` adds the portable name and a deterministic bounded JSON rendering of exact parsed arguments. OMP prompts once; only after a grant does proxy execution send `tools.invoke` to the child. A denied prompt never crosses the transport.

Approval metadata is part of candidate projection. A committed reload replaces it with the descriptor; an invalid reload retains the prior proxy; stale closures still resolve the current committed descriptor before transport.

#### DSH

The active `add-deepseek-harness-host` change is revised before implementation. Projected descriptors are retained in the per-agent committed map. An agent-scoped `tools/pre-execute` waterfall listener checks whether the exact projected portable tool currently requires approval and returns `{ kind: "ask", reason }`; ordinary tools delegate with `next()`. DSH Tool Runtime then calls its scoped `ApprovalService` and invokes the portable closure only for `allowed-once`.

If the host composition has no ApprovalService/answerer, DSH already maps the ask to denial. Exact `agent`, `callId`, and current descriptor identity preserve call correlation. The host plugin remains Persona-neutral.

Alternative: call `ctx.approval.request()` inside the projected tool body. Rejected because it bypasses the native pre-execute stage and can create duplicate policy prompts when another DSH gate also asks.

### 6. Use exact-byte CAS under an interprocess lock

Every target has one adjacent lock path derived internally from its canonical file path. The lock is acquired with exclusive creation and contains an unguessable ownership token plus bounded diagnostic metadata. The implementation waits with bounded backoff until `lockTimeoutMs`.

The first milestone does not aggressively delete a lock merely because it is old. It may recover only when ownership death can be proven by a same-host process check and the lock still contains the originally inspected token. Unknown or unverifiable ownership fails closed. The disposer removes a lock only when its token still matches.

After acquiring the lock, `persona.revise`:

1. reopens the exact active path without following a symlink;
2. verifies regular-file identity and size;
3. reads exact bytes and computes current SHA-256;
4. if current equals replacement revision, returns `already-current`;
5. otherwise requires current to equal `expectedRevision`;
6. writes the replacement to a same-directory temporary file with exclusive creation;
7. flushes and closes the temporary file;
8. applies the original target mode;
9. atomically renames it over the target;
10. removes the temporary path in every failure branch.

Same-directory rename gives atomic visibility. The lock covers candidate write, HMR confirmation, and any rollback, so a competing approved writer cannot observe a half-resolved transaction.

Alternative: process-local promise queue only. Rejected because OMP sessions run in different child processes.

Alternative: SQLite advisory locking. Rejected because Persona Authoring should not require a storage plugin merely to update one authored file, and filesystem ownership must still be coordinated.

### 7. Correlate HMR outcomes by byte revision and roll back

The Persona asset event becomes a public contract with:

```ts
interface PersonaAssetReloadEvent {
  readonly url: string
  readonly outcome: "success" | "failed"
  readonly revision?: `sha256:${string}`
}
```

The asset lifecycle hashes the exact bytes it attempted to read. A successful event carries the accepted byte revision. A failed readable candidate carries its observed revision; an unreadable candidate may omit it. Existing last-good behavior remains unchanged.

Before rename, Persona Authoring subscribes for the canonical asset URL and candidate revision. After rename it waits up to `hmrTimeoutMs`:

- matching success: commit and return `applied`;
- matching failure: restore prior bytes atomically;
- timeout: inspect current bytes, then restore only while it still owns the lock and target remains the candidate revision;
- unrelated revision event: ignore it.

Rollback uses the same atomic replacement path and waits for the exact previous revision. If filesystem restoration succeeds but confirmation times out, the result is `PERSONA_ROLLBACK_UNCONFIRMED`; Persona's in-memory last-good content remains active and the returned diagnostic includes candidate, restored, and observed filesystem revisions.

The result never says `applied` until the active context provider accepted the exact candidate.

Alternative: treat successful rename as success. Rejected because an empty/invalid asset would remain on disk while Persona silently retained last-good instructions.

Alternative: wait for URL plus success only. Rejected because a second filesystem edit could emit success and falsely satisfy the first transaction.

### 8. Keep the first version stateless beyond the authored file

There is no proposal table or revision database. The old bytes exist only for the duration of the locked transaction and rollback. Durable version history remains the responsibility of the user-owned preset's filesystem backup/version control until a real product requirement justifies a revision store.

This keeps retry semantics simple:

- expected revision matches and replacement differs -> attempt one transaction;
- replacement is already current -> `already-current`;
- expected revision is stale -> conflict;
- approval is denied/unavailable -> handler never starts;
- HMR candidate fails/times out -> restore and fail.

Alternative: add immutable SQLite history now. Rejected because it expands recovery, retention, privacy, migration, and cross-home semantics before the basic approved mutation has been proven.

### 9. Ship evolution guidance from the Doppelganger repository

The canonical source layout is:

```text
doppelganger/
└── skills/
    └── persona/
        └── doppelganger-persona-evolution/
            └── SKILL.md
```

The repository keeps distributable skills beside the plugins and documentation whose contracts they teach; a separate repository per plugin would split one product change across release units without an independent lifecycle requirement. The ID uses a flat `doppelganger-` prefix because Agent Skills names are kebab-case and host slash syntax is not portable. Current skills.sh-compatible discovery scans this source depth, then project-scoped installation with the `universal` target copies the selected bundle to `.agents/skills/doppelganger-persona-evolution`, a root both target hosts scan. Global `universal` installation is not documented because its host-specific user path is not shared by OMP and DSH.

Host-native invocation remains:

```text
OMP: /skill:doppelganger-persona-evolution review
DSH: /doppelganger-persona-evolution review
```

`review --dry-run` performs inspect/evidence analysis and displays a replacement without invoking `persona.revise`.

The skill directs the agent to:

1. inspect `trait:evolving-profile`;
2. gather only relevant durable observations already available through composed tools/context;
3. distinguish assistant qualities from user facts/preferences and task-local instructions;
4. require multiple independent observations unless the user explicitly requests the change;
5. preserve unrelated trait meaning and draft one complete minimal replacement;
6. explain the behavioral delta;
7. invoke `persona.revise` at most once;
8. stop on rejection, unavailable authoring, conflict, rollback, or weak evidence.

Alternative: bundle the skill inside a Runtime Preset or invent a Doppelganger skill loader. Rejected because OMP and DSH already consume project `.agents/skills`, and current skills.sh-compatible tooling can install the repository-owned source there.

### 10. Opt in only Mark; keep standard read-only

The development Mark preset adds:

```text
traits/evolving-profile.md
```

and selects it as a normal Persona trait. A Loader row then enables only `trait:evolving-profile` in Persona Authoring. The current user copy at `~/.doppelganger/.runtime-presets/mark` receives the same trait selection and authoring row as an explicit local deployment step after the package is available.

`identity.md`, `engineer`, and `concise` are still inspectable but not writable. The shipped actor-neutral `standard` preset does not compose Persona Authoring and remains unchanged. Runtime Preset copy semantics are unchanged: copying a preset copies its complete assets and authored capability policy.

The neutral `@doppelganger/doppelganger-omp` package includes Persona Authoring in its private product dependency closure only so Loader can resolve a user preset that names it. `host-omp` itself has no dependency on the package.

### 11. Bound inputs and structured failures

Defaults and maxima are implementation constants covered by tests. At minimum:

- asset bytes are bounded before allocation and decode;
- rationale and evidence reference count/length are bounded;
- approval reason is bounded in the protocol;
- JSON approval argument rendering is bounded in each host;
- lock wait and HMR wait are finite;
- temporary and lock filenames are derived internally and never accepted from tool input;
- error messages do not expose unrelated file contents.

Stable domain errors include:

```text
PERSONA_TARGET_UNKNOWN
PERSONA_TARGET_READ_ONLY
PERSONA_ASSET_UNSAFE
PERSONA_ASSET_TOO_LARGE
PERSONA_REVISION_CONFLICT
PERSONA_LOCK_TIMEOUT
PERSONA_REVISION_REJECTED
PERSONA_HMR_TIMEOUT
PERSONA_ROLLBACK_UNCONFIRMED
```

Host approval denial remains a native host outcome because the runtime handler was never invoked.

### 12. Documentation and active-change reconciliation are part of implementation

Implementation updates the owning documents for Persona, protocols, OMP, configuration, verification, security/trust, status/scope, and README usage. The active `add-deepseek-harness-host` proposal/design/spec/tasks are updated before either change is applied so its portable tool projection includes the new approval field and required-approval scenarios. Archived change artifacts remain untouched.

## Risks / Trade-offs

- **Approval is host-enforced.** A new host can violate the portable contract. Mitigation: descriptors remain unavailable unless the adapter explicitly implements required approval; host conformance tests prove handler non-invocation.
- **Trusted plugin model.** A malicious Runtime Preset can run arbitrary Node code regardless of Persona Authoring. Mitigation: document that writable targets constrain this product plugin, not arbitrary trusted Cordis code.
- **Filesystem locks are imperfect across machines and network filesystems.** Mitigation: user Runtime Presets are local authored state; fail closed on unverifiable locks and do not claim distributed-filesystem safety.
- **Crash after rename before rollback.** The file may contain a candidate that Persona did not confirm. Mitigation: exact HMR result prevents false success; next inspection exposes filesystem revision; atomic bytes remain recoverable by ordinary user backup/version control. A durable journal is deferred until evidence justifies it.
- **Atomic rename watcher behavior varies.** Mitigation: exercise real Composition Runtime/OMP file watching, not only synthetic `hmr/change` tests; restoration is still atomic.
- **No persistent revision history.** Rollback is transactional, not a user-facing history feature. Mitigation: keep scope honest and add durable history only with explicit retention and recovery requirements.
- **Memory evidence is advisory.** The skill can misclassify evidence. Mitigation: the user sees the exact complete replacement in native approval arguments and can reject it; plugin policy never trusts evidence IDs as authorization.
- **Repository skill availability.** The skill is installable only after the owning Doppelganger revision is published. Mitigation: verify both a local checkout install and the public repository install before documenting the command as available.
- **DSH change is concurrent planning.** Two active changes can drift. Mitigation: revise the active DSH artifacts in this change's implementation preparation and validate all live specs together before code cutover.
