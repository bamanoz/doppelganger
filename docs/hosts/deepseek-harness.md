# DeepSeek Harness host

The native DeepSeek Harness (DSH) host is not implemented. Its research gate was revalidated against DSH commit `4e84901e6471b79ec0338099867ebb4606d12bb5` on September 3, 2026, and the active `add-deepseek-harness-host` change defines implementation against the actual host APIs. The host must activate the same Composition Definitions under a host-owned Cordis Context and reuse existing feature plugins and extension-owned persistent state without duplicating Persona logic.

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
- `extension-protocols` owns one actor-neutral shared Runtime Host plugin with a frozen closed capability profile, revisioned tool snapshots, exact invocation, protected approval grants, cancellation, declared lifecycle availability, and a transport-independent conformance suite;
- DSH binds that shared bridge directly in-process through one per-agent `RuntimeHostBinding` whose only runtime-to-host callback is `toolCatalogChanged(revision)`; no DSH-local bridge, generic notification envelope, RPC process, router, sidecar, or parallel session binding is planned;
- DSH Actor Identity is a separate protected plugin. Default namespaced anonymous-home binding, explicit bound/unbound modes, and provider absence remain distinguishable and cannot be supplied by Runtime Presets, Persona, or the shared bridge;
- DSH scope routing and dynamic runners are trusted extension mechanisms, not security sandboxes;
- Doppelganger Dynamic Runtime Plugins are a separate portable Runtime Preset feature and must not route through `@deepseek-ai/dsh-cordis-host-runner`; the future product dependency closure must make their Loader package resolvable without making generic `host-dsh` depend on its semantics;
- DSH already discovers project Agent Skills from `<projectRoot>/.agents/skills` and invokes a user-invocable skill with `/<skill-name> ...`; the repository-owned Persona evolution, runtime plugin development, and permanent plugin development skills can therefore use `/doppelganger-persona-evolution review`, `/doppelganger-runtime-plugin-development ...`, and `/doppelganger-plugin-development ...` independently of the deferred host adapter. Persona authoring and runtime-plugin controls still require compatible Doppelganger Runtime Presets; permanent plugin development uses ordinary repository tools only after its explicit implementation-location gate.
- the repository-owned capability evolution skill likewise uses `/doppelganger-capability-evolution <proposal-id>` after explicit research consent and grants no authority beyond portable proposal controls and a separately invoked executor workflow; a selected permanent-package option does not choose its repository or authorize implementation.
- an opt-in Evolution row remains an ordinary actor-aware Runtime Preset feature: DSH projects its seven qualified `evolution.*` controls unchanged, awaits its context provider during `system-prompt/assemble`, preserves actor and workspace metadata, and adds no Evolution-specific host channel or approval bypass;
- the active host design projects portable qualified tool names unchanged from immutable bridge snapshots, retains exact descriptor revisions, gates required approval through scoped `tools/pre-execute` plus ApprovalService, mints a matching protected grant only after `allowed-once`, and forwards DSH execution aborts through call-correlated `cancelTool`. Non-grants and a missing answerer fail closed before bridge dispatch. Its Dynamic Runtime Plugin and Evolution vertical scenarios use the ordinary shared paths, and `host-dsh` must pass the same Runtime Host conformance suite as OMP before support is considered implemented.

The detailed source trace is recorded in [DeepSeek Harness extension-surface research](../research/host-extension-surfaces/deepseek-harness.md); the complete planned implementation contract is owned by `openspec/changes/add-deepseek-harness-host/`. The older `openspec/changes/archive/2026-08-29-build-cordis-agent-runtime/research/dsh-architecture.md` remains historical evidence. Revalidate both the research record and active design whenever the checked-out DSH revision changes.
