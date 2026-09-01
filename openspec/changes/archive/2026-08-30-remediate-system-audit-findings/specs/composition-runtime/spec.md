## ADDED Requirements

### Requirement: Equivalent activation inputs share one canonicalizer
Composition Definition construction and serialized activation decoding SHALL use one internal canonicalization contract for non-empty identifiers, absolute paths, immutable patch data, optional-field omission, and deterministic diagnostics. Public entry points MAY add context-specific fields but SHALL NOT implement divergent normalization rules.

#### Scenario: Direct and serialized activation describe the same composition
- **WHEN** equivalent values enter through the direct Composition Definition API and the serialized host activation API
- **THEN** both produce equivalent canonical composition, path, patch, and diagnostic values

#### Scenario: An optional value is absent
- **WHEN** an optional activation field is not provided
- **THEN** canonical output omits the field rather than assigning `undefined`

## MODIFIED Requirements

### Requirement: Deterministic disposal
Session and runtime disposal SHALL be idempotent, await in-flight lifecycle mutations, remove associated watchers, attempt every owned cleanup stage even when another stage fails, and await Cordis resource quiescence. A session SHALL unregister itself in a `finally`-equivalent path. Runtime disposal SHALL attempt all sibling sessions and owned root resources before reporting collected cleanup failures, and SHALL never dispose a caller-owned root context.

#### Scenario: Dispose one session
- **WHEN** a caller disposes an active session
- **THEN** only that session's plugin tree and watchers are released and the session is removed from runtime ownership before disposal completes

#### Scenario: One plugin disposer throws
- **WHEN** an owned plugin disposer fails while the session also owns watchers and sibling effects
- **THEN** the runtime still removes the watchers, disposes the remaining effects, unregisters the session, and reports the cleanup failure after all reachable cleanup completes

#### Scenario: Dispose runtime with one failing session
- **WHEN** one active session rejects disposal and other sessions and an owned Cordis root remain
- **THEN** every sibling session and the owned root are still disposed before the runtime reports an aggregate cleanup failure

#### Scenario: Repeated disposal
- **WHEN** session or runtime disposal is requested again after successful or partially failing cleanup
- **THEN** the request completes without repeating already completed side effects or reviving removed ownership
