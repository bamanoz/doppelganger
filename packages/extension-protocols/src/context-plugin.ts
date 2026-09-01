import type { Context, Plugin } from '@deepseek-ai/cordis'
import { ContextProtocol, type ContextProtocolConfig } from './context.ts'

export const ContextProtocolPlugin: Plugin<ContextProtocolConfig> = {
  name: 'doppelganger-context',
  provide: 'doppelgangerContext',
  async apply(ctx: Context, config: ContextProtocolConfig = {}) {
    await ctx.plugin(ContextProtocol, config).await()
  }
}

export default ContextProtocolPlugin
