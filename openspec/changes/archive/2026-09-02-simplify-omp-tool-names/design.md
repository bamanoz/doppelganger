## Context

Portable Doppelganger tools use stable dotted names such as `memory.search`, `persona.revise`, and `runtime-plugin.inspect-list`. OMP providers require function-safe names, so `packages/host-omp/src/extension.ts` currently prefixes each tool with `doppelganger_` and hex-escapes every unsupported character. A dot therefore becomes `_x2e_`, producing names that are reversible but noisy in model tool lists, approval prompts, tests, documentation, and user guidance.

The portable protocol already restricts qualified names to lowercase alphanumeric and hyphenated segments separated by dots. Underscore is not a legal portable-name character. That invariant makes dot-to-underscore replacement collision-free for valid descriptors. OMP proxy closures also already retain descriptor state, so runtime dispatch need not decode the provider-facing name.

The strict common provider boundary for function names is 64 ASCII characters. The fixed `doppelganger_` prefix occupies 13 characters, leaving at most 51 characters for a portable name under this OMP projection. The host-neutral protocol remains unrestricted by this host-specific budget.

## Goals / Non-Goals

**Goals:**

- Expose concise readable OMP names such as `doppelganger_memory_search`.
- Preserve an injective mapping for every valid portable tool name.
- Keep the dotted portable name canonical for approval, diagnostics, lifecycle ownership, and `tools.invoke`.
- Reject names that cannot be represented safely across OMP providers before registration.
- Preserve exact dynamic add, replacement, removal, approval, and stale-closure behavior.
- Perform a clean cutover across source, tests, documentation, and shipped usage assets.

**Non-Goals:**

- Change the host-neutral portable tool-name grammar.
- Change the names projected by DeepSeek Harness or another host.
- Add a general-purpose reversible encoder for arbitrary strings.
- Preserve `_x2e_` aliases or accept both naming schemes.
- Truncate or hash long names to force them through the provider boundary.

## Decisions

### Use fixed prefix plus dot-to-underscore replacement

The OMP proxy name is:

```text
doppelganger_ + portableName.replaceAll('.', '_')
```

Hyphens and alphanumeric segment characters remain unchanged. Because valid portable names cannot contain `_`, replacing the only separator with `_` is injective. The fixed prefix continues to distinguish Doppelganger proxies from native OMP tools.

Alternatives rejected:

- Keep `_x2e_`: reversible, but leaks an implementation encoding into every visible name.
- Remove the prefix: shorter, but increases collisions with native or third-party OMP tools and weakens ownership filtering.
- Percent-, base64-, or generic hex-encoding: handles inputs forbidden by the portable contract and therefore adds complexity without capability.

### Dispatch through committed descriptor associations, not reverse decoding

Projection retains the canonical descriptor under its dotted name and associates each registered proxy with that exact identity. Approval callbacks and execution resolve the current committed descriptor for that identity. Execution sends `descriptor.name` to `tools.invoke` directly.

The adapter may test the projection function when deciding whether a retained closure is still current, but correctness does not depend on parsing `_` back into `.`. This avoids making transport spelling an authority boundary and remains correct if OMP naming changes again.

Alternative rejected: decode every underscore into a dot at call time. It is currently reversible, but unnecessarily makes dispatch depend on a derived UI name rather than the authoritative descriptor.

### Enforce a 64-character OMP proxy boundary

Projection validates the complete ASCII proxy name, including `doppelganger_`, before registration. A 64-character name is accepted; a 65-character name is rejected with a diagnostic naming the portable tool and limit. The adapter does not truncate or hash because either approach obscures identity and introduces collision or migration policy.

This is an OMP-host constraint, not a new portable protocol restriction. Other hosts may project longer canonical names when their native contracts permit it.

Alternative rejected: impose a 51-character global portable-name limit. That would couple the host-neutral protocol to one host's provider surface.

### Keep projection validation deterministic and isolated

The adapter computes the proxy name and validates its length and collision status before registering it. Collision checks remain defensive even though valid portable descriptors cannot collide under the current grammar. A descriptor that cannot be projected remains unavailable and emits a diagnostic; unrelated valid descriptors remain eligible for projection.

Dynamic replacement continues to key current descriptor state by the canonical portable name. A closure retained after removal finds no current descriptor and returns `RUNTIME_UNAVAILABLE`; a closure retained across replacement of the same portable name resolves current approval and invocation metadata.

### Make a clean naming cutover

All repository-owned OMP call sites, expectations, examples, and shipped skill instructions move to readable proxy names in the same implementation. Old names are not registered as aliases. Supporting both would duplicate tool definitions, increase prompt surface, make approval ownership less obvious, and delay removal indefinitely.

The migration is explicit: external prompts or scripts replace `_x2e_` with `_` for portable separators. Canonical dotted names and non-OMP host behavior do not change.

## Risks / Trade-offs

- **Breaking stored prompts and scripts:** Existing callers that mention `_x2e_` names stop working. Mitigation: clean repository-wide migration and a clear changelog/host-documentation note.
- **Provider limit may later increase:** The conservative 64-character boundary may reject names some providers accept. Mitigation: keep the constant and diagnostic OMP-specific so a future evidence-backed change is local.
- **Partial projection after one invalid descriptor:** A malformed or overlong tool can be unavailable while unrelated tools remain active, so host and runtime discovery sets differ. Mitigation: emit an explicit diagnostic and never silently rename the rejected tool.
- **Future grammar expansion:** Allowing `_` in portable names would invalidate the injectivity proof. Mitigation: the protocol grammar remains unchanged; any future expansion must revise OMP projection in the same change.
- **Hidden legacy references:** `_x2e_` appears in tests, README guidance, and tool-usage assets. Mitigation: repository-wide search during implementation plus the full `npm run check` gate.
