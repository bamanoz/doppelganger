## ADDED Requirements

### Requirement: Host capability service
The protocol package SHALL expose a frozen Runtime Session-scoped `doppelgangerHostCapabilities` service whose versioned closed value contains exactly context delivery, tool delivery, required-approval support, cancellation support, and faithfully available standard lifecycle event kinds. Every field SHALL be required; unknown keys, host-native names, and arbitrary string capability bags SHALL be rejected at construction and transport boundaries.

#### Scenario: Portable plugin inspects delivery guarantees
- **ID**: `extension.protocols.portable-plugin-inspects-delivery-guarantees`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** a plugin needs context at a known session, turn, or request cadence or exact dynamic tool replacement
- **THEN** it determines that semantic guarantee from the capability service without branching on the host package or process topology

#### Scenario: Empty optional protocol stack
- **ID**: `extension.protocols.empty-optional-protocol-stack`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** the capability profile permits context or tools but the selected Runtime Preset does not install those protocol services
- **THEN** the shared bridge remains valid and exposes their canonical empty behavior

#### Scenario: Capability object contains an extension bag
- **ID**: `extension.protocols.capability-object-contains-an-extension-bag`
- **EVIDENCE**: `packages/extension-protocols/tests/host-capabilities.spec.ts::validates, deeply freezes, and provides the closed session capability value`
- **WHEN** an adapter supplies an otherwise valid profile with `features`, `extensions`, or another undeclared field
- **THEN** protocol validation rejects it before the service is provided

### Requirement: Runtime Host and actor providers are independent
The shared Runtime Host plugin SHALL NOT construct, provide, require, or infer `doppelgangerActor`. Actor Identity remains independently mountable with three observable states: absent service means unsupported or not installed, `unbound` means installed without a resolved user, and `bound` means one immutable resolved user. Context, tools, lifecycle, and host capabilities SHALL remain usable without actor identity.

#### Scenario: Generic preset uses the shared bridge
- **ID**: `extension.protocols.generic-preset-uses-the-shared-bridge`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** an actor-independent Runtime Preset activates through a supported host
- **THEN** the Runtime Host plugin provides no bound or synthetic actor and all actor-independent shared protocols remain usable

#### Scenario: Adapter also mounts actor identity
- **ID**: `extension.protocols.adapter-also-mounts-actor-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** actor-aware plugins are selected and the host supplies a stable principal identifier
- **THEN** a separate actor plugin provides `doppelgangerActor` in its declared isolation realm without adding `actorId` to Runtime Host contracts

#### Scenario: Adapter mounts an unbound actor provider
- **ID**: `extension.protocols.adapter-mounts-an-unbound-actor-provider`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::rejects a second attachment and keeps actor absence, unbound, and bound states independent`
- **WHEN** a host implements Actor Identity but has no resolved principal
- **THEN** the separate provider exposes `unbound`, distinguishable from an absent service, without changing Runtime Host contracts

### Requirement: Runtime-to-host change callback is narrow
The public Runtime Host binding SHALL expose attachment, detachment, and the explicit `toolCatalogChanged(revision)` callback only. It SHALL NOT expose `notify(type, payload)`, an open notification union, an arbitrary event name, or a mutable tool registry. A second unrelated outbound signal requires its own versioned semantic design.

#### Scenario: Tool registry commits a new catalog
- **ID**: `extension.protocols.tool-registry-commits-a-new-catalog`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the registry completes one valid atomic mutation
- **THEN** the shared plugin calls `toolCatalogChanged` once with the committed revision

#### Scenario: Provider wants an unrelated outbound signal
- **ID**: `extension.protocols.provider-wants-an-unrelated-outbound-signal`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** a shared or host-specific provider needs to report another condition to the adapter
- **THEN** it cannot send that condition through a generic Runtime Host notification channel

### Requirement: Atomic owned tool sets
The tool registry SHALL support registering one owner-scoped set and atomically replacing its complete definitions. Replacement SHALL validate every candidate and all cross-owner collisions before mutation, SHALL preserve the previous committed set on failure, SHALL emit one post-commit change event, and SHALL dispose through one idempotent Cordis effect.

#### Scenario: MCP list refresh succeeds
- **ID**: `extension.protocols.mcp-list-refresh-succeeds`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** an MCP importer replaces ten old definitions with twelve valid new definitions
- **THEN** observers see either the complete old set or the complete new set, one catalog revision is committed, and one change event is emitted

#### Scenario: Replacement contains one invalid definition
- **ID**: `extension.protocols.replacement-contains-one-invalid-definition`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** a replacement candidate contains a duplicate, invalid schema, invalid portable name, or cross-owner collision
- **THEN** the entire replacement fails and the previous owner set remains active unchanged

### Requirement: Revisioned tool snapshots
The tool registry SHALL return immutable deterministic catalog snapshots with an opaque catalog revision and descriptors ordered by canonical tool name. Each descriptor SHALL include an opaque revision derived from the current callable definition and SHALL retain that revision only while its externally relevant definition is unchanged.

#### Scenario: Unrelated owner updates its set
- **ID**: `extension.protocols.unrelated-owner-updates-its-set`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::replaces complete owner sets atomically and preserves the old set on validation failure`
- **WHEN** one owner changes tools without changing another owner's definition
- **THEN** the catalog revision changes while the unchanged descriptor may retain its existing tool revision

#### Scenario: Same-name tool is replaced
- **ID**: `extension.protocols.same-name-tool-is-replaced`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** an owner changes the handler, schema, approval metadata, or availability of a tool while retaining its name
- **THEN** that descriptor receives a new tool revision

### Requirement: Correlated cancellable tool handler contract
A portable tool definition SHALL receive JSON-compatible input and a frozen invocation context containing Runtime Session ID, stable call ID, optional turn ID, and an `AbortSignal`. The registry SHALL prevent concurrent reuse of an active call ID and SHALL remove call state after every successful, failed, or cancelled settlement.

#### Scenario: Handler observes cancellation
- **ID**: `extension.protocols.handler-observes-cancellation`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** the shared bridge aborts the active call controller
- **THEN** the handler observes the same signal supplied at invocation and can terminate owned work without importing a native host type

#### Scenario: Duplicate active call identity
- **ID**: `extension.protocols.duplicate-active-call-identity`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** a second invocation uses a call ID that is already active in the Runtime Session
- **THEN** the registry rejects it before invoking a second handler

## MODIFIED Requirements

### Requirement: Host-facing tool schema
The tool protocol SHALL expose a transport-neutral `ToolDescriptor` containing the canonical tool name, display label, description, JSON Schema input, opaque tool revision, and explicit availability state. The schema SHALL remain free of OMP, Pi SDK, DSH, MCP client, or other host execution objects. The shared Runtime Host API SHALL expose descriptors only through immutable revisioned catalog snapshots.

#### Scenario: OMP requests runtime tools
- **ID**: `extension.protocols.omp-requests-runtime-tools`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the OMP adapter snapshots tools from an active Runtime Session
- **THEN** it receives transport-neutral descriptors that it can translate into native OMP tools while retaining each descriptor's exact revision for invocation

#### Scenario: DSH requests runtime tools
- **ID**: `extension.protocols.dsh-requests-runtime-tools`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the DSH adapter snapshots tools from an active Runtime Session
- **THEN** it receives the same descriptor contract without importing OMP or MCP transport types

### Requirement: Invocation results remain separate from definitions
Tool handlers SHALL receive the portable invocation context and return structured protocol results at the invocation boundary; runtime result values SHALL NOT be embedded into the tool-definition schema. The bridge SHALL distinguish successful values, tool-domain failures, invalid input, unavailable tools, stale descriptor revisions, missing or invalid approval, and observed cancellation using structured JSON-compatible result or error codes. Transport adapters SHALL map those outcomes explicitly rather than collapsing them into successful text or untyped exceptions.

#### Scenario: Handler returns a structured value
- **ID**: `extension.protocols.handler-returns-a-structured-value`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** a registered handler returns a JSON-compatible value
- **THEN** the invocation result returns that value separately from the tool definition and the descriptor remains immutable

#### Scenario: Host invokes a stale descriptor
- **ID**: `extension.protocols.host-invokes-a-stale-descriptor`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects stale revisions, correlates active calls, and forwards cancellation context`
- **WHEN** the supplied tool revision no longer matches the current descriptor
- **THEN** the invocation returns `TOOL_REVISION_STALE` before any handler runs

#### Scenario: Handler observes abort
- **ID**: `extension.protocols.handler-observes-abort`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** an active handler terminates because its supplied signal was aborted
- **THEN** the invocation returns a structured cancelled outcome rather than a successful empty value

### Requirement: Required tool approval metadata
The tool contract SHALL support `approval.policy: "required"` with an optional bounded non-empty advisory reason as portable metadata, and the shared Runtime Host bridge SHALL revalidate one protected approval grant against the exact call ID, tool revision, and canonical input digest before dispatch. The reason SHALL NOT be required for enforcement or treated as authorization. This metadata is a lower-bound safety requirement: an adapter MAY impose stricter native policy on any tool, but an imported protocol annotation or host policy SHALL NOT weaken or fabricate the portable requirement.

#### Scenario: Required approval is unsupported
- **ID**: `extension.protocols.required-approval-is-unsupported`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::revalidates exact one-shot approval grants and rejects replay or unexpected authority`
- **WHEN** a tool requiring portable approval is projected by a host whose capability profile declares no required-approval support
- **THEN** the host adapter omits or blocks the tool diagnostically rather than invoking it without approval

#### Scenario: Matching one-shot grant is supplied
- **ID**: `extension.protocols.matching-one-shot-grant-is-supplied`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::resolves installed context, snapshots tools, and emits one revision callback per commit`
- **WHEN** the native host obtains explicit user approval for the exact projected call and supplies a matching unused protected grant
- **THEN** the bridge consumes the grant and invokes the handler once

#### Scenario: Input changes after approval
- **ID**: `extension.protocols.input-changes-after-approval`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::revalidates exact one-shot approval grants and rejects replay or unexpected authority`
- **WHEN** an adapter changes the invocation input after obtaining approval
- **THEN** the canonical input digest no longer matches and the bridge rejects the call before handler invocation

### Requirement: Registry effects are scoped and reversible
Each single-tool registration or owned-set registration SHALL install through the owning Cordis context and SHALL be removed when that context is disposed. Dynamic tool updates SHALL preserve deterministic replacement behavior, update catalog and descriptor revisions as required, and SHALL NOT leave stale handlers callable through retained host closures.

#### Scenario: Tool plugin is reloaded
- **ID**: `extension.protocols.tool-plugin-is-reloaded`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** Loader replaces or disables a plugin that owns one or more tool sets
- **THEN** the prior effects are disposed, one complete successor catalog is committed, stale descriptor revisions fail closed, and unrelated registrations remain active

#### Scenario: Tool set registration is explicitly disposed
- **ID**: `extension.protocols.tool-set-registration-is-explicitly-disposed`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::commits deterministic immutable snapshots and retains unchanged tool revisions`
- **WHEN** the owning plugin disposes a set registration
- **THEN** all tools in that set are removed in one committed mutation and repeated disposal is a no-op
