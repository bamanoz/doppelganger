import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createRuntimeSessionMetadataPlugin } from '@doppelganger/doppelganger-composition-runtime'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService } from '@doppelganger/doppelganger-sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { EvolutionError, EvolutionService } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface SessionOptions {
  readonly actorId?: string
  readonly instanceId?: string
  readonly workspaceRoot?: string
  readonly now?: () => Date
  readonly ids?: readonly string[]
}

async function session(home: string, options: SessionOptions = {}): Promise<Context> {
  const context = new Context()
  const workspaceRoot = options.workspaceRoot
  await context.plugin(createRuntimeSessionMetadataPlugin({
    sessionId: crypto.randomUUID(),
    runtimePresetId: 'test',
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  }))
  await context.plugin(createActorIdentityPlugin(options.actorId ?? 'actor-a'))
  await context.plugin(createPersonaActivationPlugin({
    instanceId: options.instanceId ?? 'mark',
    sessionId: crypto.randomUUID(),
    ...(workspaceRoot === undefined ? {} : { projectId: 'project-a', projectRoot: workspaceRoot }),
  }))
  await context.plugin(InstanceSqliteService, { home })
  let index = 0
  await context.plugin(EvolutionService, {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.ids === undefined ? {} : { id: () => options.ids![index++] ?? crypto.randomUUID() }),
  })
  return context
}

function globalRequest(operationId = 'proposal-1') {
  return {
    operationId,
    kind: 'capability' as const,
    scope: 'global' as const,
    dedupeKey: 'capability.reusable-search',
    title: 'Reusable search capability',
    rationale: 'The same search integration is repeatedly needed.',
    evidence: [{ summary: 'Observed in two completed tasks.', sourceId: 'turn:two' }],
  }
}

describe.each(['global', 'project'] as const)('Evolution %s storage conformance', scope => {
  it('supports the shared proposal lifecycle, exact receipts, inspection, snooze, and rejection', async () => {
    const home = await mkdtemp(join(tmpdir(), `doppelganger-evolution-conformance-${scope}-`))
    const workspace = await mkdtemp(join(tmpdir(), `doppelganger-evolution-conformance-workspace-${scope}-`))
    roots.push(home, workspace)
    const context = await session(home, { workspaceRoot: workspace })
    const request = {
      operationId: `${scope}-propose`,
      kind: 'capability' as const,
      scope,
      dedupeKey: `capability.${scope}.conformance`,
      title: `${scope} conformance`,
      rationale: 'Exercise the shared storage contract end to end.',
    }
    const proposed = await context.doppelgangerEvolution.propose(request)
    expect(await context.doppelgangerEvolution.propose(request)).toEqual(proposed)
    expect((await context.doppelgangerEvolution.list({ scope })).proposals).toContainEqual(proposed)
    expect((await context.doppelgangerEvolution.inspect(proposed.id)).proposal).toEqual(proposed)
    const researching = await context.doppelgangerEvolution.transition({
      operationId: `${scope}-research`, id: proposed.id, expectedRevision: 1,
      target: 'researching', researchQuestion: 'Which maintained implementation fits?',
    })
    const snoozed = await context.doppelgangerEvolution.snooze({
      operationId: `${scope}-snooze`, id: proposed.id, expectedRevision: researching.revision,
      until: '2099-01-01T00:00:00.000Z', reason: 'Defer until the current milestone finishes.',
    })
    expect(snoozed).toMatchObject({ status: 'snoozed', resumeStatus: 'researching' })
    const rejected = await context.doppelgangerEvolution.reject({
      operationId: `${scope}-reject`, id: proposed.id, expectedRevision: snoozed.revision,
      reason: 'User declined this opportunity.',
    })
    expect(rejected.status).toBe('rejected')
    await expect(context.doppelgangerEvolution.transition({
      operationId: `${scope}-terminal`, id: proposed.id, expectedRevision: rejected.revision,
      target: 'options-ready', optionsSummary: 'Not allowed.', sourceIds: ['source:one'],
    })).rejects.toMatchObject({ code: 'TERMINAL_PROPOSAL' })
    await context.fiber.dispose()
  })
})
describe('Evolution global storage', () => {
  it('persists, replays exact operations, rejects changed retries and stale writes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-global-'))
    roots.push(home)
    const first = await session(home, { ids: ['proposal-a', 'history-a', 'evidence-a', 'history-b'] })
    const proposal = await first.doppelgangerEvolution.propose(globalRequest())

    expect(await first.doppelgangerEvolution.propose(globalRequest())).toEqual(proposal)
    await expect(first.doppelgangerEvolution.propose({ ...globalRequest(), title: 'Changed retry' }))
      .rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
    const researching = await first.doppelgangerEvolution.transition({
      operationId: 'research', id: proposal.id, expectedRevision: 1,
      target: 'researching', researchQuestion: 'Which maintained option fits?',
    })
    await expect(first.doppelgangerEvolution.transition({
      operationId: 'stale', id: proposal.id, expectedRevision: 1,
      target: 'options-ready', optionsSummary: 'Options.', sourceIds: ['source:one'],
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(researching.revision).toBe(2)
    await first.fiber.dispose()

    const reopened = await session(home)
    expect((await reopened.doppelgangerEvolution.inspect(proposal.id)).proposal).toEqual(researching)
    await reopened.fiber.dispose()
  })

  it('isolates every read and mutation by Persona Instance and bound actor', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-isolation-'))
    roots.push(home)
    const owner = await session(home, { actorId: 'actor-a', instanceId: 'mark', ids: ['proposal-a', 'history-a'] })
    const proposal = await owner.doppelgangerEvolution.propose(globalRequest())
    await owner.fiber.dispose()

    for (const options of [
      { actorId: 'actor-b', instanceId: 'mark' },
      { actorId: 'actor-a', instanceId: 'other' },
    ]) {
      const isolated = await session(home, options)
      expect((await isolated.doppelgangerEvolution.list()).proposals).toEqual([])
      await expect(isolated.doppelgangerEvolution.inspect(proposal.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await isolated.fiber.dispose()
    }
  })
})

describe('Evolution project storage', () => {
  it('creates no directory before first write, renders canonical YAML, and survives restart', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-project-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-project-workspace-'))
    roots.push(home, workspace)
    const directory = join(workspace, '.doppelganger', 'evolution', 'opportunities')
    const first = await session(home, { workspaceRoot: workspace, ids: ['project-proposal', 'history-a'] })
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    const proposal = await first.doppelgangerEvolution.propose({
      operationId: 'project-propose', kind: 'capability', scope: 'project',
      dedupeKey: 'project.release-automation', title: 'Release automation',
      rationale: 'This repository repeats a project-specific release sequence.',
    })
    const path = join(directory, `${proposal.id}.yaml`)
    const content = await readFile(path, 'utf8')
    expect(content).toContain('version: 1')
    expect(content).toContain('scope: project')
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
    await first.fiber.dispose()

    const reopened = await session(home, { workspaceRoot: workspace })
    expect((await reopened.doppelgangerEvolution.inspect(proposal.id)).proposal).toEqual(proposal)
    await reopened.fiber.dispose()
  })

  it('preserves healthy proposals and unrelated files while reporting malformed and symlink files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-diagnostics-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-diagnostics-workspace-'))
    roots.push(home, workspace)
    const context = await session(home, { workspaceRoot: workspace, ids: ['healthy', 'history-a'] })
    const proposal = await context.doppelgangerEvolution.propose({
      operationId: 'healthy-op', kind: 'capability', scope: 'project', dedupeKey: 'project.healthy',
      title: 'Healthy proposal', rationale: 'A valid project-specific opportunity.',
    })
    const directory = join(workspace, '.doppelganger', 'evolution', 'opportunities')
    await writeFile(join(directory, 'invalid.yaml'), 'version: 1\nproposal: [invalid]\n')
    await writeFile(join(directory, 'notes.txt'), 'unrelated')
    await symlink(join(directory, `${proposal.id}.yaml`), join(directory, 'linked.yaml'))
    const result = await context.doppelgangerEvolution.list()
    expect(result.proposals.map(item => item.id)).toContain(proposal.id)
    expect(result.diagnostics).toHaveLength(2)
    expect(await readFile(join(directory, 'notes.txt'), 'utf8')).toBe('unrelated')
    await context.fiber.dispose()
  })

  it('persists confirmed project reminders across restart and suppresses them during cooldown', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-reminder-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-reminder-workspace-'))
    roots.push(home, workspace)
    const createdAt = new Date('2026-09-02T12:00:00.000Z')
    const first = await session(home, {
      workspaceRoot: workspace,
      now: () => createdAt,
      ids: ['reminder-proposal', 'history-a', 'reminder-a'],
    })
    const proposal = await first.doppelgangerEvolution.propose({
      operationId: 'reminder-project-propose', kind: 'capability', scope: 'project',
      dedupeKey: 'project.release-reminder', title: 'Project release verification',
      rationale: 'Remember the repository-specific release verification workflow.',
      tags: ['release', 'verification'],
    })
    expect((await first.doppelgangerEvolution.selectReminder('release verification'))?.id).toBe(proposal.id)
    const delivered = await first.doppelgangerEvolution.recordReminder({
      operationId: 'reminder-project-delivered', id: proposal.id, expectedRevision: proposal.revision,
      sessionId: 'session-a', turnId: 'turn-a',
    })
    expect(delivered.reminders).toHaveLength(1)
    await first.fiber.dispose()

    const cooled = await session(home, {
      workspaceRoot: workspace,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    })
    expect((await cooled.doppelgangerEvolution.inspect(proposal.id)).proposal.reminders).toHaveLength(1)
    expect(await cooled.doppelgangerEvolution.selectReminder('release verification')).toBeUndefined()
    await cooled.fiber.dispose()

    const due = await session(home, {
      workspaceRoot: workspace,
      now: () => new Date('2026-09-10T12:00:00.000Z'),
    })
    expect((await due.doppelgangerEvolution.selectReminder('release verification'))?.id).toBe(proposal.id)
    await due.fiber.dispose()
  })

  it('serializes concurrent writers and rejects unsafe project scope without fallback', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-concurrent-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-concurrent-workspace-'))
    roots.push(home, workspace)
    const left = await session(home, { workspaceRoot: workspace, ids: ['left', 'left-history'] })
    const right = await session(home, { workspaceRoot: workspace, ids: ['right', 'right-history'] })
    const [leftProposal, rightProposal] = await Promise.all([
      left.doppelgangerEvolution.propose({
        operationId: 'left-op', kind: 'capability', scope: 'project', dedupeKey: 'project.left',
        title: 'Left proposal', rationale: 'Left project opportunity.',
      }),
      right.doppelgangerEvolution.propose({
        operationId: 'right-op', kind: 'capability', scope: 'project', dedupeKey: 'project.right',
        title: 'Right proposal', rationale: 'Right project opportunity.',
      }),
    ])
    expect((await left.doppelgangerEvolution.list({ scope: 'project' })).proposals.map(item => item.id).sort())
      .toEqual([leftProposal.id, rightProposal.id].sort())
    await left.fiber.dispose()
    await right.fiber.dispose()

    const noWorkspace = await session(home)
    await expect(noWorkspace.doppelgangerEvolution.propose({
      operationId: 'missing-project', kind: 'capability', scope: 'project', dedupeKey: 'project.missing',
      title: 'Missing workspace', rationale: 'Must not fall back to global storage.',
    })).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' })
    await expect(noWorkspace.doppelgangerEvolution.propose({
      operationId: 'persona-project', kind: 'persona', scope: 'project', dedupeKey: 'persona.project',
      title: 'Persona project', rationale: 'Persona scope is invalid.',
    })).rejects.toBeInstanceOf(EvolutionError)
    expect((await noWorkspace.doppelgangerEvolution.list()).proposals).toEqual([])
    await noWorkspace.fiber.dispose()
  })
})
