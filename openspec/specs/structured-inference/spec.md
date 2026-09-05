# structured-inference Specification

## Purpose

Define optional, bounded, provider-neutral structured inference for Runtime Session plugins, including strict request and result validation and a portable Pi provider with no host-agent execution authority.

## Requirements

### Requirement: Structured inference is an optional provider-neutral Runtime Session service
Doppelganger SHALL define a session-scoped `doppelgangerInference` service for bounded one-shot structured inference. A request SHALL contain a bounded purpose identifier, system instruction, input material, transport-neutral JSON Schema for the expected value, optional output-token limit, and optional `AbortSignal`. A successful result SHALL contain one deeply frozen JSON-compatible value that validates against the exact supplied schema plus bounded token usage when the provider reports it. The contract SHALL expose no host agent loop, conversation state, host credential store, tool registry, raw provider client, or execution authority.

#### Scenario: Plugin requests structured inference
- **ID**: `inference.protocol.structured-request`
- **EVIDENCE**: `packages/extension-protocols/tests/inference.spec.ts::validates and freezes one structured request and result`
- **WHEN** a Runtime Session plugin calls the composed inference service with a valid bounded request and output schema
- **THEN** the provider returns one schema-valid deeply frozen JSON value without exposing host-specific objects or model execution internals

#### Scenario: No inference provider is composed
- **ID**: `inference.protocol.omission-neutral`
- **EVIDENCE**: `packages/composition-runtime/tests/inference.spec.ts::keeps arbitrary Runtime Presets neutral when structured inference is omitted and rejects duplicate providers`
- **WHEN** a Runtime Preset contains no inference provider row
- **THEN** no `doppelgangerInference` service, model request, credential lookup, state, context, tool, lifecycle subscriber, or host behavior is added

### Requirement: Structured inference validates both sides of the provider boundary
The inference contract SHALL reject unknown request fields, unsupported or unbounded schemas, oversized prompts or purpose values, non-finite limits, and non-JSON-compatible values before provider dispatch. Provider output SHALL be parsed and validated against the exact request schema before it reaches the caller. Failures SHALL use bounded stable codes that distinguish invalid request, unavailable provider, authentication, timeout, cancellation, provider failure, missing structured output, and invalid structured output; error projections SHALL NOT contain credentials, complete prompts, raw responses, or provider payloads.

#### Scenario: Provider emits malformed structured output
- **ID**: `inference.protocol.invalid-output`
- **EVIDENCE**: `packages/extension-protocols/tests/inference.spec.ts::rejects invalid, non-JSON, oversized, and missing provider output`
- **WHEN** a provider returns invalid JSON, a value outside the supplied schema, multiple conflicting values, or content beyond the configured bound
- **THEN** the inference call fails with a stable bounded error and exposes no partial value to the caller

#### Scenario: Request is cancelled
- **ID**: `inference.protocol.cancellation`
- **EVIDENCE**: `packages/extension-inference-pi/tests/plugin.spec.ts::times out, honors caller abort, disables SDK retries, and disposes without waiting for the SDK`
- **WHEN** the caller aborts an in-flight inference request
- **THEN** the provider operation settles promptly with the stable cancellation outcome and cannot publish a later successful value

### Requirement: The Pi adapter uses the maintained Node-compatible Pi SDK
`@doppelganger/doppelganger-inference-pi` SHALL be an independently resolvable Cordis Loader plugin that provides `doppelgangerInference` by using `@earendil-works/pi-ai` rather than implementing provider HTTP protocols. Its strict JSON-compatible configuration SHALL select one provider route and model from the installed catalog or define one explicit OpenAI-compatible base URL and model context window, resolve credentials only from named environment-variable references or the SDK's provider-owned ambient mechanism, and bound reasoning, request timeout, output tokens, and response characters. Custom URLs SHALL be absolute HTTP(S), contain no credentials, and fail activation unless paired with the model context window. The adapter SHALL use the SDK's provider/model abstraction, one-shot completion, cancellation, usage, and error result semantics; it SHALL disable SDK retries so one Doppelganger call is one provider attempt.

#### Scenario: Configured Pi model returns a value
- **ID**: `inference.pi.structured-completion`
- **EVIDENCE**: `packages/extension-inference-pi/tests/plugin.spec.ts::uses the Pi faux provider to return one schema-valid structured value and bounded usage`
- **WHEN** the Pi adapter is composed with a valid provider/model profile and receives a structured inference request
- **THEN** it asks the selected Pi model for exactly one schema-shaped result, validates it through the shared contract, and returns only the normalized value and usage

#### Scenario: Credential reference is unavailable
- **ID**: `inference.pi.missing-credential`
- **EVIDENCE**: `packages/extension-inference-pi/tests/plugin.spec.ts::resolves a configured credential per call and fails without ambient fallback`
- **WHEN** adapter configuration names an environment credential reference whose value is absent or unusable
- **THEN** the request fails before provider I/O with the stable authentication outcome and does not fall back to another credential source

#### Scenario: Custom OpenAI-compatible route is configured
- **ID**: `inference.pi.custom-openai-route`
- **EVIDENCE**: `packages/extension-inference-pi/tests/plugin.spec.ts::builds an explicit OpenAI-compatible provider snapshot without exposing credentials`
- **WHEN** adapter configuration supplies a valid provider/model identifier, absolute credential-free base URL, model context window, and named credential reference
- **THEN** activation constructs one Pi provider/model snapshot for that route without persisting or embedding the resolved credential

#### Scenario: Runtime configuration is replaced
- **ID**: `inference.pi.reload-snapshot`
- **EVIDENCE**: `packages/composition-runtime/tests/inference.spec.ts::replaces Pi inference configuration atomically while in-flight calls retain their captured generation`
- **WHEN** valid Loader reload changes the selected provider, model, or request policy while a call is in flight
- **THEN** the active call completes or aborts under its captured immutable provider generation and the next call uses the replacement configuration

### Requirement: Structured inference providers remain portable composition dependencies
A consumer SHALL discover `doppelgangerInference` through ordinary Cordis service injection or optional lookup in the same Runtime Session isolation realm. The protocol SHALL permit alternative provider packages, including a future adapter over another host-neutral model service, without changing consumers. Duplicate providers in one realm SHALL fail activation rather than being selected by registration order. Host packages SHALL NOT be required to expose their native model service or add inference-specific transport operations.

#### Scenario: Alternative provider implements the contract
- **ID**: `inference.protocol.provider-substitution`
- **EVIDENCE**: `packages/extension-protocols/tests/inference.spec.ts::accepts provider substitution and rejects duplicate providers in one realm`
- **WHEN** a Runtime Preset replaces the Pi adapter with another conforming inference provider
- **THEN** consumers continue using the same request and result contract without host-specific branching

### Requirement: Pi configuration entrypoints share one admission contract
The Pi inference adapter SHALL use one plugin-owned canonical configuration contract for direct normalization and Loader admission. Both entrypoints SHALL enforce the same closed fields, normalized identifiers, omitted optional values, supported explicit values, provider/model selection constraints, paired custom URL and context window, reasoning choices, existing defaults, and numeric/string limits. Unknown or malformed configuration SHALL fail before provider construction or I/O. Validation SHALL not resolve credentials; the existing configured-versus-ambient credential policy and immutable per-generation provider snapshot SHALL remain unchanged.

#### Scenario: Pi configuration is validated directly or by Loader
- **ID**: `inference.pi.config-admission-parity`
- **EVIDENCE**: `packages/extension-inference-pi/tests/plugin.spec.ts::uses identical direct and Loader Pi configuration admission`
- **WHEN** the same valid or invalid Pi configuration is supplied to its direct normalizer and actual Loader admission
- **THEN** both admit the same normalized values and defaults or reject the same unsupported fields and limits before provider work

#### Scenario: Pi configuration omits credentials and optional limits
- **ID**: `inference.pi.config-defaults-without-side-effects`
- **EVIDENCE**: `packages/extension-inference-pi/tests/plugin.spec.ts::normalizes omitted Pi configuration without credentials or provider I/O`
- **WHEN** configuration normalization receives a valid profile with omitted optional credentials and request limits
- **THEN** it supplies only the documented defaults and omitted fields without reading credentials, dispatching a model request, or changing the selected route
