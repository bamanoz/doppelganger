import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'

// Test-only control plane. Tested operations still use the real OMP RPC surface.
export default {
  name: 'conformance-control',
  async apply(ctx, config) {
    const registry = ctx.get('doppelgangerTools', false)
    const owners = new Map()
    const started = new Map()
    const releases = new Map()
    const gate = (map, id) => {
      if (!map.has(id)) map.set(id, Promise.withResolvers())
      return map.get(id)
    }
    const definitionsFor = definitions => definitions.map(({ fixtureResult, fixtureBehavior, ...definition }) => ({
      ...definition,
      async invoke(_input, context) {
        gate(started, context.callId).resolve()
        if (fixtureBehavior === 'hold') {
          const release = gate(releases, context.callId)
          const abort = () => release.resolve()
          context.signal.addEventListener('abort', abort, { once: true })
          try { await release.promise } finally { context.signal.removeEventListener('abort', abort) }
          if (context.signal.aborted) throw context.signal.reason
        }
        return fixtureResult
      },
    }))
    const server = createServer(async (request, response) => {
      try {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const command = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        switch (command.op) {
          case 'register':
            if (!registry) throw new Error('tools protocol is absent')
            owners.set(command.owner, registry.registerSet(command.owner, definitionsFor(command.definitions)))
            break
          case 'replace':
            if (!owners.has(command.owner)) throw new Error('owner is disposed')
            owners.get(command.owner).replace(definitionsFor(command.definitions))
            break
          case 'dispose-owner':
            await owners.get(command.owner)?.dispose()
            owners.delete(command.owner)
            break
          case 'started': await gate(started, command.callId).promise; break
          case 'release': gate(releases, command.callId).resolve(); break
          case 'snapshot': break
          default: throw new Error('unknown fixture operation')
        }
        const actor = ctx.get('doppelgangerActor', false)
        response.end(JSON.stringify({
          revision: registry?.snapshot().revision ?? 'catalog:0',
          ...(actor === undefined ? {} : { actor }),
        }))
      } catch (error) {
        response.statusCode = 409
        response.end(JSON.stringify({ error: error.message }))
      }
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    ctx.effect(() => async () => {
      for (const gate of releases.values()) gate.resolve()
      await Promise.all([...owners.values()].map(owner => owner.dispose()))
      owners.clear()
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    })
    await writeFile(config.endpointPath, `http://127.0.0.1:${server.address().port}`)
  },
}
