## Context

The file exporter currently opens one configured absolute `path` before it registers its sink. Every normalized record already carries the host `sessionId` and Runtime Preset ID, but that is too late to choose the destination. A fixed path is safe only while one operating-system process owns it because numbered rotation has no interprocess lock.

Composition Runtime already receives the host session ID, creates immutable Runtime Session metadata, and passes that metadata into the session-owned `RuntimeLoggingRouter`. OMP obtains the value from `ctx.sessionManager.getSessionId()` and sends it through the existing activation RPC. No additional host transport is required. However, the host session ID is only validated as non-empty, so it is neither a safe path component nor a sufficient concrete-activation identity across child restarts.

## Goals / Non-Goals

**Goals:**

- Give every concrete Runtime Session activation one safe opaque correlation ID.
- Expose the same activation identity to File, Sentry, and future logging destinations.
- Permit concurrent processes and concurrent sessions to derive distinct rolling-file paths from one authored configuration.
- Keep one activation ID stable across valid and rejected Loader reloads for the lifetime of the session router.
- Preserve static absolute file paths and all existing writer, rotation, failure, and disposal semantics.
- Preserve host neutrality and the existing OMP RPC protocol.

**Non-Goals:**

- Coordinating several processes that intentionally write and rotate one concrete file.
- Using raw host session IDs, actor IDs, workspace paths, process IDs, or Runtime Preset IDs as uniqueness guarantees.
- Adding a log collector, file discovery API, query UI, or host notification.
- Adding activation identity to general Runtime Session metadata or unrelated protocols.

## Decisions

### 1. Composition Runtime owns an opaque activation identity

Composition Runtime creates one canonical lowercase UUID with `randomUUID()` when it constructs a Runtime Session logging router. The value is called `runtimeActivationId`: it identifies one concrete activated session owner, not the logical host session or selected Runtime Preset.

The ID is generated once per router and therefore remains stable while Loader generations are added, replaced, rolled back, or removed. A new Runtime Session activation, including a child restart that reuses a host `sessionId`, receives a new ID. The UUID format is bounded and contains no path separators.

Alternative: use `sessionId`. Rejected because the host controls its content, validation guarantees only a non-empty string, and a host may reuse it across concrete child activations.

Alternative: use `process.pid`. Rejected because one process can own several Runtime Sessions and operating systems reuse process IDs.

### 2. `doppelgangerLogging` exposes immutable scope and records copy it

Add an immutable `RuntimeLoggingScope`:

```ts
interface RuntimeLoggingScope {
  readonly runtimeActivationId: string
  readonly sessionId: string
  readonly runtimePresetId: string
}

interface RuntimeLoggingService {
  readonly scope: RuntimeLoggingScope
  register(sink: RuntimeLogSink, options: RuntimeLogSinkOptions): () => Promise<void>
}
```

`RuntimeLoggingRouter.scope` is frozen and reuses the already validated session and Runtime Preset values. Every `RuntimeLogRecord` copies `runtimeActivationId` in addition to the existing correlation fields. File needs the scope before registration; Sentry and future record-oriented sinks receive the same value on every record.

This does not extend `RuntimeSessionMetadata`, `extension-protocols`, lifecycle payloads, OMP RPC, or the Runtime Host API. The seam remains process-local Composition Runtime infrastructure.

Alternative: make File inject `doppelgangerRuntimeSession` directly. Rejected because it still lacks a concrete-activation identity and would give one destination a private correlation path unavailable to other exporters.

Alternative: delay file opening until the first record. Rejected because file-open failures would no longer participate in audited Loader activation and an idle exporter would have ambiguous lifecycle state.

### 3. File configuration distinguishes static paths from templates

Keep `path` unchanged for a deliberate static concrete destination. Add mutually exclusive `pathTemplate` for an activation-derived destination:

```yaml
config:
  pathTemplate: /var/log/doppelganger/runtime-{runtimeActivationId}.jsonl
```

`pathTemplate` must be a non-empty absolute normalized path containing exactly one `{runtimeActivationId}` token. Unknown tokens, unmatched placeholder braces, repeated activation tokens, specifying neither field, or specifying both fields fail synchronous configuration validation. The exporter replaces the token with the bounded UUID from `doppelgangerLogging.scope`, then defensively verifies that the resolved value remains absolute and normalized before opening it.

The writer receives only a resolved concrete `path`; its process-local duplicate guard, symlink checks, append behavior, rotation names, queueing, and disposal do not gain template logic. Rotation remains local to each resolved path:

```text
runtime-<activation-id>.jsonl
runtime-<activation-id>.jsonl.1
runtime-<activation-id>.jsonl.2
```

Alternative: interpret braces inside the existing `path` field. Rejected because it silently changes the meaning of valid existing paths and makes literal brace handling ambiguous.

Alternative: support arbitrary variables. Rejected because no current use case needs a general interpolation language and every additional variable expands path-safety and compatibility surface.

### 4. Sentry correlates every destination record by activation

Normalized records carry `runtimeActivationId`. The private Sentry client adds it to non-error breadcrumb data and error event tags/context alongside `sessionId`, `runtimePresetId`, logger, severity, and sequence. Sentry does not need pre-registration scope access because it receives correlation on each record, but it uses the same identity rather than generating a destination-local value.

### 5. Concurrent-process behavior is isolation, not locking

Two Runtime Sessions using the same `pathTemplate` resolve distinct concrete paths because each has a distinct `runtimeActivationId`. This is verified both with concurrent sessions in one Composition Runtime and with separate real OMP child processes. Static paths retain the documented one-operating-system-process-per-concrete-path invariant.

A template does not make an intentionally identical resolved path safe, and the implementation adds no lock file. The existing process-local duplicate guard remains a defensive error for accidental same-process collisions.

## Risks / Trade-offs

- **[Risk] UUID collision, while impractical, is not mathematically impossible.** Use Node's cryptographic `randomUUID()` and retain the process-local duplicate-path rejection as a final same-process guard.
- **[Risk] Per-activation files increase file count.** Existing size and generation retention remains per activation; aggregate retention and cleanup are operator-owned and remain outside this change.
- **[Risk] Adding a field changes the public normalized record shape.** The field is required so all destinations share one correlation contract; update all constructors, fixtures, and exhaustive consumers in one clean cutover.
- **[Risk] Template syntax can become an accidental general-purpose language.** Support exactly one token and reject every other placeholder form.
- **[Trade-off] A new activation after restart writes a new file rather than appending the prior activation's file.** This is intentional isolation; logical continuity remains queryable through the `sessionId` contained in each record.
