## 1. Shared Runtime Host integration

- [ ] 1.1 Consume the public actor-neutral Runtime Host bridge, closed capability, revisioned tool, approval, cancellation, and lifecycle contracts from `extension-protocols` without adding a DSH-local bridge interface or protocol-service implementation
- [ ] 1.2 Implement one direct per-agent `RuntimeHostBinding` with single-owner attach/detach and the sole `toolCatalogChanged(revision)` callback; reject second attachment and ignore late callbacks from replaced state
- [ ] 1.3 Declare and validate one frozen DSH capability profile for per-turn context, dynamic tools, native required approval, cooperative cancellation, and only faithfully supported lifecycle event kinds
- [ ] 1.4 Adapt the shared transport-independent Runtime Host conformance fixtures to DSH and require the complete suite without in-process topology exceptions

## 2. Native DSH package foundation

- [ ] 2.1 Add the `packages/host-dsh` workspace package, strict TypeScript configuration, public exports, exact DSH peer/dev dependencies, and package-boundary manifest entry
- [ ] 2.2 Define and validate host configuration for explicit Runtime Preset selection, watch mode, context token budget, trusted host patches, and Actor Identity disabled/unbound/bound/resolver modes; inject the authoritative `doppelgangerRuntimePresets` service instead of duplicating roots, discovery, trust, or authoring configuration
- [ ] 2.3 Implement one plugin-owned state registry with exact Agent identity, per-agent serialized queues, diagnostics, immutable capability state, and idempotent lifecycle transitions
- [ ] 2.4 Add native composition tests proving one host-provided Cordis root, one direct shared bridge per selected agent, and no OMP child, JSON-RPC transport, DSH-local bridge, second router, or parallel session binding

## 3. Per-agent activation and actor binding

- [ ] 3.1 Start idempotent activation from scoped DSH agent/session notifications and enumerate already-live visible agents during host hot-load
- [ ] 3.2 Resolve explicit, project, user-default, and deployment-default states through the injected Runtime Preset roster, including optional-workspace discovery, canonical patch ordering, shipped `standard`, and explicitly defaultless no-selection operation
- [ ] 3.3 Activate one caller-owned `CompositionRuntime` under each selected `agent.ctx` with DSH session metadata, isolated protocol realms, trusted host patches, the shared Runtime Host plugin, and no copied bridge logic
- [ ] 3.4 Implement the default namespaced DSH anonymous harness-home Actor Identity plus disabled, explicit unbound, explicit bound, and trusted resolver modes through the separate protected actor plugin, snapshotted once per Runtime Session
- [ ] 3.5 Cover fresh-home `standard` activation, higher-precedence selection, explicitly defaultless no-selection, optional workspace, patch order, actor absence/unbound/bound state, bridge independence, and concurrent same-preset agent isolation

## 4. Prompt context projection

- [ ] 4.1 Capture each turn's direct principal text from claimed user-source inbox messages and retain one stable DSH session/turn identity across later model steps
- [ ] 4.2 Await activation in the scoped `system-prompt/assemble` waterfall, mint a unique request ID for each assembly, and resolve portable context with stable turn input and the configured hard token budget
- [ ] 4.3 Project instruction contributions to deterministic DSH prompt sections and data contributions to dynamic contexts while preserving existing material and DSH suppression rules
- [ ] 4.4 Cover authority projection, hard-budget truncation, stable multi-step turn input, complete-prompt governance, runtime-context suppression, and generic Evolution instruction/reminder projection

## 5. Native revisioned tool projection

- [ ] 5.1 Translate available descriptors from one immutable bridge snapshot into exact agent-scoped DSH tool definitions with supported object-schema and approval validation, reserved-name rejection, canonical JSON output, and bounded structured failures
- [ ] 5.2 Retain catalog and descriptor revisions in every native closure; call only `bridge.invokeTool` with stable call ID, optional turn ID, canonical name, exact tool revision, input, and optional protected grant
- [ ] 5.3 Implement one scoped pre-execute gate that asks through DSH ApprovalService for the current descriptor's required approval, mints a grant bound to call ID, tool revision, and canonical input digest only after `allowed-once`, and fails closed on rejection, cancellation, or unavailable answerer
- [ ] 5.4 Forward DSH execution aborts through `bridge.cancelTool` with exact call identity and preserve cooperative cancellation/completion race semantics without directly exposing native signals to portable handlers
- [ ] 5.5 Implement serialized candidate validation and transactional exact registration/approval replacement driven only by `toolCatalogChanged(revision)` plus matching full snapshots; ignore delayed stale callbacks and preserve the previous projection on failure
- [ ] 5.6 Make invocation and approval lookups resolve the current committed bridge/descriptor so removed, unavailable, or changed tools cannot execute through stale handlers, revisions, callbacks, or grants
- [ ] 5.7 Cover native invocation and Session recording, approval grant/rejection/unavailable/replay outcomes, cancellation races, structured portable errors, unsupported schemas, same-scope collisions, unrelated DSH tool preservation, reload catalog/approval cutover, delayed callbacks, and stale closure/revision denial
- [ ] 5.8 Add opt-in Dynamic Runtime Plugins and Evolution scenarios proving both exact portable seven-tool surfaces, bridge-revalidated native approval for every generated-code run transition, generic Evolution dispatch, projection cutover, and stale closure denial without importing or duplicating extension semantics

## 6. Durable lifecycle translation

- [ ] 6.1 Implement an exact-Session live-event reducer that ignores events before `firstLiveSeq` and serializes publication in durable DSH sequence order
- [ ] 6.2 Publish deterministic `session-started`, `turn-started`, `tool-started`, `tool-completed`, and `session-disposed` events through `bridge.publishLifecycle`, declare exactly those plus `turn-committed` and `pre-compaction` in the DSH capability profile, and omit unsupported `session-completed`
- [ ] 6.3 Build `turn-committed` only after `turn/end`, using direct user text, durable assistant text, mapped completed/cancelled/failed outcomes, and no duplicated tool results
- [ ] 6.4 Publish bounded `pre-compaction` from live `compaction/start` markers, exclude seeded or orphaned history, and reject attempts to publish undeclared lifecycle kinds
- [ ] 6.5 Cover normal, blocked, max-token, failed, aborted, and interrupted turns; valid and invalid tool arguments; tool correlation; compaction; seed resume; deterministic retry delivery IDs; and lifecycle capability rejection

## 7. Reload, failure containment, and disposal

- [ ] 7.1 Refresh context/tool projection only after audited Composition Runtime reload commit and retain the prior projection and diagnostics after invalid reload
- [ ] 7.2 Withdraw partial projection and contain activation, context, schema, refresh, invocation, cancellation, and lifecycle subscriber failures to the owning agent state
- [ ] 7.3 Register agent-owned cleanup before activation awaits, stop new work during teardown, drain queued activation/reload/projection/publication work, cancel and await active bridge calls, and exhaustively dispose native tools and Composition Runtime
- [ ] 7.4 Make host-plugin unload snapshot and settle all remaining agent states with idempotent cleanup, exact bridge detachment, late-callback rejection, and aggregate diagnostics
- [ ] 7.5 Cover valid tool cutover, invalid reload rollback, stale closure/revision/callback denial, sibling-agent failure isolation, subscriber containment, neutral disposal, active-call cancellation, and Cordis quiescence
- [ ] 7.6 Cover structured generated-code failures, the explicit native shared-process risk, and exhaustive agent/host disposal of active generated Fibers

## 8. Native portability proof and documentation

- [ ] 8.1 Add a hermetic DSH vertical scenario that activates the shipped actor-neutral `standard` Runtime Preset shape already exercised by OMP, a generated actor-aware full-stack test preset, an opt-in Dynamic Runtime Plugins preset, and an opt-in Evolution preset, observing context, native revisioned tools, actor absence/unbound/bound semantics, lifecycle, persistence, cancellation, exactly approved generated effects, proposal controls, replacement, stop, reload, and teardown end to end
- [ ] 8.2 Add package-level typecheck/test scripts and include `host-dsh` in workspace checks, single-Cordis verification, manifest-driven package-boundary enforcement, and the shared Runtime Host conformance matrix
- [ ] 8.3 Update `docs/hosts/deepseek-harness.md` from research gate to implemented host contract, closed capability profile, direct shared binding, configuration, independent Actor Identity semantics, revisioned tools, cancellation, lifecycle availability, failure boundary, and trust model
- [ ] 8.4 Update the owning architecture, protocols, composition, operations, security, scope/status, verification, and `docs/README.md` topic map documents, including the one-host-transport rule, typed DSH-specific extension convention, and two-adapter common-API promotion gate without duplicating normative ownership
- [ ] 8.5 Update root setup and usage documentation with native DSH installation/composition examples and keep OMP behavior documented as unchanged
- [ ] 8.6 Run focused `host-dsh` checks, the shared Runtime Host conformance suite against DSH and OMP, OMP regression checks, and a real native DSH composition scenario, then run `npm run check`
