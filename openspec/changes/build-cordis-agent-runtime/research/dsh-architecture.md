# DeepSeek Harness architecture gate

## Evidence baseline

The inspected DeepSeek Harness checkout is commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Its published framework manifests identify this compatible family:

| Package | Inspected version |
|---|---:|
| `@deepseek-ai/cordis` | `4.0.1` |
| `@deepseek-ai/cordis-plugin-loader` | `1.0.2` |
| `@deepseek-ai/cordis-plugin-include` | `1.0.6` |
| `@deepseek-ai/cordis-plugin-group` | `1.0.1` |
| `@deepseek-ai/cordis-plugin-hmr` | `1.0.16` |

The same versions were present on npm when this gate was completed. The source is authoritative for the lifecycle contract: `vendor/README.md` records local Fiber, Loader, Include, and HMR hardening that public upstream Cordis documentation does not describe.

## 1. Boot, activation, update, rollback, shutdown

### Exact profile boot call graph

```text
apps/cli/src/profile-boot.ts
  runProfile(options)
    composeProfile(...)
    createProcessShutdown(() => app.current?.fiber.dispose())
    installFailLoud(...)
    boot(name, rootConfig, patches, prepare)

packages/boot/app-boot/src/index.ts
  boot(...)
    new Context()
    ctx.provide('dshHomePath', ...)
    await ctx.plugin(Loader)
    await prepare(ctx)
    mountRootInclude(ctx, configPath, patches)
      ctx.loader.builtins.include = Include
      ctx.loader.builtins.group = Group
      ctx.loader.create({ id: 'include', name: 'cordis:include', ... })
    await ctx.loader.await()
    assertEntriesActivated(ctx, name)
```

Verified transitions:

1. `Context.constructor` (`vendor/cordis/src/context.ts`) creates the root Fiber and installs `ReflectService`, `RegistryService`, `EventsService`, and `LoggerService. No second DI container is involved.
2. `ctx.plugin(Loader)` reaches `RegistryService.plugin` (`vendor/cordis/src/registry.ts`), which normalizes `inject`, creates a `Fiber`, and returns a thenable whose settlement is `fiber.await()`.
3. `mountRootInclude` (`packages/boot/app-boot/src/index.ts`) installs `Include` and `Group` as Loader builtins, then creates one pinned root entry.
4. `EntryGroup.create` -> `Entry.update(create=true)` -> `Entry.init` -> `EntryTree.import` -> `Entry._start` (`vendor/loader/src/config/{group,entry,tree}.ts`) imports the module, creates its plugin Fiber, and awaits it. `_start` disposes a failed candidate before propagating the error.
5. `Include[Service.init]` (`vendor/include/src/index.ts`) reads and validates the configuration, yields `stop` as its cleanup, and calls its serialized `apply` path.
6. `Include._apply` -> `EntryGroup.update` starts configured entries concurrently, waits for all outcomes, removes obsolete entries only after successful starts, then commits `data`.
7. `EntryTree.await` repeatedly drains import tasks and Fiber inertia, awaits every entry Fiber, reports one or aggregated failures, notifies Loader dependents, and rechecks for work created by the notification.
8. `assertEntriesActivated` distinguishes a valid disabled row from a missing Fiber, a failed Fiber from a pending Fiber, and names missing required services for pending entries. Only an active required entry passes.
9. Any boot failure reaches `ctx.fiber.dispose()` before `boot` rethrows the labelled original failure.

### Update and rollback call graph

```text
vendor/hmr/src/index.ts
  config watcher -> Include.refresh()
  module watcher -> affected Fiber/entry update path

vendor/include/src/index.ts
  Include.refresh()
    enqueue(...)                   // serializes all tree mutations
      read candidate
      _apply(candidate)
        root.update(entries)

vendor/loader/src/config/group.ts
  EntryGroup.update(candidate)
    Promise.allSettled(create/update each row)
    success: remove obsolete rows, commit candidate data
    failure: remove additions in reverse order,
             recreate every previous row,
             restore previous data,
             aggregate rollback errors if any

vendor/loader/src/config/entry.ts
  Entry.update(candidate)
    config-only: patch context; on failure patch previous context back
    replacement: import candidate before disposing previous Fiber;
                 start candidate; on failure restart previous plugin
    disable: dispose previous Fiber, then commit disabled state
```

Important constraints:

- `Include.enqueue` is mandatory. `EntryGroup.update` is transactional but not reentrant.
- Import happens before replacement disposal. A bad import cannot disturb the active plugin.
- A failed apply restores the previous plugin/config. A failed rollback is surfaced as an aggregate; it is not represented as a healthy old composition.
- Candidate file content is committed only after `root.update` succeeds.
- HMR uses Node internal module-loader cache handling. It belongs in the Node child, not the OMP Bun process.
- Doppelganger may orchestrate watch events and run a post-update audit, but it must not reproduce Fiber or Loader state transitions.

### Shutdown call graph

```text
SIGTERM/SIGINT or app exit
  ProcessShutdown.start(...)
    root Context fiber.dispose()
      owner effects unwind
      Include.stop()
        EntryGroup.stop()
          Entry._dispose()
            Fiber.dispose()
      await async cleanup/quiescence
```

`createProcessShutdown` (`apps/cli/src/process-shutdown.ts`) memoizes one graceful shutdown, bounds it, and escalates a repeated interrupt. The runtime library should expose idempotent disposal and leave process deadlines to its host. Session disposal must await its exact owner Fiber; an OMP child may separately impose a deadline before termination.

## 2. Cordis lifecycle invariants Doppelganger must preserve

### Registry and dependency injection

- `RegistryService.plugin` is the only plugin-construction path. One callback identity has one runtime record and may have many Fibers.
- `Inject.resolve` normalizes every declared name into a hard dependency. Cordis has no optional-injection declaration: every name in `plugin.inject` gates activation.
- Missing hard dependencies leave a Fiber `PENDING`; later `ReflectService.notify` rechecks the implementation and activates it when available.
- Replacing or removing a provider changes the consumer epoch, unloads the consumer, then reloads it only when all required services are available.
- Optional access is `ctx.get(name)`. It returns `undefined` when absent and does not gate activation. Direct `ctx.name` access without a corresponding injection is intentionally rejected inside plugin contexts.

### Service ownership and isolation

- `ctx.provide(name, value)` is an owning Fiber effect. Duplicate provision under the same isolation symbol throws; there is no implicit winner.
- `Context.isolate(name, label?)` changes resolution for one named service. Loader `isolate` entry options build local or named realms and update consumers when the realm changes.
- Isolation is explicit per service name. There is no wildcard child container. An open-world session mounted under a shared Context must therefore reject a subtree that publishes a service into the root realm.
- DSH's `leakedServices` / `mountPreset` audit (`packages/preset/agent-presets/src/mount.ts`) provides the exact precedent: walk the mounted Fiber subtree, compare each implementation key with the root isolation key, and reject leaked service names.

### Fiber and effects

- Fiber states are `PENDING`, `LOADING`, `ACTIVE`, `FAILED`, `UNLOADING`, and `DISPOSED` (`vendor/cordis/src/fiber.ts`). Stable settlement is observed through `fiber.await()`, not by assuming `ctx.plugin()` has activated synchronously.
- A plugin Fiber is registered as an effect of its parent before publication, so parent teardown owns it even during reentrant startup.
- Effects register their owner-visible wrapper before executing setup. Synchronous setup failure rolls back already-collected cleanup.
- Effect cleanup runs in reverse registration order. Async cleanup remains owner-visible until quiescent, allowing racing disposal callers to join it.
- New effects are rejected while the owner is unloading or disposed (`INACTIVE_EFFECT`).
- Fiber unload contains individual cleanup failures through the logger and continues unwinding other effects.
- `Fiber.dispose()` is structurally single-shot; a higher-level session handle should still memoize the returned quiescence promise, following `dsh-scope.createScope`.

### Reflection and audit

- `ReflectService` owns the single root implementation store, keyed by isolation symbols. Context proxies enforce declared dependency access.
- A service is visible to strict reads only while its provider Fiber is active.
- Loader settlement and activation audit are separate requirements: a settled Fiber may legally remain pending. Doppelganger activation must run both.
- Diagnostics must retain entry ID/name, Fiber state, missing injected service names, and the original failed Fiber error. A missing Fiber on an enabled row is an import/load failure, not a pending dependency.

## 3. DSH scopes, presets, dynamic runners, and trust

### Agent and session scopes

`ReactLoopAgent` (`packages/core/agent-loop/src/agent.ts`) mints `createScope(loopCtx, agent)` and exposes `scope.ctx.extend({ agent })`. The factory (`packages/core/agent-loop/src/index.ts`) registers owner teardown before publication, awaits setup, publishes session and agent, and on teardown stops the driver before `scope.dispose()`.

`@deepseek-ai/dsh-scope` is a DSH registration/event-routing layer over Cordis:

- the backing no-op plugin Fiber owns registrations;
- a context carries one opaque nearest scope key;
- scope-aware registries file contributions by that key;
- `scopeTarget` routes descendant events to ancestor listeners;
- arbitrary Cordis services are not isolated merely because a context is tagged.

This is lifecycle/routing isolation for trusted same-process code. It is not an authority or security boundary. The generic Doppelganger kernel does not need `dsh-scope`; a later native DSH host should mount a Doppelganger session under the existing `Agent.ctx` and use DSH scope-aware protocol adapters where appropriate.

### Standing presets

`AgentPresets.ensureStanding` (`packages/preset/agent-presets/src/index.ts`) creates one long-lived scope and Loader subtree per preset generation. `mount` parents each agent scope key to that standing key; all joined agents share plugin objects and registrations. `mountPreset` audits activation and root-realm service leaks before publishing the join.

The standing pattern is deliberately **not** the first Doppelganger runtime shape. Doppelganger requires independent mutable plugin trees per concurrent session. Reused semantics are limited to:

- compose before publication;
- reject pending/failed entries;
- reject process-global service leaks;
- dispose a failed partial mount;
- keep logical identity/persistence separate from JavaScript plugin instances.

### Dynamic host/client runners

The host runner evaluates code in `node:vm`, wraps the resulting plugin with a whitelisted Context façade, starts it as a child Fiber, awaits settlement, and disposes failed startup. The client runner mirrors the façade in the browser. Both explicitly state that this is API discipline, not containment:

- `packages/extensions/cordis-host-runner/src/sandbox.ts`: host-realm closures remain an escape route;
- `packages/extensions/cordis-client-runner/src/client/guard.ts`: accepted code is as trusted as the host process;
- `packages/extensions/cordis-host-runner/src/guard.ts`: the façade prevents accidental framework access and direct tool-dispatch bypass, not hostile-code execution.

Doppelganger does not reuse these generated-code runners. Installed Persona plugins are trusted Node code. The OMP child process is a failure/process-authority seam, not a sandbox claim.

### One Cordis package identity

DSH packages import only `@deepseek-ai/cordis` and declare it as a peer dependency when they are host-mounted. The Loader, Include, Group, HMR, and DSH feature package manifests follow this pattern. A second package identity would split `Context` module augmentation, Registry/Reflect stores, class identity, and plugin ownership even though `Context.is` happens to use a global symbol.

Rules for Doppelganger:

1. Pin the inspected `@deepseek-ai` framework family as one compatible set.
2. Every package exporting Cordis plugins declares `@deepseek-ai/cordis` as a peer and development dependency, never bundles it.
3. The executable/runtime application supplies the one Cordis installation.
4. CI inspects the installed dependency graph and fails on multiple resolved Cordis versions.
5. Never mix upstream `cordis` with `@deepseek-ai/cordis`.

## 4. Reconciled runtime design

### Public seam

The kernel remains one deep module:

```ts
interface RuntimeOptions {
  context?: Context
}

interface ActivationRequest {
  definition: RuntimeDefinition
  metadata: ActivationMetadata
  host: Plugin
}

interface RuntimeSession {
  diagnostics(): RuntimeDiagnostics
  dispose(): Promise<void>
}

interface AgentRuntime {
  activate(request: ActivationRequest): Promise<RuntimeSession>
  dispose(): Promise<void>
}

function createRuntime(options?: RuntimeOptions): AgentRuntime
```

`Plugin` is the Cordis type, not a Doppelganger wrapper. The public session handle exposes orchestration state, diagnostics, and disposal—not a second service locator or plugin API.

### Activation transaction

For each activation:

1. Use the supplied root Context, or create one Context owned by the runtime.
2. Reuse that Context's Loader service or install one runtime-owned Loader when absent. Loader lifecycle hooks and named isolation realms are context-wide; multiple isolated Loader services under one Context still observe the same global Loader events and are therefore invalid.
3. Create one no-op owner Fiber under the runtime owner. Its context is the session lifetime boundary.
4. Extend the owner context with deeply frozen activation metadata.
5. Create one per-session `Include` subclass mounted directly under the session owner, following DSH `PresetTree`; keep its builtin map and tree handle in that activation rather than mutating the shared Loader's builtin map.
6. Namespace string-labelled Loader isolation realms per session, because named realms are otherwise shared by the Context-wide Loader isolation plugin. Entry-local `isolate: true` realms remain naturally entry-local.
7. Register the host plugin in the per-session builtin map and mount it beside the unchanged definition using an in-memory patch row.
8. Await the session Include Fiber and its independent entry tree.
9. Audit every enabled row for loaded/active state and missing dependencies.
10. Audit the mounted subtree for root-realm service leaks. Definitions must use Loader isolation realms for session-local services.
11. Return a session handle only after both audits pass. On any failure, dispose the owner Fiber and await quiescence before rejecting.

This satisfies caller-supplied Context activation without creating a competing root, while still giving every session an independent Include/Loader entry tree and plugin Fibers. It also makes the unavoidable open-world limitation explicit: Cordis service isolation is named, so the activation audit—not a fictional wildcard scope—enforces the no-leak invariant.

### Reload transaction

- Watch configuration and local modules in the Node runtime.
- Serialize mutation requests per session.
- Delegate candidate apply and rollback to Include/Loader/HMR.
- Run the same activation and leak audits after a candidate settles.
- A candidate that applies but fails the Doppelganger audit is not committed as healthy; orchestration must request restoration through the Loader update path and report any rollback failure distinctly.
- Never mutate a Persona Instance ID or persistent home during reload.

### Selected initial package layout

```text
packages/
  runtime/                 # all Cordis-dependent kernel and standard plugins
    src/kernel/
    src/protocols/
    src/persona/
    src/memory/
  host-omp/                # Cordis-free OMP bridge plus Node-side child/host entrypoints
    src/wire/
    src/extension/
    src/child/
personas/
  aiden/                   # Loader-native definition and assets
```

Reasons:

- Two packages follow the actual process boundary; finer domain directories are not premature publication boundaries.
- `runtime` exports ordinary Cordis plugins and peer-depends on the one framework identity.
- `host-omp` keeps OMP/Bun APIs out of portable plugins. Its Node child imports `runtime`; its OMP extension imports only the wire/bridge side.
- The private framed JSON-RPC implementation remains host integration code rather than becoming a generalized RPC package.
- Future independently published feature plugins can split out only when a real consumer requires it; they will peer-depend on the same Cordis identity.

### Reuse/adapt/reject matrix

| Concern | Decision |
|---|---|
| Cordis Context, Registry, Reflect, Fiber, effects | Reuse directly |
| Loader Entry/Tree/Group/Include update semantics | Reuse directly |
| HMR Node module/config watching | Reuse directly where compatible; keep in child |
| DSH app `boot()` | Adapt its sequence; do not depend on profile/home-specific app boot |
| DSH activation audit | Adapt exactly for a session subtree and structured diagnostics |
| DSH preset leak audit | Adapt exactly as the open-world isolation guard |
| DSH standing preset object sharing | Reject for first milestone |
| `dsh-scope` in generic kernel | Reject; use only in later native DSH adapter |
| Dynamic generated-code runners | Reject; installed plugins are trusted |
| Custom DI/plugin/lifecycle/capability framework | Reject |
| Optional capability registry | Reject; hard dependencies use `inject`, optional services use `ctx.get` |

## Gate result

The proposed runtime is viable with the inspected DSH fork if it uses one Cordis identity and one Loader service per Context, an independent directly mounted Include tree per session, per-session namespaced isolation realms plus a root-leak audit, Loader-owned update/rollback, and owner-Fiber quiescent teardown. No second DI, plugin graph, lifecycle, Loader, or capability framework is required.