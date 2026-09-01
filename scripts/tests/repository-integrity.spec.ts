import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRepositoryIntegrity } from '../lib/repository-integrity.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-integrity-'))
  temporaryRoots.push(root)
  await put(root, 'README.md', '[Docs](docs/README.md)\n')
  await put(root, 'AGENTS.md', '[Docs](docs/README.md)\n')
  await put(root, 'docs/README.md', '[Guide](guide.md)\n')
  await put(root, 'docs/guide.md', '# Guide\n')
  await put(root, 'openspec/specs/persona/spec.md', [
    '# Persona',
    '### Requirement: Persona instance configuration',
    'The Persona Loader plugin accepts `instanceId` as extension-owned configuration.',
    '',
    '#### Scenario: Persona configures an instance',
    '- **ID**: `persona.instance.configuration`',
    '- **EVIDENCE**: `scripts/tests/persona.spec.ts::configures an instance`',
    '- **WHEN** Persona activation receives an instance ID',
    '- **THEN** the activated Persona uses that stable instance identity',
    '',
  ].join('\n'))
  await put(root, 'scripts/tests/persona.spec.ts', [
    "import { expect, it } from 'vitest'",
    "it('configures an instance', () => expect('aiden').toBe('aiden'))",
    '',
  ].join('\n'))
  return root
}

describe('repository integrity checker', () => {
  it('accepts indexed docs, valid links, archives, and extension-owned instance identity', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/archive/old/spec.md', 'Historical reference to SPEC.md and @doppelganger/preset-aiden.\n')
    await expect(checkRepositoryIntegrity(root)).resolves.toEqual([])
  })

  it('checks live focused specification integrity', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/persona/spec.md', [
      '### Requirement: Persona instance configuration',
      '#### Scenario: Persona configures an instance',
      '- **ID**: `persona.instance.configuration`',
      '- **WHEN** Persona activation receives an instance ID',
      '- **THEN** the activated Persona uses that stable instance identity',
      '',
    ].join('\n'))
    await expect(checkRepositoryIntegrity(root)).resolves.toContainEqual(
      expect.stringContaining('expected at least one EVIDENCE row'),
    )
  })

  it('reports broken local Markdown links', async () => {
    const root = await fixture()
    await put(root, 'docs/guide.md', '[Missing](missing.md)\n')
    await expect(checkRepositoryIntegrity(root)).resolves.toContain(
      'docs/guide.md: unresolved Markdown link missing.md',
    )
  })

  it('reports authoritative documents missing from the docs index', async () => {
    const root = await fixture()
    await put(root, 'docs/unindexed.md', '# Unindexed\n')
    await expect(checkRepositoryIntegrity(root)).resolves.toContain(
      'docs/unindexed.md: document is not indexed by docs/README.md',
    )
  })

  it('reports active obsolete package identifiers', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/active/proposal.md', 'Restore @doppelganger/preset-aiden.\n')
    await expect(checkRepositoryIntegrity(root)).resolves.toContain(
      'openspec/changes/active/proposal.md:1: obsolete identifier @doppelganger/preset-aiden',
    )
  })

  it('reports runtime-owned Persona selection requirements', async () => {
    const root = await fixture()
    await put(root, 'openspec/specs/runtime/spec.md', '### Requirement: Project persona selection\n')
    await expect(checkRepositoryIntegrity(root)).resolves.toContain(
      'openspec/specs/runtime/spec.md:1: legacy runtime-owned Persona requirement Project persona selection',
    )
  })

  it('does not inspect removed requirements in an active delta', async () => {
    const root = await fixture()
    await put(root, 'openspec/changes/active/specs/persona/spec.md', [
      '## REMOVED Requirements',
      '### Requirement: Project persona selection',
      '**Reason:** Runtime Presets own generic selection.',
      '',
    ].join('\n'))
    await expect(checkRepositoryIntegrity(root)).resolves.toEqual([])
  })
})
