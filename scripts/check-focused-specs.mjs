import { fileURLToPath } from 'node:url'
import { checkFocusedSpecChange, checkFocusedSpecs } from './lib/focused-specs.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const argumentsList = process.argv.slice(2)
const changeIndex = argumentsList.indexOf('--change')

if (changeIndex >= 0 && argumentsList[changeIndex + 1] === undefined) {
  throw new Error('usage: node scripts/check-focused-specs.mjs [--change <name>]')
}

const changeName = changeIndex >= 0 ? argumentsList[changeIndex + 1] : undefined
const violations = changeName === undefined
  ? await checkFocusedSpecs(root)
  : await checkFocusedSpecChange(root, changeName)

if (violations.length > 0) throw new Error(`focused spec violations:\n${violations.join('\n')}`)
process.stdout.write(changeName === undefined
  ? 'checked current and active focused specifications\n'
  : `checked focused specification change ${changeName} for archive readiness\n`)
