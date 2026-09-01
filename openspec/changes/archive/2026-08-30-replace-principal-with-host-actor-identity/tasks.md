## 1. Actor Identity Protocol

- [x] 1.1 Add the frozen bound/unbound `doppelgangerActor` service contract, validation, provider plugin, Cordis context augmentation, and root exports in `extension-protocols`.
- [x] 1.2 Add protocol tests for identifier validation, deep immutability, explicit unbound state, and isolation between concurrent actor providers.

## 2. OMP Host Binding

- [x] 2.1 Add the host-OMP actor-aware serialized activation type and shared canonicalizer without adding actor fields to composition-runtime contracts.
- [x] 2.2 Extend `DoppelgangerOmpExtensionOptions`, parent activation, child decoding, and the protected runtime host plugin to transport and provide bound or unbound actor state; add the actor isolation realm and advance the OMP RPC protocol version.
- [x] 2.3 Add adapter, child-integration, and extension tests for valid, invalid, omitted, concurrent, and reload-stable actor bindings, including actor-independent presets without configuration.
- [x] 2.4 Configure the project-local OMP bootstrap with actor `valera` and verify that Runtime Presets, patches, manifests, context, and projected tools cannot override or switch it.

## 3. Persona Ownership Cutover

- [x] 3.1 Remove `principalId` from Persona config, activation input, immutable metadata, and exports; add strict Persona config validation that rejects the obsolete field and unsupported keys.
- [x] 3.2 Update Persona tests and the Mark Runtime Preset so Persona owns only instance, session, project, identity, and trait metadata.
- [x] 3.3 Add a multi-actor Persona regression proving that one unchanged Persona definition can serve separate host actor bindings without exposing actor identity through `doppelgangerPersona`.

## 4. Memory Actor Partition Cutover

- [x] 4.1 Require `doppelgangerActor` alongside Persona and SQLite services; fail memory startup before database initialization whenever actor state is unbound.
- [x] 4.2 Rename public memory records, partitions, eligibility helpers, semantic requests, capture validation, and internal actor-bound logic from principal identity to actor identity.
- [x] 4.3 Keep all memory tools actor-neutral and reject both `principalId` and `actorId` input fields while deriving partitions exclusively from the bound actor service.
- [x] 4.4 Update mutation, retrieval, capture, protocol, projection, restart, and isolation tests so the same actor survives restart while a different actor cannot read or mutate its records.

## 5. Canonical Persistence Migration

- [x] 5.1 Add the next canonical memory schema version using `actor_id` in records, operations, indexes, constraints, and runtime queries.
- [x] 5.2 Implement transactional, idempotent v1/v2/v3 migrations that preserve historical rows and assign legacy rows to the current bound actor only where older schemas lack identity.
- [x] 5.3 Add populated migration fixtures, zero-loss count/lineage checks, failed-migration rollback tests, and rejection of unsupported schema versions.

## 6. Semantic Projection Migration

- [x] 6.1 Rename semantic vector entries, filters, coordinator requests, capture neighbor requests, backend payloads, and conformance fixtures to `actorId`.
- [x] 6.2 Add explicit actor-schema migrations for persisted SQLite exact and pgvector indexes; move Chroma and Qdrant metadata/filter keys to actor terminology.
- [x] 6.3 Version projection/filter/fingerprint inputs so old and new partition schemas cannot be silently reused, while preserving deterministic identity and ordering.
- [x] 6.4 Extend coordinator and backend conformance tests for actor filtering, persistence, migration, deletion, rebuild, and stale-hit revalidation.

## 7. Integration and Documentation

- [x] 7.1 Update OMP vertical and restart scenarios to exercise actor-bound Mark memory, unbound memory activation failure, actor isolation, canonical migration, semantic rebuild, and unchanged context/tool behavior.
- [x] 7.2 Remove remaining principal-identity fields and aliases from supported source, exports, tests, fixtures, examples, and authored configuration while retaining conversation-authorship terminology.
- [x] 7.3 Update README and the owning protocol, Persona, memory, OMP, configuration, and project-scope documents to describe host actor ownership, unbound behavior, migration, and deferred onboarding/authentication.

## 8. Verification

- [x] 8.1 Run the focused typechecks and test files for `extension-protocols`, `extension-persona`, `extension-memory`, `extension-memory-vectors`, and `host-omp`.
- [x] 8.2 Exercise the real project-local `.omp/extensions/doppelganger.ts` path with the configured actor and confirm existing Mark memory remains available after migration.
- [x] 8.3 Run `npm run check` and resolve all workspace typecheck, test, single-Cordis-root, package-boundary, documentation, and live-spec integrity failures.
