import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@doppelganger/doppelganger-composition-runtime'
import {
  SentryLoggingConfigSchema,
  createSentryLoggingFilter,
  normalizeSentryLoggingConfig,
  resolveSentryLoggingConfig,
  type SentryLoggingConfig,
} from './config.ts'
import { currentOwnedSentryClientFactory } from './client.ts'

export const SentryLoggingPlugin: Plugin<SentryLoggingConfig> = {
  name: 'doppelganger-logging-sentry',
  inject: ['doppelgangerLogging'],
  Config: SentryLoggingConfigSchema as unknown as NonNullable<Plugin<SentryLoggingConfig>['Config']>,
  apply(ctx: Context, configured: SentryLoggingConfig) {
    const config = resolveSentryLoggingConfig(normalizeSentryLoggingConfig(configured))
    const client = currentOwnedSentryClientFactory()(config)
    let remove: (() => Promise<void>) | undefined
    try {
      remove = ctx.doppelgangerLogging.register(client, {
        maximumPendingRecords: config.maximumPendingRecords,
        filter: createSentryLoggingFilter(config),
      })
    } catch (error) {
      void client.close(config.flushTimeoutMs)
      throw error
    }
    ctx.effect(() => async () => {
      await remove()
      await client.close(config.flushTimeoutMs)
    }, 'doppelgangerLoggingSentry.dispose')
  },
}

export default SentryLoggingPlugin
