import type { Context, Plugin } from '@deepseek-ai/cordis'

export const ACTOR_IDENTITY_SERVICE = 'doppelgangerActor' as const

export type ActorIdentity =
  | { readonly state: 'bound'; readonly actorId: string }
  | { readonly state: 'unbound' }

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerActor: ActorIdentity
  }
}

export function createActorIdentity(actorId?: unknown): ActorIdentity {
  if (actorId === undefined) return Object.freeze({ state: 'unbound' as const })
  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new TypeError('actorId must be a non-empty string')
  }
  return Object.freeze({ state: 'bound' as const, actorId: actorId.trim() })
}

export function createActorIdentityPlugin(actorId?: unknown): Plugin {
  const identity = createActorIdentity(actorId)
  return {
    name: 'doppelganger-actor-identity',
    apply(ctx: Context) {
      const logger = ctx.logger('doppelganger-actor-identity')
      logger.info('component.active state=%s', identity.state)
      ctx.provide(ACTOR_IDENTITY_SERVICE, identity)
      ctx.effect(() => () => { logger.info('component.disposal.started') }, 'doppelgangerActor.logDisposal')
    },
  }
}
