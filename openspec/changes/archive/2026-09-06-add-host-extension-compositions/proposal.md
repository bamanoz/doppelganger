## Why

Host adapters currently assemble protected runtime-owned Cordis plugins through parallel `runtimePlugins` and `runtimePluginIsolation` maps. That mechanism is sufficient for the shared Runtime Host bridge, but it makes each adapter manually know how optional Actor Identity and typed host-native providers are installed, isolated, ordered, and disposed, and it does not provide the same compositional depth available to ordinary Runtime Presets.

Doppelganger now has two implemented adapters with distinct host-owned identity custody and multiple protected providers, so a real host-extension seam can replace repeated bootstrap knowledge without moving host authority into the kernel or exposing native host internals to portable plugins.

## What Changes

- Introduce a trusted **Host Extension Composition**: a host-owned Cordis Loader tree activated as the final protected layer of each Runtime Session.
- Reuse Loader dependency injection, isolation, Fiber ownership, activation audit, diagnostics, and disposal while keeping Host Extension Compositions separate from selectable and patchable Runtime Presets.
- Replace the shallow parallel `runtimePlugins` / `runtimePluginIsolation` activation interface with one validated protected composition input and perform a clean caller migration.
- Add a host-neutral Host Extension Definition contract plus an immutable per-host catalog and validated selection plan; the shared control-plane module owns definition admission, duplicate/version checks, configuration normalization, deterministic ordering, and per-session instantiation.
- Make package authors responsible for exporting versioned Host Extension Definitions for one exact host kind; definitions expose Cordis plugins and closed configuration schemas, never raw host objects.
- Make the deployment operator responsible for installing exact extension packages and selecting/configuring definitions through trusted host-native configuration, never through Runtime Presets or project patches.
- Make the Host Adapter bootstrap responsible for importing the exact configured modules, building one immutable available-definition catalog, resolving operator selections into a frozen plan, and rejecting unknown, duplicate, incompatible, or unpackaged definitions before serving Runtime Sessions.
- Make the Host Adapter binding manager responsible for snapshotting native session facts and instantiating fresh Host Extension plugin entries from the frozen plan for each Runtime Session.
- Make Composition Runtime responsible only for activating, auditing, isolating, reloading beneath, and disposing the resulting protected composition.
- Define typed, immutable host-session fact providers and narrow adapter-owned capability providers that Host Extensions may inject without receiving a raw OpenClaw, OMP, or future host runtime.
- Migrate Actor Identity installation into host-owned extensions: OMP projects its admitted activation identity and OpenClaw projects its exact native route mapping into the existing optional `doppelgangerActor` protocol.
- Migrate the OMP-native event provider to the same composition, proving that the seam supports more than Actor Identity while preserving the existing shared transport.
- Keep the Runtime Host bridge actor-neutral and keep Memory, Evolution, Persona, MCP, Dynamic Runtime Plugins, and other portable extensions host-neutral.
- Reconcile the completed OpenClaw host change and the active DeepSeek Harness host plan so every adapter uses the same protected Host Extension Composition contract rather than inventing another bootstrap path.
- **BREAKING**: remove the public `runtimePlugins` and `runtimePluginIsolation` activation fields after migrating all repository callers; no compatibility aliases remain.

## Capabilities

### New Capabilities

- `host-extension-compositions`: Trusted host-owned Loader compositions, typed host-session facts, protected activation, lifecycle ownership, configuration custody, and cross-adapter conformance.

### Modified Capabilities

- `composition-runtime`: Replace parallel protected-plugin maps with one protected Host Extension Composition and preserve domain-neutral layered activation, audit, reload, and disposal.
- `host-runtime-api`: Specify how typed host-specific extensions are composed beside the actor-neutral bridge without a second binding, transport, or raw native runtime.
- `actor-identity`: Move host-specific actor resolution and provider installation behind Host Extension Compositions while preserving absent, unbound, and bound semantics.
- `hosts/oh-my-pi`: Activate OMP Actor Identity and native event providers through the trusted Host Extension Composition over the existing child transport.
- `hosts/openclaw`: Resolve exact native route identity through an OpenClaw Host Extension and remove Actor Identity installation details from the core OpenClaw adapter.

## Impact

- Affected packages: a new host-neutral `host-extension-runtime` control-plane package plus `composition-runtime`, `extension-protocols`, `host-omp`, `host-openclaw`, and the future `host-deepseek-harness` implementation.
- Host-specific extension packages or declared subpath exports provide exact-host definitions. No automatic filesystem scan, marketplace discovery, or Runtime Preset-owned package loading is introduced.
- OpenClaw preparation resolves and packages the complete available Host Extension module set into its generated artifact; runtime configuration may select and configure only those prepared definitions. OMP resolves its exact configured module list at trusted adapter startup.
- Activation contracts and tests using `runtimePlugins` / `runtimePluginIsolation` require a clean cutover.
- Runtime Preset format, Runtime Preset selection, feature plugin configuration, shared Runtime Host protocol version, Memory partitions, Persona identity, and external MCP ownership remain unchanged.
- Documentation owners: architecture overview, composition/reload, protocols, OMP and OpenClaw host guides, configuration, verification, and project status/scope.
- Sequencing: `add-openclaw-host` must be integrated before implementation; the active DeepSeek Harness change must be reconciled against this seam before either change is archived.