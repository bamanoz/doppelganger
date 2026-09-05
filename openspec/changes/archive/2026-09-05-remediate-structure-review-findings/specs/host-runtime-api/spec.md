## MODIFIED Requirements

### Requirement: Every adapter passes common conformance
Before a host adapter is supported, it SHALL pass the same transport-independent conformance suite for two-session isolation, empty context and tools, closed capability validation, atomic catalog replacement, stale tool revision, approval replay, cancellation/completion races, undeclared lifecycle rejection, independence of the Actor Identity states supported by that adapter, disposal during active calls, and late callbacks after binding replacement.
True Actor Identity provider absence SHALL remain independently verified at the common protocol boundary. OMP SHALL verify explicit unbound and bound states through its real transport because every OMP activation installs the provider; this SHALL NOT introduce a production absence switch or substitute a direct bridge for OMP evidence.
A transported adapter SHALL satisfy those cases through its actual adapter entrypoints, request/response mapping and owned transport; substituting a direct underlying bridge SHALL not constitute adapter conformance. Fixture controls SHALL remain outside production contracts and SHALL wait for observable completion rather than fixed sleeps. Direct bridge semantics remain independently covered without being labelled transported-adapter proof.

#### Scenario: New direct adapter claims support
- **ID**: `host.runtime.api.new-direct-adapter-claims-support`
- **EVIDENCE**: `packages/extension-protocols/tests/runtime-host.spec.ts::attaches without actor identity and preserves canonical empty optional protocols`
- **WHEN** a direct in-process adapter implements the shared Runtime Host API
- **THEN** it passes the same observable scenarios as a transported adapter with explicit protocol-level evidence for provider absence and real transported evidence for every state the transported adapter supports

#### Scenario: Transported catalog is replaced during use
- **ID**: `host.runtime.api.conformance.transported-catalog`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::preserves catalog and stale-revision semantics through the real OMP adapter`
- **WHEN** the common conformance fixture replaces a tool set through the actual OMP child and catalog path
- **THEN** the adapter exposes the current atomic snapshot and rejects retained stale descriptors through the real invocation mapping

#### Scenario: Transported approval grant is replayed
- **ID**: `host.runtime.api.conformance.transported-approval`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::enforces one-shot approval through the real OMP adapter`
- **WHEN** the common conformance fixture repeats a protected grant through the actual OMP invocation path
- **THEN** exactly the authorized first invocation reaches the handler and the replay fails through the transported result contract

#### Scenario: Transported active call is cancelled and disposed
- **ID**: `host.runtime.api.conformance.transported-call-lifecycle`
- **EVIDENCE**: `packages/host-omp/tests/runtime-host-conformance.spec.ts::settles cancellation and disposal through the real OMP adapter`
- **WHEN** the common conformance fixture cancels or disposes a held active call through the actual OMP adapter
- **THEN** the call settles with the correct correlated cancellation or disposal outcome and late completion cannot reattach its retired binding
