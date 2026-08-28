import { Context, type Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ContextProtocol } from '../src/index.ts'

async function setup() {
  const context = new Context()
  const protocol = context.plugin(ContextProtocol, { estimateTokens: content => content.length })
  await protocol.await()
  return context
}

describe('context protocol', () => {
  it('resolves turn-sensitive providers in deterministic priority order within budget', async () => {
    const context = await setup()
    const lower: Plugin = {
      name: 'lower-context',
      inject: ['doppelgangerContext'],
      apply(ctx) {
        ctx.doppelgangerContext.register({
          id: 'lower',
          resolve: ({ turn }) => [{
            source: 'memory.current-turn',
            content: `memory:${turn.input}`,
            priority: 10,
            authority: 'data',
          }],
        })
      },
    }
    const higher: Plugin = {
      name: 'higher-context',
      inject: ['doppelgangerContext'],
      apply(ctx) {
        ctx.doppelgangerContext.register({
          id: 'higher',
          resolve: () => [{
            source: 'identity',
            content: 'identity',
            priority: 100,
            authority: 'instruction',
          }],
        })
      },
    }
    const [lowerFiber, higherFiber] = await Promise.all([context.plugin(lower), context.plugin(higher)])

    const first = await context.doppelgangerContext.resolve({
      turn: { input: 'alpha' },
      tokenBudget: 30,
    })
    expect(first.content).toBe('identity\n\nmemory:alpha')
    expect(first.contributions.map(contribution => contribution.authority)).toEqual(['instruction', 'data'])
    expect(first.tokenCount).toBe(22)

    const second = await context.doppelgangerContext.resolve({
      turn: { input: 'beta' },
      tokenBudget: 30,
    })
    expect(second.content).toContain('memory:beta')

    await higherFiber.dispose()
    const afterDisposal = await context.doppelgangerContext.resolve({
      turn: { input: 'gamma' },
      tokenBudget: 30,
    })
    expect(afterDisposal.contributions.map(contribution => contribution.source)).toEqual(['memory.current-turn'])

    await lowerFiber.dispose()
    await context.fiber.dispose()
  })

  it('truncates opted-in contributions and omits lower-priority content', async () => {
    const context = await setup()
    const owner = await context.plugin({
      name: 'budget-context',
      inject: ['doppelgangerContext'],
      apply(ctx) {
        ctx.doppelgangerContext.register({
          id: 'budget',
          resolve: () => [
            {
              source: 'identity',
              content: 'abcdefghij',
              priority: 100,
              authority: 'instruction',
              truncate: true,
            },
            {
              source: 'memory',
              content: 'memory',
              priority: 10,
              authority: 'data',
            },
          ],
        })
      },
    })

    const result = await context.doppelgangerContext.resolve({
      turn: { input: 'irrelevant' },
      tokenBudget: 6,
    })
    expect(result.content).toBe('abcde…')
    expect(result.tokenCount).toBe(6)
    expect(result.contributions[0]).toMatchObject({ source: 'identity', content: 'abcde…' })
    expect(result.omittedSources).toEqual(['memory'])

    await owner.dispose()
    await context.fiber.dispose()
  })
})
