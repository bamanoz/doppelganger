## ADDED Requirements

### Requirement: OMP context projection retains runtime authority
The OMP adapter SHALL project instruction-authority context only through OMP's system-instruction surface and SHALL project data-authority context through an explicitly delimited non-instruction data surface available to the same agent run. If OMP cannot preserve this distinction for a contribution, the adapter SHALL omit that contribution diagnostically rather than promote it.

#### Scenario: Memory contributes attacker-influenced data
- **ID**: `host.omp.context.data-authority-not-system-instruction`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::keeps data-authority runtime context out of system instructions`
- **WHEN** memory, Evolution, or another provider contributes data-authority text containing instruction-like content
- **THEN** OMP receives it only as delimited data for the active run and the text is not appended as a system instruction

#### Scenario: Identity contributes runtime instructions
- **ID**: `host.omp.context.instruction-authority-system-projection`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects instruction-authority context while preserving host prompts`
- **WHEN** a trusted provider contributes instruction-authority context
- **THEN** the adapter appends that instruction projection to the existing OMP system prompt without replacing host instructions or retaining conversation history

## MODIFIED Requirements

### Requirement: Runtime context projection
Before each user-initiated OMP agent run, the adapter SHALL request current authority-preserving assembled context exactly once from the active binding using the direct principal input and a newly established stable turn identity. It SHALL preserve existing host instructions, project instruction and data authority through distinct host-safe surfaces for that run, and SHALL NOT persist synthetic conversation history. Every model continuation after tool calls in the same run SHALL reuse the same authority-separated snapshot.

#### Scenario: Runtime context changes between user turns
- **ID**: `runtime.context.reload`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::resolves runtime context once per agent run and keeps one snapshot through tool continuations`
- **WHEN** a valid composition or asset update reloads successfully
- **THEN** the next user-initiated OMP agent run receives the current instruction and data projections with their authority unchanged

#### Scenario: Existing host instructions are preserved
- **ID**: `runtime.context.system-prompt-append`
- **EVIDENCE**: `packages/host-omp/tests/extension.spec.ts::projects instruction-authority context while preserving host prompts`
- **WHEN** non-empty Doppelganger context is resolved before an agent run
- **THEN** only instruction-authority content is appended to the existing OMP system prompt while data-authority content remains separately delimited
