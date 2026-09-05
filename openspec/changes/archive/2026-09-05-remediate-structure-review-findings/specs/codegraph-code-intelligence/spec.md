## MODIFIED Requirements

### Requirement: The standalone CodeGraph CLI is a diagnosed prerequisite
The plugin SHALL invoke a separately installed standalone `codegraph` executable rather than importing the CodeGraph engine into the Doppelganger Node process. Configuration MAY select an absolute executable path; otherwise discovery SHALL use the Runtime Session process environment. The plugin SHALL validate the executable's reported version against the repository's tested compatibility line before exploration, SHALL cache only a successful immutable discovery result for the plugin generation, and SHALL expose missing, non-executable, malformed, and unsupported binaries as bounded structured status or invocation failures. It SHALL NOT install, upgrade, download, self-configure, or invoke CodeGraph's agent installer.
Concurrent status and exploration calls SHALL share discovery facts without inheriting the initiating caller's failure policy. Status SHALL return the prerequisite diagnostic, while exploration SHALL reject an unavailable or incompatible prerequisite before any index status, synchronization or exploration work, regardless of call order. Failed discovery SHALL not become a successful cached binary, and a later independent operation SHALL remain able to retry. Disposal SHALL prevent late discovery publication.

#### Scenario: Compatible binary is installed
- **ID**: `codegraph.binary.compatible`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::accepts the tested standalone CodeGraph compatibility line`
- **WHEN** binary discovery resolves an executable whose version belongs to the configured supported line
- **THEN** status reports the exact executable and version and exploration may proceed

#### Scenario: Binary is absent or unsupported
- **ID**: `codegraph.binary.unavailable`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::diagnoses absent malformed and unsupported CodeGraph binaries without installation`
- **WHEN** discovery cannot execute a compatible CodeGraph binary
- **THEN** status reports the bounded prerequisite diagnostic and exploration fails with a stable structured error without changing the machine

#### Scenario: Status and exploration share unsuccessful discovery
- **ID**: `codegraph.binary.concurrent-caller-policy`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::preserves status and exploration policy in both discovery call orders`
- **WHEN** status and exploration overlap on one unavailable or incompatible binary discovery attempt in either call order
- **THEN** status returns its bounded prerequisite diagnosis while exploration returns its structured prerequisite error without running index work

#### Scenario: Discovery succeeds after an earlier failed attempt
- **ID**: `codegraph.binary.retry-after-failed-shared-discovery`
- **EVIDENCE**: `packages/extension-codegraph/tests/plugin.spec.ts::retries failed shared discovery without publishing after disposal`
- **WHEN** a later independent request follows a failed shared discovery attempt
- **THEN** it can acquire a compatible binary through a new attempt while any result completing after disposal remains unpublished
