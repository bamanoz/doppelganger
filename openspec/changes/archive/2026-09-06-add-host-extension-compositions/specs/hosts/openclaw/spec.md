## MODIFIED Requirements

### Requirement: Immutable actor and workspace custody
Each native OpenClaw binding SHALL distinguish agent identity, rotatable native session identity, workspace, and trusted principal configuration from routing aliases. The core adapter SHALL snapshot and provide only closed immutable OpenClaw session facts to its trusted Host Extension Composition. An independent OpenClaw Actor Host Extension SHALL own exact route-to-actor resolution and provide bound or unbound Actor Identity; the core adapter SHALL NOT install `doppelgangerActor` directly or know feature consumer semantics. Neither layer SHALL infer a user from Persona, prompt text, project files, optional sender metadata, or the first observed participant. A principal, workspace, session-generation, or Host Extension configuration change SHALL retire the old binding before replacement, and Actor Identity SHALL remain outside the shared Runtime Host API.

#### Scenario: Two users share a gateway
- **ID**: `openclaw.identity.isolation`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **WHEN** two native sessions use different trusted principal and workspace mappings under one gateway
- **THEN** their separate Actor Host Extensions provide only their own immutable binding and actor-aware effects remain isolated

#### Scenario: Sender custody is unresolved
- **ID**: `openclaw.identity.unbound`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::keeps sessions without an exact trusted tuple unbound`
- **WHEN** native ingress has no trusted exact single-principal mapping or contains mixed sender custody
- **THEN** the Actor Host Extension provides explicit unbound state and actor-dependent operations fail rather than guessing a principal

#### Scenario: Session route changes underlying identity
- **ID**: `openclaw.identity.rotated-session`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::retires prior closures when a route rotates workspace or session identity`
- **WHEN** a reused route alias changes native session generation, trusted principal, workspace, or Host Extension configuration
- **THEN** the adapter fences and disposes the prior Runtime Session plus Host Extension Composition before exposing the replacement and old closures remain unusable

### Requirement: OpenClaw prepares availability and configures selection separately
OpenClaw deployment preparation SHALL import the operator's exact Host Extension module specifiers, validate their protocol version, OpenClaw host kind, stable IDs, package closure, and non-secret definition metadata, and generate static artifact imports plus an immutable available-definition catalog independently from the prepared Runtime Preset tool catalog. Runtime OpenClaw configuration SHALL select and configure only IDs present in that prepared catalog. Unknown or newly installed definitions SHALL require artifact regeneration and Gateway/plugin restart. For each native binding the core adapter SHALL snapshot closed OpenClaw session facts, instantiate fresh entries from the frozen runtime selection plan, add narrow capability providers and the actor-neutral bridge, and pass the complete Host Extension Composition to Composition Runtime. Actor mappings, credentials, mutable session values, and process-local revisions SHALL NOT be written to either prepared catalog. Runtime Preset patches and reload SHALL NOT alter Host Extension availability or selection.

#### Scenario: Prepared artifact makes an Actor Host Extension available
- **ID**: `openclaw.host-extensions.prepared-actor`
- **EVIDENCE**: `packages/host-openclaw/tests/preparation.spec.ts::bundles prepared Host Extension modules with separate validated metadata`
- **WHEN** an operator prepares an OpenClaw deployment with the Actor Host Extension module in the allowed module set
- **THEN** the artifact contains its static module import and validated definition metadata separately from portable tool descriptors, while runtime configuration owns selection and actor mappings remain outside artifact catalogs

#### Scenario: Runtime selects an extension absent from the artifact
- **ID**: `openclaw.host-extensions.unprepared-selection`
- **EVIDENCE**: `packages/host-openclaw/tests/activation.spec.ts::rejects runtime Host Extension IDs absent from the prepared artifact`
- **WHEN** runtime OpenClaw configuration selects a Host Extension ID not packaged during preparation
- **THEN** Doppelganger remains inactive for the binding with an explicit regeneration/restart diagnostic and imports no runtime-supplied module

#### Scenario: Runtime Preset adds a host extension row
- **ID**: `openclaw.host-extensions.preset-cannot-install`
- **EVIDENCE**: `packages/composition-runtime/tests/host-extension-composition.spec.ts::keeps Host Extensions outside authored preset and patch control`
- **WHEN** an authored Runtime Preset attempts to install or target an OpenClaw Host Extension
- **THEN** protected-layer validation rejects the attempt and the trusted composition remains unchanged

#### Scenario: OpenClaw extension needs native data
- **ID**: `openclaw.host-extensions.closed-session-facts`
- **EVIDENCE**: `packages/host-extension-runtime/tests/host-extension-runtime.spec.ts::provides factories only frozen closed session facts without host transport authority`
- **EVIDENCE**: `packages/host-openclaw/tests/identity.spec.ts::isolates trusted actor and workspace bindings across gateway sessions in one adapter`
- **WHEN** a supported OpenClaw-specific extension activates
- **THEN** it consumes only the documented immutable session fact service and receives no gateway, node, subagent, sandbox, worktree, credential, provider, UI, or registry authority
