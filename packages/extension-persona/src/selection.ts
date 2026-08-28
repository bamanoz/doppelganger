import { dirname } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { createCompositionDefinition, type CompositionDefinition } from '@doppelganger/composition-runtime'
import { ContextProtocol } from '@doppelganger/extension-protocols'
import {
  createPersonaActivationPlugin,
  type PersonaActivationInput,
} from './activation.ts'
import {
  PersonaConfigError,
  loadPersonaDefinitionMetadata,
  loadPersonaInstanceMetadata,
  loadProjectPersonaManifest,
  loadUserPersonaConfig,
  type ConfigDiagnostic,
  type LoadedPersonaDefinition,
  type PersonaInstanceMetadata,
  type ProjectPersonaManifest,
  type UserPersonaConfig,
} from './config.ts'
import { IdentityPlugin } from './identity.ts'
import { TraitsPlugin } from './traits.ts'

export interface PersonaSelectionRequest {
  readonly userConfigPath: string
  readonly projectManifestPath?: string
  readonly imports?: Readonly<Record<string, Plugin>>
}

export interface ResolvedPersonaSelection {
  readonly user: UserPersonaConfig
  readonly project?: ProjectPersonaManifest
  readonly instance: PersonaInstanceMetadata
  readonly instanceHome: string
  readonly definition: LoadedPersonaDefinition
  readonly composition: CompositionDefinition
  readonly selectedTraits: readonly string[]
  activation(sessionId: string): PersonaActivationInput
  personaMount(sessionId: string): Plugin
}

function entriesNamed(entries: readonly EntryOptions[], name: string): EntryOptions[] {
  const matches: EntryOptions[] = []
  for (const entry of entries) {
    if (entry.name === name) matches.push(entry)
    if (entry.group === true && Array.isArray(entry.config)) matches.push(...entriesNamed(entry.config, name))
  }
  return matches
}

function requireUniqueEntry(
  definition: LoadedPersonaDefinition,
  pluginName: string,
  required: boolean,
  diagnostics: ConfigDiagnostic[],
): void {
  const matches = entriesNamed(definition.entries, pluginName)
  if (matches.length === 0 && required) diagnostics.push({ path: '$.loader', message: `missing ${pluginName} entry` })
  if (matches.length > 1) diagnostics.push({ path: '$.loader', message: `contains multiple ${pluginName} entries` })
}

export async function resolvePersonaSelection(
  request: PersonaSelectionRequest,
): Promise<ResolvedPersonaSelection | undefined> {
  const user = await loadUserPersonaConfig(request.userConfigPath)
  const project = request.projectManifestPath === undefined
    ? undefined
    : await loadProjectPersonaManifest(request.projectManifestPath)
  const instanceId = project?.instanceId ?? user.defaultInstance
  if (instanceId === undefined) return
  const instancePath = user.instances[instanceId]
  if (instancePath === undefined) {
    const filename = project === undefined ? request.userConfigPath : request.projectManifestPath!
    const path = project === undefined ? '$.defaultInstance' : '$.instanceId'
    throw new PersonaConfigError(filename, [{ path, message: `unknown instance "${instanceId}"` }])
  }
  const instance = await loadPersonaInstanceMetadata(instancePath)
  if (instance.id !== instanceId) {
    throw new PersonaConfigError(instancePath, [{
      path: '$.id',
      message: `must equal selected instance ID "${instanceId}"`,
    }])
  }
  const definition = await loadPersonaDefinitionMetadata(instance.definition)
  const selectedTraits = Object.freeze([...(project?.traits ?? [])])
  const diagnostics: ConfigDiagnostic[] = []
  requireUniqueEntry(definition, 'cordis:identity', definition.identity !== undefined, diagnostics)
  requireUniqueEntry(definition, 'cordis:traits', selectedTraits.length > 0, diagnostics)
  if (definition.mounts.persona === undefined) {
    diagnostics.push({ path: '$.mounts.persona', message: 'missing required persona metadata mount' })
  }
  const traits = selectedTraits.flatMap((name, index) => {
    const trait = definition.traits[name]
    if (trait === undefined) {
      diagnostics.push({ path: `$.traits[${index}]`, message: `unknown trait "${name}"` })
      return []
    }
    return [{ name, path: trait.path, ...(trait.priority === undefined ? {} : { priority: trait.priority }) }]
  })
  if (diagnostics.length > 0) {
    throw new PersonaConfigError(request.projectManifestPath ?? definition.metadataPath, diagnostics)
  }

  const imports: Record<string, Plugin> = {
    context: ContextProtocol,
    identity: IdentityPlugin,
    traits: TraitsPlugin,
    ...(request.imports ?? {}),
  }
  const composition = createCompositionDefinition({
    id: definition.id,
    revision: definition.revision,
    loaderPath: definition.loaderPath,
    imports,
    mounts: definition.mounts,
  })
  const instanceHome = dirname(instancePath)
  const projectRoot = request.projectManifestPath === undefined
    ? undefined
    : dirname(dirname(request.projectManifestPath))
  const activation = (sessionId: string): PersonaActivationInput => ({
    instanceId: instance.id,
    principalId: user.principalId,
    sessionId,
    instanceHome,
    definitionRoot: definition.root,
    settings: instance.settings,
    ...(definition.identity === undefined ? {} : { identity: definition.identity }),
    traits,
    ...(project === undefined ? {} : {
      projectId: project.projectId,
      projectRoot: projectRoot!,
    }),
  })
  return Object.freeze({
    user,
    ...(project === undefined ? {} : { project }),
    instance,
    instanceHome,
    definition,
    composition,
    selectedTraits,
    activation,
    personaMount: (sessionId: string) => createPersonaActivationPlugin(activation(sessionId)),
  })
}
