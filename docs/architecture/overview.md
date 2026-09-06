# System overview

## Product boundary

Doppelganger is a portable Cordis extension runtime for AI-agent hosts. It activates user-authored plugin compositions inside isolated host sessions and projects optional context, revisioned tools, declared lifecycle events, provider-neutral structured inference, and plugin-owned persistent behavior through one shared Runtime Host API plus trusted host-owned Host Extensions.

Doppelganger does not implement an agent loop or expose a general model API. Persona, memory, Evolution, CodeGraph code intelligence, Dynamic Runtime Plugins, MCP tool import, and one-shot structured-inference providers are optional extension layers, not kernel concepts.

## Canonical terms

- **Composition Definition** — a complete portable Cordis Loader entry tree with opaque plugin configuration.
- **Runtime Preset** — a complete Composition Definition stored as one self-contained directory under an ordered Runtime Preset root; the directory name is its stable ID.
- **Runtime Patch** — a Cordis Include patch list layered over one selected Runtime Preset. It is not independently selectable.
- **Runtime Session** — one isolated activation of an effective Composition Definition inside one host agent session.
- **Persona Definition** — a Composition Definition or plugin configuration that composes Persona extensions.
- **Persona Instance** — extension-owned stable identity and persistent-state lineage. The kernel neither selects it nor assigns its storage.
- **Persona Session** — a Runtime Session whose selected composition explicitly includes Persona extensions.
- **Actor binding** — an optional immutable host-authoritative user identity exposed through a session-isolated protocol service. It is separate from Persona identity and authored composition.
- **Evolution proposal** — an extension-owned, durable, non-executing record of a user-directed Persona or capability improvement opportunity, with exact revision and immutable decision history.
- **Runtime Preset root** — an absolute directory configured with `system` or `user` trust. Roots are searched in order, and the first occupied preset ID wins even when that winner is broken.
- **Runtime Preset roster** — the control-plane service that owns roots, deterministic discovery, health, display metadata, selection, copy-only authoring, and deployment default policy outside activated Runtime Sessions.
- **Runtime Host API** — the actor-neutral protected per-session bridge, immutable semantic capability profile, and correlated context/tool/lifecycle operations shared by every supported host adapter. Adapters may advertise different honest profiles, such as OMP dynamic tools and OpenClaw's prepared `session-start` catalog.
- **Host Extension** — one API-versioned definition for an exact host kind, admitted and selected through trusted host-native configuration, then instantiated as a fresh protected Cordis entry from closed immutable session facts.
- **Structured Inference** — an optional session-scoped service for one bounded system instruction, untrusted input string, portable JSON output schema, optional token cap and cancellation signal, returning only validated JSON plus bounded usage.
- **Canonical memory repository** — a session-isolated actor-bound provider for authoritative records, revisions, eligibility, lexical retrieval, receipts, projection work, and schema lifecycle. SQLite and PostgreSQL implement the same memory-owned contract; semantic vector indexes remain derived.

Identity content alone does not establish technical continuity. Stable Persona identity and state lineage belong to the extension that implements them; persistent actor-aware state additionally requires a bound host actor.

## Package topology

The workspace is layered around a small generic kernel:

- `runtime-presets`, `extension-protocols`, and `extension-sqlite` are independent foundation packages;
- `runtime-presets` exposes one pure Node roster API plus an optional Cordis service facade and ships the actor-neutral `standard` preset;
- `extension-protocols` owns context, revisioned tools, approval/cancellation, lifecycle, independent Actor Identity, provider-neutral structured inference, the closed Runtime Host API, and its transport-independent adapter conformance suite;
- `composition-runtime` owns generic Loader activation, one validated final protected composition, public host-neutral definition canonicalization, patches, sessions, the default-silent session logging router, reload beneath the immutable protected layer, and disposal; serialized OMP activation decoding belongs to `host-omp/src/contracts.ts`, not the generic kernel;
- `host-extension-runtime` owns versioned exact-host definitions, immutable explicit catalogs, normalized ordered plans, standard Runtime Host and Actor Identity definition builders, closed fact admission, and fresh per-session protected-entry instantiation; it performs no package discovery or native-host access;
- `extension-inference-pi` is an optional leaf adapter from the structured-inference protocol to an explicitly configured Pi SDK provider/model snapshot; it depends only on `extension-protocols` and does not expose the host agent loop;
- `extension-memory` owns the backend-neutral canonical repository contract, actor/scope policy, asynchronous memory service, canonical schema lifecycle, lexical retrieval, and shared semantic-projection state; its SQLite and PostgreSQL Loader subpaths provide `doppelgangerMemoryRepository` without exposing SQL outward;
- `extension-memory-vectors` implements derived SQLite exact, Chroma, Qdrant, and pgvector indexes plus the coordinator. Canonical PostgreSQL and optional pgvector are independent roles even when deployed on the same server;
- Persona, scoped Persona Authoring, memory, local embedding, vector backends, Dynamic Runtime Plugins, Evolution, structured-inference providers, CodeGraph, MCP import, and the independent file/Sentry logging exporters are optional extension layers;
- Dynamic Runtime Plugins add an opt-in session-owned generated Cordis plugin workflow; generated code is trusted process code and never a kernel or host responsibility;
- Evolution adds an opt-in actor-partitioned proposal ledger, lifecycle-driven bounded signal discovery, policy context, portable controls, and relevant cooled-down reminders without executor authority;
- CodeGraph adds opt-in workspace-bound graph context through two portable tools and a bounded standalone-process adapter; it does not add a kernel service or host-specific route;
- `extension-mcp` connects to configured external MCP servers and atomically imports their tools into the portable registry; its startup policy belongs to the Loader row, while native hosts receive only the resulting portable catalog;
- repository-owned Agent Skills under `skills/` teach cross-host workflows but grant no runtime authority; permanent plugin development is ownership-gated and begins only after the user explicitly selects the implementation repository;
- `host-omp` depends only on generic composition, Host Extension, protocol, and Runtime Preset seams, transports the shared bridge and typed OMP event extension over one child connection, and remains Persona-, storage-, Evolution-, inference-provider-, CodeGraph-, MCP-, and generated-plugin-neutral;
- `host-openclaw` is a direct in-process adapter and preparation package. It owns its Composition Runtime root, selects presets through the same roster, packages an explicit prepared Host Extension module set separately from the finite tool catalog, registers only prepared native names, and remains feature-neutral; it does not reuse OMP transport or consume the planned DeepSeek Harness host scope.

The authoritative allowed internal dependency edges live in `scripts/package-boundaries.json`. `scripts/check-package-boundaries.mjs` validates the manifest schema, requires every workspace package to be registered, and uses the repository's TypeScript AST traversal to inspect imports, side-effect and type-only imports, re-exports, and literal dynamic imports. Named package subpaths resolve to their owning workspace package; cross-package relative imports are rejected while legal intra-package relative imports remain valid. Comments and ordinary strings do not create edges, and computed dynamic imports remain outside this static policy. Architecture prose explains the intended layering without maintaining a second executable edge table.

Canonical providers and embedding/vector implementations depend inward on memory-owned contracts. The memory service, semantic coordinator, generic runtime, tools, and hosts receive no SQL handle or provider client. Canonical correctness and concurrency live in database transactions and durable instance-generation then actor-partition locking, not a retained process identity map.

## Kernel responsibilities

The generic runtime:

- uses a supplied Cordis Context or creates a standalone root;
- creates an independent Cordis plugin tree per Runtime Session;
- activates one complete Loader tree plus ordered patches;
- activates one validated host-owned protected composition after every authored layer;
- exposes immutable session ID, Runtime Preset ID, and optional absolute workspace root;
- audits activation and reports source-labelled diagnostics;
- serializes hot reload and rolls invalid generations back;
- disposes owned fibers, effects, watchers, and roots deterministically;
- installs one bounded session logging router before authored plugins while leaving every exporter-omitting composition destination-silent;
- never writes normalized effective state back to authored files.

The kernel does not interpret Persona, identity, traits, memory, actors, storage, project identity, context content, tool semantics, CodeGraph indexes, generated Package source or version state, embeddings, vectors, or concrete hosts.

## Plugin model

Every extension is a native Cordis plugin. Required services use `inject`; optional services enable controlled degradation; shared session services use matching Loader `isolate` realms. Duplicate providers in one realm fail rather than being selected by load order. Portable definitions do not branch on host identity. Provider substitution occurs by composing a different implementation of the same service, never by adding provider selection to the kernel or host bridge.

Protocol and feature plugins are explicitly composed. Empty Runtime Presets and absent context, tool, lifecycle, Actor Identity, structured inference, Persona, memory, embedding, vector, Dynamic Runtime Plugin, Evolution, CodeGraph, MCP, or logging exporter services are valid. Trusted Host Extension definitions are installed and selected separately from Runtime Presets, receive only closed host facts, and instantiate fresh protected entries per Runtime Session. Runtime-owned host-specific services are typed, namespaced siblings of the shared bridge and reuse the adapter's one binding or transport; they never expose a raw host runtime or create a second native-host channel. Adapter fidelity is declared rather than inferred: OpenClaw currently publishes per-turn context, prepared session-start tools, required approval, and cancellation, but no standard lifecycle events or arbitrary generated native names. Runtime logging remains process-local Cordis output rather than a host protocol.

## Governing principle

> Build a small generic Cordis kernel and a portable extension ecosystem. Persona is the first useful bundle over that kernel, not an ontology embedded in core.
