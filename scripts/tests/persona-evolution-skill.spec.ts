import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const skillPath = resolve('skills/persona/doppelganger-persona-evolution/SKILL.md')

async function skill(): Promise<string> {
  return await readFile(skillPath, 'utf8')
}

describe('doppelganger-persona-evolution skill', () => {
  it('declares the canonical portable identity and both review modes', async () => {
    const content = await skill()
    expect(content).toMatch(/^---\nname: doppelganger-persona-evolution\ndescription: .+Use when .+\n---\n/)
    expect(content).toContain('`review` — inspect, evaluate, and optionally submit one revision.')
    expect(content).toContain('`review --dry-run` — inspect and evaluate, but never call the revision tool.')
    expect(content).toContain('For `review --dry-run`, stop here without calling `persona.revise`.')
  })

  it('documents canonical universal installation and OMP and DSH invocation syntax', async () => {
    const readme = await readFile(resolve('README.md'), 'utf8')
    expect(readme).toContain('npx skills add bamanoz/doppelganger')
    expect(readme).toContain('--skill doppelganger-persona-evolution')
    expect(readme).toContain('--agent universal --copy -y')
    expect(readme).toContain('`.agents/skills/doppelganger-persona-evolution/`')
    expect(readme).toContain('OMP: /skill:doppelganger-persona-evolution review')
    expect(readme).toContain('DSH: /doppelganger-persona-evolution review')
  })

  it('keeps evidence, memory, and Persona responsibilities separate', async () => {
    const content = await skill()
    expect(content).toContain('several consistent durable observations from distinct sessions')
    expect(content).toContain('User facts and durable user preferences belong in memory, not Persona.')
    expect(content).toContain('If evidence is isolated, temporary, stale, materially contradictory, or already represented')
    expect(content).toContain('Preserve every unrelated meaning from the inspected content')
  })

  it('is inspect-first, approval-gated, and limited to one revision attempt', async () => {
    const content = await skill()
    const inspect = content.indexOf('Call `persona.inspect`')
    const draft = content.indexOf('Draft the smallest coherent complete replacement')
    const revise = content.indexOf('call `persona.revise` at most once')
    expect(inspect).toBeGreaterThan(-1)
    expect(draft).toBeGreaterThan(inspect)
    expect(revise).toBeGreaterThan(draft)
    expect(content).toContain('separate explicit one-shot native host approval')
    expect(content).toContain('Do not retry without a new user direction.')
    expect(content).toContain('do not claim activation')
  })

  it('forbids alternate mutation authority and path-based fallback', async () => {
    const content = await skill()
    expect(content).toContain('Never use filesystem, shell, patch, general editing, or another tool as a fallback.')
    expect(content).toContain('Never construct or accept a Persona asset path.')
    expect(content).toContain('Never ask the user to simulate approval in chat')
    expect(content).toContain('do not edit the file directly')
    expect(content).not.toMatch(/^#!|```(?:sh|bash|javascript|typescript|python)/m)
  })
})
