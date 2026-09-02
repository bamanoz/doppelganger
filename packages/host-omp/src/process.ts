import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { extname } from 'node:path'
import type { OmpChildConnection, OmpChildDisposal, OmpChildFactory } from './adapter.ts'
import { FramedJsonRpcPeer, type RpcNotificationObserverDiagnostic } from './protocol.ts'

export interface NodeOmpChildFactoryOptions {
  readonly childPath: string
  readonly nodePath?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly shutdownTimeoutMs?: number
  readonly onNotificationObserverError?: (
    diagnostic: RpcNotificationObserverDiagnostic,
  ) => void | Promise<void>
}

export function defaultNodePath(hostExecutable: string): string {
  const executable = hostExecutable.split(/[\\/]/).at(-1)?.toLowerCase()
  return executable === 'node' || executable === 'node.exe' || executable === 'nodejs' || executable === 'nodejs.exe'
    ? hostExecutable
    : 'node'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return Promise.race([
    once(child, 'exit').then(() => true),
    delay(timeoutMs).then(() => false),
  ])
}

class NodeOmpChildConnection implements OmpChildConnection {
  readonly processId: number
  readonly #child: ChildProcessWithoutNullStreams
  readonly #peer: FramedJsonRpcPeer
  readonly #shutdownTimeoutMs: number
  readonly #stderr: Array<{ readonly sequence: number; readonly chunk: Buffer }> = []
  readonly #notificationHandlers = new Map<string, Set<(params: unknown) => void>>()
  #nextStderrSequence = 0
  #exitFailure: string | undefined
  #disposing = false
  #disposal: Promise<OmpChildDisposal> | undefined

  constructor(
    child: ChildProcessWithoutNullStreams,
    shutdownTimeoutMs: number,
    onNotificationObserverError?: NodeOmpChildFactoryOptions['onNotificationObserverError'],
  ) {
    this.#child = child
    this.#shutdownTimeoutMs = shutdownTimeoutMs
    if (child.pid === undefined) throw new Error('spawned runtime child has no process ID')
    this.processId = child.pid
    this.#peer = new FramedJsonRpcPeer(child.stdout, child.stdin, {
      onNotificationObserverError: async diagnostic => {
        this.#appendDiagnostic(diagnostic)
        await onNotificationObserverError?.(diagnostic)
      },
    })
    child.stderr.on('data', chunk => { this.#appendStderr(Buffer.from(chunk)) })
    child.once('exit', (code, signal) => {
      if (this.#disposing) return
      const message = this.#unexpectedExitMessage(code, signal)
      this.#exitFailure = message
      for (const handler of this.#notificationHandlers.get('runtime.failed') ?? []) handler({ message })
    })
  }

  #appendDiagnostic(diagnostic: RpcNotificationObserverDiagnostic): void {
    this.#appendStderr(Buffer.from(
      `[rpc notification observer] ${diagnostic.method}: ${diagnostic.message}\n`,
      'utf8',
    ))
  }

  #appendStderr(chunk: Buffer): void {
    this.#stderr.push({ sequence: this.#nextStderrSequence++, chunk })
    while (this.#stderr.reduce((total, part) => total + part.chunk.length, 0) > 64 * 1024) this.#stderr.shift()
  }

  #stderrText(fromSequence = 0): string | undefined {
    const text = Buffer.concat(this.#stderr
      .filter(part => part.sequence >= fromSequence)
      .map(part => part.chunk)).toString('utf8').trim()
    return text.length === 0 ? undefined : text
  }

  #unexpectedExitMessage(code = this.#child.exitCode, signal = this.#child.signalCode): string {
    const details = this.#stderrText()
    return `runtime child exited unexpectedly (${signal ?? code ?? 'unknown'})${details === undefined ? '' : `: ${details}`}`
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    try {
      return await this.#peer.request(method, params)
    } catch (cause) {
      if (this.#disposing) throw cause
      if (this.#exitFailure === undefined && this.#child.exitCode === null && this.#child.signalCode === null) {
        await waitForExit(this.#child, Math.min(this.#shutdownTimeoutMs, 100))
      }
      const message = this.#exitFailure ?? (
        this.#child.exitCode === null && this.#child.signalCode === null
          ? undefined
          : this.#unexpectedExitMessage()
      )
      if (message === undefined) throw cause
      throw new Error(message, { cause })
    }
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.#notificationHandlers.get(method) ?? new Set<(params: unknown) => void>()
    handlers.add(handler)
    this.#notificationHandlers.set(method, handlers)
    const removePeer = this.#peer.onNotification(method, handler)
    return () => {
      removePeer()
      handlers.delete(handler)
      if (handlers.size === 0) this.#notificationHandlers.delete(method)
    }
  }

  async dispose(): Promise<OmpChildDisposal> {
    if (this.#disposal !== undefined) return this.#disposal
    this.#disposing = true
    const diagnosticStart = this.#nextStderrSequence
    this.#disposal = (async () => {
      let outcome: OmpChildDisposal['outcome'] = 'graceful'
      let sessionDisposeAcknowledged = false
      let sessionDisposeDiagnostic: string | undefined
      if (this.#child.exitCode === null && this.#child.signalCode === null) {
        sessionDisposeAcknowledged = await Promise.race([
          this.#peer.request('session.dispose').then(() => true, cause => {
            sessionDisposeDiagnostic = cause instanceof Error ? cause.message : String(cause)
            return false
          }),
          delay(this.#shutdownTimeoutMs).then(() => false),
        ])
      }
      if (!await waitForExit(this.#child, this.#shutdownTimeoutMs)) {
        outcome = 'terminated'
        this.#child.kill('SIGTERM')
        if (!await waitForExit(this.#child, this.#shutdownTimeoutMs)) {
          outcome = 'killed'
          this.#child.kill('SIGKILL')
          if (!await waitForExit(this.#child, this.#shutdownTimeoutMs)) {
            throw new Error('runtime child did not exit after SIGKILL')
          }
        }
      }
      this.#peer.close()
      const stderrDiagnostic = this.#stderrText(diagnosticStart)
      const diagnostic = [sessionDisposeDiagnostic, stderrDiagnostic].filter(value => value !== undefined).join('\n')
      return Object.freeze({
        outcome,
        sessionDisposeAcknowledged,
        ...(diagnostic.length === 0 ? {} : { diagnostic }),
      })
    })()
    return this.#disposal
  }
}

export class NodeOmpChildFactory implements OmpChildFactory {
  readonly #options: NodeOmpChildFactoryOptions

  constructor(options: NodeOmpChildFactoryOptions) {
    this.#options = options
  }

  async start(): Promise<OmpChildConnection> {
    const args = extname(this.#options.childPath) === '.ts'
      ? ['--no-warnings', this.#options.childPath]
      : [this.#options.childPath]
    const child = spawn(this.#options.nodePath ?? defaultNodePath(process.execPath), args, {
      env: { ...process.env, ...this.#options.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    await Promise.race([
      once(child, 'spawn'),
      once(child, 'error').then(([cause]) => Promise.reject(cause)),
    ])
    return new NodeOmpChildConnection(
      child,
      this.#options.shutdownTimeoutMs ?? 2000,
      this.#options.onNotificationObserverError,
    )
  }
}
