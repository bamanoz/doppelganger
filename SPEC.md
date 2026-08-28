# Doppelganger Specification

Status: agreed scope before implementation.

`CONTEXT.txt` contains the discussion history. This document is the authoritative implementation scope.

## 1. Product

Doppelganger is a portable extension runtime for AI-agent environments, built on Cordis.

The foundation is a generic **Cordis Agent Runtime**. Persona is the first useful product layer over it, not an ontology embedded in the kernel.

```text
Cordis Agent Runtime
├── composition
├── session scopes
├── lifecycle and hot reload
├── host integration
└── extension protocols

Persona bundle
├── identity
├── traits
├── memory
└── other Cordis plugins
```

The runtime does not implement an agent/model loop. It extends an existing agent host.

## 2. Canonical terms

### Runtime Definition

A portable Cordis Loader tree with plugin configuration and assets.

### Runtime Session

One activation of a definition inside one agent session.

### Persona Definition

A Runtime Definition that composes persona-related plugins.

### Persona Instance

A stable instance ID, a Persona Definition revision, and persistent state.

### Persona Session

A Runtime Session activating one Persona Instance in a host agent session.

Identity content does not establish technical continuity. Stable instance identity and state lineage do.

## 3. Runtime Kernel

The kernel uses the DeepSeek Harness Cordis family, `@deepseek-ai/cordis`, and its Loader semantics.

Conceptual interface:

```ts
const runtime = createRuntime({ context })
const session = await runtime.activate({ definition, host, metadata })
await session.dispose()
```

The kernel owns these invariants:

- use a supplied host Cordis Context or create a standalone root;
- create an independent Cordis plugin tree for every agent session;
- activate a Cordis Loader tree;
- expose instance, session, project and path metadata in the session scope;
- audit activation and expose diagnostics;
- perform transactional hot reload with rollback;
- perform deterministic teardown.

The kernel does not know about persona, identity, traits, memory, storage, context projection, tools, model providers or concrete agent hosts.

Parallel sessions do not share mutable JavaScript objects, fibers or handlers. Definitions and persistent storage are the only shared state.

## 4. Plugin Model

Every extension is a native Cordis plugin. The project does not introduce a parallel `PersonaPlugin` framework.

- Dependencies use Cordis `inject`.
- Required services gate plugin activation.
- Optional services provide controlled degradation.
- Duplicate services in one isolation scope are activation errors.
- Loader updates use Cordis teardown, restart and rollback semantics.
- Portable plugins do not branch on host identity.
- No centralized capability enum is introduced.

A definition is a Cordis Loader tree. Protocol plugins are explicitly composed or included through a reusable preset; the kernel does not auto-mount them.

## 5. Standard Protocol Plugins

Protocol plugins provide a conventional integration language without expanding the kernel.

### Context

Feature plugins register scoped context providers. The assembler resolves providers for the current turn, orders their contributions and applies a token budget.

### Tools

Feature plugins register transport-neutral tool definitions. A registry exposes `list` and `invoke`; host plugins project these tools into their native environment.

Tool names are plugin-namespaced.

### Events

Host plugins emit normalized session, turn and tool lifecycle events through Cordis events.

Host-specific functionality may be exposed as optional Cordis services. External hosts expose such services through explicit RPC capabilities rather than leaking their raw runtime object.

A plugin can also define an entirely new internal subsystem through ordinary Cordis services. It only needs the standard protocols when it must affect the host agent.

## 6. Persona Layer

Persona functionality is implemented by ordinary plugins:

```text
identity
traits
memory
reflection
relationship
context assembler
```

The universal identity plugin consumes YAML/Markdown data and provides identity contributions. A concrete identity is configuration, unless it requires genuinely new executable behavior.

A Persona Definition contains no host plugin. The host adapter mounts the appropriate host plugin beside the persona tree during activation.

One Persona Instance may be activated concurrently in several hosts. Each activation has an independent tree and shares state only through persistence.

## 7. Infrastructure Plugins

Infrastructure is also plugin-owned:

- SQLite storage;
- embedding providers;
- model providers;
- future alternative storage implementations.

The SQLite storage plugin gives each consuming plugin its own database and schema ownership. Storage is not part of the kernel.

## 8. Host Integration

A host integration has two sides:

```text
native agent adapter <-> transport <-> runtime-side Cordis host plugin
```

The host plugin maps native lifecycle, context and tools to the standard protocol plugins.

### Oh My Pi — first host

- The OMP project extension owns persona selection and resolves a generic serialized activation descriptor.
- It looks for `.doppelganger/manifest.yaml` from the current directory up to the Git root; the nearest manifest wins.
- Without a project manifest it may activate the configured global persona.
- It starts one Node child runtime per OMP agent session.
- The bridge uses versioned, framed JSON-RPC over stdio.
- It translates runtime JSON Schemas into native OMP tool schemas, exactly refreshes dynamic proxies, projects persona context before model turns, and forwards bounded committed lifecycle events.
- Shutdown publishes session completion within a bound, requests Runtime Session disposal, escalates child termination when necessary, and reports the actual outcome.
- Runtime failure disables the persona for that OMP session and reports a visible diagnostic; OMP remains usable.
- Invalid project configuration behaves the same way.

### DeepSeek Harness — second host

DSH integration follows after the first milestone. It mounts the same definitions as native plugins under a host-owned Cordis Context. It must reuse the same feature plugins and persistent state without duplicating persona logic.

## 9. Project and User State

Project configuration lives in:

```text
<project>/.doppelganger/manifest.yaml
```

The committed manifest contains a stable project ID, selected Persona Instance and optional trait selection. Runtime state does not live in the repository.

User configuration and persona state live under a user-selected root; the conventional layout is:

```text
~/.doppelganger/
├── config.yaml
└── instances/<instance-id>/
    ├── instance.yaml
    └── storage/
```

`config.yaml` may select the global default persona. If no default exists, the OMP adapter remains inactive and exposes initialization through an agent tool.

## 10. First Persona Plugins

The first vertical slice composes:

- identity;
- ordered traits;
- context registry and assembler;
- tool registry;
- SQLite storage;
- memory.

### Memory behavior

- Memory remains a plugin; the kernel has no memory interface.
- Project scope is the default; relationship scope requires an explicit request.
- Pinned relationship preferences have instruction authority; other eligible records remain data and use retrieval.
- Automatic recall uses the current principal turn, temporal and partition eligibility, and a hard token budget.
- FTS5 is the baseline retriever. An optional asynchronous semantic provider is fused through deterministic reciprocal-rank fusion, then revalidated against current canonical state.
- Explicit `remember` requires a stable operation ID and subject key and creates active memory immediately.
- Automatically extracted information is stored as a review candidate and never changes authored identity or traits.
- Candidate capture is disabled by default, consumes committed turns only, rejects secrets/generated/recursive/trivial material, and deduplicates retries by lifecycle delivery identity.
- A candidate may be accepted manually or promoted after supporting observations from distinct sessions satisfy kind-specific evidence policy without unresolved contradictions or subject conflicts.
- Mutations are idempotent, retain bounded provenance evidence, and use compare-and-swap where an active revision may race.
- Corrections create immutable revisions and supersede the previous revision.
- Hard deletion removes the record, revisions, evidence, conflicts, receipts, full-text rows, and embeddings.
- Secrets, credentials, tokens and private keys are rejected.
- Full transcript storage is disabled by default.

First memory tools include:

```text
search, inspect, history
remember, correct, forget
candidate propose / list / approve / reject / corroborate
evidence list / observe
conflict list / resolve
pin / unpin
```

Candidate extraction is an optional plugin over bounded `turn-committed` events. The bundled deterministic extractor recognizes explicit durable-memory syntax; future model extractors can implement the same interface. Disposal and incomplete turns never trigger capture.

## 11. Hot Reload

Profile and plugin changes apply to the active Runtime Session.

- Profile changes affect the next model turn.
- Plugin reload resets fiber-local state.
- Persistent state survives through storage plugins.
- Failed activation restores the previous working plugin version.
- OMP can add or refresh proxy tools during a session; removed plugin tools are deactivated until session shutdown.

## 12. First Milestone Acceptance

The OMP vertical slice is complete when one real Persona Instance demonstrates all of the following:

1. Global preferences and project decisions survive process restart.
2. Project scopes do not leak into one another.
3. A correction supersedes the active value while retaining revision history.
4. Explicit and candidate memory follow their distinct write paths.
5. A candidate can be reviewed manually and promoted through two-session corroboration.
6. Relevant memory is recalled automatically and available through explicit search.
7. A profile change affects the next turn of the current session.
8. A valid plugin update reloads; an invalid update rolls back.
9. Runtime failure disables persona behavior without terminating OMP.

## 13. Deferred Scope

The first milestone excludes:

- plugin workshop and persona-generated extension workflow;
- DSH host implementation;
- marketplace and package distribution;
- a security sandbox for generated code;
- daemon, HTTP or MCP as the primary architecture;
- a bundled embedding provider;
- cross-persona memory sharing;
- blocking host-tool interception;
- a custom agent/model loop;
- identical behavior guarantees across different hosts.

After the OMP milestone, the next milestone is the native DSH host. The plugin workshop follows only after portability is demonstrated.

## 14. Mandatory DeepSeek Harness Research Gate

Implementation must not begin from assumed Cordis behavior. Before choosing package structure or writing runtime code, inspect the cloned DeepSeek Harness source and derive the design from its actual implementation.

The research must trace these paths to exact files and symbols:

1. CLI/profile boot into the root Cordis Context.
2. Loader import, entry activation, update and rollback.
3. Registry, Fiber lifecycle, effects and deterministic disposal.
4. Service reflection, required/optional injection and isolation scopes.
5. DSH agent/session scopes and standing preset mounts.
6. Dynamic Cordis host/client runners and their trust model.
7. Package and peer-dependency patterns used to avoid duplicate Cordis roots.

Completion criteria:

- the boot, activation, reload and teardown call paths are mapped;
- DSH-specific changes from upstream Cordis that affect this runtime are identified;
- reusable DSH packages and patterns are named explicitly;
- proposed kernel interfaces are checked against DSH lifecycle and scope semantics;
- the design introduces no second dependency-injection, plugin, lifecycle or capability framework beside Cordis.

DeepSeek Harness is the architectural reference, not code to copy blindly. Doppelganger should reuse its hardened Cordis semantics and patterns while keeping host-independent definitions usable outside DSH.

## 15. Governing Principle

> Build a small generic Cordis kernel and a portable extension ecosystem. Persona is the first useful bundle over that kernel, not an ontology embedded in core.
