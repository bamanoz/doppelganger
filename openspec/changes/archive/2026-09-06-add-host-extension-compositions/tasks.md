## 1. Reconcile prerequisite host work

- [x] 1.1 Integrate the completed `add-openclaw-host` implementation and rebase this change so `hosts/openclaw` is a live capability before modifying its requirements
- [x] 1.2 Re-read current Composition Runtime, Actor Identity, Runtime Host API, OMP, OpenClaw, and active DSH owning documents and reconcile any post-proposal contract drift
- [x] 1.3 Inventory every repository caller of `runtimePlugins` and `runtimePluginIsolation`, every protected virtual import, and every host-owned service isolation declaration
- [x] 1.4 Freeze exact terminology and public type names for Host Extension Composition, protected entries, and host-session facts without adding a second Runtime Preset roster
- [x] 1.5 Add focused planned evidence rows for every scenario before implementation, then preserve existing requirement IDs while replacing those rows with executable targets

## 2. Deepen the Composition Runtime protected layer

- [x] 2.1 Define one domain-neutral protected-composition activation contract that colocates stable entry ID, Cordis plugin, and explicit session-isolated services
- [x] 2.2 Validate protected entry names, plugin shapes, isolation maps, duplicates, reserved identities, and exact optional-field omission before creating a Cordis Fiber
- [x] 2.3 Replace the parallel `runtimePlugins` and `runtimePluginIsolation` path with one deterministic final protected Loader composition while preserving virtual module loading
- [x] 2.4 Keep protected entries outside authored base and patch targeting, and reject attempts to forge, replace, remove, or configure their identities
- [x] 2.5 Settle protected extension dependency graphs through ordinary Cordis injection and include their exact entries in activation audit diagnostics
- [x] 2.6 Exhaust authored tree, protected extension, bridge, watch, session, and root cleanup after partial protected activation failure
- [x] 2.7 Preserve Runtime Preset reload under one immutable protected composition and require Runtime Session replacement for protected-composition changes
- [x] 2.8 Add Composition Runtime tests covering empty compositions, dependent extensions, isolation, reserved-entry attacks, audit failure, cleanup failure aggregation, reload stability, and concurrent sessions

## 3. Implement the Host Extension control plane

- [x] 3.1 Add the host-neutral `host-extension-runtime` workspace package with explicit package boundaries and no dependency on Actor Identity, feature packages, or concrete hosts
- [x] 3.2 Define and validate versioned Host Extension modules, exact host kinds, stable definition IDs, closed config normalizers, and fresh protected-entry factories
- [x] 3.3 Implement immutable available-definition catalog construction from an explicit module list with duplicate, version, wrong-host, malformed-definition, and import-failure diagnostics
- [x] 3.4 Implement ordered selection resolution and JSON-compatible config normalization into one frozen deployment-scoped `HostExtensionPlan`
- [x] 3.5 Reject unknown or duplicate selections before native sessions are served and expose no mutable process-global registration API
- [x] 3.6 Instantiate fresh protected plugin entries for every Runtime Session while sharing only immutable definitions and normalized configuration
- [x] 3.7 Keep host-session facts and narrow capability services in concrete host packages; factories receive normalized configuration rather than raw native session objects
- [x] 3.8 Preserve `ActorIdentity`, `createActorIdentity`, and `doppelgangerActor` as the common optional protocol while host-specific Actor definitions wrap them without changing `extension-protocols` dependency direction
- [x] 3.9 Build the shared Runtime Host bridge as an adapter-owned protected entry with its isolated services colocated and its contract actor-neutral
- [x] 3.10 Add catalog and plan tests covering exact imports, wrong host, duplicate IDs, unknown selections, invalid config, immutable plans, concurrent fresh instances, missing injected facts, and cleanup

## 4. Migrate the OMP Host Extension Composition

- [x] 4.1 Define trusted OMP Host Extension configuration with exact startup module specifiers and ordered definition selections outside Runtime Presets and project manifests
- [x] 4.2 Import and validate OMP Host Extension modules before child binding creation, then serialize only the frozen plan inputs and admitted session facts required by the child
- [x] 4.3 Define immutable OMP child-session fact and narrow transport-capability providers without exposing raw `ExtensionContext`
- [x] 4.4 Preserve parent and child actor admission validation while projecting the value through the OMP Actor Host Extension instead of direct provider bootstrap
- [x] 4.5 Cover bound, unbound, and intentionally omitted Actor Identity configurations without adding actor fields to the shared capability or bridge contracts
- [x] 4.6 Exercise OMP session replacement, pending activation, native event delivery, transport failure, repeated disposal, and late callback fencing through real parent/child entrypoints
- [x] 4.7 Run existing OMP context, tools, approval, cancellation, lifecycle, Dynamic Runtime Plugins, MCP, and project-local entrypoint tests unchanged

## 5. Migrate the OpenClaw Host Extension Composition

- [x] 5.1 Extend OpenClaw preparation inputs with exact Host Extension module specifiers and package the validated module closure as static generated-artifact imports
- [x] 5.2 Persist immutable prepared Host Extension definition metadata separately from `prepared-catalog.json` without actor mappings, credentials, mutable session data, or process-local revisions
- [x] 5.3 Restrict runtime OpenClaw extension selection/configuration to prepared definition IDs and diagnose unprepared IDs with explicit regeneration/restart instructions
- [x] 5.4 Define a closed immutable OpenClaw session-fact service containing only native agent, route, session generation, and normalized workspace identity required by supported extensions
- [x] 5.5 Move trusted exact route-to-actor matching and bound/unbound Actor Identity construction from the core adapter into an OpenClaw Actor Host Extension
- [x] 5.6 Reject Runtime Preset or patch attempts to install or target OpenClaw Host Extensions and expose no gateway, node, subagent, sandbox, worktree, credential, provider, UI, or registry objects
- [x] 5.7 Instantiate fresh OpenClaw Host Extension entries per native binding while keeping binding epochs, approval records, context caches, active calls, replacement, and disposal ownership in the core adapter
- [x] 5.8 Reject Runtime Preset control and raw gateway/node/subagent/sandbox/worktree/credential/provider/UI/registry access; cover two actor sessions, unknown prepared IDs, route rotation, failed extension activation, reload stability, disposal, packaging closure, and native smoke

## 6. Reconcile the DeepSeek Harness host plan

- [x] 6.1 Update the active DSH proposal, design, specifications, and tasks to consume the Host Extension Composition rather than direct `runtimePlugins` and Actor Identity bootstrap
- [x] 6.2 Express DSH anonymous, explicit unbound, explicit bound, trusted resolver, and disabled Actor Identity modes as DSH Host Extension configuration over immutable DSH session facts
- [x] 6.3 Keep future DSH-only typed services on the same agent-owned in-process binding and forbid a second router, sidecar, bridge, or raw runtime service
- [x] 6.4 Validate both active OpenSpec changes together and remove contradictory live requirements before either change is archived

## 7. Clean cutover and documentation

- [x] 7.1 Migrate every test fixture and production caller to the protected Host Extension Composition contract, then remove `runtimePlugins`, `runtimePluginIsolation`, obsolete helpers, string literals, aliases, and re-exports
- [x] 7.2 Update package-boundary manifests and public exports without introducing feature dependencies into `composition-runtime`, `host-omp`, or `host-openclaw`
- [x] 7.3 Update architecture overview, composition/reload, protocols, OMP, OpenClaw, configuration, verification, and status/scope documentation with one authoritative owner per topic
- [x] 7.4 Document the trust split between Runtime Presets and Host Extension Compositions, immutable session facts, extension replacement boundary, and one-binding/one-transport rule
- [x] 7.5 Replace every planned evidence row with direct unconditional executable tests and run focused-spec validation for this change plus affected active host changes
- [x] 7.6 Run focused package typechecks and tests while iterating, then run OpenClaw native smoke, the real OMP entrypoint scenario, `npm run check`, and `npm run check:security`
