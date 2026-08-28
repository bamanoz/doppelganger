## Context

See `proposal.md` for motivation and the capability specs for behavior. The repository has no implementation yet. The design must preserve Cordis semantics from the cloned DeepSeek Harness rather than wrapping Cordis in a second framework.

DeepSeek Harness is the architectural reference because its vendored `@deepseek-ai/cordis` fork hardens Fiber lifecycle, Loader updates, isolation, activation audit, and teardown beyond upstream Cordis. Oh My Pi is the first product host, but it runs extensions under Bun and exposes a different lifecycle surface. The first integration therefore needs a process seam without making that seam the runtime architecture.

## Goals / Non-Goals

**Goals:**

- Keep the kernel deep: one activation interface hides context ownership, Loader mounting, audit, reload, rollback, and disposal.
- Make ordinary Cordis plugins the only extension model.
- Keep persona semantics in explicit plugins and definitions.
- Make host integration replaceable without changing feature plugins.
- Prove continuity with one real persona in OMP before adding a second host.

**Non-Goals:**

- Abstract over Cordis or support multiple plugin kernels.
- Define a universal agent loop or model-provider interface.
- Provide autonomous generated-code execution or a security sandbox.
- Build a daemon, marketplace, or generalized RPC platform.
- Freeze physical package boundaries before the DSH research gate is complete.

## Decisions

### 1. Complete a DeepSeek Harness research gate before implementation

The first implementation task will map exact source paths and symbols for:

- `apps/cli/src/profile-boot.ts` and `packages/boot/app-boot/src/index.ts` boot flow;
- Loader tree import, `Entry` activation/update/rollback, and activation audit;
- `RegistryService`, `Fiber`, effects, service reflection, isolation, and disposal;
- DSH agent/session scopes and standing preset mounts;
- dynamic Cordis host/client runners and their explicit trusted-code model;
- package peer-dependency patterns that preserve one Cordis root.

The resulting architecture note must identify which DSH modules and semantics are reused and must validate the proposed runtime interface before production code or final package layout is created.

Alternative: design from public Cordis documentation. Rejected because DSH relies on fork-specific lifecycle and Loader behavior.

### 2. Use the DSH Cordis family directly

The standalone runtime will depend on the inspected compatible `@deepseek-ai/cordis` and Loader family. Packages that export Cordis plugins will declare Cordis as a peer supplied by the executable host; the executable will provide exactly one installation so native DSH integration cannot create a second root, Registry, or package identity.

Domain data and transport types will avoid exposing Cordis internals. Runtime plugins themselves remain native Cordis plugins. Exact inspected versions, duplicate-root hazards, and the selected initial package layout are recorded in `research/dsh-architecture.md`.

Alternative: add a custom `PersonaPlugin` interface. Rejected because it duplicates dependency injection, lifecycle, and configuration semantics already provided by Cordis.

Alternative: use upstream `cordis`. Rejected because it has a different package identity and lacks DSH lifecycle changes the project intends to reuse.

### 3. One independent plugin tree per agent session

`createRuntime({ context? })` owns a standalone root only when no context is supplied and reuses the supplied Context's Loader service when present. `runtime.activate(...)` creates a no-op owner Fiber as the session lifetime boundary, installs immutable activation metadata, mounts an independent per-session `Include` tree with namespaced Loader isolation realms, mounts the host plugin beside the definition, waits for settlement, audits required entries and root-realm service leaks, and returns a session handle only after the transaction succeeds.

The handle exposes only disposal and diagnostics. Loader watching and updates remain internal. Every session owns its Loader tree, fibers, and handlers. A Persona Instance is logical identity plus persistence, not a long-lived shared JavaScript object graph.

Alternative: one standing persona tree with child session scopes. Rejected for the first architecture because mutable plugin objects would be shared across concurrent hosts and process topologies.

### 4. Definitions use Cordis Loader trees

A Runtime Definition is Loader-native composition plus configuration and assets. Persona metadata identifies the stable instance and revision but does not introduce another plugin graph. Protocol plugins are explicit tree entries or a reusable Loader preset.

Project `.doppelganger/manifest.yaml` selects a project ID, Persona Instance, and optional ordered traits. User `~/.doppelganger/config.yaml` selects a global default. Persistent runtime data stays under the instance home rather than the repository.

Alternative: compile a custom Doppelganger manifest into a Loader tree. Rejected until a requirement appears that Loader configuration cannot express.

### 5. Protocol behavior lives in standard Cordis plugins

The kernel remains unaware of context, tools, and host events.

The context plugin provides a registry of providers. A provider returns structured chunks containing a stable source, content, priority, authority (`instruction` or `data`), and optional budget metadata. The assembler invokes providers for each turn, orders chunks deterministically, and trims them to the host budget. Identity and traits produce instruction chunks; ordinary memory produces data chunks; approved preferences may produce instruction chunks.

The tool plugin owns session-scoped definitions and provides transport-neutral `list` and `invoke` operations. Definitions use stable plugin-qualified names and serializable input/result contracts. Cordis lifecycle effects remove registrations when their owner unloads.

Host plugins emit normalized session, turn, and tool events through Cordis. Host-only operations are separate named services. Required services use Cordis `inject` and gate Fiber activation; optional services use `ctx.get(name)` and branch on `undefined`, because Cordis has no optional-injection declaration. No capability registry is added.

Alternative: put protocol types and registries in the kernel. Rejected because it would embed one model of agent effects in the generic lifecycle kernel.

### 6. OMP uses a thin native adapter and a Node child runtime

The OMP extension runs in-process only as a bridge. On session start it discovers the nearest manifest up to the Git root, resolves the global fallback when needed, and starts one Node child for that OMP session. The child creates the standalone Cordis root and runtime session.

The bridge uses LSP-style `Content-Length` framed JSON-RPC 2.0 over stdio so message content can contain arbitrary newlines. The initial method set is deliberately narrow:

```text
session.activate
session.dispose
context.resolve
tools.list
tools.invoke
event.publish
```

The child may notify `tools.changed`, `profile.changed`, and `runtime.failed`.

OMP `before_agent_start` requests current context and appends it to the existing system prompt. Late tool registration adds or refreshes proxy definitions. Because OMP has no `unregisterTool`, removed runtime tools are deactivated from the active presentation until session shutdown. Session, turn, and tool hooks publish normalized observations. Shutdown requests disposal and then terminates the owned child.

Alternative: run Cordis and its Loader inside the OMP Bun process. Rejected because the DSH Loader uses Node-oriented behavior and a failure would share OMP process authority.

Alternative: MCP stdio. Rejected for the first bridge because the host must push lifecycle and request context automatically; a narrow private protocol is smaller than adapting those semantics to MCP.

### 7. Host failures degrade to normal OMP

The adapter maintains explicit states: inactive, starting, active, failed, and disposed. Invalid configuration, child exit, protocol failure, or context projection failure moves the adapter to failed, removes persona context, deactivates persona tools, and reports a diagnostic. It does not terminate or block the OMP session.

No automatic child restart is attempted in the first milestone because reconstructing a partially observed runtime session would create ambiguous lifecycle semantics.

### 8. Storage is plugin-owned and SQLite-backed

A storage plugin allocates a separate SQLite database to each consuming plugin namespace. The memory plugin owns its schema and migrations. WAL mode and short transactions support concurrent session processes; revision and promotion operations use compare-and-swap conditions so conflicting updates return structured errors rather than silently overwriting.

The memory schema will represent:

- stable memory records with instance, kind, scope, status, pin state, and current revision;
- immutable revisions with content, supersession, timestamps, and provenance;
- candidate evidence keyed by distinct source session;
- FTS5 rows for active retrievable revisions;
- optional embedding rows owned by the memory plugin when a provider exists.

Hard deletion removes all rows and derived indexes for the record in one transaction.

Alternative: MemPalace as the authoritative store. Rejected for this milestone because its Python/MCP runtime lacks the required candidate lifecycle and general revision history, requiring a second source of truth.

### 9. Memory retrieval remains useful without embeddings

The memory plugin always installs FTS5 retrieval with scope and status filters. An optional embedding-provider Cordis service adds semantic candidates; lexical and semantic candidates are merged before ranking. The provider is a seam, not a first-milestone implementation.

Automatic recall receives the current user turn and a token budget. Pinned global preferences are considered first, then eligible global and current-project records. Other projects are excluded at query time, not filtered after retrieval.

### 10. Memory mutations preserve authority and provenance

Explicit user-directed writes become active immediately. Agent-inferred writes become candidates. Manual approval promotes a candidate. Automatic promotion requires the agent to link corroborating evidence from a distinct session and a transaction verifies distinct session IDs and absence of a recorded contradiction.

Corrections append a revision and atomically move the active pointer. Hard deletion is separate and explicit. Secret detection runs before both active and candidate writes and rejects detected credentials; it is a guardrail, not a claim of perfect secret classification.

Candidate extraction is an agent tool call made before the final response when appropriate. Shutdown does not invoke another model and does not persist transcripts by default.

### 11. Hot reload delegates lifecycle semantics to Loader

File/config watching detects definition and local plugin changes, but update, disposal, dependency gating, settlement, and rollback use the DSH Loader path established by the research gate. The runtime adds orchestration and diagnostics rather than reimplementing reload state transitions.

A successful profile update changes the next context resolution. A failed update keeps the last audited composition. Fiber-local state resets; SQLite-backed state survives.

## Risks / Trade-offs

- **[DSH fork drift]** The published Cordis family may diverge from the cloned DSH source. → Pin compatible versions, document inspected commits, and validate behavior against source before dependency upgrades.
- **[Duplicate Cordis copy]** A mountable module can accidentally create a second runtime root. → Use peer dependencies for host-mounted modules and test native mounting with one context identity.
- **[Hot-reload edge cases]** Watcher orchestration can race with disposal or another update. → Serialize session mutations and rely on Loader transactional rollback and quiescent Fiber disposal.
- **[OMP shutdown deadline]** OMP bounds shutdown handlers while storage may be busy. → Commit mutations during tool calls, keep disposal bounded, and hard-terminate the child after the graceful deadline.
- **[SQLite contention]** Concurrent persona sessions can update one instance database. → Use WAL, short transactions, busy timeouts, and conflict-aware revision operations.
- **[Protocol drift]** OMP-specific details can leak into feature plugins. → Keep wire messages in the adapter/host plugin and test feature plugins against a host-neutral harness.
- **[Trusted plugin code]** Cordis plugins have process authority. → Treat installed plugins as trusted; generated-code isolation remains explicitly deferred.
- **[Recall quality]** FTS5 may miss paraphrases before an embedding provider exists. → Preserve the provider seam and explicit search while accepting lexical-only first-milestone quality.

## Migration Plan

This is a new system with no existing runtime data to migrate.

1. Complete and review the DSH research gate.
2. Introduce the runtime and protocol plugins behind standalone tests.
3. Add persona and memory plugins with a disposable test instance home.
4. Install the OMP adapter explicitly for development and run the vertical acceptance scenarios.
5. Roll back by disabling the OMP extension and removing generated development state; project manifests and persona definitions remain ordinary files.
