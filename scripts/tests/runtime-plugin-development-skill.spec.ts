import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const skillName = 'doppelganger-runtime-plugin-development'
const skillDirectory = resolve('skills/runtime', skillName)
const skillPath = join(skillDirectory, 'SKILL.md')
const temporaryRoots: string[] = []
const execFileAsync = promisify(execFile)

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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('doppelganger-runtime-plugin-development skill', () => {
  it('declares the canonical identity and temporary runtime purpose', async () => {
    const content = await skill()
    expect(content).toMatch(new RegExp(
      `^---\\nname: ${skillName}\\ndescription: .+Use when .+\\n---\\n`,
    ))
    expect(content).toContain('temporary session-scoped Doppelganger Cordis runtime plugins')
    expect(content).toContain('current Runtime Session')
    const paths = (await readdir(resolve('skills'), { recursive: true }))
      .filter(path => path.endsWith(`${skillName}/SKILL.md`))
    expect(paths).toEqual([`runtime/${skillName}/SKILL.md`])
  })

  it('installs one canonical Skill for OMP and DSH project discovery', async () => {
    const project = await mkdtemp(join(tmpdir(), 'doppelganger-runtime-skill-'))
    temporaryRoots.push(project)
    const installedDirectory = join(project, '.agents', 'skills', skillName)
    await mkdir(join(project, '.agents', 'skills'), { recursive: true })
    await cp(skillDirectory, installedDirectory, { recursive: true })
    const discovered = await discoverOmpProjectSkills(project)
    const omp = discovered.skills.filter(candidate => candidate.name === skillName)
    expect(discovered.warnings).toEqual([])
    expect(omp).toHaveLength(1)
    expect(omp[0]).toMatchObject({
      filePath: join(installedDirectory, 'SKILL.md'),
      source: { provider: 'agents', level: 'project' },
    })

    const canonical = await skill()
    const dshProjectSkill = await readFile(join(project, '.agents', 'skills', skillName, 'SKILL.md'), 'utf8')
    expect(dshProjectSkill).toBe(canonical)
    expect(dshProjectSkill).toContain(`DSH: \`/${skillName} ...\``)
    expect(dshProjectSkill).not.toContain('.omp/skills')
    expect(dshProjectSkill).not.toContain('.dsh/skills')
  })

  it('documents exact OMP and DSH invocation syntax', async () => {
    const content = await skill()
    expect(content).toContain(`OMP: \`/skill:${skillName} ...\``)
    expect(content).toContain(`DSH: \`/${skillName} ...\``)
    expect(content).toContain('Skill invocation grants no runtime authority.')
    expect(content).toContain('separate one-shot native host approval')
  })

  it('routes only temporary session-scoped host behavior into dynamic plugins', async () => {
    const content = await skill()
    for (const excluded of [
      'permanent product code',
      'authored Runtime Preset composition or patches',
      'persistence across restart',
      'package installation',
      'a direct one-shot tool invocation',
      'browser DOM or React work',
      'host Client code',
      'host-specific UI',
    ]) expect(content).toContain(excluded)
    expect(content).toContain('reversible host-side behavior')
  })

  it('requires provider discovery and exact contract queries before define', async () => {
    const content = await skill()
    const inspectList = content.indexOf('Call `runtime-plugin.inspect-list` before writing code.')
    const inspectQuery = content.indexOf('Call `runtime-plugin.inspect-query` only for each exact')
    const inspectSelf = content.indexOf('call `runtime-plugin.inspect-self`')
    const define = content.indexOf('Call `runtime-plugin.define` once')
    expect(inspectList).toBeGreaterThan(-1)
    expect(inspectQuery).toBeGreaterThan(inspectList)
    expect(inspectSelf).toBeGreaterThan(inspectQuery)
    expect(define).toBeGreaterThan(inspectSelf)
    expect(content).toContain('Use current returned names and signatures')
    expect(content).toContain('report the missing contract and stop rather than guessing')
  })

  it('teaches inspected plain JavaScript and lifecycle-owned effects', async () => {
    const content = await skill()
    expect(content).toContain('plain JavaScript async-function body that returns a Cordis Plugin')
    expect(content).toContain('Declare every hard service dependency in `inject`')
    expect(content).toContain('cannot invoke another tool directly')
    expect(content).toContain('Every external subscription must return a disposer')
    for (const unsupported of ['imports', '`require`', 'TypeScript annotations', 'JSX', 'native timers', 'guessed Node globals']) {
      expect(content).toContain(unsupported)
    }
  })

  it('separates immutable definition, approved transitions, repair, stop, and removal', async () => {
    const content = await skill()
    expect(content).toContain('Definition is inert')
    expect(content).toContain('`pluginId`, `packageId`, `name`, `purpose`, and `sourceDigest`')
    expect(content).toContain('`mode: "run"`')
    expect(content).toContain('`mode: "update"`')
    expect(content).toContain('Treat a non-empty `waitingFor` list as waiting, not running success')
    expect(content).toContain('Do not retry, redefine around the decision, or seek alternate authority.')
    expect(content).toContain('never claim automatic rollback')
    expect(content).toContain('Use `runtime-plugin.stop` to disable active effects while retaining immutable Packages')
    expect(content).toContain('Use `runtime-plugin.undefine` only when the user no longer needs the Plugin')
    expect(content).toContain('Do not edit Runtime Presets, patches, plugin files, configuration, or install packages as a fallback.')
  })

  it('states shell-equivalent trust and host failure boundaries before run', async () => {
    const content = await skill()
    const trust = content.indexOf('generated Package code is trusted process code')
    const run = content.indexOf('call `runtime-plugin.run` with `mode: "run"`')
    expect(trust).toBeGreaterThan(-1)
    expect(run).toBeGreaterThan(trust)
    expect(content).toContain('`node:vm` is not a security sandbox')
    expect(content).toContain("OMP's child process is a failure boundary, not hostile-code containment")
    expect(content).toContain('native DSH execution shares the host process')
    expect(content).toContain("The user's native approval decision is authoritative.")
  })

  it('forbids alternate runtime authority when portable tools are absent', async () => {
    const content = await skill()
    expect(content).toContain('Never fall back to DSH `cordis_*` tools, shell, filesystem editing, direct `node:vm`, Loader mutation, or private host APIs.')
    expect(content).toContain('then stop')
    expect(content).not.toMatch(/^#!|```(?:sh|bash|javascript|typescript|python)/m)
  })
})
