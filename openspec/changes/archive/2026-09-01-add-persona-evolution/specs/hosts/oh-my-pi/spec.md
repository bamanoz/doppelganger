## ADDED Requirements

### Requirement: OMP enforces required portable-tool approval natively
For every projected runtime tool whose descriptor declares required approval, the OMP adapter SHALL register a native tool approval decision that forces `prompt` for the exact call even in permissive or `yolo` mode. The prompt SHALL identify the portable tool, include its declared reason, and render bounded exact invocation arguments. The adapter SHALL remain generic and SHALL NOT import or special-case Persona Authoring.

#### Scenario: Required tool is called in yolo mode
- **ID**: `omp.approval.yolo-prompts`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** OMP runs in `yolo` mode and the model calls a projected runtime tool with required approval
- **THEN** OMP still presents one native approval prompt and does not send `tools.invoke` before an explicit grant

#### Scenario: User approves the call
- **ID**: `omp.approval.one-shot-grant`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the user grants the native prompt for one exact projected invocation
- **THEN** the adapter invokes the current runtime descriptor once and returns its ordinary portable result

#### Scenario: User rejects or closes the prompt
- **ID**: `omp.approval.denied-fails-closed`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** the approval is rejected, cancelled, or unavailable
- **THEN** OMP returns its native denied outcome, does not invoke the child runtime handler, and keeps the runtime session usable

#### Scenario: Approval prompt renders arguments
- **ID**: `omp.approval.arguments-bounded`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a required projected tool receives structured arguments
- **THEN** the native prompt shows a bounded deterministic representation of those exact arguments together with the portable approval reason

### Requirement: OMP approval projection follows exact tool replacement
Required approval metadata SHALL participate in the same candidate validation and exact dynamic replacement as name, description, schema, and availability. A committed reload SHALL replace the native approval declaration; an invalid reload SHALL retain the prior declaration; and a stale proxy SHALL resolve the current committed descriptor before invocation.

#### Scenario: Reload makes an existing tool approval-required
- **ID**: `omp.approval.reload-required`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::enforces required approval once per exact call in yolo and follows current reload metadata`
- **WHEN** a valid runtime reload changes an existing portable descriptor from host-default approval to required approval
- **THEN** the next call prompts before transport invocation without restarting the OMP session

#### Scenario: Invalid reload changes approval metadata
- **ID**: `omp.approval.invalid-reload-retains`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a candidate reload contains malformed approval metadata or otherwise fails activation/projection
- **THEN** the previous projected tool and approval behavior remain active while diagnostics report the candidate failure

#### Scenario: Retained stale proxy is called after removal
- **ID**: `omp.approval.stale-proxy-removed`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** a caller retains a proxy closure after the runtime removed the portable tool
- **THEN** the closure returns runtime-unavailable without prompting or invoking the removed handler
