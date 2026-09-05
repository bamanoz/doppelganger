import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-composition-runtime'
import {
  FileLoggingConfigSchema,
  createFileLoggingFilter,
  normalizeFileLoggingConfig,
  type FileLoggingConfig,
} from './config.ts'
import { RollingJsonlWriter } from './writer.ts'

export const FileLoggingPlugin: Plugin<FileLoggingConfig> = {
  name: 'doppelganger-logging-file',
  inject: ['doppelgangerLogging'],
  Config: FileLoggingConfigSchema as unknown as NonNullable<Plugin<FileLoggingConfig>['Config']>,
  async apply(ctx: Context, configured: FileLoggingConfig) {
    const config = normalizeFileLoggingConfig(configured)
    const writer = await RollingJsonlWriter.open(config)
    let remove: (() => Promise<void>) | undefined
    try {
      remove = ctx.doppelgangerLogging.register(writer, {
        maximumPendingRecords: config.maximumPendingRecords,
        filter: createFileLoggingFilter(config),
      })
    } catch (error) {
      await writer.close()
      throw error
    }
    ctx.effect(() => async () => {
      await remove()
      await writer.close()
    }, 'doppelgangerLoggingFile.dispose')
  },
}

export default FileLoggingPlugin
