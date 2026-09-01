import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { ContextContribution } from '@doppelganger/doppelganger-protocols'
import { createPersonaAsset, type PersonaAsset } from './asset.ts'

interface ActiveTrait {
  readonly name: string
  readonly priority: number
  readonly asset: PersonaAsset
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
        priority: candidate.priority ?? 800 - index,
        asset: await createPersonaAsset(ctx, {
          filename,
          kind: 'trait',
          onDiagnostic: diagnostic => {
            ctx.logger.warn('trait reload failed for %C', diagnostic.filename)
            ctx.logger.warn(diagnostic.message)
          },
        }),
      })
    }


    ctx.doppelgangerContext.register({
      id: 'persona.traits',
      async resolve() {
        const contents = await Promise.all(traits.map(trait => trait.asset.content()))
        return Object.freeze(traits.map((trait, index) => Object.freeze({
          source: `persona.trait.${String(index).padStart(4, '0')}.${trait.name}`,
          content: contents[index]!,
          priority: trait.priority,
          authority: 'instruction' as const,
        } satisfies ContextContribution)))
      },
    })
  },
}
