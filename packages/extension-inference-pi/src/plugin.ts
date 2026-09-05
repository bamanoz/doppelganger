import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  STRUCTURED_INFERENCE_SERVICE,
  createStructuredInference,
} from '@doppelganger/doppelganger-protocols'
import {
  PiInferencePluginConfigSchema,
  normalizePiInferencePluginConfig,
  type PiInferencePluginConfig,
} from './config.ts'
import { PiStructuredInferenceProvider } from './provider.ts'


export const PiInferencePlugin: Plugin<PiInferencePluginConfig> = {
  name: 'doppelganger-inference-pi',
  Config: PiInferencePluginConfigSchema as unknown as NonNullable<Plugin<PiInferencePluginConfig>['Config']>,
  provide: STRUCTURED_INFERENCE_SERVICE,
  apply(ctx: Context, input: PiInferencePluginConfig) {
    const logger = ctx.logger('doppelganger-inference-pi')
    logger.info('component.activation.started provider=%s model=%s', input.provider, input.model)
    const config = normalizePiInferencePluginConfig(input)
    const provider = new PiStructuredInferenceProvider(config, undefined, logger)
    ctx.provide(STRUCTURED_INFERENCE_SERVICE, createStructuredInference(provider))
    logger.info('component.active')
    ctx.effect(() => () => provider.close(), 'doppelgangerInferencePi.close')
  },
}

export default PiInferencePlugin
