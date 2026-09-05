## ADDED Requirements

### Requirement: Context resolution preserves authority for adapters
The Runtime Host bridge SHALL return immutable context projections that keep instruction-authority and data-authority content separate under one deterministic ordering and token budget. An adapter SHALL NOT need to parse delimiters or infer authority from flattened text.

#### Scenario: Runtime resolves mixed-authority context
- **ID**: `host.runtime.api.context-resolution-preserves-authority`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::returns authority-separated context through the shared bridge`
- **WHEN** active providers contribute both instructions and untrusted data
- **THEN** the bridge exposes each accepted contribution and authority-specific rendered content without promoting data into instructions

### Requirement: Owner removal terminates removed tool implementations
The shared bridge SHALL preserve the tool registry's owner-scoped call lifecycle. When an owned tool definition is removed or revised, calls executing that exact removed implementation SHALL be aborted and SHALL NOT return a successful result as though the definition remained current.

#### Scenario: Plugin reload removes an active handler
- **ID**: `host.runtime.api.reload-removes-active-handler`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::retains active calls only for unchanged definitions during owner replacement`
- **WHEN** a valid plugin reload removes a tool while one call is active
- **THEN** the call settles with the specified unavailable or cancelled result, the new catalog excludes the tool, and later stale closures cannot dispatch it

## MODIFIED Requirements

### Requirement: Correlated context resolution
Each context request SHALL carry a non-empty adapter-minted request identity, current principal input, optional stable turn identity, and non-negative token budget. The bridge SHALL return authority-separated assembled context with deterministic accepted and omitted provenance and SHALL NOT receive or mutate native prompt, message, or provider objects.

#### Scenario: Host resolves every model request
- **ID**: `host.runtime.api.host-resolves-every-model-request`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::returns authority-separated context through the shared bridge`
- **WHEN** a host advertising per-request context performs multiple model requests in one turn
- **THEN** each request has its own request ID and receives the current authority-preserving assembly under the supplied turn identity and budget

### Requirement: Tool set changes atomically
A valid owned-set replacement SHALL commit one complete immutable catalog revision. Notification failure SHALL not roll back or reject the committed mutation, and calls owned by definitions removed or revised by that replacement SHALL follow owner-scoped cancellation semantics.

#### Scenario: Tool set changes atomically
- **ID**: `host.runtime.api.tool-set-changes-atomically`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::contains catalog observer failure after an atomic commit`
- **WHEN** a plugin commits a valid owned-set replacement and an observer fails
- **THEN** the new set remains current, the mutation succeeds, independent observers may continue, and removed active implementations cannot report successful current completion
