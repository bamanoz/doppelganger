## Why

After capability selection, Doppelganger has an executor workflow for temporary Runtime Plugins but no portable workflow for developing permanent installable plugins. Without an explicit ownership gate, an agent can incorrectly treat its current working directory as the package's intended repository and begin modifying an unrelated project.

## What Changes

- Add one canonical portable Agent Skill, `doppelganger-plugin-development`, for creating and modifying permanent installable Doppelganger plugins.
- Require the skill to obtain an explicit implementation location before creating files: the current repository, a user-named existing repository, or a new repository at a user-chosen location.
- Forbid inferring package ownership from the current working directory, Evolution proposal scope or storage, or the repository where the skill is installed.
- After location selection, require the skill to re-ground in the target repository's governing instructions and existing package conventions before planning or editing.
- Keep OpenSpec conditional: use the target repository's planning workflow only when its governing instructions or the user require it.
- Separate this permanent-package workflow from capability research, Persona evolution, temporary Dynamic Runtime Plugins, host-specific plugin formats, release, and publication authority.
- Verify identical project-scope discovery and invocation through compatible OMP and DSH hosts.

## Capabilities

### New Capabilities

- `persistent-plugin-development-skill`: Portable ownership-gated workflow for developing permanent installable Doppelganger plugin packages in a user-selected repository.

### Modified Capabilities

- None.

## Impact

- Adds a canonical skill under `skills/` with exact OMP and DSH invocation syntax.
- Adds repository-level behavioral tests for skill discovery, ownership gating, scope boundaries, and handoff behavior.
- Updates README and the owning Evolution, Dynamic Runtime Plugin, and verification documentation to describe the new executor boundary without changing runtime APIs.
- No changes to Runtime Presets, Loader services, tool protocols, package dependency boundaries, or shipped `standard` behavior.
