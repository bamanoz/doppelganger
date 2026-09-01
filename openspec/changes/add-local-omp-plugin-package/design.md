## Context

OMP already supports package installation and linking through a `package.json` `omp.extensions` manifest. Doppelganger does not expose that surface: `packages/host-omp` is a library package and `.omp/extensions/doppelganger.ts` constructs it directly with three repository-local values—the development home, actor `valera`, and `packages/host-omp/src/child.ts`.

The hard-coded bootstrap is useful as an early vertical fixture but is not an install boundary. It prevents an empty external-style home from exercising the normal package defaults, makes actor identity appear to belong to the extension source, and requires knowledge of the monorepo layout. At the same time, adding Persona or the shipped `standard` dependency closure to `host-omp` would violate the existing rule that host adapters remain composition-neutral.

The workspace is currently source-first: package exports point to TypeScript under `src/`, OMP 18 can load TypeScript extension entries, and Node 26 can execute the private TypeScript child. This change can therefore prove the package boundary locally without introducing a repository-wide compilation and publication system.

## Goals / Non-Goals

**Goals:**

- Add `packages/omp` as private workspace package `@doppelganger/doppelganger-omp`.
- Make it discoverable through OMP's ordinary local plugin-link registry.
- Give it one neutral default extension entrypoint with no repository path, actor, Persona instance, or named Runtime Preset constant.
- Keep `host-omp` as the generic adapter while the OMP plugin package owns the official `standard` deployment dependency closure.
- Make the host child path an internal installed-layout concern rather than bootstrap input.
- Make repository dogfooding consume the same entrypoint as a linked local installation.
- Verify a fresh-home `standard` session and the explicitly configured development Mark session through real OMP processes.

**Non-Goals:**

- Publishing any package or claiming registry ownership.
- Selecting public versions, release cadence, or compatibility-matrix policy.
- OMP marketplace support or project-scoped marketplace installation.
- Actor onboarding, authentication, account discovery, or in-session actor switching.
- A general Runtime Preset package manager or automatic third-party dependency solving.
- Repackaging the DSH host or defining a generic cross-host distribution package.
- Renaming Doppelganger or changing the `@doppelganger/doppelganger-<role>` package convention.

## Decisions

### 1. Add a host-specific OMP plugin package beside the neutral host adapter

The new package is:

```text
packages/omp/
  package.json
  tsconfig.json
  src/index.ts
  tests/plugin-package.spec.ts
```

Its package name is `@doppelganger/doppelganger-omp`. It is the unit understood by OMP's plugin manager; `@doppelganger/doppelganger-host-omp` remains the library that implements selection, process ownership, transport, hooks, and projection.

The package remains `private: true` and `0.0.0`. Its manifest declares exactly one base extension:

```json
{
  "omp": {
    "name": "Doppelganger",
    "description": "Portable Doppelganger runtime integration for OMP",
    "extensions": ["./src/index.ts"]
  }
}
```

The source entry is intentional for this private milestone. It matches every current workspace package and the supported OMP 18 TypeScript loader. A later public-release change may introduce `dist/`, exports conditions, provenance, and packed-artifact compatibility without forcing that policy into this local boundary change.

Alternative considered: add `omp.extensions` directly to `host-omp`. Rejected because the install unit must own the product dependency closure for `standard`, while `host-omp` is explicitly forbidden from depending on Persona or a named product composition.

Alternative considered: use the root `doppelganger` package. Rejected because the root is host-neutral and a future DSH integration needs a distinct host install unit.

### 2. Keep the installed entrypoint almost declarative

`packages/omp/src/index.ts` reads only the optional host actor environment and delegates all runtime behavior:

```ts
import { createDoppelgangerOmpExtension } from '@doppelganger/doppelganger-host-omp'

const actorId = process.env.DOPPELGANGER_ACTOR_ID?.trim()

export default createDoppelgangerOmpExtension({
  ...(actorId === undefined || actorId.length === 0 ? {} : { actorId }),
})
```

It does not read or pass `DOPPELGANGER_HOME`: the runtime-presets package already owns explicit option, environment, and conventional-home precedence. It does not pass `childPath`: `host-omp` owns that location. It does not name `standard`: runtime-presets owns the shipped root and deployment default. It does not name Mark or Persona.

`DOPPELGANGER_ACTOR_ID` is an explicit host binding input, not Persona configuration. Blank values are omitted so the normal unbound service is preserved. This is sufficient for local dogfooding while actor onboarding remains deferred.

Alternative considered: keep actor `valera` in `.omp/extensions/doppelganger.ts`. Rejected because two entrypoints would then exercise materially different host configuration and the package would not be the path actually dogfooded.

Alternative considered: use OMP plugin settings. Rejected for this milestone because OMP's extension factory receives only `ExtensionAPI`; plugin settings are managed by the plugin registry but are not exposed as a stable extension-construction input. Introducing an OMP-internal import would couple Doppelganger to a private host API.

### 3. Put official deployment dependencies at the OMP install boundary

`@doppelganger/doppelganger-omp` depends on `@doppelganger/doppelganger-host-omp` plus the product-layer packages and Cordis Loader infrastructure required for the shipped `standard` tree to resolve from an isolated plugin installation. The exact manifest is derived from:

- package names referenced by `packages/runtime-presets/presets/standard/runtime.cordis.yml`;
- runtime dependencies and peer requirements of `host-omp`, composition-runtime, protocols, runtime-presets, and Persona;
- OMP itself, retained as the bounded peer rather than bundled as a second host runtime.

The package-boundary manifest gains a new `omp` node with allowed edges toward the host adapter and required standard product packages. No reverse edge is added. `host-omp` continues to have no Persona, SQLite, memory, embedding, vector, or named-preset dependency.

The isolated package test must resolve imports from a packed or copied plugin tree rather than accidentally succeeding through arbitrary workspace imports. This is the proof that the manifest owns the dependency closure it claims.

Alternative considered: rely on workspace hoisting and transitive peer auto-installation. Rejected because it would make local success non-representative of an eventual plugin installation.

### 4. Make child location a private `host-omp` package invariant

`createDoppelgangerOmpExtension` retains `childPath` only as an explicit test/embedding seam. Its normal path resolves the sibling private child entry from `host-omp`'s own module URL. `host-omp` package contents explicitly include that child and every runtime module it imports.

The OMP package never computes or passes a child path. Tests exercise both the default installed-layout path and the existing injected child factory/path seams.

Because the repository is source-first in this milestone, the private child remains TypeScript and is launched by Node 26. A future compiled publication must change the host package's internal entry layout and its package-content test together; callers remain unaffected.

Alternative considered: move the child into `@doppelganger/doppelganger-omp`. Rejected because process transport and child ownership are implementation details of the OMP host adapter, not product-distribution policy.

### 5. Reduce the project-local extension to delegation

The retained repository discovery file becomes:

```ts
export { default } from '@doppelganger/doppelganger-omp'
```

Repository Mark dogfooding is launched with explicit environment:

```text
DOPPELGANGER_HOME=<repo>/dev/doppelganger
DOPPELGANGER_ACTOR_ID=valera
```

README documents both modes:

- `omp plugin link ./packages/omp` with an empty/default home to emulate a local installation;
- repository Mark dogfooding with explicit development environment.

The project file remains useful because OMP discovers `.omp/extensions/` automatically when running in the repository. It no longer owns behavior or configuration.

Alternative considered: delete `.omp/extensions/doppelganger.ts` and require every developer to mutate their user plugin registry. Rejected because automatic repository-local discovery remains a useful deterministic smoke seam, provided it delegates to the same package entrypoint.

### 6. Verify plugin behavior in isolated state

Verification has four layers:

1. Package contract tests validate name, privacy, version, OMP manifest, neutral entrypoint behavior, declared dependency closure, and package contents.
2. Package-boundary and single-Cordis checks prove the new dependency direction and one runtime Cordis installation.
3. An isolated OMP plugin-link smoke uses temporary OMP/plugin and Doppelganger homes, links `packages/omp`, verifies discovery, starts a real session, observes `standard` context, and confirms that selection initializes the editable home control files without copying the package-owned preset.
4. The repository-local delegated extension runs with explicit development home and actor and proves Mark context/tools still activate.

Tests and smokes must never link into or modify the developer's real OMP plugin registry. Cleanup disposes sessions and child processes before removing temporary roots.

A package dry-run or isolated pack inspection is required, but `npm publish` and marketplace commands are prohibited in this change.

## Risks / Trade-offs

- **[Source-first package differs from eventual public artifact]** → Treat `src/index.ts` and the TypeScript child as an explicit private milestone; require a later public-release change to introduce and verify compiled artifacts.
- **[Workspace hoisting hides missing dependencies]** → Resolve the `standard` composition from an isolated packed/copied plugin tree and fail on undeclared package imports.
- **[Local plugin-link smoke mutates user state]** → Pin all OMP registry, profile, session, and Doppelganger paths to temporary directories and verify cleanup.
- **[Environment actor binding becomes accidental onboarding API]** → Document it as explicit local host configuration only; keep onboarding/authentication and identity discovery deferred.
- **[Two discovery paths load the plugin twice]** → Real smokes use either isolated plugin linking outside the repository or repository-local discovery, never both in one OMP invocation.
- **[New product package weakens host neutrality]** → Enforce one-way package boundaries and retain negative dependency/source checks for `host-omp`.

## Migration Plan

1. Add the private workspace package, package-boundary node, manifest, entrypoint, and focused package tests.
2. Make `host-omp` package-relative child resolution and package contents explicit; retain injection seams for tests.
3. Add isolated plugin-link and fresh-home real OMP verification.
4. Replace `.omp/extensions/doppelganger.ts` with the package delegation and update repository dogfood launch instructions.
5. Run the explicit Mark dogfood smoke, focused package/host checks, repository invariants, and full workspace check.

Rollback removes the private package and restores the prior project-local bootstrap. Runtime Presets and plugin-owned state are not migrated, rewritten, or deleted, so rollback has no durable-data conversion.

## Open Questions

None for the private local package milestone. Public artifact layout, registry publication, version compatibility policy, signatures/provenance, and marketplace distribution remain decisions for a separate release change.
