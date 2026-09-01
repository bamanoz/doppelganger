## Why

`turn-committed` currently duplicates completed tool results that are already published through per-call `tool-completed` lifecycle events. Removing that duplication makes event ownership explicit, avoids aggregate tool-result assembly at the OMP `turn_end` boundary, and narrows the host-neutral contract without losing any lifecycle observation.

## What Changes

- **BREAKING**: Remove `toolOutcomes` from the host-neutral `turn-committed` lifecycle payload.
- Define `turn-committed` as the committed principal input and assistant output only; completed tool observations remain exclusively in `tool-completed` events correlated by stable session, turn, call, and delivery identities.
- Stop forwarding OMP `turn_end` tool results into `turn-committed`; continue forwarding each authoritative `tool_execution_end` result through `tool-completed`.
- Increment the lifecycle event protocol version for the breaking payload change while leaving the OMP framed RPC protocol unchanged.
- Update lifecycle validation, fixtures, tests, and authoritative documentation to enforce the non-duplicated event model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `extension-protocols`: Narrow the normalized `turn-committed` contract so it excludes tool outcomes while preserving separate correlated `tool-completed` observations.
- `hosts/oh-my-pi`: Change OMP lifecycle mapping so `turn_end` publishes only committed principal/assistant content and tool results are published only from `tool_execution_end`.

## Impact

- Public protocol contract: `TurnCommittedEvent` and its boundary validator in `@doppelganger/doppelganger-protocols`.
- Host integration: OMP hook mapping and lifecycle publication in `packages/host-omp`.
- Consumers and evidence: lifecycle/capture tests, host integration fixtures, main OpenSpec requirements, and lifecycle/OMP documentation.
- No new dependencies or persistence migration is planned. The lifecycle event contract advances as one clean repository-wide cutover; the OMP framed RPC protocol remains unchanged and no compatibility shim is retained.
