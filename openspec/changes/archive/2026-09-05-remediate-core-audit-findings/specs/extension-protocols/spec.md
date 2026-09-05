## ADDED Requirements

### Requirement: Closed protocol values reject executable object coercion
Tool inputs, schemas, results, lifecycle values, capability values, and other protocol-owned JSON data SHALL be validated as plain JSON-compatible values before cloning, hashing, freezing, or transport. Validation SHALL reject cycles, unsupported prototypes, accessors or coercion hooks whose execution could change the represented value, and non-finite numbers.

#### Scenario: Tool input supplies a custom coercion hook
- **ID**: `extension-protocols.closed-json.reject-custom-coercion`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::rejects non-plain tool input before cloning or approval digesting`
- **WHEN** a tool invocation input contains a class instance or custom `toJSON` implementation
- **THEN** the registry returns an invalid-input result without executing the hook or deriving approval authority from its coerced output

### Requirement: Tool owner disposal settles owned active calls
Each active tool invocation SHALL retain the exact owning tool-set identity and tool revision. Replacing or disposing an owned set SHALL abort calls whose implementation is removed or revised, await their settlement during owner disposal, and prevent a removed implementation from returning a successful current result.

#### Scenario: Tool owner is disposed during an active call
- **ID**: `extension-protocols.tools.owner-disposal-cancels-active-call`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::aborts and settles active calls when their owner is disposed`
- **WHEN** a plugin is disposed while one of its handlers is still executing
- **THEN** that call observes its abort signal and completes with a structured unavailable or cancelled result before owner disposal settles

#### Scenario: Unchanged tool survives owner-set replacement
- **ID**: `extension-protocols.tools.unchanged-revision-retains-active-call`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::retains active calls only for unchanged definitions during owner replacement`
- **WHEN** an atomic owner-set replacement retains an exactly unchanged definition and revision
- **THEN** its already active calls may finish while calls belonging to removed or revised definitions are aborted

### Requirement: Tool catalog observers cannot invalidate commits
A valid registry mutation SHALL commit its complete immutable snapshot independently of notification observers. Observer failure SHALL be contained and reported diagnostically without making registration, replacement, or disposal appear to have failed after the catalog changed.

#### Scenario: Catalog observer throws during registration
- **ID**: `extension-protocols.tools.catalog-observer-contained`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::contains catalog observer failure after an atomic commit`
- **WHEN** one `tools-changed` observer throws after a valid set is committed
- **THEN** registration returns successfully, the new snapshot remains current, independent observers still run, and the observer failure is diagnostic only

### Requirement: Lifecycle event validation is a closed union
Lifecycle normalization SHALL reject every event type outside the protocol's own event-name keys, including inherited object-property names, and SHALL validate the required and permitted fields for the selected variant before publication.

#### Scenario: Capability profile uses an inherited property name
- **ID**: `extension-protocols.lifecycle.reject-inherited-event-name`
- **EVIDENCE**: `packages/extension-protocols/tests/host-capabilities.spec.ts::rejects inherited object property names as lifecycle events`
- **WHEN** a capability profile lists `constructor`, `toString`, or another inherited property as a lifecycle event
- **THEN** capability validation rejects it as unsupported

#### Scenario: Unknown lifecycle variant is normalized
- **ID**: `extension-protocols.lifecycle.reject-unknown-variant`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::rejects unknown variants and malformed variant payloads`
- **WHEN** publication supplies an unknown type or a known type with missing, extra, or malformed variant fields
- **THEN** normalization fails before any subscriber observes the event

## MODIFIED Requirements

### Requirement: Context contributions preserve authority and provenance
Context providers SHALL return source-identified contributions with explicit `instruction` or `data` authority and deterministic priority. Assembly SHALL enforce one shared token budget while retaining authority-separated immutable projections; it SHALL NOT flatten data-authority text into an instruction-authority string. Accepted and omitted sources SHALL remain observable.

#### Scenario: Multiple providers contribute context
- **ID**: `extension-protocols.context.authority-aware-assembly`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::assembles instruction and data authority without promotion`
- **WHEN** instruction providers and attacker-influenced data providers resolve context for one turn
- **THEN** both are ordered and budgeted deterministically while the assembled result keeps their authority distinct for host projection

#### Scenario: Provider contribution is too large
- **ID**: `extension-protocols.context.oversized-contribution-omitted`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::truncates opted-in contributions and omits lower-priority content`
- **WHEN** a whole contribution cannot fit and it does not explicitly permit truncation
- **THEN** it is omitted from its authority-specific projection and its source is reported
