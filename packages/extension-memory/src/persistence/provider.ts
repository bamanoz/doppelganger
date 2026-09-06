import type { Context } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-protocols'
import { openMemoryDatabase, type MemoryDatabase } from './database.ts'
import { createMemoryRepository } from './repository.ts'
import type { MemoryDatabaseConfig } from './config.ts'

export async function activateMemoryRepository(
  ctx: Context,
  config: MemoryDatabaseConfig,
  open: typeof openMemoryDatabase = openMemoryDatabase,
): Promise<void> {
  const actor = ctx.doppelgangerActor
  if (actor.state !== 'bound') throw new Error('memory repository requires a bound host actor')
  const logger = ctx.logger('doppelganger-memory')
  let disposed = false
  let opening: Promise<MemoryDatabase> | undefined
  let closing: Promise<void> | undefined
  const close = (database: MemoryDatabase): Promise<void> => closing ??= database.close()
  ctx.effect(() => async () => {
    disposed = true
    const database = await opening?.catch(() => undefined)
    if (database !== undefined) {
      logger.info('component.disposal.started')
      await close(database)
      logger.info('component.disposal.completed')
    }
  }, 'doppelgangerMemoryRepository.close')
  logger.info('component.activation.started')
  opening = open(config, actor.actorId)
  try {
    const database = await opening
    if (disposed) {
      await close(database)
      throw new Error('memory repository was disposed during initialization')
    }
    try {
      ctx.provide('doppelgangerMemoryRepository', createMemoryRepository(database))
    } catch (error) {
      await close(database)
      throw error
    }
    logger.info('component.active')
  } catch (error) {
    logger.error('component.activation.failed reason=%s', error instanceof Error ? error.name : 'unknown')
    throw error
  }
}
