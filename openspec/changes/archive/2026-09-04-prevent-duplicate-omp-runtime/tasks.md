## 1. OMP Loading Guidance

- [x] 1.1 Update `README.md` to present linked-plugin and project-local dogfood as alternative modes, with exact link, enable, disable, and launch examples
- [x] 1.2 Explain OMP's resolved-path deduplication and the two-runtime consequence when both distinct Doppelganger entrypoints are enabled in one invocation
- [x] 1.3 State explicitly that Doppelganger adds no singleton, lease, process lock, or restriction on opening the same OMP session more than once

## 2. Owning Documentation and Contracts

- [x] 2.1 Update `docs/hosts/oh-my-pi.md` with the discovery ordering, path-identity rule, supported-mode boundary, and existing separate child ownership
- [x] 2.2 Update `docs/operations/configuration.md` and `docs/operations/verification.md` with profile-scoped mode selection and the requirement that real smokes exercise one loading path at a time
- [x] 2.3 Sync the canonical `openspec/specs/hosts/oh-my-pi/spec.md` through this delta without changing runtime code or historical archived artifacts

## 3. Verification

- [x] 3.1 Run the existing linked-plugin and delegated project-local OMP scenarios to confirm both documented modes remain supported separately
- [x] 3.2 Run OpenSpec validation, the focused-spec change gate, documentation integrity checks, and `npm run check`
