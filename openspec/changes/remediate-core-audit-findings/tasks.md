## 1. Reproducible Verification Foundation

- [x] 1.1 Install the committed workspace dependency graph in the audit worktree with `npm ci` and record the Node/npm versions used for verification.
- [x] 1.2 Replace the broad `lib/` ignore rule with scoped build-output rules and restore all five `scripts/lib/*.mjs` verification helpers as tracked source.
- [x] 1.3 Add repository-integrity coverage that fails when an executable root script imports an absent, untracked, or ignored helper source.
- [x] 1.4 Run the scripts test suite plus package-boundary, repository-integrity, focused-spec, and production-security command-unit tests from the audit worktree.

## 2. Closed JSON Value Boundary

- [x] 2.1 Add protocol tests for cycles, custom prototypes, `toJSON`, getters, accessors, symbol keys, non-enumerable properties, sparse arrays, non-finite numbers, depth limits, byte limits, immutable clones, and deterministic canonical encoding.
- [x] 2.2 Implement the descriptor-safe strict JSON clone and canonicalization module in `extension-protocols` without executing caller-owned coercion hooks.
- [x] 2.3 Migrate tool schemas, tool inputs/results/error data, approval digests, structured inference values, and exported protocol decoders to the shared strict primitive.
- [x] 2.4 Make bounded lifecycle observation serialization descriptor-safe while preserving truncation instead of strict rejection for unsupported host values.
- [x] 2.5 Run the narrow extension-protocols typecheck and JSON/inference/tool/lifecycle test files.

## 3. Authority-Preserving Context Cutover

- [x] 3.1 Add context-protocol tests proving one shared budget, deterministic ranking, authority-separated rendering, truncation, omission provenance, and absence of a flattened instruction-capable field.
- [x] 3.2 Replace `AssembledContext.content` with immutable `instructions` and `data` projections and migrate empty-context values plus every direct protocol caller.
- [x] 3.3 Update Runtime Host and OMP RPC contracts to exactly validate the new context result and reject stale `content` envelopes.
- [x] 3.4 Update generated Dynamic Runtime Plugin catalog contracts and regeneration checks for the authority-separated context shape.
- [x] 3.5 Add OMP tests proving instruction-only system projection, transient delimited data projection on the initial and post-tool provider requests, no persisted synthetic message, and no stale data after turn or binding replacement.
- [x] 3.6 Implement the OMP `before_agent_start` snapshot plus transient `context` hook projection and migrate existing context tests and fixtures.
- [x] 3.7 Run extension-protocols, dynamic-runtime-plugin catalog, host-omp contract, extension, and real-child context tests.

## 4. Closed Lifecycle Boundary

- [x] 4.1 Add lifecycle tests for inherited event names, unknown variants, exact per-variant keys, missing fields, malformed bounded values/errors, and non-executing normalization.
- [x] 4.2 Implement own-key event detection and the closed discriminated-union lifecycle decoder.
- [x] 4.3 Enforce immutable Runtime Session identity in `RuntimeHostBridge.publishLifecycle` and add shared conformance coverage for cross-session rejection.
- [x] 4.4 Migrate OMP lifecycle RPC decoding and producers to the exact envelope where stricter validation exposes stale fields.
- [x] 4.5 Run lifecycle, capability, Runtime Host conformance, OMP contract, and child-integration tests.

## 5. Tool Commit and Owner Lifetime

- [x] 5.1 Add tests for throwing and rejecting catalog observers while independent observers still run and the committed snapshot remains current.
- [x] 5.2 Add owner-race tests for disposal during active calls, handler resolution after abort, replacement of removed or revised definitions, and retention of exactly unchanged definitions.
- [x] 5.3 Extend active-call state with owner token, tool name, revision, controller, and settlement; abort only retired owner revisions and recheck cancellation before success.
- [x] 5.4 Make `ToolRegistration.dispose` and `ToolSetRegistration.dispose` asynchronous and migrate explicit callers, generated catalog contracts, and Cordis guards.
- [x] 5.5 Dispatch catalog notifications through a contained parallel observer boundary with bounded diagnostics after snapshot commit.
- [x] 5.6 Run tool-registry, Runtime Host conformance, dynamic-runtime-plugin, Evolution, CodeGraph, MCP, and OMP dynamic-tool tests that exercise registration lifetime.

## 6. Composition Activation and Patch Diagnostics

- [x] 6.1 Add tests that distinguish invalid patch syntax or shape from runtime patch application failure with structured diagnostics.
- [x] 6.2 Validate patch entry fields before anchor canonicalization and reserve runtime-owned identities without incidental JavaScript errors.
- [x] 6.3 Add watch-acquisition failure tests after plugin activation, including cleanup failure aggregation and shared-watch membership.
- [x] 6.4 Refactor session activation/disposal so every post-mount failure uses one memoized cleanup path, including exporter removal and runtime session ownership.
- [x] 6.5 Run composition patch, activation, reload, and disposal tests plus the package typecheck.

## 7. Runtime Preset Selection and Import Health

- [x] 7.1 Add precedence tests proving explicit selection skips malformed project and user documents and project selection skips malformed user configuration.
- [x] 7.2 Refactor `RuntimePresetRoster.select` into an ordered short-circuit decision pipeline without weakening validation at the winning level.
- [x] 7.3 Add import-health tests for valid exports, invalid exports, packages without exports, missing deep targets, and Loader-relative Node resolution independent of `cwd`.
- [x] 7.4 Replace manual bare-package export parsing with Node-based import resolution plus explicit filesystem existence checks for resolved file targets.
- [x] 7.5 Run Runtime Preset typecheck and complete roster/authoring test suite.

## 8. Documentation and End-to-End Verification

- [x] 8.1 Update `docs/architecture/protocols.md` for authority-separated context, strict values, lifecycle closure, observer containment, and owner-scoped calls.
- [x] 8.2 Update `docs/architecture/composition-and-reload.md` for precedence-aware document loading, Node-resolved import health, patch diagnostics, and transactional watch acquisition.
- [x] 8.3 Update `docs/hosts/oh-my-pi.md` for instruction-system projection and transient per-request data projection with no synthetic history.
- [x] 8.4 Update `docs/operations/verification.md` for tracked verification sources and clean-checkout proof; update `docs/README.md` only if topic ownership or document paths change.
- [x] 8.5 Replace every `planned:` evidence reference in this change with the exact implemented test name and reconcile any modified live focused specs required by the clean cutover.
- [x] 8.6 Run all affected package typechecks and focused test files, then execute the shared Runtime Host conformance suite against OMP.
- [x] 8.7 Exercise the real project-local OMP extension in a disposable home and preset, proving mixed-authority context on an initial model request and a tool continuation without persisted data context.
- [x] 8.8 Run `npm run check:focused-specs:change -- remediate-core-audit-findings`, `npm run test:focused-specs -- --change remediate-core-audit-findings`, and `npm run check` from the clean installed audit worktree.
