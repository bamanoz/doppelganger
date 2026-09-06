const EMPTY_CATALOG = Object.freeze({ revision: 'catalog:0', tools: Object.freeze([]) })

export default {
  name: 'openclaw-empty-conformance-control',
  inject: ['doppelgangerActor', 'doppelgangerHostCapabilities'],
  apply(ctx, config) {
    const state = globalThis[config.stateKey]
    if (state === undefined) throw new Error('OpenClaw empty conformance state is unavailable')
    const runtimeSession = ctx.get('doppelgangerRuntimeSession', false)
    state.actorIdentity = ctx.doppelgangerActor
    state.capabilities = ctx.doppelgangerHostCapabilities
    state.runtimeSessionId = runtimeSession?.sessionId
    state.control = Object.freeze({
      snapshot() {
        return EMPTY_CATALOG
      },
      registerSet() {
        throw new Error('tools protocol is absent')
      },
      waitForCall() {
        throw new Error('tools protocol is absent')
      },
      releaseCall() {},
      requireLifecycle(eventType) {
        if (!state.capabilities.lifecycle.events.includes(eventType)) {
          throw new Error(`lifecycle event ${JSON.stringify(eventType)} is not declared by Runtime Host capabilities`)
        }
      },
    })
  },
}
