## Why

Doppelganger already activates arbitrary Cordis plugins from user Runtime Presets, but an agent cannot inspect the active Runtime Session, define a temporary plugin, run it, repair it by version, or remove it without editing files and restarting or reloading the authored composition. DeepSeek Harness proves that a self-referential, versioned Cordis workflow can make runtime extension practical when inspection, lifecycle ownership, diagnostics, and trust boundaries are designed together rather than reduced to arbitrary code evaluation.

## What Changes

- Add an optional host-neutral Dynamic Runtime Plugins extension that lets the active agent inspect an approved runtime capability catalog, define immutable temporary plugin packages, activate or update one exact package, stop a run, inspect source and diagnostics, and remove definitions.
- Mount every generated plugin as an ordinary Cordis child Fiber owned by the current Doppelganger Runtime Session, so registrations unwind on stop, update, extension disposal, session disposal, or process restart and never become a second Composition Runtime or watcher.
- Adapt the DSH dynamic-Cordis model to Doppelganger's existing protocol boundary: plain JavaScript host code only, a guarded `node:vm` evaluation realm, generated source-verified inspection metadata, exact version identities, and no claim that the VM is a security sandbox.
- Require existing portable one-shot host approval for every run or update before generated code executes, including host-only code; permissive host modes and earlier approvals do not bypass the exact-call grant.
- Expose the workflow through namespaced portable tools for inspection, definition, run/update, stop, and removal. Definitions and package source remain Runtime-Session-owned process memory; they do not write Runtime Presets, patches, repositories, or configuration and do not survive restart.
- Add a repository-owned cross-host `doppelganger-runtime-plugin-development` Agent Skill that teaches fit assessment, inspect-before-code, capability selection, plain-JavaScript constraints, reversible effects, version repair, approval handling, rollback, and stop conditions.
- Keep the shipped `standard` Runtime Preset unchanged. User Runtime Presets opt in by composing the extension and required standard protocols; generated-code authority remains as deliberate as shell access.
- Reconcile the active DSH host plan and OMP verification so both hosts project the same portable tools and approval behavior without importing DSH's dynamic runner or adding host-specific plugin semantics.
- Defer persistent promotion into a user Runtime Preset, package installation, dependency solving, browser/client UI plugins, generated-code sandboxing, autonomous background generation, and automatic restoration after restart.

## Capabilities

### New Capabilities

- `dynamic-runtime-plugins`: Runtime-Session-scoped inspection, immutable temporary package definitions, approved activation/update, diagnostics, rollback, stopping, removal, and trust boundaries for generated Cordis plugins.
- `runtime-plugin-development-skill`: Cross-host Agent Skill identity, discovery, guidance, invocation contract, and safe workflow for designing and operating temporary Doppelganger runtime plugins.

### Modified Capabilities

- `hosts/oh-my-pi`: Prove portable dynamic-plugin tools, exact approval, runtime tool replacement, child-process failure isolation, and session teardown through the implemented OMP host.

## Impact

- New workspace package: `packages/extension-dynamic-runtime-plugins`.
- New repository skill: `skills/runtime/doppelganger-runtime-plugin-development/SKILL.md`.
- Modified packages and tests: `extension-protocols`, `composition-runtime`, `host-omp`, `omp`, and generated catalog/integrity scripts as required by the source-verified inspection surface.
- Active `add-deepseek-harness-host` planning artifacts require reconciliation so its future vertical scenario covers the same host-neutral tools and approval contract without using `@deepseek-ai/dsh-cordis-host-runner`.
- Owning architecture, protocol, configuration, host, verification, security/trust, and status documentation must describe the optional capability and its bash-equivalent trust posture.
- No breaking change to Runtime Preset selection, existing protocol tools, shipped `standard`, Persona, memory, or hosts that omit the extension.
