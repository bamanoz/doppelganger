import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import type { ContextContribution } from '@doppelganger/extension-protocols'

interface ActiveTrait {
  readonly name: string
  readonly filename: string
  readonly url: string
  readonly priority: number
  content: string
}

async function loadTrait(filename: string): Promise<string> {
  const content = (await readFile(filename, 'utf8')).trim()
  if (content.length === 0) throw new Error(`trait asset is empty: ${filename}`)
  return content
}

export const TraitsPlugin: Plugin = {
  name: 'doppelganger-traits',
  inject: ['doppelgangerContext', 'doppelgangerPersona'],
  async apply(ctx: Context) {
    const names = new Set<string>()
    const traits: ActiveTrait[] = []
    for (const [index, candidate] of ctx.doppelgangerPersona.traits.entries()) {
      const name = candidate.name.trim()
      if (name.length === 0) throw new TypeError(`trait at index ${index} needs a non-empty name`)
      if (names.has(name)) throw new TypeError(`trait "${name}" is selected more than once`)
      names.add(name)
      const filename = candidate.path
      traits.push({
        name,
        filename,
        url: pathToFileURL(filename).href,
        priority: candidate.priority ?? 800 - index,
        content: await loadTrait(filename),
      })
    }

    let reload = Promise.resolve()
    ctx.on('hmr/change', (changedUrl) => {
      const trait = traits.find(candidate => candidate.url === changedUrl)
      if (trait === undefined) return
      reload = reload.then(async () => {
        trait.content = await loadTrait(trait.filename)
      }).catch((error) => {
        ctx.logger.warn('trait reload failed for %C', trait.filename)
        ctx.logger.warn(error)
      })
    })
    ctx.doppelgangerContext.register({
      id: 'persona.traits',
      async resolve() {
        await reload
        return Object.freeze(traits.map((trait, index) => Object.freeze({
          source: `persona.trait.${String(index).padStart(4, '0')}.${trait.name}`,
          content: trait.content,
          priority: trait.priority,
          authority: 'instruction' as const,
        } satisfies ContextContribution)))
      },
    })
  },
}
