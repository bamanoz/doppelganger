## Why

Doppelganger needs a native OpenClaw integration that reuses portable Runtime Presets without changing OpenClaw, taking over its context engine, or regressing OMP. OpenClaw's synchronous registration and exact manifest tool names require an explicitly bounded native tool catalog; optional awaited MCP startup can make that catalog ready before use but cannot provide unrestricted dynamic registration.

## What Changes

- Add `packages/host-openclaw`, a preset-neutral native plugin and deployment preparation entrypoint, using the existing Runtime Preset roster, Composition Runtime and shared Runtime Host bridge in process. Do not extract OMP's transport or introduce a new generic host framework.
- Prepare concrete native tool declarations from an audited selected composition and write a generated deployment artifact, never normalized data back into authored presets or patches. Runtime factories bind ready immutable snapshots only to those declared names; changed or undeclared names fail closed with actionable regeneration/restart diagnostics.
- Register OpenClaw hooks and factories synchronously. Use its asynchronous `before_model_resolve` hook for bounded session warmup before embedded tool construction, with independent readiness checks because locked-model execution can skip the hook and hook errors can be contained by OpenClaw.
- Add opt-in MCP Loader-row `startupMode: await-ready`, retaining `background` as the default. Await-ready initial activation requires every enabled initial generation to publish successfully and remain active; failure, timeout or cancellation rejects attempted activation and exhausts its cleanup. Existing in-place update and list-change behavior remain background and revisioned.
- Preserve instruction/data authority through ordinary prompt hooks, exact tool revisions, native one-shot approval, cooperative cancellation, session isolation, immutable actor binding and exhaustive disposal. Never claim native execution policy is an approval grant.
- Publish only lifecycle boundaries proven through the actual supported host route. Keep committed-turn capture explicitly unavailable unless accepted-turn/principal correlation is demonstrated; do not turn `agent_end`, transcript writes or disposal into committed turns and do not replace the selected context engine.
- Document the supported embedded execution profile and limitations for external harnesses, unrestricted new tool names, automatic capture and Dynamic Runtime Plugins. Support claims require native-host evidence, not merely protocol tests.
- Preserve existing OMP behavior and MCP background startup, and qualify the existing portable tool-reload scenario by the host's declared delivery capability.

## Capabilities

### New Capabilities

- `hosts/openclaw`: Native plugin installation and prepared tool declarations, activation, session ownership, authority-preserving context, fixed-boundary tool projection, approval, cancellation, lifecycle fidelity, diagnostics, reload and teardown.

### Modified Capabilities

- `mcp-tool-import`: Optional strict initial readiness alongside unchanged default background startup, with generation-stable outcomes, failure policy, cancellation and lifecycle ownership.
- `extension-protocols`: Qualify native projection of newly registered tools by declared host delivery capabilities; preserve registry notifications and stale-revision enforcement for all hosts.

## Impact

- New host workspace and deployment-preparation entrypoint; deliberate package-boundary and workspace metadata updates. Optional feature packages remain composition-owned, not dependencies encoding feature semantics in the host.
- Changes to MCP configuration, initial-startup outcome tracking, Loader application and owning tests. No MCP-specific readiness field or service in Composition Runtime; no production Runtime Host protocol change.
- Shared conformance fixtures must exercise the real OpenClaw adapter with its fixed capability profile, plus native embedded smoke coverage and OMP regression coverage.
- Implementation updates `docs/hosts/openclaw.md`, `docs/README.md`, owning architecture/operations/status/research documents, MCP feature documentation and installation usage. Planning does not mark the host implemented.
- No upstream OpenClaw changes, context-engine replacement, universal dispatcher tool, host-native MCP configuration bridge, unrelated OMP refactor, or changes to the active DSH and memory-context-engine proposals.
