## Why

The current vertical proves portable persona context, tools, scoped memory, process isolation, and reload, but its memory model and OMP bridge still omit the isolation, reconciliation, idempotency, lifecycle fidelity, and schema projection required for trustworthy production use. Hardening these seams now prevents automatic learning, additional personas, and future hosts from being built on ambiguous ownership or lossy host events.

## What Changes

- **BREAKING**: Replace memory's ambiguous `global` scope with relationship scope partitioned by persona instance and principal, while retaining project scope beneath the same partition.
- **BREAKING**: Extend canonical memory records with stable subject keys, confidence, salience, temporal validity, evidence, conflict state, and idempotent operation identity; migrate existing instance databases without losing active records or revision history.
- Deepen memory mutation and reconciliation so explicit writes, inferred candidates, corroboration, contradiction, correction, expiry, conflict resolution, and deletion preserve authority and provenance under concurrent sessions.
- Replace uncalibrated lexical-plus-semantic score addition with scope-safe rank fusion, subject diversity, deterministic budgeting, and stale-index suppression.
- Require semantic retrievers to return canonical record and revision identities so stale, superseded, expired, or deleted results are rejected before context projection; derived indexes remain rebuildable and non-authoritative.
- Add an optional candidate-capture plugin driven by committed lifecycle events. It filters recursive, trivial, secret, and low-value content and may create candidates only; it does not persist full transcripts or perform hidden shutdown extraction.
- Enrich host-neutral lifecycle events with committed turn output, actual tool results, structured errors, cancellation/failure outcomes, stable identifiers, and pre-compaction notification where the host provides them.
- Harden the OMP adapter by accurately translating supported JSON Schema into OMP tool schemas, forwarding complete available lifecycle payloads, and keeping Doppelganger failure isolated from ordinary OMP behavior.
- Remove Aiden selection from the generic OMP adapter. Resolve a serialized composition activation before entering the transport adapter so the adapter remains host-specific but composition- and persona-neutral.
- Keep MemPalace and other episodic archives out of the authoritative memory path. A future archive adapter may consume the outbox or lifecycle protocols without changing canonical memory semantics.

## Capabilities

### New Capabilities

- `persona-memory`: Production canonical persona memory, partitioning, provenance, reconciliation, capture policy, retrieval, indexing projections, and deletion guarantees.
- `extension-protocols`: Complete host-neutral context, tool-schema, and lifecycle contracts required by stateful extensions.
- `hosts/oh-my-pi`: Composition-neutral OMP activation, precise context/tool projection, lifecycle forwarding, and failure isolation.

### Modified Capabilities

None. The predecessor capabilities have not yet been archived into the main spec store; this change supplies their production requirements as new delta capabilities.

## Impact

- Changes `packages/extension-memory`, `packages/extension-protocols`, `packages/extension-persona`, `packages/host-omp`, and `packages/preset-aiden`; `packages/composition-runtime` remains domain-neutral.
- Introduces a versioned SQLite migration and new instance/principal activation metadata. Existing memory content and revision lineage must migrate in place.
- Changes serialized activation and lifecycle RPC payloads between the OMP extension and child runtime; both sides are updated as one clean cutover without compatibility aliases.
- Adds an optional capture extension, but no bundled model, embedding provider, external indexing worker, MemPalace dependency, transcript archive, daemon, or second host.
- Preserves fail-open host behavior: unavailable memory, capture, semantic indexing, or Doppelganger child runtime must not terminate or disable ordinary OMP operation.