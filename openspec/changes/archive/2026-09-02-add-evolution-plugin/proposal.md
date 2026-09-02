## Why

Doppelganger can already revise an approved Persona trait and create temporary Runtime Session plugins, but it has no durable, installable capability that notices recurring behavioral or tooling gaps, records proposals, and brings them back for user-directed review. Without that coordinator, Persona evolution depends on explicit invocation and capability ideas are lost between sessions or raised at disruptive times.

## What Changes

- Add an independently installable `@doppelganger/doppelganger-evolution` Cordis Loader plugin that can be composed into any compatible Runtime Preset without adding Evolution to the kernel or host packages.
- Add a durable, actor-partitioned Evolution ledger for two proposal kinds: Persona evolution and capability opportunities.
- Make proposal creation non-mutating: detecting a gap may create or deduplicate a proposal, but cannot revise Persona, research external solutions, generate code, edit composition, or install anything.
- Contribute stable model-facing instructions that continuously evaluate completed work for meaningful evolution opportunities, defer suggestions until the current task is complete, and surface at most one relevant proposal subject to cooldown.
- Store globally useful proposals in plugin-owned state under the configured Doppelganger instance home and project-specific proposals as versionable YAML under the nearest project `.doppelganger/evolution/` directory.
- Add portable tools for proposing, listing, inspecting, transitioning, rejecting, snoozing, and recording reminder delivery while preserving immutable evidence and decision history.
- Add a capability-evolution Agent Skill that, after explicit user consent, researches current implementations, compares portability and maintenance constraints, and routes the selected solution in priority order: existing Doppelganger capability, temporary Dynamic Runtime Plugin, permanent Doppelganger package/Loader plugin, supported host plugin, then explicit adaptation or alternatives.
- Extend Persona evolution with a proposal-first path: autonomous observation may create and remind about a Persona proposal, but review and the existing separately approved `persona.revise` workflow begin only after the user chooses review; explicit direct review remains supported.
- Keep shipped `standard`, hosts, Runtime Sessions, Persona, memory, Dynamic Runtime Plugins, and presets that omit Evolution behaviorally unchanged.

## Capabilities

### New Capabilities

- `assistant-evolution`: Installable Evolution plugin, proposal ledger, scope selection, lifecycle, model instruction, portable tools, reminders, and omission neutrality.
- `capability-evolution-skill`: Consent-gated research, comparison, portability assessment, mechanism routing, planning handoff, and proposal state updates for capability opportunities.

### Modified Capabilities

- `persona-evolution-skill`: Extend Persona evolution with review of a selected durable Evolution proposal while retaining direct review, inspect-first replacement, native approval, CAS, HMR confirmation, and rollback guarantees.
- `loader-plugin-composition`: Define Evolution as an independently mountable actor-aware Loader plugin with explicit service injection, isolation, storage ownership, and no kernel or host dependency.

## Impact

- New workspace package and exports for the Evolution service and Loader plugin.
- New SQLite-backed global ledger state plus validated project YAML assets under `.doppelganger/evolution/`.
- New portable Evolution tool contracts and context contribution; existing host dynamic projection should carry them without Evolution-specific host code.
- New canonical capability-evolution skill and updates to the existing Persona evolution skill.
- Runtime Preset examples/dogfood composition, package-boundary manifest, documentation, focused specs, repository verification, and the active DeepSeek Harness plan require reconciliation.
- No breaking change for deployments that omit the Evolution Loader row.