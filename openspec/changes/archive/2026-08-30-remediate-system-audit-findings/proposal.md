## Why

The 2026-08-30 system audit found no critical defect, but it identified several independent failure-containment gaps, stale requirement contracts, timing-sensitive verification, duplicated architectural seams, and unresolved opt-in embedder supply-chain risk. Addressing them as one coordinated hardening change prevents partial fixes from leaving lifecycle, specification, or repository-integrity guarantees inconsistent across packages.

## What Changes

- Make Runtime Session and runtime teardown best-effort-complete: every owned watcher, session, Fiber, and root resource is released even when one disposer fails, with failures reported only after cleanup is exhausted.
- Make local embedder, pgvector, and Qdrant acquisition transactional and close-safe so late async completion, validation failure, and transient client construction cannot leak or permanently poison owned resources.
- Contain each framed JSON-RPC notification observer independently so one rejected observer is diagnosable but cannot close the peer or cancel unrelated traffic.
- Replace fixed-delay HMR and watcher tests with explicit observable completion conditions and load-resilient deadlines.
- Reconcile current OpenSpec requirements with the implemented Runtime Preset architecture: runtime selection and metadata remain generic, while Persona configuration, state, identity, and traits remain extension-owned.
- Harden the semantic-memory lifecycle requirements introduced by `strengthen-persona-memory`; this change is sequenced after that active change is completed and archived so both changes do not compete to create `memory-semantic-indexes`.
- Add an executable repository-integrity capability covering one machine-readable package-boundary manifest, documentation inventory/link checks, forbidden live legacy references, and non-archived legacy package-name checks.
- Consolidate composition activation canonicalization and Persona file-backed contribution reload plumbing without changing their external semantics.
- Narrow `host-omp` package exports so consumer APIs and intentional transport/testing subpaths have explicit compatibility ownership.
- Keep the local embedder opt-in, document its trusted-artifact boundary, fail repository security verification when newly fixable production advisories are ignored, and upgrade the vulnerable dependency chain when a compatible fixed release exists. This change does not claim that currently unfixable upstream advisories can be eliminated locally.
- **BREAKING**: remove legacy Persona-selection requirements and any remaining public `host-omp` root exports that are internal-only; all in-repository consumers move to the retained root API or declared subpath exports.

## Capabilities

### New Capabilities

- `repository-integrity`: Machine-readable package boundaries, authoritative documentation inventory and link validation, legacy-reference detection, and production dependency advisory policy.

### Modified Capabilities

- `composition-runtime`: Failure-tolerant, idempotent disposal and shared canonicalization of equivalent activation inputs.
- `runtime-kernel`: Remove legacy domain metadata and Persona-selection obligations from the generic runtime contract.
- `persona-composition`: Replace obsolete runtime-owned project/global Persona selection with Loader-composed, extension-owned Persona activation behavior.
- `extensions/persona`: Align Persona ownership with Runtime Presets and preserve identity/trait behavior without runtime-owned selection fields.
- `hosts/oh-my-pi`: Contain notification-observer failures, use generic Runtime Preset terminology throughout, and define the supported package/transport surface.
- `memory-semantic-indexes`: Guarantee close-safe embedder/vector-backend acquisition, retry after transient Qdrant client failure, and lifecycle conformance under initialization races. This delta depends on `strengthen-persona-memory` becoming the main capability first.

## Impact

- Affected packages: `composition-runtime`, `extension-persona`, `extension-embedding-local`, `extension-memory-vectors`, and `host-omp`.
- Affected repository infrastructure: `scripts/`, root package scripts, package-boundary rules, documentation checks, package exports, and selected tests.
- Affected specifications: generic runtime metadata and selection, Persona composition/ownership, OMP transport behavior, semantic-index lifecycle, and repository integrity.
- Compatibility: no Runtime Preset file format or host RPC wire-format change is intended. Root `host-omp` imports that are not part of the retained consumer API may require migration to explicit subpaths.
- Security: the local embedder remains optional and restricted to trusted pinned artifacts while upstream advisories lack a compatible fix; dependency changes require audit, cache-integrity, and real-inference verification.
- Change sequencing: complete and archive `strengthen-persona-memory` before applying the semantic-memory portion of this change; archived OpenSpec evidence remains immutable.
- Documentation: update the owning files under `docs/`, `README.md`, and `AGENTS.md` in the same implementation change, and record final verification in the audit follow-up.
