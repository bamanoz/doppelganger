## 1. OMP Proxy Naming

- [x] 1.1 Replace the generic hexadecimal escaping in `packages/host-omp/src/extension.ts` with a focused OMP projection helper that prefixes `doppelganger_`, replaces portable `.` separators with `_`, preserves segment characters, and enforces the 64-character boundary.
- [x] 1.2 Refactor tool projection validation so overlong or colliding descriptors stay unavailable with precise diagnostics while unrelated valid runtime tools remain projectable.
- [x] 1.3 Keep approval lookup, invocation, descriptor replacement, and stale-closure rejection keyed by the exact canonical dotted descriptor name; add no reverse-decoding path or `_x2e_` compatibility aliases.

## 2. Behavioral Coverage

- [x] 2.1 Update `packages/host-omp/tests/extension.spec.ts` expectations to readable proxy names and cover two-segment, multi-segment, hyphen-preserving, clean-reload, canonical-dispatch, replacement, and stale-closure behavior named by the delta spec.
- [x] 2.2 Add 64-character acceptance, 65-character rejection, collision defense, diagnostic content, and unrelated-tool isolation coverage to `packages/host-omp/tests/extension.spec.ts`.
- [x] 2.3 Migrate `packages/host-omp/tests/dynamic-runtime-plugins.spec.ts`, `packages/host-omp/tests/vertical.spec.ts`, and any other OMP fixtures from `_x2e_` encoding to the new exact projection without weakening their existing approval or lifecycle assertions.

## 3. Documentation and Usage Assets

- [x] 3.1 Update `docs/hosts/oh-my-pi.md` with the canonical dotted-name versus readable OMP proxy-name contract, 64-character host boundary, clean-cutover migration, and diagnostic behavior.
- [x] 3.2 Update `README.md` and every shipped skill, prompt, example, or development asset that names OMP proxies; remove all repository-owned `_x2e_` references outside historical archived OpenSpec evidence.

## 4. Verification

- [x] 4.1 Run the focused `host-omp` typecheck and affected `extension.spec.ts`, `dynamic-runtime-plugins.spec.ts`, and `vertical.spec.ts` tests, fixing every regression in the changed contract.
- [x] 4.2 Exercise the real project-local `.omp/extensions/doppelganger.ts` surface and observe readable projected Doppelganger tool names with canonical dotted invocation.
- [x] 4.3 Run `npm run check` and confirm OpenSpec, documentation, package-boundary, typecheck, and workspace test integrity.
