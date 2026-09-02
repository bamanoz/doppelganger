## MODIFIED Requirements

### Requirement: Tool definitions use transport-neutral JSON Schema
A tool definition SHALL include a stable qualified name, description, supported JSON Schema input contract, availability, transport-neutral invocation result, and optional validated approval requirement. An approval requirement SHALL be JSON-compatible metadata containing `policy: "required"` and a bounded non-empty reason. Discovery SHALL preserve the same immutable approval metadata in the tool descriptor, and registration changes SHALL be observable by active host adapters.

#### Scenario: Tool is added during reload
- **ID**: `extension-protocols.tools.added-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition update registers a tool
- **THEN** the host adapter receives the new descriptor, including exact approval metadata when declared, and can project it without restarting the session

#### Scenario: Tool is removed during reload
- **ID**: `extension-protocols.tools.removed-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** the owning extension unloads
- **THEN** the tool becomes unavailable and active hosts are notified

#### Scenario: Tool declares malformed approval metadata
- **ID**: `extension-protocols.tools.malformed-approval-rejected`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects malformed approval metadata before registration`
- **WHEN** a definition supplies an unknown policy, blank or oversized reason, unsupported value, or non-JSON-compatible approval field
- **THEN** registration fails before the descriptor becomes discoverable

## ADDED Requirements

### Requirement: Required portable approval is one-shot and fail-closed
A host adapter SHALL enforce `approval.policy: "required"` before invoking the portable handler. The decision SHALL be correlated to the exact projected tool and invocation arguments, SHALL require an explicit one-shot user grant, and SHALL NOT be satisfied by a permissive host mode, automatic allow tier, model text, prior grant, or default policy. Rejection, cancellation, or an unavailable approval channel SHALL prevent handler invocation.

#### Scenario: Host grants one invocation
- **ID**: `extension-protocols.approval.one-shot-grant`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a required-approval portable tool is called and the native host obtains an explicit grant for that exact call
- **THEN** the adapter invokes the current portable handler once and the grant does not authorize a later call

#### Scenario: Host runs in a permissive mode
- **ID**: `extension-protocols.approval.permissive-mode-still-prompts`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the native host would normally auto-approve write or execution tools
- **THEN** the portable tool's required policy still requests an explicit one-shot decision

#### Scenario: Host cannot enforce required approval
- **ID**: `extension-protocols.approval.unavailable-fails-closed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** an adapter or active host surface has no supported approval channel for the call
- **THEN** it fails the call closed or keeps the tool unavailable and never invokes the portable handler

#### Scenario: Approval policy changes during reload
- **ID**: `extension-protocols.approval.reload-current-descriptor`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a committed runtime reload adds, removes, or changes a tool's approval requirement
- **THEN** the next host invocation uses exactly the newly committed descriptor and a stale closure cannot bypass the current requirement

### Requirement: Portable approval remains domain-neutral
The tool protocol SHALL express only generic invocation approval policy and reason. It SHALL NOT contain Persona, memory, filesystem, OMP, DSH, UI widget, actor, or command concepts. Hosts own presentation and decision transport; feature plugins own why their specific operation is sensitive.

#### Scenario: A non-Persona plugin requires approval
- **ID**: `extension-protocols.approval.domain-neutral-plugin`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **WHEN** any feature plugin registers a sensitive portable tool with required approval
- **THEN** compatible hosts enforce it through the same generic projection path without importing the feature package
