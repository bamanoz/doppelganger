## MODIFIED Requirements

### Requirement: Recall authority and budget
Automatic recall SHALL contribute an eligible stable relationship-profile subset before query-ranked memory, SHALL treat ordinary records as data, SHALL treat approved preference records as behavioral contributions, and SHALL respect the host-provided context budget. The stable subset SHALL contain pinned relationship preferences and relationship facts whose subject key is under `principal.identity.*`; it SHALL remain subject to actor partition, active status, temporal eligibility, whole-record budgeting, and canonical current-revision validation.
One memory-owned automatic-recall operation SHALL combine stable-profile and ranked candidates and perform a final canonical validation of both after asynchronous retrieval completes. It SHALL deduplicate by canonical identity, preserve deterministic whole-record priority/budget decisions, and return no candidate whose partition, status, temporal eligibility or current revision became invalid. The protocol adapter SHALL render that final selection rather than maintain a separate stable snapshot. Approved active preferences SHALL retain their existing behavioral authority even when unpinned and selected by query; pinning governs stable inclusion and precedence rather than changing that authority.

#### Scenario: Stable relationship profile does not lexically match
- **ID**: `context.stable-profile-recall`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::automatically recalls stable relationship profile without lexical overlap`
- **WHEN** a current turn has no lexical overlap with an eligible relationship identity fact and a pinned relationship preference
- **THEN** automatic recall contributes both stable records before ordinary ranked data, excludes unpinned preferences and temporally ineligible identity facts, and contributes any duplicate ranked record only once

#### Scenario: Pinned global preference exists
- **ID**: `context.pinned-precedence-budget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-search.spec.ts::uses lexical retrieval with strict scope, pinned relationship precedence, diversity, and whole budgets`
- **WHEN** persona context is assembled
- **THEN** the pinned preference is considered before stable identity and ranked memory, and lower-priority records are omitted when required by the budget

#### Scenario: Stable memory changes while semantic recall is pending
- **ID**: `memory.recall.stable-final-revalidation`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::revalidates stable and ranked memory after asynchronous recall`
- **WHEN** a stable-profile record is corrected, forgotten, expired or made inactive while asynchronous ranked retrieval is pending
- **THEN** the final automatic context contains only eligible current canonical revisions and never the stale stable snapshot

#### Scenario: Combined recall exceeds its budget
- **ID**: `memory.recall.combined-whole-record-budget`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::budgets deduplicated stable and ranked recall as one selection`
- **WHEN** stable and ranked sources overlap and their eligible whole records exceed the supplied recall budget
- **THEN** the final selection counts each record once, preserves existing priority and authority, and omits whole lower-priority records to stay within the hard budget

#### Scenario: Unpinned approved preference is query relevant
- **ID**: `memory.recall.unpinned-approved-preference-authority`
- **EVIDENCE**: `packages/extension-memory/tests/memory-protocol.spec.ts::preserves approved preference authority independently of pinning`
- **WHEN** ranked recall selects an approved active unpinned preference and an ordinary fact
- **THEN** the preference retains behavioral instruction authority while the fact remains data and neither bypasses canonical eligibility or the budget
