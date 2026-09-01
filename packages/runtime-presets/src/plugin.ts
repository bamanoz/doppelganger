import { type Context, type Plugin } from '@deepseek-ai/cordis'
import {
  RuntimePresetRoster,
  createRuntimePresetRoster,
  type RuntimePresetRosterConfig,
} from './index.ts'

export const RUNTIME_PRESETS_SERVICE = 'doppelgangerRuntimePresets' as const

export type RuntimePresetsPluginConfig = RuntimePresetRosterConfig

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerRuntimePresets: RuntimePresetRoster
  }
}

export const RuntimePresetsPlugin: Plugin<RuntimePresetsPluginConfig> = {
  name: 'doppelganger-runtime-presets',
  provide: RUNTIME_PRESETS_SERVICE,
  apply(ctx: Context, config: RuntimePresetsPluginConfig = {}) {
    ctx.provide(RUNTIME_PRESETS_SERVICE, createRuntimePresetRoster(config))
  },
}

export default RuntimePresetsPlugin
