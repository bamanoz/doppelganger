import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import type { ContextContribution } from '@doppelganger/extension-protocols'

export interface IdentityPluginConfig {
  readonly source?: string
}

async function loadIdentity(filename: string): Promise<string> {
  const content = (await readFile(filename, 'utf8')).trim()
  if (content.length === 0) throw new Error(`identity asset is empty: ${filename}`)
  return content
}

export const IdentityPlugin: Plugin<IdentityPluginConfig> = {
  name: 'doppelganger-identity',
  inject: ['doppelgangerContext', 'doppelgangerPersona'],
  async apply(ctx: Context, config: IdentityPluginConfig = {}) {
    const identity = ctx.doppelgangerPersona.identity
    if (identity === undefined) return
    const source = config.source?.trim() || 'persona.identity'
    const filename = identity.path
    const url = pathToFileURL(filename).href
    let content = await loadIdentity(filename)
    let reload = Promise.resolve()
    ctx.on('hmr/change', (changedUrl) => {
      if (changedUrl !== url) return
      reload = reload.then(async () => {
        const candidate = await loadIdentity(filename)
        content = candidate
      }).catch((error) => {
        ctx.logger.warn('identity reload failed for %C', filename)
        ctx.logger.warn(error)
      })
    })
    ctx.doppelgangerContext.register({
      id: source,
      async resolve() {
        await reload
        const contribution: ContextContribution = Object.freeze({
          source,
          content,
          priority: identity.priority ?? 1000,
          authority: 'instruction',
        })
        return Object.freeze([contribution])
      },
    })
  },
}
