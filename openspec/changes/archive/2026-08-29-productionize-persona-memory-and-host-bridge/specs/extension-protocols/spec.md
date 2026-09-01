## Purpose

Defines host-neutral context, tool, and lifecycle contracts that preserve authority, validation, committed state, and failure information across adapters without introducing host concepts into feature extensions.

## ADDED Requirements

### Requirement: Context contributions preserve authority and provenance
Context providers SHALL return source-identified contributions with explicit authority and deterministic priority. Assembly SHALL preserve the host's existing prompt, enforce the supplied token budget, and report accepted and omitted sources.

#### Scenario: Multiple providers contribute context
- **WHEN** identity, traits, memory, and another extension resolve context for one turn
- **THEN** their contributions are assembled deterministically by authority-aware priority within the host budget

#### Scenario: Provider contribution is too large
- **WHEN** a whole contribution cannot fit and it does not explicitly permit safe truncation
- **THEN** it is omitted and its source is reported

### Requirement: Tool definitions use transport-neutral JSON Schema
A tool definition SHALL include a stable qualified name, description, supported JSON Schema input contract, availability, and transport-neutral invocation result. Registration changes SHALL be observable by active host adapters.

#### Scenario: Tool is added during reload
- **WHEN** a valid composition update registers a tool
- **THEN** the host adapter receives the new descriptor and can project it without restarting the session

#### Scenario: Tool is removed during reload
- **WHEN** the owning extension unloads
- **THEN** the tool becomes unavailable and active hosts are notified

### Requirement: Tool invocation errors remain structured
Tool invocation SHALL return a success value or a structured error with a stable code and message. Host transport failures SHALL remain distinguishable from domain invocation failures.

#### Scenario: Memory rejects a secret
- **WHEN** a host invokes a memory tool with secret content
- **THEN** the host receives the memory error code rather than a generic transport failure

### Requirement: Lifecycle events identify committed work
Host-neutral lifecycle SHALL distinguish session start/completion, turn start/commit, tool start/completion, and pre-compaction. Every event SHALL carry stable session identity and relevant events SHALL carry stable turn and call identities.

#### Scenario: Turn completes normally
- **WHEN** a host commits a completed assistant turn
- **THEN** one turn-committed event contains the principal input, completed assistant output, associated tool outcomes, timestamp, and completed outcome

#### Scenario: Host emits streaming updates
- **WHEN** partial assistant or tool updates occur before commit
- **THEN** they do not masquerade as a committed turn or completed tool result

### Requirement: Lifecycle outcomes and errors are faithful
Completion events SHALL represent completed, failed, or cancelled outcomes using available host facts and SHALL include structured error information when the host provides it. Adapters SHALL NOT report unknown shutdown or aborted work as successful completion.

#### Scenario: Tool execution fails
- **WHEN** the host reports a tool error and result payload
- **THEN** the normalized tool-completed event retains the failed outcome and serializable result or structured error information available from the host

#### Scenario: Session shutdown has no outcome evidence
- **WHEN** the host only announces teardown without a completion reason
- **THEN** the adapter emits a neutral disposal notification or omits session completion rather than fabricating a completed outcome

### Requirement: Pre-compaction is observational and bounded
Hosts that expose a pre-compaction hook SHALL publish a normalized pre-compaction event containing only the bounded serializable material required by subscribers. Host cancellation handles, runtime objects, and complete unbounded transcripts SHALL not cross the protocol.

#### Scenario: OMP prepares compaction
- **WHEN** OMP publishes its pre-compaction hook
- **THEN** subscribed extensions can observe stable session context and bounded messages before compaction without controlling OMP compaction

#### Scenario: Host lacks pre-compaction
- **WHEN** another host does not expose an equivalent hook
- **THEN** the rest of the lifecycle protocol remains usable and no synthetic pre-compaction event is required

### Requirement: Lifecycle delivery supports idempotent consumers
Events that can cause persistent mutations SHALL carry deterministic delivery identity. Duplicate publication of the same committed event SHALL be recognizable by consumers.

#### Scenario: Adapter retries event publication
- **WHEN** the same turn-committed event is delivered more than once after a transport uncertainty
- **THEN** consumers receive the same event identity and can avoid duplicate mutations

### Requirement: Protocol payloads are serializable and bounded
Context requests, tool descriptors and results, lifecycle events, diagnostics, and notifications crossing a host transport SHALL be JSON-serializable and subject to explicit size limits or bounded projection. Unsupported runtime values SHALL be omitted or represented as structured truncation metadata rather than crashing the runtime.

#### Scenario: Tool result contains non-serializable host details
- **WHEN** an adapter forwards a completed tool result containing unsupported values
- **THEN** it emits a bounded serializable representation and records that information was omitted

### Requirement: Subscriber failure is contained
A lifecycle subscriber failure SHALL be reported diagnostically without corrupting protocol registration or terminating unrelated host operation. A host adapter MAY apply event-specific deadlines and fail-open behavior.

#### Scenario: Optional capture fails on turn commit
- **WHEN** a capture subscriber throws
- **THEN** the committed host turn remains successful and the failure is observable through diagnostics

### Requirement: Protocols remain domain-neutral
The context, tool, and lifecycle contracts SHALL NOT require persona, memory, project, SQLite, OMP, or model-provider concepts. Domain extensions and host adapters translate their own metadata at the protocol seam.

#### Scenario: Non-persona composition uses protocols
- **WHEN** a generic composition registers context, tools, or lifecycle subscribers
- **THEN** it can use the protocols without installing persona or memory extensions
