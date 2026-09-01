# Doppelganger

Doppelganger is a portable extension runtime for AI-agent environments, built on [Cordis](https://github.com/cordiverse/cordis). It activates composable runtime definitions inside agent sessions and projects their context, tools, lifecycle events, and persistent state into a host.

Persona is the first product layer built on the runtime. It is composed from ordinary Cordis plugins rather than encoded as a fixed model in the kernel.

> Status: experimental, private workspace. The authoritative Runtime Preset roster and OMP vertical slice are implemented; the DeepSeek Harness host is deferred.

## What it provides

- Isolated runtime session and Cordis plugin tree per agent session.
- Declarative composition with transactional hot reload and rollback.
- Ordered `system`/`user` Runtime Preset roots, a shipped actor-neutral `standard` default, copy-only authoring, and an optional Cordis roster service.
- Host-neutral context, tool, and lifecycle protocols.
- Persona identity and ordered traits as portable plugins.
- Optional logical-target Persona inspection and one-shot approved trait revision with exact-byte CAS and HMR-confirmed rollback.
- SQLite-backed, partitioned canonical memory with immutable revisions and provenance.
- Explicit active memory and optional candidate capture as separate write paths.
- Independent FTS5 and optional semantic top-K retrieval, deterministic reciprocal-rank fusion, canonical revalidation, temporal eligibility, and hard budgets.
- A versioned framed JSON-RPC bridge for Oh My Pi (OMP).
- Dynamic OMP tools translated from runtime JSON Schemas.

Doppelganger does **not** implement an agent loop or model provider. It extends an existing host.

## Requirements

- Node.js 26 or newer
- npm
- OMP 18.x for the host integration

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
├── extension-protocols Context, tools, and normalized lifecycle contracts
├── extension-persona   Persona activation metadata, identity, traits, and Loader root
├── extension-persona-authoring  Logical inspection and approved exact trait revision
├── extension-sqlite    Directly loadable SQLite infrastructure
├── extension-memory    Canonical memory, lexical/hybrid retrieval, tools, capture, and semantic contracts
├── extension-embedding-local  Lazy EmbeddingGemma/MiniLM Loader plugin and validated model cache
├── extension-memory-vectors   Semantic coordinator and SQLite/Chroma/Qdrant/pgvector Loader backends
├── host-omp            Generic OMP adapter, child runtime, and framed RPC transport
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
                             serialized activation
                                        │
                                        ▼
                           isolated Runtime Session
                                        │
                             ┌──────────┼──────────┐
                             ▼          ▼          ▼
                          context      tools    lifecycle
                             │          │          │
                             └──── generic host bridge ────┘
```

Core concepts:

- **Composition Definition** — a complete, portable Cordis Loader tree with opaque plugin configuration.
- **Runtime Preset** — a complete, self-contained Cordis Loader tree in one directory under an ordered `system` or `user` root.
- **Runtime Preset roster** — deterministic multi-root discovery, health, selection, copy/remove authoring, and deployment-default policy outside Runtime Sessions.
- **Runtime Patch** — an optional Cordis Include patch list layered over the selected preset.
- **Runtime Session** — one isolated activation inside one host agent session.
- **Persona Instance** — optional identity and state lineage owned by Persona extensions, not by the kernel or host.

The kernel knows composition, isolation, diagnostics, reload, and teardown. It does not know what Persona, identity, traits, memory, actors, storage, context, or tools mean. The protected host bridge may bind one immutable actor identity and projects standard protocols only when the selected composition provides them; an empty Runtime Preset is valid.

## Local OMP installation and dogfooding

The private workspace package `@doppelganger/doppelganger-omp` is the local OMP install unit. Link it through OMP's normal plugin registry, then start OMP from a workspace outside this repository to avoid also discovering the repository-local extension:

```bash
omp plugin link ./packages/omp
DOPPELGANGER_HOME=/absolute/path/to/a/new-home omp --cwd /absolute/path/outside/doppelganger
```

With no authored selection and no `DOPPELGANGER_ACTOR_ID`, the linked plugin activates the shipped actor-neutral `standard` Runtime Preset. The package entrypoint supplies no repository path, actor, Persona, or named Runtime Preset default.

The home path may be absent before launch. The first Runtime Preset selection creates `config.yaml`, an empty editable `runtime.cordis.patch.yml`, and `.runtime-presets/`. The shipped `standard` tree stays in the installed package, like DSH profile bundles; copy it to a new user preset ID only when you want an independently editable preset.

Repository Mark dogfooding uses the project-local `.omp/extensions/doppelganger.ts`, which is only a default re-export from that same package entrypoint. Supply the development home and actor binding explicitly from the repository root:

```bash
DOPPELGANGER_HOME="$PWD/dev/doppelganger" \
DOPPELGANGER_ACTOR_ID=valera \
omp
```

A non-interactive Mark smoke uses the same environment:

```bash
DOPPELGANGER_HOME="$PWD/dev/doppelganger" \
DOPPELGANGER_ACTOR_ID=valera \
omp -p --no-session "Reply with exactly DOPPELGANGER_SMOKE_OK and do not use tools."
```

The extension starts one child runtime for the OMP session, appends assembled runtime context to each model turn, and exposes available runtime tools with the `doppelganger_` prefix.

## Runtime Preset configuration

The runtime home resolves from an explicit host option, then `DOPPELGANGER_HOME`, then `~/.doppelganger`. The default roster searches the package-owned shipped root, any configured roots in order, then `$DOPPELGANGER_HOME/.runtime-presets`. Each root has `system` or `user` trust; the first occupied ID wins even when broken. User selection contains no Persona or plugin settings:

```yaml
# dev/doppelganger/config.yaml
version: 1
defaultRuntimePreset: mark
```

Without a higher-precedence selection, the normal package/OMP deployment activates the shipped actor-neutral `standard` preset. Hosts may explicitly configure a defaultless roster when inactive behavior is required.

A Runtime Preset is a complete Cordis Loader tree plus adjacent owned assets. Plugin configuration and persistence ownership stay in that tree:

```yaml
# dev/doppelganger/.runtime-presets/mark/runtime.cordis.yml
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
    instanceId: mark
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
# .doppelganger/manifest.yaml
version: 1
runtimePreset: mark
```

Selection precedence is explicit host/session choice, nearest project `runtimePreset`, user `defaultRuntimePreset`, then the roster's optional deployment default (`standard` in the normal deployment). A selected missing or broken preset fails visibly and never falls through. A defaultless roster can yield inactive state. The nearest `.doppelganger/manifest.yaml` is found while walking from the working directory to the Git root.

Optional patch files use Cordis Include patch syntax and apply in this order:

```text
$DOPPELGANGER_HOME/runtime.cordis.patch.yml
<project>/.doppelganger/runtime.cordis.patch.yml
explicit host patches
protected runtime-owned host bridge
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

### Active local Mark preset

`mark` is the checked-in development Runtime Preset selected by both the development home and this repository. It is distinct from the shipped `standard` preset: `standard` contains generic Persona identity/traits plus context and tools, while `mark` additionally composes personal identity, Persona Authoring, SQLite, memory, embedding, and semantic retrieval. Mark composes, in the same session isolation realm:

1. context, tools, Persona identity, and ordered traits, including `trait:evolving-profile`;
2. `@doppelganger/doppelganger-persona-authoring`, with only `trait:evolving-profile` writable;
3. SQLite-owned canonical memory with lexical retrieval;
4. `@doppelganger/doppelganger-embedding-local` with pinned q8 `embeddinggemma-300m` and normalized 384-dimensional Matryoshka output;
5. `@doppelganger/doppelganger-memory-vectors/sqlite-exact` with an absolute plugin-owned database path, a Mark-specific q8/384 namespace, and the same 384 dimensions;
6. `@doppelganger/doppelganger-memory-vectors` as the coordinator after memory, embedder, and index are available.

The preset does not compose the capture plugin, so candidate capture remains disabled. Persona identity plus the `engineer` and `concise` traits remain read-only; omission of Persona Authoring leaves every Persona asset read-only. Presets that omit all three semantic rows remain valid and lexical-only. `all-MiniLM-L6-v2` remains an explicit 384-dimensional compatibility selection through the embedder row's `model` field; it is not an alias for EmbeddingGemma and produces a distinct semantic generation.

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

The skill itself has no write authority. `persona.revise` accepts only a configured logical target and exact inspected revision; OMP projects it as `doppelganger_persona_x2e_revise`, while DSH preserves `persona.revise`. Every call requires a separate one-shot native approval showing the exact arguments. Rejection, cancellation, unavailable approval, conflict, candidate rejection, or HMR timeout ends the review without retry. Success is reported only after exact-revision HMR confirmation; candidate failure or timeout restores the previous bytes.

Persona Authoring has no persistent proposal or revision history. An atomic rename followed by a process crash can leave unconfirmed candidate bytes on disk; inspect the current revision and recover from the user-owned preset's backup or version control. Never bypass the logical tools with direct file editing as part of the review workflow.

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
    namespace: mark-prod.embeddinggemma-q8-384
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
    namespace: mark-prod.embeddinggemma-q8-384
    apiKeyEnv: DOPPELGANGER_QDRANT_API_KEY
    sanitizedTarget: qdrant:production

- id: vectors-pgvector
  name: "@doppelganger/doppelganger-memory-vectors/pgvector"
  isolate: { doppelgangerMemoryVectorIndex: session }
  config:
    dsnEnv: DOPPELGANGER_PGVECTOR_DSN
    dimensions: 384
    namespace: mark-prod.embeddinggemma-q8-384
    sanitizedTarget: pgvector:production
    connectionTimeoutMs: 5000
    poolSize: 4
```

Each selected backend row still requires the local embedder row and coordinator row shown by `mark`; these alternatives replace only the SQLite exact row. Environment-variable names are portable authored configuration, while deployments provide their values out of band.

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

The completed milestone proves one portable Persona Definition across the generic runtime and the OMP host, including persistence, candidate capture, lifecycle transport, dynamic tools, and hot reload. A native DeepSeek Harness host is the next integration milestone; it should reuse the same definitions and feature plugins without duplicating persona logic.
