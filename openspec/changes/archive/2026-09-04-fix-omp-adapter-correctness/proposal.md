## Why

The OMP extension runner survives session switches and branches, while the current adapter retains the child Runtime Session created for the previous OMP session and labels later lifecycle events with the new session ID. Runtime context also needs one explicit user-turn boundary: resolving it repeatedly after tools can duplicate stable identity, traits, and memory within one turn, while resolving it outside the active session binding can make ownership stale.

## What Changes

- **BREAKING**: Rebind the OMP adapter on every committed OMP session identity change instead of reusing the previous child Runtime Session, withdrawing old projections, neutrally disposing the old binding, and activating a fresh binding for the new session and workspace.
- Serialize activation, rebinding, failure, tool projection, lifecycle publication, and shutdown so no event or proxy can cross a session boundary or revive a superseded binding.
- Resolve portable context once through OMP's `before_agent_start` hook and append it to that agent run's system prompt, which OMP preserves through tool continuations without adding synthetic conversation history.
- Correlate every normalized lifecycle event with the immutable session binding that owns its child connection rather than repeatedly reading mutable OMP session state during a turn.
- Keep OMP lifecycle reporting truthful: settled agent loops and `session_stop` are not terminal session completion, so session replacement and process shutdown emit neutral `session-disposed` rather than fabricating `session-completed`.
- Add regression scenarios for new, resumed, and branched sessions; same-session tree navigation; multiple model requests in one agent run; transition races; projection cleanup; and neutral shutdown/completion semantics.
- Update the OMP host documentation to describe per-turn context and session-binding lifecycle.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `hosts/oh-my-pi`: Correct session ownership, per-turn context projection, lifecycle identity, transition serialization, and neutral completion behavior in the existing OMP host contract.

## Impact

- Affected implementation: `packages/host-omp/src/extension.ts`, its adapter/session ownership helpers, and possibly package-private OMP host types used to model one immutable binding.
- Affected verification: `packages/host-omp/tests/extension.spec.ts`, transition-focused host scenarios, and the linked `packages/omp/tests/plugin-package.spec.ts` smoke contract if registration expectations change.
- Affected documentation: `docs/hosts/oh-my-pi.md` and `docs/architecture/protocols.md` clarify the host-neutral context cadence and OMP's per-turn implementation.
- Runtime Host protocol version 2 and OMP RPC protocol version 4 add the explicit `per-turn` delivery value and capability handshake; no new Runtime Preset format, lifecycle protocol version, or framed RPC method is introduced.
- The active `add-deepseek-harness-host` change must continue to use the shared host-neutral contracts, but its in-process DSH lifecycle design is otherwise unchanged.
