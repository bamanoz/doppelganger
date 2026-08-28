import { spawnSync } from 'node:child_process'

const npmCli = process.env.npm_execpath
if (npmCli === undefined) {
  throw new Error('check-single-cordis must run through npm')
}

const result = spawnSync(process.execPath, [npmCli, 'ls', '--parseable', '--all', '@deepseek-ai/cordis'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const installations = result.stdout
  .split(/\r?\n/u)
  .filter(line => line.includes('node_modules') && line.endsWith('@deepseek-ai\\cordis') || line.endsWith('@deepseek-ai/cordis'))

if (installations.length !== 1) {
  throw new Error(`expected one @deepseek-ai/cordis installation, found ${installations.length}:\n${installations.join('\n')}`)
}

process.stdout.write(`${installations[0]}\n`)
