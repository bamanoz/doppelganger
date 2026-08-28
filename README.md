# Doppelganger

Doppelganger is a portable extension runtime for AI-agent environments, built on [Cordis](https://github.com/cordiverse/cordis). It activates composable runtime definitions inside agent sessions and projects their context, tools, lifecycle events, and persistent state into a host.

Persona is the first product layer built on the runtime. It is composed from ordinary Cordis plugins rather than encoded as a fixed model in the kernel.

> Status: experimental, private workspace. The OMP vertical slice is implemented; the DeepSeek Harness host is deferred.

## What it provides

- Isolated runtime session and Cordis plugin tree per agent session.
- Declarative composition with transactional hot reload and rollback.
- Host-neutral context, tool, and lifecycle protocols.
- Persona identity and ordered traits as portable plugins.
- SQLite-backed, partitioned memory with immutable revisions and provenance.
- Explicit active memory and optional candidate capture as separate write paths.
- FTS5 retrieval, deterministic hybrid ranking, temporal eligibility, and hard budgets.
- A versioned framed JSON-RPC bridge for Oh My Pi (OMP).
- Dynamic OMP tools translated from runtime JSON Schemas.

Doppelganger does **not** implement an agent loop or model provider. It extends an existing host.

## Requirements

- Node.js 24 or newer
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
```

`npm run check` runs every workspace typecheck and test, verifies that one Cordis installation is used, and checks package boundaries.

## Repository layout

```text
packages/
├── composition-runtime   Generic composition, activation, sessions, and reload
├── extension-protocols   Context, tools, and normalized lifecycle contracts
├── extension-persona     Persona selection, activation metadata, identity, and traits
├── extension-sqlite      Instance-owned SQLite infrastructure
├── extension-memory      Memory service, retrieval, tools, and candidate capture
├── preset-aiden          Example Persona Definition and activation resolver
└── host-omp              OMP extension, child runtime, and framed RPC transport

.omp/extensions/          Project-local OMP bootstrap
dev/doppelganger/         Development user config and Persona Instances
.doppelganger/            Project persona selection
```

Coding agents should start with [`AGENTS.md`](./AGENTS.md). The authoritative behavioral and architectural contract is [`SPEC.md`](./SPEC.md); [`CONTEXT.txt`](./CONTEXT.txt) records the earlier design discussion.

## Runtime model

```text
Persona Definition + Persona Instance + host selection
                         │
                         ▼
              serialized activation
                         │
                         ▼
             isolated Runtime Session
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           context      tools    lifecycle
              │          │          │
              └──────── host adapter ┘
```

Core concepts:

- **Runtime Definition** — portable Cordis Loader tree and assets.
- **Persona Definition** — a Runtime Definition composed from persona plugins.
- **Persona Instance** — stable instance identity, selected definition, settings, and persistent state.
- **Runtime Session** — one isolated activation inside one host agent session.

The kernel knows composition and lifecycle. It does not know what identity, traits, or memory mean.

## Local OMP smoke

The repository contains a project-local extension at `.omp/extensions/doppelganger.ts`. It resolves the development Aiden instance from `dev/doppelganger/config.yaml`; `.doppelganger/manifest.yaml` selects Aiden and its project traits.

From the repository root:

```bash
omp
```

The extension starts one child runtime for the OMP session, appends assembled persona context to each model turn, and exposes available runtime tools with the `doppelganger_` prefix.

A non-interactive smoke run:

```bash
omp -p --no-session "Reply with exactly DOPPELGANGER_SMOKE_OK and do not use tools."
```

## Configuration

Development user selection:

```yaml
# dev/doppelganger/config.yaml
version: 1
principalId: local-user
defaultInstance: aiden
instances:
  aiden: instances/aiden/instance.yaml
```

Persona Instance:

```yaml
# dev/doppelganger/instances/aiden/instance.yaml
version: 1
id: aiden
definition: ../../../../packages/preset-aiden/definition/persona.yaml
settings:
  memoryCapture:
    enabled: false
```

Project selection:

```yaml
# .doppelganger/manifest.yaml
version: 1
projectId: example-project
instanceId: aiden
traits:
  - engineer
  - concise
```

The nearest `.doppelganger/manifest.yaml` is selected while walking from the working directory to the Git root. Without a project manifest, the configured global instance may still activate.

## Memory behavior

Memory is an optional plugin, not a kernel service.

- `remember` creates active, principal-directed memory.
- Capture creates review candidates only and is disabled by default.
- Candidates never enter recall before manual approval or policy-based corroboration.
- Project memory is partitioned by project; relationship memory follows the principal and Persona Instance.
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
