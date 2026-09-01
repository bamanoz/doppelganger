## MODIFIED Requirements

### Requirement: OMP lifecycle mapping uses available authoritative hooks
The adapter SHALL map OMP session, turn, tool, and pre-compaction hooks to host-neutral lifecycle events using the authoritative payload for each event kind. Completed assistant content supplied by `turn_end` SHALL be forwarded through `turn-committed`, while completed tool results SHALL be forwarded only from `tool_execution_end` through correlated `tool-completed` events and SHALL NOT be duplicated from aggregate `turn_end` data.

#### Scenario: OMP turn ends
- **ID**: `lifecycle.turn.committed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** `turn_end` provides the completed assistant message and aggregate tool results
- **THEN** the normalized `turn-committed` event contains bounded principal input and assistant content with stable session and turn identities but no tool result payloads

#### Scenario: OMP tool ends
- **ID**: `lifecycle.tool.completed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads`
- **WHEN** `tool_execution_end` provides a result and error flag
- **THEN** the normalized `tool-completed` event contains the actual bounded result and corresponding outcome correlated to the active session, turn, and call

#### Scenario: OMP begins compaction
- **ID**: `lifecycle.precompaction`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::publishes bounded pre-compaction lifecycle material`
- **WHEN** `session_before_compact` fires
- **THEN** the adapter publishes a bounded pre-compaction observation before allowing OMP compaction to continue
