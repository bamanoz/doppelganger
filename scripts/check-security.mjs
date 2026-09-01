import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareSecurityAudit, summarizeAudit } from './lib/security-audit.mjs'

const baselinePath = fileURLToPath(new URL('./security-advisory-baseline.json', import.meta.url))
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
if (result.error !== undefined) throw result.error
let audit
try {
  audit = JSON.parse(result.stdout)
} catch (cause) {
  throw new Error(`npm audit did not return JSON: ${cause instanceof Error ? cause.message : String(cause)}\n${result.stderr}`)
}
const advisories = summarizeAudit(audit)
process.stdout.write(`production dependency audit: ${Object.keys(advisories).length} unresolved reviewed entries\n`)
for (const [name, advisory] of Object.entries(advisories)) {
  process.stdout.write(`- ${name}: severity=${advisory.severity}, range=${advisory.range}, fixAvailable=${String(advisory.fixAvailable)}, advisories=${advisory.advisoryIds.join(',') || 'transitive'}\n`)
}
process.stdout.write(`restriction: ${baseline.deploymentRestriction}\n`)
const violations = compareSecurityAudit(audit, baseline)
if (violations.length > 0) throw new Error(`security advisory baseline violations:\n${violations.join('\n')}`)
if (result.status !== 0 && result.status !== 1) throw new Error(`npm audit exited with status ${String(result.status)}: ${result.stderr}`)
process.stdout.write(`reviewed against baseline dated ${baseline.reviewDate}; unresolved advisories remain\n`)
