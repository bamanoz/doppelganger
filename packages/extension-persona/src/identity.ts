import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { ContextContribution } from '@doppelganger/doppelganger-protocols'
import { createPersonaAsset } from './asset.ts'

export interface IdentityPluginConfig {
  readonly source?: string
}


export const IdentityPlugin: Plugin<IdentityPluginConfig> = {
  name: 'doppelganger-identity',
  inject: ['doppelgangerContext', 'doppelgangerPersona'],
  async apply(ctx: Context, config: IdentityPluginConfig = {}) {
    const identity = ctx.doppelgangerPersona.identity
    if (identity === undefined) return
    const source = config.source?.trim() || 'persona.identity'
    const asset = await createPersonaAsset(ctx, {
      filename: identity.path,
      kind: 'identity',
      onDiagnostic: diagnostic => {
        ctx.logger.warn('identity reload failed for %C', diagnostic.filename)
        ctx.logger.warn(diagnostic.message)
      },
    })
    ctx.doppelgangerContext.register({
      id: source,
      async resolve() {
        const contribution: ContextContribution = Object.freeze({
          source,
          content: await asset.content(),
          priority: identity.priority ?? 1000,
          authority: 'instruction',
        })
        return Object.freeze([contribution])
      },
    })
  },
}
