---
name: doppelganger-plugin-development
description: Create, build, modify, or repair permanent installable Doppelganger plugins and npm packages. Use when maintained plugin source must survive Runtime Sessions and process restarts instead of remaining a temporary Dynamic Runtime Plugin.
---

# Doppelganger Plugin Development

## Invocation and authority

Install this one canonical Skill at project scope for both hosts. Invoke it as:

- OMP: `/skill:doppelganger-plugin-development ...`
- DSH: `/doppelganger-plugin-development ...`

Skill invocation grants no authority to choose an implementation repository, mutate an incidental workspace, publish a package, release a version, create a remote repository, commit, or push. Use ordinary repository and coding tools only after the implementation-location gate succeeds and then obey the selected repository's governing rules.

## Fit gate

Use this workflow only for maintained source that must survive Runtime Session and host-process restart and be installable as a permanent Doppelganger plugin or package.

Route other work before creating repository files:

- reversible behavior owned only by the current Runtime Session routes to `doppelganger-runtime-plugin-development`;
- research or mechanism selection routes to `doppelganger-capability-evolution` and stops at that workflow's boundary;
- Persona text or trait changes route to Persona Authoring;
- browser DOM, native host Client UI, Claude Code plugins, or another surface absent from Doppelganger contracts route to the owning host workflow; and
- one-shot tasks already served by a maintained capability use that capability directly.

A selected Evolution proposal grants no implementation authority. Dynamic Runtime Plugin Packages are session-owned generated code, not maintained package source, a persistence mechanism, or an automatic promotion path.

## Implementation-location gate

Before creating or modifying any directory, manifest, planning artifact, source file, test, documentation, or configuration, establish the implementation repository from an explicit user choice.

An explicit current-conversation statement that the package belongs in a named location satisfies the gate. Otherwise ask the user to choose exactly one placement:

1. the current repository, explicitly selected;
2. a named existing repository, with its concrete accessible path; or
3. a new repository, with its intended local path.

The current working directory, Skill installation directory, Evolution proposal scope or storage, repository containing prior discussion, and location of a related Runtime Preset are context only. Never infer ownership from them.

Read-only inspection may identify available choices but cannot decide ownership. If no location is supplied, ask and stop before every write-oriented workflow step. If a named path is unavailable or resolves to a different repository than the user intended, report the exact mismatch and stop instead of falling back to the original working directory.

For a new repository, require the intended local path before creating the project root. Before choosing package defaults, also resolve material public choices with the user: package identity, npm scope ownership, and public or private publication visibility. Local creation never authorizes remote repository creation or hosting configuration.

## Re-ground in the selected repository

After the location choice and before planning or editing, restart discovery from the selected location. Do not carry package, tooling, planning, or release assumptions from the original working directory.

Read and follow the selected repository's:

- governing agent instructions and documentation ownership map;
- workspace and package manifests;
- neighboring maintained plugin and package structure;
- dependency, naming, import, and public export conventions;
- language, package manager, build, test, fixture, and documentation patterns; and
- required repository, integrity, security, release, and changelog gates.

Prefer existing target-repository conventions. Add no second scaffold, package architecture, manifest authority, or executable dependency-edge list beside them.

Planning is target-owned. Create or update planning artifacts only when the user explicitly requested planning or the selected repository's governing instructions require its planning workflow. Do not assume OpenSpec, create an OpenSpec change merely because Evolution preceded development, or write planning files into the incidental repository.

## Inspect current contracts

Before writing imports, injection metadata, configuration, handlers, or public types, inspect the current primary documentation or source for every required Cordis, Doppelganger, and target-package contract. Inspect only the services and boundaries this plugin needs. Do not rely on remembered APIs, copy a fixed scaffold, or infer behavior from a temporary generated Plugin.

A portable permanent Doppelganger extension remains an ordinary Cordis Loader plugin:

- required services belong in `inject`; optional services remain genuinely optional;
- isolation realms match the services shared within a Runtime Session;
- listeners, providers, watchers, timers, subscriptions, and external resources are Cordis effects disposed with the owning plugin Fiber;
- Loader wrappers await nested plugin Fibers instead of returning a Fiber as an effect;
- YAML, tool, RPC, lifecycle, configuration, and persistence boundaries accept validated JSON-compatible values;
- public contracts use the selected package's established exports and Loader-only entries use declared subpath exports; and
- reusable behavior stays host-neutral, with host adaptation confined to an owning host package only when Doppelganger exposes no portable seam.

Use existing services, storage, protocols, lifecycle, approval, reload, and watcher paths. Do not build parallel frameworks beside them.

## Implement the maintained package

Translate the requested behavior into observable acceptance criteria, then make the smallest clean end-to-end change in the selected repository:

1. add or update the owning package and public exports;
2. declare strict configuration, dependencies, injections, isolation, and lifecycle ownership;
3. implement real behavior without stubs, placeholders, no-op fallbacks, hidden compatibility aliases, or copied session state;
4. migrate every affected caller and remove obsolete paths created by the cutover;
5. update authoritative package, dependency-boundary, Loader, and distribution manifests;
6. update the owning architecture, feature, configuration, operations, usage, and changelog documentation required by the repository; and
7. document consumer installation, package resolvability, imports or subpath exports, Loader composition and configuration, and rollback or removal.

Do not mutate a user-owned Runtime Preset or deployment merely to prove package development unless the user separately requests that deployment action. Use disposable representative composition for verification.

## Verify behavior and installability

Run the narrowest target-package checks while iterating, then every applicable final gate required by the selected repository. Report only observed results.

For a new or materially changed installable package, prove:

1. package build or typecheck and behavioral tests for the public plugin contract;
2. owned lifecycle cleanup and relevant failure boundaries;
3. packed or publishable file contents and declared public exports;
4. installation into a disposable consumer outside the source tree through the supported package-manager path;
5. imports from the installed consumer, including intended Loader subpath exports;
6. minimal real Cordis Loader activation when the package is Loader-addressable;
7. observable behavior through the package's public protocol or representative host-neutral surface;
8. omission neutrality, disposal, and rollback or removal where applicable; and
9. the selected repository's final integrity and security or dependency gate.

Do not publish as a substitute for consumer-install testing. A package that cannot be built, packed, installed outside its source tree, imported through declared exports, activated where applicable, exercised, disposed, documented, and removed through supported paths is incomplete.

## Consequential operations and handoff

Successful development does not authorize `npm publish`, a version release, remote repository creation, git commit, or push. Perform any such operation only after a separate explicit user request and through the applicable repository or release workflow.

At completion report:

- the exact selected implementation repository and package;
- the implemented public contract and Loader entry when applicable;
- the observed behavior, package-content, consumer-install, export, activation, cleanup, and repository-gate evidence;
- installation and rollback documentation added;
- unresolved dependency, security, migration, publication, or host-specific risks; and
- the next separately authorized release or repository action, without claiming it occurred.

If an Evolution proposal originated the work, leave proposal transitions to the separately invoked Evolution workflow and its exact controls.