import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ToolInvocationError, ToolRegistry, type ToolRegistration } from '../src/index.ts'

async function setup() {
  const context = new Context()
  await context.plugin(ToolRegistry)
  return context
}

describe('tool registry', () => {
  it('discovers, updates, invokes, and removes lifecycle-owned tools', async () => {
    const approval = { policy: 'required' as const, reason: ' Review the exact mutation ' }
    const context = await setup()
    let registration: ToolRegistration | undefined
    const owner = await context.plugin({
      name: 'memory-tools',
      inject: ['doppelgangerTools'],
      apply(ctx) {
        registration = ctx.doppelgangerTools.register({
          name: 'memory.search',
          description: 'Search active memory',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          approval,
          invoke: input => ({ input, revision: 1 }),
        })
      },
    })

    expect(context.doppelgangerTools.list()).toEqual([expect.objectContaining({
      name: 'memory.search',
      description: 'Search active memory',
      available: true,
      approval: { policy: 'required', reason: 'Review the exact mutation' },
    })])
    const descriptorApproval = context.doppelgangerTools.list()[0]?.approval
    expect(descriptorApproval).not.toBe(approval)
    expect(Object.isFrozen(descriptorApproval)).toBe(true)
    approval.reason = 'Changed after registration'
    expect(descriptorApproval?.reason).toBe('Review the exact mutation')
    await expect(context.doppelgangerTools.invoke('memory.search', { query: 'Cordis' })).resolves.toEqual({
      ok: true,
      value: { input: { query: 'Cordis' }, revision: 1 },
    })

    registration!.update({
      name: 'memory.search',
      description: 'Search current memory',
      inputSchema: { type: 'object' },
      invoke: () => ({ revision: 2 }),
    })
    expect(context.doppelgangerTools.list()[0]).not.toHaveProperty('approval')
    expect(context.doppelgangerTools.list()[0]?.description).toBe('Search current memory')
    await expect(context.doppelgangerTools.invoke('memory.search', {})).resolves.toEqual({
      ok: true,
      value: { revision: 2 },
    })

    await owner.dispose()
    expect(context.doppelgangerTools.list()).toEqual([])
    await expect(context.doppelgangerTools.invoke('memory.search', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_FOUND' },
    })
    await context.fiber.dispose()
  })

  it('rejects malformed approval metadata before registration', async () => {
    const context = await setup()
    const definition = {
      name: 'persona.revise',
      description: 'Revise a Persona asset',
      inputSchema: { type: 'object' } as const,
      invoke: () => null,
    }

    expect(() => context.doppelgangerTools.register({
      ...definition,
      approval: { policy: 'required', reason: ' ' },
    })).toThrow('approval reason must contain 1-1024 characters')
    expect(() => context.doppelgangerTools.register({
      ...definition,
      approval: { policy: 'required', reason: 'x'.repeat(1_025) },
    })).toThrow('approval reason must contain 1-1024 characters')
    expect(() => context.doppelgangerTools.register({
      ...definition,
      approval: { policy: 'optional', reason: 'Review' } as never,
    })).toThrow('approval policy must be "required"')
    expect(() => context.doppelgangerTools.register({
      ...definition,
      approval: { policy: 'required', reason: 'Review', feature: 'persona' } as never,
    })).toThrow('approval contains unsupported fields')
    await context.fiber.dispose()
  })

  it('returns serializable structured domain and execution errors', async () => {
    const context = await setup()
    const owner = await context.plugin({
      name: 'error-tools',
      inject: ['doppelgangerTools'],
      apply(ctx) {
        ctx.doppelgangerTools.register({
          name: 'memory.correct',
          description: 'Correct memory',
          inputSchema: { type: 'object' },
          invoke: () => { throw new ToolInvocationError('REVISION_CONFLICT', 'memory changed', { expected: 2 }) },
        })
        ctx.doppelgangerTools.register({
          name: 'memory.broken',
          description: 'Fail unexpectedly',
          inputSchema: { type: 'object' },
          invoke: () => { throw new Error('database unavailable') },
        })
      },
    })

    await expect(context.doppelgangerTools.invoke('memory.correct', {})).resolves.toEqual({
      ok: false,
      error: { code: 'REVISION_CONFLICT', message: 'memory changed', data: { expected: 2 } },
    })
    await expect(context.doppelgangerTools.invoke('memory.broken', {})).resolves.toEqual({
      ok: false,
      error: { code: 'TOOL_EXECUTION_FAILED', message: 'database unavailable' },
    })

    await owner.dispose()
    await context.fiber.dispose()
  })
})
