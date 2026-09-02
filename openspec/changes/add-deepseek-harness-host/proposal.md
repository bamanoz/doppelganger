## Why

Doppelganger has proved one portable Runtime Preset through the OMP host, but portability remains unverified until the same compositions run natively inside DeepSeek Harness. The checked-out DSH revision `4e84901e6471b79ec0338099867ebb4606d12bb5` exposes the agent-scoped Cordis, prompt, tool, approval, session-log, and disposal seams required to add that host without introducing a second runtime or transport.

## What Changes

- Add a native DeepSeek Harness host package that activates one isolated Doppelganger Runtime Session for each selected DSH agent session under the agent-owned Cordis Context.
- Consume the authoritative Runtime Preset roster service and ordered user/project patches; explicit, project, and user selection override the deployment default `standard`, while an explicitly defaultless roster leaves Doppelganger inactive without preventing the DSH agent from running.
- Project portable context contributions into DSH prompt assembly and portable tools into the DSH scoped tool registry, including required one-shot native approval and exact replacement after successful Doppelganger reload.
- When a selected Runtime Preset explicitly composes Dynamic Runtime Plugins, project the same portable seven-tool `runtime-plugin.*` surface unchanged, require native one-shot approval for every exact generated-code activation, and preserve dynamic context/tool lifecycle without importing DSH's Cordis runner.
- When a selected Runtime Preset explicitly composes Evolution, project its instruction and reminder context plus the exact portable `evolution.*` controls through the same generic paths without adding Evolution semantics or execution authority to `host-dsh`.
- Translate DSH durable session-log events into the existing lifecycle protocol with stable session, turn, call, and delivery identities; publish only committed turns to capture consumers.
- Bind optional host-authoritative actor identity outside authored Runtime Presets and keep unbound sessions valid for actor-neutral compositions.
- Contain activation, projection, tool, reload, and lifecycle failures to the affected DSH agent session; DSH remains usable and other agents remain isolated.
- Add hermetic native-host tests and update the owning architecture, host, operations, status, and verification documentation.

## Capabilities

### New Capabilities

- `deepseek-harness-host`: Native DSH activation, scoped projection, lifecycle translation, failure containment, reload behavior, and teardown for Doppelganger Runtime Sessions.

### Modified Capabilities

None. The companion `add-shipped-standard-runtime-presets` change supplies the authoritative multi-root roster, Cordis service, authoring API, and `standard` deployment default consumed by this host; composition-runtime, actor-identity, extension-protocol, and patch-layering requirements remain authoritative.

## Impact

- New workspace package: `packages/host-dsh`.
- Existing packages consumed: `runtime-presets`, `composition-runtime`, and `extension-protocols`; `host-dsh` consumes the roster's public Cordis service rather than creating a host-local discovery path.
- A DSH deployment that supports opt-in Dynamic Runtime Plugins or Evolution makes the selected optional extension packages resolvable from its installation closure; generic `host-dsh` does not depend semantically on or reimplement either extension.
- New peer dependencies on the DSH host APIs actually used by the adapter, with the workspace `@deepseek-ai/cordis` peer preserved as the single Cordis root.
- Package-boundary manifest, workspace verification, host documentation, configuration documentation, project status, and focused native-host test coverage are updated.
- No OMP transport or behavior change; the DSH host runs in-process and does not reuse the OMP child/RPC bridge.
