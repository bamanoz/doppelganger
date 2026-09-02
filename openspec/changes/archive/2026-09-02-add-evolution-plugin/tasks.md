## 1. Cross-change and package foundation

- [x] 1.1 Reconcile `add-deepseek-harness-host` proposal, design, specs, and tasks with the optional installable Evolution package, generic portable tool projection, and proposal-first skill behavior before implementation edits
- [x] 1.2 Add `packages/extension-evolution` workspace metadata, NodeNext TypeScript configuration, package exports, Loader default export, test configuration, and public index surface
- [x] 1.3 Add `@doppelganger/doppelganger-evolution` to `scripts/package-boundaries.json` with only composition-runtime, Persona, protocols, and SQLite dependencies
- [x] 1.4 Include the Evolution package in the private `@doppelganger/doppelganger-omp` dependency closure while keeping `host-omp` and shipped presets Evolution-neutral
- [x] 1.5 Add repository integrity assertions for package naming, declared exports, dependency boundaries, obsolete-name absence, and shipped-preset omission neutrality

## 2. Shared safe-content boundary

- [x] 2.1 Extract the domain-neutral credential-pattern detector from memory into `extension-protocols` with focused positive and negative tests
- [x] 2.2 Migrate memory service and capture callers to the shared detector without changing recursive-memory or memory eligibility behavior
- [x] 2.3 Verify memory package typechecks and its content-policy, capture, and mutation tests still pass after the clean cutover

## 3. Evolution contracts and state machine

- [x] 3.1 Define frozen public proposal, scope, evidence, revision, transition, reminder, diagnostic, filter, mutation request, and result contracts as a discriminated `persona`/`capability` union
- [x] 3.2 Implement bounded boundary validation for identifiers, dedupe keys, titles, rationales, tags, evidence summaries, source references, timestamps, and JSON-compatible transition metadata
- [x] 3.3 Implement the kind-specific state matrix for Persona `reviewing`, capability `researching` through `implementing`, shared `done`, resumable `snoozed`, and terminal `rejected`
- [x] 3.4 Implement canonical command digests, stable operation receipts, exact retry replay, changed-command rejection, monotonically increasing revisions, and compare-and-swap failures
- [x] 3.5 Add contract and state-machine tests covering invalid kind/scope combinations, unknown fields, stale revisions, invalid transitions, terminal states, snooze restoration, and frozen results

## 4. Global SQLite ledger

- [x] 4.1 Add transactional Evolution schema and migration code for proposals, revisions, evidence, transitions, operation receipts, and reminder deliveries in the `evolution` instance SQLite namespace
- [x] 4.2 Implement the global storage adapter with mandatory Persona Instance and bound actor partition predicates on every read and mutation
- [x] 4.3 Implement exact-key active-proposal deduplication, distinct bounded evidence append, terminal-key conflict, immutable history, filtered listing, and inspection
- [x] 4.4 Implement revision-checked transition, snooze, rejection, completion, and reminder-delivery mutations as one transaction each
- [x] 4.5 Add global adapter tests for first initialization, persistence across reopen, operation idempotency, cross-Persona and cross-actor isolation, stale writes, terminal behavior, and disposal

## 5. Project YAML ledger

- [x] 5.1 Define and document the canonical version-1 project opportunity YAML schema and deterministic renderer using opaque proposal-ID filenames
- [x] 5.2 Implement direct-child discovery and independent validation that returns per-file diagnostics while preserving unrelated healthy proposals
- [x] 5.3 Implement a bounded adjacent interprocess lock, symlink rejection, expected-revision verification, same-directory temporary writes, fsync, atomic rename, and owner-only creation modes
- [x] 5.4 Implement project-scoped capability proposal deduplication, immutable history, receipts, transitions, snooze, rejection, reminder delivery, listing, and inspection through the shared storage contract
- [x] 5.5 Reject project operations without Runtime Session workspace metadata, reject project-scoped Persona proposals, and never fall back to global storage
- [x] 5.6 Run one shared storage conformance suite against SQLite and YAML adapters, plus project-specific tests for malformed files, concurrent writers, unrelated-file preservation, restart persistence, and no-directory-before-first-write

## 6. Evolution service, tools, and context

- [x] 6.1 Implement `EvolutionService` with explicit Runtime Session, actor, Persona, instance SQLite, context, and tools dependencies and fail activation before storage open when the actor is unbound
- [x] 6.2 Merge the current global partition and optional current-project adapter behind deterministic propose, list, inspect, transition, snooze, reject, and reminder-delivery operations
- [x] 6.3 Register exactly seven strict portable controls: `evolution.propose`, `evolution.list`, `evolution.inspect`, `evolution.transition`, `evolution.snooze`, `evolution.reject`, and `evolution.reminder.record`
- [x] 6.4 Implement typed target-state tool schemas, reject actor/Persona override fields, preserve structured domain errors, and return deeply frozen JSON-compatible results
- [x] 6.5 Add the bounded instruction-authority context contribution covering Persona and capability self-evaluation, proposal-first consent, post-task presentation, and Doppelganger-first routing
- [x] 6.6 Implement deterministic lexical reminder relevance across global and project proposals with status eligibility, confirmed-delivery ordering, stable tie-breakers, and at most one data-authority candidate
- [x] 6.7 Implement disabled-or-at-least-seven-day cooldown configuration and ensure selection is read-only while `evolution.reminder.record` alone advances delivery history
- [x] 6.8 Add service, tool, context, and reminder tests for omission, token budgets, empty input, no overlap, multiple candidates, cooldown, snooze, non-presentation, deterministic selection, and effect disposal

## 7. Loader composition and installability

- [x] 7.1 Add strict Schemastery Loader configuration for namespace and reminder policy, rejecting unknown and out-of-bound fields before controls register
- [x] 7.2 Add generated Runtime Preset composition tests for complete injection/isolation, missing dependencies, unbound actor failure, arbitrary preset activation, patchability, reload, and empty-preset neutrality
- [x] 7.3 Add a temporary packed-consumer smoke that installs the Evolution tarball, resolves the Loader export by bare package name, activates it, and proves installation alone registers nothing
- [x] 7.4 Add OMP integration coverage that projects all seven controls through the existing dynamic path, invokes global and project lifecycles, rejects stale proxies after removal, and disposes the Runtime Session and SQLite resources
- [x] 7.5 Verify the repository-local OMP entrypoint and `host-omp` contain no Evolution-specific imports, construction, actor choice, tool mapping, approval bypass, or named Mark dependency

## 8. Evolution Agent Skills

- [x] 8.1 Add canonical `skills/evolution/doppelganger-capability-evolution/SKILL.md` with project installation and exact OMP/DSH native invocation syntax
- [x] 8.2 Encode explicit research consent, primary-source comparison, maintenance/license/dependency/security analysis, reusable-core versus host-surface assessment, and sourced recommendation rules
- [x] 8.3 Encode mechanism routing through existing capability, temporary Dynamic Runtime Plugin, permanent installable Doppelganger plugin, supported host plugin, then explicit adaptation or alternatives
- [x] 8.4 Encode exact-revision proposal transitions through `researching`, `options-ready`, `selected`, and `planned`, with bounded research summaries and no implementation during research or planning
- [x] 8.5 Extend `doppelganger-persona-evolution` with optional proposal inspection, explicit review consent, `reviewing`, completion only after confirmed Persona activation, and unchanged direct review/dry-run behavior
- [x] 8.6 Ensure both skills forbid ad hoc backlog files, raw transcript/article storage, fake approval, executor fallback, research without consent, and opportunity suggestions before primary work is complete
- [x] 8.7 Extend skill verification to install exact canonical copies into a temporary universal project target and exercise OMP and DSH discovery and invocation contracts

## 9. End-to-end behavior and dogfood evidence

- [x] 9.1 Add an OMP vertical scenario that proposes a global Persona opportunity without mutation, offers review after primary work, and completes it only after separately approved HMR-confirmed Persona revision
- [x] 9.2 Add an OMP vertical scenario that proposes a project capability opportunity, persists canonical YAML, records a delivered reminder, survives restart, and suppresses it during cooldown
- [x] 9.3 Add capability workflow fixtures covering explicit research consent, sourced options, user selection, planning handoff, temporary runtime routing, permanent Doppelganger routing, and host-only routing
- [x] 9.4 Add negative vertical scenarios for weak one-off observations, invalid project YAML, project scope without workspace, cross-actor access, rejected/snoozed proposals, missing Evolution, and no executor side effects
- [x] 9.5 Exercise the real project-local OMP extension with a generated temporary user Runtime Preset containing Evolution and verify instruction context, reminder data, projected tools, persistence, reload, and shutdown

## 10. Documentation and current contracts

- [x] 10.1 Add `docs/features/evolution.md` as the authoritative owner of Evolution concepts, proposal kinds, state machines, storage, tools, instruction policy, reminders, consent, and executor boundaries
- [x] 10.2 Update `docs/README.md`, architecture overview/protocols/composition, configuration, Persona, Dynamic Runtime Plugins, OMP, verification, security/trust guidance, status/scope, and root README setup/usage
- [x] 10.3 Document independent package installation versus explicit Runtime Preset activation, the exact Loader row, required actor binding and isolation, packed-install support, and deferred marketplace/automatic installation
- [x] 10.4 Document project YAML as Git-visible canonical state, global SQLite partitioning, seven-day reminder policy, scope immutability, malformed-file recovery, and rollback by row omission
- [x] 10.5 Document the explicit post-implementation step for opting a user-owned Mark Runtime Preset into Evolution without changing shipped `standard` or treating personal preset files as repository fixtures
- [x] 10.6 Reconcile the new delta specs into documentation ownership and ensure every planned scenario has executable evidence or an explicitly planned evidence reference

## 11. Verification

- [x] 11.1 Run the extension-protocols and memory typechecks and focused tests covering the shared credential-policy cutover
- [x] 11.2 Run the extension-evolution typecheck and complete focused package test suite
- [x] 11.3 Run composition-runtime, runtime-presets, OMP package, and host-omp focused tests covering package resolution, Loader behavior, generic projection, persistence, reload, and cleanup
- [x] 11.4 Run both Persona and capability evolution skill verification suites through temporary OMP and DSH project discovery
- [x] 11.5 Run the packed external-consumer smoke and the real project-local OMP Evolution scenario
- [x] 11.6 Run `npm run check` and resolve every typecheck, test, single-Cordis-root, package-boundary, generated-catalog, documentation, and live-spec integrity failure
