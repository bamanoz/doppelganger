## ADDED Requirements

### Requirement: One canonical portable permanent-plugin development skill
The repository SHALL own one canonical Agent Skill named `doppelganger-plugin-development` under `skills/development/doppelganger-plugin-development/SKILL.md`. Its trigger description SHALL cover creating, building, modifying, and repairing permanent installable Doppelganger plugin packages. Compatible OMP and DSH hosts SHALL discover the same project-installed skill without host-specific forks, and invoking it SHALL grant no authority beyond the user's request and available repository tools.

#### Scenario: Skill identity is canonical
- **ID**: `persistent-plugin-development-skill.identity.canonical`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::declares the canonical permanent plugin workflow identity`
- **WHEN** repository verification reads the canonical skill source
- **THEN** its name is `doppelganger-plugin-development` and its description targets permanent installable Doppelganger plugin development

#### Scenario: Skill is installed for compatible hosts
- **ID**: `persistent-plugin-development-skill.install.universal-project`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::installs one canonical skill for OMP and DSH project discovery`
- **WHEN** the canonical skill is installed into a project's universal Agent Skills location
- **THEN** compatible OMP and DSH loaders discover the same `SKILL.md` through their native invocation syntax

### Requirement: Skill accepts only permanent installable plugin work
Before editing, the skill SHALL confirm that the requested outcome is maintained package source that survives Runtime Session and process restart. It SHALL route reversible current-session behavior to `doppelganger-runtime-plugin-development`, host Client or browser UI work to an owning host workflow, and capability research to `doppelganger-capability-evolution` rather than absorbing those responsibilities.

#### Scenario: Request is for a permanent npm package
- **ID**: `persistent-plugin-development-skill.fit.permanent-package`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::routes only permanent installable plugin work into this workflow`
- **WHEN** the user asks to create or modify a maintained Doppelganger plugin that must survive restart and be installable as package source
- **THEN** the skill proceeds to its implementation-location gate

#### Scenario: Request is for temporary session behavior
- **ID**: `persistent-plugin-development-skill.fit.temporary-runtime-plugin`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::routes only permanent installable plugin work into this workflow`
- **WHEN** the requested behavior belongs only to the current Runtime Session and needs no maintained package
- **THEN** the skill routes the request to `doppelganger-runtime-plugin-development` and creates no repository files

#### Scenario: Request requires a host-specific Client surface
- **ID**: `persistent-plugin-development-skill.fit.host-specific-client`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::routes only permanent installable plugin work into this workflow`
- **WHEN** the requested plugin requires browser DOM, native host Client UI, or another surface absent from Doppelganger contracts
- **THEN** the skill identifies the owning host workflow and does not present a portable Doppelganger package as sufficient

### Requirement: Implementation location is explicit before mutation
The skill SHALL establish the implementation repository before creating or modifying any directory, manifest, planning artifact, source file, test, or documentation. An explicit prior user statement naming the location SHALL satisfy the gate. Otherwise the skill SHALL ask the user to choose the current repository, a named existing repository, or a new repository at a user-selected local path. It SHALL NOT treat the current working directory, skill installation directory, Evolution proposal scope or storage, or prior discussion repository as implicit package ownership.

#### Scenario: No implementation location was supplied
- **ID**: `persistent-plugin-development-skill.location.ask-before-write`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::requires an explicit implementation location before any write`
- **WHEN** the user asks to develop a permanent plugin without naming where its package should live
- **THEN** the skill asks the user to choose current, named existing, or new repository placement and performs no filesystem mutation before the answer

#### Scenario: User explicitly chooses the current repository
- **ID**: `persistent-plugin-development-skill.location.current-explicit`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::accepts each explicit repository placement choice`
- **WHEN** the user states that the package belongs in the current repository
- **THEN** the skill may treat that repository as the implementation location

#### Scenario: User chooses another existing repository
- **ID**: `persistent-plugin-development-skill.location.existing-named`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::accepts each explicit repository placement choice`
- **WHEN** the user chooses a different existing repository and supplies or selects its concrete path
- **THEN** the skill performs subsequent discovery and development in that repository rather than the original working directory

#### Scenario: User chooses a new repository
- **ID**: `persistent-plugin-development-skill.location.new-path`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::accepts each explicit repository placement choice`
- **WHEN** the user chooses a new repository and supplies its intended local path
- **THEN** the skill creates no project root until that path is known and does not create a remote repository without separate authorization

### Requirement: Skill re-grounds in the selected repository
After location selection and before planning or editing, the skill SHALL read the selected repository's governing agent instructions and relevant documentation, inspect its workspace and package manifests, neighboring package structure, dependency and export conventions, test patterns, and required verification gates. It SHALL prefer those existing conventions and SHALL NOT carry implementation assumptions from the session's original repository into the selected target.

#### Scenario: Existing monorepo is selected
- **ID**: `persistent-plugin-development-skill.discovery.existing-repository`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::restarts repository discovery from the selected implementation location`
- **WHEN** the selected implementation location is an existing repository
- **THEN** the skill derives package placement and engineering conventions from that repository before changing it

#### Scenario: New standalone repository is selected
- **ID**: `persistent-plugin-development-skill.discovery.new-repository`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::requires explicit package ownership choices for a new repository`
- **WHEN** the selected location has no existing package conventions
- **THEN** the skill resolves material package identity, npm scope ownership, and publication visibility with the user before applying conservative standalone package defaults

### Requirement: Plugin implementation uses current source-verified contracts
The skill SHALL inspect the current Doppelganger, Cordis, and target-repository contracts needed by the requested plugin rather than copying a fixed scaffold or relying on remembered APIs. A portable permanent extension SHALL remain an ordinary Cordis Loader plugin, declare required services through `inject`, own effects through plugin lifecycle, validate JSON-compatible boundary values, and expose public contracts through the target package's established exports. The skill SHALL use the selected repository's supported language, package manager, dependency, and build conventions.

#### Scenario: Plugin needs a Doppelganger service
- **ID**: `persistent-plugin-development-skill.contracts.inspect-current`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::requires current source verified Cordis and Doppelganger contracts`
- **WHEN** implementation depends on a context, tool, lifecycle, storage, Persona, memory, or other extension service
- **THEN** the skill verifies the current service and lifecycle contract before writing imports, injection metadata, configuration, or handlers

#### Scenario: Target repository already has package conventions
- **ID**: `persistent-plugin-development-skill.contracts.reuse-package-patterns`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::requires current source verified Cordis and Doppelganger contracts`
- **WHEN** neighboring maintained packages establish naming, exports, tests, or dependency conventions
- **THEN** the skill reuses those patterns instead of introducing a second scaffold or package architecture

### Requirement: Planning follows target ownership rather than skill policy
The skill SHALL create or update planning artifacts only when the user explicitly requested planning or the selected repository's governing instructions require a planning workflow. It SHALL NOT assume OpenSpec, create an OpenSpec change merely because capability selection preceded development, or write planning artifacts into the session's incidental repository.

#### Scenario: Target repository requires OpenSpec
- **ID**: `persistent-plugin-development-skill.planning.target-required`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::uses planning only when selected repository policy requires it`
- **WHEN** the selected repository's governing instructions require an OpenSpec change before implementation
- **THEN** the skill follows that planning workflow in the selected repository before editing implementation code

#### Scenario: Target repository has no planning requirement
- **ID**: `persistent-plugin-development-skill.planning.not-imposed`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::uses planning only when selected repository policy requires it`
- **WHEN** the user requested implementation and the selected repository imposes no separate planning gate
- **THEN** the skill does not introduce OpenSpec or another planning system as an unrelated prerequisite

### Requirement: Verification covers behavior and installability
The skill SHALL run the narrowest relevant target-package checks while iterating and every applicable repository-required gate before reporting completion. For a new or materially changed installable package, verification SHALL cover package build or typecheck, observable plugin behavior, owned lifecycle cleanup and failure boundaries, published file and export shape, installation into a disposable consumer outside the source tree, and minimal real Cordis Loader activation when the package is Loader-addressable. It SHALL report only observed verification.

#### Scenario: New package implementation is complete
- **ID**: `persistent-plugin-development-skill.verification.installable-package`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::requires package behavior installability and Loader activation proof`
- **WHEN** the skill finishes implementing a new permanent plugin package
- **THEN** it proves the package contents, consumer installation, public exports, plugin behavior, and applicable Loader activation before calling the work complete

#### Scenario: Target repository defines a final gate
- **ID**: `persistent-plugin-development-skill.verification.repository-gate`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::requires package behavior installability and Loader activation proof`
- **WHEN** the selected repository requires a final check command or scenario
- **THEN** the skill runs that gate after narrow package verification and reports its observed result

### Requirement: Distribution and repository administration require separate direction
Completing package development SHALL NOT authorize npm publication, version release, remote repository creation, git commit, or push. The skill SHALL perform any such operation only after an explicit user request and through the applicable repository or release workflow. Local creation of a user-selected new repository path SHALL NOT imply authorization to create or configure a remote.

#### Scenario: Package passes all development checks
- **ID**: `persistent-plugin-development-skill.authority.no-implicit-release`
- **EVIDENCE**: `scripts/tests/persistent-plugin-development-skill.spec.ts::keeps publication release commit push and remote creation separately authorized`
- **WHEN** the plugin package is implemented and verified
- **THEN** the skill stops without publishing, releasing, committing, pushing, or creating a remote unless the user separately requested that action
