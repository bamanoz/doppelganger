import { describe, expect, it } from 'vitest'
import { projectMemorySemanticQuery } from '../src/index.ts'

describe('semantic query projection', () => {
  it('normalizes and passes through bounded Unicode input', () => {
    expect(projectMemorySemanticQuery('  Привет\uD800   world  ', 64)).toEqual({
      query: 'Привет� world',
      method: 'pass-through',
      originalCharacters: 13,
      projectedCharacters: 13,
    })
  })

  it('prefers the final bounded question in a long turn', () => {
    const projection = projectMemorySemanticQuery(
      `Earlier exact ID BUILD_123. ${'context '.repeat(20)}. Как восстановить индекс?`,
      48,
    )
    expect(projection).toEqual({
      query: 'Как восстановить индекс?',
      method: 'final-question',
      originalCharacters: expect.any(Number),
      projectedCharacters: 24,
    })
  })

  it('uses the final meaningful bounded sentence then a Unicode-safe tail', () => {
    expect(projectMemorySemanticQuery(`${'x'.repeat(80)}. Final intent.`, 24)).toMatchObject({
      query: 'Final intent.',
      method: 'trailing-segment',
    })
    const tail = projectMemorySemanticQuery('🙂'.repeat(40), 7)
    expect(tail).toEqual({
      query: '🙂'.repeat(7),
      method: 'bounded-tail',
      originalCharacters: 40,
      projectedCharacters: 7,
    })
  })
})
