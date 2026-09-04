## MODIFIED Requirements

### Requirement: Equivalent activation inputs share one canonicalizer
Composition Definition construction and host adapter activation decoding SHALL use the Composition Runtime's one canonicalization contract for non-empty identifiers, absolute paths, immutable patch data, optional-field omission, and deterministic diagnostics. Concrete adapter fields such as host kind, transport options, and native capability profile SHALL be owned and validated by the host package rather than added to the domain-neutral Composition Runtime activation schema. Optional actor-provider configuration SHALL likewise remain outside the shared Runtime Host contract and be mounted only as a separate plugin.

#### Scenario: Direct and OMP activation describe the same composition
- **ID**: `composition.runtime.direct-and-omp-activation-describe-the-same-composition`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** equivalent composition values enter through the direct Composition Definition API and the OMP adapter's serialized activation decoder
- **THEN** both produce equivalent canonical composition, path, patch, and diagnostic values while OMP-only transport fields remain in `host-omp`

#### Scenario: DSH activates in process
- **ID**: `composition.runtime.dsh-activates-in-process`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** the DSH adapter activates a Runtime Preset without a child transport
- **THEN** it uses the same canonical Composition Definition and direct activation contract without satisfying an OMP-specific `hostKind` discriminator

#### Scenario: An optional value is absent
- **ID**: `composition.runtime.an-optional-value-is-absent`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** an optional activation field is not provided
- **THEN** canonical output omits the field rather than assigning `undefined`

### Requirement: Kernel-only public interface
The kernel package SHALL expose composition, canonicalization, protected runtime-plugin insertion, session metadata, diagnostics, reload, and disposal contracts while excluding host-specific activation request schemas and all persona, actor, memory, context assembly, tool, lifecycle, MCP, and persistence contracts.

#### Scenario: Consume kernel independently
- **ID**: `composition.runtime.consume-kernel-independently`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** a downstream package imports the kernel public entry point
- **THEN** it can activate a generic Cordis composition and reuse canonicalization without importing any domain extension or OMP-specific discriminator

#### Scenario: OMP decodes transported activation
- **ID**: `composition.runtime.omp-decodes-transported-activation`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** the OMP child validates an activation request containing OMP transport options and optional actor-provider configuration
- **THEN** the decoder is exported by `host-omp`, supplies only generic canonical composition and session fields to Composition Runtime, and mounts actor identity independently from the shared bridge

### Requirement: Protected host integration and layered audit
Runtime-owned plugins SHALL be inserted after caller-controlled layers as one deterministic protected set. The set MAY include the shared Runtime Host bridge, a separate actor provider in adapter-selected absent, unbound, or bound state, and explicitly typed host-specific providers; none SHALL be folded into another provider's public contract. Every required and optional isolated service declared for those plugins SHALL resolve only inside the owning Runtime Session. The fully layered composition SHALL be audited before a Runtime Session is returned.

#### Scenario: Mount shared host bridge last
- **ID**: `composition.runtime.mount-shared-host-bridge-last`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** a valid effective composition is activated by any supported host
- **THEN** the runtime inserts that host's shared bridge after caller-controlled layering, isolates its declared portable services to the session, and audits activation before returning the session

#### Scenario: Mount host-specific sibling provider
- **ID**: `composition.runtime.mount-host-specific-sibling-provider`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** an adapter supplies an additional typed native capability plugin beside the shared bridge
- **THEN** both protected plugins activate in deterministic order with their declared isolated service realms and authored layers cannot replace them

#### Scenario: Mount actor provider beside the bridge
- **ID**: `composition.runtime.mount-actor-provider-beside-the-bridge`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** an adapter contract installs Actor Identity in unbound or bound state
- **THEN** Composition Runtime mounts that separate actor plugin in the protected set while the shared bridge remains actor-neutral; an adapter that does not implement Actor Identity omits the provider

#### Scenario: Empty composition receives host integration
- **ID**: `composition.runtime.empty-composition-receives-host-integration`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** the selected preset contains an empty Loader list
- **THEN** the protected runtime-owned set still activates without requiring a preset-authored placeholder or target group

#### Scenario: Layered composition activates successfully
- **ID**: `composition.runtime.layered-composition-activates-successfully`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::normalizes and freezes the domain-neutral layered contract`
- **WHEN** every document is valid, every targeted mutation matches, every required mount lands, and every enabled authored and protected plugin settles active
- **THEN** the runtime returns the audited Runtime Session

#### Scenario: Protected provider has unresolved dependency
- **ID**: `composition.runtime.protected-provider-has-unresolved-dependency`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms`
- **WHEN** a shared bridge or host-specific protected plugin has a failed or unresolved dependency
- **THEN** activation fails, cleans up the attempted tree, and reports the protected entry and missing service without returning a partially attached binding
