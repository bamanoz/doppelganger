import { afterEach, describe, expect, it } from 'vitest'
import { createNativeHarness, type NativeHarness } from './support.ts'
import {
  createReloadDisposalHarness,
  waitUntil,
  type ReloadDisposalBinding,
  type ReloadDisposalContext,
  type ReloadDisposalHarness,
} from './support/reload-disposal-harness.ts'

const harnesses: NativeHarness[] = []
const reloadHarnesses: ReloadDisposalHarness[] = []
afterEach(async () => {
  await Promise.allSettled([
    ...harnesses.splice(0).map(harness => harness.dispose()),
    ...reloadHarnesses.splice(0).map(harness => harness.dispose()),
  ])
})

let nextProbeCall = 0
async function currentProbe(
  harness: ReloadDisposalHarness,
  context: ReloadDisposalContext,
  generation: string,
) {
  const deadline = Date.now() + 5_000
  let lastFailure: unknown
  while (Date.now() < deadline) {
    const tool = harness.tools(context).find(candidate => candidate.name === harness.nativeNames['reload.probe'])
    if (tool !== undefined) {
      const callId = `current-probe-${nextProbeCall += 1}`
      try {
        const result = await harness.invoke(tool, callId, { value: generation }, context) as {
          details: { ok: boolean; value?: { generation?: string } }
        }
        if (result.details.ok && result.details.value?.generation === generation) return tool
        lastFailure = result
      } catch (error) {
        lastFailure = error
      }
    }
    const deferred = Promise.withResolvers<void>()
    setTimeout(deferred.resolve, 10)
    await deferred.promise
  }
  throw new Error(`native factory did not reconstruct generation ${generation}`, { cause: lastFailure })
}

describe('OpenClaw catalog and reload boundaries', () => {
  it('rejects retained closures after descriptor replacement and binds replacement only at a new factory boundary', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    const oldTool = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.echo'])!
    harness.state.replaceEcho?.()
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    await expect(oldTool.execute('stale-revision', { value: 'old' })).resolves.toMatchObject({
      details: { ok: false, error: { code: 'TOOL_REVISION_STALE' } },
    })
    const replacement = harness.tools().find(tool => tool.name === harness.nativeNames['fixture.echo'])!
    const result = await harness.invoke(replacement, 'replacement-revision', { value: 'new' }) as { details: unknown }
    expect(result.details).toMatchObject({ ok: true, value: { value: 'new-replacement' } })
  })

  it('diagnoses undeclared tools without expanding the prepared native catalog', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    harness.state.addUndeclared?.()
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    expect(harness.tools().map(tool => tool.name)).not.toContain('dg_fixture__extra')
    expect(harness.plugin.diagnostics.join('\n')).toContain('regenerat')
  })

  it('rejects incompatible schema drift under an already declared name', async () => {
    const harness = await createNativeHarness()
    harnesses.push(harness)
    await harness.warm()
    harness.state.driftEcho?.()
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    expect(harness.tools().map(tool => tool.name)).not.toContain(harness.nativeNames['fixture.echo'])
    expect(harness.plugin.diagnostics.join('\n')).toContain('regenerat')
  })

  it('observes reload registrations without expanding the prepared native catalog', async () => {
    const binding: ReloadDisposalBinding = {
      actorId: 'extra-actor',
      agentId: 'extra-agent',
      sessionKey: 'extra-route',
      sessionId: 'extra-session',
    }
    const harness = await createReloadDisposalHarness({ bindings: [binding] })
    reloadHarnesses.push(harness)
    const context = harness.context(binding)
    await harness.warm(context)

    const diagnosticOffset = harness.plugin.diagnostics.length
    await harness.writeGeneration('with-extra')
    await waitUntil(
      () => harness.state.registrations.some(registration => (
        registration.generation === 'with-extra' && registration.names.includes('reload.extra')
      )),
      'valid Loader registration containing the undeclared tool',
    )
    const current = await currentProbe(harness, context, 'with-extra')
    await waitUntil(
      () => harness.plugin.diagnostics.slice(diagnosticOffset).some(message => (
        message.includes('[OPENCLAW_CATALOG_REGENERATION_REQUIRED]')
          && message.includes('reload.extra')
          && message.includes('not declared')
      )),
      'undeclared Loader registration diagnostic',
    )
    expect(harness.tools(context).map(tool => tool.name).sort()).toEqual(Object.values(harness.nativeNames).sort())
    expect(harness.tools(context).map(tool => tool.name)).not.toContain('dg_reload__extra')
    await expect(harness.invoke(current, 'declared-after-extra-reload', { value: 'current' }, context))
      .resolves.toMatchObject({
        details: {
          ok: true,
          value: { actorId: 'extra-actor', generation: 'with-extra', value: 'current' },
        },
      })
  })

  it('preserves audited rollback and rejects stale native closures', { timeout: 20_000 }, async () => {
    const binding: ReloadDisposalBinding = {
      actorId: 'reload-actor',
      agentId: 'reload-agent',
      sessionKey: 'reload-route',
      sessionId: 'reload-session',
    }
    const harness = await createReloadDisposalHarness({ bindings: [binding] })
    reloadHarnesses.push(harness)
    const context = harness.context(binding)
    await harness.warm(context)

    const generationOne = await currentProbe(harness, context, 'one')
    await harness.beforeTool(generationOne, 'retained-generation-one', { value: 'stale-one' }, context)
    await harness.writeGeneration('two')
    const generationTwo = await currentProbe(harness, context, 'two')
    await expect(generationOne.execute('retained-generation-one', { value: 'stale-one' })).resolves.toMatchObject({
      details: { ok: false, error: { code: 'TOOL_REVISION_STALE' } },
    })
    expect(harness.state.calls.some(call => call.callId === 'retained-generation-one')).toBe(false)

    await harness.beforeTool(generationTwo, 'retained-generation-two', { value: 'stale-two' }, context)
    const firstFailureDiagnostics = harness.plugin.diagnostics.length
    await harness.writeGeneration('candidate')
    await waitUntil(
      () => harness.state.applications.some(application => application.generation === 'candidate')
        && harness.state.applications.filter(application => application.generation === 'two').length >= 2,
      'candidate rejection and audited generation-two restoration',
    )
    await waitUntil(
      () => harness.plugin.diagnostics.slice(firstFailureDiagnostics).some(message => (
        message.includes('[OPENCLAW_RELOAD_REJECTED]') && message.includes('candidate activation rejected')
      )),
      'native audited rollback diagnostic',
    )
    await expect(generationTwo.execute('retained-generation-two', { value: 'stale-two' })).resolves.toMatchObject({
      details: { ok: false, error: { code: 'TOOL_REVISION_STALE' } },
    })
    expect(harness.state.calls.some(call => call.callId === 'retained-generation-two')).toBe(false)
    const restoredClosure = await currentProbe(harness, context, 'two')
    expect(harness.plugin.diagnostics.slice(firstFailureDiagnostics).join('\n')).not.toContain('restoration activation rejected')
    await harness.beforeTool(restoredClosure, 'retained-before-restoration-failure', { value: 'stale-restored' }, context)
    harness.state.restorationFailures.add(binding.actorId)
    const restorationFailureDiagnostics = harness.plugin.diagnostics.length
    await harness.writeGeneration('candidate-restoration-fails')
    await waitUntil(
      () => harness.plugin.diagnostics.slice(restorationFailureDiagnostics).some(message => (
        message.includes('[OPENCLAW_RELOAD_RESTORATION_FAILED]')
          && message.includes('candidate activation rejected')
          && message.includes('restoration activation rejected')
      )),
      'native restoration-failure diagnostic',
    )
    await expect(restoredClosure.execute('retained-before-restoration-failure', { value: 'stale-restored' }))
      .rejects.toThrow(/stale|revision|active|available/i)
    expect(harness.state.calls.some(call => call.callId === 'retained-before-restoration-failure')).toBe(false)
    await waitUntil(() => harness.tools(context).length === 0, 'failed restored generation withdrawal')
  })
})
