## Why

AI-agent extensions are currently tied to individual hosts or reduced to static prompt files, which prevents one stateful composition from operating consistently across environments. Doppelganger needs a small Cordis-native runtime foundation that first proves useful persona continuity in Oh My Pi while preserving a direct path to native DeepSeek Harness integration.

## What Changes

- Add a generic Cordis Agent Runtime that activates independent Loader trees per agent session under a supplied or standalone Cordis context.
- Add transport-neutral context, tool, and lifecycle-event protocol plugins for communication between feature plugins and host adapters.
- Add a persona composition built from ordinary Cordis plugins for identity, ordered traits, context assembly, storage, and memory.
- Add persistent global and project memory with explicit writes, candidate review and promotion, revision-preserving correction, hard deletion, pinning, FTS5 retrieval, and an optional embedding-provider seam.
- Add an Oh My Pi adapter that runs one Node child runtime per agent session over framed JSON-RPC/stdio and projects context, tools, and lifecycle events.
- Add transactional profile/plugin hot reload with rollback and deterministic teardown.
- Require a source-grounded DeepSeek Harness architecture study before implementation choices are finalized.

## Capabilities

### New Capabilities

- `runtime-kernel`: Cordis context ownership, session-scoped Loader activation, diagnostics, hot reload, rollback, and disposal.
- `extension-protocols`: Host-neutral context providers, tool registry/invocation, and normalized Cordis lifecycle events.
- `persona-composition`: Portable persona definitions and instances composed from identity, traits, protocols, and persistent plugin state.
- `persona-memory`: Global/project memory scopes, lifecycle, retrieval, provenance, corrections, candidates, and maintenance tools.
- `hosts/oh-my-pi`: OMP discovery, child-runtime lifecycle, JSON-RPC projection, failure isolation, and live tool/profile updates.

### Modified Capabilities

None.

## Impact

- Introduces TypeScript/Node packages based on `@deepseek-ai/cordis` and the matching DeepSeek Harness Loader family.
- Introduces SQLite-backed user state under `~/.doppelganger/` and committed project configuration under `.doppelganger/manifest.yaml`.
- Introduces a user-level Oh My Pi extension and a session-owned Node child process.
- Establishes contracts intended for a later native DSH host without adding a second DI, plugin, lifecycle, or capability framework.
