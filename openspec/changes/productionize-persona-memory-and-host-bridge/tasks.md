## 1. Principal and Activation Contracts

- [x] 1.1 Add required stable `principalId` to persona activation metadata and validation, then verify concurrent activations freeze distinct principal metadata without changing `composition-runtime` contracts.
- [x] 1.2 Extend Aiden instance/user configuration to supply an explicit local principal and update selection fixtures; verify missing or invalid principal configuration fails with a precise configuration diagnostic.
- [x] 1.3 Define a generic serialized activation descriptor and resolver contract outside `host-omp`, then verify it can describe Aiden and a minimal non-persona composition without importing host code.

## 2. Memory Schema and Transactional Migration

- [x] 2.1 Define memory schema version 2 for partition, relationship/project scope, subject key, confidence, salience, temporal fields, evidence, conflicts, operation receipts, FTS, and embeddings; verify fresh creation exposes every required constraint and index.
- [x] 2.2 Implement transactional v1-to-v2 migration using the configured legacy principal and deterministic `legacy.<record-id>` subject keys; verify a populated v1 fixture retains active records, candidates, pins, revision lineage, project eligibility, and FTS recall.
- [x] 2.3 Add migration integrity checks and rollback behavior; inject a copy/validation failure and verify the schema version and all original v1 rows remain recoverable without partial v2 state.
- [x] 2.4 Centralize authoritative partition, scope, status, and temporal eligibility predicates; verify direct identifier lookup, candidate listing, history, mutation, lexical search, and pinning cannot cross principal or project scope.

## 3. Canonical Memory Mutations and Reconciliation

- [x] 3.1 Cut remember and propose requests over to operation identity, subject key, confidence, salience, temporal metadata, and relationship/project scope; verify explicit writes become active while inferred writes remain candidates.
- [x] 3.2 Implement partitioned operation receipts with command digests and content-free result coordinates; verify exact replay returns the original result and non-equivalent reuse returns `IDEMPOTENCY_CONFLICT` without extra rows.
- [x] 3.3 Implement bounded evidence persistence with session, turn, role, and support/contradiction relation; verify evidence inspection preserves provenance without storing full transcripts or rejected secrets.
- [x] 3.4 Implement subject-based equivalent observation reconciliation; verify repeated equivalent observations add evidence without creating duplicate active records or revisions.
- [x] 3.5 Implement inferred contradiction and conflict records without replacing the active value; verify unresolved conflicts and candidates stay out of normal recall and are available for inspection.
- [x] 3.6 Deepen candidate approval, rejection, and automatic promotion to recheck distinct sessions, principal-originated preference evidence, and unresolved contradictions in one transaction; verify same-session, assistant-only, contradicted, rejected, and eligible promotion cases.
- [x] 3.7 Extend correction and conflict resolution with current-revision compare-and-swap and immutable history; verify a concurrent two-session correction race commits exactly once and retains the superseded revision.
- [x] 3.8 Apply validity and expiry at read time using the injected clock; verify not-yet-valid and expired records are excluded from recall while explicit inspection and history remain available.
- [x] 3.9 Extend hard deletion across revisions, evidence, conflicts, candidates, receipts that contain sensitive coordinates, FTS, and embeddings while retaining only content-free replay protection where required; verify no local retrieval or inspection path returns deleted content.
- [x] 3.10 Update the complete namespaced memory tool surface and JSON Schemas for subject keys, operation IDs, evidence, temporal fields, inspection, and conflict resolution; verify domain errors retain stable codes through `ToolRegistry`.

## 4. Retrieval and Context Projection

- [x] 4.1 Change the semantic provider contract to return canonical record and revision identities with rank, and bound the eligible candidate snapshot supplied to it; verify an absent provider leaves lexical recall operational.
- [x] 4.2 Implement deterministic Reciprocal Rank Fusion for lexical and semantic lists, pinned relationship-preference precedence, subject diversity, and stable tie-breaking; verify lexical-only, semantic-only, overlapping, pinned, and repeated-subject rankings.
- [x] 4.3 Revalidate partition, scope, status, time, record identity, and revision identity after asynchronous semantic ranking; verify corrections and deletions during ranking suppress stale results.
- [x] 4.4 Enforce whole-contribution token budgeting and authority mapping so only approved preferences may be instructions; verify facts, decisions, procedures, candidates, conflicts, and synthetic archive-like data cannot override authored identity or traits.

## 5. Host-Neutral Lifecycle Protocols

- [ ] 5.1 Replace ambiguous lifecycle payloads with versioned JSON-safe session-started/disposed, turn-started/committed, tool-started/completed, and pre-compaction contracts carrying stable delivery, session, turn, and call identities; verify the protocol package remains free of persona, memory, OMP, and storage imports.
- [ ] 5.2 Implement bounded serialization for assistant messages, tool outcomes, errors, and pre-compaction material with explicit truncation metadata; verify circular, binary, oversized, and unsupported host values cannot crash or exceed configured payload limits.
- [ ] 5.3 Contain lifecycle subscriber failures and expose diagnostics without rejecting committed host work; verify a failing subscriber does not prevent independent subscribers from observing the event.
- [ ] 5.4 Add protocol contract tests for duplicate delivery identity, failed/cancelled/completed outcomes, partial-versus-committed separation, and neutral disposal when no completion outcome exists.

## 6. Optional Candidate Capture

- [ ] 6.1 Add an optional memory-capture plugin and extractor seam consuming only committed-turn events; verify the memory service and Aiden composition still activate when no extractor or capture plugin is installed.
- [ ] 6.2 Implement capture filtering for Doppelganger context blocks, trivial acknowledgements, generated scaffolding, unsupported roles, secrets, and size limits; verify filtered material creates neither candidates nor evidence.
- [ ] 6.3 Implement the conservative deterministic extractor for bounded durable patterns and stable subject keys; verify it proposes candidates only and never mutates authored persona identity or creates active inferred memory.
- [ ] 6.4 Derive capture operation identities from lifecycle delivery identity and candidate ordinal, then verify duplicate committed-turn publication produces one candidate/evidence outcome.
- [ ] 6.5 Add Aiden capture policy with automatic capture disabled by default and explicit enablement in instance configuration; verify direct remember and agent-initiated candidate tools remain unchanged in both modes.

## 7. Composition-Neutral OMP Adapter

- [ ] 7.1 Remove Aiden and persona imports from `host-omp`; inject the generic activation resolver and optional initializer, then verify package-boundary checks and activation of both Aiden and a non-persona composition.
- [ ] 7.2 Move Aiden activation assembly and explicit project initialization into the product bootstrap/preset integration, update `.omp/extensions/doppelganger.ts`, and verify unconfigured startup performs no configuration mutation until initialization is invoked.
- [ ] 7.3 Version the framed RPC activation and lifecycle contracts and update extension/child endpoints as one cutover; verify protocol mismatch and out-of-state requests fail diagnostically without corrupting the child session.
- [ ] 7.4 Map OMP `turn_end` assistant messages and tool results, `tool_execution_end` actual result/error, and `session_before_compact` bounded material into the new lifecycle events; verify stable turn/call/delivery identities and payload fidelity against OMP event fixtures.
- [ ] 7.5 Stop fabricating successful completion from bare `session_shutdown` and keep bounded child disposal; verify graceful and forced shutdown release the child without delaying ordinary OMP teardown indefinitely.
- [ ] 7.6 Implement path-aware translation of the supported protocol JSON Schema subset into OMP schemas; verify objects, required/optional properties, arrays, scalars, enums, descriptions, and additional-property policy, plus diagnostic rejection of unsupported constructs.
- [ ] 7.7 Rebuild changed tool proxies and active-tool sets from runtime notifications while preserving non-Doppelganger tools; verify schema changes, additions, removals, domain failures, and transport failures through the OMP extension surface.

## 8. End-to-End Verification

- [ ] 8.1 Exercise the full production memory lifecycle through the public tools and context protocol across real child-process restarts; verify relationship/project/principal isolation, idempotency, evidence, conflicts, promotion, correction, expiry, pinning, secret rejection, and deletion.
- [ ] 8.2 Exercise committed-turn capture through the OMP adapter with capture enabled and disabled; verify candidate-only writes, duplicate-event safety, recursive-context stripping, actual assistant/tool payloads, and fail-open subscriber errors.
- [ ] 8.3 Exercise valid/invalid profile reload with generic activation and dynamic schemas; verify rollback retains the last valid context/tools and persistent memory survives extension unload/reload.
- [ ] 8.4 Run focused package typechecks/tests, workspace dependency and single-Cordis checks, then the complete integration suite; verify `composition-runtime` exports no domain contracts and `host-omp` imports no preset, persona, or memory package.
- [ ] 8.5 Run an actual OMP smoke session that activates Aiden, appends persona context, validates a structured memory tool before RPC, remembers and recalls across restart, publishes a committed turn, and continues using normal OMP facilities after forced Doppelganger child failure.
