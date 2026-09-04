## Why

Doppelganger supports both OMP's installed/linked plugin registry and a project-local `.omp/extensions/doppelganger.ts` bootstrap. OMP resolves them as different absolute extension paths, so enabling both in one invocation loads two independent adapters; users need an explicit operational contract, not a runtime singleton or removal of either supported mode.

## What Changes

- Keep both OMP loading modes supported: installed/linked package and project-local extension.
- Document that the modes are alternatives for one OMP invocation and explain OMP's path-based discovery and deduplication behavior.
- Provide exact setup and switching instructions: use plugin linking outside a project bootstrap, or disable the linked plugin while using project-local discovery.
- Preserve OMP's legitimate ability to open the same session in multiple processes and Doppelganger's existing Runtime Session isolation; add no lease, lock, singleton, or session exclusivity.
- Keep existing real OMP evidence that exercises each mode separately and make the separation rule explicit in verification guidance.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `hosts/oh-my-pi`: Clarify the supported installed and project-local loading modes, their mutual-exclusion requirement within one invocation, and the absence of Doppelganger-owned singleton semantics.

## Impact

- Documentation and current contracts only: `README.md`, `docs/hosts/oh-my-pi.md`, `docs/operations/configuration.md`, `docs/operations/verification.md`, and the canonical OMP OpenSpec capability.
- Existing `.omp/extensions/doppelganger.ts`, package entrypoint, OMP adapter, child runtime, tests, and plugin-link behavior remain unchanged.
- No runtime lease, filesystem lock, process arbitration, session restriction, OMP discovery patch, or public API change.
