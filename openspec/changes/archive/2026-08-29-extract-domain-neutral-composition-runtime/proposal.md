## Why

The current runtime successfully orchestrates Cordis sessions, but its public contracts and package layout still encode persona-specific concepts and expose low-level Loader patch mechanics. The runtime must become a domain-neutral extension system in which personas are one optional Cordis composition rather than the system's built-in model.

## What Changes

- Introduce a domain-neutral composition runtime centered on composition definitions, session scopes, named mount points, lifecycle, diagnostics, transactional reload, and disposal.
- Replace persona-specific activation metadata in the kernel with extension-provided mounts and extension-owned metadata.
- Replace public arbitrary Loader patches and `hostGroupId` placement with declared named mount points while retaining Cordis Loader as the composition mechanism.
- Move context, tools, lifecycle, SQLite, persona, and memory behavior out of the kernel into explicit extension modules.
- Keep hosts as Cordis adapters mounted into compositions; do not introduce a speculative capability framework before a second host exists.
- Preserve the existing Aiden and OMP vertical behavior through the persona, memory, protocol, and host extensions.
- **BREAKING**: remove the current `AgentRuntime`, `RuntimeDefinition`, persona-shaped activation metadata, `builtins`, `patches`, and `hostGroupId` public contracts without compatibility aliases.

## Capabilities

### New Capabilities
- `composition-runtime`: Domain-neutral loading, mounting, isolation, audit, transactional reload, and disposal of Cordis compositions.
- `extensions/persona`: Persona selection, instance/project metadata, identity, and traits implemented exclusively as an extension of the composition runtime.

### Modified Capabilities

None. The predecessor change has not been archived into main specs; existing persona, memory, and OMP behavior is preserved while ownership and interfaces are restructured.

## Impact

- Reorganizes `packages/runtime` into a small composition kernel and explicit extension modules, with clean package exports.
- Changes the child-runtime activation protocol and all direct kernel callers and tests.
- Changes persona definitions to declare named mount points rather than requiring host-supplied Loader patches.
- Renames the SQLite infrastructure around its actual instance-owned database role.
- Keeps Cordis and its official Loader/HMR/Include plugins as the only DI, lifecycle, and composition framework.
