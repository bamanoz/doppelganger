# DeepSeek Harness host

The native DeepSeek Harness (DSH) host is not implemented. Its research gate was completed against DSH commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` on August 31, 2026, and the active `add-deepseek-harness-host` change defines implementation against the actual host APIs. The host must activate the same Composition Definitions under a host-owned Cordis Context and reuse existing feature plugins and extension-owned persistent state without duplicating Persona logic.

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
- the host injects the public `doppelgangerRuntimePresets` roster service, whose normal deployment selects shipped actor-neutral `standard` after explicit, project, and user-default precedence;
- an intentionally inactive DSH deployment configures that roster without a deployment default rather than adding a second host-local selection path;
- each DSH agent owns one caller-context Composition Runtime and Runtime Session; standing preset plugin objects are not shared as mutable session trees;
- the protected context/tool/lifecycle/actor bridge is host-neutral and belongs in `extension-protocols`, while DSH projection remains in-process and uses no OMP child or RPC transport;
- the default DSH actor binding derives from its namespaced anonymous harness-home identity, with explicit unbound and trusted resolver modes;
- DSH scope routing and dynamic runners are trusted extension mechanisms, not security sandboxes.
- DSH already discovers project Agent Skills from `<projectRoot>/.agents/skills` and invokes a user-invocable skill with `/<skill-name> ...`; the repository-owned Persona evolution skill can therefore use `/doppelganger-persona-evolution review` independently of the deferred host adapter, but its authoring tools exist only after a compatible Doppelganger Runtime Preset is activated;
- the active host design projects portable qualified tool names unchanged and gates required approval through scoped `tools/pre-execute` plus `ApprovalService`; non-grants and a missing answerer fail closed before dispatch.

The source trace and complete planned contract are owned by `openspec/changes/add-deepseek-harness-host/`. The older `openspec/changes/archive/2026-08-29-build-cordis-agent-runtime/research/dsh-architecture.md` remains historical evidence. Revalidate the active design whenever the checked-out DSH revision changes.
