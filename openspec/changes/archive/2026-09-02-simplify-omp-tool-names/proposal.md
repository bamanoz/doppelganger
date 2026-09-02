## Why

OMP currently exposes portable dotted tool names through hexadecimal escape fragments such as `memory.search` → `doppelganger_memory_x2e_search`. The encoding is technically reversible but leaks transport machinery into model- and user-visible names even though the portable tool-name grammar already excludes `_`, making a simpler collision-free projection available.

## What Changes

- **BREAKING** Replace OMP's `_x<hex>_` proxy-name escaping with the readable projection `doppelganger_` + portable name with each `.` replaced by `_`; for example, `persona.revise` becomes `doppelganger_persona_revise`.
- Preserve the original dotted portable name as the canonical descriptor identity and dispatch through the committed proxy-to-descriptor mapping rather than reconstructing a runtime name from the OMP proxy name.
- Reject projected names that exceed the conservative provider-safe OMP function-name limit, with a diagnostic that identifies the portable tool and limit instead of allowing a later provider request failure.
- Keep dynamic add, replace, remove, approval, stale-closure, and invocation behavior exact across the naming cutover.
- Remove `_x2e_` references and compatibility expectations from OMP tests, documentation, and shipped tool-usage assets; do not retain aliases for old proxy names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hosts/oh-my-pi`: Define readable, collision-free OMP proxy naming, explicit canonical-name dispatch, length rejection, and clean-cutover behavior for projected portable tools.

## Impact

- `packages/host-omp/src/extension.ts` and neighboring OMP projection helpers.
- `packages/host-omp/tests/` coverage for static and dynamically reloaded tools, approvals, name collisions, excessive length, and stale proxy behavior.
- OMP host documentation and any shipped skill or usage text that names Doppelganger's OMP proxies.
- Existing conversations, scripts, or prompts that call `_x2e_` proxy names must use the new readable names after upgrade; no compatibility aliases remain.
- The host-neutral dotted tool protocol and non-OMP host projections remain unchanged.