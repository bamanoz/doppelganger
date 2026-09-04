## 1. Regression Harness and Failing Scenarios

- [x] 1.1 Extend `packages/host-omp/tests/extension.spec.ts` fixtures with mutable session ID and CWD, multiple child connections, controllable activation/disposal settlement, and captured `context`, switch, branch, tree, agent-end, session-stop, and shutdown handlers.
- [x] 1.2 Add failing scenarios proving context is resolved once per user-initiated agent run, preserves existing host instructions, remains stable through tool continuations, and fails open without stale context.
- [x] 1.3 Add failing scenarios for new/resume/fork and branch rebinding, same-session tree retention, replacement activation failure, ordered neutral disposal/start lifecycle, and binding-owned event identities.
- [x] 1.4 Add failing race scenarios proving pending activation, child notifications, lifecycle callbacks, context results, and retained proxy closures cannot mutate or invoke a newer binding or survive shutdown.

## 2. Serialized OMP Session Ownership

- [x] 2.1 Introduce an extension-local immutable binding model and one serialized ownership queue covering desired session generation, current session ID/CWD, adapter state, turn state, ordinals, descriptor projection, and closed state.
- [x] 2.2 Migrate initial `session_start` activation and the initialize-tool restart path onto the coordinator, preserving valid inactive selection, current diagnostics, and exact non-Doppelganger active tools.
- [x] 2.3 Register post-commit `session_switch`, `session_branch`, and `session_tree` hooks; implement detach-first neutral disposal and fresh activation when session ID or canonical CWD changes, with an idempotent no-op for unchanged same-session navigation.
- [x] 2.4 Guard adapter tool/runtime notifications and failure callbacks by binding generation so superseded children cannot replace projections, report against, fail, or revive the current binding.
- [x] 2.5 Bind every projected tool closure to its registering generation and current canonical descriptor so retained closures from an old OMP session fail `RUNTIME_UNAVAILABLE` even when the new session exposes the same portable name.

## 3. Per-Turn Context and Lifecycle Correctness

- [x] 3.1 Use `before_agent_start` to ensure the current binding, create binding-local principal input and turn identity, resolve one context snapshot, and append it to the run-scoped OMP system prompt.
- [x] 3.2 Remove the per-request `context` projection path and prove tool-driven model continuations send no additional `context.resolve` request for the active user turn.
- [x] 3.3 Move turn and compaction ordinals into the binding and derive all session, turn, call, and delivery identities from the captured owning binding rather than mutable OMP session state.
- [x] 3.4 Discard late lifecycle callbacks from detached bindings, preserve existing committed-turn and tool-result ownership semantics, and prove `agent_end` and `session_stop` never fabricate `session-completed`.
- [x] 3.5 Route `session_shutdown` through the coordinator by synchronously closing eligibility, detaching projection, and starting bounded exhaustive neutral disposal without waiting inside OMP's short shutdown handler or permitting later activation commit.

## 4. Documentation

- [x] 4.1 Update `docs/hosts/oh-my-pi.md` to document immutable per-session child bindings, post-commit rebinding behavior, same-session tree retention, per-turn system-prompt context, binding-owned lifecycle identities, and neutral disposal semantics.
- [x] 4.2 Update `docs/architecture/protocols.md` to distinguish `per-turn` from `per-request` context delivery without adding OMP hooks to the baseline protocol.

## 5. Verification and Cleanup

- [x] 5.1 Run `npx tsc -p packages/host-omp/tsconfig.json --noEmit` and the focused `packages/host-omp` tests covering extension ownership, projection, transport, child integration, and shutdown behavior.
- [x] 5.2 Run the linked `packages/omp/tests/plugin-package.spec.ts` scenario to verify the real local OMP package still loads the extension and projects the corrected hooks through the isolated install.
- [x] 5.3 Remove obsolete global adapter/turn state and stale prompt-projection assertions, ensure no compatibility path or duplicate transition watcher remains, and reconcile planned evidence names with the implemented behavioral tests.
- [x] 5.4 Run `npm run check` and update the delta spec evidence from `planned:` to exact passing test references before handoff.
