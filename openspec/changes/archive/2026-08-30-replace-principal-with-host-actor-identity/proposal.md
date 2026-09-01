## Why

`principalId` is currently authored inside a Persona Runtime Preset, which couples the agent's identity to the human using it and lets portable Persona configuration choose a persistent-memory partition. The runtime needs a separate host-authoritative actor identity before additional hosts or user-profile onboarding can be added safely.

## What Changes

- **BREAKING** Rename the user-side identity contract from `principalId`/`principal_id` to `actorId`/`actor_id` across Persona-memory APIs, canonical storage, semantic projection contracts, vector backends, fixtures, and documentation; retain `principalInput` and evidence role `principal` where they describe conversation authorship rather than identity.
- Add an immutable, session-isolated actor identity service supplied only by the protected runtime-side host bridge.
- **BREAKING** Remove user identity from Persona configuration and Persona Activation metadata; Persona continues to own only agent-instance, session, project, identity-asset, and trait metadata.
- Require persistent-memory composition to resolve actor identity from the host service. Missing actor identity fails memory activation visibly instead of selecting an implicit, authored, or model-chosen partition.
- Extend OMP host configuration and the parent/child activation boundary with a validated stable `actorId`; the checked-in local OMP bootstrap supplies the existing local actor identity outside the Mark Runtime Preset.
- Preserve canonical memory during the schema rename and force/rebuild incompatible derived semantic projections so existing records remain available under the same identifier value.
- Remove obsolete principal-identity configuration, public fields, aliases, schema names, examples, and test fixtures in one clean cutover; memory tools do not accept an actor identifier or provide actor switching.

## Capabilities

### New Capabilities

- `actor-identity`: Host-authoritative, immutable actor identity binding for a Runtime Session, including trust, validation, isolation, and absence behavior.

### Modified Capabilities

- `extensions/persona`: Remove principal ownership from Persona configuration and activation metadata while preserving Persona instance, project, identity, traits, and host neutrality.
- `persona-memory`: Rename persistent partitions to actor partitions, require the host actor service, migrate canonical state, and preserve strict partition isolation across lexical and semantic paths.
- `hosts/oh-my-pi`: Accept and transport the configured actor identity through the protected OMP bridge without exposing model-controlled selection or embedding it in Runtime Presets.

## Impact

- Affected packages: `extension-protocols`, `extension-persona`, `extension-memory`, `extension-memory-vectors`, and `host-omp`.
- Affected configuration: Persona Loader rows lose `principalId`; OMP extension construction gains required local actor configuration for memory-bearing presets.
- Affected persistence: canonical memory schema and local vector schemas advance versions; remote/local derived projections rebuild under actor-named metadata.
- Affected public contracts: Persona Activation, memory records/requests/vector types, OMP adapter options and wire activation payloads, package exports, examples, and fixtures.
- Affected documentation: architecture protocols, Persona, memory, OMP host, configuration, project status/scope, README usage, and live OpenSpec requirements.
