# Agent host extension surfaces

This source study compares the extension seams of ten coding-agent hosts and derives a portable Doppelganger host API. Each row remains research evidence rather than support proof; OpenClaw's later implementation and installed-Gateway certification are recorded separately.

## Snapshot

Comparative research date: September 3, 2026. The separate OpenClaw adapter investigation is dated September 5, 2026.

| Host | Source revision | Native extension model | Doppelganger status |
| --- | --- | --- | --- |
| [Codex](codex.md) | `4fdf4c11131ec901a303f68e5ad8962469697bb6` | Typed Rust contributor registry plus a separate hook engine | Researched |
| [Claude Code](claude-code.md) | `aef74afe01f65b602258d6102b0da9730ac6f0aa` | Declarative plugin package, hooks, commands, agents, skills, and MCP | Researched |
| [OpenCode](opencode.md) | `68abdce1a092e6302e99c2821a76071ee998d8f2` | Scoped Effect domains plus a legacy hook API | Researched |
| [OpenClaw](openclaw.md) | historical `fc895e4f00ce2a54b1ebd83deeb30d75bfde4922`; adapter study `837e0b20f479f4fa060bd7a2d50112e279103fb8` | Guarded synchronous native registration over immutable discovery snapshots | Adapter certified against installed `2026.9.1` build `ad6fe23` |
| [Hermes Agent](hermes-agent.md) | `5f24f291c2a99640ee695079ed1a62b6ed5c8a51` | Native Python plugins, shell hooks, and Agent Plugins/MCP translation | Researched |
| [DeepSeek Harness](deepseek-harness.md) | `4e84901e6471b79ec0338099867ebb4606d12bb5` | Native Cordis scopes, typed prompt/tool/lifecycle services | Designed in active OpenSpec |
| [Gemini CLI](gemini-cli.md) | `55b495d6db1794bf5b7f37a9bc03ebcab5103673` | Extension manifests, fixed hooks, MCP, agents, and memory files | Researched |
| [Goose](goose.md) | `0f7d763b3f5ee6d2f12c7f997b5bed9f5aa7f205` | MCP clients, compile-time platform extensions, and plugin hooks/skills | Researched |
| [Pi](pi.md) | `4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057` | In-process TypeScript Extension API | Researched |
| [Oh My Pi](oh-my-pi.md) | `39cf639c7bb6b5014a1cc8ea8175558cccb23905` | In-process TypeScript Extension API | Implemented |

## Comparative findings

The hosts do not share a plugin packaging model. They do share four semantic seams:

1. a host-owned session identity and scope;
2. model-facing context contribution before a request;
3. named JSON-schema tools with host-owned policy and execution lifecycle;
4. session, turn, tool, compaction, and disposal observations.

Those are already Doppelganger's actor, context, tool, and lifecycle protocols. The study does not justify a generic host object or a mirror of any native extension API.

| Host | Request-time context | Dynamic tools | Exact one-shot approval | Lifecycle source | High-fidelity integration path |
| --- | --- | --- | --- | --- | --- |
| DeepSeek Harness | Awaited prompt waterfall | Scoped registration | Native audited `allowed-once` gate | Durable Session log | Direct in-process Cordis adapter |
| Oh My Pi | Per-turn system-prompt override | Runtime registration and active-set replacement | Native write-tier prompt | Live extension events plus committed message boundaries | Existing per-session Node child adapter |
| Pi | Per-request context/provider transforms | Runtime registration/replacement | Native UI confirmation can host the gate | Live extension events | Per-session Node child adapter |
| OpenCode | Context epochs and legacy prompt transforms | Scoped Effect registrations | Permission ask/reply service | Durable and live event service | Native plugin with a sidecar runtime |
| OpenClaw | Typed prompt hooks on the supported embedded route | Prepared contract-checked session-start registrations | Native exact allow-once/deny hook | No portable lifecycle kinds advertised | Direct in-process native plugin with plugin-owned Composition Runtime |
| Hermes Agent | Session prompt sections and tool hooks | Native plugin reload ledger | Central fail-closed approval service | Hook events with session/turn/call IDs | Native Python plugin with a Node sidecar |
| Codex | Typed thread/turn contributors | Registry contributions and MCP snapshots | Approval review contributor or hook policy | Typed thread/turn/tool contributors | Native Rust integration; hooks/MCP are partial |
| Goose | Prompt manager and platform extension access | MCP cache refresh; platform registry is static | Permission manager and elicitation | Hooks plus persisted session data | Native platform extension; MCP alone is partial |
| Gemini CLI | Fixed before-model/tool hooks and refreshed memory context | Extension/MCP restart and refresh | Host consent and approval mode | Hook and AgentProtocol streams | Host extension bridge; exact parity needs behavioral proof |
| Claude Code | Session/user-prompt hook context only in the inspected tree | MCP configuration is restart-bound | PreToolUse hook decisions | Process hooks | Hooks plus MCP sidecar; partial semantics only |

A cell describes the strongest source-verified seam, not guaranteed adapter behavior. Every concrete adapter still needs behavioral tests against the host.

## Decision: keep the portable API small

The portable Runtime Preset API remains capability-specific:

- `doppelgangerActor` provides one immutable host-authoritative actor binding;
- `doppelgangerContext` resolves ordered, authority-labelled contributions under a hard token budget at each model-request boundary;
- `doppelgangerTools` provides qualified JSON-schema tools, structured results, dynamic registration, and immutable required-approval metadata;
- normalized lifecycle events publish bounded, correlated host facts without exposing native event objects.

No new portable protocol was justified by the study. The protected Runtime Host bridge is now implemented in `extension-protocols` and is the adapter-facing API. It exposes correlated context resolution, immutable revisioned catalog snapshots and invocation, exact approval and cancellation, declared lifecycle publication, and the single runtime-to-host catalog revision signal. Runtime plugins see only portable protocol services; adapters see only the protected bridge; neither side receives a raw host runtime.

### Required adapter invariants

Every adapter, direct or transported, must:

1. capture one immutable native session identity, workspace snapshot, and actor binding;
2. own one independent Runtime Session plugin tree for that binding;
3. serialize activation, projection replacement, lifecycle publication, and disposal;
4. resolve context at every native model-request boundary and never persist projected context as host conversation history;
5. validate a complete tool projection before commit, replace it exactly, and reject retained stale closures;
6. treat portable `approval.policy === "required"` as a minimum: only one explicit grant for the exact call may dispatch it;
7. leave a required tool unavailable when the host cannot guarantee that approval contract;
8. publish the strongest committed lifecycle facts the host actually owns and omit unsupported events instead of inventing them;
9. contain adapter failure to the owning native session where the host architecture permits it;
10. exhaustively dispose projected registrations, Runtime Session work, watchers, and transports.

Optional protocols remain optional. A host that cannot provide lifecycle, context, or tools may still activate compositions that do not require them.

## Adapter families

### Direct native Cordis

Use when the host owns a compatible Cordis root or the native plugin can own one without a second transport. Activate the Composition Runtime below the native agent context and bind the protected bridge directly. OpenClaw now follows this model with one plugin-owned root and isolated Runtime Sessions; the planned DeepSeek Harness adapter would instead reuse the host-owned Cordis scope. Neither case reuses standing plugin objects as mutable Runtime Sessions.

### Native extension plus sidecar

Use when the host has an in-process extension API but not a compatible host-owned or plugin-owned Cordis root. The native extension owns session hooks and projections; one Node child owns each Runtime Session. Oh My Pi already follows this model. Pi, OpenCode, and Hermes Agent remain plausible candidates, subject to host-specific behavioral proof.

Do not extract a generic sidecar package before implementing a second sidecar adapter. The OMP transport is one adapter, so a shared transport seam is still hypothetical.

### Upstream-native integration

Use when the high-fidelity extension registry is statically composed into a non-TypeScript host. Codex's typed Rust registry and Goose's platform-extension registry fit this category. An MCP server alone can project tools, but it cannot reproduce all prompt, lifecycle, approval, and session ownership semantics observed in those hosts.

### Hybrid hooks plus MCP

Use only as an explicitly partial adapter where no native registration seam is available. Claude Code is the clearest case in the inspected source. Hooks can translate selected lifecycle and policy events, while MCP supplies tools, but the adapter must not claim per-request context, exact dynamic replacement, or committed-turn parity without direct behavioral evidence.

## Implemented and planned extension surfaces

### Host-specific runtime hooks and services

The common lifecycle protocol remains the portable event vocabulary. A host adapter may additionally install a protected, namespaced Cordis bridge for native extension points that have no honest cross-host equivalent. The adapter translates the native hook or capability into a host-specific event or service; an explicitly host-specific Runtime Preset plugin may consume it through normal Cordis injection and effects.

For example, OMP carries its implemented `todo-reminder` event over the existing per-session transport without adding that event to the portable lifecycle protocol. A Runtime Preset that requires a host-only event is intentionally host-bound and must fail or degrade explicitly when the capability is absent. Native payloads still cross a validated JSON-compatible boundary, registrations dispose with the owning Runtime Session, and portable plugins never receive the raw host runtime.

Do not promote a host-native extension point into a shared protocol merely because another host has a similarly named hook. Introduce a narrow optional portable protocol only after multiple adapters demonstrate matching ownership, timing, correlation, failure, and disposal semantics.

### Generic MCP client plugin

The host-neutral `extension-mcp` Cordis Loader plugin now makes configured external MCP servers part of a portable Runtime Preset. MCP server configuration belongs to Doppelganger rather than to OMP, OpenClaw, DSH, or another host. `startupMode` defaults to background and may be set to strict `await-ready` for a fresh initial apply; host adapters still receive only ordinary portable tool descriptors and invocations.

Each discovered MCP tool becomes an ordinary `doppelgangerTools` registration, for example a `read_file` tool from a configured `filesystem` server may become canonical `mcp-filesystem.read-file`. Host adapters receive only the resulting portable tool descriptors and invocations: OMP projects dynamic additions through its generic catalog path, OpenClaw exposes only names present in its prepared native artifact, a future Claude adapter may use its supported transport, and DSH remains a planned native projection. Host adapters do not launch the underlying MCP servers, interpret their configuration, or need to know that a tool originated from MCP.

Internal MCP operations such as `tools/list` and `tools/call` are implementation details of `extension-mcp`; the plugin should not expose one generic model-facing `mcp.call` dispatcher when concrete discovered tools can be registered with their own names and schemas. MCP resources, prompts, sampling, elicitation, roots, and arbitrary metadata do not automatically map to context, approval, or other Doppelganger protocols. Add those only through separately designed capabilities with matching authority and lifecycle semantics.

### Explicitly excluded from this plan

- Commands are not a Doppelganger extension surface; reusable workflows are distributed as portable Agent Skills.
- Doppelganger-specific skills continue to be distributed independently through `skills.sh`, not through Runtime Presets.
- Native agents and subagents remain host-owned. Static agent definitions or host-specific invocation services may exist in an adapter package, but no portable agent registry, delegation protocol, or agent loop is planned.

## Capabilities deliberately excluded

The following surfaces are common but semantically incompatible across hosts and have no current portable Doppelganger feature requiring them:

- arbitrary user dialogs, forms, widgets, notifications, and terminal UI;
- commands, keybindings, renderers, composer modes, and host navigation;
- provider/model registration, authentication, request headers, and sampling controls;
- subagent creation, delegation, teams, background sessions, and session scheduling;
- raw message, prompt, tool-input, or tool-output rewriting;
- filesystem fallbacks, shell environment mutation, and host configuration editing;
- plugin marketplace, installation, update, and trust-policy management;
- raw host event buses, internal state stores, gateway objects, and sandbox handles.

These remain host-native. If a portable feature later needs one, it should introduce a narrow optional protocol after two adapters demonstrate equivalent semantics.

## Deferred candidate

One cross-host need remains outside the portable protocol:

- **Structured user elicitation.** Goose, OMP, Pi, Gemini CLI, and MCP expose forms or prompts, but identity, persistence, timeout, and approval semantics differ. Required tool approval must not be generalized into an unrestricted UI protocol.

Tool cancellation is no longer deferred: the Runtime Host API carries call-correlated cancellation with explicit settlement and disposal semantics, and each adapter advertises whether it supports that capability.

## Consequences

- Existing Runtime Presets remain host-neutral.
- The current protocol package is the stable plugin-facing interface; host packages own translation and capability absence.
- DeepSeek Harness can proceed with the shared direct bridge without waiting for a larger abstraction.
- Future adapters can choose direct, sidecar, upstream-native, or explicitly partial integration without changing feature plugins.
- Native extension breadth is not a reason to enlarge the kernel. Portability comes from preserving the small semantic intersection and failing visibly where a host cannot satisfy it.
