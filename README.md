# Doppelganger

Doppelganger is a portable extension runtime for AI-agent environments, built on [Cordis](https://github.com/cordiverse/cordis). It activates composable runtime definitions inside agent sessions and projects their context, tools, lifecycle events, and persistent state into a host.

Persona is the first product layer built on the runtime. It is composed from ordinary Cordis plugins rather than encoded as a fixed model in the kernel.

> Status: experimental, private workspace. The authoritative Runtime Preset roster and OMP vertical slice are implemented. The native OpenClaw adapter is certified by an installed-Gateway smoke against `openclaw@2026.9.1` build `ad6fe23`; DeepSeek Harness remains deferred.

## What it provides

- Isolated runtime session and Cordis plugin tree per agent session.
- Declarative composition with transactional hot reload and rollback.
- Ordered `system`/`user` Runtime Preset roots, a shipped actor-neutral `standard` default, copy-only authoring, and an optional Cordis roster service.
- Host-neutral context, tool, lifecycle, Actor Identity, and exact-host Host Extension composition contracts.
- Persona identity and ordered traits as portable plugins.
- Optional logical-target Persona inspection and one-shot approved trait revision with exact-byte CAS and HMR-confirmed rollback.
- SQLite-backed, partitioned canonical memory with immutable revisions and provenance.
- Explicit active memory and optional candidate capture as separate write paths.
- Independent FTS5 and optional semantic top-K retrieval, deterministic reciprocal-rank fusion, canonical revalidation, temporal eligibility, and hard budgets.
- A versioned framed JSON-RPC bridge for Oh My Pi (OMP).
- Dynamic OMP tools translated from runtime JSON Schemas.
- A native OpenClaw plugin with audited finite-catalog preparation, direct Runtime Sessions, per-turn context, exact approval/cancellation, explicit actor routing, and deterministic teardown.
- Optional session-owned Dynamic Runtime Plugins with source-verified inspection, immutable Packages, guarded JavaScript evaluation, and exact one-shot approval.
- Optional default-off session logging to rolling JSONL files or a private Sentry client without OMP output or RPC projection.

Doppelganger does **not** implement an agent loop or model provider. It extends an existing host.

## Requirements

- Node.js 26 or newer
- npm
- OMP 18.x for the host integration
- OpenClaw 2026.9.1 for the current native integration candidate

## Development

```bash
npm install
npm run check
```

Useful commands:

```bash
npm run typecheck
npm run test
npm run check:cordis
npm run check:boundaries
npm run check:integrity
npm run check:security
```

`npm run check` is the deterministic, network-free repository gate. It runs every workspace typecheck and test, verifies that one Cordis installation is used, validates dependencies/imports against `scripts/package-boundaries.json`, and checks documentation inventory, links, live OpenSpec ownership, and executable evidence. `npm run check:focused-specs` exposes the focused-spec gate directly; `npm run check:focused-specs:change -- <change-name>` is the strict pre-archive form. `npm run check:security` is separate because it queries the npm registry and compares unresolved production advisories with the reviewed baseline.

## Repository layout

```text
packages/
├── runtime-presets      Ordered roster, shipped standard preset, copy-only authoring, and Cordis facade
├── composition-runtime Cordis composition, sessions, patches, diagnostics, and reload
├── host-extension-runtime Versioned definitions, explicit catalogs, normalized plans, and protected entries
├── extension-protocols Context, tools, and normalized lifecycle contracts
├── extension-persona   Persona activation metadata, identity, traits, and Loader root
├── extension-persona-authoring  Logical inspection and approved exact trait revision
├── extension-dynamic-runtime-plugins  Opt-in inspected temporary Cordis plugin workflow
├── extension-codegraph  Optional workspace-bound CodeGraph status and graph exploration
├── extension-logging-file  Opt-in rolling JSONL destination for normalized Runtime Session logs
├── extension-logging-sentry  Opt-in private-client Sentry destination for normalized Runtime Session logs
├── extension-sqlite    Directly loadable SQLite infrastructure
├── extension-memory    Canonical memory, lexical/hybrid retrieval, tools, capture, and semantic contracts
├── extension-embedding-local  Lazy EmbeddingGemma/MiniLM Loader plugin and validated model cache
├── extension-memory-vectors   Semantic coordinator and SQLite/Chroma/Qdrant/pgvector Loader backends
├── host-omp            Generic OMP adapter, child runtime, and framed RPC transport
├── host-openclaw       Native OpenClaw adapter, finite deployment preparation, and direct Runtime Session ownership
└── omp                 Private local OMP plugin install unit and neutral entrypoint

skills/                  Installable cross-host Agent Skills grouped by owning feature

.omp/extensions/          Project-local OMP bootstrap
dev/doppelganger/         Development runtime home and Runtime Presets
.doppelganger/            Project Runtime Preset selection and optional patch
docs/                     Authoritative architecture, feature, host, operations, scope, and audit tree
scripts/package-boundaries.json  Authoritative allowed internal package edges
```

Coding agents should start with [`AGENTS.md`](./AGENTS.md) and keep the authoritative [`docs/` tree](./docs/README.md) in context. `README.md` owns setup and usage; detailed architecture, behavior, operations, scope, and audits live under `docs/`. Package-boundary intent is documented there, while the JSON manifest remains the single executable edge source.

## Runtime model

```text
explicit choice   ─┐
project choice    ─┼─> Runtime Preset + user/project patches
user default      ─┤                    │
deployment default─┘                    ▼
                             authored composition
                                        │
trusted host modules/config ─> Host Extension plan
                                        │
                                        ▼
                           isolated Runtime Session
                                        │
                             ┌──────────┼──────────┐
                             ▼          ▼          ▼
                          context      tools    lifecycle
                             │          │          │
                             └── shared Runtime Host bridge ──┘
```

Core concepts:

- **Composition Definition** — a complete, portable Cordis Loader tree with opaque plugin configuration.
- **Runtime Preset** — a complete, self-contained Cordis Loader tree in one directory under an ordered `system` or `user` root.
- **Runtime Preset roster** — deterministic multi-root discovery, health, selection, copy/remove authoring, and deployment-default policy outside Runtime Sessions.
- **Runtime Patch** — an optional Cordis Include patch list layered over the selected preset.
- **Host Extension** — a versioned definition for one exact host kind, installed and selected through trusted host-native configuration, then instantiated from closed session facts as a fresh protected entry.
- **Runtime Session** — one isolated activation inside one host agent session.
- **Persona Instance** — optional identity and state lineage owned by Persona extensions, not by the kernel or host.

The kernel knows composition, isolation, diagnostics, reload, and teardown. It does not know what Persona, identity, traits, memory, actors, storage, context, or tools mean. Runtime Presets cannot select or target Host Extensions. The standard `runtime-host` Host Extension installs the actor-neutral shared bridge; a host may independently select `actor` for bound or unbound Actor Identity or omit it for provider absence. Host Extension changes replace the Runtime Session rather than hot-mutating authority beneath live closures.

## Local OMP installation and dogfooding

Doppelganger supports two OMP loading modes. Select exactly one for an OMP invocation and profile:

| Mode | Use when | Required setup |
| --- | --- | --- |
| Installed or linked plugin | Running OMP from workspaces that do not expose this repository's `.omp/extensions/doppelganger.ts` | Link and enable `@doppelganger/doppelganger-omp` in the active OMP profile |
| Project-local dogfood | Running OMP in this repository through `.omp/extensions/doppelganger.ts` | Disable the linked plugin in the active OMP profile |

For linked-plugin mode, run from the repository root, then launch OMP from a workspace outside this repository:

```bash
omp plugin link ./packages/omp
DOPPELGANGER_HOME=/absolute/path/to/a/new-home omp --cwd /absolute/path/outside/doppelganger
```

For project-local dogfood mode, disable the linked package before launching from this repository:

```bash
omp plugin disable @doppelganger/doppelganger-omp
DOPPELGANGER_HOME=/absolute/path/to/a/development-home DOPPELGANGER_ACTOR_ID=my-actor omp --cwd /absolute/path/to/doppelganger
```

Re-enable linked-plugin mode with `omp plugin enable @doppelganger/doppelganger-omp`. Plugin state belongs to the active OMP profile. For a named profile, place `--profile <name>` before the `plugin` subcommand and use the same profile for launch, for example `omp --profile work plugin disable @doppelganger/doppelganger-omp` followed by `omp --profile work --cwd /absolute/path/to/doppelganger`.

OMP discovers native project extensions and installed plugin entrypoints independently, resolves every candidate to an absolute path, and deduplicates only identical resolved paths. `.omp/extensions/doppelganger.ts` re-exports the package factory, but its path differs from the linked package entrypoint. If both are enabled, OMP invokes two adapters; each can register handlers and start its own child runtime. Disable one loading path rather than relying on factory identity.

This is an invocation-configuration boundary, not session exclusivity. Doppelganger adds no process-wide singleton, lease, or filesystem lock, and does not prevent several OMP processes from opening the same session. Within each committed adapter binding, that adapter owns one isolated child Runtime Session.

With no authored selection and no `DOPPELGANGER_ACTOR_ID`, the linked plugin activates the shipped actor-neutral `standard` Runtime Preset. The package entrypoint supplies no repository path, actor, Persona, or named Runtime Preset default.

The home path may be absent before launch. The first Runtime Preset selection creates `config.yaml`, an empty editable `runtime.cordis.patch.yml`, and `.runtime-presets/`. The shipped `standard` tree stays in the installed package, like DSH profile bundles; copy it to a new user preset ID only when you want an independently editable preset.

The project-local `.omp/extensions/doppelganger.ts` is only a default re-export from that same package entrypoint. Repository integration tests exercise it with generated temporary Runtime Presets and test actors; they do not consume a personal preset or durable user state.

The extension starts one child runtime for its committed OMP binding, imports any explicitly configured `hostKind: "omp"` Host Extension modules before child creation, instantiates fresh protected entries, appends assembled runtime context to each model turn, and exposes available runtime tools with the `doppelganger_` prefix. Programmatic embedders configure exact module specifiers and ordered selections through `DoppelgangerOmpExtensionOptions.hostExtensions`; Runtime Presets and project manifests cannot add them.

## Local OpenClaw preparation and installation

OpenClaw requires concrete native tool names at registration, so Doppelganger separates artifact preparation from native installation. Preparation activates one selected Runtime Preset as trusted code, snapshots its portable catalog, imports and bundles exact trusted `hostKind: "openclaw"` Host Extension modules, disposes the temporary Runtime Session, validates separately fingerprinted tool and Host Extension metadata, and atomically publishes only that output:

```bash
npm exec --workspace @doppelganger/doppelganger-host-openclaw -- \
  doppelganger-openclaw-prepare \
  --output /absolute/path/to/openclaw-doppelganger \
  --preset my-assistant \
  --workspace /absolute/path/to/project
```

Use repeatable `--host-extension <module>` and `--enable-host-extension <id>` or `<id>=<JSON>` to prepare custom definitions. Runtime `hostExtensions` selections are restricted to those prepared IDs; module or available-ID changes require regeneration and native restart. This repository does not publish `@doppelganger/doppelganger-host-openclaw`. For local source-checkout use on Node.js 26, expose each private TypeScript workspace package through a package-name symlink whose resolved source realpath remains outside `node_modules`; copying raw TypeScript package trees under `node_modules` fails Loader imports with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and no compiled-package fallback is claimed. Then install or link the generated artifact with OpenClaw's normal plugin manager. Configure `plugins.entries.doppelganger.hooks.allowConversationAccess: true`, keep `allowPromptInjection` enabled, configure the same roster/preset, prepared Host Extension selection, and exact actor routes under the plugin's `config`, then restart and inspect the active Gateway.

MCP discovery is background by default. Use `startupMode: await-ready` in the operator-owned MCP Loader row before preparation when the initial generated manifest must contain those tools. The OpenClaw warmup default is 10 seconds, which can expire before MCP's default 60-second startup deadline; neither deadline bounds final cleanup. New names or incompatible descriptor contracts require regeneration and native restart. Arbitrary generated Runtime Plugin names, external harnesses, automatic committed-turn capture, and actor inference from channel senders are unsupported.

See [OpenClaw](./docs/hosts/openclaw.md) for installation, configuration, identity, capabilities, approval, lifecycle, trust, and disposal details.

## Runtime Preset configuration

The runtime home resolves from an explicit host option, then `DOPPELGANGER_HOME`, then `~/.doppelganger`. The default roster searches the package-owned shipped root, any configured roots in order, then `$DOPPELGANGER_HOME/.runtime-presets`. Each root has `system` or `user` trust; the first occupied ID wins even when broken. User selection contains no Persona or plugin settings:

```yaml
# ~/.doppelganger/config.yaml
version: 1
defaultRuntimePreset: my-assistant
```

Without a higher-precedence selection, the normal package/OMP deployment activates the shipped actor-neutral `standard` preset. Hosts may explicitly configure a defaultless roster when inactive behavior is required.

A Runtime Preset is a complete Cordis Loader tree plus adjacent owned assets. Plugin configuration and persistence ownership stay in that tree:

```yaml
# ~/.doppelganger/.runtime-presets/my-assistant/runtime.cordis.yml
- id: doppelganger-context
  name: "@doppelganger/doppelganger-protocols/context"
  isolate: { doppelgangerContext: session }
- id: doppelganger-tools
  name: "@doppelganger/doppelganger-protocols/tools"
  isolate: { doppelgangerTools: session }
- id: doppelganger-persona
  name: "@doppelganger/doppelganger-persona"
  inject: [doppelgangerRuntimeSession, doppelgangerContext]
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerContext: session
    doppelgangerPersona: session
  config:
    instanceId: my-assistant
    identity: { path: identity.md, priority: 1000 }
    traits:
      - { name: engineer, path: traits/engineer.md, priority: 700 }
      - { name: concise, path: traits/concise.md, priority: 600 }
- id: doppelganger-sqlite
  name: "@doppelganger/doppelganger-sqlite"
  isolate: { doppelgangerInstanceSqlite: session }
  config:
    home: /absolute/plugin-owned/state/path
- id: doppelganger-memory
  name: "@doppelganger/doppelganger-memory"
  inject: [doppelgangerActor, doppelgangerPersona, doppelgangerContext, doppelgangerTools, doppelgangerInstanceSqlite]
  isolate:
    doppelgangerActor: session
    doppelgangerPersona: session
    doppelgangerContext: session
    doppelgangerTools: session
    doppelgangerInstanceSqlite: session
    doppelgangerMemory: session
```

Project selection is deliberately minimal:

```yaml
# <project>/.doppelganger/manifest.yaml
version: 1
runtimePreset: my-assistant
```

Selection precedence is explicit host/session choice, nearest project `runtimePreset`, user `defaultRuntimePreset`, then the roster's optional deployment default (`standard` in the normal deployment). A selected missing or broken preset fails visibly and never falls through. A defaultless roster can yield inactive state. The nearest `.doppelganger/manifest.yaml` is found while walking from the working directory to the Git root.

Optional patch files use Cordis Include patch syntax and apply in this order:

```text
$DOPPELGANGER_HOME/runtime.cordis.patch.yml
<project>/.doppelganger/runtime.cordis.patch.yml
explicit host patches
protected Host Extension composition (shared Runtime Host, optional Actor Identity, typed host extensions)
```

The runtime watches the selected preset and applicable patch paths. A valid generation replaces the active tree; an invalid update rolls back without mutating authored files.

### Copy-only authoring

The public `RuntimePresetRoster` API can copy any healthy discovered preset into the first writable `user` root. Copying preserves the complete tree, dereferences symlinks, rewrites optional display metadata, and never overwrites an occupied ID or path. Removal is limited to the winning preset owned by that writable root; removing the selected user default also clears `defaultRuntimePreset`. Shipped and configured-system presets are immutable through this API.

There is not yet a dedicated Doppelganger CLI or OMP authoring surface. From the repository root, copy `standard` through the public Node API:

```bash
node --input-type=module -e "import { createRuntimePresetRoster } from '@doppelganger/doppelganger-runtime-presets'; const path = await createRuntimePresetRoster().copy({ from: 'standard', id: 'my-assistant', name: 'My Assistant' }); console.log(path)"
```

This creates the complete editable tree at `~/.doppelganger/.runtime-presets/my-assistant/`. The ID must be lowercase kebab-case and copying never overwrites an existing preset or path.

Select the copy globally in `~/.doppelganger/config.yaml`:

```yaml
version: 1
defaultRuntimePreset: my-assistant
```

Or select it only for one project in `<project>/.doppelganger/manifest.yaml`:

```yaml
version: 1
runtimePreset: my-assistant
```

Start a new OMP session after changing selection. Edit the copied tree rather than the package-owned `standard` source.

The same roster is available to in-process Cordis hosts through `@doppelganger/doppelganger-runtime-presets/plugin` as `ctx.doppelgangerRuntimePresets`. OMP deliberately consumes the pure API before its child runtime exists.

### Runtime logging

Plugins continue to use ordinary Cordis `ctx.logger`. Logging produces no destination output unless an effective Runtime Preset or ordered Runtime Patch explicitly inserts a file or Sentry row. The shipped `standard` preset omits both.

```yaml
- id: runtime-logs-file
  name: "@doppelganger/doppelganger-logging-file/loader"
  inject: [doppelgangerLogging]
  isolate: { doppelgangerLogging: session }
  config:
    pathTemplate: "/absolute/path/runtime-{runtimeActivationId}.jsonl"
    level: info
    maxBytes: 10485760
    maxFiles: 5
    maximumPendingRecords: 2048
    retention:
      maxAgeDays: 7
      maxTotalBytes: 536870912
      cleanupIntervalMs: 60000

- id: runtime-logs-sentry
  name: "@doppelganger/doppelganger-logging-sentry/loader"
  inject: [doppelgangerLogging]
  isolate: { doppelgangerLogging: session }
  config:
    dsnEnv: DOPPELGANGER_SENTRY_DSN
    level: error
    flushTimeoutMs: 2000
    maximumPendingRecords: 1024
```

The file destination requires exactly one absolute normalized operator-owned `path` or `pathTemplate`. A template containing exactly one `{runtimeActivationId}` token creates a distinct file for every concrete Runtime Session activation, including concurrent OMP children and restarts that reuse a logical session ID. Static paths retain the one-active-operating-system-writer-per-concrete-path rule. Every normalized record and Sentry event carries the same activation ID alongside Runtime Session and Runtime Preset correlation. `dsnEnv` references one environment variable; do not place the DSN in YAML. OMP keeps ordinary logs inside the child destination layer: stdout remains framed JSON-RPC and no log record is projected into reports, tools, context, or UI. See [Runtime logging](docs/features/runtime-logging.md) for filtering, bounds, rotation, failure containment, reload, and disposal.

The optional `retention` block cleans completed activation families at startup and periodically. It protects live processes and unregistered legacy logs; its budget is best-effort when protected files dominate, not a hard filesystem quota. Use a local log directory and an activation token in the filename. Omitting the block keeps cleanup disabled. Ownership, scope, migration, and operational limits are defined in [Runtime logging](docs/features/runtime-logging.md#cross-activation-retention).

### Optional full-stack user presets

An editable user Runtime Preset may extend `standard` with Persona Authoring, Evolution, a structured-inference provider, Dynamic Runtime Plugins, CodeGraph, MCP tool import, SQLite, lexical memory, a local embedder, one vector backend, and the semantic coordinator. Such a composition remains user-owned configuration rather than a shipped or repository-specific preset. Each feature stays an independently addressable Loader row, and tests construct equivalent full-stack presets under temporary roots.

Persona Authoring writes only explicitly configured logical trait targets. Evolution exists only when its Loader row is present, stores non-executing proposals in actor-partitioned SQLite or project YAML, and defaults to bounded deterministic signal discovery from completed lifecycle events. Structured inference exists only when a provider row is present; Evolution model calls additionally require `signalInferenceEnabled: true`. Dynamic Runtime Plugins exist only when their Loader row is present and keep every definition in Runtime Session process memory. CodeGraph exists only when its Loader row is present and uses the Runtime Session workspace plus a separately installed, user-initialized local index. MCP tool import exists only when its Loader row is present and owns only its configured external server connections and imported portable tool sets. Omitting a row leaves that feature and its tools absent.

### CodeGraph code intelligence

Install a compatible standalone CodeGraph CLI yourself, then initialize only the repositories you intend to expose. Doppelganger currently supports `>=1.6.0 <1.7.0` and never installs, upgrades, initializes, rebuilds, deletes, watches, serves, or globally configures CodeGraph:

```bash
npm install --global @colbymchenry/codegraph@1.6.0
cd /absolute/path/to/project
codegraph init
```

Add the optional row to an editable Runtime Preset that already composes session-isolated `doppelgangerTools`:

```yaml
- id: doppelganger-codegraph
  name: "@doppelganger/doppelganger-codegraph/loader"
  inject: [doppelgangerRuntimeSession, doppelgangerTools]
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerTools: session
  config:
    defaultMaxFiles: 8
    maximumConcurrentExplorations: 2
```

The plugin exposes `codegraph.status` and `codegraph.explore`. Both are bound to the host-owned Runtime Session workspace; tool input cannot choose another path or executable. Exploration validates the existing index and may run only incremental `codegraph sync --quiet` maintenance when that derived index is otherwise safe. The private OMP package contains the optional Loader package in its installed closure; other hosts must make it resolvable themselves. CodeGraph runs as trusted local process code, and returned source context follows the host's ordinary model-disclosure path. See [`docs/features/codegraph.md`](docs/features/codegraph.md) for exact status, safety, bounds, lifecycle, and trust contracts.

### MCP tool import

Add the optional Loader row to an editable Runtime Preset that already composes session-isolated `doppelgangerTools`:

```yaml
- id: doppelganger-mcp
  name: "@doppelganger/doppelganger-extension-mcp/loader"
  inject: [doppelgangerTools]
  isolate:
    doppelgangerTools: session
    doppelgangerMcp: session
  config:
    servers:
      filesystem:
        startupTimeoutMs: 120000
        transport:
          type: stdio
          command: filesystem-mcp
          args: ["/absolute/workspace"]
        tools:
          write_file:
            approval: { policy: required }
```

Server configuration belongs to the Runtime Preset, not OMP or another native host. Credentials are environment-variable references rather than inline values. Doppelganger executes the exact authored command, arguments, or endpoint; it does not install, pin, rewrite, retry, or select fallback MCP servers. Each enabled server connects independently in the background under its bounded `startupTimeoutMs`, so Runtime Session activation does not wait for external readiness. Discovered tools appear atomically as `mcp-<server-id>.<local-id>` through the host's ordinary dynamic catalog path and remain subject to exact-revision approval and cancellation. `approval: { policy: required }` enforces the portable minimum; an optional bounded `reason` is only a host-presentation hint. A failed server publishes no tools and remains visible through `doppelgangerMcp.snapshot()` without invalidating healthy services.

### Dynamic Runtime Plugin development

Add the optional Loader row to an editable user Runtime Preset; shipped `standard` deliberately omits it:

```yaml
- id: doppelganger-dynamic-runtime-plugins
  name: "@doppelganger/doppelganger-dynamic-runtime-plugins/loader"
  inject: [doppelgangerRuntimeSession, doppelgangerTools]
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerTools: session
  config:
    vmTimeoutMs: 1000
    maximumSourceBytes: 65536
    maximumPlugins: 32
    maximumPackagesPerPlugin: 32
    maximumTotalSourceBytes: 524288
```

The preset must already compose the session-isolated `doppelgangerTools` protocol row. The private OMP product package includes the optional Loader package in its dependency closure; other deployments must make the package resolvable themselves. Invalid or unknown configuration fails activation before any controls register.

The feature exposes `runtime-plugin.inspect-list`, `runtime-plugin.inspect-query`, `runtime-plugin.inspect-self`, `runtime-plugin.define`, `runtime-plugin.run`, `runtime-plugin.stop`, and `runtime-plugin.undefine`. Inspect exact catalog contracts first. `define` stores inert immutable plain-JavaScript source. `run` evaluates one exact Package only after a fresh native approval binding its Plugin ID, Package ID, mode, name, purpose, and SHA-256 source digest. `stop` retains versions; `undefine` removes them. Update, rollback, and restart are explicit separately approved runs.

Generated Package code is trusted process code with authority comparable to shell access. `node:vm` shapes the available API but is not a security sandbox; OMP's child is a failure boundary, not hostile-code containment, and future native DSH execution is same-process. Definitions and running state do not survive owner replacement, Runtime Session disposal, child/process restart, or host restart and never write the preset, patches, repository, configuration, or durable state.

Install the canonical cross-host development Skill at project scope:

```bash
npx skills add bamanoz/doppelganger \
  --skill doppelganger-runtime-plugin-development \
  --agent universal --copy -y
```

Invoke it through the host's native syntax:

```text
OMP: /skill:doppelganger-runtime-plugin-development <temporary runtime behavior>
DSH: /doppelganger-runtime-plugin-development <temporary runtime behavior>
```

The Skill grants no execution authority. Every `runtime-plugin.run` call still requires its own host approval. See [`docs/features/dynamic-runtime-plugins.md`](docs/features/dynamic-runtime-plugins.md) for the complete lifecycle, catalog, limits, failure, and host-projection contract.

### Permanent plugin development

Use the canonical cross-host workflow when a maintained Doppelganger plugin must survive Runtime Sessions and process restarts, ship as installable package source, or expose a Loader entry. Install it at project scope:

```bash
npx skills add bamanoz/doppelganger \
  --skill doppelganger-plugin-development \
  --agent universal --copy -y
```

This creates `.agents/skills/doppelganger-plugin-development/`, which compatible OMP and DSH hosts discover from the same project copy. Invoke it through the host's native syntax:

```text
OMP: /skill:doppelganger-plugin-development <permanent plugin request>
DSH: /doppelganger-plugin-development <permanent plugin request>
```

Before any file or planning mutation, the Skill requires an explicit implementation location: the current repository chosen explicitly, a named existing repository with its concrete path, or a new repository at a user-selected local path. It then restarts discovery in that repository, follows its package and planning conventions, inspects current Cordis and Doppelganger contracts, and verifies package contents, public exports, disposable-consumer installation, Loader activation when applicable, behavior, and cleanup. It does not infer ownership from `cwd`, require OpenSpec outside repositories that own that workflow, promote Dynamic Runtime Plugin state, publish, release, create a remote, commit, push, or mutate a deployment without separate direction.

### Persona evolution review

The canonical cross-host skill is authored at `skills/persona/doppelganger-persona-evolution/SKILL.md`. Install it into a project root shared by OMP and DSH:

```bash
npx skills add bamanoz/doppelganger \
  --skill doppelganger-persona-evolution \
  --agent universal --copy -y
```

This creates `.agents/skills/doppelganger-persona-evolution/`. Use project scope: the current CLI's global `universal` destination is not a user root shared by both hosts.

Invoke the same skill through each host's native syntax:

```text
OMP: /skill:doppelganger-persona-evolution review
DSH: /doppelganger-persona-evolution review
```

Append `--dry-run` to inspect evidence and display the complete proposed replacement without calling `persona.revise`. A normal review inspects `trait:evolving-profile`, accepts only an explicit user request or consistent durable observations across sessions, excludes user facts/preferences and task-local instructions, preserves unrelated trait meaning, and submits at most one complete replacement.

The skill itself has no write authority. `persona.revise` accepts only a configured logical target and exact inspected revision; OMP projects it as `doppelganger_persona_revise`, while DSH preserves `persona.revise`. Every call requires a separate one-shot native approval showing the exact arguments. Rejection, cancellation, unavailable approval, conflict, candidate rejection, or HMR timeout ends the review without retry. Success is reported only after exact-revision HMR confirmation; candidate failure or timeout restores the previous bytes.

Persona Authoring has no persistent proposal or revision history. An atomic rename followed by a process crash can leave unconfirmed candidate bytes on disk; inspect the current revision and recover from the user-owned preset's backup or version control. Never bypass the logical tools with direct file editing as part of the review workflow.

### Evolution proposals

Add Evolution only to an editable user Runtime Preset that already composes session-isolated Runtime Session, actor, Persona, SQLite, context, and tool services. Shipped `standard` deliberately omits it:

```yaml
- id: doppelganger-evolution
  name: "@doppelganger/doppelganger-evolution"
  inject:
    - doppelgangerRuntimeSession
    - doppelgangerActor
    - doppelgangerPersona
    - doppelgangerInstanceSqlite
    - doppelgangerContext
    - doppelgangerTools
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerActor: session
    doppelgangerPersona: session
    doppelgangerInstanceSqlite: session
    doppelgangerContext: session
    doppelgangerTools: session
    doppelgangerEvolution: session
  config:
    namespace: evolution
    remindersEnabled: true
    reminderCooldownDays: 7
    projectLockTimeoutMs: 2000
    proactiveSignalsEnabled: true
    signalInferenceEnabled: false
```

Deterministic capture observes only completed committed turns and correlated tool outcomes, persists bounded credential-screened signal state, and may create only ordinary inert `proposed` records after at least three distinct capability turns or three distinct Persona sessions. Set `proactiveSignalsEnabled: false` for the previous proposal-only behavior. Inference, research, review, planning, implementation, and execution never start from capture alone.

Inference-assisted extraction is a separate network/cost opt-in. Place one provider before Evolution, then add `doppelgangerInference` to the Evolution row's `inject` and `isolate` maps and set `signalInferenceEnabled: true`:

```yaml
- id: doppelganger-inference-pi
  name: "@doppelganger/doppelganger-inference-pi"
  isolate:
    doppelgangerInference: session
  config:
    provider: openai
    model: gpt-5
    apiKeyEnv: OPENAI_API_KEY
```

The provider/model pair must exist in the installed Pi catalog unless the row explicitly defines an OpenAI-compatible `baseUrl` together with the model's `modelContextWindow`; credentials must never be embedded in that URL. A configured credential environment variable is resolved per call and fails without ambient fallback; omitting `apiKeyEnv` deliberately permits provider-owned ambient authentication. The adapter disables SDK retries, never executes the returned result tool call, and returns only schema-validated JSON. Exact limits and optional reasoning levels are documented in [`docs/features/evolution.md`](docs/features/evolution.md).

The feature exposes exactly `evolution.propose`, `evolution.list`, `evolution.inspect`, `evolution.transition`, `evolution.snooze`, `evolution.reject`, and `evolution.reminder.record`. These tools mutate only an inert proposal ledger. Global proposals are partitioned by Persona Instance and bound actor in plugin-owned SQLite. Project capability proposals are canonical Git-visible YAML under `<workspaceRoot>/.doppelganger/evolution/opportunities/`; do not place secrets in them.

Persona proposals require explicit review consent before invoking the existing Persona evolution skill. Use `review <proposal-id>` only after selecting that proposal; a successful `persona.revise` application then marks it done. Capability proposals require separate research consent. Install the repository-owned capability workflow at project scope:

```bash
npx skills add bamanoz/doppelganger \
  --skill doppelganger-capability-evolution \
  --agent universal --copy -y
```

Invoke it through the host's native syntax:

```text
OMP: /skill:doppelganger-capability-evolution <proposal-id>
DSH: /doppelganger-capability-evolution <proposal-id>
```

The skill grants no executor or planning authority. It inspects the selected proposal, researches current primary sources only after explicit consent, records bounded options, waits for explicit selection, records the chosen mechanism as `selected`, and stops. It does not choose a repository or package, create an OpenSpec change or implementation plan, write implementation instructions, or execute the mechanism. Dynamic Runtime Plugins remain session-only trusted generated code with separate native approvals. A later permanent-package request uses `doppelganger-plugin-development`, whose explicit implementation-location gate runs before any repository mutation. Host plugins remain reserved for genuine host surfaces. See [`docs/features/evolution.md`](docs/features/evolution.md) for lifecycle, storage, reminders, reload, rollback, and omission behavior.

The Loader entrypoints validate bounded configuration. Memory owns retrieval limits (`lexicalTopK`, `semanticTopK`, `semanticQueryMaximumCharacters`, `semanticTimeoutMs`); the local embedder accepts `model`, `cacheDir`, `offline`, `device`, `batchSize`, `maximumCharacters`, and `acquisitionTimeoutMs`. The coordinator accepts `instanceId`, `pollIntervalMs`, `batchSize`, `maximumAttempts`, `retryBaseMs`, and `operationTimeoutMs`. SQLite exact requires `databasePath` (absolute) and `dimensions`; `namespace`, `sanitizedTarget`, and `busyTimeoutMs` are optional. Backend dimensions must equal the selected embedder dimensions. The example's explicit limits are safe bounded starting points, not universal performance claims; tune them from representative retrieval and latency measurements.

Server backends are explicit alternatives, never fallbacks selected by the host. Chroma uses a server endpoint plus non-secret tenant/database/collection namespaces and an optional token environment-variable name. Qdrant uses a server URL, non-secret collection namespace, and an API-key environment-variable name. pgvector uses an environment-variable name whose value is the PostgreSQL DSN; never place resolved credentials in the Loader row.

Endpoints and namespaces must be sanitized, non-secret labels. Environment-variable references are resolved by the selected backend at activation; credential values are excluded from generation fingerprints, health, errors, and Runtime Session metadata.

Portable server rows use Loader-compatible backend subpaths and contain references, not resolved credentials:

```yaml
# Select exactly one backend row. All examples match EmbeddingGemma q8/384.
- id: vectors-chroma
  name: "@doppelganger/doppelganger-memory-vectors/chroma"
  isolate: { doppelgangerMemoryVectorIndex: session }
  config:
    endpoint: https://chroma.internal.example
    dimensions: 384
    namespace: assistant-prod.embeddinggemma-q8-384
    tenant: doppelganger
    database: personas
    collection: memory
    tokenEnv: DOPPELGANGER_CHROMA_TOKEN
    sanitizedTarget: chroma:production

- id: vectors-qdrant
  name: "@doppelganger/doppelganger-memory-vectors/qdrant"
  isolate: { doppelgangerMemoryVectorIndex: session }
  config:
    url: https://qdrant.internal.example
    dimensions: 384
    namespace: assistant-prod.embeddinggemma-q8-384
    apiKeyEnv: DOPPELGANGER_QDRANT_API_KEY
    sanitizedTarget: qdrant:production

- id: vectors-pgvector
  name: "@doppelganger/doppelganger-memory-vectors/pgvector"
  isolate: { doppelgangerMemoryVectorIndex: session }
  config:
    dsnEnv: DOPPELGANGER_PGVECTOR_DSN
    dimensions: 384
    namespace: assistant-prod.embeddinggemma-q8-384
    sanitizedTarget: pgvector:production
    connectionTimeoutMs: 5000
    poolSize: 4
```

Each selected backend row still requires the local embedder and semantic coordinator rows in the same Runtime Preset; these alternatives replace only the vector-backend row. Environment-variable names are portable authored configuration, while deployments provide their values out of band.

### Semantic model cache and offline operation

The local embedder is lazy: no ONNX/tokenizer work occurs when its row is absent, and the first embedding request acquires the pinned model revision into `cacheDir` (default `~/.cache/doppelganger/models`). The default EmbeddingGemma profile validates the q8 `onnx/model_quantized.onnx` pair and emits 384-dimensional normalized vectors. Acquisition is bounded by `acquisitionTimeoutMs`; artifacts are checked against pinned size and SHA-256 metadata. A missing artifact with `offline: true` reports `OFFLINE_MODEL_UNAVAILABLE`; a corrupt artifact reports `CORRUPT_CACHE`. A cache containing only the legacy q4 files is not a valid q8 cache. These failures leave canonical writes and lexical FTS5 recall available. To prepare an offline deployment, warm the exact configured model/revision online, preserve its cache directory, validate one real embedding, then deploy that directory with `offline: true`.

`device` is operational rather than part of vector-space identity. An unavailable accelerator falls back to CPU without allowing vectors from a different model space. Changing the pinned model, revision, artifact digest, pooling, projection, normalization, metric, or dimensions requires a new generation. Existing EmbeddingGemma q4/256 projections are incompatible derived data and must be rebuilt from canonical memory; they are never resized into q8/384 vectors.

### Backend prerequisites and scale

| Backend | Prerequisite | Search/operations profile |
| --- | --- | --- |
| `sqlite_exact` | Writable local filesystem; no server | Exact cosine scan and transactional writes. Predictable default for small and moderate Persona indexes; scan cost grows linearly with indexed vectors. |
| `chroma` | Reachable Chroma **server** | Server-managed collections and filters. There is no embedded Node mode; plan server backup, availability, and collection lifecycle. |
| `qdrant` | Reachable Qdrant service | Cosine collections, payload filters, and server-side scaling; operate snapshots/replication outside Doppelganger. |
| `pgvector` | PostgreSQL with the `vector` extension | Exact cosine by default; shared SQL operations and backups. HNSW build/reindex is explicit maintenance for scale and adds index-build/write cost. |

Choose from measured record count, latency, durability, and service-operating requirements. SQLite exact avoids infrastructure but is not an ANN design. Remote services add network latency and outage modes; semantic deadlines contain those failures and lexical recall continues.

### Generation operations, health, and deletion

Vector data is a derived, non-authoritative projection. Canonical SQLite owns records, current revisions, eligibility, receipts, conflicts, FTS5, generation pointers, projection work, and opaque deletion tombstones. Semantic hits are identifiers only and are revalidated against canonical partition, scope, status, time, active generation, record, and current revision before ranking.

A model or backend swap creates a new generation from deterministic canonical pages; it never overwrites, resizes, or copies the active vector space in place. Verify identity and indexed/current/missing/stale counts, then let the coordinator switch the canonical active-generation pointer atomically. An interrupted build fails candidate activation, leaves the previous runtime/generation active, and remains retryable from canonical state. SQLite exact and Qdrant bind dimensions to a namespace or collection, so a q4/256-to-q8/384 deployment must use a new non-secret namespace such as `aiden-prod.embeddinggemma-q8-384`; Chroma isolates generations by collection and pgvector includes dimensions in its storage identity. The immediate fallback is to remove/disable the coordinator, embedder, and backend rows, restoring lexical-only operation without changing canonical memory. Returning to q4/256 requires restoring the previous release/configuration and rebuilding its configured generation; `memory.semantic.rollback` never crosses incompatible vector spaces.

Semantic status exposes only the backend kind, sanitized target, active generation, embedder identity, supported maintenance, indexed/current/stale/missing counts, pending upserts/deletes, and bounded last-failure code/time. Treat increasing missing or pending-upsert counts as projection lag; stale counts as superseded projection cleanup; and pending deletes as remote cleanup debt. Maintenance is serialized and backend-declared: SQLite supports compaction, pgvector can explicitly build/reindex HNSW, and generation cleanup removes only retained derived data.

The coordinator registers four host-projected operator tools when the semantic stack is active: `memory.semantic.status` reports the sanitized state above; `memory.semantic.rebuild` builds and atomically activates the configured generation; `memory.semantic.rollback` activates a named retained compatible generation; and `memory.semantic.maintenance` runs one backend-declared operation (`build-index`, `cleanup-generation`, `compact`, or `reindex`). Rebuild, rollback, and maintenance failures return the stable `SEMANTIC_OPERATION_FAILED` tool error without backend exception text or credentials. Use status before and after an operation; concurrent maintenance reports `already-running` rather than overlapping work.

Hard deletion makes canonical content invisible immediately, removes local derived content, and leaves only identifier-only remote tombstones until delivery succeeds. During a remote outage, stale hits cannot resurrect deleted content because canonical revalidation rejects them. Restore the backend and let the coordinator retry; investigate persistent pending-delete counts and the sanitized failure category without deleting tombstones or reintroducing deleted content manually.

### Design provenance

The backend matrix and operational emphasis were inspired by MemPalace. Doppelganger is an independent TypeScript implementation against its own Cordis and canonical-memory contracts; no substantial MemPalace implementation text was copied, so no foreign license text is incorporated here.

## Memory behavior

Memory is an optional actor-aware plugin, not a kernel service.

- `remember` creates active memory in the bound `(Persona Instance, host actor)` partition.
- Capture creates review candidates only and is disabled by default.
- Candidates never enter recall before manual approval or policy-based corroboration.
- Project memory is further limited by project; relationship memory follows the bound actor and Persona Instance.
- Memory tools expose no actor selector and reject `actorId` and the removed `principalId` alias.
- Missing host actor identity fails memory activation before canonical storage opens; actor-independent presets remain valid.
- Mutations use stable operation IDs for idempotent delivery.
- Corrections create immutable revisions with compare-and-swap protection.
- Evidence, conflicts, receipts, full-text rows, and embeddings participate in hard deletion.
- Credentials, private keys, and common token formats are rejected.

The bundled deterministic capture extractor accepts explicit durable-memory syntax in committed principal input:

```text
[fact:project.runtime.transport] The runtime uses framed JSON-RPC.
[preference:preference.response.verbosity] Prefer concise answers.
```

This syntax is intentionally conservative. Alternative extractors can implement the same plugin contract without changing the memory service.

## Current boundary

The completed OMP milestone proves one portable Persona Definition across the generic runtime and the transported OMP host, including persistence, candidate capture, lifecycle transport, dynamic tools, hot reload, optional Dynamic Runtime Plugins, and optional Evolution proposals/reminders. The direct OpenClaw adapter reuses the same Runtime Preset and protocol layers with a deliberately narrower prepared-catalog and empty-lifecycle profile and is certified against the installed `openclaw@2026.9.1` build `ad6fe23`. DeepSeek Harness is still the next deferred host integration and should reuse the same definitions and feature plugins without duplicating Persona or Evolution logic.
