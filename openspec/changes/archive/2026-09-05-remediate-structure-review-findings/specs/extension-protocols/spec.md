## MODIFIED Requirements

### Requirement: Protocol payloads are serializable and bounded
Context requests, tool descriptors, invocation inputs and results, normalized lifecycle events, diagnostics, and notifications crossing a host transport SHALL satisfy their explicit size and depth limits. Protocol-owned JSON values SHALL be strictly validated before cloning, digesting, or transport serialization without executing coercion hooks or silently changing unsupported values. Host observation material entering the dedicated bounded lifecycle serializer SHALL retain its intentional lossy projection: unsupported details SHALL be omitted or represented as structured truncation metadata before the normalized event is validated. Strict command/result admission SHALL NOT be replaced by that observation projection.

#### Scenario: Tool result contains non-serializable host details
- **ID**: `extension-protocols.lifecycle.bounded-serializable-tool-result`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::serializes circular, binary, oversized, deep, and unsupported host values within explicit bounds`
- **WHEN** an adapter forwards a completed tool result containing unsupported values
- **THEN** it emits a bounded serializable representation and records that information was omitted
