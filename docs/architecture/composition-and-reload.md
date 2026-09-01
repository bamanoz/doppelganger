# Composition and reload

## Runtime Preset roster

`@doppelganger/doppelganger-runtime-presets` owns the control plane before activation. Its pure API and Cordis service expose the same ordered-root roster: the package-owned shipped root, configured roots, then the derived user root at `$DOPPELGANGER_HOME/.runtime-presets` unless disabled. Every root has `system` or `user` trust. Discovery is deterministic and first-root-wins; a broken higher-precedence directory occupies its ID and never falls through to a lower healthy copy.

The package ships `presets/standard/` and its Cordis plugin uses `standard` as the deployment default unless explicitly configured without one. Before first selection from an uninitialized home, the roster creates the editable `config.yaml` and `runtime.cordis.patch.yml` control files plus the derived `.runtime-presets/` user root; it never overwrites them or copies the package-owned `standard` tree. Selection remains strict: explicit host/session choice, project choice, user default, then deployment default. The roster selects and validates a base definition; Composition Runtime remains the only activation, patch, watch, rollback, and Runtime Session owner.

Copy-only authoring resolves a healthy source through the roster, copies its complete directory into the first writable `user` root without overwriting any occupied ID, dereferences symlinks, tightens modes, and rewrites display metadata. Removal is limited to the winning preset owned by that writable root. Removing the selected user default also rewrites `config.yaml` without the stale selection, with rollback on reported failure.

## Effective composition

A Runtime Preset is a complete Loader tree, including an empty top-level list. Runtime Patches use native Cordis Include syntax; Doppelganger does not define a second patch language or deep-merge plugin configuration.

The effective tree applies these layers in order:

1. selected `runtime.cordis.yml`;
2. optional `$DOPPELGANGER_HOME/runtime.cordis.patch.yml`;
3. optional `<project>/.doppelganger/runtime.cordis.patch.yml`;
4. explicit host/session patches;
5. protected runtime-owned host bridge.

Later replacement semantics are Cordis semantics. Targeted mutations must match the tree produced by earlier layers or fail visibly. Relative plugin assets inserted by a filesystem patch resolve from that patch file's directory.

Runtime-owned entry and import identities are reserved. Authored presets and caller patches cannot forge, replace, or remove the final host bridge.

## Activation

Activation loads and validates every source, builds the effective entry list, mounts a session-owned Include tree, waits for nested plugin Fibers, and audits every enabled entry. Missing dependencies, duplicate services, invalid entries, or failed plugins prevent the Runtime Session from being returned. Partial activation is disposed.

Direct Composition Definition construction and serialized host activation use one package-private canonicalizer. It enforces non-empty identifiers, lowercase kebab-case Runtime Preset IDs, absolute supported Loader paths, cloned and deeply frozen patch data, omitted absent optional fields, and deterministic field-labelled diagnostics. Public entry points add only their context-specific activation fields.

Parallel Runtime Sessions share no mutable plugin objects, handlers, fibers, or feature metadata. They may share only authored assets and storage explicitly configured by plugins.

Runtime Session metadata is limited to:

- stable host session ID;
- selected Runtime Preset ID;
- optional absolute workspace root.

Feature metadata belongs to feature extensions.

## Transactional reload

The runtime watches the selected base file and all applicable optional patch paths, including creation and deletion. One serialized mutation queue rebuilds all filesystem layers on every change.

A candidate generation commits only after Loader update, Fiber settlement, and activation audit succeed. A failure restores the previous effective generation and records reload diagnostics. The active session remains usable. For watched config changes, success/failure observers are published after one configured HMR quiet window while the refresh remains active; an immediate observer-driven follow-up write is therefore marked dirty and processed instead of being coalesced into the prior event. A committed generation changes the effective revision and affects the next host interaction.

Reload resets plugin-local runtime state. Plugin-owned persistent state survives according to its provider. Authored base and patch files remain byte-for-byte inputs and are never Loader write-back targets.

Optional feature plugins may coordinate an authored asset mutation with this same reload owner; they do not create a second watcher or activation path. Persona Authoring writes one exact configured trait candidate under its own lock, waits for Persona's URL-and-byte-revision reload outcome, and reports success only after the candidate is active. A rejected or timed-out candidate is atomically restored and the previous revision is awaited. Composition Runtime remains the sole generation and rollback authority.

## Disposal

Session disposal is idempotent and first waits for the serialized mutation queue. It then attempts every owned cleanup stage even if another rejects: exact config watches are removed, the session Fiber is disposed to Cordis quiescence, and runtime ownership is removed in a `finally`-equivalent path. Failures are collected and reported only after all reachable session cleanup settles.

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
- `packages/composition-runtime/src/activation-audit.ts` — structured Loader diagnostics.
