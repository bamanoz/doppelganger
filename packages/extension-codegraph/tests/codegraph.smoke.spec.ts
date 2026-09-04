import { execFile, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { ToolRegistry } from '@doppelganger/doppelganger-protocols'
import { afterAll, describe, expect, it } from 'vitest'
import { CodeGraphPlugin } from '../src/index.ts'

const execFileAsync = promisify(execFile)
const enabled = process.env.DOPPELGANGER_RUN_CODEGRAPH_SMOKE === '1'
const versionProbe = enabled ? spawnSync('codegraph', ['--version'], { encoding: 'utf8' }) : undefined
const compatible = versionProbe?.status === 0 && /^v?1\.6\./u.test(versionProbe.stdout.trim())
const smoke = enabled && compatible ? describe : describe.skip
const temporaryRoots: string[] = []

smoke('CodeGraph standalone smoke', () => {
  afterAll(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('initializes a disposable repository and explores it through portable tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-codegraph-smoke-'))
    temporaryRoots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await Promise.all([
      writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'codegraph-smoke', private: true, type: 'module' })),
      writeFile(join(workspace, 'src', 'greeting.ts'), [
        'export function greeting(name: string): string {',
        '  return `Hello, ${name}`',
        '}',
        '',
        'export function welcome(): string {',
        "  return greeting('CodeGraph')",
        '}',
        '',
      ].join('\n')),
    ])
    await execFileAsync('git', ['init', '--quiet'], { cwd: workspace })
    await execFileAsync('codegraph', ['init', workspace], {
      cwd: workspace,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', DO_NOT_TRACK: '1', CODEGRAPH_TELEMETRY: '0' },
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    })

    const ctx = new Context()
    ctx.provide('doppelgangerRuntimeSession', Object.freeze({
      sessionId: 'codegraph-smoke',
      runtimePresetId: 'codegraph-smoke',
      workspaceRoot: workspace,
    }))
    await ctx.plugin(ToolRegistry)
    const plugin = await ctx.plugin(CodeGraphPlugin, {})
    try {
      expect(await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.status', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.status')!.revision, input: {} }, 'test-session')).toMatchObject({
        ok: true,
        value: { workspaceAvailable: true, workspaceRoot: workspace, explorationSafe: true },
      })
      expect(await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'codegraph.explore', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'codegraph.explore')!.revision, input: {
        query: 'Where is the greeting assembled and called?',
        maxFiles: 2,
      } }, 'test-session')).toMatchObject({
        ok: true,
        value: { workspaceRoot: workspace, maxFiles: 2, content: expect.any(String) },
      })
    } finally {
      await plugin.dispose()
      await ctx.fiber.dispose()
    }
  }, 180_000)
})
