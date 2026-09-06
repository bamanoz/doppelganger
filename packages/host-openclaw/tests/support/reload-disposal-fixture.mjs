function gate(map, id) {
  let current = map.get(id)
  if (current === undefined) {
    current = Promise.withResolvers()
    map.set(id, current)
  }
  return current
}


function definitions(state, owner, generation) {
  const result = [
    {
      name: 'reload.probe',
      label: 'Reload Probe',
      description: 'Reports the Loader generation captured by this native closure',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      invoke(input, context) {
        state.calls.push(Object.freeze({
          actorId: owner,
          callId: context.callId,
          generation,
          name: 'reload.probe',
        }))
        return { actorId: owner, generation, value: input.value }
      },
    },
    {
      name: 'reload.hold',
      label: 'Reload Hold',
      description: 'Remains active after cancellation until the fixture releases it',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      async invoke(_input, context) {
        state.calls.push(Object.freeze({
          actorId: owner,
          callId: context.callId,
          generation,
          name: 'reload.hold',
        }))
        gate(state.callStarted, context.callId).resolve()
        const release = gate(state.callRelease, context.callId)
        const cancelled = () => {
          state.cancelledCalls.push(context.callId)
          gate(state.callCancelled, context.callId).resolve()
        }
        context.signal.addEventListener('abort', cancelled, { once: true })
        if (context.signal.aborted) cancelled()
        try {
          await release.promise
        } finally {
          context.signal.removeEventListener('abort', cancelled)
        }
        state.settledCalls.push(context.callId)
        return { actorId: owner, cancelled: context.signal.aborted, generation }
      },
    },
  ]
  if (generation.startsWith('with-extra')) {
    result.push({
      name: 'reload.extra',
      label: 'Reload Extra',
      description: 'Registers only after a valid watched Loader update',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      invoke(_input, context) {
        state.calls.push(Object.freeze({
          actorId: owner,
          callId: context.callId,
          generation,
          name: 'reload.extra',
        }))
        return { actorId: owner, generation }
      },
    })
  }
  return result
}

export default {
  name: 'openclaw-reload-disposal-fixture',
  inject: ['doppelgangerTools'],
  async apply(ctx, config) {
    const state = globalThis[config.stateKey]
    if (state === undefined) throw new Error('OpenClaw reload/disposal fixture state is unavailable')
    const actor = ctx.get('doppelgangerActor', false)
    const owner = actor?.state === 'bound' ? actor.actorId : 'unbound'
    const application = (state.applicationCounts.get(owner) ?? 0) + 1
    state.applicationCounts.set(owner, application)
    state.applications.push(Object.freeze({ actorId: owner, application, generation: config.generation }))
    gate(state.activationStarted, owner).resolve()

    if (state.heldActivations.has(owner)) {
      await gate(state.activationRelease, owner).promise
      state.resumedActivations.push(owner)
    }
    if (config.generation.startsWith('candidate')) {
      throw new Error(`candidate activation rejected for ${owner}: ${config.generation}`)
    }
    if (state.restorationFailures.has(owner) && application > 1) {
      throw new Error(`restoration activation rejected for ${owner}`)
    }

    const registry = ctx.get('doppelgangerTools', false)
    if (registry === undefined) throw new Error('reload/disposal fixture requires the tools protocol')
    const registeredDefinitions = definitions(state, owner, config.generation)
    const registration = registry.registerSet('reload-disposal-fixture', registeredDefinitions)
    state.registrations.push(Object.freeze({
      actorId: owner,
      generation: config.generation,
      names: Object.freeze(registeredDefinitions.map(definition => definition.name)),
    }))
    const callbackId = `${owner}:${config.generation}:${application}`
    state.latestLateCallback.set(owner, callbackId)
    void gate(state.lateCallbackRelease, callbackId).promise.then(() => {
      state.lateCallbackAttempts.push(callbackId)
      try {
        registration.replace(definitions(state, owner, `${config.generation}-late`))
        state.lateCallbackOutcomes.push(Object.freeze({ callbackId, outcome: 'published' }))
      } catch (error) {
        state.lateCallbackOutcomes.push(Object.freeze({
          callbackId,
          outcome: error instanceof Error ? error.message : String(error),
        }))
      }
    })

    ctx.effect(() => () => {
      state.cleanupStages.push(`${owner}:observable`)
    }, 'openclawReloadDisposalFixture.observable')
    return () => {
      state.cleanupStages.push(`${owner}:throwing`)
      if (state.throwingDisposers.has(owner)) throw new Error(`fixture disposer failed for ${owner}`)
    }
  },
}
