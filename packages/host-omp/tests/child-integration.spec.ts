import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AIDEN_DEFINITION_PATH,
  resolveAidenActivation,
} from '@doppelganger/preset-aiden'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  serializeLifecycleValue,
} from '@doppelganger/extension-protocols'
import { FramedJsonRpcPeer, NodeOmpChildFactory, OMP_RPC_PROTOCOL_VERSION } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 3000)),
  ])
}
function toolNames(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || !('tools' in value) || !Array.isArray(value.tools)) {
    throw new Error('activation result has no tools array')
  }
  return value.tools.map(tool => {
    if (tool === null || typeof tool !== 'object' || !('name' in tool) || typeof tool.name !== 'string') {
      throw new Error('activation result has an invalid tool')
    }
    return tool.name
  })
}

describe('Node OMP runtime child', () => {
  it('activates and serves context, tools, events, notifications, and disposal over stdio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-child-'))
    temporaryRoots.push(root)
    const instanceHome = join(root, 'instance')
    const instancePath = join(instanceHome, 'instance.yaml')
    const userConfigPath = join(root, 'config.yaml')
    await mkdir(instanceHome, { recursive: true })
    await Promise.all([
      writeFile(instancePath, [
        'version: 1',
        'id: aiden',
        `definition: ${JSON.stringify(AIDEN_DEFINITION_PATH)}`,
      ].join('\n')),
      writeFile(userConfigPath, [
        'version: 1',
        'principalId: local-user',
        'defaultInstance: aiden',
        'instances:',
        `  aiden: ${JSON.stringify(instancePath)}`,
      ].join('\n')),
    ])
    const activation = await resolveAidenActivation({ userConfigPath, sessionId: 'omp-session', watch: false })
    if (activation === undefined) throw new Error('Aiden activation resolved inactive')
    const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
    const activateParams = {
      protocolVersion: OMP_RPC_PROTOCOL_VERSION,
      ...activation,
    }
    const child = spawn(process.execPath, [
      '--no-warnings',
      '--experimental-transform-types',
      childPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    if (child.stdin === null || child.stdout === null) throw new Error('child stdio unavailable')
    const stderr: Buffer[] = []
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
    const peer = new FramedJsonRpcPeer(child.stdout, child.stdin)
    const changed = new Promise<unknown>(resolveNotification => {
      peer.onNotification('tools.changed', resolveNotification)
    })

    let activated: unknown
    try {
      activated = await within(peer.request('session.activate', activateParams), 'session.activate')
    } catch (cause) {
      child.kill()
      await once(child, 'exit').catch(() => undefined)
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${Buffer.concat(stderr).toString('utf8')}`)
    }
    expect(toolNames(activated)).toContain('memory.remember')
    await expect(changed).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memory.search' }),
    ]))
    const context = await peer.request('context.resolve', {
      input: 'current task',
      turnId: 'turn-one',
      tokenBudget: 1000,
    }) as { content: string }
    expect(context.content).toContain('You are Aiden, a durable technical collaborator.')
    const remembered = await peer.request('tools.invoke', {
      name: 'memory.remember',
      input: {
        operationId: 'child-integration-remember',
        subjectKey: 'project.omp.bridge',
        kind: 'fact',
        content: 'The OMP bridge uses framed JSON RPC.',
      },
    }) as { ok: boolean }
    expect(remembered.ok).toBe(true)
    const recalled = await peer.request('context.resolve', {
      input: 'How does the OMP bridge communicate?',
      turnId: 'turn-two',
      tokenBudget: 1000,
    }) as { content: string }
    expect(recalled.content).toContain('framed JSON RPC')
    await expect(peer.request('event.publish', {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-started',
      deliveryId: 'child-turn-started',
      sessionId: 'omp-session',
      turnId: 'turn-two',
      timestamp: Date.now(),
      principalInput: serializeLifecycleValue('How does the OMP bridge communicate?'),
    })).resolves.toBeNull()

    const exited = once(child, 'exit')
    await expect(peer.request('session.dispose')).resolves.toBeNull()
    const [exitCode] = await exited
    expect(exitCode, Buffer.concat(stderr).toString('utf8')).toBe(0)

    const ownedActivation = await resolveAidenActivation({ userConfigPath, sessionId: 'owned', watch: false })
    if (ownedActivation === undefined) throw new Error('owned Aiden activation resolved inactive')
    const owned = await new NodeOmpChildFactory({ childPath, shutdownTimeoutMs: 500 }).start()
    await owned.request('session.activate', {
      protocolVersion: OMP_RPC_PROTOCOL_VERSION,
      ...ownedActivation,
    })
    const ownedPid = owned.processId
    if (ownedPid === undefined) throw new Error('owned child PID unavailable')
    await expect(owned.dispose()).resolves.toEqual({ outcome: 'graceful', sessionDisposeAcknowledged: true })
    expect(() => process.kill(ownedPid, 0)).toThrow()
  }, 15_000)
})
