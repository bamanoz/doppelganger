## MODIFIED Requirements

### Requirement: Adapter transport exposes the host-neutral runtime surface
The OMP transport SHALL support composition activation with an optional host actor binding, disposal, context resolution, tool listing and invocation, lifecycle publication, and runtime notifications over framed request/response messages. Both endpoints SHALL validate the same actor-aware activation contract and reject malformed, version-mismatched, or out-of-state requests without corrupting the session.
Both endpoints and host pre-transport projection SHALL reuse protocol-owned strict JSON admission for descriptor schemas, invocation inputs and portable results before cloning, approval digesting, or JSON serialization. They SHALL reject non-finite values, undefined members, executable coercion, accessors and other unsupported JSON shapes without transforming them. Valid JSON values SHALL retain their exact meaning, and invalid input SHALL not dispatch a handler or consume approval. Existing bounded host lifecycle observation projection remains a separate operation.

#### Scenario: Context is requested before activation
- **ID**: `transport.context.inactive.error`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::keeps absent activation inactive and reports malformed or incompatible descriptors`
- **WHEN** the extension requests context before a runtime session is active
- **THEN** the request fails with a transport-visible state error and OMP proceeds without Doppelganger context

#### Scenario: Runtime composition changes
- **ID**: `runtime.reload.projection`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition reload changes context or tools
- **THEN** the child notifies the OMP extension and the next model request observes the current context and tool set without changing the actor binding

#### Scenario: Host receives an invalid native invocation value
- **ID**: `host.omp.strict-json.before-transport`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::rejects invalid invocation values before transport or approval`
- **WHEN** an OMP proxy receives a non-JSON-compatible input that JSON serialization would otherwise coerce or omit
- **THEN** it rejects the original value without executing coercion hooks, acquiring a grant, sending the invocation, or calling the portable handler

#### Scenario: Host admits a valid portable value
- **ID**: `host.omp.strict-json.valid-value-parity`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::preserves exact valid JSON values through direct and transported invocation`
- **WHEN** the same valid JSON input is invoked directly and through the OMP adapter
- **THEN** both paths preserve the same value and approval digest semantics without materializing omitted schema defaults

#### Scenario: Host receives an invalid portable descriptor or result
- **ID**: `host.omp.strict-json.invalid-descriptor-result`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::rejects non-JSON descriptors and results without coercion`
- **WHEN** an OMP boundary receives a descriptor schema or portable result containing unsupported runtime values
- **THEN** the boundary rejects it with its structured diagnostic rather than projecting a coerced schema or a successful altered value
