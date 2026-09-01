## Context

The lifecycle protocol currently models a completed tool twice: once as a standalone `tool-completed` event and again as `CommittedToolOutcome` inside the enclosing `turn-committed` event. The OMP adapter therefore keeps a per-turn outcome map, populates it from `tool_execution_end`, backfills it from `turn_end.toolResults`, and serializes the aggregate at commit. Repository capture consumers use the committed principal and assistant content; they do not consume the duplicated aggregate.

This is a breaking public protocol change spanning `extension-protocols`, `host-omp`, memory-capture fixtures, tests, OpenSpec requirements, and authoritative lifecycle/host documentation. The repository is a private experimental workspace, so the change uses a clean coordinated cutover rather than a compatibility period.

## Goals / Non-Goals

**Goals:**

- Make `tool-completed` the sole lifecycle event carrying a completed tool result or structured tool error.
- Narrow `turn-committed` to the committed principal input, assistant output, turn outcome, error metadata, timestamp, and stable identities.
- Remove OMP's per-turn tool-result aggregation and its fallback parsing of `turn_end.toolResults`.
- Make the breaking schema change explicit through a new lifecycle protocol version and strict boundary validation.
- Preserve existing session, turn, call, and delivery correlation semantics.

**Non-Goals:**

- Changing OMP's framed JSON-RPC protocol or transport methods.
- Combining lifecycle events into a reconstructed transcript for consumers.
- Persisting tool outcomes separately or changing memory capture behavior.
- Retaining a deprecated `toolOutcomes` alias, accepting both lifecycle shapes, or synthesizing missing `tool-completed` events from `turn_end`.

## Decisions

### Advance the lifecycle protocol version and reject the legacy field

`LIFECYCLE_PROTOCOL_VERSION` advances for the breaking payload change. `TurnCommittedEvent` loses `toolOutcomes`, `CommittedToolOutcome` is removed from the public API, and `normalizeLifecycleEvent` rejects a `turn-committed` payload that still contains the legacy field. The OMP RPC frame version remains unchanged because the RPC method set and framing are unchanged; the lifecycle event carried by `event.publish` owns its own version.

Alternative: keep the lifecycle version and silently ignore an extra field. Rejected because it makes incompatible producers appear valid and weakens the protocol boundary.

### Publish tool results only from `tool_execution_end`

The OMP adapter publishes one `tool-completed` event directly from each `tool_execution_end` payload. The event retains the existing bounded result/error projection and stable session, turn, call, and delivery identities. `ActiveTurn` retains only turn identity, principal input, and start state. `turn_end.toolResults` is not parsed or copied into lifecycle events.

Alternative: synthesize `tool-completed` events from aggregate `turn_end.toolResults` when no matching hook was observed. Rejected because it preserves hidden aggregation state, creates duplicate/reordering ambiguity, and conflicts with assigning one authoritative hook to each event kind.

### Keep turn continuation and commit semantics unchanged

A `turn_end` whose assistant message requests tool use still does not commit the turn. The final `turn_end` publishes one `turn-committed` event with principal input and final assistant output, using the existing outcome/error, timestamp, and deterministic delivery identity logic. Only the tool aggregate is removed.

Alternative: commit each assistant/tool cycle as a separate turn. Rejected because it changes established turn identity and candidate-capture semantics beyond this contract cleanup.

### Verify absence as part of observable behavior

Protocol tests will assert that a normalized `turn-committed` event has no `toolOutcomes` property and that legacy-shaped input is rejected. OMP integration tests will continue exercising a tool-using turn, assert the standalone `tool-completed` payload, and assert the final `turn-committed` payload excludes tool results. Capture fixtures and direct RPC fixtures will move to lifecycle version 2 without the removed field.

Alternative: rely only on TypeScript compilation. Rejected because transport input is runtime data and extra object properties can bypass compile-time checks.

## Risks / Trade-offs

- [A host omits `tool_execution_end` but includes a result in `turn_end`] → That result is no longer forwarded. This is intentional: the adapter does not reconstruct missing authoritative events from aggregate data; the OMP integration scenario verifies the supported hook sequence.
- [Consumers previously read a complete tool summary from `turn-committed`] → They must subscribe to `tool-completed` and correlate by stable `sessionId` and `turnId`; the version bump makes stale consumers fail visibly.
- [Lifecycle and RPC versions can be confused] → Documentation and tests explicitly state that only the lifecycle event contract advances; the framed RPC protocol does not.
- [Partial migration creates compile or runtime failures] → Update the protocol type/validator, host producer, fixtures, tests, specs, and docs in one change and run the repository-wide check.

## Migration Plan

1. Advance the lifecycle protocol version, remove `CommittedToolOutcome` and `TurnCommittedEvent.toolOutcomes`, and enforce rejection of the legacy field.
2. Remove OMP turn-level outcome state and aggregate parsing; publish tool completion data only from `tool_execution_end`.
3. Update lifecycle, OMP, memory-capture, and transport fixtures and assertions to the new event shape and version.
4. Update the owning protocol and OMP documentation plus the main specifications.
5. Run narrow package tests/typechecks, exercise the real OMP lifecycle path, then run `npm run check`.

Rollback is an atomic revert of the protocol, host, fixtures, requirements, and documentation. No persistent data migration or cleanup is required.

## Open Questions

None.
