## MODIFIED Requirements

### Requirement: Package boundaries have one executable source
The repository SHALL define allowed workspace-package dependency edges in one machine-readable manifest consumed by the package-boundary checker. Architecture documentation SHALL describe the intent of those edges without maintaining a second independently executable edge list.
The checker SHALL derive statically declared source edges from TypeScript syntax for imports, side-effect imports, type-only imports, re-exports and string-literal dynamic imports rather than a regex that recognizes only selected spellings. Internal package subpaths SHALL be attributed to their owning workspace package before comparison with the same manifest. Relative imports crossing workspace-package ownership SHALL be rejected under the package-name import convention even when that named edge would be allowed; legal intra-package imports SHALL remain valid. Comments and non-import string contents SHALL not create source edges.

#### Scenario: A forbidden package dependency is introduced
- **ID**: `repository-integrity.forbidden-package-dependency`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::reports forbidden manifest and source edges`
- **WHEN** a workspace package declares a dependency edge absent from the boundary manifest
- **THEN** repository verification fails and identifies the source package, target package, and violated boundary

#### Scenario: A workspace package is added
- **ID**: `repository-integrity.unregistered-workspace-package`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::rejects an unregistered workspace package`
- **WHEN** a new workspace package is present without an explicit boundary-manifest entry
- **THEN** repository verification fails instead of inferring unrestricted dependencies

#### Scenario: Forbidden package is imported for side effects
- **ID**: `repository-integrity.import-side-effect-edge`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::rejects forbidden side-effect and type-only workspace imports`
- **WHEN** a package imports a forbidden workspace dependency through a side-effect or type-only declaration
- **THEN** verification rejects the edge with the canonical source and target package identities

#### Scenario: Relative import crosses package ownership
- **ID**: `repository-integrity.import-relative-package-edge`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::rejects relative cross-package imports even for otherwise allowed named edges`
- **WHEN** a source file reaches another workspace package through a relative path
- **THEN** verification rejects the cross-package spelling and identifies the owning target package instead of ignoring the import

#### Scenario: Allowed package subpath is imported
- **ID**: `repository-integrity.import-subpath-owner`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::attributes imports and reexports from package subpaths to their owner`
- **WHEN** a source file imports or re-exports a declared subpath of an allowed workspace dependency
- **THEN** verification applies the owning package edge and accepts the valid dependency without treating the subpath as another package

#### Scenario: Source contains import-shaped non-code text
- **ID**: `repository-integrity.import-syntax-not-text`
- **EVIDENCE**: `scripts/tests/package-boundaries.spec.ts::ignores import-shaped comments and strings while checking literal dynamic imports`
- **WHEN** a source contains comments or ordinary strings resembling forbidden imports alongside a string-literal dynamic import
- **THEN** verification reports only the real syntax-derived edge and produces no false dependency for non-import text
