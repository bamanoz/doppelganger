## Context

The audit reproduced eight defects in a fresh worktree across four runtime packages and the root verification layer:

1. the assembled context contract retains per-contribution authority but also exposes one flattened `content` string, and OMP appends that string to `systemPrompt`;
2. the root scripts import `scripts/lib/*.mjs`, while the unanchored `lib/` ignore rule can exclude those executable sources from version control;
3. Composition Runtime returns no session after watch registration fails, but its failure branch bypasses exhaustive session cleanup and can lose disposer failures;
4. Runtime Preset selection loads user and project documents before deciding whether a higher-precedence explicit or project choice wins;
5. bare-package validation accepts every deep import when the package lacks an `exports` map, even if the target does not exist;
6. patch entry validation records malformed `name` fields and then calls string methods on the invalid value;
7. lifecycle kind checks accept prototype-inherited property names and normalization does not validate a closed per-variant envelope;
8. tool catalog observers run synchronously inside a committed snapshot mutation, and active calls carry no owner/revision identity for set replacement or disposal.

The packages are private `0.0.0` workspace units, so the safe migration is a clean cutover across every in-repository caller, transport contract, generated catalog, fixture, focused spec, and owning document. No compatibility alias is required.

## Goals / Non-Goals

**Goals:**

- Make context authority mechanically impossible to lose between provider resolution and OMP model projection.
- Make all protocol value boundaries deterministic, closed, and non-executing.
- Give tool implementations explicit owner-scoped active-call lifetime.
- Make activation and registry mutations transactional at their externally visible commit boundaries.
- Make Runtime Preset selection and import health match the documented precedence and Node resolution contracts.
- Ensure root verification works from a clean checkout rather than depending on ignored local files.
- Split the current concentration points into small internal modules only where the defect boundary already demands a distinct invariant.

**Non-Goals:**

- No new feature-domain service, kernel interface, package edge, host RPC channel, or second watcher.
- No change to Runtime Preset patch ordering or Cordis replacement semantics.
- No generic common-host data-message abstraction until a second adapter proves equivalent semantics.
- No SQLite schema, storage, WAL, symlink, or transaction-policy change; the audit did not establish a defect requiring one.
- No npm publication or compatibility policy for the private workspace packages.

## Decisions

### 1. Replace flattened context with authority-separated projections

`AssembledContext.content` will be removed. The clean replacement is:

```ts
interface AssembledContext {
  readonly instructions: string
  readonly data: string
  readonly contributions: readonly ContextContribution[]
  readonly omittedSources: readonly string[]
  readonly tokenCount: number
}
```

The assembler will keep one ranked contribution stream and one budget decision sequence. Accepted contributions remain in global deterministic order. It will render `instructions` and `data` by filtering that accepted sequence without re-ranking. `tokenCount` remains the estimate for the unified accounting sequence used during admission, so separating the output surfaces cannot admit more material than the caller's budget.

The OMP RPC result decoder will validate the complete authority-separated result instead of casting `{ content: string }`.

Alternative considered: retain `content` alongside the new fields. Rejected because it preserves the unsafe convenience path and allows a future adapter to repeat the promotion bug.

### 2. Project OMP data through its transient per-request context hook

OMP exposes two different native surfaces needed by the contract:

- `before_agent_start` can replace the system prompt for the current run;
- `context` transforms a cloned message list for each provider request without writing those transformed messages to session history.

The adapter will resolve Doppelganger context once in `before_agent_start`, store the immutable snapshot on the active turn, and:

- append only `instructions` to the existing OMP system prompt;
- inject non-empty `data` from the stored snapshot as one hidden, fixed-type custom message in the `context` hook for every model request in the run.

The data message will use a deterministic delimiter and an explicit statement that its body is data, not instructions. It will be appended to the transient provider view, not returned as a `before_agent_start.message`, because that surface is persisted. The active turn is cleared at the existing final `turn_end` boundary, so tool continuations reuse the same snapshot and later user runs cannot see it.

```text
before_agent_start
  -> resolve once
  -> activeTurn.context = { instructions, data }
  -> system prompt += instructions only

provider request 1 --+
provider request 2 --+--> context hook --> transient data message
provider request N --+                    (same stored snapshot)

turn_end --> clear activeTurn and snapshot
```

Alternative considered: omit data-authority contributions on OMP. Safe but functionally regressive; OMP's transient context hook provides a native non-system surface, so omission is unnecessary.

Alternative considered: return an injected custom message from `before_agent_start`. Rejected because OMP persists that message, contradicting the no-synthetic-history contract.

### 3. Add one shared strict JSON-value primitive and keep bounded lifecycle serialization separate

`extension-protocols` will gain an internal strict JSON-value module used by tools, inference, lifecycle envelope normalization, capability values, and exported transport decoding where applicable. It will:

- accept only `null`, strings, booleans, finite numbers, arrays, and objects whose prototype is `Object.prototype` or `null`;
- reject cycles, symbol keys, accessors, non-enumerable own properties, sparse arrays, unsupported prototypes, and depth or byte limits selected by the caller;
- inspect property descriptors before reading child values so validation itself does not execute getters;
- construct a fresh null-prototype/object-or-array clone and deeply freeze it;
- provide deterministic canonical encoding for digests without invoking `toJSON` or other coercion hooks.

Lifecycle's `serializeLifecycleValue` remains a tolerant host-observation serializer rather than calling the strict rejector. It will use the same descriptor-safe traversal mechanics but replace unsupported values with `null` and record truncation reasons, preserving its current bounded-observation purpose without executing host objects.

Alternative considered: continue using `JSON.stringify` as validation. Rejected because it executes `toJSON` and getters, silently converts non-finite numbers, and does not prove the original value was JSON-compatible.

### 4. Make lifecycle normalization a closed discriminated-union decoder

`isLifecycleEventType` will use an own-property check. `normalizeLifecycleEvent` will accept `unknown`, validate a plain exact-key envelope, select a variant from an explicit descriptor table, validate required/optional fields and nested bounded values/errors, then return a frozen clone. Unknown event names, inherited names, missing fields, extra fields, and fields belonging to another variant fail before publication.

The Runtime Host bridge will additionally require `event.sessionId` to equal the immutable session ID captured when the bridge attaches. This applies the existing one-session bridge requirement at the caller-controlled lifecycle boundary rather than trusting the adapter to route its own supplied identity correctly.

Alternative considered: TypeScript-only narrowing with the existing `LifecycleEvent` parameter. Rejected because YAML/RPC/native-host inputs are runtime values and the type disappears at every relevant boundary.

### 5. Separate tool catalog commit, notification, and owner-call retirement

Each `ActiveCall` will capture `ownerToken`, tool name, tool revision, controller, and settlement promise. Owned-set replacement will be prepared before mutation, preserving revisions only for definitions that are exactly unchanged.

Commit order:

```text
validate complete candidate
        |
        v
identify removed/revised owner revisions
        |
        v
commit owner set + immutable catalog snapshot
        |
        +--> abort retired active calls
        |
        +--> notify observers through contained parallel dispatch
```

A valid registry mutation returns success once the candidate and snapshot commit. Observer rejection becomes a diagnostic and cannot roll back or throw from that committed mutation. Independent observers still run.

Owner disposal is asynchronous and idempotent: it removes the owner from the catalog, aborts calls belonging to that owner, awaits their settlement, and then completes. `ToolSetRegistration.dispose` and `ToolRegistration.dispose` will therefore return `Promise<void>`. All in-repository explicit callers, generated catalog contracts, and guards will migrate; Cordis effect cleanup will return that promise directly.

Replacement aborts active calls only for removed or revised definitions. An unchanged definition retains its revision and active calls. After handler resolution, invocation rechecks cancellation/retirement before returning success, covering handlers that ignore `AbortSignal` and resolve after removal.

Alternative considered: abort every active call on any catalog change. Simpler but needlessly interrupts independent owners and unchanged definitions.

Alternative considered: let old calls finish successfully because they captured a handler. Rejected because owner disposal would no longer mean quiescence and a removed implementation could produce current-looking success after its authority disappeared.

### 6. Treat watch acquisition as the final activation transaction stage

Composition Runtime will construct the session object and cleanup exporter before watch acquisition, add runtime ownership only when needed for cleanup, and use the same memoized session disposal path for every failure after the audited Loader tree exists. Watch acquisition will record each successfully joined path. A failure invokes exhaustive settlement:

1. remove every joined input-watch membership and dispose newly empty shared registrations;
2. dispose the session Fiber to quiescence;
3. include session-subtree logged disposer failures;
4. remove the cleanup exporter;
5. remove runtime session ownership in a `finally` path.

The original watch-registration failure remains first in an `AggregateError` when cleanup also fails. No bespoke branch will directly call `disposeFiber(sessionOwner)` beside the normal session disposer.

Alternative considered: leave watch registration after session construction with a small local catch. Rejected because it duplicates only part of the ownership teardown and already lost cleanup evidence.

### 7. Decide Runtime Preset precedence before reading lower layers

`RuntimePresetRoster.select` will become an explicit short-circuit pipeline:

1. initialize the home files without reading their content;
2. if an explicit choice is present, validate and resolve it;
3. otherwise load and strictly validate the project manifest when a path is present; select it if it names a preset;
4. otherwise load and strictly validate user configuration; select it if it names a preset;
5. otherwise use the constructor-validated deployment default.

A document is validated exactly when its level can affect the winner. A present malformed higher or current-precedence document fails. Lower-precedence malformed documents are not opened after a winner is known. A missing or broken winning preset still fails and never falls through.

Alternative considered: parse every document and suppress lower-precedence errors. Rejected because it performs unnecessary I/O and leaves ambiguity about which validation failures are authoritative.

### 8. Use Node's resolver for preset import health

Manual `package.json` export interpretation will be removed. On the repository's Node 26 baseline, `import.meta.resolve(specifier, loaderFileUrl)` applies Node ESM package, exports, and subpath resolution relative to the authored Loader file without importing or executing the target. For `file:` results, validation will additionally require the resolved filesystem target to exist, because Node can return a URL for a nonexistent deep path when a legacy package has no `exports` map.

Relative, absolute, `file:`, and protected `cordis:` handling remains explicit. Other URL schemes retain the current non-filesystem treatment.

Alternative considered: `createRequire(loaderPath).resolve`. Rejected because it selects CommonJS `require` conditions rather than the ESM import conditions used by the TypeScript NodeNext runtime.

Alternative considered: extend the current hand-written exports parser. Rejected because it would remain a partial duplicate of Node resolution and already misses legacy deep-target existence.

### 9. Validate complete patch shapes before normalization

Patch parsing will first validate that `patches` is an array and that each patch and inserted entry has the required field types. Recursive entry validation will collect diagnostics and return no partially trusted `EntryOptions[]`. Relative import anchoring runs only after the entire candidate list has passed validation. Reserved runtime identities remain immediate `CompositionLayerError` failures because they are authorization violations rather than ordinary shape diagnostics.

Alternative considered: guard only the current `entry.name.startsWith` call. Rejected because adjacent malformed shapes would continue to escape through incidental exceptions.

### 10. Make verification-source tracking an executable repository invariant

The broad `lib/` ignore rule will be replaced with build-output patterns scoped to package or generated output locations, leaving `scripts/lib/` trackable. The five existing helper modules will be committed in the remediation implementation.

Repository integrity tests will construct a temporary Git-like fixture or inspect the real tracked-source manifest using a deterministic helper inventory derived from script imports. The root check will fail when an executable repository command imports an absent or ignored helper. This proves the clean-checkout contract rather than merely adding the currently missing files once.

Alternative considered: add `!scripts/lib/` after the broad ignore. Acceptable mechanically, but scoped build-output rules are clearer and avoid hiding a future source directory named `lib` elsewhere.

### 11. Refactor only along the repaired invariants

The implementation may extract these internal modules:

- `extension-protocols/src/json-value.ts` for strict cloning/canonicalization and descriptor-safe traversal;
- `extension-protocols/src/context-assembly.ts` if the authority-aware admission/rendering logic would otherwise keep `context.ts` mixed with Cordis service ownership;
- `extension-protocols/src/tool-owners.ts` only if owner retirement and active-call bookkeeping cannot remain legible inside `tools.ts`;
- `composition-runtime/src/session-lifecycle.ts` for memoized exhaustive attempted/active session cleanup;
- `runtime-presets/src/import-resolution.ts` and `selection.ts` if extraction reduces `index.ts` without exposing new public concepts.

These are not new architectural layers. Public exports remain owned by each package's existing `src/index.ts`; no package boundary changes.

## Risks / Trade-offs

- **Context API cutover:** removing `content` touches RPC validation, host tests, generated dynamic-plugin catalogs, and any direct protocol consumers. Mitigation: migrate every reference in one change and make stale `content` fixtures fail exact-key validation.
- **OMP ordering:** transient data must appear consistently in every provider request without entering history. Mitigation: use one fixed custom message type, add it only in the `context` hook from the current binding/turn snapshot, and test initial plus post-tool continuation requests.
- **Tool handlers that ignore abort:** owner disposal cannot force arbitrary JavaScript to settle. The registry can prevent late success, but awaiting disposal still depends on handler cooperation. Mitigation: retain the existing AbortSignal contract, test cooperative and late-resolving handlers, and document that non-settling plugin code can delay quiescence just as any non-settling Cordis disposer can.
- **Observer diagnostics:** `ctx.parallel` failures must be contained without recursively depending on the same failing observer path. Mitigation: use a separate bounded diagnostic callback/logger seam or contain logging locally; never emit another tools-changed event.
- **Node resolution cost:** `import.meta.resolve` and filesystem existence checks are synchronous/IO-bearing during roster scans. Preset discovery already performs filesystem validation, and correctness dominates; no cache is added until measurement shows a need.
- **Lifecycle strictness:** previously tolerated extra fields will fail. This is intentional boundary closure; all in-repository producers migrate together.
- **Clean-worktree proof:** the audit worktree intentionally lacks dependencies, so full implementation verification must install from the committed lockfile before package and root commands can run. The implementation task will treat clean installation plus `npm run check` as required evidence, not rely on the original worktree's `node_modules`.

## Migration Plan

1. Commit and protect repository verification helpers first so subsequent checks are reproducible.
2. Introduce the shared strict JSON primitive and migrate protocol callers without changing external context shape yet.
3. Cut over `AssembledContext`, Runtime Host RPC decoding, generated catalogs, and OMP instruction/data projection together.
4. Implement lifecycle closed decoding and session binding.
5. Implement tool owner-call retirement and asynchronous disposal, migrating every caller.
6. Implement Composition Runtime watch-acquisition cleanup, patch diagnostics, Runtime Preset selection, and import resolution.
7. Update `docs/architecture/protocols.md`, `docs/architecture/composition-and-reload.md`, `docs/hosts/oh-my-pi.md`, and `docs/operations/verification.md` to the implemented contracts.
8. Replace every `planned:` evidence reference with the exact passing test name, run the selected-change evidence graph, then run the root gate in a clean installed worktree.
