import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkFocusedSpecChange,
  checkFocusedSpecs,
  parseFocusedSpecDocument,
} from '../lib/focused-specs.mjs'

const temporaryRoots: string[] = []

const evidencePath = 'scripts/tests/evidence.spec.ts'
const evidenceTitle = 'proves focused behavior'

function scenario({
  id = 'feature.focused.behavior',
  evidence = `${evidencePath}::${evidenceTitle}`,
  when = ['principal requests behavior'],
  then = ['the promised result is observable'],
}: {
  id?: string | string[]
  evidence?: string | string[]
  when?: string[]
  then?: string[]
} = {}): string {
  const ids = Array.isArray(id) ? id : [id]
  const evidenceRows = Array.isArray(evidence) ? evidence : [evidence]
  return [
    '### Requirement: Focused behavior',
    'The system SHALL preserve focused behavior.',
    '',
    '#### Scenario: Principal requests focused behavior',
    ...ids.map(value => `- **ID**: \`${value}\``),
    ...evidenceRows.filter(Boolean).map(value => `- **EVIDENCE**: \`${value}\``),
    ...when.map(value => `- **WHEN** ${value}`),
    ...then.map(value => `- **THEN** ${value}`),
    '',
  ].join('\n')
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-focused-specs-'))
  temporaryRoots.push(root)
  await put(root, 'openspec/specs/example/spec.md', scenario())
  await put(root, evidencePath, `import { expect, it } from 'vitest'\nit('${evidenceTitle}', () => expect({ promised: true, added: 'allowed' }).toMatchObject({ promised: true }))\n`)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('focused spec parser and ownership', () => {
  it('moves behavior to its current owner', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/move/specs/example/spec.md', [
      '## MODIFIED Requirements',
      scenario({ id: 'feature.focused.behavior', evidence: `planned:${evidencePath}::replacement behavior` }),
    ].join('\n'))
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('ignores archived ownership', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/archive/old/specs/example/spec.md', '### Scenario: malformed historical scenario\n')
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('rejects independently failing outcomes in one scenario', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/example/spec.md', scenario({ then: ['first outcome', 'second outcome'] }))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('expected exactly one THEN row, found 2'))
  })

  it('allows one transactional infrastructure outcome', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/example/spec.md', scenario({
      then: ['cleanup attempts every owned stage and reports collected failures'],
    }))
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('retains the full contract while removing duplicate owners', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/duplicate/spec.md', scenario())
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('duplicate stable ID'))
  })

  it('rejects malformed headings and duplicate metadata', async () => {
    const parsed = parseFocusedSpecDocument('/root/spec.md', [
      '### Scenario: Wrong depth',
      scenario({ id: ['one.id', 'two.id'], when: ['first request', 'second request'] }),
    ].join('\n'))
    expect(parsed.malformedScenarioHeadings).toEqual([1])
    const root = await fixture()
    await put(root, 'openspec/specs/example/spec.md', [
      '### Scenario: Wrong depth',
      scenario({ id: ['one.id', 'two.id'], when: ['first request', 'second request'] }),
    ].join('\n'))
    const violations = await checkFocusedSpecs(root)
    expect(violations).toEqual(expect.arrayContaining([
      expect.stringContaining('scenario headings must use exactly four hashes'),
      expect.stringContaining('expected exactly one ID row, found 2'),
      expect.stringContaining('expected exactly one WHEN row, found 2'),
    ]))
  })

  it('rejects a current scenario without evidence', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/example/spec.md', scenario({ evidence: [] }))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('expected at least one EVIDENCE row'))
  })

  it('accepts planned evidence in an active delta', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/add/specs/new-capability/spec.md', [
      '## ADDED Requirements',
      scenario({ id: 'new.focused.behavior', evidence: `planned:${evidencePath}::future behavior` }),
    ].join('\n'))
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('rejects planned evidence before archive', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/add/specs/new-capability/spec.md', [
      '## ADDED Requirements',
      scenario({ id: 'new.focused.behavior', evidence: `planned:${evidencePath}::future behavior` }),
    ].join('\n'))
    await expect(checkFocusedSpecChange(root, 'add')).resolves.toContainEqual(expect.stringContaining('planned evidence is not allowed'))
  })

  it('rejects duplicate stable behavior ownership', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/add/specs/new-capability/spec.md', [
      '## ADDED Requirements',
      scenario({ id: 'feature.focused.behavior', evidence: `planned:${evidencePath}::future behavior` }),
    ].join('\n'))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('stable ID already belongs to current scenario'))
  })
})

describe('focused spec evidence resolution', () => {
  it('resolves executable evidence by file and test title', async () => {
    const root = await fixture()
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('rejects a stale evidence reference', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/example/spec.md', scenario({ evidence: `${evidencePath}::missing title` }))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('unresolved evidence test title'))
  })

  it('keeps additive response fields outside promised evidence', async () => {
    const root = await fixture()
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('requires exact absence when absence is promised', async () => {
    const root = await fixture()
    await put(root, evidencePath, `import { expect, it } from 'vitest'\nit('${evidenceTitle}', () => expect([]).toEqual([]))\n`)
    await expect(checkFocusedSpecs(root)).resolves.toEqual([])
  })

  it('rejects duplicate test titles', async () => {
    const root = await fixture()
    await put(root, evidencePath, `import { it } from 'vitest'\nit('${evidenceTitle}', () => {})\nit('${evidenceTitle}', () => {})\n`)
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('evidence title is duplicated'))
  })

  it('rejects missing files and repository traversal', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/example/spec.md', scenario({ evidence: 'missing.spec.ts::missing' }))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('unresolved evidence file'))
    await put(root, 'openspec/specs/example/spec.md', scenario({ evidence: '../outside.spec.ts::missing' }))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('evidence path must stay inside the repository'))
  })

  it('rejects modified and parameterized test cases', async () => {
    const root = await fixture()
    await put(root, evidencePath, `import { it } from 'vitest'\nit.skip('${evidenceTitle}', () => {})\nit.each([[1]])('parameterized title', () => {})\n`)
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('not a direct unconditional it/test case'))
    await put(root, 'openspec/specs/example/spec.md', scenario({ evidence: `${evidencePath}::parameterized title` }))
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('not a direct unconditional it/test case'))
  })

  it('rejects tests inside conditional suites', async () => {
    const root = await fixture()
    await put(root, evidencePath, `import { describe, it } from 'vitest'\ndescribe.skip('conditional suite', () => { it('${evidenceTitle}', () => {}) })\n`)
    await expect(checkFocusedSpecs(root)).resolves.toContainEqual(expect.stringContaining('not a direct unconditional it/test case'))
  })
})
