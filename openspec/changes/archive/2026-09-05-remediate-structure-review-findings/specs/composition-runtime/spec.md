## MODIFIED Requirements

### Requirement: Transactional composition reload
The runtime SHALL serialize reloads per session and commit only a fully audited update. On candidate failure it SHALL attempt to restore the last valid composition using the same settlement and acceptance audit as a candidate. It SHALL report successful rollback only when that restoration passes audit. If restoration fails or cannot be audited, the runtime SHALL expose observed restoration diagnostics and the candidate/restoration failure without replacing them with a stale healthy snapshot. The session owner SHALL remain available for explicit retry and exhaustive disposal; the runtime SHALL NOT claim the prior tree is usable when its restoration failed.

#### Scenario: Valid update commits
- **ID**: `composition.runtime.reload.valid.commit`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** a watched composition changes to another valid plugin tree
- **THEN** the next session interaction observes the updated composition

#### Scenario: Invalid update rolls back
- **ID**: `composition.runtime.reload.invalid.rollback`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::rebuilds edit/create/delete generations and rolls invalid layers back`
- **WHEN** an update produces a failed, missing, or pending enabled entry and restoring the last valid tree passes audit
- **THEN** the runtime restores the last valid tree and exposes reload diagnostics without terminating the session

#### Scenario: Restored tree does not satisfy the activation audit
- **ID**: `composition.runtime.reload.restoration-audit-failure`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::reports observed rollback audit failures without restoring stale healthy diagnostics`
- **WHEN** an invalid candidate is rolled back but the restored tree contains an enabled failed or pending entry
- **THEN** reload diagnostics report the actual restored entry state and restoration failure instead of a successful rollback or the previous healthy entry snapshot

#### Scenario: Restoration update itself throws
- **ID**: `composition.runtime.reload.restoration-update-failure`
- **EVIDENCE**: `packages/composition-runtime/tests/reload.spec.ts::aggregates candidate and restoration errors while retaining disposal ownership`
- **WHEN** restoring the prior effective tree throws after a candidate update fails
- **THEN** the session exposes both failures without claiming recovery and still exhausts owned resources when explicitly disposed
