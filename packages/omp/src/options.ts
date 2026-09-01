import type { DoppelgangerOmpExtensionOptions } from '@doppelganger/doppelganger-host-omp'

export function optionsFromEnvironment(environment: NodeJS.ProcessEnv): DoppelgangerOmpExtensionOptions {
  const actorId = environment.DOPPELGANGER_ACTOR_ID?.trim()
  return actorId === undefined || actorId.length === 0 ? {} : { actorId }
}
