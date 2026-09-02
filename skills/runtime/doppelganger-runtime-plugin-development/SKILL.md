---
name: doppelganger-runtime-plugin-development
description: Create, modify, diagnose, stop, or remove temporary session-scoped Doppelganger Cordis runtime plugins. Use when the user needs reversible host-side behavior in the current Runtime Session beyond one immediate tool call.
---

# Doppelganger Runtime Plugin Development

## Invocation and authority

Install this one Skill at project scope for both hosts. Invoke it as:

- OMP: `/skill:doppelganger-runtime-plugin-development ...`
- DSH: `/doppelganger-runtime-plugin-development ...`

Skill invocation grants no runtime authority. Every `runtime-plugin.run` attempt requires a separate one-shot native host approval for its exact arguments.

## Mechanism gate

Use Dynamic Runtime Plugins only for reversible host-side behavior that belongs to the current Runtime Session and must observe or contribute beyond one immediate tool call.

Do not define a temporary Plugin for permanent product code, authored Runtime Preset composition or patches, persistence across restart, package installation, a direct one-shot tool invocation, browser DOM or React work, host Client code, or host-specific UI. Route those requests to their owning mechanism.

Confirm all seven portable controls are available: `runtime-plugin.inspect-list`, `runtime-plugin.inspect-query`, `runtime-plugin.inspect-self`, `runtime-plugin.define`, `runtime-plugin.run`, `runtime-plugin.stop`, and `runtime-plugin.undefine`. If any required control is absent, report that the active Runtime Preset omitted the optional capability or the host cannot project it, then stop. Never fall back to DSH `cordis_*` tools, shell, filesystem editing, direct `node:vm`, Loader mutation, or private host APIs.

## Trust boundary

Before every run or update, state: generated Package code is trusted process code; `node:vm` is not a security sandbox; OMP's child process is a failure boundary, not hostile-code containment; native DSH execution shares the host process. The user's native approval decision is authoritative.

## Inspect-first workflow

1. Call `runtime-plugin.inspect-list` before writing code.
2. Call `runtime-plugin.inspect-query` only for each exact Service, Event, Builtin, and Tool contract the implementation needs. Use current returned names and signatures, never memory, examples, guessed APIs, DSH-specific catalogs, or uncatalogued framework properties.
3. When modifying or repairing a Plugin, call `runtime-plugin.inspect-self` for its current state, exact base Package source, pointers, waiting services, and latest diagnostic before defining a replacement.
4. If inspection does not expose a required capability, report the missing contract and stop rather than guessing.

## Package source contract

Write source as a plain JavaScript async-function body that returns a Cordis Plugin function or an object with `apply(ctx)`. Use only inspected builtins and services. Declare every hard service dependency in `inject`; use inspected optional lookup only when absence is valid.

Do not use imports, `require`, TypeScript annotations, decorators, JSX, native timers, guessed Node globals, or unsupported APIs. Generated code may list and register portable tools through the inspected guarded façade, but cannot invoke another tool directly.

Own every listener, provider, tool, timer, subscription, callback, and external effect through inspected lifecycle-aware APIs or `ctx.effect`. Every external subscription must return a disposer so stop, update, undefine, and session disposal remove it.

## Immutable lifecycle

1. Call `runtime-plugin.define` once with the prepared source. Definition is inert: success does not evaluate source or make behavior active.
2. Retain the exact returned `pluginId`, `packageId`, `name`, `purpose`, and `sourceDigest`.
3. For a first activation or restart of the current known-good Package, call `runtime-plugin.run` with `mode: "run"` and the exact returned metadata.
4. To switch an existing Plugin to a newly defined immutable Package, call `runtime-plugin.run` with `mode: "update"` and that Package's exact metadata.
5. Treat a non-empty `waitingFor` list as waiting, not running success; report the exact absent approved services.
6. If approval is rejected, cancelled, or unavailable, report that no generated source ran. Do not retry, redefine around the decision, or seek alternate authority.
7. After a technical parse, evaluation, apply, guard, or disposal failure, inspect the exact Package and latest diagnostic. Define the smallest corrected immutable Package on the same Plugin and request a new approval using the transition mode required by current state. Never overwrite source or hide older versions.
8. A failed update leaves the Plugin stopped with its known-good current pointer retained. Repair the target or explicitly request a separately approved run of the current Package; never claim automatic rollback.

## Stop, remove, and persistence

- Use `runtime-plugin.stop` to disable active effects while retaining immutable Packages, pointers, diagnostics, inspection, restart, and rollback context.
- Use `runtime-plugin.undefine` only when the user no longer needs the Plugin or any version in this Runtime Session. Its identities are invalid afterward.
- Neither operation persists or promotes source. If the user wants the behavior after restart or as a maintained capability, explain that promotion is outside this capability. Do not edit Runtime Presets, patches, plugin files, configuration, or install packages as a fallback.
