## ADDED Requirements

### Requirement: One canonical cross-host runtime plugin development skill
The repository SHALL own one canonical Agent Skill named `doppelganger-runtime-plugin-development` under `skills/runtime/doppelganger-runtime-plugin-development/SKILL.md`. Its frontmatter and body SHALL describe temporary Doppelganger Runtime-Session Cordis plugin development and SHALL be installable into the project-level universal Agent Skills location discovered by compatible OMP and DSH hosts.

#### Scenario: Skill identity is inspected
- **ID**: `runtime-plugin-development-skill.identity.canonical`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::declares the canonical identity and temporary runtime purpose`
- **WHEN** repository verification reads the canonical Skill source
- **THEN** its name is `doppelganger-runtime-plugin-development` and its trigger description covers creating, modifying, diagnosing, stopping, and removing temporary Doppelganger runtime plugins

#### Scenario: Skill is installed universally for a project
- **ID**: `runtime-plugin-development-skill.install.universal-project`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::installs one canonical Skill for OMP and DSH project discovery`
- **WHEN** the user installs the repository Skill into a project's universal Agent Skills target
- **THEN** compatible OMP and DSH loaders discover the same `SKILL.md` without host-specific forks

### Requirement: Host-native invocation syntax is documented
The Skill SHALL document the supported host-native invocation forms and SHALL NOT claim that invoking the Skill itself grants runtime authority. OMP invocation SHALL use `/skill:doppelganger-runtime-plugin-development ...`; DSH invocation SHALL use `/doppelganger-runtime-plugin-development ...`.

#### Scenario: Skill runs in OMP
- **ID**: `runtime-plugin-development-skill.invoke.omp`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::documents exact OMP and DSH invocation syntax`
- **WHEN** the Skill is installed for an OMP session
- **THEN** its documented explicit invocation begins with `/skill:doppelganger-runtime-plugin-development`

#### Scenario: Skill runs in DSH
- **ID**: `runtime-plugin-development-skill.invoke.dsh`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::documents exact OMP and DSH invocation syntax`
- **WHEN** the Skill is installed for a DSH agent
- **THEN** its documented explicit invocation begins with `/doppelganger-runtime-plugin-development`

### Requirement: Skill chooses the temporary runtime mechanism only when it fits
Before defining code, the Skill SHALL determine whether the requested behavior belongs in a temporary host-side Runtime-Session plugin. It SHALL route permanent product code, persistent Runtime Preset composition, package installation, host UI, browser Client behavior, and a direct one-shot tool invocation away from Dynamic Runtime Plugins rather than forcing the mechanism.

#### Scenario: Request needs temporary session behavior
- **ID**: `runtime-plugin-development-skill.fit.temporary-host-plugin`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::routes only temporary session-scoped host behavior into dynamic plugins`
- **WHEN** the user requests reversible behavior that should observe or contribute to the current Runtime Session beyond one immediate tool call
- **THEN** the Skill may use the Dynamic Runtime Plugins workflow

#### Scenario: Request needs a permanent implementation
- **ID**: `runtime-plugin-development-skill.fit.permanent-code`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::routes only temporary session-scoped host behavior into dynamic plugins`
- **WHEN** the behavior must survive restart, ship with the repository, edit authored composition, install dependencies, or become a maintained product capability
- **THEN** the Skill states that temporary plugins are the wrong mechanism and does not define one

#### Scenario: Request needs host Client UI
- **ID**: `runtime-plugin-development-skill.fit.client-ui-excluded`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::routes only temporary session-scoped host behavior into dynamic plugins`
- **WHEN** the requested behavior requires browser DOM, React, host slots, or DSH Client code
- **THEN** the Skill reports that the initial Doppelganger capability is host-only and does not invent a Client half

### Requirement: Skill is inspect-first and contract-driven
For every fitting request, the Skill SHALL call `runtime-plugin.inspect-list` before writing code, SHALL query only the exact Service, Event, Builtin, and Tool contracts the implementation needs, and SHALL use names and signatures from those current results rather than memory, examples, or DSH-specific catalogs. When modifying an existing Plugin it SHALL inspect the exact base Package source and current diagnostic state first.

#### Scenario: New Plugin needs a service
- **ID**: `runtime-plugin-development-skill.inspect.new-plugin`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::requires provider discovery and exact contract queries before define`
- **WHEN** a new temporary Plugin needs a runtime service or event
- **THEN** the Skill obtains the provider manifest and exact contract before producing Package source

#### Scenario: Existing Plugin is modified
- **ID**: `runtime-plugin-development-skill.inspect.existing-package`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::requires provider discovery and exact contract queries before define`
- **WHEN** the user asks to modify or repair an existing temporary Plugin
- **THEN** the Skill reads its exact Plugin and Package state with `runtime-plugin.inspect-self` before defining a new immutable Package

#### Scenario: Needed capability is absent from inspection
- **ID**: `runtime-plugin-development-skill.inspect.absent-capability`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::requires provider discovery and exact contract queries before define`
- **WHEN** the current inspect catalog does not expose a required service, event, builtin, or operation
- **THEN** the Skill reports the missing capability and does not guess a hidden API or framework property

### Requirement: Skill writes plain JavaScript with reversible Cordis effects
The Skill SHALL write Package source as a plain JavaScript async-function body that returns a Cordis Plugin. It SHALL NOT use imports, `require`, TypeScript annotations, decorators, JSX, unsupported globals, or APIs absent from current inspection. Every listener, provider, tool, timer, subscription, and external effect SHALL be registered through inspected lifecycle-aware APIs or an explicit disposer owned by the generated Fiber.

#### Scenario: Plugin registers a portable tool
- **ID**: `runtime-plugin-development-skill.code.generated-tool`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::teaches inspected plain JavaScript and lifecycle-owned effects`
- **WHEN** the temporary Plugin needs to expose a portable tool
- **THEN** the Skill uses the inspected guarded tool-registration contract and does not attempt to invoke another tool directly

#### Scenario: Plugin subscribes externally
- **ID**: `runtime-plugin-development-skill.code.external-effect`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::teaches inspected plain JavaScript and lifecycle-owned effects`
- **WHEN** source subscribes to an approved external service
- **THEN** it wraps the subscription in a Cordis effect whose returned disposer removes the callback on stop or update

#### Scenario: Example suggests unsupported syntax
- **ID**: `runtime-plugin-development-skill.code.plain-js-only`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::teaches inspected plain JavaScript and lifecycle-owned effects`
- **WHEN** a requested implementation or prior example uses TypeScript, JSX, imports, native timers, or guessed Node globals
- **THEN** the Skill translates it to inspected plain JavaScript or reports that it cannot run in this evaluator

### Requirement: Skill follows immutable define and approved run workflow
The Skill SHALL separate definition from execution. It SHALL call `runtime-plugin.define` once for the prepared source, present or retain the exact returned Plugin ID, Package ID, name, purpose, and source digest, then call `runtime-plugin.run` with matching metadata and the correct explicit mode. It SHALL treat define success as non-executing and SHALL treat host approval as the only authority to evaluate the Package.

#### Scenario: First version is created
- **ID**: `runtime-plugin-development-skill.workflow.first-run`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** a new Package definition succeeds
- **THEN** the Skill calls `runtime-plugin.run` with `mode: "run"` and the exact returned metadata rather than claiming the Plugin is already active

#### Scenario: Existing version is changed
- **ID**: `runtime-plugin-development-skill.workflow.update`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** a current Plugin receives a new Package
- **THEN** the Skill calls `runtime-plugin.run` with `mode: "update"` and the exact new Package metadata

#### Scenario: User rejects execution
- **ID**: `runtime-plugin-development-skill.workflow.approval-rejected`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** native approval for `runtime-plugin.run` is rejected or cancelled
- **THEN** the Skill reports that no generated source ran and does not retry, redefine around the decision, or seek alternate execution authority

### Requirement: Skill repairs technical failure without hiding state
After an approved technical failure, the Skill SHALL inspect the exact Package and latest run diagnostic, prepare the smallest corrected immutable Package for the same Plugin, and use the transition mode required by current state. It SHALL preserve older versions for inspection and rollback, SHALL NOT overwrite source, and SHALL NOT describe a waiting dependency as a successful active feature.

#### Scenario: Package has a syntax or apply failure
- **ID**: `runtime-plugin-development-skill.repair.technical-failure`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** an approved activation returns a technical parse, evaluation, apply, or guard failure
- **THEN** the Skill inspects the exact failure, defines a corrected Package on the same Plugin, and submits the corrected transition for a new approval

#### Scenario: Failed update leaves current pointer known-good
- **ID**: `runtime-plugin-development-skill.repair.explicit-rollback`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** an update fails after the prior run was stopped and the Plugin retains a known-good current Package
- **THEN** the Skill either repairs the target or explicitly requests another approved run of the current Package and never claims automatic rollback occurred

#### Scenario: Plugin waits for a dependency
- **ID**: `runtime-plugin-development-skill.repair.waiting-state`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** activation succeeds with a non-empty `waitingFor` list
- **THEN** the Skill reports the exact missing approved services and does not claim the requested behavior is currently active

### Requirement: Skill distinguishes stop, undefine, and persistent authoring
The Skill SHALL use `runtime-plugin.stop` to disable active effects while retaining immutable versions and rollback context. It SHALL use `runtime-plugin.undefine` only when the user no longer needs the Plugin within the current session. It SHALL state that neither operation persists or promotes source, and SHALL NOT edit Runtime Presets, patches, plugin files, or configuration as a fallback.

#### Scenario: User asks to pause behavior
- **ID**: `runtime-plugin-development-skill.lifecycle.stop`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** the user wants to disable a temporary Plugin but may restart or inspect it later
- **THEN** the Skill calls `runtime-plugin.stop` and retains its definitions

#### Scenario: User asks to remove behavior
- **ID**: `runtime-plugin-development-skill.lifecycle.undefine`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** the user explicitly no longer needs the temporary Plugin or its versions in the current session
- **THEN** the Skill calls `runtime-plugin.undefine` and explains that the identities are invalid afterward

#### Scenario: User asks to keep the Plugin after restart
- **ID**: `runtime-plugin-development-skill.lifecycle.no-promotion-fallback`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::separates immutable definition, approved transitions, repair, stop, and removal`
- **WHEN** the user asks to persist or ship a temporary Plugin
- **THEN** the Skill explains that promotion is outside the current capability and does not edit authored files or invoke unrelated file tools

### Requirement: Missing Dynamic Runtime Plugins tools fail without alternate authority
If any required `runtime-plugin.*` tool is unavailable, the Skill SHALL explain that the active Runtime Preset lacks the optional Dynamic Runtime Plugins capability or the host cannot project it. It SHALL NOT fall back to DSH `cordis_*` tools, shell, filesystem editing, direct `node:vm`, Loader mutation, or host-specific private APIs.

#### Scenario: Skill is installed but control tools are absent
- **ID**: `runtime-plugin-development-skill.authority.absent-no-fallback`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::forbids alternate runtime authority when portable tools are absent`
- **WHEN** the Skill is invoked in a session without the required portable control surface
- **THEN** it reports the missing opt-in capability and performs no runtime plugin mutation or execution

### Requirement: Skill states the generated-code trust boundary
The Skill SHALL state before execution that generated Package code is trusted process code, `node:vm` is not a security sandbox, OMP's child process is not hostile-code containment, and native DSH execution shares the host process. It SHALL keep the user's native approval decision authoritative.

#### Scenario: Skill prepares an activation
- **ID**: `runtime-plugin-development-skill.trust.explicit-warning`
- **EVIDENCE**: `scripts/tests/runtime-plugin-development-skill.spec.ts::states shell-equivalent trust and host failure boundaries before run`
- **WHEN** the Skill is ready to call `runtime-plugin.run`
- **THEN** its workflow and the native approval identify the exact Package and make the process-authority risk clear without describing the VM as secure isolation
