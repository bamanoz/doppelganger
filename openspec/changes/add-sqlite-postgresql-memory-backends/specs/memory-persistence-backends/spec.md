## MODIFIED Requirements

### Requirement: Two complete canonical persistence implementations
The memory extension SHALL provide working MikroORM-backed `sqlite` and `postgresql` canonical repository implementations in the same delivered change. Both SHALL run the same domain memory policy and SHALL satisfy the maintained memory and semantic-persistence contracts. PostgreSQL support SHALL NOT be represented solely by configuration, a derived pgvector adapter, a mock, or deferred implementation.

#### Scenario: SQLite provides the complete memory surface
- **ID**: `memory.persistence.backend.sqlite-complete`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::activates SQLite as a complete canonical provider`
- **WHEN** a valid memory composition selects the SQLite repository
- **THEN** its complete command, query, capture, recall and persistence behavior runs against a file-backed SQLite database through MikroORM

#### Scenario: PostgreSQL provides the complete memory surface
- **ID**: `memory.persistence.backend.postgresql-complete`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::activates PostgreSQL as a complete canonical provider`
- **WHEN** a valid memory composition selects the PostgreSQL repository without SQLite or pgvector canonical dependencies
- **THEN** its complete command, query, capture, recall and persistence behavior runs against a real PostgreSQL database through MikroORM

### Requirement: Provider selection is explicit and plugin-owned
Exactly one canonical repository provider SHALL be composed in the memory service's Cordis isolation realm. Provider configuration SHALL remain in authored Loader rows and SHALL NOT enter runtime-owned configuration, host metadata, model-selected actor fields or a generic runtime persistence interface. The SQLite provider SHALL retain the existing absolute home and namespace-derived database location. A failed PostgreSQL selection SHALL NOT fall back to SQLite.

#### Scenario: Existing local storage location is retained
- **ID**: `memory.persistence.selection.sqlite-location`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::preserves the configured SQLite home and default memory namespace`
- **WHEN** the SQLite provider is configured with the previous absolute storage home and no namespace override
- **THEN** it opens the existing `storage/memory.sqlite` within that home rather than creating a different canonical store

#### Scenario: Two providers occupy one memory realm
- **ID**: `memory.persistence.selection.duplicate-provider`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::rejects duplicate canonical providers in one realm`
- **WHEN** SQLite and PostgreSQL repository providers are mounted for the same memory service isolation realm
- **THEN** composition fails visibly without exposing an arbitrarily selected memory service

#### Scenario: PostgreSQL initialization fails
- **ID**: `memory.persistence.selection.no-fallback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::does not create SQLite state when PostgreSQL initialization fails`
- **WHEN** the selected PostgreSQL provider cannot establish or initialize its configured store
- **THEN** activation fails without creating a local canonical database or silently changing providers

### Requirement: Repository boundaries do not expose ORM state
The memory-owned repository and unit-of-work contracts SHALL be asynchronous and SHALL return detached validated domain values. ORM entities, identity maps, connections, SQL statements and unbounded transaction access SHALL remain private to the repository implementation. Tools, capture, context and semantic workers SHALL consume the domain or bounded projection interfaces rather than reproducing persistence policy.

#### Scenario: A domain result crosses the tool boundary
- **ID**: `memory.persistence.contract.detached-results`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::returns detached JSON-compatible results from both repositories`
- **WHEN** an operation finishes and its repository context is released
- **THEN** its returned memory result remains a stable JSON-compatible value without lazy database access or managed-entity behavior

#### Scenario: An asynchronous capture write rejects
- **ID**: `memory.persistence.contract.awaited-capture`
- **EVIDENCE**: `packages/extension-memory/tests/memory-capture.spec.ts::awaits repository-backed proposals before reporting capture completion`
- **WHEN** a committed-turn candidate write rejects asynchronously through the selected repository
- **THEN** capture contains the failure without reporting that proposal as successfully persisted

#### Scenario: An asynchronous forget result is returned
- **ID**: `memory.persistence.contract.awaited-forget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::awaits forget before projecting its deleted result`
- **WHEN** a forget tool call completes through an asynchronous repository
- **THEN** the tool returns the resolved deletion outcome rather than a serialized pending promise

### Requirement: Canonical commands have one atomic transaction
Every canonical mutation SHALL commit or roll back record state, revisions, evidence, candidate joins, conflicts, operation receipts, lexical changes and required projection/deletion work as one selected-backend transaction. All participating helpers SHALL use that transaction's connection. SQLite SHALL acquire an immediate write reservation equivalent to its existing contract. PostgreSQL SHALL use database-owned serialization for conflicting partition mutations; process-local mutexes and ORM identity maps SHALL NOT substitute for it.

#### Scenario: SQLite cannot complete the outbox write
- **ID**: `memory.persistence.atomicity.sqlite-outbox-rollback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::rolls back every canonical side effect when outbox persistence fails`
- **WHEN** required outbox persistence fails during a SQLite memory mutation
- **THEN** no part of that mutation remains committed in canonical, lexical, evidence, receipt or projection state

#### Scenario: PostgreSQL cannot complete the lexical write
- **ID**: `memory.persistence.atomicity.postgresql-lexical-rollback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::rolls back every canonical side effect when lexical persistence fails`
- **WHEN** lexical persistence fails during a PostgreSQL memory mutation
- **THEN** no part of that mutation remains committed in canonical, lexical, evidence, receipt or projection state

#### Scenario: Concurrent clients create a conflicting subject
- **ID**: `memory.persistence.concurrency.subject-creation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::serializes competing first writes for one canonical subject`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::serializes competing first writes for one canonical subject`
- **WHEN** independent clients simultaneously create different active content for the same partition, scope, kind and subject
- **THEN** one coherent active record is committed and the competing explicit command receives the domain conflict outcome

#### Scenario: Concurrent corrections use the same expected revision
- **ID**: `memory.persistence.concurrency.revision-cas`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::allows one correction winner for a shared expected revision`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::allows one correction winner for a shared expected revision`
- **WHEN** independent clients correct the same current revision with different replacement content
- **THEN** exactly one correction is committed and the loser cannot overwrite the winner or leave partial history

### Requirement: Idempotent outcomes survive concurrency and uncertain delivery
Both repositories SHALL preserve the existing partition-scoped operation ID and command-digest contract. Exact retry SHALL resolve the durable prior operation before re-evaluating mutation preconditions, while changed-command reuse SHALL fail. Receipt replay SHALL retain the maintained current-record/deleted-result semantics; it SHALL NOT manufacture a historical frozen response. An uncertain network commit outcome SHALL NOT be reported as proven rollback or retried with a new operation identity.

#### Scenario: Independent clients deliver an identical operation
- **ID**: `memory.persistence.receipts.concurrent-identical`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::deduplicates identical concurrent operation delivery`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::deduplicates identical concurrent operation delivery`
- **WHEN** independent clients concurrently submit the same operation ID and canonical command digest
- **THEN** one mutation is committed and both outcomes resolve without duplicate revisions, evidence or work

#### Scenario: Commit succeeds but its response is lost
- **ID**: `memory.persistence.receipts.uncertain-commit`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::recovers an uncertain commit through the original operation receipt`
- **WHEN** PostgreSQL commits a command but the caller loses its completion response and retries the same operation
- **THEN** the receipt resolves the committed outcome without a second mutation

### Requirement: Independent readers observe acknowledged commits
A canonical read started after another authorized client's successful commit acknowledgment SHALL observe that committed state or a later committed state, subject to the maintained eligibility rules. Repositories SHALL use fresh operation contexts and primary-store reads rather than session-long ORM entities or replicated local canonical copies. This contract SHALL apply to independent processes sharing one local SQLite file and independent PostgreSQL clients. It SHALL NOT claim that separate SQLite files synchronize or that an already-running model request can be changed.

#### Scenario: SQLite process reads another process's correction
- **ID**: `memory.persistence.freshness.sqlite-processes`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::observes another process commit without restarting memory`
- **WHEN** one process acknowledges a correction and a second process subsequently reads the same authorized SQLite partition
- **THEN** the second process returns the current committed revision without restarting or rebuilding a session cache

#### Scenario: PostgreSQL client reads another client's deletion
- **ID**: `memory.persistence.freshness.postgresql-clients`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::observes another client deletion without restarting memory`
- **WHEN** one PostgreSQL client acknowledges forget and a second client subsequently inspects or recalls that record
- **THEN** the second client cannot return the deleted canonical content

### Requirement: Canonical availability cannot be replaced by a stale cache
When the selected canonical repository is unavailable for required validation, memory SHALL fail visibly rather than return unvalidated cached state or switch canonical stores. Optional semantic failure SHALL retain lexical fallback only while the canonical repository remains healthy. Final recall snapshot semantics remain owned by the maintained persona-memory capability.

#### Scenario: Canonical PostgreSQL becomes unavailable
- **ID**: `memory.persistence.recall.canonical-outage`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::fails canonical reads instead of serving a stale ORM cache`
- **WHEN** PostgreSQL is unavailable during a required canonical read
- **THEN** the operation fails visibly rather than presenting cached records as newly validated memory

### Requirement: Both repositories provide indexed lexical retrieval
SQLite SHALL provide FTS5-backed lexical retrieval and PostgreSQL SHALL provide native indexed full-text retrieval without requiring pgvector, a local SQLite sidecar or an unbounded table scan. Both SHALL preserve the complete lexical query, apply canonical eligibility before bounded candidate selection, and provide deterministic ranks/tie breaks to the shared fusion policy. Numeric lexical score equality across dialects SHALL NOT be a portability requirement.

#### Scenario: PostgreSQL searches multilingual technical memory without vectors
- **ID**: `memory.persistence.lexical.postgresql-independent`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::retrieves multilingual and technical lexical evidence without semantic dependencies`
- **WHEN** canonical PostgreSQL memory receives corpus queries containing Russian, English, Unicode and technical identifiers with no semantic stack
- **THEN** its indexed lexical path returns the required eligible corpus records under the shared query and budget contract

#### Scenario: SQLite preserves its existing lexical corpus
- **ID**: `memory.persistence.lexical.sqlite-regression`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::preserves multilingual and technical lexical retrieval through the ORM adapter`
- **WHEN** the SQLite implementation is replaced with its MikroORM-backed repository
- **THEN** the maintained lexical corpus, complete-query, eligibility and deterministic ordering assertions continue to pass

### Requirement: Legacy adoption and schema activation are recoverable
The SQLite provider SHALL adopt supported populated v1/v2/v3/v4 memory stores without changing canonical identifiers, scopes, evidence, receipts or revision lineage and SHALL retain the maintained legacy actor-assignment rules. Both providers SHALL serialize schema initialization/migration, reject unsupported schema versions, and publish a usable service only after schema verification. Ordinary activation SHALL NOT use destructive ORM schema synchronization.

#### Scenario: Existing SQLite memory activates through MikroORM
- **ID**: `memory.persistence.schema.sqlite-adoption`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-migrations.spec.ts::adopts supported populated SQLite schemas without losing canonical state`
- **WHEN** an existing supported SQLite memory file is activated through the new provider
- **THEN** its records, lineage, provenance, eligibility, receipts and pending cleanup remain available under the original identities

#### Scenario: PostgreSQL providers start concurrently
- **ID**: `memory.persistence.schema.concurrent-postgresql-bootstrap`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-migrations.spec.ts::serializes concurrent PostgreSQL schema activation`
- **WHEN** independent PostgreSQL providers initialize the same empty supported schema concurrently
- **THEN** one complete compatible schema is installed without duplicate migrations or partially published services

#### Scenario: A migration fails before completion
- **ID**: `memory.persistence.schema.rollback`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-migrations.spec.ts::retains recoverable source state after migration failure on both backends`
- **WHEN** a schema migration fails while adopting a populated store
- **THEN** activation fails and the previous committed state remains recoverable rather than exposing a partial migration

### Requirement: Backend transfer preserves complete durable memory
An explicit operator-only offline transfer SHALL support SQLite-to-PostgreSQL and PostgreSQL-to-SQLite. It SHALL require a quiescent source, a consistent source snapshot and an empty compatible destination; preserve canonical IDs, revisions, evidence, candidate links, conflicts, scope, timestamps, receipts and outstanding opaque remote cleanup obligations; rebuild dialect-local indexes; and verify the destination before publication. Transfer SHALL NOT automatically merge stores, rewrite authored selection, erase the source or claim that a changed connection string moves data.

#### Scenario: SQLite memory transfers to PostgreSQL
- **ID**: `memory.persistence.transfer.sqlite-to-postgresql`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-transfer.spec.ts::transfers complete SQLite memory into PostgreSQL`
- **WHEN** an operator transfers a quiescent populated SQLite store to an empty PostgreSQL destination
- **THEN** the verified destination preserves the complete durable memory contract and serves it through the PostgreSQL repository

#### Scenario: PostgreSQL memory transfers to SQLite
- **ID**: `memory.persistence.transfer.postgresql-to-sqlite`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-transfer.spec.ts::transfers complete PostgreSQL memory into SQLite`
- **WHEN** an operator transfers a quiescent populated PostgreSQL store to an empty SQLite destination
- **THEN** the verified destination preserves the complete durable memory contract and serves it through the SQLite repository

#### Scenario: A transfer fails during installation
- **ID**: `memory.persistence.transfer.atomic-failure`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-transfer.spec.ts::does not publish partial destination state or modify the source on failure`
- **WHEN** destination persistence fails before transfer verification and commit
- **THEN** no partial imported memory becomes active and the original source remains usable

#### Scenario: A destination already contains memory
- **ID**: `memory.persistence.transfer.reject-merge`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-transfer.spec.ts::rejects transfer into a nonempty canonical destination`
- **WHEN** transfer is requested into a destination with existing canonical memory
- **THEN** preflight rejects the operation without merging, overwriting or deleting either store

#### Scenario: Source memory has pending remote deletions
- **ID**: `memory.persistence.transfer.deletion-obligations`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backend-transfer.spec.ts::preserves forgotten-result receipts and remote deletion routing across transfer`
- **WHEN** the source contains forgotten-record receipts and outstanding identifier-only remote cleanup
- **THEN** transfer preserves non-resurrection and routable cleanup obligations without recreating deleted content or accepting inaccessible active projections

### Requirement: Database resources and credentials follow plugin lifecycle
Both providers SHALL reject unbound actor activation before opening canonical storage, keep initialization candidates private, validate JSON-compatible Loader input and release owned transactions/connections/pools on failure or disposal. PostgreSQL secrets SHALL be resolved from named environment variables and excluded from logs, errors, public results and persisted identity metadata. Normal plugin credentials SHALL NOT be presented as authorization for model-selected actors or arbitrary SQL tools.

#### Scenario: PostgreSQL credential resolution fails
- **ID**: `memory.persistence.lifecycle.indirect-credentials`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::rejects invalid indirect PostgreSQL credentials without exposing secret values`
- **WHEN** the configured PostgreSQL credential reference is absent or resolves to an invalid connection configuration
- **THEN** activation fails with bounded diagnostics that contain no resolved credential value

#### Scenario: Disposal wins during initialization
- **ID**: `memory.persistence.lifecycle.initialization-race`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::closes late repository initialization candidates exactly once`
- **WHEN** a provider is disposed while database initialization is still pending
- **THEN** the late candidate is released without publishing a usable repository or leaking an owned connection

#### Scenario: A plugin is disposed after successful use
- **ID**: `memory.persistence.lifecycle.complete-disposal`
- **EVIDENCE**: `packages/extension-memory/tests/memory-backends.spec.ts::settles operations and closes both repository implementations on disposal`
- **WHEN** the owning Cordis scope is disposed after memory operations
- **THEN** its in-flight operations settle according to the cancellation contract and all owned database resources close before fixture cleanup

### Requirement: Completion requires mandatory real-backend parity evidence
The required verification path SHALL run reusable memory behavior assertions against both file-backed SQLite and an actual disposable PostgreSQL server. It SHALL include independent-client/process concurrency, restart, migration, capture, protocol and real OMP integration. PostgreSQL prerequisite failure, conditional skips, a fake driver or a derived pgvector-only smoke SHALL NOT count as canonical backend acceptance. Focused-spec evidence SHALL point to direct unconditional executable test cases before archive.

#### Scenario: The required backend gate has no PostgreSQL service
- **ID**: `memory.persistence.verification.no-skip`
- **EVIDENCE**: `scripts/tests/memory-backend-verification.spec.ts::fails the required backend gate when PostgreSQL is unavailable`
- **WHEN** required backend verification cannot start or reach its disposable PostgreSQL fixture
- **THEN** verification fails rather than reporting a skipped or successful PostgreSQL implementation

#### Scenario: Both backend contract suites execute
- **ID**: `memory.persistence.verification.shared-contract`
- **EVIDENCE**: `packages/extension-memory/tests/memory-sqlite-contract.spec.ts::satisfies the complete shared canonical memory contract`
- **EVIDENCE**: `packages/extension-memory/tests/memory-postgresql-contract.spec.ts::satisfies the complete shared canonical memory contract`
- **WHEN** the required verification path runs with both real database fixtures available
- **THEN** both implementations pass the same domain assertions for mutations, isolation, revisions, evidence, candidates, conflicts, receipts, temporal recall, authority, deletion and semantic persistence

#### Scenario: OMP uses shared PostgreSQL canonical memory
- **ID**: `memory.persistence.verification.omp-postgresql`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete memory lifecycle with shared PostgreSQL canonical storage`
- **WHEN** independent real project-local OMP runtime sessions use the PostgreSQL repository with the same authorized memory partition
- **THEN** their tools, capture, context, post-commit visibility, restart and disposal operate through the existing host transport without a SQLite canonical fallback
