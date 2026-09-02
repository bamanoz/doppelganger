import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants, realpath } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { once } from 'node:events'
import { boundedMessage } from './errors.ts'

export type CodeGraphProcessFailureKind = 'spawn' | 'exit' | 'timeout' | 'output-limit' | 'disposed'

export class CodeGraphProcessFailure extends Error {
  readonly kind: CodeGraphProcessFailureKind
  readonly stderr?: string

  constructor(kind: CodeGraphProcessFailureKind, message: string, stderr?: string) {
    super(message)
    this.kind = kind
    if (stderr !== undefined) this.stderr = stderr
    this.name = 'CodeGraphProcessFailure'
  }
}

export interface CodeGraphProcessRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly maximumStdoutBytes: number
  readonly maximumStderrBytes: number
}

export interface CodeGraphProcessResult {
  readonly stdout: string
  readonly stderr: string
}

interface ActiveChild {
  readonly child: ChildProcess
  readonly settled: Promise<void>
  readonly dispose: () => void
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function candidateNames(name: string, environment: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== 'win32') return Object.freeze([name])
  if (/\.[A-Za-z0-9]+$/u.test(name)) return Object.freeze([name])
  const extensions = (environment.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
  return Object.freeze([name, ...extensions.map(extension => `${name}${extension.toLowerCase()}`)])
}

export async function resolveExecutable(executable: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const candidates: string[] = []
  if (isAbsolute(executable)) {
    candidates.push(executable)
  } else {
    for (const directory of (environment.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const name of candidateNames(executable, environment)) candidates.push(join(directory, name))
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch {
      // Continue deterministic PATH search.
    }
  }
  throw new CodeGraphProcessFailure('spawn', `CodeGraph executable "${executable}" was not found or is not executable`)
}

export class CodeGraphProcessRunner {
  readonly #environment: NodeJS.ProcessEnv
  readonly #shutdownTimeoutMs: number
  readonly #children = new Set<ActiveChild>()
  #accepting = true
  #disposal: Promise<void> | undefined

  constructor(shutdownTimeoutMs: number, environment: NodeJS.ProcessEnv = process.env) {
    this.#shutdownTimeoutMs = shutdownTimeoutMs
    this.#environment = environment
  }

  async run(request: CodeGraphProcessRequest): Promise<CodeGraphProcessResult> {
    if (!this.#accepting) throw new CodeGraphProcessFailure('disposed', 'CodeGraph process runner is disposed')

    let child: ChildProcess
    try {
      child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: {
          ...this.#environment,
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          DO_NOT_TRACK: '1',
          CODEGRAPH_TELEMETRY: '0',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (cause) {
      throw new CodeGraphProcessFailure('spawn', boundedMessage(cause))
    }


    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let failure: CodeGraphProcessFailure | undefined
    let termination: Promise<void> | undefined

    const stderrText = (): string => Buffer.concat(stderr).toString('utf8').trim()
    const terminate = (): Promise<void> => {
      termination ??= this.#terminate(child)
      return termination
    }
    const fail = (next: CodeGraphProcessFailure): void => {
      if (failure !== undefined) return
      failure = next
      void terminate()
    }
    const { promise: settled, resolve: settleChild } = Promise.withResolvers<void>()
    const active = Object.freeze({
      child,
      settled,
      dispose: () => fail(new CodeGraphProcessFailure('disposed', 'CodeGraph command was stopped during disposal', stderrText())),
    })
    this.#children.add(active)

    child.stdout?.on('data', chunk => {
      const bytes = Buffer.from(chunk)
      stdoutBytes += bytes.length
      if (stdoutBytes > request.maximumStdoutBytes) {
        fail(new CodeGraphProcessFailure('output-limit', `CodeGraph stdout exceeded ${request.maximumStdoutBytes} bytes`, stderrText()))
        return
      }
      stdout.push(bytes)
    })
    child.stderr?.on('data', chunk => {
      const bytes = Buffer.from(chunk)
      if (stderrBytes >= request.maximumStderrBytes) return
      const remaining = request.maximumStderrBytes - stderrBytes
      const accepted = bytes.subarray(0, remaining)
      stderr.push(accepted)
      stderrBytes += accepted.length
    })

    const timeout = setTimeout(() => {
      fail(new CodeGraphProcessFailure('timeout', `CodeGraph command timed out after ${request.timeoutMs}ms`, stderrText()))
    }, request.timeoutMs)

    try {
      const outcome = await new Promise<
        | { readonly kind: 'close'; readonly code: number | null; readonly signal: NodeJS.Signals | null }
        | { readonly kind: 'error'; readonly cause: unknown }
      >(resolve => {
        let completed = false
        const close = (code: number | null, signal: NodeJS.Signals | null): void => settle({ kind: 'close', code, signal })
        const error = (cause: unknown): void => settle({ kind: 'error', cause })
        const settle = (value: { readonly kind: 'close'; readonly code: number | null; readonly signal: NodeJS.Signals | null } | { readonly kind: 'error'; readonly cause: unknown }): void => {
          if (completed) return
          completed = true
          child.off('close', close)
          child.off('error', error)
          resolve(value)
        }
        child.on('close', close)
        child.on('error', error)
      })
      if (termination !== undefined) await termination
      if (failure !== undefined) throw failure
      if (outcome.kind === 'error') throw new CodeGraphProcessFailure('spawn', boundedMessage(outcome.cause), stderrText())
      if (outcome.code !== 0) {
        throw new CodeGraphProcessFailure(
          'exit',
          `CodeGraph command exited with ${outcome.signal ?? outcome.code ?? 'unknown status'}`,
          stderrText(),
        )
      }
      return Object.freeze({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: stderrText(),
      })
    } finally {
      clearTimeout(timeout)
      this.#children.delete(active)
      settleChild()
    }
  }

  async #terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const exited = once(child, 'close').then(() => true, () => true)
    if (await Promise.race([exited, delay(this.#shutdownTimeoutMs).then(() => false)])) return
    child.kill('SIGKILL')
    await Promise.race([exited, delay(this.#shutdownTimeoutMs)])
  }

  dispose(): Promise<void> {
    if (this.#disposal !== undefined) return this.#disposal
    this.#accepting = false
    this.#disposal = (async () => {
      const children = [...this.#children]
      for (const active of children) active.dispose()
      await Promise.allSettled(children.map(active => active.settled))
    })()
    return this.#disposal
  }
}
