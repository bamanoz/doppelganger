# Doppelganger documentation

This tree is the navigation root and authoritative description of the currently implemented system. Start here before changing architecture or behavior.

## Documentation map

| Area | Document | Owns |
| --- | --- | --- |
| Architecture | [System overview](architecture/overview.md) | Product boundary, canonical terms, package topology, governing invariants |
| Architecture | [Composition and reload](architecture/composition-and-reload.md) | Runtime Preset roster/service, roots/trust, copy-only authoring, patches, Runtime Sessions, activation, rollback, disposal, feature-coordinated HMR, and background versus strict initial external-service readiness |
| Architecture | [Host Extensions](architecture/host-extensions.md) | Versioned exact-host definitions, trusted catalogs and selections, closed session facts, protected composition, replacement, and one-binding/one-transport ownership |
| Architecture | [Extension protocols](architecture/protocols.md) | Actor Identity states, context, provider-neutral structured inference, revisioned tools, approval/cancellation, lifecycle events, the closed Runtime Host API, fixed/dynamic adapter profiles, conformance, and typed host-specific extensions |
| Features | [Persona](features/persona.md) | Persona Activation, identity, traits, scoped authoring, evolution workflow, and generic composition boundaries |
| Features | [Dynamic Runtime Plugins](features/dynamic-runtime-plugins.md) | Opt-in generated Cordis plugins, inspection, immutable Packages, approval, lifecycle, limits, and host projection |
| Features | [CodeGraph](features/codegraph.md) | Optional workspace-bound CodeGraph tools, freshness, subprocess bounds, lifecycle, compatibility, and trust boundary |
| Features | [Evolution](features/evolution.md) | Optional proposal ledger, state machines, storage, controls, reminders, consent, and executor boundaries |
| Features | [MCP tool import](features/mcp-tool-import.md) | Runtime Preset-owned MCP transports, operator-owned acquisition, background-default or strict initial startup, discovery, naming, invocation, approval, refresh, reload, diagnostics, trust, and disposal |
| Features | [Memory](features/memory.md) | Canonical repository authority and schema lifecycle, actor/scope policy, async reads and mutations, candidates, retrieval, and semantic contracts |
| Features | [Runtime logging](features/runtime-logging.md) | Default-off Cordis log routing, operational event vocabulary and component coverage, bounded session records and sink queues, rolling JSONL files, opt-in activation retention and ownership coordination, private Sentry delivery, reload/disposal, and host neutrality |
| Hosts | [Oh My Pi](hosts/oh-my-pi.md) | OMP pure-roster activation, child process, RPC, context/tool/approval projection, and failure behavior |
| Hosts | [OpenClaw](hosts/openclaw.md) | Native preparation and installation, finite catalog, host configuration, identity, context/tool/approval projection, restart boundary, trust, and disposal |
| Hosts | [DeepSeek Harness](hosts/deepseek-harness.md) | Deferred host, mandatory source-research gate, planned approval projection, and current Agent Skill discovery seam |
| Research | [Agent host extension surfaces](research/host-extension-surfaces/README.md) | Source-pinned host capability evidence, comparative portability boundary, adapter families, and deferred protocol candidates |
| Research | [Codex extension surface](research/host-extension-surfaces/codex.md) | Source-pinned Codex contributor, context, tool, approval, lifecycle, state, reload, and trust evidence |
| Research | [Claude Code extension surface](research/host-extension-surfaces/claude-code.md) | Source-pinned Claude Code plugin, hook, MCP, command, agent, skill, settings, and trust evidence |
| Research | [OpenCode extension surface](research/host-extension-surfaces/opencode.md) | Source-pinned OpenCode scoped-plugin, host façade, tool, permission, lifecycle, and state evidence |
| Research | [OpenClaw extension surface](research/host-extension-surfaces/openclaw.md) | Historical comparative source evidence, separate adapter-target build/source pins, implementation boundary, and installed-Gateway certification |
| Research | [Hermes Agent extension surface](research/host-extension-surfaces/hermes-agent.md) | Source-pinned Hermes native-plugin, hook, tool, approval, lifecycle, state, and Agent Plugin evidence |
| Research | [DeepSeek Harness extension surface](research/host-extension-surfaces/deepseek-harness.md) | Source-pinned DSH Cordis boot, scope, prompt, tool, approval, lifecycle, runner, and package evidence |
| Research | [Gemini CLI extension surface](research/host-extension-surfaces/gemini-cli.md) | Source-pinned Gemini extension, memory, MCP, hook, consent, lifecycle, trust, and agent evidence |
| Research | [Goose extension surface](research/host-extension-surfaces/goose.md) | Source-pinned Goose MCP, platform-extension, plugin-hook, approval, lifecycle, state, and trust evidence |
| Research | [Pi extension surface](research/host-extension-surfaces/pi.md) | Source-pinned Pi Extension API, context, provider, tool, approval, lifecycle, state, and reload evidence |
| Research | [Oh My Pi extension surface](research/host-extension-surfaces/oh-my-pi.md) | Source-pinned OMP native API evidence and current Doppelganger adapter mapping |
| Operations | [Configuration](operations/configuration.md) | Doppelganger home, ordered roots/trust, host-specific selection and identity, OpenClaw preparation/runtime options, canonical memory provider setup and offline transfer, copy-only authoring, logical writable policy, project layout, and patch order |
| Operations | [Semantic memory](operations/semantic-memory.md) | Derived embedder/vector composition, generations, health, credentials, and recovery |
| Operations | [Verification](operations/verification.md) | Repository checks, mandatory canonical PostgreSQL gate, adapter/native-host evidence, Persona evolution skill smokes, and independently optional real semantic-backend coverage |
| Modes | [Focused specs](modes/focused-specs.md) | Product-boundary specification shape, executable evidence, and review criteria |
| Project | [Status and scope](project/status-and-scope.md) | Implemented milestones, certification state, acceptance criteria, and deferred scope |
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
