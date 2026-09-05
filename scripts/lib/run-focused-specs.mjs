import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function assertionKey(absolutePath, line, title) {
  return `${resolve(absolutePath)}:${line}:${title}`
}

function normalizeVitestReport(report) {
  if (!Array.isArray(report?.testResults)) throw new Error('Vitest JSON report has no testResults array')
  return {
    assertions: report.testResults.flatMap(result => {
      if (typeof result?.name !== 'string' || !Array.isArray(result.assertionResults)) return []
      return result.assertionResults.flatMap(assertion => {
        if (typeof assertion?.title !== 'string' || typeof assertion?.location?.line !== 'number') return []
        return [{
          absolutePath: resolve(result.name),
          line: assertion.location.line,
          title: assertion.title,
          status: assertion.status,
          failureMessages: Array.isArray(assertion.failureMessages)
            ? assertion.failureMessages.filter(message => typeof message === 'string')
            : [],
        }]
      })
    }),
  }
}

async function runVitestGroup(plan, group, reportPath) {
  const vitestPath = join(plan.root, 'node_modules', 'vitest', 'vitest.mjs')
  const filters = group.targets.map(target => `${target.absolutePath}:${target.line}`)
  const result = spawnSync(process.execPath, [
    vitestPath,
    'run',
    '--root', group.absoluteRootPath,
    ...filters,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ], {
    cwd: plan.root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
  if (result.error !== undefined) throw result.error

  let report
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch (error) {
    const stderr = result.stderr.trim()
    const suffix = stderr === '' ? '' : `: ${stderr}`
    throw new Error(`Vitest did not produce a readable JSON report for ${group.rootPath}${suffix}`, { cause: error })
  }
  return normalizeVitestReport(report)
}

function evidenceResult(target, assertionByKey) {
  const assertion = assertionByKey.get(assertionKey(target.absolutePath, target.line, target.title))
  if (assertion === undefined) {
    return {
      reference: target.reference,
      status: 'FAIL',
      diagnostic: 'Vitest did not report the selected assertion',
    }
  }
  if (assertion.status === 'passed') return { reference: target.reference, status: 'PASS' }
  if (assertion.status === 'skipped' || assertion.status === 'pending' || assertion.status === 'todo') {
    return { reference: target.reference, status: 'SKIP' }
  }
  return {
    reference: target.reference,
    status: 'FAIL',
    diagnostic: assertion.failureMessages[0] ?? `Vitest reported assertion status ${String(assertion.status)}`,
  }
}

export async function executeFocusedSpecPlan(plan, options = {}) {
  const runGroup = options.runGroup ?? ((group, index, reportDirectory) => (
    runVitestGroup(plan, group, join(reportDirectory, `group-${index}.json`))
  ))
  const reportDirectory = await mkdtemp(join(tmpdir(), 'doppelganger-focused-specs-'))
  const assertions = []
  const groupFailures = new Map()
  try {
    for (const [index, group] of plan.groups.entries()) {
      try {
        const report = await runGroup(group, index, reportDirectory)
        assertions.push(...report.assertions)
      } catch (error) {
        groupFailures.set(group.rootPath, error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    await rm(reportDirectory, { recursive: true, force: true })
  }

  const assertionByKey = new Map(assertions.map(assertion => [
    assertionKey(assertion.absolutePath, assertion.line, assertion.title),
    assertion,
  ]))
  const targetByKey = new Map(plan.targets.map(target => [target.key, target]))
  const scenarios = plan.scenarios.map(scenario => {
    const evidence = scenario.evidenceKeys.map(key => {
      const target = targetByKey.get(key)
      if (target === undefined) {
        return { reference: key, status: 'FAIL', diagnostic: 'Focused execution plan lost its evidence target' }
      }
      const groupFailure = groupFailures.get(target.rootPath)
      if (groupFailure !== undefined) {
        return { reference: target.reference, status: 'FAIL', diagnostic: groupFailure }
      }
      return evidenceResult(target, assertionByKey)
    })
    const status = evidence.some(item => item.status === 'FAIL')
      ? 'FAIL'
      : evidence.some(item => item.status === 'SKIP') ? 'SKIP' : 'PASS'
    return { id: scenario.id, status, evidence }
  })

  return {
    success: scenarios.every(scenario => scenario.status !== 'FAIL'),
    scenarios,
    targetCount: plan.targets.length,
  }
}

export function formatFocusedSpecResult(plan, result) {
  const scope = plan.mode === 'current' ? 'current specifications' : `change ${plan.changeName}`
  const lines = [
    `focused spec evidence: ${scope}; ${result.scenarios.length} scenarios; ${result.targetCount} unique tests`,
  ]
  for (const scenario of result.scenarios) {
    lines.push(`${scenario.status} ${scenario.id}`)
    for (const evidence of scenario.evidence) {
      lines.push(`  ${evidence.status} ${evidence.reference}`)
      if (evidence.diagnostic !== undefined) {
        for (const line of evidence.diagnostic.split('\n')) lines.push(`    ${line}`)
      }
    }
  }
  const counts = { PASS: 0, SKIP: 0, FAIL: 0 }
  for (const scenario of result.scenarios) counts[scenario.status] += 1
  lines.push(`summary: ${counts.PASS} PASS, ${counts.SKIP} SKIP, ${counts.FAIL} FAIL`)
  return `${lines.join('\n')}\n`
}
