import { fileURLToPath } from 'node:url'
import { checkRepositoryIntegrity } from './lib/repository-integrity.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = await checkRepositoryIntegrity(root)

if (violations.length > 0) throw new Error(`repository integrity violations:\n${violations.join('\n')}`)
process.stdout.write('checked documentation inventory, links, and live OpenSpec contracts\n')
