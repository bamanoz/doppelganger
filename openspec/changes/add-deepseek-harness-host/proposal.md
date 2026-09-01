## Why

Doppelganger has proved one portable Runtime Preset through the OMP host, but portability remains unverified until the same compositions run natively inside DeepSeek Harness. The checked-out DSH revision `cd5ef8148158c3a752a658978873241fdf8e2bbc` now exposes the agent-scoped Cordis, prompt, tool, session-log, and disposal seams required to add that host without introducing a second runtime or transport.

## What Changes

- Add a native DeepSeek Harness host package that activates one isolated Doppelganger Runtime Session for each selected DSH agent session under the agent-owned Cordis Context.
- Consume the authoritative Runtime Preset roster service and ordered user/project patches; explicit, project, and user selection override the deployment default `standard`, while an explicitly defaultless roster leaves Doppelganger inactive without preventing the DSH agent from running.
- Project portable context contributions into DSH prompt assembly and portable tools into the DSH scoped tool registry, including required one-shot native approval and exact replacement after successful Doppelganger reload.
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
- New peer dependencies on the DSH host APIs actually used by the adapter, with the workspace `@deepseek-ai/cordis` peer preserved as the single Cordis root.
- Package-boundary manifest, workspace verification, host documentation, configuration documentation, project status, and focused native-host test coverage are updated.
- No OMP transport or behavior change; the DSH host runs in-process and does not reuse the OMP child/RPC bridge.
