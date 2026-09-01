import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NodeOmpChildFactory, defaultNodePath } from '../src/process.ts'
import { DEFAULT_OMP_CHILD_PATH, resolveOmpChildPath } from '../src/extension.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Node OMP child process selection', () => {
  it('does not recursively spawn a non-Node host executable', () => {
    expect(defaultNodePath('C:\\Users\\example\\AppData\\Local\\omp\\omp.exe')).toBe('node')
    expect(defaultNodePath('/opt/omp/bin/omp')).toBe('node')
  })

  it('preserves an actual Node executable path', () => {
    expect(defaultNodePath('C:\\Program Files\\nodejs\\node.exe')).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(defaultNodePath('/opt/node/bin/node')).toBe('/opt/node/bin/node')
  })

  it('resolves the default child from the host package and preserves explicit injection', () => {
    expect(DEFAULT_OMP_CHILD_PATH).toBe(fileURLToPath(new URL('../src/child.ts', import.meta.url)))
    expect(resolveOmpChildPath({})).toBe(DEFAULT_OMP_CHILD_PATH)
    expect(resolveOmpChildPath({ childPath: '/opt/doppelganger/custom-child.ts' }))
      .toBe('/opt/doppelganger/custom-child.ts')
  })

  it('reports rejecting notification observers without failing the child connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-rpc-child-'))
    temporaryRoots.push(root)
    const childPath = join(root, 'child.mjs')
    const protocolUrl = new URL('../src/protocol.ts', import.meta.url).href
    await writeFile(childPath, [
      `import { FramedJsonRpcPeer } from ${JSON.stringify(protocolUrl)}`,
      "const peer = new FramedJsonRpcPeer(process.stdin, process.stdout)",
      "peer.expose('emit', params => { peer.notify('observe', params); return null })",
      "peer.expose('sum', params => params.left + params.right)",
      "peer.expose('session.dispose', () => { setImmediate(() => process.exit()); return null })",
      '',
    ].join('\n'))
    const diagnostics: unknown[] = []
    const factory = new NodeOmpChildFactory({
      childPath,
      shutdownTimeoutMs: 1000,
      onNotificationObserverError(diagnostic) {
        diagnostics.push(diagnostic)
        throw new Error('diagnostic reporter failed')
      },
    })
    const connection = await factory.start()
    const observed: unknown[] = []
    connection.onNotification('observe', () => { throw new Error('process observer failed') })
    connection.onNotification('observe', params => { observed.push(params) })

    await connection.request('emit', { cycle: 1 })
    await new Promise(resolve => setImmediate(resolve))
    expect(observed).toEqual([{ cycle: 1 }])
    expect(diagnostics).toEqual([{ method: 'observe', message: 'process observer failed' }])
    await expect(connection.request('sum', { left: 6, right: 7 })).resolves.toBe(13)
    await connection.request('emit', { cycle: 2 })
    await new Promise(resolve => setImmediate(resolve))
    expect(observed).toEqual([{ cycle: 1 }, { cycle: 2 }])
    expect(diagnostics).toHaveLength(2)

    await expect(connection.dispose()).resolves.toMatchObject({
      outcome: 'graceful',
      sessionDisposeAcknowledged: true,
    })
  })
})
