import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const skillName = 'doppelganger-capability-evolution'
const skillDirectory = resolve('skills/evolution', skillName)
const skillPath = join(skillDirectory, 'SKILL.md')
const temporaryRoots: string[] = []
const execFileAsync = promisify(execFile)

async function skill(): Promise<string> {
  return await readFile(skillPath, 'utf8')
}

async function discoverOmpProjectSkills(project: string): Promise<{
  readonly skills: Array<{ readonly name: string; readonly filePath: string; readonly source?: { provider?: string; level?: string } }>
  readonly warnings: unknown[]
}> {
  const settings = {
    enableCodexUser: false, enableClaudeUser: false, enableClaudeProject: false,
    enablePiUser: false, enablePiProject: false, enableAgentsUser: false, enableAgentsProject: true,
  }
  const program = [
    'import { discoverSkills } from "@oh-my-pi/pi-coding-agent";',
    `const result = await discoverSkills(${JSON.stringify(project)}, undefined, ${JSON.stringify(settings)});`,
    'console.log(JSON.stringify({ warnings: result.warnings, skills: result.skills.map(skill => ({ name: skill.name, filePath: skill.filePath, source: skill._source })) }));',
  ].join('\n')
  const { stdout } = await execFileAsync('bun', ['--eval', program], { cwd: resolve('.') })
  return JSON.parse(stdout) as Awaited<ReturnType<typeof discoverOmpProjectSkills>>
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('doppelganger-capability-evolution skill', () => {
  it('ships one canonical portable skill with exact host invocation syntax', async () => {
    const content = await skill()
    expect(content).toMatch(new RegExp(`^---\\nname: ${skillName}\\ndescription: .+Use when .+\\n---\\n`))
    expect(content).toContain(`OMP: \`/skill:${skillName} ...\``)
    expect(content).toContain(`DSH: \`/${skillName} ...\``)
    const paths = (await readdir(resolve('skills'), { recursive: true })).filter(path => path.endsWith(`${skillName}/SKILL.md`))
    expect(paths).toEqual([`evolution/${skillName}/SKILL.md`])
  })

  it('installs the same canonical Skills for OMP and DSH project discovery', async () => {
    const project = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-skills-'))
    temporaryRoots.push(project)
    const root = join(project, '.agents', 'skills')
    await mkdir(root, { recursive: true })
    for (const [name, source] of [
      [skillName, skillDirectory],
      ['doppelganger-persona-evolution', resolve('skills/persona/doppelganger-persona-evolution')],
    ] as const) await cp(source, join(root, name), { recursive: true })
    const discovered = await discoverOmpProjectSkills(project)
    expect(discovered.warnings).toEqual([])
    for (const name of [skillName, 'doppelganger-persona-evolution']) {
      expect(discovered.skills.filter(candidate => candidate.name === name)).toEqual([
        expect.objectContaining({
          filePath: join(root, name, 'SKILL.md'),
          source: expect.objectContaining({ provider: 'agents', level: 'project' }),
        }),
      ])
      const canonical = await readFile(join(root, name, 'SKILL.md'), 'utf8')
      expect(canonical).toContain(`DSH: \`/${name}`)
      expect(canonical).not.toContain('.omp/skills')
      expect(canonical).not.toContain('.dsh/skills')
    }
  })

  it('requires Evolution controls and forbids ad hoc backlog files', async () => {
    const content = await skill()
    for (const name of ['evolution.propose', 'evolution.list', 'evolution.inspect', 'evolution.transition', 'evolution.snooze', 'evolution.reject', 'evolution.reminder.record']) {
      expect(content).toContain(`\`${name}\``)
    }
    expect(content).toContain('active Runtime Preset omitted the optional plugin and stop')
    expect(content).toContain('Never create an ad hoc backlog with shell, filesystem editing, generic file tools, memory records, or host-private APIs.')
  })

  it('starts research only after explicit current consent and keeps reminders inert', async () => {
    const content = await skill()
    const inert = content.indexOf('A recorded proposal or reminder is inert.')
    const consent = content.indexOf('After explicit current research consent')
    const research = content.indexOf('Research current maintained implementations')
    expect(inert).toBeGreaterThan(-1)
    expect(consent).toBeGreaterThan(inert)
    expect(research).toBeGreaterThan(consent)
    expect(content).toContain('do not browse external implementations or transition it to `researching`')
    expect(content).toContain('proposal creation, reminder delivery, ordinary task consent, prior interest, and silence do not')
    expect(content).toContain('A successful transition grants no execution authority.')
  })

  it('requires current primary-source comparison before recommendation', async () => {
    const content = await skill()
    for (const criterion of ['architecture', 'feature fit', 'maintenance activity', 'license', 'dependencies', 'runtime requirements', 'security boundary', 'host integration surface', 'portability of the reusable core']) {
      expect(content).toContain(criterion)
    }
    expect(content).toContain('Prefer primary sources.')
    expect(content).toContain('Link sources for material and time-sensitive claims.')
    expect(content).toContain('offer supported alternatives or an explicit adaptation option; never invent compatibility')
  })

  it('routes existing, temporary, permanent, and host-specific mechanisms in order', async () => {
    const content = await skill()
    const existing = content.indexOf('Reuse an existing capability')
    const temporary = content.indexOf('route through `doppelganger-runtime-plugin-development`')
    const permanent = content.indexOf('permanent installable Doppelganger package and Loader plugin')
    const host = content.indexOf('Use an existing host-agent plugin only')
    expect(existing).toBeGreaterThan(-1)
    expect(temporary).toBeGreaterThan(existing)
    expect(permanent).toBeGreaterThan(temporary)
    expect(host).toBeGreaterThan(permanent)
    for (const excluded of ['persistence across restart', 'dependency or package installation', 'permanent product code', 'Client UI', 'authored Runtime Preset requirements']) {
      expect(content).toContain(excluded)
    }
  })

  it('records exact research and selection transitions then stops', async () => {
    const content = await skill()
    const researching = content.indexOf('to `researching`')
    const options = content.indexOf('transition to `options-ready`')
    const selected = content.indexOf('transition to `selected`')
    const stop = content.indexOf('then stop')
    expect(researching).toBeGreaterThan(-1)
    expect(options).toBeGreaterThan(researching)
    expect(selected).toBeGreaterThan(options)
    expect(stop).toBeGreaterThan(selected)
    expect(content).toContain('Reuse a stable operation ID only for an exact retry.')
    expect(content).toContain('The skill ends at `selected`')
  })

  it('hands the selected mechanism off without planning implementation', async () => {
    const content = await skill()
    expect(content).toContain('does not choose or create a repository, package, planning system, OpenSpec change, or implementation artifact')
    expect(content).toContain('write implementation instructions')
    expect(content).toContain('transition to `planned`, `implementing`, or `done`')
    expect(content).toContain('Hand all later planning and implementation to a separately invoked owning workflow')
    expect(content).not.toContain('establish its implementation home')
    expect(content).not.toContain('create the complete reviewable implementation artifact')
  })

  it('finishes primary work first and rejects weak one-off opportunities', async () => {
    const content = await skill()
    expect(content).toContain('Finish and verify the primary task before raising a new opportunity.')
    expect(content).toContain('Present at most one concise relevant research offer afterward.')
    expect(content).toContain('Create no proposal for a one-off inconvenience, a temporary gap, or work already handled by an existing capability.')
    expect(content).not.toMatch(/^#!|```(?:sh|bash|javascript|typescript|python)/m)
  })
})
