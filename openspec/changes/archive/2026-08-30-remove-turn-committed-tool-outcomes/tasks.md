## 1. Lifecycle Protocol Contract

- [x] 1.1 Advance `LIFECYCLE_PROTOCOL_VERSION`, remove `CommittedToolOutcome` and `TurnCommittedEvent.toolOutcomes` from the protocol package and public exports, and make normalization reject legacy `turn-committed` payloads containing the removed field.
- [x] 1.2 Update lifecycle protocol tests to verify standalone correlated `tool-completed` results, `turn-committed` field absence, legacy-field rejection, stable identities, freezing, subscriber containment, and outcome semantics under the new version.

## 2. OMP Lifecycle Mapping

- [x] 2.1 Remove per-turn tool outcome storage and `turn_end.toolResults` parsing from the OMP extension while preserving turn continuation, final commit outcome/error, timestamps, and deterministic identities.
- [x] 2.2 Publish bounded result/error data directly from `tool_execution_end` as the sole `tool-completed` observation, then update OMP integration assertions to prove the final `turn-committed` event contains no duplicated tool payload.

## 3. Consumers and Documentation

- [x] 3.1 Migrate memory-capture and host transport fixtures to the new lifecycle version and event shape, then remove every non-archived `CommittedToolOutcome` and `toolOutcomes` reference.
- [x] 3.2 Update `docs/architecture/protocols.md` and `docs/hosts/oh-my-pi.md` to document event ownership, correlation, the lifecycle version change, and the unchanged framed RPC protocol.

## 4. Verification

- [x] 4.1 Run focused typechecks and lifecycle, capture, OMP extension, child-integration, and vertical tests for every changed package.
- [x] 4.2 Exercise the real project-local OMP extension through a tool-using committed turn and verify one `tool-completed` event plus one result-free `turn-committed` event without disabling ordinary OMP behavior.
- [x] 4.3 Run `npm run check` and `openspec validate remove-turn-committed-tool-outcomes --type change --strict --no-interactive`, and resolve every code, documentation, package-boundary, and specification failure.
