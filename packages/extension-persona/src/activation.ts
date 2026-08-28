import { isAbsolute, normalize } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { JsonValue } from '@doppelganger/extension-protocols'


export interface PersonaIdentityActivation {
  readonly path: string
  readonly priority?: number
}

export interface PersonaTraitActivation extends PersonaIdentityActivation {
  readonly name: string
}
export const PERSONA_ACTIVATION_SERVICE = 'doppelgangerPersona' as const

export interface PersonaActivationInput {
  instanceId: string
  principalId: string
  sessionId: string
  projectId?: string
  projectRoot?: string
  instanceHome: string
  definitionRoot: string
  identity?: PersonaIdentityActivation
  settings?: Readonly<Record<string, JsonValue>>
  traits?: readonly PersonaTraitActivation[]
}

export interface PersonaActivation {
  readonly instanceId: string
  readonly principalId: string
  readonly sessionId: string
  readonly projectId?: string
  readonly projectRoot?: string
  readonly instanceHome: string
  readonly definitionRoot: string
  readonly identity?: PersonaIdentityActivation
  readonly settings: Readonly<Record<string, JsonValue>>
  readonly traits: readonly PersonaTraitActivation[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerPersona: PersonaActivation
  }
}

function nonEmpty(field: string, value: string): string {
  if (value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function absolutePath(field: string, value: string): string {
  const path = normalize(nonEmpty(field, value))
  if (!isAbsolute(path)) throw new TypeError(`${field} must be absolute`)
  return path
}
function settings(value: Readonly<Record<string, JsonValue>> | undefined): Readonly<Record<string, JsonValue>> {
  if (value === undefined) return Object.freeze({})
  return Object.freeze(JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>)
}


export function createPersonaActivation(input: PersonaActivationInput): PersonaActivation {
  const hasProjectId = input.projectId !== undefined
  const hasProjectRoot = input.projectRoot !== undefined
  if (hasProjectId !== hasProjectRoot) {
    throw new TypeError('persona projectId and projectRoot must either both be present or both be absent')
  }
  const identity = input.identity === undefined ? undefined : Object.freeze({ ...input.identity })
  const traits = Object.freeze((input.traits ?? []).map(trait => Object.freeze({ ...trait })))
  const instanceSettings = settings(input.settings)
  return Object.freeze({
    instanceId: nonEmpty('persona.instanceId', input.instanceId),
    principalId: nonEmpty('persona.principalId', input.principalId),
    sessionId: nonEmpty('persona.sessionId', input.sessionId),
    instanceHome: absolutePath('persona.instanceHome', input.instanceHome),
    definitionRoot: absolutePath('persona.definitionRoot', input.definitionRoot),
    ...(input.projectId === undefined ? {} : {
      projectId: nonEmpty('persona.projectId', input.projectId),
      projectRoot: absolutePath('persona.projectRoot', input.projectRoot as string),
    }),
    ...(identity === undefined ? {} : { identity }),
    settings: instanceSettings,
    traits,
  })
}

export function createPersonaActivationPlugin(input: PersonaActivationInput): Plugin {
  const activation = createPersonaActivation(input)
  return {
    name: 'doppelganger-persona-activation',
    apply(ctx: Context) {
      ctx.provide(PERSONA_ACTIVATION_SERVICE, activation)
    },
  }
}
