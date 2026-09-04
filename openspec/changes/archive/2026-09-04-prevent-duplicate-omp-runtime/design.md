## Context

OMP discovers project/user extension files, installed plugin entrypoints, and explicit paths independently. Its loader normalizes each candidate with `path.resolve()` and deduplicates only identical resolved paths. The repository-local `.omp/extensions/doppelganger.ts` re-exports `@doppelganger/doppelganger-omp`, but its file path differs from the linked package entrypoint, so OMP binds and invokes both when both are enabled.

This is not a violation of OMP session semantics. OMP intentionally permits the same session to be opened in several processes, and each Doppelganger adapter owns its own child Runtime Session. The accidental case is narrower: one OMP invocation discovers the same intended integration through two configured paths.

Existing real tests already exercise the modes separately. Linked-package tests use an isolated external workspace. Project-local dogfood tests explicitly uninstall the linked plugin before creating the `.omp/extensions` path. The missing piece is clear user-facing guidance explaining why that separation is required and how to switch modes.

## Goals / Non-Goals

**Goals:**

- Describe installed/linked and project-local loading as equally supported alternatives.
- Explain that OMP deduplicates by resolved entrypoint path, not npm package name or exported factory identity.
- Give exact operator actions for selecting one mode per invocation/profile.
- Preserve existing isolated evidence for both modes.
- Prevent documentation from implying singleton/session ownership that the implementation does not provide.

**Non-Goals:**

- Remove `.omp/extensions/doppelganger.ts` or the OMP plugin package.
- Add a process-wide, per-runner, filesystem, SQLite, or child-RPC lease.
- Prevent multiple OMP processes from opening the same session or Persona state.
- Modify OMP discovery, infer equivalent factories, or suppress explicitly configured extension paths.
- Add new runtime behavior or tests where existing mode-isolated real OMP scenarios already prove the supported paths.

## Decisions

### 1. Document two alternative loading modes

The setup guide presents a mode table:

- **Installed/linked plugin:** `omp plugin link ./packages/omp`; use it from workspaces without the project-local Doppelganger extension.
- **Project-local dogfood:** rely on `.omp/extensions/doppelganger.ts`; ensure `@doppelganger/doppelganger-omp` is disabled for the active OMP profile.

For temporary switching, OMP supports `omp plugin disable @doppelganger/doppelganger-omp` and `omp plugin enable @doppelganger/doppelganger-omp`. Uninstall remains appropriate for isolated tests that must remove the linked entry entirely.

Alternative considered: declare one mode canonical and remove the other. Rejected because both are useful: the plugin registry represents installation, while project-local discovery provides zero-registry repository dogfood.

### 2. State the exact duplicate mechanism

Documentation records the relevant OMP behavior:

1. project/user extension files and installed plugin entrypoints are collected as separate candidates;
2. candidates are deduplicated only when their resolved absolute paths match;
3. the project re-export and linked package entrypoint have different paths;
4. both factories therefore register handlers and may each start a child runtime.

This warning is factual and bounded. It does not claim that OMP forbids duplicates or that Doppelganger can identify equivalent factories reliably.

### 3. Do not add runtime arbitration

No lease is added to `packages/omp` or `host-omp`. A lease would solve only duplicate factories inside one process, would not cover the same session opened in several processes, and could conflict with independent ExtensionRunners. The operator owns extension selection; Doppelganger documents the consequence of selecting both paths.

Alternative considered: warn or suppress the second factory at runtime. Rejected because `ExtensionAPI` does not expose a stable package-level provenance contract that makes equivalent entrypoints distinguishable without introducing global policy.

### 4. Retain separate real OMP evidence

Current linked-plugin scenarios prove registry installation and package-relative child startup. Current project-local scenarios explicitly remove the linked package before exercising generated Runtime Presets, CodeGraph, Evolution persistence, reload, and shutdown. Verification documentation makes this isolation an intentional requirement rather than an incidental test setup detail.

## Risks / Trade-offs

- **Operator error remains possible:** documentation cannot prevent a user from enabling both paths. This matches OMP's permissive extension model and avoids hidden runtime policy.
- **Profile specificity:** plugin enablement belongs to the active OMP profile. Instructions must say which profile they affect and avoid implying a global session lock.
- **Future OMP changes:** if OMP later deduplicates by package or module identity, the warning can be relaxed after source and behavior verification; current documentation is tied to the inspected OMP 18.x loader semantics.
