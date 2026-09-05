# Composition and reload

## Runtime Preset roster

`@doppelganger/doppelganger-runtime-presets` owns the control plane before activation. Its pure API and Cordis service expose the same ordered-root roster: the package-owned shipped root, configured roots, then the derived user root at `$DOPPELGANGER_HOME/.runtime-presets` unless disabled. Every root has `system` or `user` trust. Discovery is deterministic and first-root-wins; a broken higher-precedence directory occupies its ID and never falls through to a lower healthy copy.

The package ships `presets/standard/` and its Cordis plugin uses `standard` as the deployment default unless explicitly configured without one. Before first selection from an uninitialized home, the roster creates the editable `config.yaml` and `runtime.cordis.patch.yml` control files plus the derived `.runtime-presets/` user root; it never overwrites them or copies the package-owned `standard` tree. Selection short-circuits in strict precedence order: explicit host/session choice, project choice, user default, then deployment default. A document is opened and validated only while its level can still determine the winner; malformed lower-precedence files cannot invalidate an explicit or project winner, while a malformed current-level document or a missing/broken winner fails without falling through.

Preset health uses a standards-aware Node-style package resolver configured for `import`, `node`, and `default` export conditions, not `process.cwd()` and not a hand-written `package.json` exports interpreter. A package installed in the authored Loader's ancestry is resolved there; otherwise package-owned imports fall back to the Doppelganger runtime installation, which keeps copied shipped presets portable. Activation uses the same resolver. Root and subpath exports follow the configured Node import conditions, and every resolved file target must exist, which rejects nonexistent legacy deep imports even when a package has no `exports` map. The roster selects and validates a base definition; Composition Runtime remains the only activation, patch, watch, rollback, and Runtime Session owner.

Copy-only authoring resolves a healthy source through the roster, copies its complete directory into the first writable `user` root without overwriting any occupied ID, dereferences symlinks, tightens modes, and rewrites display metadata. Removal is limited to the winning preset owned by that writable root. Removing the selected user default also rewrites `config.yaml` without the stale selection, with rollback on reported failure.

## Effective composition

A Runtime Preset is a complete Loader tree, including an empty top-level list. Runtime Patches use native Cordis Include syntax; Doppelganger does not define a second patch language or deep-merge plugin configuration.

The effective tree applies these layers in order:

1. selected `runtime.cordis.yml`;
2. optional `$DOPPELGANGER_HOME/runtime.cordis.patch.yml`;
3. optional `<project>/.doppelganger/runtime.cordis.patch.yml`;
4. explicit host/session patches;
5. protected runtime-owned host layer.

Later replacement semantics are Cordis semantics. Patch definition validates complete patch and recursively inserted Loader-entry shapes before relative-name anchoring. Ordinary malformed fields produce source- and path-labelled `RuntimeConfigurationError` diagnostics; reserved runtime identities and invalid target/application relationships produce `CompositionLayerError`. Targeted mutations must match the tree produced by earlier layers or fail visibly. Relative plugin assets inserted by a filesystem patch resolve from that patch file's directory only after the candidate entry list is valid.

Runtime-owned entry and import identities are reserved. Authored presets and caller patches cannot forge, replace, or remove the final protected plugins, including session metadata, the actor-neutral shared Runtime Host bridge and capability service, a separately configured Actor Identity provider, or explicit typed host-native providers.

## Activation

Activation loads and validates every source, builds the effective entry list, mounts a session-owned Include tree, waits for nested plugin Fibers, and audits every enabled entry. When watching is enabled, acquisition of the base and patch-file watches is the final activation transaction stage: the Runtime Session is not returned until every required membership is owned. A failed acquisition removes every successfully joined membership, disposes the attempted session Fiber to quiescence, removes cleanup exporters and runtime ownership, and reports the original acquisition failure first together with any cleanup failures. Missing dependencies, duplicate services, invalid entries, failed plugins, or watch acquisition failure therefore prevent the Runtime Session from being returned without leaking a partial session.

Each Runtime Session owner installs one `doppelgangerLogging` router before mounting the authored Include tree. The router reuses the session owner's existing Fiber-subtree tracking, normalizes only that session's ordinary Cordis `ctx.logger` records, and retains at most a bounded activation FIFO. Composition Runtime emits operational activation, audit, reload, rollback, watch, and disposal-start events through that same route. Initial exporter rows receive the retained suffix once; successful audit releases it, so exporter omission leaves no later retained history or destination work. See [Runtime logging](../features/runtime-logging.md).

The optional MCP import row validates its complete authored shape, publishes its service and local server slots, and returns before external processes or endpoints finish initialization and discovery. Each server then reports `connecting`, `active`, or operational `failed` through its feature-owned snapshot. A slow or unavailable MCP server therefore does not delay or invalidate the Runtime Session; malformed MCP configuration still fails the Loader row synchronously.

Direct Composition Definition construction and serialized host activation use one package-private canonicalizer. It enforces non-empty identifiers, lowercase kebab-case Runtime Preset IDs, absolute supported Loader paths, cloned and deeply frozen patch data, omitted absent optional fields, and deterministic field-labelled diagnostics. Public entry points add only their context-specific activation fields.

Parallel Runtime Sessions share no mutable plugin objects, handlers, fibers, or feature metadata. They may share only authored assets and storage explicitly configured by plugins.

Runtime Session metadata is limited to:

- stable host session ID;
- selected Runtime Preset ID;
- optional absolute workspace root.

Feature metadata belongs to feature extensions.

Dynamic Runtime Plugin metadata is feature-owned and session-ephemeral: immutable Package source, current/next version pointers, active child Fibers, waiting services, and diagnostics never enter Runtime Session metadata or authored Loader files.

Evolution metadata is also feature-owned: proposal kinds, scopes, revisions, immutable history, operation receipts, evidence, and reminder deliveries never enter Runtime Session metadata. Global state belongs to its instance SQLite namespace; project state belongs to canonical workspace YAML.
CodeGraph state is feature-owned and generation-local: the validated executable, workspace snapshot, discovery cache, in-flight sync, bounded exploration queue, and active children never enter Runtime Session metadata or authored Loader files. The existing `.codegraph/` directory remains user-owned derived project state.

## Transactional reload

The runtime watches the selected base file and all applicable optional patch paths, including creation and deletion. One serialized mutation queue rebuilds all filesystem layers on every change.

A candidate generation commits only after Loader update, Fiber settlement, and activation audit succeed. A failure restores the previous effective generation and records reload diagnostics. The active session remains usable. For watched config changes, success/failure observers are published after one configured HMR quiet window while the refresh remains active; an immediate observer-driven follow-up write is therefore marked dirty and processed instead of being coalesced into the prior event. A committed generation changes the effective revision and affects the next host interaction.

Logging exporters are ordinary Loader rows. Valid addition, replacement, or removal owns sink registration and destination resources through the candidate generation; invalid reload keeps the previous audited sink generation. A later-added sink receives records only after registration rather than reconstructed history.

Reload resets plugin-local runtime state. Plugin-owned persistent state survives according to its provider. Authored base and patch files remain byte-for-byte inputs and are never Loader write-back targets.

Optional feature plugins may coordinate an authored asset mutation with this same reload owner; they do not create a second watcher or activation path. Persona Authoring writes one exact configured trait candidate under its own lock, waits for Persona's URL-and-byte-revision reload outcome, and reports success only after the candidate is active. A rejected or timed-out candidate is atomically restored and the previous revision is awaited. Composition Runtime remains the sole generation and rollback authority.

An explicitly composed Dynamic Runtime Plugins row owns one in-memory registry under its Loader Fiber. Generated activations are child Fibers in that registry, not independent watchers or Runtime Sessions. A successful owner reload disposes every generated effect and starts an empty registry; an invalid owner reload retains the previous audited generation and its active generated state. Package update is an explicit approved feature transition: it disposes the active child Fiber before applying the target Package. A failed target leaves the Plugin stopped while retaining the prior known-good pointer and the failed target diagnostic for inspection and explicit restart.

An explicitly composed Evolution row owns one actor-aware service, instruction/reminder context provider, and seven ledger controls. Valid owner replacement disposes and recreates those session effects while global SQLite and project YAML remain durable. Invalid owner reload retains the previous audited generation. Removing the row cleanly removes the service, context, and tools without deleting stored proposals.
An explicitly composed CodeGraph row owns two portable registrations and its bounded process adapter under one Loader Fiber. Valid replacement starts an independent candidate generation and commits through ordinary Composition Runtime semantics; invalid replacement retains the previous generation. Removal rejects queued work, terminates active children, removes both tools, and leaves the existing index intact.
An explicitly composed MCP import row separates structural Loader validity from external server health. Valid row replacement retires changed/removed client generations, withdraws their complete tool sets, installs replacement `connecting` slots, and returns from the Loader update without awaiting spawn, initialization, or discovery. Unchanged normalized server configurations retain their exact generation. External failure becomes feature-local operational state and does not roll back the valid authored configuration; structurally invalid configuration still rejects the candidate Loader generation through ordinary Composition Runtime rollback.

## Disposal

Session disposal is idempotent and first waits for the serialized mutation queue. It then attempts every owned cleanup stage even if another rejects: every joined config-watch membership is removed, newly empty shared registrations are disposed, the session Fiber reaches Cordis quiescence, the cleanup exporter is removed, and runtime ownership is cleared in a `finally` path. The same memoized path handles explicit disposal, runtime disposal, and every failure after an audited tree becomes activation-owned. Because Cordis deliberately contains individual effect-disposer exceptions, the session owner collects error-level records from only its own Fiber subtree during teardown and includes them in the final aggregate cleanup failure after all reachable stages settle.

Runtime logging cleanup uses the same session owner and Fiber correlation as cleanup-error collection. The router's low-level Cordis exporter remains registered through child Fiber disposal so contained disposer errors join the final cleanup result; explicit session cleanup then removes it. Sink registration is removed before destination close, accepted work drains within the destination contract, and one failed sink or destination cleanup cannot bypass exhaustive sibling/session cleanup.

Runtime disposal snapshots every active session and attempts all of them before disposing the runtime owner and any runtime-owned Cordis root. A caller-owned root is never disposed. Multiple cleanup failures are reported together after exhaustive settlement; repeated disposal reuses the completed or rejected disposal result without reviving ownership or repeating side effects.

## Primary implementation

- `packages/runtime-presets/src/index.ts` — pure ordered-root roster, strict configuration, discovery, health, selection, and copy/remove authoring.
- `packages/runtime-presets/src/plugin.ts` — Cordis roster service facade and standard deployment-default configuration.
- `packages/runtime-presets/presets/standard/` — shipped actor-neutral standard composition and owned Persona assets.
- `packages/composition-runtime/src/canonicalization.ts` — shared package-private composition normalization.
- `packages/composition-runtime/src/definition.ts` — direct Composition Definition construction.
- `packages/composition-runtime/src/serialized-activation.ts` — serialized host activation decoding.
- `packages/composition-runtime/src/patches.ts` — patch validation and layering.
- `packages/composition-runtime/src/runtime.ts` — activation, audit, reload, exhaustive disposal, and ownership.
- `packages/composition-runtime/src/runtime-logging.ts` — bounded normalized records, session Fiber correlation, activation replay, independent sink queues, and lifecycle cleanup.
- `packages/extension-logging-file/` — optional rolling JSONL destination.
- `packages/extension-logging-sentry/` — optional private-client Sentry destination.
- `packages/extension-dynamic-runtime-plugins/src/registry.ts` — feature-owned Package transitions and child-Fiber cleanup.
- `packages/extension-codegraph/src/adapter.ts` — feature-owned discovery, freshness, synchronization, exploration queue, and subprocess cleanup.
- `packages/composition-runtime/src/activation-audit.ts` — structured Loader diagnostics.
