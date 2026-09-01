## MODIFIED Requirements

### Requirement: Lifecycle events identify committed work
Host-neutral lifecycle SHALL distinguish session start/completion, turn start/commit, tool start/completion, and pre-compaction. Every event SHALL carry stable session identity, relevant events SHALL carry stable turn and call identities, and each completed tool result SHALL be represented only by its correlated `tool-completed` event rather than duplicated in `turn-committed`.

#### Scenario: Turn completes normally
- **ID**: `extension-protocols.lifecycle.turn-committed-payload`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host commits a completed assistant turn that included tool calls
- **THEN** one `turn-committed` event contains the principal input, completed assistant output, timestamp, and completed outcome without tool outcome payloads

#### Scenario: Tool completes within a turn
- **ID**: `extension-protocols.lifecycle.tool-outcome-owned-by-completion`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host tool completes before its enclosing turn is committed
- **THEN** the bounded result or structured error is carried only by the correlated `tool-completed` event with stable turn and call identities

#### Scenario: Host emits streaming updates
- **ID**: `extension-protocols.lifecycle.streaming-is-not-committed`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** partial assistant or tool updates occur before commit
- **THEN** they do not masquerade as a committed turn or completed tool result
