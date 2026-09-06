## MODIFIED Requirements

### Requirement: Tool definitions use transport-neutral JSON Schema
A tool definition SHALL include a stable qualified name, description, supported JSON Schema input contract, availability, transport-neutral invocation result, and optional validated approval requirement. An approval requirement SHALL be JSON-compatible metadata containing `policy: "required"` and MAY contain a bounded non-empty advisory reason. Discovery SHALL preserve the same immutable approval metadata in the tool descriptor. Registration changes SHALL be observable by all active host adapters, while native projection SHALL obey each adapter's declared tool-delivery boundary. A `session-start` tool-delivery declaration SHALL NOT grant the ability to add newly registered tool names to an active native session. The reason SHALL NOT be required for enforcement or treated as authorization.

#### Scenario: Tool is added during reload
- **ID**: `extension-protocols.tools.added-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition update registers a tool for an active host whose declared tool delivery is `dynamic`
- **THEN** the host adapter receives the new descriptor, including exact approval metadata when declared, and can project it without restarting the session

#### Scenario: Tool is removed during reload
- **ID**: `extension-protocols.tools.removed-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** the owning extension unloads
- **THEN** the tool becomes unavailable and active hosts are notified

#### Scenario: Tool declares malformed approval metadata
- **ID**: `extension-protocols.tools.malformed-approval-rejected`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** a definition supplies an unknown policy, a supplied blank or oversized reason, unsupported value, or non-JSON-compatible approval field
- **THEN** registration fails before the descriptor becomes discoverable

#### Scenario: OpenClaw keeps its prepared native catalog fixed
- **ID**: `extension-protocols.tools.openclaw-prepared-catalog-boundary`
- **EVIDENCE**: `packages/host-openclaw/tests/reload.spec.ts::observes reload registrations without expanding the prepared native catalog`
- **WHEN** a valid composition update registers a tool name outside OpenClaw's prepared native catalog while a native session is active
- **THEN** OpenClaw observes the registration change but does not project the undeclared name into the active native session
