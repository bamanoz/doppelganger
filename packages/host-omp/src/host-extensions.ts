import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from '@deepseek-ai/cordis'
import {
  HOST_EXTENSION_API_VERSION,
  createActorIdentityHostExtension,
  createHostExtensionCatalog,
  createRuntimeHostExtension,
  defineHostExtension,
  readHostExtensionModule,
  type HostExtensionDefinition,
  type HostExtensionSelectionInput,
} from '@doppelganger/doppelganger-host-extensions'
import {
  createActorIdentity,
  type RuntimeHostBinding,
  type RuntimeHostCapabilities,
} from '@doppelganger/doppelganger-protocols'
import {
  OMP_RUNTIME_HOST_CAPABILITIES,
  type OmpHostExtensionConfiguration,
  type OmpHostSessionFacts,
  type PreparedOmpHostExtensions,
} from './contracts.ts'
import { createOmpHostEventPlugin, type OmpHostEventSink } from './omp-host-events.ts'

export const DEFAULT_OMP_HOST_EXTENSION_SELECTIONS: readonly HostExtensionSelectionInput[] = Object.freeze([
  Object.freeze({ id: 'actor' }),
  Object.freeze({ id: 'omp-host-events' }),
  Object.freeze({ id: 'runtime-host' }),
])


function createOmpHostEventExtension(binding: OmpHostEventBinding): HostExtensionDefinition<OmpHostSessionFacts> {
  return defineHostExtension({
    apiVersion: HOST_EXTENSION_API_VERSION,
    hostKind: 'omp',
    id: 'omp-host-events',
    title: 'OMP Host Events',
    normalizeConfig(input) {
      if (input !== undefined && input !== null) throw new TypeError('Host Extension omp-host-events does not accept configuration')
      return null
    },
    createFactory() {
      return () => Object.freeze({
        plugin: createOmpHostEventPlugin(binding),
        isolate: Object.freeze({ doppelgangerRuntimeSession: 'session' as const }),
      })
    },
  })
}

function standardDefinitions(
  binding: RuntimeHostBinding,
  ompHostEventBinding: OmpHostEventBinding,
  capabilities: RuntimeHostCapabilities,
): HostExtensionDefinition<OmpHostSessionFacts>[] {
  return [
    createActorIdentityHostExtension<OmpHostSessionFacts>({ hostKind: 'omp', actorId: context => context.facts.actorId }),
    createOmpHostEventExtension(ompHostEventBinding),
    createRuntimeHostExtension<OmpHostSessionFacts>({ hostKind: 'omp', binding: () => binding, capabilities: () => capabilities }),
  ]
}

function moduleSpecifier(input: unknown, cwd: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new TypeError('OMP Host Extension module must be a non-empty string')
  }
  const specifier = input.trim()
  if (specifier.startsWith('.') || specifier.startsWith('/')) return pathToFileURL(resolve(cwd, specifier)).href
  if (specifier.startsWith('file:')) return new URL(specifier).href
  return import.meta.resolve(specifier, pathToFileURL(resolve(cwd, 'package.json')).href)
}

async function importedDefinitions(
  specifiers: readonly string[],
): Promise<HostExtensionDefinition<OmpHostSessionFacts>[]> {
  const definitions: HostExtensionDefinition<OmpHostSessionFacts>[] = []
  for (const specifier of specifiers) {
    // Module specifiers are trusted runtime configuration and cannot be statically imported.
    definitions.push(readHostExtensionModule<OmpHostSessionFacts>(await import(specifier)))
  }
  return definitions
}

const inertRuntimeBinding: RuntimeHostBinding = Object.freeze({
  attach() {},
  detach() {},
  toolCatalogChanged() {},
})
const inertOmpEventBinding: OmpHostEventBinding = Object.freeze({ attach() {}, detach() {} })
const inertCapabilities = OMP_RUNTIME_HOST_CAPABILITIES

export async function prepareOmpHostExtensions(
  config: OmpHostExtensionConfiguration | undefined,
  cwd: string,
  actorId: unknown,
): Promise<PreparedOmpHostExtensions> {
  const actor = createActorIdentity(actorId)
  const modules = Object.freeze((config?.modules ?? []).map(specifier => moduleSpecifier(specifier, cwd)))
  if (new Set(modules).size !== modules.length) throw new TypeError('OMP Host Extension modules contain duplicate resolved specifiers')
  const imported = await importedDefinitions(modules)
  const catalog = createHostExtensionCatalog('omp', [
    ...standardDefinitions(inertRuntimeBinding, inertOmpEventBinding, inertCapabilities),
    ...imported,
  ])
  const plan = catalog.plan(config?.enabled ?? DEFAULT_OMP_HOST_EXTENSION_SELECTIONS)
  const facts: OmpHostSessionFacts = Object.freeze({
    hostKind: 'omp',
    ...(actor.state === 'bound' ? { actorId: actor.actorId } : {}),
  })
  return Object.freeze({ modules, selections: plan.selections, facts })
}

export interface OmpHostEventBinding {
  attach(sink: OmpHostEventSink): void
  detach(sink: OmpHostEventSink): void
}

export async function instantiateOmpHostExtensions(
  prepared: PreparedOmpHostExtensions,
  context: { readonly sessionId: string; readonly runtimePresetId: string; readonly workspaceRoot?: string },
  binding: RuntimeHostBinding,
  ompHostEventBinding: OmpHostEventBinding,
  capabilities: RuntimeHostCapabilities,
): Promise<{ readonly entries: readonly { readonly id: string; readonly plugin: Plugin; readonly isolate?: Readonly<Record<string, 'session'>> }[] }> {
  const imported = await importedDefinitions(prepared.modules)
  const plan = createHostExtensionCatalog('omp', [
    ...standardDefinitions(binding, ompHostEventBinding, capabilities),
    ...imported,
  ]).restore(prepared.selections)
  return plan.instantiate({ ...context, facts: prepared.facts })
}
