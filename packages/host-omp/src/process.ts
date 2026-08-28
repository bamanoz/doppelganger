import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { extname } from 'node:path'
import type { OmpChildConnection, OmpChildDisposal, OmpChildFactory } from './adapter.ts'
import { FramedJsonRpcPeer } from './protocol.ts'

export interface NodeOmpChildFactoryOptions {
  readonly childPath: string
  readonly nodePath?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly shutdownTimeoutMs?: number
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
  readonly #stderr: Buffer[] = []
  readonly #notificationHandlers = new Map<string, Set<(params: unknown) => void>>()
  #disposing = false
  #disposal: Promise<OmpChildDisposal> | undefined

  constructor(child: ChildProcessWithoutNullStreams, shutdownTimeoutMs: number) {
    this.#child = child
    this.#shutdownTimeoutMs = shutdownTimeoutMs
    if (child.pid === undefined) throw new Error('spawned runtime child has no process ID')
    this.processId = child.pid
    this.#peer = new FramedJsonRpcPeer(child.stdout, child.stdin)
    child.stderr.on('data', chunk => {
      this.#stderr.push(Buffer.from(chunk))
      while (this.#stderr.reduce((total, part) => total + part.length, 0) > 64 * 1024) this.#stderr.shift()
    })
    child.once('exit', (code, signal) => {
      if (this.#disposing) return
      const details = this.#stderr.length === 0 ? '' : `: ${Buffer.concat(this.#stderr).toString('utf8').trim()}`
      const message = `runtime child exited unexpectedly (${signal ?? code ?? 'unknown'})${details}`
      for (const handler of this.#notificationHandlers.get('runtime.failed') ?? []) handler({ message })
    })
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return this.#peer.request(method, params)
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
    this.#disposal = (async () => {
      let outcome: OmpChildDisposal['outcome'] = 'graceful'
      let sessionDisposeAcknowledged = false
      if (this.#child.exitCode === null && this.#child.signalCode === null) {
        sessionDisposeAcknowledged = await Promise.race([
          this.#peer.request('session.dispose').then(() => true, () => false),
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
      return Object.freeze({ outcome, sessionDisposeAcknowledged })
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
      ? ['--no-warnings', '--experimental-transform-types', this.#options.childPath]
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
    return new NodeOmpChildConnection(child, this.#options.shutdownTimeoutMs ?? 2000)
  }
}
