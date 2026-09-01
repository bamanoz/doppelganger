# Extension Protocols Specification

## Purpose

Defines host-neutral context, tool, and lifecycle contracts through which arbitrary Cordis plugins can affect an agent without depending on a concrete host.

## Requirements

### Requirement: Context provider registry
Feature plugins SHALL be able to register scoped context providers whose registrations follow the owning plugin lifecycle.

#### Scenario: Provider contributes context
- **ID**: `extension-protocols.context.provider-contributes`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::resolves turn-sensitive providers in deterministic priority order within budget`
- **WHEN** a host requests context for a turn
- **THEN** every active provider in the session scope can return context contributions for that request

#### Scenario: Provider is disposed
- **ID**: `extension-protocols.context.provider-disposed`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::resolves turn-sensitive providers in deterministic priority order within budget`
- **WHEN** the plugin owning a context provider is disposed or reloaded
- **THEN** the provider is no longer included in subsequent context resolution

### Requirement: Context assembly
The context assembler SHALL combine active contributions deterministically and SHALL enforce the token budget supplied for the host request.

#### Scenario: Contributions exceed budget
- **ID**: `extension-protocols.context.budget-priority`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::resolves turn-sensitive providers in deterministic priority order within budget`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::truncates opted-in contributions and omits lower-priority content`
- **WHEN** resolved contributions exceed the available persona-context budget
- **THEN** the assembler retains higher-priority configured contributions and excludes lower-priority content until the result fits the budget

#### Scenario: Turn-sensitive provider
- **ID**: `extension-protocols.context.turn-sensitive-provider`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::resolves turn-sensitive providers in deterministic priority order within budget`
- **WHEN** a provider uses the current turn to select relevant content
- **THEN** the assembled result reflects the current request without changing the provider's registration

### Requirement: Transport-neutral tool registry
Feature plugins SHALL register namespaced tool definitions in a session-scoped registry that supports discovery and invocation without exposing host-specific tool objects.

#### Scenario: Host discovers tools
- **ID**: `extension-protocols.tools.host-discovers`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **WHEN** a host adapter lists active persona tools
- **THEN** it receives each tool's stable namespaced name, description, input contract, and availability

#### Scenario: Host invokes a tool
- **ID**: `extension-protocols.tools.host-invokes`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **WHEN** a host invokes a listed tool with valid input
- **THEN** the registry executes the owning plugin handler and returns a transport-neutral result or structured error

#### Scenario: Plugin tool is removed
- **ID**: `extension-protocols.tools.plugin-tool-removed`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **WHEN** the owning plugin is disposed or reloaded without the tool
- **THEN** the tool is no longer reported as available

### Requirement: Normalized lifecycle events
Host plugins SHALL emit normalized session, turn, and tool observation events through the session Cordis event system.

#### Scenario: Agent turn completes
- **ID**: `extension-protocols.lifecycle.agent-turn-completes`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** the host reports completion of a model turn
- **THEN** active plugins observing the normalized turn event receive its session identity and outcome

#### Scenario: Host tool executes
- **ID**: `extension-protocols.lifecycle.host-tool-executes`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host tool starts and completes
- **THEN** active observers receive normalized before and after events associated with the same tool call

### Requirement: Optional host-specific services
A host MAY expose additional operations as explicitly named optional services, and absence of an optional service SHALL NOT prevent an otherwise compatible plugin from activating.

#### Scenario: Optional service unavailable
- **ID**: `extension-protocols.plugins.optional-service-unavailable`
- **EVIDENCE**: `packages/composition-runtime/tests/composition-runtime.spec.ts::joins runtime-owned plugins to explicitly declared optional service realms`
- **WHEN** a plugin can operate without a host-specific optional service and the host does not provide it
- **THEN** the plugin activates with the related optional behavior disabled

### Requirement: Context contributions preserve authority and provenance
Context providers SHALL return source-identified contributions with explicit authority and deterministic priority. Assembly SHALL preserve the host's existing prompt, enforce the supplied token budget, and report accepted and omitted sources.

#### Scenario: Multiple providers contribute context
- **ID**: `extension-protocols.context.authority-aware-assembly`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::resolves turn-sensitive providers in deterministic priority order within budget`
- **WHEN** identity, traits, memory, and another extension resolve context for one turn
- **THEN** their contributions are assembled deterministically by authority-aware priority within the host budget

#### Scenario: Provider contribution is too large
- **ID**: `extension-protocols.context.oversized-contribution-omitted`
- **EVIDENCE**: `packages/extension-protocols/tests/context-protocol.spec.ts::truncates opted-in contributions and omits lower-priority content`
- **WHEN** a whole contribution cannot fit and it does not explicitly permit safe truncation
- **THEN** it is omitted and its source is reported

### Requirement: Tool definitions use transport-neutral JSON Schema
A tool definition SHALL include a stable qualified name, description, supported JSON Schema input contract, availability, and transport-neutral invocation result. Registration changes SHALL be observable by active host adapters.

#### Scenario: Tool is added during reload
- **ID**: `extension-protocols.tools.added-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::applies valid preset updates, rolls invalid changes back, and preserves state across reload`
- **WHEN** a valid composition update registers a tool
- **THEN** the host adapter receives the new descriptor and can project it without restarting the session

#### Scenario: Tool is removed during reload
- **ID**: `extension-protocols.tools.removed-during-reload`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::discovers, updates, invokes, and removes lifecycle-owned tools`
- **EVIDENCE**: `packages/host-omp/tests/child-integration.spec.ts::rebuilds ordered user/project layers and rejects stale tools after committed reload`
- **WHEN** the owning extension unloads
- **THEN** the tool becomes unavailable and active hosts are notified

### Requirement: Tool invocation errors remain structured
Tool invocation SHALL return a success value or a structured error with a stable code and message. Host transport failures SHALL remain distinguishable from domain invocation failures.

#### Scenario: Memory rejects a secret
- **ID**: `extension-protocols.tools.memory-secret-error`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns serializable structured domain and execution errors`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::runs the complete actor-partitioned memory lifecycle through OMP tool RPC`
- **WHEN** a host invokes a memory tool with secret content
- **THEN** the host receives the memory error code rather than a generic transport failure

### Requirement: Lifecycle events identify committed work
Host-neutral lifecycle SHALL distinguish session start/completion, turn start/commit, tool start/completion, and pre-compaction. Every event SHALL carry stable session identity, relevant events SHALL carry stable turn and call identities, and each completed tool result SHALL be represented only by its correlated `tool-completed` event rather than duplicated in `turn-committed`.

#### Scenario: Turn completes normally
- **ID**: `extension-protocols.lifecycle.turn-committed-payload`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host commits a completed assistant turn that included tool calls
- **THEN** one `turn-committed` event contains the principal input, completed assistant output, timestamp, and completed outcome without tool outcome payloads

#### Scenario: Tool completes within a turn
- **ID**: `extension-protocols.lifecycle.tool-outcome-owned-by-completion`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **WHEN** a host tool completes before its enclosing turn is committed
- **THEN** the bounded result or structured error is carried only by the correlated `tool-completed` event with stable turn and call identities

#### Scenario: Host emits streaming updates
- **ID**: `extension-protocols.lifecycle.streaming-is-not-committed`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** partial assistant or tool updates occur before commit
- **THEN** they do not masquerade as a committed turn or completed tool result

### Requirement: Lifecycle outcomes and errors are faithful
Completion events SHALL represent completed, failed, or cancelled outcomes using available host facts and SHALL include structured error information when the host provides it. Adapters SHALL NOT report unknown shutdown or aborted work as successful completion.

#### Scenario: Tool execution fails
- **ID**: `extension-protocols.lifecycle.failed-tool-outcome`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **EVIDENCE**: `packages/extension-protocols/tests/tool-registry.spec.ts::returns serializable structured domain and execution errors`
- **WHEN** the host reports a tool error and result payload
- **THEN** the normalized tool-completed event retains the failed outcome and serializable result or structured error information available from the host

#### Scenario: Session shutdown has no outcome evidence
- **ID**: `extension-protocols.lifecycle.neutral-session-disposal`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::keeps completed, failed, cancelled, partial, committed, and neutral disposal semantics distinct`
- **WHEN** the host only announces teardown without a completion reason
- **THEN** the adapter emits a neutral disposal notification or omits session completion rather than fabricating a completed outcome

### Requirement: Lifecycle delivery supports idempotent consumers
Events that can cause persistent mutations SHALL carry deterministic delivery identity. Duplicate publication of the same committed event SHALL be recognizable by consumers.

#### Scenario: Adapter retries event publication
- **ID**: `extension-protocols.lifecycle.idempotent-delivery`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::publishes versioned committed work with stable session, turn, call, and delivery identities`
- **EVIDENCE**: `packages/host-omp/tests/vertical.spec.ts::captures committed OMP turns only as idempotent review candidates`
- **WHEN** the same turn-committed event is delivered more than once after a transport uncertainty
- **THEN** consumers receive the same event identity and can avoid duplicate mutations

### Requirement: Protocol payloads are serializable and bounded
Context requests, tool descriptors and results, lifecycle events, diagnostics, and notifications crossing a host transport SHALL be JSON-serializable and subject to explicit size limits or bounded projection. Unsupported runtime values SHALL be omitted or represented as structured truncation metadata rather than crashing the runtime.

#### Scenario: Tool result contains non-serializable host details
- **ID**: `extension-protocols.lifecycle.bounded-serializable-tool-result`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::serializes circular, binary, oversized, deep, and unsupported host values within explicit bounds`
- **WHEN** an adapter forwards a completed tool result containing unsupported values
- **THEN** it emits a bounded serializable representation and records that information was omitted

### Requirement: Subscriber failure is contained
A lifecycle subscriber failure SHALL be reported diagnostically without corrupting protocol registration or terminating unrelated host operation. A host adapter MAY apply event-specific deadlines and fail-open behavior.

#### Scenario: Optional capture fails on turn commit
- **ID**: `extension-protocols.lifecycle.subscriber-failure-contained`
- **EVIDENCE**: `packages/extension-protocols/tests/lifecycle.spec.ts::contains subscriber failure while independent subscribers observe committed work`
- **WHEN** a capture subscriber throws
- **THEN** the committed host turn remains successful and the failure is observable through diagnostics

### Requirement: Protocols remain domain-neutral
The context, tool, and lifecycle contracts SHALL NOT require persona, memory, project, SQLite, OMP, or model-provider concepts. Domain extensions and host adapters translate their own metadata at the protocol seam.

#### Scenario: Non-persona composition uses protocols
- **ID**: `extension-protocols.domain-neutral.generic-composition`
- **EVIDENCE**: `packages/host-omp/tests/adapter.spec.ts::executes a generic serialized activation without preset assembly`
- **WHEN** a generic composition registers context, tools, or lifecycle subscribers
- **THEN** it can use the protocols without installing persona or memory extensions
