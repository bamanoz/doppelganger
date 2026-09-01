import { fileURLToPath } from 'node:url'
import { checkPackageBoundaries } from './lib/package-boundaries.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = await checkPackageBoundaries(root)

if (violations.length > 0) throw new Error(`package boundary violations:\n${violations.join('\n')}`)
process.stdout.write('checked package boundaries from scripts/package-boundaries.json\n')
