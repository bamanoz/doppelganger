export default {
  name: 'openclaw-conformance-lifecycle-consumer',
  inject: ['doppelgangerHostCapabilities'],
  apply(ctx, config) {
    const state = globalThis[config.stateKey]
    if (state === undefined) throw new Error('OpenClaw lifecycle conformance state is unavailable')
    const supported = ctx.doppelgangerHostCapabilities.lifecycle.events.includes('turn-committed')
    if (!supported) {
      state.lifecycleRequirement = Object.freeze({
        active: false,
        missing: 'turn-committed',
        diagnostic: 'turn-committed lifecycle capability is required for automatic capture',
      })
      return
    }
    state.lifecycleRequirement = Object.freeze({ active: true })
    ctx.on('doppelganger/turn-committed', event => {
      state.lifecycleEvents.push(event)
    })
  },
}
