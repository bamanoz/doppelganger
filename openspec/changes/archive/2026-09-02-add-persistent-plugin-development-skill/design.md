## Context

Doppelganger currently has two adjacent but intentionally separate workflows:

- `doppelganger-capability-evolution` researches reusable gaps and stops after the user selects a mechanism.
- `doppelganger-runtime-plugin-development` develops temporary session-scoped generated plugins and explicitly refuses permanent package work.

A permanent installable plugin therefore falls back to the agent's general coding behavior. In a session started inside an unrelated repository, that fallback can incorrectly interpret the current working directory as package ownership and create planning or implementation files before the user has chosen where the package should live.

The solution must remain host-portable, grant no new runtime authority, obey the selected repository's own engineering rules, and support both monorepo packages and standalone npm repositories. Agent Skills are the existing repository convention for portable procedural workflows and are discoverable by compatible OMP and DSH hosts.

## Goals / Non-Goals

**Goals:**

- Add one canonical Agent Skill for creating and modifying permanent installable Doppelganger plugin packages.
- Make an explicit user-selected implementation location a hard precondition for any filesystem mutation.
- Support three ownership choices: the current repository, a named existing repository, or a new repository at a user-selected location.
- Re-ground the agent in the selected repository before planning or editing.
- Reuse the target repository's package, testing, documentation, planning, and release conventions instead of imposing Doppelganger-repository conventions globally.
- Require source-verified Cordis and Doppelganger contracts plus package-level behavioral and installability verification.
- Preserve a clean boundary from capability research, temporary Runtime Plugins, host-specific plugin formats, publication, and repository administration.

**Non-Goals:**

- Implementing or changing any Loader service, runtime protocol, host adapter, Runtime Preset, or package-management API.
- Providing a deterministic project generator or executable scaffolding tool.
- Automatically choosing a repository, creating a remote repository, claiming an npm scope, publishing a package, committing, or pushing.
- Requiring OpenSpec in repositories that do not already require it.
- Promoting source from a Dynamic Runtime Plugin into a permanent package automatically.
- Teaching Claude Code plugin, browser Client plugin, or other host-specific package formats.

## Decisions

### Use a dedicated portable Agent Skill

Create `skills/development/doppelganger-plugin-development/SKILL.md`. The skill description will trigger for requests to create, build, modify, or repair a permanent/installable Doppelganger plugin or npm package.

This is procedural knowledge, not runtime functionality: the agent already has repository and coding tools, while the missing behavior is a reliable ordering of user decision, repository discovery, implementation, and verification. A Loader plugin would add unnecessary filesystem authority and lifecycle surface. Persona or global engineering instructions would be always loaded, less discoverable, and too shallow for the full workflow. Extending capability-evolution would violate its stop-at-selection boundary.

### Make repository ownership an explicit pre-mutation gate

Before creating a directory, package manifest, planning artifact, source file, or test, the skill must determine whether the user already named an implementation location. If not, it must ask the user to choose:

1. the current repository;
2. a specific existing repository; or
3. a new repository at a specified local location.

The current working directory, skill installation directory, Evolution proposal scope/storage, and repository containing a prior discussion are context only and never count as that decision. Inspection needed to describe the available choices may remain read-only; filesystem mutation waits for the answer.

For an existing repository, the workflow requires an accessible concrete path. For a new repository, it requires the intended local path before creating it. Remote creation and hosting remain separate explicit operations.

### Re-ground after the location decision

Once the target is chosen, the skill starts repository discovery again from that location. It reads the governing agent instructions, documentation map, workspace/package manifests, neighboring package structure, dependency and export conventions, test patterns, and required repository gates. It must not carry assumptions from the session's original repository into the target.

For a new repository, the workflow uses conservative standalone npm-package defaults only after resolving package identity and other material public choices with the user. It does not claim the `@doppelganger` npm scope or infer public/private publication intent.

### Derive package shape from current contracts, not a fixed scaffold

The skill will not bundle generated source templates. Existing repositories may be npm workspaces with package-specific conventions; standalone repositories may use different tooling. A fixed generator would create a competing convention and age with Cordis and Doppelganger APIs.

Instead, the workflow requires inspection of the target repository and the current package/API contracts before code is written. A permanent Doppelganger extension remains an ordinary Cordis Loader plugin: required services use `inject`, lifecycle effects dispose with plugin scope, cross-boundary values are validated and JSON-compatible, public contracts use package exports, and the selected repository decides exact build tooling and package layout.

### Treat planning as target-repository policy

The skill does not mention or create OpenSpec by default. After re-grounding, it follows a planning workflow only when the user requested one or the target repository's governing instructions require one. Otherwise it proceeds with the repository's normal coding workflow. This prevents an implementation skill from coupling every plugin package to this repository's planning system.

### Verify the maintained package, not only its source files

The workflow performs the narrowest target-package checks while iterating, then all repository-required gates. For a new or materially changed installable package, verification must cover:

- typechecking/build and behavioral tests for the plugin contract;
- lifecycle cleanup and failure behavior relevant to the services it owns;
- package contents and exports;
- installation into a disposable consumer outside the source tree; and
- activation through a minimal real Cordis Loader composition when the plugin is intended to load that way.

The exact commands come from the target repository and package manager. The skill does not publish as a substitute for installability testing.

### Keep release and repository administration separately authorized

Successful development does not authorize `npm publish`, version release, remote repository creation, git commit, or push. The skill may prepare a package for those later workflows, but performs consequential distribution or repository operations only when separately requested and under the applicable release or repository workflow.

## Risks / Trade-offs

- **[Risk] The extra ownership question adds friction when the current repository is obvious.** → Treat an explicit user statement that the plugin belongs in the current repository as sufficient; only implicit `cwd` is rejected.
- **[Risk] A generic skill may produce inconsistent package structures across repositories.** → Re-ground in target conventions and inspect neighboring packages rather than imposing a universal scaffold.
- **[Risk] New standalone repositories have no local convention to reuse.** → Ask for material package identity and ownership choices, then use conservative npm and current Doppelganger/Cordis contracts; do not infer npm scope or publication visibility.
- **[Risk] Source verification can become broad or time-consuming.** → Inspect only contracts needed by the plugin and use current primary package documentation/source; avoid generic ecosystem research once the implementation mechanism is already selected.
- **[Risk] Capability-evolution and this skill could both attempt to own planning.** → Keep a hard boundary: capability-evolution stops at `selected`; this skill begins only from an explicit development request and owns no Evolution transitions.
- **[Risk] A package can pass unit tests while being unusable after publication.** → Require package-content, disposable-consumer installation, export, and Loader activation checks where applicable.

## Migration Plan

1. Add the canonical skill and repository tests without changing existing skill names or runtime behavior.
2. Document project-scope installation and exact OMP/DSH invocation syntax.
3. Update capability-evolution and Dynamic Runtime Plugin documentation to point permanent package requests to the new skill while preserving their existing boundaries.
4. Verify canonical discovery in temporary OMP and DSH projects and exercise ownership-gate scenarios without creating files in an incidental repository.
5. No runtime-state or data migration is required. Rollback removes the new skill, tests, and documentation references; existing runtime and Evolution features remain unchanged.

## Open Questions

None. Package identity, target repository, publication visibility, and any planning workflow are deliberately resolved per invocation rather than fixed by this repository-level design.
