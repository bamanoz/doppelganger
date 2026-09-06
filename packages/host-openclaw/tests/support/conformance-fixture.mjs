const EMPTY_CATALOG = Object.freeze({ revision: 'catalog:0', tools: Object.freeze([]) })

function gate(map, id) {
  let current = map.get(id)
  if (current === undefined) {
    current = Promise.withResolvers()
    map.set(id, current)
  }
  return current
}

function definitionsFor(state, ctx, definitions) {
  return definitions.map(({ fixtureResult, fixtureBehavior, ...definition }) => ({
    ...definition,
    async invoke(input, context) {
      state.calls.push(Object.freeze({
        name: definition.name,
        input,
        callId: context.callId,
        sessionId: context.sessionId,
        ...(context.turnId === undefined ? {} : { turnId: context.turnId }),
        actor: ctx.doppelgangerActor,
      }))
      gate(state.started, context.callId).resolve()
      if (fixtureBehavior === 'hold') {
        const release = gate(state.releases, context.callId)
        const abort = () => release.resolve()
        context.signal.addEventListener('abort', abort, { once: true })
        try {
          await release.promise
        } finally {
          context.signal.removeEventListener('abort', abort)
        }
      }
      return fixtureResult
    },
  }))
}

export default {
  name: 'openclaw-conformance-control',
  inject: ['doppelgangerActor', 'doppelgangerHostCapabilities', 'doppelgangerTools'],
  async apply(ctx, config) {
    const state = globalThis[config.stateKey]
    if (state === undefined) throw new Error('OpenClaw conformance state is unavailable')
    const registry = ctx.get('doppelgangerTools', false)
    const runtimeSession = ctx.get('doppelgangerRuntimeSession', false)
    const owners = new Map()

    ctx.on('doppelganger/tools-changed', revision => {
      state.catalogChanges.push(revision)
    })
    state.actorIdentity = ctx.doppelgangerActor
    state.capabilities = ctx.doppelgangerHostCapabilities
    state.runtimeSessionId = runtimeSession?.sessionId
    state.control = Object.freeze({
      snapshot() {
        return registry?.snapshot() ?? EMPTY_CATALOG
      },
      registerSet(ownerId, definitions) {
        if (registry === undefined) throw new Error('tools protocol is absent')
        const registration = registry.registerSet(ownerId, definitionsFor(state, ctx, definitions))
        owners.set(ownerId, registration)
        return Object.freeze({
          replace(next) {
            registration.replace(definitionsFor(state, ctx, next))
          },
          async dispose() {
            await registration.dispose()
            owners.delete(ownerId)
          },
        })
      },
      waitForCall(callId) {
        return gate(state.started, callId).promise
      },
      releaseCall(callId) {
        gate(state.releases, callId).resolve()
      },
      requireLifecycle(eventType) {
        if (!state.capabilities.lifecycle.events.includes(eventType)) {
          throw new Error(`lifecycle event ${JSON.stringify(eventType)} is not declared by Runtime Host capabilities`)
        }
      }
    })

    ctx.effect(() => async () => {
      await Promise.all([...owners.values()].map(owner => owner.dispose()))
      owners.clear()
    }, 'openclawConformanceControl.disposal')
  },
}
