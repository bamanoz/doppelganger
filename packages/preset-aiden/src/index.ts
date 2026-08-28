import { fileURLToPath } from 'node:url'
import type { Plugin } from '@deepseek-ai/cordis'
import {
  defineSerializedCompositionActivation,
  type SerializedCompositionActivation,
  type SerializedValue,
} from '@doppelganger/composition-runtime'
import {
  MemoryProtocolPlugin,
  MemoryService,
  createMemoryCapturePlugin,
} from '@doppelganger/extension-memory'
import {
  IdentityPlugin,
  TraitsPlugin,
  resolvePersonaSelection,
  type PersonaSelectionRequest,
  type ResolvedPersonaSelection,
} from '@doppelganger/extension-persona'
import { ContextProtocol, ToolRegistry } from '@doppelganger/extension-protocols'
import { InstanceSqliteService } from '@doppelganger/extension-sqlite'

export const AidenInstanceSqlitePlugin: Plugin = {
  name: 'doppelganger-aiden-instance-sqlite',
  inject: ['doppelgangerPersona'],
  async apply(ctx) {
    await ctx.plugin(InstanceSqliteService, { home: ctx.doppelgangerPersona.instanceHome })
  },
}
export const AidenMemoryCapturePlugin: Plugin = {
  name: 'doppelganger-aiden-memory-capture',
  inject: ['doppelgangerMemory', 'doppelgangerPersona'],
  async apply(ctx) {
    const value = ctx.doppelgangerPersona.settings.memoryCapture
    let enabled = false
    if (value !== undefined) {
      if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new TypeError('Aiden settings.memoryCapture must be an object')
      }
      const configured = (value as Readonly<Record<string, unknown>>).enabled
      if (configured !== undefined && typeof configured !== 'boolean') {
        throw new TypeError('Aiden settings.memoryCapture.enabled must be a boolean')
      }
      enabled = configured ?? false
    }
    await ctx.plugin(createMemoryCapturePlugin({ enabled }))
  },
}


export const AIDEN_DEFINITION_PATH = fileURLToPath(new URL('../definition/persona.yaml', import.meta.url))

export const AIDEN_EXTENSION_IMPORTS = Object.freeze({
  context: ContextProtocol,
  tools: ToolRegistry,
  storage: AidenInstanceSqlitePlugin,
  memory: MemoryService,
  'memory-protocol': MemoryProtocolPlugin,
  'memory-capture': AidenMemoryCapturePlugin,
  identity: IdentityPlugin,
  traits: TraitsPlugin,
})

export const AIDEN_EXTENSION_REFERENCES = Object.freeze({
  context: { module: '@doppelganger/extension-protocols', exportName: 'ContextProtocol', mode: 'plugin' as const },
  tools: { module: '@doppelganger/extension-protocols', exportName: 'ToolRegistry', mode: 'plugin' as const },
  storage: { module: '@doppelganger/preset-aiden', exportName: 'AidenInstanceSqlitePlugin', mode: 'plugin' as const },
  memory: { module: '@doppelganger/extension-memory', exportName: 'MemoryService', mode: 'plugin' as const },
  'memory-protocol': { module: '@doppelganger/extension-memory', exportName: 'MemoryProtocolPlugin', mode: 'plugin' as const },
  'memory-capture': { module: '@doppelganger/preset-aiden', exportName: 'AidenMemoryCapturePlugin', mode: 'plugin' as const },
  identity: { module: '@doppelganger/extension-persona', exportName: 'IdentityPlugin', mode: 'plugin' as const },
  traits: { module: '@doppelganger/extension-persona', exportName: 'TraitsPlugin', mode: 'plugin' as const },
})
export interface AidenActivationRequest {
  readonly userConfigPath: string
  readonly projectManifestPath?: string
  readonly sessionId: string
  readonly watch?: boolean
}

export async function resolveAidenActivation(
  request: AidenActivationRequest,
): Promise<SerializedCompositionActivation | undefined> {
  const selection = await resolveAidenSelection({
    userConfigPath: request.userConfigPath,
    ...(request.projectManifestPath === undefined ? {} : { projectManifestPath: request.projectManifestPath }),
  })
  if (selection === undefined) return
  return defineSerializedCompositionActivation({
    composition: {
      id: selection.composition.id,
      revision: selection.composition.revision,
      loaderPath: selection.composition.loaderPath,
      imports: AIDEN_EXTENSION_REFERENCES,
      mounts: selection.composition.mounts,
    },
    sessionId: request.sessionId,
    mounts: {
      persona: {
        module: '@doppelganger/extension-persona',
        exportName: 'createPersonaActivationPlugin',
        mode: 'factory',
        config: selection.activation(request.sessionId) as unknown as SerializedValue,
      },
    },
    hostMount: 'host',
    ...(request.watch === undefined ? {} : { watch: request.watch }),
  })
}

export async function resolveAidenSelection(
  request: Omit<PersonaSelectionRequest, 'imports'>,
): Promise<ResolvedPersonaSelection | undefined> {
  return resolvePersonaSelection({
    ...request,
    imports: AIDEN_EXTENSION_IMPORTS,
  })
}


export { PersonaConfigError } from '@doppelganger/extension-persona'