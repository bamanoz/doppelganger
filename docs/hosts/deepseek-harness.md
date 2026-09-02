# DeepSeek Harness host

The native DeepSeek Harness (DSH) host is not implemented. Its research gate was revalidated against DSH commit `4e84901e6471b79ec0338099867ebb4606d12bb5` on September 1, 2026, and the active `add-deepseek-harness-host` change defines implementation against the actual host APIs. The host must activate the same Composition Definitions under a host-owned Cordis Context and reuse existing feature plugins and extension-owned persistent state without duplicating Persona logic.

## Mandatory research gate

Do not propose package structure or implement this host from assumed upstream Cordis behavior. Inspect the actual cloned DSH source and trace these paths to exact files and symbols:

1. CLI/profile boot into the root Cordis Context.
2. Loader import, entry activation, update, and rollback.
3. Registry, Fiber lifecycle, effects, and deterministic disposal.
4. Service reflection, required/optional injection, and isolation scopes.
5. Agent/session scopes and standing preset mounts.
6. Dynamic Cordis host/client runners and their trust model.
7. Package and peer-dependency patterns that prevent duplicate Cordis roots.

The completed gate established these implementation constraints:

- DSH supplies the single host-owned Cordis root, agent scopes, awaited prompt assembly, scoped native tool registry, committed Session log, and quiescent teardown;
- DSH now exposes centrally resolved prompt section/context ordering, but asynchronous Doppelganger context still belongs in the awaited `system-prompt/assemble` waterfall rather than synchronous providers;
- DSH's native ApprovalService grants only `allowed-once`, audits asks and outcomes inside the owning turn, supports `ask` and fail-closed `never` policy, and reports rejection, cancellation, or unavailable answerers distinctly;
- durable event identities use branded `SessionSeq`, while replay boundaries such as `firstLiveSeq` use distinct `SessionLogOffset` values; host lifecycle translation must not conflate them;
- the host injects the public `doppelgangerRuntimePresets` roster service, whose normal deployment selects shipped actor-neutral `standard` after explicit, project, and user-default precedence;
- an intentionally inactive DSH deployment configures that roster without a deployment default rather than adding a second host-local selection path;
- each DSH agent owns one caller-context Composition Runtime and Runtime Session; DSH standing preset plugin objects are not shared as mutable session trees;
- the protected context/tool/lifecycle/actor bridge is host-neutral and belongs in `extension-protocols`, while DSH projection remains in-process and uses no OMP child or RPC transport;
- the default DSH actor binding derives from its namespaced anonymous harness-home identity, with explicit unbound and trusted resolver modes;
- DSH scope routing and dynamic runners are trusted extension mechanisms, not security sandboxes;
- Doppelganger Dynamic Runtime Plugins are a separate portable Runtime Preset feature and must not route through `@deepseek-ai/dsh-cordis-host-runner`; the future product dependency closure must make their Loader package resolvable without making generic `host-dsh` depend on its semantics;
- the portable feature preserves progressive source-verified inspection, immutable Package versions, current/next transition state, guarded plain-JavaScript evaluation, and child-Fiber cleanup; generated code remains same-process trusted code under DSH, and every `runtime-plugin.run` call requires a separate portable one-shot approval regardless of DSH runner grants or Host-only execution;
- DSH already discovers project Agent Skills from `<projectRoot>/.agents/skills` and invokes a user-invocable skill with `/<skill-name> ...`; the repository-owned Persona evolution, runtime plugin development, and permanent plugin development skills can therefore use `/doppelganger-persona-evolution review`, `/doppelganger-runtime-plugin-development ...`, and `/doppelganger-plugin-development ...` independently of the deferred host adapter. Persona authoring and runtime-plugin controls still require compatible Doppelganger Runtime Presets; permanent plugin development uses ordinary repository tools only after its explicit implementation-location gate.
- the repository-owned capability evolution skill likewise uses `/doppelganger-capability-evolution <proposal-id>` after explicit research consent and grants no authority beyond portable proposal controls and a separately invoked executor workflow; a selected permanent-package option does not choose its repository or authorize implementation.
- an opt-in Evolution row remains an ordinary actor-aware Runtime Preset feature: DSH projects its seven qualified `evolution.*` controls unchanged, awaits its context provider during `system-prompt/assemble`, preserves actor and workspace metadata, and adds no Evolution-specific host channel or approval bypass;
- the active host design projects portable qualified tool names unchanged and gates required approval through scoped `tools/pre-execute` plus ApprovalService; non-grants and a missing answerer fail closed before dispatch. Its Dynamic Runtime Plugin vertical scenario must define, approve, run, observe, update or roll back, stop, and dispose one temporary Plugin without invoking DSH `cordis_*` tools or private host APIs. Its Evolution scenario must activate an arbitrary opt-in Runtime Preset, project policy/reminder context and exactly seven non-executing controls, preserve actor/workspace partitioning and persisted proposals, and remove stale projections on omission without adding host-specific semantics.

The source trace and complete planned contract are owned by `openspec/changes/add-deepseek-harness-host/`. The older `openspec/changes/archive/2026-08-29-build-cordis-agent-runtime/research/dsh-architecture.md` remains historical evidence. Revalidate the active design whenever the checked-out DSH revision changes.
