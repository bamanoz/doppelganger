import type { Context, Plugin } from '@deepseek-ai/cordis'
import { ToolRegistry } from './tools.ts'

export const ToolRegistryPlugin: Plugin = {
  name: 'doppelganger-tools',
  provide: 'doppelgangerTools',
  async apply(ctx: Context) {
    await ctx.plugin(ToolRegistry).await()
  }
}

export default ToolRegistryPlugin
