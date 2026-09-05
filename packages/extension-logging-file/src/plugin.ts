import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-composition-runtime'
import {
  FileLoggingConfigSchema,
  createFileLoggingFilter,
  normalizeFileLoggingConfig,
  resolveFileLoggingConfig,
  type FileLoggingConfig,
} from './config.ts'
import { RollingJsonlWriter } from './writer.ts'

async function disposeFileLogging(
  timer: NodeJS.Timeout | undefined,
  remove: (() => Promise<void>) | undefined,
  writer: RollingJsonlWriter,
): Promise<void> {
  clearInterval(timer)
  const errors: unknown[] = []
  try {
    await remove?.()
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      await writer.close()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'file logging disposal failed')
}

export const FileLoggingPlugin: Plugin<FileLoggingConfig> = {
  name: 'doppelganger-logging-file',
  inject: ['doppelgangerLogging'],
  Config: FileLoggingConfigSchema as unknown as NonNullable<Plugin<FileLoggingConfig>['Config']>,
  async apply(ctx: Context, configured: FileLoggingConfig) {
    const config = normalizeFileLoggingConfig(configured)
    const resolved = resolveFileLoggingConfig(config, ctx.doppelgangerLogging.scope)
    const writer = await RollingJsonlWriter.open(resolved)
    let remove: (() => Promise<void>) | undefined
    let timer: NodeJS.Timeout | undefined
    try {
      remove = ctx.doppelgangerLogging.register(writer, {
        maximumPendingRecords: config.maximumPendingRecords,
        filter: createFileLoggingFilter(config),
      })
      if (resolved.retention !== undefined) {
        timer = setInterval(() => {
          void writer.cleanup().catch(() => undefined)
        }, resolved.retention.cleanupIntervalMs)
        timer.unref()
      }
      ctx.effect(() => async () => {
        await disposeFileLogging(timer, remove, writer)
      }, 'doppelgangerLoggingFile.dispose')
    } catch (error) {
      try {
        await disposeFileLogging(timer, remove, writer)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'file logging activation and cleanup failed')
      }
      throw error
    }
  },
}

export default FileLoggingPlugin
