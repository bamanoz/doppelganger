## Context

The current Mark Runtime Preset configures `principalId: valera` in the Persona Loader row. Persona Activation then exposes that value to memory, which persists and retrieves by `(instanceId, principalId)` and copies the same naming through canonical SQLite, semantic contracts, and every vector backend. This makes portable Persona authorship an authority for selecting a human user's durable partition.

The composition runtime must remain domain-neutral, OMP must remain Runtime-Preset-neutral, runtime-owned `config.yaml` and project manifests must remain selection-only, and memory must remain an optional extension. Existing canonical memory must survive the terminology and ownership cutover. Derived semantic state may be rebuilt because canonical SQLite remains authoritative.

## Goals / Non-Goals

**Goals:**

- Separate agent identity (`instanceId`) from host-authoritative user identity (`actorId`).
- Expose one immutable, session-isolated actor identity contract that future hosts can implement without Persona coupling.
- Keep actor choice outside Runtime Presets, patches, project manifests, model context, and model tools.
- Make memory fail closed before opening storage when actor identity is not bound.
- Rename supported principal-identity APIs and persistence fields completely while preserving conversation-authorship terms.
- Preserve existing canonical records and rebuild incompatible derived projections without losing lexical availability.
- Keep empty and actor-independent Runtime Presets valid.

**Non-Goals:**

- Actor onboarding, profile discovery, switching, authentication, authorization, or an actor registry.
- Multiple actors inside one Runtime Session.
- Adding actor identity to generic Runtime Session metadata or composition-runtime contracts.
- Anonymous persistent memory or a default actor fallback.
- Renaming `principalInput`, evidence role `principal`, or other terms that describe conversation authorship rather than identity.
- Compatibility aliases for `principalId` or `principal_id` after migration.

## Decisions

### 1. Define actor identity as a host-neutral protocol service

`extension-protocols` will export the service name, frozen value types, validation, and a small provider-plugin constructor:

```ts
type ActorIdentity =
  | { readonly state: 'bound'; readonly actorId: string }
  | { readonly state: 'unbound' }
```

The protected runtime-side host plugin provides exactly one `doppelgangerActor` value in the session isolation realm. OMP provides a bound value when configured and an explicit unbound value otherwise. Actor-independent extensions may ignore the service; persistent memory requires the bound variant.

This belongs in `extension-protocols`, not Persona, because it is host-to-extension metadata and the package is independent of Persona, memory, composition, and concrete hosts.

Alternatives rejected:

- Add `actorId` to `RuntimeSessionMetadata`: violates the kernel's domain-neutral metadata boundary.
- Keep `actorId` in Persona Activation: preserves the current ownership bug even if the field is renamed.
- Expose only an optional/missing service: produces generic pending-service diagnostics and makes supported-host absence less explicit than a discriminated unbound state.

### 2. Bind actor identity during OMP activation, never through a mutable RPC

`DoppelgangerOmpExtensionOptions` gains optional `actorId`. `host-omp` defines its own actor-aware serialized activation wrapper around the generic `SerializedCompositionActivation`; composition-runtime's serialized contract remains unchanged. Parent and child use one host-package canonicalizer for actor validation and optional-field omission. The actor field crosses only `session.activate`, and the OMP RPC protocol version advances because parent and child must agree on the new activation contract.

The child passes the canonical actor value to `createOmpRuntimeHostPlugin`, and `runtimePluginIsolation` adds `doppelgangerActor` to the protected host bridge's session realm. Reload rebuilds authored Loader generations but does not reconstruct or replace the runtime-owned actor value.

The checked-in `.omp/extensions/doppelganger.ts` supplies the existing local identifier value `valera`, now as host configuration, so the migrated Mark partition remains accessible. The Mark Runtime Preset removes `principalId` entirely.

Alternatives rejected:

- Add an `actor.bind` or `actor.switch` RPC: introduces mutable identity, ordering races, and model-adjacent switching inside a session.
- Store actor identity in runtime-owned `$DOPPELGANGER_HOME/config.yaml`: violates the selection-only configuration contract and prematurely creates a profile registry.
- Store it in the project manifest: makes human identity project-authored and commit-visible.

### 3. Remove actor identity from Persona completely

`PersonaPluginConfig`, `PersonaActivationInput`, and `PersonaActivation` lose `principalId`. Persona continues to derive `instanceId`, session, project, identity assets, and traits. A strict Persona config schema will reject the removed field and other unsupported keys rather than silently ignoring legacy configuration.

Memory obtains `instanceId`, session, and project from `doppelgangerPersona`, and obtains `actorId` only from `doppelgangerActor`. Code that directly performs semantic-neighbor validation or candidate capture will declare and use the actor service rather than reaching through Persona.

Alternative rejected: copy host `actorId` into Persona Activation for convenience. This would recreate a combined metadata object and make future code depend on Persona for actor identity.

### 4. Make persistent memory require a bound actor before storage opens

`MemoryPlugin` and `MemoryService` add `doppelgangerActor` to their required injections. Memory startup validates `state === 'bound'` before opening the SQLite namespace, registering tools/context, starting capture, or coordinating semantic work. Unbound state throws a stable actor-identity activation error; the audited Runtime Session does not return partially active memory.

Every partition constructor uses:

```text
instanceId <- doppelgangerPersona
actorId    <- doppelgangerActor
projectId  <- doppelgangerPersona
```

Memory tool schemas remain partition-free: callers cannot pass either `actorId` or the removed `principalId`. Strict object schemas reject additional identity fields.

Alternative rejected: activate memory in a no-op mode when unbound. That can make a memory-bearing preset look healthy while tools or recall silently disappear; visible audited failure is easier to diagnose and does not create accidental anonymous state.

### 5. Perform a clean source and public-contract rename

Identity-bearing TypeScript and JSON fields become `actorId`; maintained SQL columns become `actor_id`. This includes canonical records and operations, eligibility predicates, public memory requests/results, projection work source rows, semantic requests, vector entries/filters, all backend payloads, fixtures, benchmarks, tests, and documentation.

The cutover deliberately leaves `principalInput`, principal evidence roles, and prose about principal-authored observations unchanged because they identify the author of content, not the durable actor partition.

No deprecated aliases, dual-read fields, compatibility exports, or principal-named maintained columns remain after migration.

### 6. Migrate canonical SQLite transactionally

The canonical memory schema advances from version 3 to version 4.

- New databases create `actor_id` columns directly in `memory_records` and `memory_operations`, actor-named indexes, and actor-based operation primary keys.
- Version 3 databases rename both partition columns and rebuild affected indexes inside the existing migration transaction; identifier values are unchanged.
- Version 2 databases complete the existing semantic migration and then the actor-column migration.
- Version 1 databases use the active bound `actorId` when assigning the previously missing identity partition, then complete all later migrations in the same transaction.
- Migration integrity checks cover record/revision counts, operation receipts, current-revision links, and actor-column/index presence.
- A failure rolls back the transaction and prevents memory activation.

The migration option becomes `legacyActorId`; no `legacyPrincipalId` API remains.

Alternative rejected: retain `principal_id` internally and rename only TypeScript. That leaves the domain model split across boundaries and forces permanent translation code.

### 7. Version derived vector partition metadata and rebuild from canonical state

All vector contracts and payload filters use actor naming. A fixed actor-partition schema marker participates in `MemoryVectorIndexIdentity.configFingerprint`, producing a new semantic generation even when model, dimensions, namespace, and backend are unchanged. The coordinator therefore rebuilds every canonical current revision before activating the actor-named generation.

Backend handling:

- SQLite Exact and pgvector advance their maintained table schema and rename `principal_id` to `actor_id` transactionally.
- Chroma and Qdrant write/filter `actorId`; old principal-named points belong to the old generation and cannot satisfy the new generation filter.
- Old-generation cleanup deletes superseded vectors through existing maintenance/deletion paths.
- Canonical actor revalidation remains mandatory for every asynchronous hit.

Lexical retrieval remains available while a new generation is building or if the backend is unavailable.

Alternative rejected: reuse the current semantic generation and lazily accept both payload names. Indexed-revision receipts would incorrectly claim old payloads are current, and dual filters would extend the compatibility surface indefinitely.

### 8. Update live documentation and examples in the same cutover

Implementation updates the owning documents for protocols, Persona, memory, OMP, configuration, and project status; README setup examples; the Mark Runtime Preset; project-local OMP bootstrap; and all affected live OpenSpec requirements. Runtime-owned user/project configuration remains selection-only.

## Risks / Trade-offs

- [Existing custom OMP integrations omit `actorId`] → Actor-independent presets continue to activate with unbound state; memory-bearing presets fail visibly with a stable diagnostic and the migration documentation shows the new host option.
- [Canonical rename corrupts durable state] → Run all DDL and integrity checks in one SQLite transaction, preserve identifier values, and test populated version 1/2/3 upgrades plus forced rollback.
- [Old remote vectors leak across actors] → Change the generation fingerprint, filter by new actor metadata and generation, canonically revalidate every hit, and keep lexical fallback active.
- [Unknown legacy Persona fields are silently accepted] → Add strict Persona configuration validation and an explicit regression for `principalId` rejection.
- [A new protocol service makes arbitrary presets actor-dependent] → Only the protected host bridge provides it; generic extensions need not inject it, and unbound actor-independent sessions remain valid.
- [Host configuration is still a local trust choice, not authentication] → Document `actorId` as host-authoritative partition input, not proof of identity; authentication and actor registries remain a later host concern.
- [Clean cutover breaks downstream source consumers] → Treat the change as intentionally breaking, update every workspace caller, export, example, and fixture together, and leave no misleading aliases.

## Migration Plan

1. Add the actor protocol contract and actor-aware OMP activation wrapper while preserving composition-runtime's generic contract.
2. Add OMP actor transport/provision, advance the RPC protocol version, and configure the project-local bootstrap with the existing `valera` identifier.
3. Remove `principalId` from Persona and enable strict config rejection.
4. Cut memory and semantic source contracts to `actorId`, requiring the bound actor service before opening state.
5. Add canonical schema version 4 and backend-specific vector schema migrations; add the actor partition schema marker so semantic generations rebuild.
6. Remove `principalId` from the Mark preset and update all callers, tests, fixtures, benchmarks, live specs, and owning documentation.
7. Verify actor isolation, unbound failure, v1/v2/v3 canonical migration, derived rebuild/fallback, restart persistence, real OMP projection, package boundaries, and the full repository check.

Rollback after a database has migrated requires restoring code that understands schema version 4; the migration itself is not reversed to principal-named columns. Before release, rollback is the normal source revert plus disposable test-state recreation. Canonical content remains recoverable because the schema change preserves values and revisions.

## Open Questions

None for this change. Actor profile storage, authenticated bindings, switching UX, and anonymous session policy are intentionally deferred.
