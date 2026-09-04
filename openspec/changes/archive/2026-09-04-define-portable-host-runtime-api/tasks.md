## 1. Shared protocol foundation

- [x] 1.1 Add versioned frozen actor-neutral Runtime Host capability types and Cordis service in `extension-protocols`; require every closed field, reject unknown keys and arbitrary feature strings at local and transport boundaries, and test protocol-version handling
- [x] 1.2 Move the OMP-local bridge interfaces and plugin factory into a host-neutral `extension-protocols` Runtime Host module that never provides or requires `doppelgangerActor`; expose only attach, detach, and `toolCatalogChanged(revision)` on the binding, reject a generic notification channel, keep `createActorIdentityPlugin` independently mountable with absent/unbound/bound semantics, and retain optional empty context/tool behavior plus single-owner attachment
- [x] 1.3 Add immutable catalog and per-tool revisions, deterministic snapshots, and one internal post-commit tools-changed registry event consumed by the shared plugin to call `toolCatalogChanged` exactly once
- [x] 1.4 Implement owner-scoped atomic tool-set registration/replacement with full prevalidation, cross-owner collision checks, previous-set preservation on failure, one committed catalog revision/event, and one idempotent Cordis disposer
- [x] 1.5 Migrate every portable tool handler and caller to the correlated invocation context with session, call, optional turn, and `AbortSignal` fields
- [x] 1.6 Make invocation dispatch bind tool name + catalog revision + tool revision, validate non-empty session/turn/call identities, clone JSON input, reject duplicate active call IDs, create one `AbortController` per active call, expose idempotent cancellation, clear all settlement paths, reject stale revisions before handler dispatch, and return structured cancellation/errors
- [x] 1.7 Enforce protected one-shot approval grants against exact call ID, tool revision, and canonical cloned-input digest; reject missing, altered, unexpected, stale, or replayed grants while keeping stricter native policy host-owned
- [x] 1.8 Enforce declared lifecycle capability membership before existing normalization/publication and diagnose undeclared event kinds
- [x] 1.9 Add one transport-independent Runtime Host conformance suite covering two-session isolation, empty context/tools, unknown capability rejection, atomic catalog replacement, stale invocation, approval replay, cancellation/completion races, undeclared lifecycle rejection, actor-provider absence/unbound/bound independence, disposal during active work, and late callbacks after binding replacement

## 2. Composition Runtime boundary

- [x] 2.1 Export the generic composition canonicalization needed by host decoders without exporting domain or host-specific activation fields
- [x] 2.2 Move OMP-discriminated serialized activation request decoding and `hostKind` validation from `composition-runtime` into `host-omp`, migrate all callers and tests, and remove the obsolete kernel export and file
- [x] 2.3 Generalize protected runtime-plugin mounting tests for an actor-neutral shared bridge plus separate absent, unbound, and bound actor-provider cases and typed host-specific sibling plugins with isolated service realms
- [x] 2.4 Verify activation failure and disposal exhaust every partially attached bridge, separate actor provider, host-specific provider, watcher, callback effect, and Cordis effect without cross-session visibility or late publication into a successor binding

## 3. OMP adapter migration

- [x] 3.1 Replace `OmpRuntimeHost` and `createOmpRuntimeHostPlugin` with the actor-neutral shared Runtime Host API in the child, adapter, fixtures, and exports; always mount OMP's separate bound or unbound actor provider, then remove the OMP-local bridge implementation
- [x] 3.2 Publish OMP's immutable closed actor-neutral capability profile for per-turn context, dynamic tools, native required approval, cooperative cancellation, and faithfully supported lifecycle events; reject unknown keys in parent and child decoders
- [x] 3.3 Revise the existing framed RPC schemas and validation for correlated context requests, revisioned catalog snapshots, exact-revision invocation, protected approval grants, cancellation, and the single explicit `toolCatalogChanged(revision)` callback; add no generic runtime notification envelope or second channel
- [x] 3.4 Rework native OMP tool projection to commit one exact catalog snapshot, retain canonical name plus tool revision in every closure, compare callback revision with the committed projection, and ignore delayed stale callbacks
- [x] 3.5 Map native OMP invocation signals to child cancellation while preserving concurrent calls, completion races, transport health, and bounded shutdown behavior
- [x] 3.6 Keep native required-approval prompts in OMP, mint one protected exact-call grant only after explicit approval, and prove denial, yolo, replay, changed-input, reload, and stale-closure behavior
- [x] 3.7 Route standard OMP lifecycle events through the shared bridge's declared availability and add one typed OMP-specific provider fixture that reuses the existing extension/child/framed-RPC/router lifecycle without exposing raw `ExtensionContext` or opening a second host channel
- [x] 3.8 Run the shared adapter conformance suite and real project-local `.omp/extensions/doppelganger.ts` smoke scenarios for activation, all Actor Identity states, per-turn context, dynamic tool replacement, required approval, cancellation, lifecycle, failure, late callbacks, and disposal

## 4. Portable MCP tool importer

- [x] 4.1 Add the `packages/extension-mcp` workspace package, exports, strict NodeNext configuration, workspace Cordis peer, current official MCP SDK dependency, and package-boundary manifest entry
- [x] 4.2 Define and test Loader configuration for stable server IDs, stdio and stateless Streamable HTTP transports, environment and credential references, enablement, exact-name aliases, disablement, and required-approval overrides
- [x] 4.3 Implement Runtime Session-owned MCP client generations with initialization, capability negotiation, paginated `tools/list`, diagnostics, stdio process ownership, HTTP ownership, and exhaustive cleanup
- [x] 4.4 Implement deterministic `mcp-<server-id>.<local-id>` projection, exact original-name retention, alias handling, schema validation, collision isolation, overlong-name diagnostics, and per-server ownership
- [x] 4.5 Commit initial discovery and `notifications/tools/list_changed` refresh through atomic owned tool sets, retaining the prior healthy generation on transport, validation, or registry failure
- [x] 4.6 Map exact current portable invocation to MCP `tools/call`, forward cancellation, preserve supported content and `structuredContent`, interpret older missing `resultType` as complete, reject current `input_required` as bounded unsupported multi-round input, and distinguish domain, protocol, transport, schema, stale-generation, and cancelled failures
- [x] 4.7 Treat MCP annotations as untrusted hints, apply only explicit Runtime Preset approval/disable policy, and verify imported tools cannot supply actor identity or bypass host approval
- [x] 4.8 Add stdio and HTTP integration fixtures covering discovery, pagination, dynamic list changes, naming collisions, invocation, complete and input-required result variants, structured errors, cancellation, reload rollback, process exit, and session disposal

## 5. Host-extension and DSH alignment

- [x] 5.1 Document and test the protected convention for typed host-namespaced Cordis services and events: session isolation, transported-value validation, effect-owned cleanup, mandatory reuse of the adapter-owned in-process binding or existing host transport/router/process, prohibition of second host channels, and the distinction from ordinary external service connections such as MCP
- [x] 5.2 Reconcile `openspec/changes/add-deepseek-harness-host/` proposal, design, specs, and tasks with the finalized closed capability profile, explicit tool-catalog callback, actor state semantics, tool revisions, approval, cancellation, lifecycle availability, one-transport rule, shared conformance suite, and host-specific extension convention
- [x] 5.3 Remove every planned or implemented parallel DSH bridge contract, require DSH to pass the same Runtime Host conformance suite, and keep each DSH-only capability typed and host-specific until two implemented adapters satisfy the common-API semantic promotion gate

## 6. Documentation and verification

- [x] 6.1 Update architecture, protocol, Composition Runtime, OMP host, configuration, verification, package topology, and project-status documentation for the shared API, closed capabilities, actor absence/unbound/bound semantics, explicit catalog callback, one-transport rule, conformance obligations, common-API promotion gate, and clean OMP cutover
- [x] 6.2 Add the authoritative MCP tool-import feature and operations documentation, including trust, credentials, naming, approval, transport, reload, diagnostics, and disposal boundaries, and add it to `docs/README.md`
- [x] 6.3 Update package exports, package-boundary checks, single-Cordis-root checks, dependency/security evidence, and any Runtime Preset examples or fixtures affected by the new package
- [x] 6.4 Run narrow package typechecks and behavioral tests for each migrated package while implementing, then run the complete transport-independent conformance suite against every adapter plus real OMP smoke verification
- [x] 6.5 Run registry-backed `npm run check:security` for the new MCP dependency and record any reviewed residual advisory risk
- [x] 6.6 Run `npm run check` and `openspec validate define-portable-host-runtime-api --strict`, then resolve every code, documentation, active-spec, package-boundary, and live-change integrity failure
