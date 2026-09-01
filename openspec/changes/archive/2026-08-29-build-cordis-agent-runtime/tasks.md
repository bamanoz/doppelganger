## 1. DeepSeek Harness Research Gate

- [x] 1.1 Trace DSH profile boot through root Context creation, Loader mounting, entry import, activation audit, update, rollback, and shutdown; record an exact file-and-symbol call graph and verify every transition against the cloned source.
- [x] 1.2 Trace `RegistryService`, `Fiber`, effects, reflection, required/optional injection, isolation, and quiescent disposal; record the lifecycle invariants Doppelganger must preserve and verify them against focused source paths.
- [x] 1.3 Trace DSH agent/session scopes, standing presets, dynamic host/client runners, trust assumptions, and Cordis peer-dependency patterns; verify the architecture note distinguishes lifecycle isolation from security isolation and identifies duplicate-root hazards.
- [x] 1.4 Reconcile the proposed runtime interface and physical package layout with the completed DSH architecture note; verify no second DI, plugin, lifecycle, Loader, or capability framework is introduced before starting implementation.

## 2. Workspace and Test Harness

- [x] 2.1 Create the TypeScript/Node workspace and package boundaries selected by the research gate, pin the compatible `@deepseek-ai/cordis` Loader family, and verify the dependency graph contains one Cordis package identity per runtime.
- [x] 2.2 Add a disposable runtime test harness with a fake host, temporary definition tree, temporary persona home, and controllable plugins; verify one command can activate and dispose an isolated test session.

## 3. Runtime Kernel

- [x] 3.1 Implement validated Runtime Definition and immutable activation-metadata types without persona-specific fields in the kernel; verify plugins resolve instance, session, project, and path metadata from the session scope.
- [x] 3.2 Implement `createRuntime` and `activate` for standalone and caller-supplied Cordis contexts; verify focused tests cover root ownership and independent concurrent session trees.
- [x] 3.3 Integrate Loader settlement and required-entry activation audit; verify missing dependencies, failed entries, and duplicate services produce actionable diagnostics and no usable session handle.
- [x] 3.4 Implement serialized definition watching and transactional Loader updates; verify valid updates replace the active composition and invalid updates restore the last audited composition.
- [x] 3.5 Implement idempotent session and runtime disposal; verify owned effects and child fibers finish while sibling sessions remain active.

## 4. Standard Extension Protocols

- [x] 4.1 Implement the lifecycle-owned context-provider registry and deterministic token-budget assembler; verify provider disposal, priority ordering, authority metadata, turn-sensitive resolution, and truncation behavior.
- [x] 4.2 Implement the session-scoped namespaced tool registry with serializable discovery, invocation, result, and error contracts; verify add, update, invocation, and owner-disposal cases.
- [x] 4.3 Define normalized session, turn, and tool Cordis events and a fake host plugin that emits them; verify a portable observer plugin works without reading a host identifier.
- [x] 4.4 Add optional named host-service injection to the protocol harness; verify absence degrades optional behavior while a missing required service prevents activation through Cordis gating.

## 5. Persona Composition

- [x] 5.1 Implement loading and validation for user config, project `.doppelganger/manifest.yaml`, Persona Instance metadata, Loader-native definitions, and ordered trait selection; verify invalid input reports field-level diagnostics and stores no runtime state in the project.
- [x] 5.2 Implement the universal identity plugin over YAML/Markdown assets; verify it contributes instruction-authority context and a valid content reload affects the next resolution.
- [x] 5.3 Implement ordered trait contributions independently of identity; verify project-selected traits compose deterministically without changing the stable Persona Instance ID.
- [x] 5.4 Implement global-default and project Persona Instance resolution; verify unconfigured sessions remain inactive and concurrent sessions share only definition assets and persistence.

## 6. Storage and Memory Plugins

- [x] 6.1 Implement the SQLite storage plugin with one database per consumer namespace, WAL mode, migrations, busy handling, and short transactions; verify concurrent session processes can read and commit without sharing database schemas.
- [x] 6.2 Implement the memory schema for records, immutable revisions, provenance, candidates, corroborating evidence, FTS5 rows, and optional embeddings; verify schema migration and transactional hard deletion leave no derived rows.
- [x] 6.3 Implement explicit remember, versioned correction, hard deletion, pinning, and secret rejection; verify active pointers, retained superseded history, complete deletion, and rejected secret writes.
- [x] 6.4 Implement candidate creation, listing, approval, rejection, and two-distinct-session corroboration; verify candidates stay out of recall until eligible and same-session or contradicted evidence cannot promote them.
- [x] 6.5 Implement scope-safe FTS5 retrieval, pinned-global precedence, current-turn recall, token budgeting, and the optional embedding-provider seam; verify lexical-only operation, project isolation, and hybrid merging with a fake provider.
- [x] 6.6 Register the complete namespaced memory tool surface and memory context provider; verify ordinary records render as data, approved preferences may render as instructions, and no transcript is persisted by default.

## 7. Oh My Pi Host Integration

- [x] 7.1 Implement a dependency-light `Content-Length` framed JSON-RPC 2.0 transport for Node and Bun; verify fragmented/coalesced frames, arbitrary newlines, request/response correlation, notifications, malformed frames, and structured RPC errors.
- [x] 7.2 Implement the Node child entrypoint and runtime-side OMP host plugin; verify activation, context resolution, tool list/invoke, event publication, notifications, and disposal through an integration process test.
- [x] 7.3 Implement the user-level OMP extension state machine and nearest-manifest discovery through the Git root with global fallback and initialization tool; verify configured, global-only, invalid, and unconfigured startup states.
- [x] 7.4 Project assembled context through `before_agent_start`, proxy active tools, and forward normalized session/turn/tool events; verify the existing OMP system prompt is preserved and proxy calls round-trip structured results.
- [x] 7.5 Handle live tool/profile changes by registering or refreshing OMP tools and deactivating removed tools; verify changes affect the current OMP session without restarting it.
- [x] 7.6 Implement graceful shutdown and failed-state isolation; verify normal shutdown disposes the child, forced child failure disables persona behavior, diagnostics remain visible, and OMP continues operating.

## 8. Vertical Acceptance

- [x] 8.1 Create one real Persona Definition and Instance with identity and working traits; verify it activates through the OMP adapter and produces the expected context without host-specific code in the definition.
- [x] 8.2 Exercise continuity across real process restarts; verify global preferences and project decisions return, project scopes do not leak, and concurrent sessions preserve transaction invariants.
- [x] 8.3 Exercise explicit memory, candidate review, two-session promotion, correction, hard deletion, pinning, secret rejection, and lexical recall end to end through OMP tools; verify each observable result matches the persona-memory spec.
- [x] 8.4 Exercise profile and plugin hot reload in the live OMP session; verify the next turn sees a valid update, an invalid update rolls back, removed tools deactivate, and persistent state survives.
- [x] 8.5 Run the complete focused contract and integration suite plus an actual OMP smoke session; verify every first-milestone scenario passes and record any intentionally unsupported deferred capability without implementing it.
