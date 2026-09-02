# Dynamic Runtime Plugins

Dynamic Runtime Plugins are an optional Runtime Preset feature for defining, inspecting, approving, activating, updating, stopping, and removing session-owned Cordis plugins during a live agent session. The kernel and hosts do not generate plugins or make this capability implicit; a preset must explicitly compose `@doppelganger/doppelganger-dynamic-runtime-plugins/loader` beside the standard tool protocol.

The shipped `standard` Runtime Preset omits this capability; user-owned presets opt in explicitly.

OMP executes generated code in its per-session runtime child, which is a failure boundary, not hostile-code containment. The planned native DSH adapter will execute the same capability as same-process trusted code under DSH.

This is a trusted-code workflow, not a security sandbox. Generated source is evaluated in the host runtime process with authority comparable to shell access. `node:vm` narrows and teaches the available API but does not create a process-security boundary. Every `runtime-plugin.run` call therefore requires a fresh native host approval for its exact immutable package metadata.

## Runtime Preset composition

```yaml
- id: doppelganger-tools
  name: "@doppelganger/doppelganger-protocols/tools"
  isolate:
    doppelgangerTools: session

- id: doppelganger-dynamic-runtime-plugins
  name: "@doppelganger/doppelganger-dynamic-runtime-plugins/loader"
  inject: [doppelgangerRuntimeSession, doppelgangerTools]
  isolate:
    doppelgangerRuntimeSession: session
    doppelgangerTools: session
  config:
    vmTimeoutMs: 1000
    maximumSourceBytes: 65536
    maximumPlugins: 32
    maximumPackagesPerPlugin: 32
    maximumTotalSourceBytes: 524288
    maximumInspectionBytes: 65536
```

All configuration fields are optional bounded integers. The remaining defaults are `maximumNameLength: 128`, `maximumPurposeLength: 1024`, `maximumDiagnosticMessageLength: 2048`, and `maximumDiagnosticStackLength: 8192`. Invalid or unknown fields fail activation before control tools register. Omitting the row leaves the Runtime Session and host behavior unchanged.

## Control workflow

The composed feature registers exactly seven portable tools:

1. `runtime-plugin.inspect-list` lists the inspection providers `Builtin`, `Event`, `Service`, and `Tool`.
2. `runtime-plugin.inspect-query` returns one exact source-verified catalog contract or one current source-free portable tool descriptor.
3. `runtime-plugin.define` stores one immutable bounded Package without evaluating it. Exactly one of `idPrefix` for a new Plugin or `pluginId` for an existing Plugin is required.
4. `runtime-plugin.inspect-self` progressively reports Plugins, immutable Packages, current/next pointers, active runs, source on exact Package inspection, waiting dependencies, and bounded diagnostics.
5. `runtime-plugin.run` evaluates and activates one exact Package after native one-shot approval. The approved call binds `pluginId`, `packageId`, `mode`, `name`, `purpose`, and `sourceDigest`; metadata mismatch fails before evaluation.
6. `runtime-plugin.stop` idempotently disposes the active child Fiber while retaining Packages and version pointers.
7. `runtime-plugin.undefine` disposes the active Fiber and removes the Plugin and all of its Packages from the Runtime Session.

Use `mode: run` for the first activation or to restart the current known-good Package. Use `mode: update` only for a different Package after a current Package exists, including an intentional rollback to an older immutable Package. Update disposes the active child Fiber before activating the target. If the target fails, the Plugin stays stopped, the prior known-good `currentPackageId` is retained, and the failed target plus diagnostic remain inspectable; explicitly run the known-good Package to restore its effects.

## Generated Package contract

Package source is a plain JavaScript async-function body and must return a Cordis Plugin function or an object with `apply(ctx)`. Import/export syntax, JSX, TypeScript syntax, Node module loading, native `fetch`, and native timers are unavailable. Generated code must inspect contracts before use and declare catalogued Runtime Session services through the returned Plugin's `inject` field.

```js
return {
  inject: ['doppelgangerTools'],
  apply(ctx) {
    ctx.doppelgangerTools.register({
      name: 'generated.example',
      description: 'Return one generated result',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      invoke() {
        return { generated: true }
      },
    })
  },
}
```

The generated Context is read-only and lifecycle-owned. It permits only catalogued services and events, guarded `ctx.effect`, `ctx.on`, `ctx.once`, qualified non-reserved service provision, tagged logging, and timer helpers backed by an injected `timer` service. The generated catalog is built from checked-in source declarations and verified by `npm run check:catalog`; it is not model-authored documentation. Current approved services are `doppelgangerContext`, `doppelgangerTools`, optional `doppelgangerHttp`, and `timer`.

Generated tool and context registrations are ordinary Cordis effects owned by one child Fiber. Stop, update, undefine, Runtime Preset replacement, Runtime Session disposal, and host shutdown remove them through that Fiber. Stale host proxy closures cannot invoke removed generated tools.

## State and host projection

Plugin IDs, Package source, version pointers, active runs, and diagnostics exist only in the owning Runtime Session. They are not persisted, copied into Runtime Session metadata, or reconstructed after a successful Runtime Preset reload. Invalid owner reload retains the previous active generation and its dynamic state; a valid owner replacement disposes the prior registry and starts an empty one.

OMP projects the seven control tools and any generated portable tools through its normal exact dynamic-proxy path. Only `runtime-plugin.run` is an essential top-level native approval tool; denial, cancellation, or unavailable UI fails before runtime dispatch even in permissive or `yolo` mode. The deferred DSH adapter must preserve the same portable names and gate `runtime-plugin.run` through scoped `tools/pre-execute` and ApprovalService before dispatch.

The `doppelganger-capability-evolution` skill may select this workflow only for reversible behavior owned by the current Runtime Session and supported by inspected catalog contracts. Research consent or an Evolution state transition never authorizes generated code. The runtime-plugin skill's inspection, trust warning, immutable Package metadata, lifecycle, and separate native approval gates remain mandatory. Persistent behavior, dependency installation, permanent product code, and maintained Loader packages route to the separately invoked `doppelganger-plugin-development` skill, which obtains an explicit implementation repository before mutation. Runtime Preset deployment and host Client UI remain owned by their respective workflows; generated Package state is never promoted automatically.

## Primary implementation and evidence

- `packages/extension-dynamic-runtime-plugins/src/plugin.ts` — Loader plugin and portable control tools.
- `packages/extension-dynamic-runtime-plugins/src/catalog.generated.ts` — generated source-verified capability catalog.
- `packages/extension-dynamic-runtime-plugins/src/evaluator.ts` — bounded plain-JavaScript evaluation.
- `packages/extension-dynamic-runtime-plugins/src/guard.ts` — generated Context and lifecycle guards.
- `packages/extension-dynamic-runtime-plugins/src/registry.ts` — immutable Packages, transitions, diagnostics, and cleanup.
- `packages/extension-dynamic-runtime-plugins/tests/` — unit and Loader behavior.
- `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts` — real OMP projection, approval, lifecycle, reload, isolation, and failure behavior.
