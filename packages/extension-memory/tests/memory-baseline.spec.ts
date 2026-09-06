import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  ContextProtocol,
  createActorIdentityPlugin,
  ToolRegistry,
} from '@doppelganger/doppelganger-protocols'
import { MemoryProtocolPlugin, MemoryService, SqliteMemoryPlugin } from '../src/index.ts'
import {
  assertActorProjectIsolation,
  assertCurrentRecordReceiptReplay,
  assertForgottenResultReplay,
  assertMemoryToolContractOutcomes,
  assertPromotionProvenance,
  type MemoryBaselineFixture,
  type MemoryBaselineSessionOptions,
} from './memory-baseline.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function sqliteBaselineFixture(): Promise<MemoryBaselineFixture> {
  const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-baseline-'))
  temporaryRoots.push(instanceHome)
  let nextId = 0
  const now = () => new Date('2026-09-05T12:00:00.000Z')

  return {
    async createSession(options: MemoryBaselineSessionOptions) {
      const context = new Context()
      await context.plugin(createPersonaActivationPlugin({
        instanceId: 'aiden',
        sessionId: options.sessionId,
        ...(options.projectId === null ? {} : {
          projectId: options.projectId,
          projectRoot: join(instanceHome, options.projectId),
        }),
      }))
      await context.plugin(createActorIdentityPlugin(options.actorId))
      await context.plugin(SqliteMemoryPlugin, { home: instanceHome, namespace: 'baseline' })
      await context.plugin(ContextProtocol)
      await context.plugin(ToolRegistry)
      await context.plugin(MemoryService, {
        now,
        id: () => `baseline-id-${nextId += 1}`,
      })
      await context.plugin(MemoryProtocolPlugin)
      return {
        memory: context.doppelgangerMemory,
        tools: context.doppelgangerTools,
        async dispose() {
          await context.fiber.dispose()
        },
      }
    },
  }
}

describe('current SQLite memory baseline', () => {
  it('replays an exact receipt as the current canonical record', async () => {
    await assertCurrentRecordReceiptReplay(await sqliteBaselineFixture())
  })

  it('replays forgotten outcomes without resurrecting their records', async () => {
    await assertForgottenResultReplay(await sqliteBaselineFixture())
  })

  it('promotes distinct-session evidence while retaining candidate provenance', async () => {
    await assertPromotionProvenance(await sqliteBaselineFixture())
  })

  it('isolates relationship, project, candidate, and mutation access by actor and project', async () => {
    await assertActorProjectIsolation(await sqliteBaselineFixture())
  })

  it('preserves public memory tool schemas and structured outcomes', async () => {
    await assertMemoryToolContractOutcomes(await sqliteBaselineFixture())
  })
})
