## Why

Canonical memory is coupled to synchronous `node:sqlite` statements, so multiple agents cannot choose a shared server database without rewriting memory policy. Introduce an explicit persistence boundary backed by MikroORM and ship **both SQLite and PostgreSQL as complete, tested canonical implementations in this change**, preserving local operation and enabling direct shared-database access from agent plugins.

## What Changes

- Extract a memory-owned asynchronous repository/unit-of-work contract and keep one implementation of mutation, candidate, evidence, conflict, authorization, retrieval, and context policy. ORM entities, connections, and dialect SQL remain private to persistence implementations.
- Implement SQLite using MikroORM's generic SQLite driver with `node:sqlite`, and PostgreSQL using its PostgreSQL driver. Neither backend is a stub, compatibility shim, optional experiment, or deferred follow-up.
- **BREAKING**: replace memory's required instance-SQLite injection with exactly one explicit canonical repository provider, composed through native Cordis Loader rows. Migrate every maintained preset, fixture, caller, and public asynchronous contract; retain generic instance-SQLite for its other consumers.
- Preserve the complete memory tools, automatic recall, committed-turn capture, identity/scope isolation, revisions, evidence, candidates, conflicts, idempotent receipts, temporal eligibility, hard deletion, and semantic maintenance on both backends.
- Supply dialect-owned indexed lexical retrieval: SQLite FTS5 and PostgreSQL native full-text search. PostgreSQL canonical memory does not require pgvector or any optional semantic service.
- Preserve atomic canonical mutation, lexical update, operation receipt, and projection/deletion outbox work. Make bounded projection operations asynchronous and safe for concurrent processes sharing one canonical database.
- Guarantee that an independent plugin's memory read started after a successful write sees the committed state in the same authorized partition, without restart, periodic database synchronization, or stale ORM identity-map reuse. Context refresh remains at the host's existing resolution boundary, not mutation of an already-running model request.
- Provide transactional legacy-SQLite adoption, PostgreSQL schema lifecycle, and an explicit validated offline transfer between the two canonical backends. Changing a Loader row alone never silently copies or merges data.
- Require one backend-neutral behavior contract against file-backed SQLite and a real PostgreSQL service, independent-process concurrency/freshness checks, real OMP integration, and migration/recovery evidence before completion.

## Capabilities

### New Capabilities

- `memory-persistence-backends`: Memory-owned persistence contract; two canonical MikroORM providers; transaction, freshness, configuration, lifecycle, schema/transfer, and mandatory real-backend conformance requirements.

### Modified Capabilities

- `persona-memory`: Replace SQLite-only activation and lexical wording with selected-provider behavior while preserving actor binding, the complete memory surface, final canonical recall validation, and existing scenarios.
- `memory-semantic-indexes`: Preserve derived-index authority and atomic synchronization through asynchronous canonical persistence; make generation transitions and worker ownership safe when canonical storage is shared.
- `loader-plugin-composition`: Compose the memory feature with exactly one canonical provider rather than an implicit mandatory SQLite dependency; preserve empty presets and unrelated SQLite infrastructure.

## Impact

- Primary implementation: `packages/extension-memory` contracts, internal entity mappings/repositories/dialects/migrations, Loader provider subpaths, service, schema, protocol, capture, and projection persistence; `packages/extension-memory-vectors` coordinator and fixtures.
- Integration: maintained authored memory compositions, OMP vertical tests, package exports/dependencies, mandatory PostgreSQL verification provisioning, migration/transfer tooling, and `scripts/package-boundaries.json` only if actual package edges change.
- Dependencies: source-verified MikroORM `7.1.15` core/SQL/PostgreSQL baseline, with aligned versions and locked transitive dependencies; native SQLite remains Node-owned. Implementation must run the registry-backed security check rather than treating this planning-time version lookup as a security audit.
- Documentation: `docs/features/memory.md`, `docs/operations/semantic-memory.md`, `docs/operations/configuration.md`, `docs/operations/verification.md`, `docs/architecture/overview.md`, `docs/project/status-and-scope.md`, and setup examples in `README.md`; update `docs/README.md` only if ownership or document paths change.
- Active-change coordination: `advance-memory-context-engine` overlaps canonical schema, recall, extraction, and projection transactions. Rebase its affected artifacts on this repository contract before applying either overlapping implementation; its unimplemented retrieval features are not silently included here.
- Explicit non-goals: Obsidian, GitHub storage/synchronization, an HTTP memory server, arbitrary database portability, cross-Persona/cross-actor authorization changes, raw SQL tools for models, or rewriting unrelated Persona/Evolution/SQLite features. Multiple agents share only the partitions they already have authority to access; this change does not merge identities.
