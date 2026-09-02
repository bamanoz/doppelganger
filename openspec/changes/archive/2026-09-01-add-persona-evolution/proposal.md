## Why

Doppelganger can preserve a Persona across sessions, but every authored identity and trait is operationally read-only: the agent has no portable, user-controlled way to turn durable collaboration patterns into an intentional change to its own active behavior. The first writable Persona capability should remain opt-in, narrowly scoped, host-neutral, explicitly approved, conflict-safe, and reversible instead of giving the model general filesystem authority.

## What Changes

- Add an optional `@doppelganger/doppelganger-persona-authoring` Cordis plugin that exposes active Persona traits by logical target, registers read-only inspection and approval-gated revision tools, enforces configured writable targets, performs compare-and-swap mutations under an interprocess target lock, and coordinates atomic file replacement with Persona HMR rollback.
- Extend the portable tool descriptor with a host-neutral `required` one-shot approval declaration. A host that cannot obtain explicit approval fails the invocation closed; host permissive or `yolo` modes cannot silently bypass the tool-owned requirement.
- Project required portable-tool approval through OMP's native approval gate, including the portable reason and exact invocation arguments, while preserving existing dynamic replacement and stale-closure behavior.
- Reconcile the active native DSH host change so projected portable tools with required approval use DSH's scoped `tools/pre-execute`/`ApprovalService` seam and fail closed when no answerer is available.
- Allow an opted-in user Runtime Preset to add one explicitly writable `trait:evolving-profile` and compose Persona Authoring after Persona and tools. Identity, undeclared traits, shipped `standard`, and every asset outside the configured logical target remain read-only.
- Define and publish the portable `doppelganger-persona-evolution` Agent Skill from this repository at `skills/persona/doppelganger-persona-evolution/SKILL.md`. The skill teaches evidence review, the memory-versus-identity boundary, minimal revision construction, dry-run behavior, and invocation of the authoring tools; it grants no authority itself.
- Do not add a command protocol, host-specific `/persona review`, persistent proposal queue, autonomous background evolution, general file-edit tool, or Persona-specific code to host packages.

## Capabilities

### New Capabilities

- `persona-authoring`: Opt-in logical-target inspection, approved CAS revision, HMR confirmation/rollback, concurrency control, and bounded result diagnostics for explicitly writable Persona traits.
- `persona-evolution-skill`: Cross-host Agent Skill identity, distribution, invocation contract, evidence rules, and safe evolution workflow.

### Modified Capabilities

- `extension-protocols`: Add transport-neutral mandatory one-shot approval metadata and fail-closed host obligations to portable tool definitions and descriptors.
- `extensions/persona`: Make active Persona asset identity and reload outcomes sufficient for a separate authoring extension to inspect a selected trait and confirm or roll back an exact file revision without making Persona generally writable.
- `hosts/oh-my-pi`: Preserve and enforce required portable-tool approval when projecting runtime tools into OMP, including permissive host modes and dynamic reload.

## Impact

- New workspace package: `packages/extension-persona-authoring`.
- Modified packages: `extension-protocols`, `extension-persona`, `host-omp`, `omp`, and their focused tests; the active `add-deepseek-harness-host` planning artifacts and eventual `host-dsh` implementation must consume the same approval contract.
- Modified test and example assets: generated temporary Runtime Presets cover the writable trait policy; shipped `presets/standard` remains unchanged and no personal preset becomes a product artifact.
- New in-repository distribution deliverable: `skills/persona/doppelganger-persona-evolution/SKILL.md`, discoverable by current skills.sh-compatible tooling and installable from the public Doppelganger repository.
- Package boundaries, setup/operations, Persona, protocol, host, verification, status, and security/trust documentation require coordinated updates.
- No runtime-kernel Persona ontology, no OMP-only UX, no direct dependency from host packages to Persona Authoring, and no model-controlled bypass of approval.