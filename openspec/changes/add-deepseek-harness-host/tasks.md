## 1. Shared host bridge

- [ ] 1.1 Move the protected actor/context/tool/lifecycle bridge contract and plugin factory from `host-omp` into the public `extension-protocols` API without host transport concerns
- [ ] 1.2 Migrate every OMP bridge caller, export, fixture, and test to the shared implementation and remove the obsolete OMP-local bridge path
- [ ] 1.3 Add focused `extension-protocols` tests for optional protocol services, immutable actor binding, tool-change notification, invocation, and lifecycle publication

## 2. Native DSH package foundation

- [ ] 2.1 Add the `packages/host-dsh` workspace package, strict TypeScript configuration, public exports, exact DSH peer/dev dependencies, and package-boundary manifest entry
- [ ] 2.2 Define and validate host configuration for explicit Runtime Preset selection, watch mode, context token budget, trusted host patches, and actor mode/resolver; inject the authoritative `doppelgangerRuntimePresets` service instead of duplicating roots, discovery, trust, or authoring configuration
- [ ] 2.3 Implement one plugin-owned state registry with exact Agent identity, per-agent serialized queues, diagnostics, and idempotent lifecycle transitions
- [ ] 2.4 Add native composition tests proving one host-provided Cordis root and no OMP child or JSON-RPC transport

## 3. Per-agent activation and actor binding

- [ ] 3.1 Start idempotent activation from scoped DSH agent/session notifications and enumerate already-live visible agents during host hot-load
- [ ] 3.2 Resolve explicit, project, user-default, and deployment-default states through the injected Runtime Preset roster, including optional-workspace discovery, canonical patch ordering, shipped `standard`, and explicitly defaultless no-selection operation
- [ ] 3.3 Activate one caller-owned `CompositionRuntime` under each selected `agent.ctx` with DSH session metadata, isolated protocol realms, trusted host patches, and the protected shared bridge
- [ ] 3.4 Implement the default namespaced DSH anonymous harness-home actor identity plus explicit unbound and trusted resolver modes, snapshotted once per Runtime Session
- [ ] 3.5 Cover fresh-home `standard` activation, higher-precedence selection, explicitly defaultless no-selection, optional workspace, patch order, bound/unbound actor state, and concurrent same-preset agent isolation

## 4. Prompt context projection

- [ ] 4.1 Capture each turn's direct principal text from claimed user-source inbox messages and retain one stable DSH session/turn identity across later model steps
- [ ] 4.2 Await activation in the scoped `system-prompt/assemble` waterfall and resolve portable context with the configured hard token budget
- [ ] 4.3 Project instruction contributions to deterministic DSH prompt sections and data contributions to dynamic contexts while preserving existing material and DSH suppression rules
- [ ] 4.4 Cover authority projection, hard-budget truncation, stable multi-step turn input, complete-prompt governance, runtime-context suppression, and generic Evolution instruction/reminder projection

## 5. Native tool projection

- [ ] 5.1 Translate available portable descriptors into exact agent-scoped DSH tool definitions with supported object-schema and approval validation, reserved-name rejection, canonical JSON output, and bounded structured failures
- [ ] 5.2 Implement one scoped pre-execute gate that asks through DSH ApprovalService for the current descriptor's required approval and fails closed on rejection, cancellation, or unavailable answerer
- [ ] 5.3 Implement serialized candidate validation and transactional exact registration/approval replacement without masking unrelated native DSH tools
- [ ] 5.4 Make invocation and approval lookups resolve the current committed bridge/descriptor so removed or changed tools cannot execute through stale handlers or grants
- [ ] 5.5 Cover native invocation and Session recording, approval grant/rejection/unavailable outcomes, structured portable errors, unsupported schemas, same-scope collisions, unrelated DSH tool preservation, reload approval cutover, and stale closure denial
- [ ] 5.6 Add opt-in Dynamic Runtime Plugins and Evolution scenarios proving both exact portable seven-tool surfaces, native approval for every generated-code run transition, generic Evolution dispatch, projection cutover, and stale closure denial without importing or duplicating extension semantics

## 6. Durable lifecycle translation

- [ ] 6.1 Implement an exact-Session live-event reducer that ignores events before `firstLiveSeq` and serializes publication in durable DSH sequence order
- [ ] 6.2 Publish deterministic `session-started`, `turn-started`, `tool-started`, `tool-completed`, and `session-disposed` events from audited activation and correlated durable identities
- [ ] 6.3 Build `turn-committed` only after `turn/end`, using direct user text, durable assistant text, mapped completed/cancelled/failed outcomes, and no duplicated tool results
- [ ] 6.4 Publish bounded `pre-compaction` from live `compaction/start` markers and exclude seeded or orphaned history
- [ ] 6.5 Cover normal, blocked, max-token, failed, aborted, and interrupted turns; valid and invalid tool arguments; tool correlation; compaction; seed resume; and deterministic retry delivery IDs

## 7. Reload, failure containment, and disposal

- [ ] 7.1 Refresh context/tool projection only after audited Composition Runtime reload commit and retain the prior projection and diagnostics after invalid reload
- [ ] 7.2 Withdraw partial projection and contain activation, context, schema, refresh, invocation, and lifecycle subscriber failures to the owning agent state
- [ ] 7.3 Register agent-owned cleanup before activation awaits, stop new work during teardown, drain queued activation/reload/projection/publication work, and exhaustively dispose tools and Composition Runtime
- [ ] 7.4 Make host-plugin unload snapshot and settle all remaining agent states with idempotent cleanup and aggregate diagnostics
- [ ] 7.5 Cover valid tool cutover, invalid reload rollback, stale closure denial, sibling-agent failure isolation, subscriber containment, neutral disposal, and Cordis quiescence
- [ ] 7.6 Cover structured generated-code failures, the explicit native shared-process risk, and exhaustive agent/host disposal of active generated Fibers

## 8. Native portability proof and documentation

- [ ] 8.1 Add a hermetic DSH vertical scenario that activates the shipped actor-neutral `standard` Runtime Preset shape already exercised by OMP, a generated actor-aware full-stack test preset, an opt-in Dynamic Runtime Plugins preset, and an opt-in Evolution preset, observing context, native tools, actor binding, lifecycle, persistence, exactly approved generated effects, proposal controls, replacement, stop, reload, and teardown end to end
- [ ] 8.2 Add package-level typecheck/test scripts and include `host-dsh` in workspace checks, single-Cordis verification, and manifest-driven package-boundary enforcement
- [ ] 8.3 Update `docs/hosts/deepseek-harness.md` from research gate to implemented host contract, configuration, identity semantics, lifecycle mapping, failure boundary, and trust model
- [ ] 8.4 Update the owning architecture, protocols, composition, operations, security, scope/status, verification, and `docs/README.md` topic map documents without duplicating normative ownership
- [ ] 8.5 Update root setup and usage documentation with native DSH installation/composition examples and keep OMP behavior documented as unchanged
- [ ] 8.6 Run the focused `host-dsh`, shared bridge, and OMP regression checks, exercise a real native DSH composition scenario, then run `npm run check`
