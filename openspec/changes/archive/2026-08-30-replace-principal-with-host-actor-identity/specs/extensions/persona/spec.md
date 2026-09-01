## MODIFIED Requirements

### Requirement: Persona concepts are extension-owned
The Persona extension SHALL own immutable Persona Activation metadata, stable Persona Instance identity, authored identity, ordered traits, and Persona-specific state configuration. Persona configuration and activation metadata SHALL NOT own or expose actor identity. Generic Runtime Preset selection and Runtime Session metadata SHALL NOT interpret Persona or actor fields.

#### Scenario: Activate Persona composition
- **ID**: `persona.activation.loader-rows`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::provides an immutable session-scoped metadata service`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **WHEN** a selected Runtime Preset includes configured Persona Loader rows
- **THEN** the Persona extension derives its activation metadata and behavior from Persona-owned rows plus generic host session/workspace metadata without reading actor identity from Persona configuration

#### Scenario: Activate non-persona composition
- **ID**: `persona.activation.absent`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::activates an empty composition with only runtime-owned plugins`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::activates an empty Runtime Preset without standard protocols`
- **WHEN** a Runtime Preset does not include the Persona extension
- **THEN** the composition activates without Persona configuration, metadata, or services

#### Scenario: Reuse Persona for multiple actors
- **ID**: `persona.actor-reuse`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::reuses unchanged Persona metadata across separate actor bindings`
- **WHEN** a host activates the same Persona Instance for two different actor bindings
- **THEN** both sessions receive the same Persona-owned identity and traits while actor-aware extensions remain partitioned by the separate host services

### Requirement: Persona metadata isolation
Persona metadata SHALL be immutable and isolated per composition session, including instance identity, instance home, definition root, and optional project identity and root. Actor identity SHALL remain a separate host-owned service and SHALL NOT be copied into Persona Activation metadata.

#### Scenario: Concurrent persona sessions
- **ID**: `persona.sessions.isolation`
- **EVIDENCE**: `packages/extension-persona/tests/activation.spec.ts::provides an immutable session-scoped metadata service`
- **WHEN** two sessions use different Persona instances, projects, or host actor bindings
- **THEN** each Persona plugin observes only its own Persona session metadata and no actor identifier through the Persona service

### Requirement: Existing persona behavior survives extraction
Persona ownership outside the kernel SHALL preserve identity and ordered-trait context, instance-owned persistent memory when composed with a host actor binding, workspace-derived scope isolation, and live asset updates.

#### Scenario: Existing Mark Runtime Preset remains operational
- **ID**: `persona.mark.integration`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::activates the checked-in Mark Runtime Preset through Loader interpolation`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::activates the host-neutral definition and projects identity plus selected traits`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** the development Mark Runtime Preset activates through the generic OMP adapter with a configured host actor binding
- **THEN** its Persona Loader rows contribute Mark identity and ordered traits without actor configuration while composed storage, lexical memory, and semantic memory retain their configured behavior
