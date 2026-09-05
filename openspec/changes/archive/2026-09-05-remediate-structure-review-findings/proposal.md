## Why

The structural review found duplicated contracts, hidden query-side mutations, leaking persistence internals, and verification seams that do not consistently exercise the behavior they claim. Isolated probes already demonstrated Evolution store disagreement, reminder-query writes, and host/protocol JSON coercion differences; the remaining findings need focused behavioral verification rather than a broad rewrite.

## What Changes

- Address all sixteen findings from the delivered review, with a finding-to-design-to-task traceability map in `design.md`; distinguish demonstrated behavior, source-confirmed structural problems, and unexercised runtime risks.
- Make Evolution listing, inspection, and reminder selection read-only while retaining expiry-aware reminder eligibility and explicit revision-checked persisted transitions. Make unchanged successful commands persist their operation receipts without reinserting immutable revisions in either storage adapter.
- Give portable JSON values one strict pre-clone validation owner; give Runtime Preset health and activation one shared Loader structural contract; make each File, Sentry, and Pi plugin's Loader admission and direct normalization enforce the same configuration rules.
- **BREAKING**: remove unrestricted canonical-database access from the memory coordinator interface and migrate all repository callers to memory-owned projection operations, without a compatibility alias or storage migration.
- Assemble and finally revalidate stable-profile and ranked automatic recall through one memory-owned path, preserving whole-record retrieval, existing preference authority, partitioning, lexical fallback, and hard budgeting.
- Exercise the real OMP adapter/transport for its supported unbound/bound Actor Identity states and all shared transport behaviors, retain true provider-absence evidence at the protocol boundary, replace tautological vector-maintenance assertions with deterministic overlap checks, and make package-edge checks syntax-aware using the existing TypeScript AST convention and sole boundary manifest.
- Remove the unused RPC method map, redundant composition-generation state and repeated preflight, and the mutable Sentry client-factory test override. Retain useful Cordis adapters, backend-specific implementations, and existing public construction contracts not named in the review.
- Separate shared CodeGraph discovery facts from per-caller failure policy. Reuse audited acceptance for composition rollback and report observed restoration failure instead of publishing a stale healthy entry snapshot.
- Correct current documentation for public composition canonicalization and host-owned activation decoding, and update every affected topic owner alongside the eventual implementation.
- **Compatibility tightening**: values and Loader/configuration inputs previously admitted only by a weaker duplicate validator will fail before side effects; valid authored configuration, plugin omissions, activation log correlation, and normal runtime behavior remain supported.

## Capabilities

### New Capabilities

None. This change deepens existing modules and strengthens existing contracts.

### Modified Capabilities

- `assistant-evolution`: read-only expiry-aware queries and consistent unchanged-command receipts across SQLite and YAML.
- `extension-protocols`: distinguish strict protocol-value admission from intentionally bounded, potentially lossy host-observation projection without duplicating the implemented closed-JSON contract.
- `structured-inference`: add direct/Loader Pi configuration parity to the implemented capability currently owned by the active `add-proactive-evolution-signals` delta; promote that baseline before synchronizing this extension.
- `host-runtime-api`: common conformance must exercise the supported adapter rather than substitute its underlying bridge.
- `hosts/oh-my-pi`: strict pre-transport value admission without JSON coercion, preserving correlated host projection.
- `runtime-presets`: roster health and activation agree on portable Loader structure without moving protected runtime policy into the roster.
- `composition-runtime`: audited restoration with truthful failure diagnostics; preserve existing patch/activation behavior during internal simplification.
- `runtime-logging`: equivalent direct and Loader configuration admission while retaining private destination lifecycle and activation correlation.
- `persona-memory`: one finally revalidated automatic-recall result across stable and ranked sources.
- `memory-semantic-indexes`: memory-owned canonical projection operations and meaningful maintenance serialization evidence.
- `codegraph-code-intelligence`: concurrent discovery preserves each caller's diagnostic or required-operation semantics.
- `repository-integrity`: equivalent import spellings receive the same package-policy enforcement.

## Impact

- Affected areas: `composition-runtime`, `runtime-presets`, `extension-protocols`, `host-omp`, `extension-evolution`, `extension-memory`, `extension-memory-vectors`, `extension-codegraph`, `extension-inference-pi`, both logging exporters, repository checks, and their tests. SQLite/YAML formats, remote vector schemas, tool inventories, and host protocol versions need no planned migration or expansion.
- Owning documentation: architecture overview/composition/protocols, OMP host, Evolution, memory, semantic-memory operations, CodeGraph, runtime logging, and verification. Update the documentation index only if ownership or paths actually change.
- The unimplemented `advance-memory-context-engine` remains separate: no tiered projections, extraction queues, working memory, new ranking features, or new semantic relationships are included. Its overlapping recall and projection plans must be rebased on this change before either overlapping implementation proceeds.
- Preserve already implemented active deltas, particularly `remediate-core-audit-findings`, both runtime-logging changes, and `add-proactive-evolution-signals`. Do not archive, sync, or rewrite another change as part of this proposal.
- No new generic framework, backend superclass, package-edge policy, native-host channel, background scheduler, mandatory service, or dependency upgrade. No personal Runtime Preset/state changes, commits, releases, or deployment.
- This workflow creates planning artifacts only. Implementation, test-code changes, documentation changes outside this change directory, and apply execution require a new explicit request.
