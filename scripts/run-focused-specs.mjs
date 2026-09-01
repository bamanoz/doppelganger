import { fileURLToPath } from 'node:url'
import { planFocusedSpecRun } from './lib/focused-specs.mjs'
import { executeFocusedSpecPlan, formatFocusedSpecResult } from './lib/run-focused-specs.mjs'

function parseArguments(argumentsList) {
  if (argumentsList.length === 0) return {}
  if (argumentsList.length === 2 && argumentsList[0] === '--change' && argumentsList[1] !== '') {
    return { changeName: argumentsList[1] }
  }
  throw new Error('usage: node scripts/run-focused-specs.mjs [--change <name>]')
}

const root = fileURLToPath(new URL('..', import.meta.url))

try {
  const plan = await planFocusedSpecRun(root, parseArguments(process.argv.slice(2)))
  const result = await executeFocusedSpecPlan(plan)
  process.stdout.write(formatFocusedSpecResult(plan, result))
  if (!result.success) process.exitCode = 1
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
