# Persona extension

Persona is an optional product layer composed from ordinary Cordis plugins. It is not a runtime-kernel ontology.

## Ownership

The Persona Loader row owns:

- stable configured `instanceId`;
- immutable session-scoped Persona Activation metadata;
- authored identity content;
- ordered trait assets;
- instruction-authority context contributions.

It derives host session ID and optional workspace metadata from Runtime Session metadata. Concrete identity and trait content are configuration/assets unless they require new executable behavior. Persona configuration and activation metadata do not contain `actorId` or the removed `principalId`; the protected host bridge owns actor identity through a separate `doppelgangerActor` service.

A Persona Instance may be active for several actors and in several hosts concurrently. Each activation has an independent plugin tree. Actor-aware extensions partition shared durable state by the host binding rather than changing the Persona definition.

## Host neutrality

Persona definitions contain no concrete host plugin, RPC method, process-management code, or host-native tool. The host adapter appends its protected runtime-owned bridge after authored patches. The same Persona Definition can therefore be mounted in different compatible hosts.

## Scoped authoring

`@doppelganger/doppelganger-persona-authoring` is an optional ordinary plugin layered over the immutable Persona Activation and transport-neutral tools service. It derives logical targets from the active identity and ordered traits. Configuration may mark only explicit active `trait:<name>` targets writable; identity, paths, globs, absent or duplicate traits, and model-selected policy fail activation. Omitting the plugin leaves every asset read-only.

`persona.inspect` reads one logical target as an exact regular UTF-8 asset and returns content, SHA-256 byte revision, and writable state without exposing a mutation path. `persona.revise` accepts one configured target, exact inspected revision, complete replacement, bounded rationale, and optional bounded evidence identifiers. Evidence identifiers are advisory labels, not authorization. The tool requires one-shot native host approval before its handler runs.

Mutations serialize within a session and use an adjacent token-owned interprocess lock across sessions. Under that lock, the plugin revalidates exact bytes, returns `already-current` for an exact retry, fails a stale revision without merging, preserves mode, and atomically replaces only the selected file. Uncertain or live locks fail closed; this mechanism targets local user-owned assets and does not claim distributed-filesystem locking.

After replacement, Persona Authoring waits for Persona's exact canonical URL and byte revision. Only matching HMR success returns `applied`. Candidate failure or timeout restores the previous bytes and waits for their revision; an unconfirmed restoration reports the filesystem state without displacing Persona's in-memory last-good contribution. There is no persistent proposal queue or revision history, and a process crash after rename can leave unconfirmed candidate bytes for user backup/version-control recovery.

## Evolution skill

The repository-owned `doppelganger-persona-evolution` Agent Skill supplies the review workflow but no authority. Direct `review` and `review --dry-run` remain inspect-first and independent of Evolution. When optional Evolution is active, `review <proposal-id>` accepts one selected open Persona proposal as bounded workflow context only after explicit current review consent; reminders and proposal existence remain inert. The skill re-evaluates evidence, preserves unrelated trait meaning, and attempts at most one complete revision under the existing native approval, compare-and-swap, HMR confirmation, conflict, and rollback rules. It marks the proposal done only after `applied` or `already-current`; every non-application outcome leaves it open unless the user explicitly snoozes or rejects it. Installation and host-native invocation are documented in the root README, and the proposal ledger contract is owned by [Evolution](evolution.md).

## Reload

Identity and trait files use one package-private asset mechanism for canonical file URL matching, trimmed non-empty reads, serialized HMR reload, last-good retention, bounded diagnostics, and lifecycle-scoped watcher disposal. The mechanism owns file correctness only; identity sources/priorities and ordered-trait naming, order, priority, and instruction authority remain explicit in their plugins.

A valid asset change replaces content behind the existing contribution identity and affects the next context resolution without changing Persona Instance identity. An empty or unreadable update emits a bounded diagnostic and reload outcome while retaining the previous valid contribution. Disposing the plugin scope stops further asset publication.

## Composition

The shipped `standard` Runtime Preset is an actor-neutral Persona composition owned by `runtime-presets`. It supplies generic identity plus concise and engineering traits, context, and tools, but deliberately omits SQLite, memory, embedding, vector, and Persona Authoring rows. Its Persona `instanceId` is `standard`; it is the normal deployment default and requires no user-home copy.

User Runtime Presets may select any identity and ordered traits, opt into Persona Authoring for explicit logical trait targets, and compose storage, memory, embedding, or semantic rows as needed. These capabilities remain ordinary independently configured plugins; no named Persona or preset receives product-level special handling.

## Primary implementation

- `packages/extension-persona/src/activation.ts`
- `packages/extension-persona/src/asset.ts` — shared file-backed asset lifecycle.
- `packages/extension-persona/src/identity.ts`
- `packages/extension-persona/src/traits.ts`
- `packages/extension-persona/src/plugin.ts`
- `packages/extension-persona-authoring/src/plugin.ts`
- `skills/persona/doppelganger-persona-evolution/SKILL.md`
- user Runtime Preset assets selected by deployment configuration
