import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const skillName = 'doppelganger-plugin-development'
const skillDirectory = resolve('skills/development', skillName)
const skillPath = join(skillDirectory, 'SKILL.md')
const temporaryRoots: string[] = []

async function skill(): Promise<string> {
  return await readFile(skillPath, 'utf8')
}

async function discoverOmpProjectSkills(project: string): Promise<{
  readonly skills: Array<{
    readonly name: string
    readonly filePath: string
    readonly source?: { readonly provider?: string; readonly level?: string }
  }>
  readonly warnings: unknown[]
}> {
  const settings = {
    enableCodexUser: false,
    enableClaudeUser: false,
    enableClaudeProject: false,
    enablePiUser: false,
    enablePiProject: false,
    enableAgentsUser: false,
    enableAgentsProject: true,
  }
  const program = [
    'import { discoverSkills } from "@oh-my-pi/pi-coding-agent";',
    `const result = await discoverSkills(${JSON.stringify(project)}, undefined, ${JSON.stringify(settings)});`,
    'console.log(JSON.stringify({ warnings: result.warnings, skills: result.skills.map(skill => ({ name: skill.name, filePath: skill.filePath, source: skill._source })) }));',
  ].join('\n')
  const { stdout } = await execFileAsync('bun', ['--eval', program], { cwd: resolve('.') })
  return JSON.parse(stdout) as Awaited<ReturnType<typeof discoverOmpProjectSkills>>
}

async function discoverDshProjectSkill(project: string): Promise<{
  readonly name: string
  readonly path?: string
  readonly source: string
  readonly content: string
}> {
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(project, '.test-dsh-home'),
      agentsHome: join(project, '.test-agents-home'),
      watch: false,
    })
    const summary = (await ctx.skills.list({ cwd: project })).find(candidate => candidate.name === skillName)
    expect(summary).toBeDefined()
    const definition = await ctx.skills.get(skillName, { cwd: project })
    expect(definition).toBeDefined()
    return {
      name: definition!.name,
      ...(definition!.path !== undefined ? { path: definition!.path } : {}),
      source: definition!.source,
      content: definition!.content,
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('doppelganger-plugin-development skill', () => {
  it('declares the canonical permanent plugin workflow identity', async () => {
    const content = await skill()
    expect(content).toMatch(new RegExp(`^---\\nname: ${skillName}\\ndescription: .+Use when .+\\n---\\n`))
    expect(content).toContain('Create, build, modify, or repair permanent installable Doppelganger plugins and npm packages.')
    const paths = (await readdir(resolve('skills'), { recursive: true }))
      .filter(path => path.endsWith(`${skillName}/SKILL.md`))
    expect(paths).toEqual([`development/${skillName}/SKILL.md`])
  })

  it('installs one canonical skill for OMP and DSH project discovery', async () => {
    const project = await mkdtemp(join(tmpdir(), 'doppelganger-plugin-skill-'))
    temporaryRoots.push(project)
    await mkdir(join(project, '.git'), { recursive: true })
    const installedDirectory = join(project, '.agents', 'skills', skillName)
    await mkdir(join(project, '.agents', 'skills'), { recursive: true })
    await cp(skillDirectory, installedDirectory, { recursive: true })

    const [omp, dsh] = await Promise.all([
      discoverOmpProjectSkills(project),
      discoverDshProjectSkill(project),
    ])

    expect(omp.warnings).toEqual([])
    expect(omp.skills.filter(candidate => candidate.name === skillName)).toEqual([
      expect.objectContaining({
        filePath: join(installedDirectory, 'SKILL.md'),
        source: expect.objectContaining({ provider: 'agents', level: 'project' }),
      }),
    ])
    expect(dsh).toMatchObject({
      name: skillName,
      path: join(installedDirectory, 'SKILL.md'),
      source: 'project-agents',
    })
    const canonical = await skill()
    expect(dsh.content).toBe(canonical.slice(canonical.indexOf('\n---\n') + 5).trim())
    expect(canonical).toContain(`OMP: \`/skill:${skillName} ...\``)
    expect(canonical).toContain(`DSH: \`/${skillName} ...\``)
    expect(canonical).not.toContain('.omp/skills')
    expect(canonical).not.toContain('.dsh/skills')
  })

  it('routes only permanent installable plugin work into this workflow', async () => {
    const content = await skill()
    expect(content).toContain('maintained source that must survive Runtime Session and host-process restart')
    expect(content).toContain('reversible behavior owned only by the current Runtime Session routes to `doppelganger-runtime-plugin-development`')
    expect(content).toContain('research or mechanism selection routes to `doppelganger-capability-evolution`')
    expect(content).toContain('browser DOM, native host Client UI, Claude Code plugins, or another surface absent from Doppelganger contracts')
    expect(content).toContain('Dynamic Runtime Plugin Packages are session-owned generated code, not maintained package source')
  })

  it('requires an explicit implementation location before any write', async () => {
    const content = await skill()
    const gate = content.indexOf('Before creating or modifying any directory, manifest, planning artifact, source file, test, documentation, or configuration')
    const choices = content.indexOf('ask the user to choose exactly one placement')
    const stop = content.indexOf('ask and stop before every write-oriented workflow step')
    const reground = content.indexOf('After the location choice and before planning or editing')
    expect(gate).toBeGreaterThan(-1)
    expect(choices).toBeGreaterThan(gate)
    expect(stop).toBeGreaterThan(choices)
    expect(reground).toBeGreaterThan(stop)
    expect(content).toContain('Never infer ownership from them.')
  })

  it('accepts each explicit repository placement choice', async () => {
    const content = await skill()
    expect(content).toContain('An explicit current-conversation statement that the package belongs in a named location satisfies the gate.')
    expect(content).toContain('the current repository, explicitly selected')
    expect(content).toContain('a named existing repository, with its concrete accessible path')
    expect(content).toContain('a new repository, with its intended local path')
    expect(content).toContain('require the intended local path before creating the project root')
    expect(content).toContain('package identity, npm scope ownership, and public or private publication visibility')
  })

  it('restarts repository discovery from the selected implementation location', async () => {
    const content = await skill()
    const location = content.indexOf('After the location choice and before planning or editing')
    const original = content.indexOf('Do not carry package, tooling, planning, or release assumptions from the original working directory.')
    const instructions = content.indexOf('governing agent instructions and documentation ownership map')
    const neighbors = content.indexOf('neighboring maintained plugin and package structure')
    expect(location).toBeGreaterThan(-1)
    expect(original).toBeGreaterThan(location)
    expect(instructions).toBeGreaterThan(original)
    expect(neighbors).toBeGreaterThan(instructions)
  })

  it('requires explicit package ownership choices for a new repository', async () => {
    const content = await skill()
    expect(content).toContain('require the intended local path before creating the project root')
    expect(content).toContain('resolve material public choices with the user: package identity, npm scope ownership, and public or private publication visibility')
    expect(content).toContain('Local creation never authorizes remote repository creation or hosting configuration.')
  })

  it('requires current source verified Cordis and Doppelganger contracts', async () => {
    const content = await skill()
    expect(content).toContain('inspect the current primary documentation or source for every required Cordis, Doppelganger, and target-package contract')
    expect(content).toContain('Do not rely on remembered APIs, copy a fixed scaffold')
    expect(content).toContain('required services belong in `inject`')
    expect(content).toContain('disposed with the owning plugin Fiber')
    expect(content).toContain('validated JSON-compatible values')
    expect(content).toContain('declared subpath exports')
    expect(content).toContain('Prefer existing target-repository conventions.')
  })

  it('uses planning only when selected repository policy requires it', async () => {
    const content = await skill()
    expect(content).toContain('Planning is target-owned.')
    expect(content).toContain('only when the user explicitly requested planning or the selected repository\'s governing instructions require its planning workflow')
    expect(content).toContain('Do not assume OpenSpec')
    expect(content).not.toContain('Always create an OpenSpec change')
  })

  it('requires package behavior installability and Loader activation proof', async () => {
    const content = await skill()
    for (const contract of [
      'package build or typecheck and behavioral tests',
      'owned lifecycle cleanup and relevant failure boundaries',
      'packed or publishable file contents and declared public exports',
      'installation into a disposable consumer outside the source tree',
      'imports from the installed consumer',
      'minimal real Cordis Loader activation',
      'observable behavior',
      'omission neutrality, disposal, and rollback or removal',
      'final integrity and security or dependency gate',
    ]) expect(content).toContain(contract)
    expect(content).toContain('Report only observed results.')
  })

  it('keeps publication release commit push and remote creation separately authorized', async () => {
    const content = await skill()
    expect(content).toContain('Successful development does not authorize `npm publish`, a version release, remote repository creation, git commit, or push.')
    expect(content).toContain('only after a separate explicit user request')
    expect(content).toContain('Local creation never authorizes remote repository creation or hosting configuration.')
  })
})