import type { Context, Plugin } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  STRUCTURED_INFERENCE_SERVICE,
  createStructuredInference,
} from '@doppelganger/doppelganger-protocols'
import {
  normalizePiInferencePluginConfig,
  type PiInferencePluginConfig,
} from './config.ts'
import { PiStructuredInferenceProvider } from './provider.ts'

export const PiInferencePluginConfigSchema: Schema<PiInferencePluginConfig> = Schema.object({
  provider: Schema.string().min(1).max(256).required(),
  model: Schema.string().min(1).max(256).required(),
  baseUrl: Schema.string().min(1).max(2_048),
  modelContextWindow: Schema.natural().min(1).max(10_000_000),
  apiKeyEnv: Schema.string().min(1).max(256),
  reasoning: Schema.union(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  requestTimeoutMs: Schema.natural().min(1).max(600_000).default(120_000),
  maximumInputCharacters: Schema.natural().min(1).max(1_000_000).default(64_000),
  maximumOutputTokens: Schema.natural().min(1).max(65_536).default(2_048),
  maximumResponseCharacters: Schema.natural().min(1).max(2_000_000).default(100_000),
})

export const PiInferencePlugin: Plugin<PiInferencePluginConfig> = {
  name: 'doppelganger-inference-pi',
  Config: PiInferencePluginConfigSchema as unknown as NonNullable<Plugin<PiInferencePluginConfig>['Config']>,
  provide: STRUCTURED_INFERENCE_SERVICE,
  apply(ctx: Context, input: PiInferencePluginConfig) {
    const config = normalizePiInferencePluginConfig(input)
    const provider = new PiStructuredInferenceProvider(config)
    ctx.provide(STRUCTURED_INFERENCE_SERVICE, createStructuredInference(provider))
    ctx.effect(() => () => provider.close(), 'doppelgangerInferencePi.close')
  },
}

export default PiInferencePlugin
