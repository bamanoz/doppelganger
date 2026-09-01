# Doppelganger documentation

This tree is the navigation root and authoritative description of the currently implemented system. Start here before changing architecture or behavior.

## Documentation map

| Area | Document | Owns |
| --- | --- | --- |
| Architecture | [System overview](architecture/overview.md) | Product boundary, canonical terms, package topology, governing invariants |
| Architecture | [Composition and reload](architecture/composition-and-reload.md) | Runtime Preset roster/service, roots/trust, copy-only authoring, patches, Runtime Sessions, activation, rollback, disposal, and feature-coordinated HMR |
| Architecture | [Extension protocols](architecture/protocols.md) | Context, tools, required approval, lifecycle events, and the host seam |
| Features | [Persona](features/persona.md) | Persona Activation, identity, traits, scoped authoring, evolution workflow, and standard-versus-Mark composition boundary |
| Features | [Memory](features/memory.md) | Canonical memory, candidates, retrieval, mutations, and semantic contracts |
| Hosts | [Oh My Pi](hosts/oh-my-pi.md) | OMP pure-roster activation, child process, RPC, context/tool/approval projection, and failure behavior |
| Hosts | [DeepSeek Harness](hosts/deepseek-harness.md) | Deferred host, mandatory source-research gate, planned approval projection, and current Agent Skill discovery seam |
| Operations | [Configuration](operations/configuration.md) | Doppelganger home, ordered roots/trust, selection/defaults, copy-only authoring, logical writable policy, project layout, and patch order |
| Operations | [Semantic memory](operations/semantic-memory.md) | Embedder, vector backends, generations, health, credentials, and recovery |
| Operations | [Verification](operations/verification.md) | Repository checks, Persona evolution skill smokes, and opt-in real-backend coverage |
| Modes | [Focused specs](modes/focused-specs.md) | Product-boundary specification shape, executable evidence, and review criteria |
| Project | [Status and scope](project/status-and-scope.md) | Implemented milestone, acceptance criteria, deferred scope |
| Audits | [2026-08-30 system audit](audits/2026-08-30-system-audit.md) | Evidence, risks, and recommended follow-up work |

## Source-of-truth rules

- `docs/` describes the current implemented architecture, behavior, operations, and scope.
- `README.md` owns onboarding, setup, and concise usage examples; it links here for detailed contracts.
- `AGENTS.md` owns durable instructions for coding agents, not product status.
- `scripts/package-boundaries.json` is the sole executable source for allowed workspace-package dependency edges; architecture documents explain their intent without copying the edge table.
- `openspec/specs/` and active `openspec/changes/` own requirement-level change workflow. They must be reconciled with this tree before a change is archived.
- `openspec/changes/archive/` is historical evidence, not current documentation.
- A disagreement between current docs, active OpenSpec requirements, code, tests, or executable repository manifests is a defect. Do not choose one silently; resolve the disagreement in the same change.

## Maintenance contract

Every behavior, architecture, configuration, protocol, lifecycle, persistence, or operational change must update all affected documents in this tree in the same change. Add new documents to this index, remove obsolete links during clean cutovers, and keep one owning document per topic rather than copying normative text across files.
