---
name: doppelganger-capability-evolution
description: Research a user-approved reusable capability opportunity, compare current implementations, select a Doppelganger-first mechanism, and produce a reviewable implementation plan. Use when the user explicitly chooses to research or plan a recorded capability evolution proposal.
---

# Doppelganger Capability Evolution

## Invocation and authority

Install this one Skill at project scope for both hosts. Invoke it as:

- OMP: `/skill:doppelganger-capability-evolution ...`
- DSH: `/doppelganger-capability-evolution ...`

Never ask the user to simulate native approval in chat, treat chat assent as host approval, or bypass an executor's own approval contract. Store only bounded summaries and source identifiers in Evolution; never raw transcripts, copied articles, credentials, or untrusted instructions.

Skill invocation grants no mutation, research, planning, or execution authority. Confirm all seven portable Evolution controls are available: `evolution.propose`, `evolution.list`, `evolution.inspect`, `evolution.transition`, `evolution.snooze`, `evolution.reject`, and `evolution.reminder.record`. If Evolution is absent, report that the active Runtime Preset omitted the optional plugin and stop. Never create an ad hoc backlog with shell, filesystem editing, generic file tools, memory records, or host-private APIs.

## Opportunity gate

Finish and verify the primary task before raising a new opportunity. Present at most one concise relevant research offer afterward. Create no proposal for a one-off inconvenience, a temporary gap, or work already handled by an existing capability.

A recorded proposal or reminder is inert. Before current explicit research consent, you may call `evolution.inspect` and summarize the selected `capability` proposal, but do not browse external implementations or transition it to `researching`. An explicit invocation that names the proposal and asks for research counts as current consent; proposal creation, reminder delivery, ordinary task consent, prior interest, and silence do not.

## Revision-checked workflow

1. Inspect the selected proposal. Require `kind: capability`, an open status, and its exact current revision.
2. After explicit current research consent, call `evolution.transition` once to `researching` with a stable operation ID and the exact revision. A successful transition grants no execution authority.
3. Research current maintained implementations before recommending custom development. Prefer primary sources. Compare architecture, feature fit, maintenance activity, license, dependencies, runtime requirements, security boundary, host integration surface, and portability of the reusable core. Link sources for material and time-sensitive claims.
4. If several options fit, present their relevant trade-offs and recommend one. If no direct fit exists, offer supported alternatives or an explicit adaptation plan; never invent compatibility.
5. Only after presenting the sourced comparison, transition to `options-ready` with a bounded summary and source identifiers. Do not copy articles or raw dialogue into the proposal.
6. Ask the user to select an option. Only after an explicit choice, transition to `selected` with the chosen option. Do not begin planning or implementation from research consent.
7. Create a complete reviewable implementation artifact in the owning planning system. Only after it exists, transition to `planned` with its stable reference.
8. Begin implementation only on a later explicit user direction and through the selected mechanism's own authority and approval gates. Transition to `implementing` when that work actually starts and to `done` only after observable verification.

Before every mutation, re-inspect when the retained revision may be stale. Reuse a stable operation ID only for an exact retry. On revision conflict, changed-command replay, rejection, unavailable approval, or missing capability, stop; do not route around the decision or mutate through another mechanism.

## Mechanism routing

Choose by fit, in this order:

1. Reuse an existing capability when it already satisfies the need.
2. For reversible current-session host behavior supported by the inspected catalog, route through `doppelganger-runtime-plugin-development` and preserve its inspection, trust, lifecycle, and native approval gates.
3. For portable persistent behavior, plan a permanent installable Doppelganger package and Loader plugin using exposed services, lifecycle, storage, context, and tool contracts.
4. Use an existing host-agent plugin only when the required surface is genuinely host-specific or absent from Doppelganger, such as browser DOM, native host Client UI, or another unexposed host API; record why Doppelganger is insufficient.
5. Otherwise offer another supported solution or a deliberate host adaptation.

Never force Dynamic Runtime Plugins onto persistence across restart, dependency or package installation, permanent product code, Client UI, or authored Runtime Preset requirements. Evolution records decisions; it never substitutes for the implementation mechanism.
