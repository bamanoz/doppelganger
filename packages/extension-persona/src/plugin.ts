import { isAbsolute, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-composition-runtime'
import { createPersonaActivationPlugin, type PersonaIdentityActivation, type PersonaTraitActivation } from './activation.ts'
import { IdentityPlugin, type IdentityPluginConfig } from './identity.ts'
import { TraitsPlugin } from './traits.ts'

export interface PersonaAssetConfig {
  readonly path: string
  readonly priority?: number
}

export interface PersonaTraitConfig extends PersonaAssetConfig {
  readonly name: string
}

export interface PersonaPluginConfig {
  readonly instanceId: string
  readonly projectId?: string
  readonly assetRoot?: string
  readonly identity?: PersonaAssetConfig
  readonly traits?: readonly PersonaTraitConfig[]
  readonly identitySource?: string
}

function nonEmpty(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalPriority(field: string, value: unknown): number | undefined {
  if (value === undefined) return
  if (!Number.isFinite(value)) throw new TypeError(`${field} must be a finite number`)
  return value as number
}

function strictObject(field: string, value: unknown, allowed: readonly string[]): void {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${field} must be an object`)
  }
  const permitted = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) throw new TypeError(`${field}.${key} is not supported`)
  }
}

function assetPath(field: string, value: unknown, base: string): string {
  const path = nonEmpty(field, value)
  return normalize(isAbsolute(path) ? path : resolve(base, path))
}

function normalizeConfig(ctx: Context, input: PersonaPluginConfig) {
  strictObject('persona', input, [
    'instanceId', 'projectId', 'assetRoot', 'identity', 'traits', 'identitySource',
  ])
  if (input.identity !== undefined) {
    strictObject('persona.identity', input.identity, ['path', 'priority'])
  }
  if (input.traits !== undefined && !Array.isArray(input.traits)) {
    throw new TypeError('persona.traits must be an array')
  }
  const runtime = ctx.doppelgangerRuntimeSession
  const loaderRoot = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
  const base = input.assetRoot === undefined
    ? loaderRoot
    : assetPath('persona.assetRoot', input.assetRoot, loaderRoot)
  const identity: PersonaIdentityActivation | undefined = input.identity === undefined
    ? undefined
    : {
        path: assetPath('persona.identity.path', input.identity.path, base),
        ...optionalPriority('persona.identity.priority', input.identity.priority) === undefined
          ? {}
          : { priority: optionalPriority('persona.identity.priority', input.identity.priority)! },
      }
  const traits: PersonaTraitActivation[] = (input.traits ?? []).map((trait, index) => {
    if (trait === null || Array.isArray(trait) || typeof trait !== 'object') {
      throw new TypeError(`persona.traits[${index}] must be an object`)
    }
    strictObject(`persona.traits[${index}]`, trait, ['name', 'path', 'priority'])
    const priority = optionalPriority(`persona.traits[${index}].priority`, trait.priority)
    return {
      name: nonEmpty(`persona.traits[${index}].name`, trait.name),
      path: assetPath(`persona.traits[${index}].path`, trait.path, base),
      ...(priority === undefined ? {} : { priority }),
    }
  })
  const projectId = runtime.workspaceRoot === undefined
    ? undefined
    : input.projectId === undefined
      ? runtime.workspaceRoot
      : nonEmpty('persona.projectId', input.projectId)
  return {
    activation: {
      instanceId: nonEmpty('persona.instanceId', input.instanceId),
      sessionId: runtime.sessionId,
      ...(projectId === undefined ? {} : { projectId, projectRoot: runtime.workspaceRoot! }),
      ...(identity === undefined ? {} : { identity }),
      traits,
    },
    identity: input.identitySource === undefined
      ? {}
      : { source: nonEmpty('persona.identitySource', input.identitySource) } satisfies IdentityPluginConfig,
  }
}

export const PersonaPlugin: Plugin<PersonaPluginConfig> = {
  name: 'doppelganger-persona',
  provide: 'doppelgangerPersona',
  inject: ['doppelgangerRuntimeSession', 'doppelgangerContext'],
  async apply(ctx: Context, input: PersonaPluginConfig) {
    const config = normalizeConfig(ctx, input)
    await ctx.plugin(createPersonaActivationPlugin(config.activation)).await()
    await ctx.plugin(IdentityPlugin, config.identity).await()
    await ctx.plugin(TraitsPlugin).await()
  },
}

export default PersonaPlugin
