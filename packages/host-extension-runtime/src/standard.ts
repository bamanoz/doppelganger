import {
  createActorIdentityPlugin,
  createRuntimeHostPlugin,
  type RuntimeHostBinding,
} from '@doppelganger/doppelganger-protocols'
import {
  HOST_EXTENSION_API_VERSION,
  type HostExtensionDefinition,
  type HostExtensionSessionContext,
  type HostSessionFacts,
} from './contracts.ts'
import { defineHostExtension } from './runtime.ts'


export interface ActorIdentityHostExtensionOptions<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly hostKind: string
  readonly id?: string
  actorId(context: HostExtensionSessionContext<Facts>): unknown
}

export function createActorIdentityHostExtension<Facts extends HostSessionFacts>(
  options: ActorIdentityHostExtensionOptions<Facts>,
): HostExtensionDefinition<Facts> {
  const id = options.id ?? 'actor'
  return defineHostExtension({
    apiVersion: HOST_EXTENSION_API_VERSION,
    hostKind: options.hostKind,
    id,
    title: 'Actor Identity',
    normalizeConfig(input) {
      if (input !== undefined && input !== null) throw new TypeError(`Host Extension ${id} does not accept configuration`)
      return null
    },
    createFactory() {
      return context => Object.freeze({
        plugin: createActorIdentityPlugin(options.actorId(context)),
        isolate: Object.freeze({ doppelgangerActor: 'session' as const }),
      })
    },
  })
}

export interface RuntimeHostExtensionOptions<Facts extends HostSessionFacts = HostSessionFacts> {
  readonly hostKind: string
  readonly id?: string
  binding(context: HostExtensionSessionContext<Facts>): RuntimeHostBinding
  capabilities(context: HostExtensionSessionContext<Facts>): unknown
}

export function createRuntimeHostExtension<Facts extends HostSessionFacts>(
  options: RuntimeHostExtensionOptions<Facts>,
): HostExtensionDefinition<Facts> {
  const id = options.id ?? 'runtime-host'
  return defineHostExtension({
    apiVersion: HOST_EXTENSION_API_VERSION,
    hostKind: options.hostKind,
    id,
    title: 'Runtime Host Bridge',
    normalizeConfig(input) {
      if (input !== undefined && input !== null) throw new TypeError(`Host Extension ${id} does not accept configuration`)
      return null
    },
    createFactory() {
      return context => Object.freeze({
        plugin: createRuntimeHostPlugin(options.binding(context), options.capabilities(context)),
        isolate: Object.freeze({
          doppelgangerRuntimeSession: 'session' as const,
          doppelgangerContext: 'session' as const,
          doppelgangerHostCapabilities: 'session' as const,
          doppelgangerLifecycle: 'session' as const,
          doppelgangerTools: 'session' as const,
        }),
      })
    },
  })
}
