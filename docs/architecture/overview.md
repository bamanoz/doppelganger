# System overview

## Product boundary

Doppelganger is a portable Cordis extension runtime for AI-agent hosts. It activates user-authored plugin compositions inside isolated host sessions and projects optional context, tools, lifecycle events, and plugin-owned persistent behavior through a host adapter.

Doppelganger does not implement an agent loop or model provider. Persona, memory, Evolution, and CodeGraph code intelligence are optional extension layers, not kernel concepts.

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

Identity content alone does not establish technical continuity. Stable Persona identity and state lineage belong to the extension that implements them; persistent actor-aware state additionally requires a bound host actor.

## Package topology

The workspace is layered around a small generic kernel:

- `runtime-presets`, `extension-protocols`, and `extension-sqlite` are independent foundation packages;
- `runtime-presets` exposes one pure Node roster API plus an optional Cordis service facade and ships the actor-neutral `standard` preset;
- `composition-runtime` owns generic Loader activation, patches, sessions, reload, and disposal;
- Persona, scoped Persona Authoring, memory, local embedding, vector backends, Dynamic Runtime Plugins, Evolution, and CodeGraph are optional extension layers;
- Dynamic Runtime Plugins add an opt-in session-owned generated Cordis plugin workflow; generated code is trusted process code and never a kernel or host responsibility;
- Evolution adds an opt-in actor-partitioned proposal ledger, policy context, portable controls, and relevant cooled-down reminders without executor authority;
- CodeGraph adds opt-in workspace-bound graph context through two portable tools and a bounded standalone-process adapter; it does not add a kernel service or host-specific route;
- repository-owned Agent Skills under `skills/` teach cross-host workflows but grant no runtime authority; permanent plugin development is ownership-gated and begins only after the user explicitly selects the implementation repository;
- `host-omp` depends only on generic composition, protocol, and Runtime Preset seams and remains Persona-, storage-, Evolution-, CodeGraph-, and generated-plugin-neutral.

The authoritative allowed internal dependency edges live in `scripts/package-boundaries.json`. `scripts/check-package-boundaries.mjs` validates the manifest schema, requires every workspace package to be registered, and rejects package-manifest dependencies or source imports that are not allowed there. Architecture prose explains the intended layering; it does not maintain a second executable edge table.

Embedding and vector implementations depend inward on memory-owned semantic contracts. Canonical memory and the generic runtime never import concrete embedder or vector implementations.

## Kernel responsibilities

The generic runtime:

- uses a supplied Cordis Context or creates a standalone root;
- creates an independent Cordis plugin tree per Runtime Session;
- activates one complete Loader tree plus ordered patches;
- exposes immutable session ID, Runtime Preset ID, and optional absolute workspace root;
- audits activation and reports source-labelled diagnostics;
- serializes hot reload and rolls invalid generations back;
- disposes owned fibers, effects, watchers, and roots deterministically;
- never writes normalized effective state back to authored files.

The kernel does not interpret Persona, identity, traits, memory, actors, storage, project identity, context content, tool semantics, CodeGraph indexes, generated Package source or version state, embeddings, vectors, or concrete hosts.

## Plugin model

Every extension is a native Cordis plugin. Required services use `inject`; optional services enable controlled degradation; shared session services use matching Loader `isolate` realms. Duplicate providers in one realm fail rather than being selected by load order. Definitions do not branch on host identity.

Protocol and feature plugins are explicitly composed. Empty Runtime Presets and absent context, tool, lifecycle, Persona, memory, embedding, vector, Dynamic Runtime Plugin, Evolution, or CodeGraph services are valid.

## Governing principle

> Build a small generic Cordis kernel and a portable extension ecosystem. Persona is the first useful bundle over that kernel, not an ontology embedded in core.
