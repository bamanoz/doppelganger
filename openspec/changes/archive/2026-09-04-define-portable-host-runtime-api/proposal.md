## Why

Doppelganger currently has a working OMP-specific runtime bridge and a second similar bridge planned for DeepSeek Harness, while source research across ten hosts shows the same small semantic core surrounded by incompatible native extension systems. A stable host/runtime API is needed before adding more adapters or the portable MCP tool importer, otherwise each host will independently define session binding, capability absence, tool replacement, approval, cancellation, lifecycle, and host-specific extension behavior.

## What Changes

- Add one host-neutral adapter-facing Runtime Host API in `extension-protocols`; move the existing protected runtime bridge out of `host-omp` and make OMP and future hosts consume the same contract.
- Move the OMP-only serialized activation request and `hostKind` validation out of `composition-runtime`; host packages own their transport fields while reusing the kernel's canonical Composition Definition validation.
- Define an immutable Runtime Session host binding and a closed capability snapshot with only context delivery, tool delivery, required approval, cancellation, and declared standard lifecycle events. Unknown fields and arbitrary string capabilities are rejected; explicitly typed host-specific services remain separate.
- Preserve the existing portable plugin-facing services for context, tools, and lifecycle while making capability absence and partial-host behavior explicit rather than pretending every host has equivalent hooks.
- Keep actor identity as an independent optional `extension-protocols` service with three observable states: provider absent means unsupported, `{ state: "unbound" }` means supported without a resolved user, and `{ state: "bound", actorId }` means a resolved immutable user. The shared Runtime Host API contains no actor fields and Persona never owns the binding.
- Add revisioned tool catalog snapshots and exact-revision invocation so dynamic replacement, stateless transports, reload, and retained native closures cannot dispatch a different handler than the descriptor the host projected.
- Expose one explicit `toolCatalogChanged(revision)` callback from runtime to host instead of a generic notification envelope. No open-ended runtime-to-host event channel is introduced.
- Extend tool invocation with stable call correlation and an optional cancellation signal. Hosts without native cancellation provide a never-aborted signal; transported adapters map explicit cancellation messages to the same invocation.
- Centralize the fail-closed half of portable required approval: a required tool invocation reaches its handler only with a protected one-shot host grant bound to the exact descriptor revision and arguments. Hosts still own policy, presentation, and the user decision.
- Keep the current bounded normalized lifecycle vocabulary as the shared event surface. Hosts advertise the event kinds they can faithfully publish and omit unsupported events instead of synthesizing them.
- Define a protected extension convention for host-specific Cordis services and events. Every provider uses the owning host adapter's existing in-process or transported connection and SHALL NOT start a second host RPC channel, socket, sidecar, or router; explicitly host-bound Runtime Preset plugins may inject the typed service while portable plugins cannot access the raw host runtime.
- Add a generic `extension-mcp` Loader plugin that keeps external MCP server configuration inside a Runtime Preset, imports discovered MCP tools into `doppelgangerTools`, applies exact catalog replacement, and owns connection/process disposal. Host adapters see ordinary portable tools and do not copy or interpret MCP configuration.
- Keep MCP prompts, resources, sampling, elicitation, roots, and arbitrary metadata outside automatic projection. Keep commands and Agent Skills outside the Runtime API, and leave native agents/subagents host-owned.
- **BREAKING**: replace the OMP-named runtime bridge contracts with the shared Runtime Host API and migrate every OMP caller in one cutover; no compatibility aliases or duplicate bridge implementations remain.
- Reconcile the active `add-deepseek-harness-host` plan with the finalized shared API before its implementation.
- Require one reusable Runtime Host conformance suite for every adapter, covering session isolation, empty protocols, closed capabilities, exact tool replacement, approval replay, cancellation races, lifecycle rejection, disposal, stale callbacks, and actor-provider independence.
- Permit a host-specific capability to enter the common API only after at least two implemented host adapters demonstrate equivalent timing, operation ownership, correlation identities, success/failure/cancellation semantics, replay behavior, and disposal. Similar names or payloads are insufficient.

## Capabilities

### New Capabilities

- `host-runtime-api`: Adapter-facing session binding, closed capability negotiation, context resolution, revisioned tool projection and invocation, lifecycle publication, explicit tool-catalog change callback, disposal, conformance, and protected host-specific extension rules.
- `mcp-tool-import`: Runtime Preset-owned external MCP server configuration and lifecycle, deterministic MCP tool import into the portable tool registry, dynamic replacement, invocation, failure containment, and cleanup.

### Modified Capabilities

- `actor-identity`: Replace bridge-owned actor construction with an independently mounted optional protected provider and distinguish unsupported, unbound, and bound states while preserving host authority, immutable session isolation, and Persona independence.
- `extension-protocols`: Add capability-aware host binding, revisioned and correlated tool invocation, optional cancellation, protected approval grants, lifecycle availability, and host-specific extension invariants.
- `composition-runtime`: Generalize protected host plugin mounting and isolation around the shared Runtime Host API, expose only generic canonical activation inputs, and move OMP-only serialized fields to `host-omp`.
- `hosts/oh-my-pi`: Migrate OMP activation, RPC, tool projection, approval, cancellation, lifecycle, and reload to the shared API without changing established OMP behavior.

## Impact

- New public contracts in `packages/extension-protocols`; existing OMP-specific equivalents are removed from `packages/host-omp` after all callers migrate.
- The shared Runtime Host contracts are actor-neutral. Existing actor identity remains a separately mounted optional Cordis capability and is not inferred from Persona activation.
- New workspace package `packages/extension-mcp` with the workspace Cordis peer and an MCP SDK/runtime dependency selected from current official protocol support.
- `packages/composition-runtime` continues to own canonical composition activation, audit, reload, and disposal, but no longer exports an OMP-discriminated serialized activation request.
- `packages/host-omp` remains the sole owner of OMP activation decoding, native subscriptions, child process, framed RPC, routing, and projection. Shared and OMP-specific providers reuse that one transport and cannot create parallel channels.
- `openspec/changes/add-deepseek-harness-host/` must consume the shared API and remove any parallel bridge design before implementation.
- Package-boundary manifest, protocol/host/MCP documentation, project status, and cross-host conformance tests are updated.
- Runtime Presets remain complete Cordis Loader trees. Portable presets may require declared shared capabilities; host-specific presets may explicitly require namespaced host services. No raw host runtime, native command registry, Agent Skill registry, agent/subagent registry, or provider object enters the portable API.
