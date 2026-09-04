## Why

Doppelganger has proved one portable Runtime Preset through the OMP host, but portability remains unverified until the same compositions run natively inside DeepSeek Harness. The checked-out DSH revision `4e84901e6471b79ec0338099867ebb4606d12bb5` exposes the agent-scoped Cordis, prompt, tool, approval, session-log, and disposal seams required to add that host without introducing a second runtime or transport.

## What Changes

- Add a native DeepSeek Harness host package that activates one isolated Doppelganger Runtime Session for each selected DSH agent session under the agent-owned Cordis Context.
- Consume the authoritative Runtime Preset roster service and ordered user/project patches; explicit, project, and user selection override the deployment default `standard`, while an explicitly defaultless roster leaves Doppelganger inactive without preventing the DSH agent from running.
- Install the finalized actor-neutral shared Runtime Host plugin with DSH's closed capability profile: per-turn context, dynamic revisioned tools, native required approval, cooperative cancellation, and only lifecycle events DSH can publish faithfully.
- Resolve portable context once for each direct user turn, retain accepted authority-labelled contributions for later model steps in that turn, and project exact immutable tool snapshots into the DSH scoped tool registry. Refresh tools only through `toolCatalogChanged(revision)`, preserve descriptor revisions in native closures, revalidate one-shot approval inside the bridge, and correlate cancellation by call ID.
- When a selected Runtime Preset explicitly composes Dynamic Runtime Plugins, project the same portable seven-tool `runtime-plugin.*` surface unchanged, require native one-shot approval for every exact generated-code activation, and preserve dynamic context/tool lifecycle without importing DSH's Cordis runner.
- When a selected Runtime Preset explicitly composes Evolution, project its instruction and reminder context plus the exact portable `evolution.*` controls through the same generic paths without adding Evolution semantics or execution authority to `host-dsh`.
- Translate DSH durable session-log events into the existing lifecycle protocol with stable session, turn, call, and delivery identities; publish only committed turns to capture consumers and reject lifecycle kinds omitted from DSH's declared capability profile.
- Mount host-authoritative Actor Identity through a separate protected plugin outside the shared bridge. DSH supports provider-absent, explicit unbound, and immutable bound states; actor-independent compositions and the shared API do not require the actor service.
- Keep any future DSH-only service or event in an explicitly typed host-namespaced protected plugin that reuses the same in-process binding and Cordis lifecycle. No second bridge, router, process, sidecar, or generic notification channel is introduced.
- Contain activation, projection, tool, reload, and lifecycle failures to the affected DSH agent session; DSH remains usable and other agents remain isolated.
- Add hermetic native-host tests, run the same transport-independent Runtime Host conformance suite used by OMP, and update the owning architecture, host, operations, status, and verification documentation.

## Capabilities

### New Capabilities

- `deepseek-harness-host`: Native DSH activation, scoped projection, lifecycle translation, failure containment, reload behavior, and teardown for Doppelganger Runtime Sessions.

### Modified Capabilities

None. The implemented Runtime Preset roster, Composition Runtime, Actor Identity, extension protocols, shared Runtime Host API, and patch-layering requirements remain authoritative and are consumed without host-local variants.

## Impact

- New workspace package: `packages/host-dsh`.
- Existing packages consumed: `runtime-presets`, `composition-runtime`, and `extension-protocols`; `host-dsh` consumes the roster's public Cordis service and the shared Runtime Host contracts rather than creating host-local discovery or bridge APIs.
- A DSH deployment that supports opt-in Dynamic Runtime Plugins or Evolution makes the selected optional extension packages resolvable from its installation closure; generic `host-dsh` does not depend semantically on or reimplement either extension.
- New peer dependencies on the DSH host APIs actually used by the adapter, with the workspace `@deepseek-ai/cordis` peer preserved as the single Cordis root.
- Package-boundary manifest, workspace verification, shared host conformance, host documentation, configuration documentation, project status, and focused native-host test coverage are updated.
- No new OMP transport or behavior change is introduced by this host. DSH binds the shared bridge directly in-process and neither reuses nor duplicates the OMP child/RPC transport.
