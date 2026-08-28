import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionRuntime } from '@doppelganger/composition-runtime'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  publishLifecycleEvent,
  serializeLifecycleValue,
  type ContextProtocol,
} from '@doppelganger/extension-protocols'
import type { MemoryService } from '@doppelganger/extension-memory'
import { AIDEN_DEFINITION_PATH, resolveAidenActivation, resolveAidenSelection } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(captureEnabled?: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-aiden-preset-'))
  temporaryRoots.push(root)
  const instanceHome = join(root, 'instances', 'aiden')
  const instancePath = join(instanceHome, 'instance.yaml')
  const userConfigPath = join(root, 'config.yaml')
  await mkdir(instanceHome, { recursive: true })
  await Promise.all([
    writeFile(instancePath, [
      'version: 1',
      'id: aiden',
      `definition: ${JSON.stringify(AIDEN_DEFINITION_PATH)}`,
      ...(captureEnabled === undefined ? [] : [
        'settings:',
        '  memoryCapture:',
        `    enabled: ${String(captureEnabled)}`,
      ]),
    ].join('\n')),
    writeFile(userConfigPath, [
      'version: 1',
      'principalId: local-user',
      'defaultInstance: aiden',
      'instances:',
      `  aiden: ${JSON.stringify(instancePath)}`,
    ].join('\n')),
  ])
  return { instanceHome, userConfigPath }
}

describe('Aiden preset', () => {
  it('activates as a host-neutral generic composition and reuses instance-owned memory', async () => {
    const files = await fixture()
    const activation = await resolveAidenActivation({
      userConfigPath: files.userConfigPath,
      sessionId: 'serialized',
    })
    expect(activation).toMatchObject({
      composition: { id: 'aiden' },
      sessionId: 'serialized',
      mounts: { persona: { config: { principalId: 'local-user' } } },
      hostMount: 'host',
    })
    const selection = await resolveAidenSelection({ userConfigPath: files.userConfigPath })
    if (selection === undefined) throw new Error('Aiden selection resolved inactive')
    const definitionSource = await readFile(AIDEN_DEFINITION_PATH, 'utf8')
    const loaderSource = await readFile(selection.definition.loaderPath, 'utf8')
    expect(`${definitionSource}\n${loaderSource}`).not.toMatch(/\b(?:omp|rpc|process)\b/iu)
    expect(Object.keys(selection.composition.mounts)).toEqual(['persona', 'host'])

    let contextProtocol: ContextProtocol | undefined
    let memory: MemoryService | undefined
    let hostContext: Context | undefined
    const host: Plugin = {
      name: 'aiden-test-host',
      inject: ['doppelgangerContext', 'doppelgangerMemory'],
      apply(ctx) {
        contextProtocol = ctx.doppelgangerContext
        memory = ctx.doppelgangerMemory
        hostContext = ctx
      },
    }
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition: selection.composition,
      sessionId: 'first',
      mounts: { persona: selection.personaMount('first'), host },
    })
    if (contextProtocol === undefined || memory === undefined || hostContext === undefined) throw new Error('Aiden services did not activate')
    const assembled = await contextProtocol.resolve({ turn: { input: 'technical task' }, tokenBudget: 1000 })
    expect(assembled.content).toContain('You are Aiden')
    memory.remember({
      operationId: 'persistent-aiden',
      subjectKey: 'project.persistent.aiden',
      kind: 'fact',
      content: 'Persistent Aiden memory.',
    })
    await publishLifecycleEvent(hostContext, {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-committed',
      deliveryId: 'capture-disabled',
      sessionId: 'first',
      turnId: 'turn-one',
      timestamp: 1,
      principalInput: serializeLifecycleValue('[fact:project.capture.policy] Capture should remain disabled.'),
      assistantOutput: serializeLifecycleValue('Completed answer.'),
      toolOutcomes: [],
      outcome: 'completed',
    })
    expect(memory.listCandidates()).toEqual([])
    await session.dispose()
    await runtime.dispose()

    await access(join(files.instanceHome, 'storage', 'memory.sqlite'))
    let restoredMemory: MemoryService | undefined
    const restoringHost: Plugin = {
      name: 'aiden-restoring-host',
      inject: ['doppelgangerMemory'],
      apply(ctx) {
        restoredMemory = ctx.doppelgangerMemory
      },
    }
    const restoringRuntime = createCompositionRuntime({ watch: false })
    const restoringSession = await restoringRuntime.activate({
      composition: selection.composition,
      sessionId: 'second',
      mounts: { persona: selection.personaMount('second'), host: restoringHost },
    })
    if (restoredMemory === undefined) throw new Error('restored memory did not activate')
    expect((await restoredMemory.search({ query: 'Persistent Aiden', tokenBudget: 100 }))[0]
      ?.record.revision.content).toBe('Persistent Aiden memory.')
    await restoringSession.dispose()
    await restoringRuntime.dispose()
  })
  it('enables candidate-only capture explicitly from instance settings', async () => {
    const files = await fixture(true)
    const selection = await resolveAidenSelection({ userConfigPath: files.userConfigPath })
    if (selection === undefined) throw new Error('enabled Aiden selection resolved inactive')
    let hostContext: Context | undefined
    let memory: MemoryService | undefined
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition: selection.composition,
      sessionId: 'capture-enabled',
      mounts: {
        persona: selection.personaMount('capture-enabled'),
        host: {
          name: 'capture-enabled-host',
          inject: ['doppelgangerMemory'],
          apply(ctx) {
            hostContext = ctx
            memory = ctx.doppelgangerMemory
          },
        },
      },
    })
    if (hostContext === undefined || memory === undefined) throw new Error('capture-enabled services did not activate')
    await publishLifecycleEvent(hostContext, {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-committed',
      deliveryId: 'capture-enabled',
      sessionId: 'capture-enabled',
      turnId: 'turn-one',
      timestamp: 1,
      principalInput: serializeLifecycleValue('[fact:project.capture.policy] Capture is explicitly enabled.'),
      assistantOutput: serializeLifecycleValue('Completed answer.'),
      toolOutcomes: [],
      outcome: 'completed',
    })
    expect(memory.listCandidates()).toEqual([
      expect.objectContaining({
        subjectKey: 'project.capture.policy',
        status: 'candidate',
      }),
    ])
    const direct = memory.remember({
      operationId: 'enabled-direct',
      subjectKey: 'project.direct.enabled',
      kind: 'fact',
      content: 'Direct remember remains active.',
    })
    expect(direct.status).toBe('active')
    await session.dispose()
    await runtime.dispose()
  })

})
