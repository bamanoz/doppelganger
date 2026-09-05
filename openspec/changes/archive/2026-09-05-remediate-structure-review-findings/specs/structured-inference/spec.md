## ADDED Requirements

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
