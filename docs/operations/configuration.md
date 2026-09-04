# Configuration

## Doppelganger home

One absolute home is resolved in this order:

1. explicit host option;
2. non-empty `DOPPELGANGER_HOME`;
3. `~/.doppelganger`.

Before the first Runtime Preset selection from a home without `config.yaml`, the roster initializes the user control plane. It creates `config.yaml`, an empty editable `runtime.cordis.patch.yml`, and the derived `.runtime-presets/` authoring directory. Repeated selection preserves these files. The package-owned shipped `standard` tree is not copied into the user root.

Runtime-owned user configuration is:

```text
$DOPPELGANGER_HOME/
├── config.yaml
├── runtime.cordis.patch.yml
└── .runtime-presets/<id>/
    ├── runtime.cordis.yml
    ├── preset.yml              # optional display metadata
    └── plugin-owned assets
```

`config.yaml` accepts only `version: 1` and optional `defaultRuntimePreset`. Runtime-owned user configuration contains no Persona, trait, actor, principal alias, project identity, plugin setting, credential, storage path, or durable runtime state.

## Runtime Preset roots and trust

The default roster searches roots in this order:

1. the package-owned shipped root containing `standard`, with `system` trust;
2. configured absolute roots in authored order, each explicitly marked `system` or `user`;
3. `$DOPPELGANGER_HOME/.runtime-presets`, with `user` trust.

Hosts may disable either derived root and may configure no deployment default. IDs are lowercase kebab-case directory names. The first root containing an ID wins; a broken winner remains visible and blocks lower copies rather than silently falling through. `system` and `user` are authoring trust labels, not security sandboxes: all activated plugins are trusted process code and can exceed any product-level writable policy. Persona Authoring's logical targets constrain that specific plugin; they do not sandbox a malicious Runtime Preset.

The `runtime-presets` package exposes this roster directly through `RuntimePresetRoster` and as the Cordis `doppelgangerRuntimePresets` service. The Cordis plugin defaults `defaultRuntimePreset` to `standard`; pass `null` to make the deployment explicitly defaultless. A compatible host may mount Actor Identity as a separate protected session plugin outside this runtime home and the shared Runtime Host API. For OMP, the neutral `@doppelganger/doppelganger-omp` entrypoint reads a non-empty `DOPPELGANGER_ACTOR_ID` and passes it to `createDoppelgangerOmpExtension`; the repository-local extension only re-exports that entrypoint. Neither `config.yaml`, project manifests, Runtime Presets, patches, Persona, nor the shared bridge may select or override the actor binding.

## OMP loading mode selection

OMP plugin enablement belongs to the active OMP profile. Choose one Doppelganger loading mode for each invocation and use the same profile when changing plugin state and launching OMP. For the default profile, omit `--profile <name>` from these examples.

Linked-plugin mode is for workspaces that do not expose the repository-local Doppelganger extension:

```bash
omp --profile <name> plugin link ./packages/omp
omp --profile <name> plugin enable @doppelganger/doppelganger-omp
DOPPELGANGER_HOME=/absolute/path/to/home omp --profile <name> --cwd /absolute/path/outside/doppelganger
```

Project-local dogfood mode uses `.omp/extensions/doppelganger.ts` and requires the linked package to be disabled in that profile:

```bash
omp --profile <name> plugin disable @doppelganger/doppelganger-omp
DOPPELGANGER_HOME=/absolute/path/to/home DOPPELGANGER_ACTOR_ID=my-actor omp --profile <name> --cwd /absolute/path/to/doppelganger
```

Disabling the plugin changes only OMP's profile-owned plugin state. It does not remove the project extension, change `DOPPELGANGER_HOME`, or alter Runtime Preset selection. OMP discovers project extensions and installed plugin entrypoints independently and deduplicates only identical resolved absolute paths; enabling both distinct paths binds two adapters that may each start a child runtime. Doppelganger does not arbitrate those adapters with a singleton or lease and does not restrict separate OMP processes from opening the same session.

## Copy-only authoring

`RuntimePresetRoster.copy({ from, id, name? })` resolves a healthy source from any root, then copies its complete directory into the first configured `user` root. It never overwrites an occupied discovered ID or filesystem path. The copy is self-contained: symlinks are dereferenced, owner-only modes are applied, composition and adjacent assets are preserved, source display order/name are not inherited, optional supplied `name` is written, and source description is retained.

The current private workspace has no dedicated preset-authoring CLI or OMP UI. Run the public API from the repository root:

```bash
node --input-type=module -e "import { createRuntimePresetRoster } from '@doppelganger/doppelganger-runtime-presets'; const path = await createRuntimePresetRoster().copy({ from: 'standard', id: 'my-assistant', name: 'My Assistant' }); console.log(path)"
```

With the conventional home, this creates `~/.doppelganger/.runtime-presets/my-assistant/`. Select it globally by setting `defaultRuntimePreset: my-assistant` in `~/.doppelganger/config.yaml`, or per project by setting `runtimePreset: my-assistant` in `<project>/.doppelganger/manifest.yaml`. Selection is fixed when a Runtime Session starts, so begin a new host session after changing it.

`RuntimePresetRoster.remove(id)` removes only the winning preset owned by that same writable root. Shipped, configured-system, shadowed, and other non-owned presets are not removable through this API. If the removed preset is the user `defaultRuntimePreset`, the roster also atomically rewrites `config.yaml` without that selection and rolls the staged removal back on a reported failure.

## Project configuration

The nearest project manifest is discovered from the working directory up to the Git root:

```text
<project>/.doppelganger/
├── manifest.yaml
└── runtime.cordis.patch.yml
```

`manifest.yaml` accepts only `version: 1` and optional `runtimePreset`. It is safe to commit because it contains selection only. The project patch applies to whichever preset wins selection, including a user-default preset.

## Selection

Precedence is explicit host/session choice, project `runtimePreset`, user `defaultRuntimePreset`, then the roster's optional deployment default. The standard package/plugin deployment default is `standard`. A winning missing or broken preset fails visibly and does not fall through. A roster explicitly configured without a deployment default can still yield no selection, which activates no Runtime Session.

## Plugin ownership

A preset's Loader rows own feature configuration, credentials by environment-variable reference, state directories, databases, migrations, partitions, and assets. The runtime does not create Persona Instance directories or assign storage. Persona rows own agent identity only; actor-aware persistence injects the separate host-owned `doppelgangerActor` service.

Dynamic Runtime Plugins are opt-in Loader configuration. The row uses `@doppelganger/doppelganger-dynamic-runtime-plugins/loader`, requires `doppelgangerRuntimeSession` and `doppelgangerTools`, and isolates both services in the session realm. Its optional bounded integer configuration controls VM evaluation time, source/name/purpose sizes, Plugin and Package counts, aggregate stored source, inspection output, and diagnostic message/stack sizes. Unknown or invalid fields fail activation before control tools register. Definitions, Package source, pointers, runs, and diagnostics remain process memory owned by that row; they never write Runtime Presets, patches, configuration, repositories, or durable state. The shipped `standard` preset omits the row.

Evolution is opt-in Loader configuration. The row uses `@doppelganger/doppelganger-evolution`, requires session-isolated Runtime Session metadata, bound Actor Identity, Persona, instance SQLite, context, and tools, and provides session-isolated `doppelgangerEvolution`. Deterministic proactive signal capture defaults on only when this row is composed; `proactiveSignalsEnabled: false` restores proposal-only behavior. Inference calls default off. `signalInferenceEnabled: true` requires an explicitly injected and session-isolated `doppelgangerInference` service in the same realm. Unknown or invalid fields fail before controls or listeners register. Installation alone is inert; shipped `standard` omits the row.

Evolution service fields remain `namespace`, `remindersEnabled`, `reminderCooldownDays` (7-3650), and `projectLockTimeoutMs` (100-60000). Signal fields are `proactiveSignalsEnabled`, `signalInferenceEnabled`, input/output bounds (1-64000 characters), correlated tool outcomes (0-128), queue capacity (1-1024), inference timeout (100-600000 milliseconds), retention (7-3650 days), stored occurrences (1-100000), capability distinct-turn floor (3-100), Persona distinct-session floor (3-100), and promotion score (4-10). Defaults are documented in [Evolution](../features/evolution.md).

Global Evolution state is plugin-owned SQLite. Project capability opportunities are canonical Git-visible YAML under `<workspaceRoot>/.doppelganger/evolution/opportunities/`; no directory is created before the first project mutation. Malformed documents produce diagnostics and are never rewritten automatically. Removing the Loader row and starting a new Runtime Session removes active Evolution behavior but preserves both stores. See [Evolution](../features/evolution.md) for the exact row and storage contract.

Structured inference is an optional session service, not a host or runtime-owned default. The Pi adapter row uses `@doppelganger/doppelganger-inference-pi`, provides session-isolated `doppelgangerInference`, and requires explicit `provider` and `model` identifiers. They resolve from the installed Pi catalog unless an OpenAI-compatible `baseUrl` and `modelContextWindow` are configured together; URLs must be absolute HTTP(S) without embedded credentials. Optional `apiKeyEnv` names one environment credential resolved per call with fail-loud no-fallback semantics; omit it only when the provider's ambient authentication is intended. Optional reasoning is `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Defaults and maxima are: request timeout 120000/600000 milliseconds, input 64000/1000000 characters, output 2048/65536 tokens, response 100000/2000000 characters, and custom context window maximum 10000000 tokens. Unknown keys, unavailable provider/model routes, invalid URLs, incomplete custom-route pairs, or invalid bounds fail activation before service publication.
CodeGraph is opt-in Loader configuration. The row uses `@doppelganger/doppelganger-codegraph/loader`, requires `doppelgangerRuntimeSession` and `doppelgangerTools`, and isolates both services in the session realm. It accepts only an optional absolute `executable` plus bounded status, sync, exploration, shutdown, output, concurrency, queue, and default-file-limit values. Omission resolves `codegraph` from the process environment. Unknown keys, relative executables, and out-of-range values fail activation. The tool surface cannot override the executable, workspace, environment, index path, or upstream command. Installation alone is inert; shipped `standard` omits the row. See [CodeGraph](../features/codegraph.md) for the exact configuration ceilings and trust boundary.

MCP tool import is opt-in Loader configuration. The row uses `@doppelganger/doppelganger-extension-mcp/loader`, requires session-isolated `doppelgangerTools`, and provides session-isolated `doppelgangerMcp` diagnostics. Its required `servers` object maps stable lowercase-kebab IDs to enabled stdio or stateless Streamable HTTP transports. Each server optionally accepts `startupTimeoutMs`, a safe integer from 1 through 600000 milliseconds that defaults to 60000 and bounds its complete initial connection, discovery, validation, and commit sequence. Stdio entries accept the exact command, bounded string arguments, optional absolute `cwd`, and target environment variables resolved only from `{ env: "SOURCE_NAME" }` references. HTTP entries accept the exact absolute credential-free HTTP or HTTPS URL and referenced header values. Per-server exact case-sensitive tool policies may disable a tool, assign a lowercase-kebab alias, or add `approval: { policy: "required", reason }`. Unknown keys and invalid values reject activation or reload synchronously.

Each configured MCP executable, package-manager command, or endpoint is a trusted operator-owned external dependency with the Runtime Session user's effective authority. Doppelganger does not install, download, upgrade, pin, rewrite, substitute, retry, or choose a fallback server. Valid configuration publishes a feature-local `connecting` slot and returns from Loader activation/update before external readiness; missing credentials, unavailable commands/endpoints, protocol failures, and discovery failures become per-server operational `failed` state without invalidating the Runtime Session. Credential values remain in process environment and transport construction; they are not persisted by the plugin, projected into portable descriptors, or returned in snapshots. Removing the row or ending the Runtime Session cancels startup and active calls, withdraws imported tool sets, observes background settlements, and closes owned processes and transports without editing Runtime Presets or native host MCP configuration.

The user owns standalone CodeGraph installation and runs `codegraph init` in each intended workspace. The resulting `.codegraph/` directory is derived project state. Doppelganger never creates, rebuilds, deletes, watches, serves, or globally configures it; `codegraph.explore` may run only bounded `sync --quiet` maintenance when an existing index is incrementally stale. Removing the Loader row or ending the Runtime Session preserves the index.

Persona Authoring is opt-in Loader configuration. `writableTargets` accepts only selected logical trait identities such as `trait:evolving-profile`; identity, filesystem paths, globs, absent traits, and model-selected policy are rejected. The plugin serializes same-session mutations, uses a bounded adjacent interprocess lock and exact-byte compare-and-swap, and performs no autonomous work. Its transaction rollback is not persistent history: user-owned preset backup or version control remains the durable recovery mechanism, including the crash window after atomic replacement but before HMR confirmation.

Paths in normalized activation contracts are absolute. Relative plugin assets resolve from the Runtime Preset directory; relative plugin imports inserted by a filesystem patch resolve from that patch's directory.

Loader rows whose `!!js` configuration expressions read a Cordis service SHALL declare that service in `inject`. Session-scoped services such as `doppelgangerRuntimeSession` SHALL also use the matching Loader `isolate` realm on every referencing row; interpolation is evaluated in that row's context and fails activation when the dependency is undeclared.

## Patch order

```text
selected runtime.cordis.yml
$DOPPELGANGER_HOME/runtime.cordis.patch.yml
<project>/.doppelganger/runtime.cordis.patch.yml
explicit host/session patches
protected runtime-owned plugins (session metadata, shared Runtime Host, optional Actor Identity, typed host extensions)
```

Missing optional patches are no-ops. Valid changes reload the active session; invalid changes retain the previous audited generation. No normalized Loader input is written back to authored files.
