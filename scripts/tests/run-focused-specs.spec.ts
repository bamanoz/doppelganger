import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planFocusedSpecRun } from '../lib/focused-specs.mjs'
import { executeFocusedSpecPlan } from '../lib/run-focused-specs.mjs'

const temporaryRoots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-focused-runner-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'openspec/specs'), { recursive: true })
  await mkdir(join(root, 'openspec/changes'), { recursive: true })
  return root
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}

function scenario(id: string, evidence: string): string {
  return [
    `#### Scenario: ${id}`,
    `- **ID**: \`${id}\``,
    `- **EVIDENCE**: \`${evidence}\``,
    '- **WHEN** focused evidence is requested',
    '- **THEN** the promised outcome is observed',
  ].join('\n')
}

function spec(...scenarios: string[]): string {
  return [
    '# Fixture Specification',
    '',
    '## Requirements',
    '',
    '### Requirement: Fixture behavior',
    'The system SHALL preserve fixture behavior.',
    '',
    ...scenarios.flatMap(value => [value, '']),
  ].join('\n')
}

function testFile(...titles: string[]): string {
  return [
    "import { describe, it } from 'vitest'",
    "describe('fixture', () => {",
    ...titles.map(title => `  it('${title}', () => {})`),
    '})',
    '',
  ].join('\n')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('focused spec execution planning', () => {
  it('plans current evidence by exact source line and deduplicates shared tests', async () => {
    const root = await fixture()
    const evidence = 'scripts/tests/evidence.spec.ts::proves shared behavior'
    await put(root, 'openspec/specs/current/spec.md', spec(
      scenario('fixture.current.one', evidence),
      scenario('fixture.current.two', evidence),
    ))
    await put(root, 'scripts/tests/evidence.spec.ts', testFile('proves shared behavior'))

    const plan = await planFocusedSpecRun(root)

    expect(plan.mode).toBe('current')
    expect(plan.scenarios.map(item => item.id)).toEqual(['fixture.current.one', 'fixture.current.two'])
    expect(plan.targets).toMatchObject([{
      reference: evidence,
      relativePath: 'scripts/tests/evidence.spec.ts',
      line: 3,
      title: 'proves shared behavior',
      rootPath: 'scripts',
    }])
    expect(plan.scenarios.map(item => item.evidenceKeys)).toEqual([[plan.targets[0]!.key], [plan.targets[0]!.key]])
  })

  it('groups package and script evidence under their owning Vitest roots', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/current/spec.md', spec(
      scenario('fixture.root.scripts', 'scripts/tests/evidence.spec.ts::proves script behavior'),
      scenario('fixture.root.alpha', 'packages/alpha/tests/evidence.spec.ts::proves alpha behavior'),
      scenario('fixture.root.beta', 'packages/beta/tests/evidence.spec.ts::proves beta behavior'),
    ))
    await put(root, 'scripts/tests/evidence.spec.ts', testFile('proves script behavior'))
    await put(root, 'packages/alpha/tests/evidence.spec.ts', testFile('proves alpha behavior'))
    await put(root, 'packages/beta/tests/evidence.spec.ts', testFile('proves beta behavior'))

    const plan = await planFocusedSpecRun(root)

    expect(plan.groups.map(group => [group.rootPath, group.targets.length])).toEqual([
      ['packages/alpha', 1],
      ['packages/beta', 1],
      ['scripts', 1],
    ])
  })

  it('selects only implemented evidence from the requested change', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/current/spec.md', spec(
      scenario('fixture.current', 'scripts/tests/current.spec.ts::proves current behavior'),
    ))
    await put(root, 'openspec/changes/change-one/specs/feature/spec.md', [
      '## ADDED Requirements',
      '',
      '### Requirement: Changed behavior',
      'The system SHALL change.',
      '',
      scenario('fixture.change', 'packages/alpha/tests/change.spec.ts::proves changed behavior'),
      '',
    ].join('\n'))
    await put(root, 'scripts/tests/current.spec.ts', testFile('proves current behavior'))
    await put(root, 'packages/alpha/tests/change.spec.ts', testFile('proves changed behavior'))

    const plan = await planFocusedSpecRun(root, { changeName: 'change-one' })

    expect(plan.mode).toBe('change')
    expect(plan.changeName).toBe('change-one')
    expect(plan.scenarios.map(item => item.id)).toEqual(['fixture.change'])
    expect(plan.targets.map(item => item.reference)).toEqual([
      'packages/alpha/tests/change.spec.ts::proves changed behavior',
    ])
  })

  it('rejects planned change evidence before execution', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/change-one/specs/feature/spec.md', [
      '## ADDED Requirements',
      '',
      '### Requirement: Changed behavior',
      'The system SHALL change.',
      '',
      scenario('fixture.change', 'planned:scripts/tests/change.spec.ts::proves changed behavior'),
      '',
    ].join('\n'))

    await expect(planFocusedSpecRun(root, { changeName: 'change-one' })).rejects.toThrow(
      'planned evidence is not allowed',
    )
  })
})

describe('focused spec execution results', () => {
  it('executes shared evidence once and reports every referencing scenario as PASS', async () => {
    const root = await fixture()
    const evidence = 'scripts/tests/evidence.spec.ts::proves shared behavior'
    await put(root, 'openspec/specs/current/spec.md', spec(
      scenario('fixture.pass.one', evidence),
      scenario('fixture.pass.two', evidence),
    ))
    await put(root, 'scripts/tests/evidence.spec.ts', testFile('proves shared behavior'))
    const plan = await planFocusedSpecRun(root)
    const calls: string[][] = []

    const result = await executeFocusedSpecPlan(plan, {
      runGroup: async group => {
        calls.push(group.targets.map(target => target.key))
        return {
          assertions: group.targets.map(target => ({
            absolutePath: target.absolutePath,
            line: target.line,
            title: target.title,
            status: 'passed' as const,
            failureMessages: [],
          })),
        }
      },
    })

    expect(calls).toEqual([[plan.targets[0]!.key]])
    expect(result.success).toBe(true)
    expect(result.scenarios.map(item => [item.id, item.status])).toEqual([
      ['fixture.pass.one', 'PASS'],
      ['fixture.pass.two', 'PASS'],
    ])
  })

  it('reports optional skipped evidence without presenting it as PASS', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/current/spec.md', spec(
      scenario('fixture.skip', 'scripts/tests/evidence.spec.ts::proves optional behavior'),
    ))
    await put(root, 'scripts/tests/evidence.spec.ts', testFile('proves optional behavior'))
    const plan = await planFocusedSpecRun(root)

    const result = await executeFocusedSpecPlan(plan, {
      runGroup: async group => ({
        assertions: group.targets.map(target => ({
          absolutePath: target.absolutePath,
          line: target.line,
          title: target.title,
          status: 'skipped' as const,
          failureMessages: [],
        })),
      }),
    })

    expect(result.success).toBe(true)
    expect(result.scenarios).toMatchObject([{ id: 'fixture.skip', status: 'SKIP' }])
  })

  it('reports failed evidence and returns an unsuccessful result', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/current/spec.md', spec(
      scenario('fixture.failed', 'scripts/tests/evidence.spec.ts::fails focused behavior'),
      scenario('fixture.missing', 'scripts/tests/evidence.spec.ts::has no result'),
    ))
    await put(root, 'scripts/tests/evidence.spec.ts', testFile('fails focused behavior', 'has no result'))
    const plan = await planFocusedSpecRun(root)

    const result = await executeFocusedSpecPlan(plan, {
      runGroup: async group => ({
        assertions: [{
          absolutePath: group.targets[0]!.absolutePath,
          line: group.targets[0]!.line,
          title: group.targets[0]!.title,
          status: 'failed' as const,
          failureMessages: ['expected focused behavior'],
        }],
      }),
    })

    expect(result.success).toBe(false)
    expect(result.scenarios.map(item => [item.id, item.status, item.evidence[0]?.diagnostic])).toEqual([
      ['fixture.failed', 'FAIL', 'expected focused behavior'],
      ['fixture.missing', 'FAIL', 'Vitest did not report the selected assertion'],
    ])
  })
})
