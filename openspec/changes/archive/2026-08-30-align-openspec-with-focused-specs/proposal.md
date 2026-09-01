## Why

The live OpenSpec corpus has correct `WHEN`/`THEN` syntax but does not satisfy the project's Focused Specs contract: scenarios are not linked to executable evidence, several capabilities duplicate ownership, and some scenarios combine independently failing outcomes. This makes requirement drift possible even while repository verification passes.

## What Changes

- Introduce a focused-spec governance contract for live OpenSpec scenarios, including stable ownership, one independently failing behavior per scenario, one request and one user-visible or durable outcome, and explicit executable-evidence linkage.
- Consolidate overlapping live capabilities so activation/reload/disposal, Runtime Preset selection, Persona behavior, and memory behavior each have one authoritative spec owner.
- Remove obsolete or superseded live requirements instead of preserving parallel formulations; archived changes remain untouched as historical evidence.
- Split compound scenarios whose observations can fail independently, while keeping transactionally inseparable infrastructure evidence together.
- Add repository verification that rejects malformed focused scenarios, duplicate scenario identities or ownership, missing executable evidence, and evidence references that no longer resolve.
- Preserve all implemented product behavior and public runtime contracts; this change reorganizes and strengthens specifications and their verification rather than changing runtime semantics.

## Capabilities

### New Capabilities

- `focused-spec-governance`: Defines the required shape, ownership, executable-evidence linkage, and validation rules for live OpenSpec scenarios.

### Modified Capabilities

- `repository-integrity`: Extends the root integrity workflow to enforce focused-spec structure, ownership, and evidence resolution for live OpenSpec artifacts.

## Impact

- Affects `openspec/specs/`, focused-spec guidance under `docs/modes/`, repository-integrity scripts and tests, and existing package tests used as executable evidence.
- Removes the obsolete live `runtime-kernel` spec after its remaining contracts are reconciled into `composition-runtime`.
- Consolidates overlapping Runtime Preset, Persona, OMP, memory, and semantic-memory scenarios without changing production APIs, persisted data, dependencies, or runtime behavior.
- Archived OpenSpec changes remain unchanged and excluded from live focused-spec enforcement.
