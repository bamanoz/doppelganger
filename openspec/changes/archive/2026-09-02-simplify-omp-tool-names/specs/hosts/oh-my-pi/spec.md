## ADDED Requirements

### Requirement: OMP proxy names preserve readable portable identity
For every available portable tool whose qualified name satisfies the host-neutral tool-name grammar, the OMP adapter SHALL derive the proxy name as the exact ASCII prefix `doppelganger_` followed by the portable name with each `.` replaced by `_` and every segment character otherwise unchanged. Because `_` is not valid inside portable tool names, this projection SHALL be injective for valid descriptors. The adapter SHALL NOT register compatibility aliases using the removed `_x2e_` encoding.

#### Scenario: Two-segment portable tool is projected
- **ID**: `omp.tool-name.readable-two-segment`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::projects dotted portable names as readable OMP proxy names`
- **WHEN** the runtime exposes `persona.revise`
- **THEN** OMP exposes `doppelganger_persona_revise` and does not expose `doppelganger_persona_x2e_revise`

#### Scenario: Multi-segment tool preserves segment characters
- **ID**: `omp.tool-name.readable-multi-segment`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::preserves hyphens and maps every portable separator without collisions`
- **WHEN** the runtime exposes `runtime-plugin.inspect-list` and `memory.candidates.list`
- **THEN** OMP exposes `doppelganger_runtime-plugin_inspect-list` and `doppelganger_memory_candidates_list`

#### Scenario: Runtime tools change after activation
- **ID**: `omp.tool-name.clean-cutover-reload`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::replaces readable proxies exactly after committed tool changes`
- **WHEN** a committed runtime update removes one portable tool and adds another
- **THEN** the old readable proxy is inactive, the new readable proxy is active, and no `_x2e_` alias is active

### Requirement: OMP proxy invocation uses canonical descriptor identity
The adapter SHALL retain the exact dotted portable name with each committed projected descriptor and SHALL invoke `tools.invoke` with that canonical name. Dispatch, approval lookup, replacement, and stale-proxy checks SHALL use the committed proxy-to-descriptor association and SHALL NOT decode or otherwise reconstruct the portable name from the OMP proxy string.

#### Scenario: Readable proxy invokes dotted portable tool
- **ID**: `omp.tool-name.canonical-dispatch`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::dispatches readable proxies through exact canonical portable names`
- **WHEN** OMP calls `doppelganger_memory_search`
- **THEN** the child receives one `tools.invoke` request whose name is exactly `memory.search`

#### Scenario: Descriptor is replaced under the same portable name
- **ID**: `omp.tool-name.current-descriptor-replacement`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::keeps existing readable proxy closures bound to the current committed descriptor`
- **WHEN** reload replaces the descriptor for `persona.revise` while retaining its portable name
- **THEN** approval and invocation through `doppelganger_persona_revise` use the replacement descriptor rather than stale captured metadata

#### Scenario: Removed proxy closure is invoked
- **ID**: `omp.tool-name.stale-closure-rejected`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::rejects stale readable proxy closures after tool removal`
- **WHEN** a caller retains an old `doppelganger_memory_search` closure after `memory.search` is removed
- **THEN** the closure returns `RUNTIME_UNAVAILABLE` and does not invoke another portable tool

### Requirement: OMP rejects provider-unsafe proxy names before registration
A projected OMP proxy name SHALL contain no more than 64 ASCII characters, including the `doppelganger_` prefix. If a portable descriptor would exceed that limit or collide with another projected name, the adapter SHALL keep that proxy unavailable and report a diagnostic identifying the portable name and violated constraint rather than registering a truncated, hashed, or ambiguous name. Unrelated valid portable tools SHALL remain projectable.

#### Scenario: Portable name exceeds the OMP projection budget
- **ID**: `omp.tool-name.excessive-length-rejected`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::rejects overlong projected names before OMP registration`
- **WHEN** prefixing and separator replacement would produce a 65-character OMP proxy name
- **THEN** that proxy is not registered and the diagnostic identifies the portable name and 64-character limit

#### Scenario: Portable name exactly fits the OMP projection budget
- **ID**: `omp.tool-name.maximum-length-accepted`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::accepts projected names at the 64-character boundary`
- **WHEN** prefixing and separator replacement produces a 64-character OMP proxy name
- **THEN** the adapter registers and invokes that proxy without truncation or hashing

#### Scenario: Two descriptors map to one proxy name
- **ID**: `omp.tool-name.collision-rejected`
- **EVIDENCE**: `planned:packages/host-omp/tests/extension.spec.ts::rejects ambiguous proxy collisions defensively`
- **WHEN** malformed runtime input bypasses the portable-name grammar and two descriptors would map to the same OMP proxy
- **THEN** the ambiguous proxy is unavailable and the diagnostic identifies both portable names
