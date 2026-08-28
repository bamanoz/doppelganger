## Purpose

Defines host-neutral context, tool, and lifecycle contracts through which arbitrary Cordis plugins can affect an agent without depending on a concrete host.

## ADDED Requirements

### Requirement: Context provider registry
Feature plugins SHALL be able to register scoped context providers whose registrations follow the owning plugin lifecycle.

#### Scenario: Provider contributes context
- **WHEN** a host requests context for a turn
- **THEN** every active provider in the session scope can return context contributions for that request

#### Scenario: Provider is disposed
- **WHEN** the plugin owning a context provider is disposed or reloaded
- **THEN** the provider is no longer included in subsequent context resolution

### Requirement: Context assembly
The context assembler SHALL combine active contributions deterministically and SHALL enforce the token budget supplied for the host request.

#### Scenario: Contributions exceed budget
- **WHEN** resolved contributions exceed the available persona-context budget
- **THEN** the assembler retains higher-priority configured contributions and excludes lower-priority content until the result fits the budget

#### Scenario: Turn-sensitive provider
- **WHEN** a provider uses the current turn to select relevant content
- **THEN** the assembled result reflects the current request without changing the provider's registration

### Requirement: Transport-neutral tool registry
Feature plugins SHALL register namespaced tool definitions in a session-scoped registry that supports discovery and invocation without exposing host-specific tool objects.

#### Scenario: Host discovers tools
- **WHEN** a host adapter lists active persona tools
- **THEN** it receives each tool's stable namespaced name, description, input contract, and availability

#### Scenario: Host invokes a tool
- **WHEN** a host invokes a listed tool with valid input
- **THEN** the registry executes the owning plugin handler and returns a transport-neutral result or structured error

#### Scenario: Plugin tool is removed
- **WHEN** the owning plugin is disposed or reloaded without the tool
- **THEN** the tool is no longer reported as available

### Requirement: Normalized lifecycle events
Host plugins SHALL emit normalized session, turn, and tool observation events through the session Cordis event system.

#### Scenario: Agent turn completes
- **WHEN** the host reports completion of a model turn
- **THEN** active plugins observing the normalized turn event receive its session identity and outcome

#### Scenario: Host tool executes
- **WHEN** a host tool starts and completes
- **THEN** active observers receive normalized before and after events associated with the same tool call

### Requirement: Host-neutral feature plugins
A portable feature plugin SHALL be able to use context, tools, and events without checking the concrete host identity.

#### Scenario: Same plugin in two hosts
- **WHEN** two host plugins provide the standard protocol services
- **THEN** the same feature plugin definition can activate in both environments without host-specific branches

### Requirement: Optional host-specific services
A host MAY expose additional operations as explicitly named optional services, and absence of an optional service SHALL NOT prevent an otherwise compatible plugin from activating.

#### Scenario: Optional service unavailable
- **WHEN** a plugin can operate without a host-specific optional service and the host does not provide it
- **THEN** the plugin activates with the related optional behavior disabled
