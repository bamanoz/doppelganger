#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const command = args[0] === '--version' ? 'version' : args[0]
const activePath = process.env.CODEGRAPH_FIXTURE_ACTIVE_PATH
let activeFile
let activeCount
if (activePath) {
  mkdirSync(activePath, { recursive: true })
  activeFile = `${activePath}/${process.pid}`
  writeFileSync(activeFile, '')
  activeCount = readdirSync(activePath).length
}
const clearActive = () => {
  if (!activeFile) return
  try { unlinkSync(activeFile) } catch {}
  activeFile = undefined
}
process.on('exit', clearActive)
const logPath = process.env.CODEGRAPH_FIXTURE_LOG
if (logPath) {
  appendFileSync(logPath, `${JSON.stringify({
    args,
    cwd: process.cwd(),
    env: {
      NO_COLOR: process.env.NO_COLOR,
      FORCE_COLOR: process.env.FORCE_COLOR,
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CODEGRAPH_TELEMETRY: process.env.CODEGRAPH_TELEMETRY,
    },
    pid: process.pid,
    activeCount,
  })}\n`)
}

const delayCommand = process.env.CODEGRAPH_FIXTURE_DELAY_COMMAND
const delay = Number(process.env.CODEGRAPH_FIXTURE_DELAY_MS ?? 0)
if (process.env.CODEGRAPH_FIXTURE_IGNORE_SIGTERM === '1') {
  process.on('SIGTERM', () => {
    if (logPath) appendFileSync(logPath, `${JSON.stringify({ signal: 'SIGTERM', command, pid: process.pid, activeCount })}\n`)
  })
}
if (delay > 0 && (delayCommand === undefined || delayCommand === command)) {
  await new Promise(resolve => setTimeout(resolve, delay))
}
if (process.env.CODEGRAPH_FIXTURE_FAIL_COMMAND === command) {
  process.stderr.write(process.env.CODEGRAPH_FIXTURE_STDERR ?? `${command} failed`)
  process.exit(7)
}
const flood = Number(process.env.CODEGRAPH_FIXTURE_FLOOD_BYTES ?? 0)
if (flood > 0 && process.env.CODEGRAPH_FIXTURE_FLOOD_COMMAND === command) {
  await new Promise((resolve, reject) => process.stdout.write('x'.repeat(flood), error => error ? reject(error) : resolve()))
  process.exitCode = 0
}

if (command === 'version') {
  process.stdout.write(`${process.env.CODEGRAPH_FIXTURE_VERSION ?? '1.6.0'}\n`)
  process.exit(0)
}

const statusPath = process.env.CODEGRAPH_FIXTURE_STATUS_PATH
if (command === 'status') {
  if (!statusPath) throw new Error('CODEGRAPH_FIXTURE_STATUS_PATH is required')
  process.stdout.write(readFileSync(statusPath, 'utf8'))
  process.exit(0)
}

if (command === 'sync') {
  if (!statusPath) throw new Error('CODEGRAPH_FIXTURE_STATUS_PATH is required')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  status.pendingChanges = { added: 0, modified: 0, removed: 0 }
  if (status.index) status.index.pendingRefs = 0
  writeFileSync(statusPath, JSON.stringify(status))
  process.exit(0)
}

if (command === 'explore') {
  process.stdout.write(process.env.CODEGRAPH_FIXTURE_EXPLORE ?? 'graph context\n')
  process.exit(0)
}

process.stderr.write(`forbidden command: ${String(command)}`)
process.exit(9)
