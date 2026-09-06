import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import { normalizeMcpPluginConfig, McpPluginConfigSchema, type McpPluginConfig } from './config.ts'
import { awaitMcpInitialReady, McpImportRuntime } from './runtime.ts'
import { McpImportService } from './service.ts'

export const McpImportPlugin: Plugin<McpPluginConfig> = {
  name: 'doppelganger-extension-mcp',
  inject: ['doppelgangerTools'],
  provide: 'doppelgangerMcp',
  Config: McpPluginConfigSchema as unknown as NonNullable<Plugin<McpPluginConfig>['Config']>,
  async apply(ctx: Context, configured: McpPluginConfig) {
    const logger = ctx.logger('doppelganger-mcp')
    const config = normalizeMcpPluginConfig(configured)
    const runtime = new McpImportRuntime(ctx, config)
    ctx.effect(() => async () => {
      await runtime.dispose()
    }, 'doppelgangerMcp.dispose')
    const lifecycleOwners = new WeakSet<Fiber>()
    let lifecycleOwner = ctx.fiber
    while (true) {
      lifecycleOwners.add(lifecycleOwner)
      const parent = lifecycleOwner.parent.fiber
      if (parent === lifecycleOwner) break
      lifecycleOwner = parent
    }
    ctx.on('internal/plugin', fiber => {
      if (!lifecycleOwners.has(fiber) || fiber.uid !== null) return
      void runtime.dispose().catch(() => undefined)
    }, { global: true })
    new McpImportService(ctx, runtime)
    logger.info('component.service.ready')
    ctx.on('internal/update', function (this: Fiber, nextConfig: McpPluginConfig) {
      runtime.update(normalizeMcpPluginConfig(nextConfig))
      this.config = nextConfig
    })
    runtime.start()
    if (config.startupMode === 'await-ready') await awaitMcpInitialReady(runtime)
  },
}

export default McpImportPlugin
