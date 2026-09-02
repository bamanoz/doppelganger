## Context

OMP keeps one extension runner alive while the user creates, resumes, forks, branches, and navigates sessions. Its post-commit `session_switch` and `session_branch` hooks run after OMP has installed the new session ID and working directory; `session_tree` rewrites the active branch inside the same session. The current Doppelganger extension listens only to initial `session_start`, stores one process-wide `OmpAdapterSession`, and reads `ctx.sessionManager.getSessionId()` again when later lifecycle callbacks publish. The result can combine a child activated for session A with lifecycle identities from session B.

OMP also exposes two different prompt seams. `before_agent_start` runs once for a submitted prompt and can replace the turn system prompt. `context` runs over a copied message array before every main-loop model request and does not mutate persisted session history. The adapter currently resolves Doppelganger context in `before_agent_start`, so later requests in the same run continue using context captured before tools, reload, retry, or continuation work.

The portable protocols already contain the required semantics: Runtime Session metadata has stable session ID and workspace root, context resolution is turn-sensitive, and lifecycle distinguishes terminal `session-completed` from neutral `session-disposed`. This change needs no protocol version, RPC method, public export, Runtime Preset format, or optional host capability.

## Goals / Non-Goals

**Goals:**

- Make one immutable Doppelganger binding correspond to exactly one OMP session identity and workspace snapshot.
- Replace the binding after committed OMP new/resume/fork/branch transitions and retain it for same-session tree navigation.
- Prevent stale activation, notification, lifecycle, context, tool, and shutdown work from affecting a newer binding.
- Resolve and project current portable context before every OMP model request without persisting synthetic messages.
- Keep all lifecycle identities derived from the binding that owns the event and keep OMP session completion reporting neutral when terminal evidence is absent.
- Preserve the existing fail-open boundary: Doppelganger failure disables only Doppelganger and leaves ordinary OMP operation usable.

**Non-Goals:**

- Add cancellation, conversation control, native tool interception, UI, model control, or any other optional host capability.
- Mirror the wider OMP Extension API into portable protocols.
- Change lifecycle protocol version 2 or make `session-completed` mandatory for hosts without terminal outcome evidence.
- Reuse a child across distinct OMP sessions or migrate session-scoped plugin state between bindings.
- Treat `session_tree` navigation as a new Runtime Session.
- Change the DSH adapter design beyond consuming the same corrected host-neutral semantics.

## Decisions

### 1. Introduce one extension-local session ownership coordinator

`createDoppelgangerOmpExtension` will own a small coordinator rather than independent mutable `adapter`, `turn`, and ordinal variables. The coordinator maintains:

```text
Desired OMP state
  sessionId + canonical cwd + monotonically increasing generation
                          |
                          v
Serialized ownership queue
  detach old -> dispose old -> activate candidate -> commit candidate
                          |
                          v
Current immutable binding
  generation
  sessionId
  cwd/workspace activation snapshot
  OmpAdapterSession
  turn + turn ordinal + compaction ordinal
  committed descriptors/projection identity
```

Every initial start, session transition, explicit initialization restart, failure-driven projection update, and shutdown request enters the same ordered queue. A shutdown flag and desired-generation counter are updated synchronously before enqueueing so an older operation cannot commit after shutdown or after a newer session becomes desired.

A binding is compared by the current OMP `sessionId` and canonical `cwd`. A post-commit transition with an unchanged tuple is a no-op. Including `cwd` protects Runtime Session workspace metadata and project Runtime Preset selection if OMP reloads the same session identity under a changed local workspace. `session_tree` calls the same ensure operation, normally observes an unchanged tuple, and therefore retains the child.

Alternative considered: mutate the existing child with a new session ID. Rejected because Runtime Session identity, actor binding, workspace metadata, plugin tree, storage selection, and reload watchers are immutable/session-owned contracts.

Alternative considered: keep the old binding when replacement activation fails. Rejected because OMP has already committed the new session; retaining old context, tools, or persistence partition would be a cross-session correctness violation.

### 2. Use detach-first clean cutover with guarded candidate commit

When the desired binding changes, the coordinator will:

1. synchronously make the old binding ineligible for new work and clear active turn ownership;
2. withdraw its projected tool names from OMP;
3. publish one bounded deterministic `session-disposed` event through the old binding's own connection when it was active;
4. exhaustively dispose the old `OmpAdapterSession`;
5. resolve activation from the new hook context's current `sessionId` and `cwd`;
6. create and start a candidate adapter whose callbacks capture its binding generation;
7. discard and dispose the candidate if shutdown or a newer desired generation appeared while it awaited;
8. otherwise commit it, project its current tools, and publish `session-started` through its own connection.

Inactive selection is still a valid committed binding state: it exposes only the initialize path for that OMP session. Failed activation commits an unavailable diagnostic state for the new session and never restores the old projection.

Adapter notification callbacks (`tools.changed`, `runtime.changed`, `runtime.failed`) capture the binding token. They may update their session-local adapter state, but all extension-visible projection or diagnostics are queued and ignored unless that exact binding remains current. This avoids expanding the public `OmpAdapterSession` API solely for coordination.

Alternative considered: resolve and activate the candidate while the old projection remains live, then swap. Rejected because tools and context from the prior OMP session would remain callable after OMP had committed the new session identity.

### 3. Make projected tool closures binding-specific

Each registered OMP proxy closure will capture both the portable descriptor identity and the binding generation that registered it. Invocation succeeds only when:

- the captured binding is still the current active binding;
- the proxy still maps to the same portable name in that binding's committed descriptor map; and
- that binding still owns an active child connection.

This is stricter than the current global descriptor-name check. Without the generation check, a retained closure from session A could invoke a same-named tool in session B. OMP registrations may remain process-local and be replaced under the same proxy name, but stale references fail with `RUNTIME_UNAVAILABLE`.

Projection replacement remains exact: candidate schemas are validated before activation, the current non-Doppelganger active-tool set is preserved, removed names become inactive, and initialization availability follows only the current binding.

Alternative considered: unregister every OMP tool definition on transition. Rejected because the public registration seam is replacement/active-list oriented; binding guards provide the required safety without inventing unsupported deletion semantics.

### 4. Split agent-run identity setup from per-request context projection

`before_agent_start` remains responsible for ensuring the current binding and creating one active portable turn:

```text
turnId = <binding.sessionId>:turn:<binding-local ordinal>
principalInput = event.prompt
started = false
```

It no longer resolves or modifies the system prompt. The OMP `context` hook captures the current binding and active turn, requests `context.resolve` using that immutable `sessionId`/`turnId`/principal input, and returns a new message array. Non-empty assembled content is appended as one ephemeral agent-attributed `developer` text message. OMP already uses developer messages for model-visible runtime guidance, and its context runner clones the outbound messages before handlers execute; the synthetic contribution therefore does not enter session persistence.

The hook resolves on every invocation, including later requests after tool execution or runtime reload. It never mutates `event.messages`, and one invocation appends at most one synthetic message. An empty result returns the original array. If resolution fails, the captured binding is failed only if it is still current, the original messages are returned unchanged, and stale failure cannot disable a replacement binding.

This preserves OMP's existing system prompt instead of replacing it. The authority-aware assembler remains the source of the flattened accepted content; this change does not redesign context contribution representation.

Alternative considered: use `before_provider_request` to rewrite provider payload system instructions. Rejected because the payload is provider-specific and would turn a host-neutral context projection into model-provider coupling.

Alternative considered: continue using `before_agent_start`. Rejected because it cannot observe context changes between model requests in one agent run.

### 5. Bind lifecycle state and identities to the owning binding

Turn state and ordinals move inside the binding. `turn_start`, `tool_execution_start`, `tool_execution_end`, `turn_end`, and `session_before_compact` capture the current binding/turn once and publish only through that binding if it remains eligible. They never call `getSessionId()` after asynchronous work starts.

Delivery identities continue using the existing deterministic scheme, but their session component always comes from `binding.sessionId`. Binding-local ordinals reset for a new OMP session. Tool and turn callbacks arriving after detachment are discarded rather than relabelled or forwarded into the replacement child.

`turn_end` continues to publish one committed portable turn only after the final non-tool-use assistant result. Aggregate `turn_end.toolResults` remain excluded. This change does not reinterpret OMP model iterations as separate principal turns.

### 6. Keep OMP session termination neutral

OMP `agent_end` and `session_stop` mean that the current agent loop is idle and may still be resumed or automatically continued. `session_shutdown` means process teardown and carries no completed/failed/cancelled session outcome. None is sufficient evidence for portable `session-completed`.

Rebinding and shutdown therefore publish at most one `session-disposed` event with a bounded reason through the detached binding. `session-completed` remains available in the host-neutral protocol for hosts that possess terminal outcome facts, but OMP does not fabricate one.

Alternative considered: map `agent_end` or `session_stop` to `session-completed`. Rejected because later prompts, automatic continuations, branch operations, and resume remain valid after those events.

### 7. Preserve prompt shutdown responsiveness

OMP gives `session_shutdown` a short fire-and-forget handler budget. The handler will synchronously mark the coordinator closed, clear eligibility for new work, and enqueue bounded teardown, then return without awaiting child disposal. The detached teardown keeps the existing timeout and escalation behavior, but it runs through the ownership queue and checks every pending candidate so no activation can publish or project after shutdown.

Session switch and branch hooks are awaited by OMP and may await the full clean cutover because the new session must not receive stale Doppelganger state. Tree navigation normally takes the no-op fast path.

## Risks / Trade-offs

- **Transition latency:** a session switch waits for bounded old-child disposal and fresh activation. This is deliberate; exposing the new OMP session with the old runtime would be incorrect. Existing shutdown escalation bounds must also be applied to replacement disposal so a stuck child cannot block navigation indefinitely.
- **Ephemeral developer-message semantics:** OMP's only public per-request host-neutral seam transforms messages, not the system prompt. A developer message is slightly different from a system-prompt suffix, but it preserves host instructions, works across providers through OMP's normal conversion, and is refreshed on every request. Tests must exercise the actual OMP transform path, not only a handcrafted payload shape.
- **Notification races:** the child can notify during activation or disposal. Generation checks must cover callbacks, proxy closures, context resolution, lifecycle publication, and diagnostics; guarding only tool projection is insufficient.
- **Repeated transition hooks:** OMP may emit a resume/reload hook for the same session. Tuple comparison must make this idempotent and avoid unnecessary child replacement.
- **Inactive sessions:** no selected Runtime Preset still needs session-scoped initialization behavior. The coordinator must not confuse a valid inactive binding with absence of ownership.
- **Concurrent active OpenSpec work:** `add-deepseek-harness-host` plans to extract the protected host-neutral bridge from `host-omp`. This change should avoid moving or redesigning that bridge; if the DSH change lands first, implementation must rebase onto the extracted bridge while retaining the OMP ownership semantics here.

## Migration Plan

1. Extend the OMP extension test harness to support mutable session ID/CWD, multiple child connections, controllable pending activation/disposal, and invocation of the `context` and transition hooks.
2. Add failing behavioral scenarios for per-request context, session switch/branch/tree behavior, stale callbacks and closures, replacement failure, shutdown races, and neutral lifecycle ordering.
3. Introduce the binding/coordinator state and migrate initial start plus initialization restart onto its serialized path.
4. Register post-commit OMP transition hooks and implement detach-first rebinding.
5. Move turn state and all lifecycle publication to binding-owned identities.
6. Move context resolution from `before_agent_start` to `context` and verify ephemeral message projection through the real OMP package scenario.
7. Update OMP documentation and run package typechecks, focused host tests, linked OMP plugin tests, then the repository-wide check.

No durable data migration is required. Each existing OMP session receives a fresh child when the updated extension starts, as it already does on process start.

## Open Questions

None. OMP source establishes the required hook ordering and semantics: `session_switch`/`session_branch` are post-commit identity transitions, `session_tree` is same-session history navigation, `context` runs before each LLM call over copied messages, and shutdown provides no terminal session outcome.
