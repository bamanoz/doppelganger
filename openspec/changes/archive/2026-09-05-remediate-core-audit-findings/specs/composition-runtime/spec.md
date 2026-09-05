## ADDED Requirements

### Requirement: Watch acquisition is part of session activation
When watching is enabled, all required input-watch registrations SHALL be acquired as owned activation resources before the Runtime Session is returned. Failure to acquire any watch SHALL unwind previously acquired watches, dispose the attempted session Fiber to quiescence, unregister runtime ownership, and report the original failure together with any cleanup failures.

#### Scenario: Watch registration rejects after plugins activate
- **ID**: `composition.runtime.activation.watch-registration-failure-cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::cleans the attempted session when watch registration fails after activation`
- **WHEN** the Loader tree is active but one HMR input registration rejects
- **THEN** activation rejects only after every acquired watch and session-owned effect has been disposed and no attempted session remains runtime-owned

#### Scenario: Cleanup of a failed watch registration also fails
- **ID**: `composition.runtime.activation.watch-registration-aggregate-cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::aggregates watch acquisition and attempted-session cleanup failures`
- **WHEN** watch acquisition rejects and one cleanup stage also rejects
- **THEN** all remaining cleanup stages are attempted and the caller receives an aggregate failure preserving the acquisition cause

### Requirement: Patch validation reports configuration diagnostics
Composition patch validation SHALL validate entry field types before using them, collect all ordinary malformed-field diagnostics, and return `RuntimeConfigurationError` or `CompositionLayerError` at the patch seam rather than incidental JavaScript method or property errors.

#### Scenario: Inserted entry has a non-string name
- **ID**: `composition.runtime.patch.non-string-name-diagnostic`
- **EVIDENCE**: `packages/composition-runtime/tests/patches.spec.ts::reports structured diagnostics for malformed inserted entry fields`
- **WHEN** a patch inserts an entry whose `name` is not a non-empty string
- **THEN** patch definition fails with a diagnostic identifying the exact entry path and does not invoke string operations on the invalid value

## MODIFIED Requirements

### Requirement: Audited activation
The runtime SHALL audit the complete Loader tree after dependency settlement and SHALL return a session only when every enabled entry is active and every required activation-owned watch has been registered. Any failure before return SHALL dispose the complete attempted session.

#### Scenario: Partial activation is cleaned up
- **ID**: `composition.runtime.activation.partial.cleanup`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::cleans the attempted session when watch registration fails after activation`
- **WHEN** any composition entry, audit step, or activation-owned watch registration fails
- **THEN** the runtime disposes every resource created for that attempted session before rejecting activation
