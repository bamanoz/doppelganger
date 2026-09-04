import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import { normalizeMcpPluginConfig, McpPluginConfigSchema, type McpPluginConfig } from './config.ts'
import { McpImportRuntime } from './runtime.ts'
import { McpImportService } from './service.ts'

export const McpImportPlugin: Plugin<McpPluginConfig> = {
  name: 'doppelganger-extension-mcp',
  inject: ['doppelgangerTools'],
  provide: 'doppelgangerMcp',
  Config: McpPluginConfigSchema as unknown as NonNullable<Plugin<McpPluginConfig>['Config']>,
  async apply(ctx: Context, configured: McpPluginConfig) {
    const runtime = new McpImportRuntime(ctx, normalizeMcpPluginConfig(configured))
    ctx.effect(() => async () => {
      await runtime.dispose()
    }, 'doppelgangerMcp.dispose')
    new McpImportService(ctx, runtime)
    ctx.on('internal/update', function (this: Fiber, nextConfig: McpPluginConfig) {
      runtime.update(normalizeMcpPluginConfig(nextConfig))
      this.config = nextConfig
    })
    runtime.start()
  },
}

export default McpImportPlugin
