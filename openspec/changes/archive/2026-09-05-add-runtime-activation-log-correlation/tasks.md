## 1. Logging Correlation Contract

- [x] 1.1 Add immutable `RuntimeLoggingScope` with `runtimeActivationId`, `sessionId`, and `runtimePresetId` to the public Composition Runtime logging service
- [x] 1.2 Generate one canonical UUID per Runtime Session logging router and copy it into every normalized record
- [x] 1.3 Update record fixtures and router tests for distinct activations and reload-stable correlation

## 2. File Path Templates

- [x] 2.1 Add mutually exclusive static `path` and activation `pathTemplate` configuration with strict placeholder validation
- [x] 2.2 Resolve `{runtimeActivationId}` from logging scope before opening the existing concrete rolling writer
- [x] 2.3 Add file exporter tests for templates, malformed placeholders, resolved path safety, and static-path compatibility
- [x] 2.4 Add Composition Runtime coverage for concurrent sessions and HMR retaining one activation-derived destination

## 3. Destination Correlation

- [x] 3.1 Add `runtimeActivationId` to Sentry breadcrumb and error-event correlation
- [x] 3.2 Update Sentry fixtures and tests for activation correlation across repeated logical session IDs

## 4. OMP Process Isolation

- [x] 4.1 Update real OMP child fixtures to compose one shared activation path template
- [x] 4.2 Verify concurrent child processes resolve distinct files without stdout, stderr, RPC, or host-report logging changes

## 5. Documentation and Operator Configuration

- [x] 5.1 Update runtime logging, composition, configuration, OMP, usage, and project-scope documentation with activation identity and template semantics
- [x] 5.2 Update the Smith user Runtime Preset to use an activation-derived log path while preserving global debug filtering and rotation settings

## 6. Verification

- [x] 6.1 Run affected package typechecks and focused Composition Runtime, File, Sentry, and OMP logging suites
- [x] 6.2 Run focused specification, repository integrity, and full `npm run check` gates
- [x] 6.3 Review the final change for raw-session path exclusion, activation stability, clean static-path compatibility, exporter-wide correlation, and absence of interprocess locking claims
